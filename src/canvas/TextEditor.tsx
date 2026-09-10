/*
 * Copyright (C) 2026 Stanislav Georgiev
 * https://github.com/slaviboy
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Inline text editing.
 *
 * A real <textarea> is overlaid on the text node and transformed by the same
 * matrix the node uses, so the caret, selection and wrapping land exactly where
 * the rendered glyphs are — at any zoom, rotation or nesting depth.
 *
 * Editing writes through setText on every keystroke under one coalesce key, so
 * a whole typing burst collapses into a single undo entry instead of one per
 * character.
 *
 * The textarea also reports WHICH characters are selected, because formatting
 * part of a text object is a conversation between two panels: you select a word
 * here and reach for the size over there. Clicking the inspector blurs this
 * element, so the selection is mirrored into the editor store on every change
 * and the blur that lands on the inspector is deliberately not the end of
 * editing.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { multiply, type Mat2D } from '../geometry/Matrix'
import { mat3FromMat2D, mat3Multiply, toCssMatrix3d } from '../geometry/Perspective'
import { worldMatrix } from '../document/SceneGraph'
import { is3dAffected, nodeMapping } from '../document/Scene3D'
import { viewportMatrix } from './Viewport'
import { setText } from '../history/Commands'
import { indexAtPoint } from '../text/TextGeometry'
import { fontStack } from '../text/FontRegistry'
import { toHex } from '../document/color'
import { endTextEditing, setEditor, setTextSelection } from '../state/EditorStore'
import { useDocument, useEditorStore } from '../state/hooks'
import type { CSSProperties } from 'react'
import type { NodeId, TextStyle } from '../document/types'

/**
 * How each transformation is shown while editing.
 *
 * `capitalize` is CSS's nearest word to Title Case; it leaves the rest of a
 * word as typed where applyTextTransform lowercases it, so an ALL-CAPS word
 * settles down when you commit. The alternative — showing untransformed text —
 * is further from the result, not closer.
 */
const CSS_TRANSFORM: Record<TextStyle['transform'], CSSProperties['textTransform']> = {
  none: 'none',
  uppercase: 'uppercase',
  lowercase: 'lowercase',
  titlecase: 'capitalize',
}

export function TextEditor({ nodeId }: { nodeId: NodeId }) {
  const doc = useDocument()
  const viewport = useEditorStore((s) => s.viewport)
  const ref = useRef<HTMLTextAreaElement>(null)
  /** Where a pointer selection started, while one is being dragged. */
  const anchorRef = useRef<number | null>(null)
  const node = doc.nodes[nodeId]
  // Local, and true from the first frame: the store cannot be the source of
  // truth here because the element has to be focusable before it can report
  // being focused, and it starts by focusing itself.
  const [focused, setFocused] = useState(true)
  // Text carrying style runs cannot be drawn by a textarea at all: it has one
  // font. For those the element stops drawing entirely and becomes an input
  // sink — still the keyboard, the selection and the clipboard — while the
  // canvas draws the glyphs and TextEditOverlay draws the caret.
  const rich = node?.type === 'text' && !!node.runs?.length
  const [value, setValue] = useState(node?.type === 'text' ? node.text : '')

  const matrix = useMemo<Mat2D>(() => {
    if (!node) return [1, 0, 0, 1, 0, 0]
    return multiply(viewportMatrix(viewport), worldMatrix(doc, nodeId))
  }, [doc, nodeId, node, viewport])

  // Text in perspective is typed in perspective. An HTML element, unlike an
  // SVG one, gets real perspective from CSS, so the textarea is given the very
  // homography the canvas draws the text with and lies exactly on it.
  const cssTransform = useMemo(() => {
    if (!node || !is3dAffected(doc, nodeId)) return `matrix(${matrix.join(',')})`
    return toCssMatrix3d(
      mat3Multiply(mat3FromMat2D(viewportMatrix(viewport)), nodeMapping(doc, nodeId).toWorld),
    )
  }, [doc, nodeId, node, viewport, matrix])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setEditor({ textEditingFocused: true })
    el.focus()
    // Select everything on entry so typing replaces the placeholder, which is
    // what happens when a brand-new text box is created.
    el.select()
  }, [nodeId])

  // setText re-fits the box itself, per its resize option — an Auto Width box
  // widens as you type, an Auto Height one grows downwards and keeps its width,
  // a Fixed one does neither. Doing it there rather than here keeps a typing
  // burst to one undo entry and stops this component from having an opinion
  // about geometry.
  const commit = useCallback(
    (next: string) => {
      setValue(next)
      setText(nodeId, next)
    },
    [nodeId],
  )

  const reportSelection = useCallback(() => {
    const el = ref.current
    if (el) setTextSelection(nodeId, el.selectionStart, el.selectionEnd)
  }, [nodeId])

  /**
   * Put the caret where the pointer is, measured against the layout the glyphs
   * were drawn with.
   *
   * offsetX/offsetY are in the element's own coordinate system, which is the
   * node's local space — CSS transforms do not affect them — so the point needs
   * no conversion. Left to itself the textarea would place the caret using its
   * own single-font layout, which for rich text is a layout nobody is looking
   * at.
   */
  const pointerIndex = useCallback(
    (e: React.PointerEvent<HTMLTextAreaElement>): number | null => {
      if (!rich || node?.type !== 'text') return null
      return indexAtPoint(node, e.nativeEvent.offsetX, e.nativeEvent.offsetY)
    },
    [rich, node],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLTextAreaElement>) => {
      const index = pointerIndex(e)
      if (index === null) return
      e.preventDefault()
      const el = ref.current
      if (!el) return
      el.focus()
      el.setSelectionRange(index, index)
      reportSelection()
      e.currentTarget.setPointerCapture(e.pointerId)
      anchorRef.current = index
    },
    [pointerIndex, reportSelection],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLTextAreaElement>) => {
      if (anchorRef.current === null) return
      const index = pointerIndex(e)
      if (index === null) return
      const el = ref.current
      if (!el) return
      const anchor = anchorRef.current
      el.setSelectionRange(Math.min(anchor, index), Math.max(anchor, index))
      reportSelection()
    },
    [pointerIndex, reportSelection],
  )

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLTextAreaElement>) => {
    if (anchorRef.current === null) return
    anchorRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [])

  /** Double-click selects the word under the pointer, as a textarea would. */
  const onDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLTextAreaElement>) => {
      if (!rich || node?.type !== 'text') return
      const el = ref.current
      if (!el) return
      e.preventDefault()
      const index = indexAtPoint(node, e.nativeEvent.offsetX, e.nativeEvent.offsetY)
      const text = node.text
      let start = index
      let end = index
      while (start > 0 && !/\s/.test(text[start - 1]!)) start--
      while (end < text.length && !/\s/.test(text[end]!)) end++
      el.setSelectionRange(start, end)
      reportSelection()
    },
    [rich, node, reportSelection],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Keystrokes must not reach the global shortcut layer while typing, or
      // pressing "r" would swap to the rectangle tool mid-word.
      e.stopPropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        endTextEditing()
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        endTextEditing()
      }
    },
    [],
  )

  useEffect(() => {
    if (node?.type !== 'text') endTextEditing()
  }, [node])

  // `selectionchange` on the document rather than React's onSelect. React
  // synthesises onSelect from its own heuristics and does not fire it for a
  // programmatic setSelectionRange, which is exactly what the select-all on
  // entry is — so the inspector would not learn about the selection it is
  // about to be asked to format.
  useEffect(() => {
    const onSelectionChange = () => {
      if (document.activeElement === ref.current) reportSelection()
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [reportSelection])

  // Selecting everything on entry is itself a selection the inspector should see.
  useLayoutEffect(reportSelection, [reportSelection])

  if (!node || node.type !== 'text') return null
  const ts = node.textStyle
  const fill = node.style.fill.type === 'solid' ? toHex(node.style.fill.color) : '#000000'
  const decoration = [ts.underline ? 'underline' : '', ts.strikethrough ? 'line-through' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <textarea
      ref={ref}
      className="text-editor"
      data-testid="text-editor"
      value={value}
      onChange={(e) => {
        commit(e.target.value)
        reportSelection()
      }}
      onKeyDown={onKeyDown}
      onSelect={reportSelection}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onFocus={() => {
        setFocused(true)
        setEditor({ textEditingFocused: true })
      }}
      onBlur={(e) => {
        setFocused(false)
        setEditor({ textEditingFocused: false })
        // Focus moving into the inspector is the user reaching for a control
        // to format the selection with. Ending the edit there would drop both
        // the selection and the editor before the control could be used, which
        // is the one interaction this whole mechanism exists for.
        if ((e.relatedTarget as HTMLElement | null)?.closest('.inspector')) return
        endTextEditing()
      }}
      spellCheck={false}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        transformOrigin: '0 0',
        transform: cssTransform,
        width: `${Math.max(node.transform.width, 8)}px`,
        height: `${Math.max(node.transform.height, ts.fontSize * ts.lineHeight)}px`,
        fontFamily: fontStack(ts.fontFamily),
        fontSize: `${ts.fontSize}px`,
        fontWeight: ts.fontWeight,
        fontStyle: ts.fontStyle,
        lineHeight: ts.lineHeight,
        letterSpacing: `${ts.letterSpacing * ts.fontSize}px`,
        textAlign: ts.align,
        // Blurred, the canvas draws this text properly formatted underneath —
        // two renderings at once would show every glyph twice. The element
        // stays in place and clickable rather than hidden, so clicking the
        // text hands editing straight back to it. `visibility: hidden` would
        // also make it unfocusable, which is a trap: it focuses itself on
        // mount, and could never become visible again.
        // Rich text is drawn by the canvas, always. Uniform text is drawn here
        // while this element has focus, and by the canvas once it does not.
        color: rich || !focused ? 'transparent' : fill,
        background: 'transparent',
        border: 'none',
        outline: '1px solid var(--accent)',

        padding: 0,
        margin: 0,
        resize: 'none',
        overflow: 'hidden',
        // The same rule the layout engine follows: both modes that own their
        // width wrap to it, Auto Width never does. With 'pre' on an Auto Height
        // box the textarea scrolls sideways instead of wrapping, so the text
        // being edited and the text as it will be drawn are laid out
        // differently — which is exactly the state this component exists to
        // avoid.
        whiteSpace: ts.sizing === 'auto-width' ? 'pre' : 'pre-wrap',
        // Matches breakLongWord: a word wider than the box is broken rather
        // than allowed to overflow it.
        overflowWrap: 'break-word',
        // The transformation is applied to the DISPLAY only, exactly as it is
        // when the text is drawn — the textarea's value stays what was typed,
        // which is what lets None give it back unchanged.
        textTransform: CSS_TRANSFORM[ts.transform],
        textDecoration: decoration || undefined,
        // The rich caret is drawn by TextEditOverlay, from the real layout.
        caretColor: rich || !focused ? 'transparent' : fill,
      }}
    />
  )
}

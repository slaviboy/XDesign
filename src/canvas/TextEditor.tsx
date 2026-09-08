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
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { multiply, type Mat2D } from '../geometry/Matrix'
import { worldMatrix } from '../document/SceneGraph'
import { viewportMatrix } from './Viewport'
import { setText } from '../history/Commands'
import { fontStack } from '../text/FontRegistry'
import { toHex } from '../document/color'
import { setEditor } from '../state/EditorStore'
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
  const node = doc.nodes[nodeId]
  const [value, setValue] = useState(node?.type === 'text' ? node.text : '')

  const matrix = useMemo<Mat2D>(() => {
    if (!node) return [1, 0, 0, 1, 0, 0]
    return multiply(viewportMatrix(viewport), worldMatrix(doc, nodeId))
  }, [doc, nodeId, node, viewport])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
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

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Keystrokes must not reach the global shortcut layer while typing, or
      // pressing "r" would swap to the rectangle tool mid-word.
      e.stopPropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        setEditor({ editingTextId: null })
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setEditor({ editingTextId: null })
      }
    },
    [],
  )

  useEffect(() => {
    if (node?.type !== 'text') setEditor({ editingTextId: null })
  }, [node])

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
      onChange={(e) => commit(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => setEditor({ editingTextId: null })}
      spellCheck={false}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        transformOrigin: '0 0',
        transform: `matrix(${matrix.join(',')})`,
        width: `${Math.max(node.transform.width, 8)}px`,
        height: `${Math.max(node.transform.height, ts.fontSize * ts.lineHeight)}px`,
        fontFamily: fontStack(ts.fontFamily),
        fontSize: `${ts.fontSize}px`,
        fontWeight: ts.fontWeight,
        fontStyle: ts.fontStyle,
        lineHeight: ts.lineHeight,
        letterSpacing: `${ts.letterSpacing * ts.fontSize}px`,
        textAlign: ts.align,
        color: fill,
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
        caretColor: fill,
      }}
    />
  )
}

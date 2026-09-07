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
import { setText, setNodeTransform } from '../history/Commands'
import { intrinsicTextSize } from '../text/TextLayout'
import { fontStack } from '../text/FontRegistry'
import { toHex } from '../document/color'
import { setEditor } from '../state/EditorStore'
import { useDocument, useEditorStore } from '../state/hooks'
import type { NodeId } from '../document/types'

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

  const commit = useCallback(
    (next: string) => {
      setValue(next)
      setText(nodeId, next)
      const n = doc.nodes[nodeId]
      if (n?.type === 'text' && n.textStyle.sizing === 'auto') {
        // Auto-sizing boxes grow with their content as you type.
        const size = intrinsicTextSize(next, n.textStyle)
        if (
          Math.abs(size.width - n.transform.width) > 0.5 ||
          Math.abs(size.height - n.transform.height) > 0.5
        ) {
          setNodeTransform(nodeId, { width: size.width, height: size.height }, `text-size:${nodeId}`)
        }
      }
    },
    [doc, nodeId],
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
        whiteSpace: ts.sizing === 'fixed' ? 'pre-wrap' : 'pre',
        caretColor: fill,
      }}
    />
  )
}

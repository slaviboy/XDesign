/**
 * The line tool, driven through its real pointer handlers.
 *
 * A line is the one shape that is not symmetric: its box says how big the drag
 * was, but only its endpoints say which way round it runs. Everything here pins
 * the consequences of having previously carried that direction in a SIGNED
 * bounding box, which every consumer read as a normal AABB.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { lineTool, getDrawPreview } from '@/tools/ShapeTools'
import { createDocument } from '@/document/NodeFactory'
import { replaceDocument, getDoc } from '@/state/DocumentStore'
import { setTool } from '@/state/EditorStore'
import type { CanvasPointerEvent, ToolContext } from '@/tools/types'
import type { LineNode } from '@/document/types'

const ctx: ToolContext = {
  doc: () => getDoc(),
  editor: () => ({}) as never,
  viewport: () => ({ x: 0, y: 0, zoom: 1 }),
  screenToDoc: (p) => p,
  docToScreen: (p) => p,
  tolerance: () => 4,
  refreshOverlay: () => {},
}

function ev(x: number, y: number, mods: Partial<CanvasPointerEvent> = {}): CanvasPointerEvent {
  return {
    screen: { x, y },
    doc: { x, y },
    deltaDoc: { x: 0, y: 0 },
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    primaryModifier: false,
    button: 0,
    buttons: 1,
    pointerId: 1,
    targetNodeId: null,
    targetHandle: null,
    targetCorner: null,
    native: {} as PointerEvent,
    ...mods,
  }
}

/** Drag the line tool from a to b and return the committed node. */
function drawLine(
  from: { x: number; y: number },
  to: { x: number; y: number },
  mods: Partial<CanvasPointerEvent> = {},
): LineNode | undefined {
  setTool('line')
  lineTool.onPointerDown?.(ev(from.x, from.y, mods), ctx)
  lineTool.onPointerMove?.(ev(to.x, to.y, mods), ctx)
  lineTool.onPointerUp?.(ev(to.x, to.y, mods), ctx)
  const doc = getDoc()
  return Object.values(doc.nodes).find((n) => n.type === 'line') as LineNode | undefined
}

beforeEach(() => {
  replaceDocument(createDocument('Lines', false))
  setTool('select')
})

describe('line tool', () => {
  it('places both endpoints under the pointer, in every direction', () => {
    // Each case is (start, end); the committed line must run from start to end
    // in document space, whichever way the drag went.
    const cases = [
      { from: { x: 100, y: 100 }, to: { x: 200, y: 180 } }, // down-right
      { from: { x: 300, y: 100 }, to: { x: 200, y: 180 } }, // down-left
      { from: { x: 100, y: 300 }, to: { x: 200, y: 220 } }, // up-right
      { from: { x: 300, y: 300 }, to: { x: 200, y: 220 } }, // up-left
    ]
    for (const { from, to } of cases) {
      replaceDocument(createDocument('Lines', false))
      const line = drawLine(from, to)
      expect(line, `${from.x},${from.y} -> ${to.x},${to.y}`).toBeDefined()
      const t = line!.transform
      expect({ x: t.x + line!.x1, y: t.y + line!.y1 }).toEqual(from)
      expect({ x: t.x + line!.x2, y: t.y + line!.y2 }).toEqual(to)
    }
  })

  it('creates a line when dragged up and to the left', () => {
    // The size guard used to read a signed box, so an up-left drag looked like
    // a zero-size shape and was thrown away without a trace.
    const line = drawLine({ x: 400, y: 400 }, { x: 300, y: 320 })
    expect(line).toBeDefined()
    expect(line!.x2).toBe(0)
    expect(line!.y2).toBe(0)
    expect(line!.transform.width).toBeCloseTo(100, 6)
    expect(line!.transform.height).toBeCloseTo(80, 6)
  })

  it('local endpoints stay inside the box, which is never negative', () => {
    const line = drawLine({ x: 300, y: 300 }, { x: 200, y: 220 })!
    for (const v of [line.x1, line.y1, line.x2, line.y2]) expect(v).toBeGreaterThanOrEqual(0)
    expect(line.transform.width).toBeGreaterThan(0)
    expect(line.transform.height).toBeGreaterThan(0)
    expect(Math.max(line.x1, line.x2)).toBeCloseTo(line.transform.width, 6)
    expect(Math.max(line.y1, line.y2)).toBeCloseTo(line.transform.height, 6)
  })

  it('commits the Shift constraint, not just previews it', () => {
    // 10 units of vertical drift over 130 horizontal snaps to a flat line.
    const line = drawLine({ x: 200, y: 200 }, { x: 330, y: 210 }, { shiftKey: true })!
    expect(line.y1).toBeCloseTo(line.y2, 6)
    expect(line.transform.y + line.y1).toBeCloseTo(200, 6)
  })

  it('commits the Alt from-centre constraint', () => {
    // Alt mirrors the start about the pointer, so the line is twice as long and
    // centred on where the drag began.
    const line = drawLine({ x: 200, y: 200 }, { x: 260, y: 200 }, { altKey: true })!
    expect(line.transform.width).toBeCloseTo(120, 6)
    const midX = line.transform.x + (line.x1 + line.x2) / 2
    expect(midX).toBeCloseTo(200, 6)
  })

  it('a click with no drag puts the line ON the pointer', () => {
    setTool('line')
    lineTool.onPointerDown?.(ev(500, 400), ctx)
    lineTool.onPointerUp?.(ev(500, 400), ctx)
    const line = Object.values(getDoc().nodes).find((n) => n.type === 'line') as LineNode
    expect(line).toBeDefined()
    expect(line.y1).toBe(0)
    expect(line.y2).toBe(0)
    expect(line.transform.y).toBeCloseTo(400, 6)
    // Centred horizontally on the click rather than starting there.
    expect(line.transform.x + line.x1).toBeCloseTo(450, 6)
    expect(line.transform.x + line.x2).toBeCloseTo(550, 6)
  })

  it('the preview segment tracks the pointer while dragging', () => {
    setTool('line')
    lineTool.onPointerDown?.(ev(400, 400), ctx)
    lineTool.onPointerMove?.(ev(300, 320), ctx)
    const preview = getDrawPreview()!
    expect(preview.kind).toBe('line')
    expect(preview.segment.a).toEqual({ x: 400, y: 400 })
    expect(preview.segment.b).toEqual({ x: 300, y: 320 })
    // And the box it reports is unsigned, whatever direction the drag took.
    expect(preview.bounds.width).toBeGreaterThan(0)
    expect(preview.bounds.height).toBeGreaterThan(0)
    lineTool.onPointerUp?.(ev(300, 320), ctx)
  })
})

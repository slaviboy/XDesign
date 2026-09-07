/**
 * The Pen tool's six XD drawing procedures, driven through its real handlers.
 *
 * Three of these were impossible before: the tool had no modifier keys at all,
 * so a curve could never be followed by a straight line and two curves could
 * never meet at a cusp. Plain node — nothing here touches the DOM.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { penTool, getPenPreview } from '@/tools/PenTool'
import { isMirrored, isSmooth } from '@/geometry/PathPoints'
import { createDocument } from '@/document/NodeFactory'
import { replaceDocument, getDoc } from '@/state/DocumentStore'
import { setTool } from '@/state/EditorStore'
import type { CanvasPointerEvent, ToolContext } from '@/tools/types'
import type { PathNode } from '@/document/types'

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
    screen: { x, y }, doc: { x, y }, deltaScreen: { x: 0, y: 0 },
    shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, primaryModifier: false,
    button: 0, buttons: 1, pointerId: 1,
    targetNodeId: null, targetHandle: null, targetCorner: null,
    native: {} as PointerEvent,
    ...mods,
  }
}

/** Click, without dragging: a corner point. */
function click(x: number, y: number, mods: Partial<CanvasPointerEvent> = {}) {
  penTool.onPointerDown?.(ev(x, y, mods), ctx)
  penTool.onPointerUp?.(ev(x, y, mods), ctx)
}

/** Press at the anchor and drag to (hx,hy): a smooth point. */
function dragOut(x: number, y: number, hx: number, hy: number, mods: Partial<CanvasPointerEvent> = {}) {
  penTool.onPointerDown?.(ev(x, y, mods), ctx)
  penTool.onPointerMove?.(ev(hx, hy, mods), ctx)
  penTool.onPointerUp?.(ev(hx, hy, mods), ctx)
}

/** The pen only reads `key`, so a plain object is enough — node has no KeyboardEvent. */
const key = (k: string) => ({ key: k }) as KeyboardEvent

const building = () => getPenPreview()!.sub
const committed = () =>
  Object.values(getDoc().nodes).find((n) => n.type === 'path') as PathNode | undefined

beforeEach(() => {
  // The pen holds its in-progress path in module state, so it has to be torn
  // down between tests or each one inherits the last one's points.
  penTool.onDeactivate?.(ctx)
  replaceDocument(createDocument('Pen', false))
  setTool('pen')
})

describe('pen tool', () => {
  it('draws straight lines from plain clicks', () => {
    click(100, 100)
    click(200, 100)
    click(200, 200)
    penTool.onKeyDown?.(key('Enter'), ctx)
    const d = committed()!.d
    expect(d).toMatch(/^M/)
    expect(d).not.toContain('C')
    expect((d.match(/L/g) ?? []).length).toBe(2)
  })

  it('draws curves from click-drag, with mirrored handles', () => {
    dragOut(100, 100, 150, 100)
    dragOut(200, 200, 250, 200)
    expect(isMirrored(building().points[0]!)).toBe(true)
    penTool.onKeyDown?.(key('Enter'), ctx)
    expect(committed()!.d).toContain('C')
  })

  it('draws a straight line followed by a curve', () => {
    click(100, 100)
    click(200, 100)
    dragOut(300, 160, 350, 200)
    // The clicked points stay corners; only the dragged one is smooth.
    expect(isSmooth(building().points[0]!)).toBe(false)
    expect(isSmooth(building().points[1]!)).toBe(false)
    expect(isSmooth(building().points[2]!)).toBe(true)
    penTool.onKeyDown?.(key('Enter'), ctx)
    const d = committed()!.d
    // First segment is a line, second is a curve.
    expect(d).toMatch(/L.*C/s)
  })

  it('draws a curve followed by a straight line (Alt retracts the handle)', () => {
    dragOut(100, 100, 160, 100)
    dragOut(220, 160, 280, 160)
    expect(building().points[1]!.outX).not.toBeNull()

    // Alt-click the anchor just placed: its OUTGOING handle goes, the incoming
    // curve keeps its shape.
    click(220, 160, { altKey: true })
    expect(building().points[1]!.outX).toBeNull()
    expect(building().points[1]!.inX).not.toBeNull()

    click(340, 160)
    penTool.onKeyDown?.(key('Enter'), ctx)
    const d = committed()!.d
    expect(d).toContain('C')
    // The last segment leaves both ends handle-free, so it serialises as a line.
    expect(d.trimEnd()).toMatch(/L[\d.\s-]+$/)
  })

  it('draws two curved segments connected by a corner (Alt splits the handles)', () => {
    dragOut(100, 200, 160, 200)
    // Alt while dragging out the second point breaks the joint.
    penTool.onPointerDown?.(ev(240, 120), ctx)
    penTool.onPointerMove?.(ev(300, 180, { altKey: true }), ctx)
    penTool.onPointerUp?.(ev(300, 180, { altKey: true }), ctx)
    expect(isMirrored(building().points[1]!)).toBe(false)
    expect(isSmooth(building().points[1]!)).toBe(true)
  })

  it('mirrors the handles when Alt is NOT held', () => {
    dragOut(100, 200, 160, 200)
    dragOut(240, 120, 300, 180)
    expect(isMirrored(building().points[1]!)).toBe(true)
  })

  it('leaves a corner when a handle is dragged out and back', () => {
    penTool.onPointerDown?.(ev(100, 100), ctx)
    penTool.onPointerMove?.(ev(160, 100), ctx)
    penTool.onPointerMove?.(ev(100, 100), ctx)
    penTool.onPointerUp?.(ev(100, 100), ctx)
    expect(isSmooth(building().points[0]!)).toBe(false)
  })

  it('Shift constrains a new anchor to 45 degrees', () => {
    click(200, 200)
    // 10 units of drift over 130 snaps flat.
    click(330, 210, { shiftKey: true })
    expect(building().points[1]!.y).toBeCloseTo(200, 6)
  })

  it('closes the path by clicking the first point', () => {
    click(100, 100)
    click(200, 100)
    click(200, 200)
    click(100, 100)
    expect(committed()!.d).toMatch(/Z\s*$/)
  })

  it('dragging from the first point shapes the closing curve', () => {
    click(100, 100)
    click(200, 100)
    click(200, 200)
    // Press ON the first point and drag: the closing segment becomes a curve.
    penTool.onPointerDown?.(ev(100, 100), ctx)
    penTool.onPointerMove?.(ev(60, 160), ctx)
    penTool.onPointerUp?.(ev(60, 160), ctx)
    const d = committed()!.d
    expect(d).toMatch(/Z\s*$/)
    expect(d).toContain('C')
  })

  it('Escape ends the open path instead of discarding it', () => {
    click(100, 100)
    click(200, 100)
    click(200, 200)
    penTool.onKeyDown?.(key('Escape'), ctx)
    expect(committed()).toBeDefined()
    expect(committed()!.d).not.toMatch(/Z\s*$/)
  })

  it('Backspace removes the last point placed', () => {
    click(100, 100)
    click(200, 100)
    click(200, 200)
    expect(building().points).toHaveLength(3)
    penTool.onKeyDown?.(key('Backspace'), ctx)
    expect(building().points).toHaveLength(2)
  })
})

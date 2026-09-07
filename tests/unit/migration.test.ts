/**
 * Loading documents written by an older build.
 *
 * Triangle and Star used to be their own node types. They are now a polygon
 * with three corners, and a polygon with a star ratio below 1. A saved file must
 * still open, and — the part that is easy to get wrong — must still LOOK the
 * same, which is why the star ratio is converted rather than copied.
 */
import { describe, it, expect } from 'vitest'
import {
  deserializeDocument, FORMAT_NAME, FORMAT_VERSION, migrateLegacyNode, serializeDocument,
} from '@/persistence/FileFormat'
import { polygonStarPoints } from '@/geometry/ShapeGeometry'
import type { DesignNode } from '@/document/types'

/** A document written by the old build, as bytes. */
function legacyFile(layers: unknown[]): Uint8Array {
  const payload = {
    format: FORMAT_NAME,
    version: 1,
    document: {
      id: 'doc', name: 'Legacy', createdAt: 0, modifiedAt: 0,
      settings: { backgroundColor: { r: 255, g: 255, b: 255, a: 1 }, gridSize: 8, showGrid: false, snapToGrid: false, showGuides: true, guides: [] },
    },
    rootId: 'root',
    layers: [
      { id: 'root', type: 'document', name: 'Document', parentId: null, children: layers.map((l) => (l as { id: string }).id),
        visible: true, locked: false, markedForExport: false, metadata: {},
        transform: { x: 0, y: 0, width: 0, height: 0, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0, originX: 0.5, originY: 0.5 } },
      ...layers,
    ],
  }
  return new TextEncoder().encode(JSON.stringify(payload))
}

function legacyShape(over: Record<string, unknown>) {
  return {
    id: 'n1', name: 'Shape', parentId: 'root', visible: true, locked: false,
    markedForExport: false, metadata: {},
    transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0, originX: 0.5, originY: 0.5 },
    style: {
      fill: { type: 'solid', color: { r: 217, g: 217, b: 217, a: 1 } },
      stroke: { paint: { type: 'none' }, width: 1, align: 'center', cap: 'butt', join: 'miter', miterLimit: 4, dashArray: [], dashOffset: 0 },
      opacity: 1, fillOpacity: 1, blendMode: 'normal', shadow: null, blur: null,
    },
    ...over,
  }
}

describe('legacy shape migration', () => {
  it('turns a triangle into a three-corner polygon', () => {
    const doc = deserializeDocument(legacyFile([legacyShape({ type: 'triangle', cornerRadius: 4 })]))
    const node = doc.nodes.n1!
    expect(node.type).toBe('polygon')
    if (node.type !== 'polygon') return
    expect(node.sides).toBe(3)
    expect(node.starRatio).toBe(1)
    expect(node.cornerRadius).toBe(4)
  })

  it('converts a star ratio from circumradius to apothem, so it keeps its shape', () => {
    const node = migrateLegacyNode(
      legacyShape({ type: 'star', points: 5, innerRatio: 0.5 }) as unknown as DesignNode,
    )
    expect(node.type).toBe('polygon')
    if (node.type !== 'polygon') return
    expect(node.sides).toBe(5)
    // 0.5 of the circumradius is 0.5 / cos(36 degrees) of the apothem.
    expect(node.starRatio).toBeCloseTo(0.5 / Math.cos(Math.PI / 5), 9)

    // The proof that matters: the star's own proportions are unchanged. Compare
    // against the legacy vertices put through the SAME box-filling normalisation
    // the new generator applies, which isolates the ratio conversion from the
    // separate (and intended) change that shapes now fill their frame.
    const before = fillBox(starPointsLegacy(100, 100, 5, 0.5))
    const after = polygonStarPoints(100, 100, node.sides, node.starRatio)
    expect(after).toHaveLength(before.length)
    for (let i = 0; i < before.length; i++) {
      expect(after[i]!.x).toBeCloseTo(before[i]!.x, 6)
      expect(after[i]!.y).toBeCloseTo(before[i]!.y, 6)
    }
  })

  it('drops the dead keys instead of carrying them into the next save', () => {
    const node = migrateLegacyNode(
      legacyShape({ type: 'star', points: 6, innerRatio: 0.3 }) as unknown as DesignNode,
    )
    expect('points' in node).toBe(false)
    expect('innerRatio' in node).toBe(false)
  })

  it('keeps the layer name the user last saw', () => {
    const node = migrateLegacyNode(
      legacyShape({ type: 'star', name: 'My Star', points: 5, innerRatio: 0.5 }) as unknown as DesignNode,
    )
    expect(node.name).toBe('My Star')
  })

  it('gives a legacy polygon a full star ratio', () => {
    const doc = deserializeDocument(legacyFile([legacyShape({ type: 'polygon', sides: 8, cornerRadius: 0 })]))
    const node = doc.nodes.n1!
    expect(node.type).toBe('polygon')
    if (node.type !== 'polygon') return
    expect(node.sides).toBe(8)
    expect(node.starRatio).toBe(1)
  })

  it('refuses a file from a newer build rather than silently mangling it', () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ format: FORMAT_NAME, version: FORMAT_VERSION + 1, layers: [] }),
    )
    expect(() => deserializeDocument(bytes)).toThrow()
  })
})

/** The old star generator, verbatim, as the oracle for the conversion. */
function starPointsLegacy(width: number, height: number, points: number, innerRatio: number) {
  const n = Math.max(3, Math.round(points))
  const ratio = Math.min(1, Math.max(0.01, innerRatio))
  const rx = width / 2
  const ry = height / 2
  const out: Array<{ x: number; y: number }> = []
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n
    const f = i % 2 === 0 ? 1 : ratio
    out.push({ x: rx + rx * f * Math.cos(a), y: ry + ry * f * Math.sin(a) })
  }
  return out
}

/** Scale a legacy point set so its OUTER ring spans the box, as the new one does. */
function fillBox(pts: Array<{ x: number; y: number }>) {
  const outer = pts.filter((_, i) => i % 2 === 0)
  const minX = Math.min(...outer.map((p) => p.x))
  const maxX = Math.max(...outer.map((p) => p.x))
  const minY = Math.min(...outer.map((p) => p.y))
  const maxY = Math.max(...outer.map((p) => p.y))
  return pts.map((p) => ({
    x: ((p.x - minX) / (maxX - minX)) * 100,
    y: ((p.y - minY) / (maxY - minY)) * 100,
  }))
}

// --------------------------------------------------- guides moved to artboards --

/** A version-2 document: guides still on the document, artboards as nodes. */
function v2File(guides: unknown[], boards: Array<{ id: string; x: number; width: number }>) {
  const artboard = (b: { id: string; x: number; width: number }) => ({
    id: b.id, type: 'artboard', name: b.id, parentId: 'root', children: [],
    visible: true, locked: false, markedForExport: false, metadata: {},
    background: { type: 'solid', color: { r: 255, g: 255, b: 255, a: 1 } },
    clipContent: true,
    transform: {
      x: b.x, y: 0, width: b.width, height: 400, rotation: 0,
      scaleX: 1, scaleY: 1, skewX: 0, skewY: 0, originX: 0.5, originY: 0.5,
    },
  })
  const payload = {
    format: FORMAT_NAME,
    version: 2,
    document: { id: 'doc', name: 'V2', createdAt: 0, modifiedAt: 0, settings: {}, guides },
    rootId: 'root',
    layers: [
      {
        id: 'root', type: 'document', name: 'Document', parentId: null,
        children: boards.map((b) => b.id),
        visible: true, locked: false, markedForExport: false, metadata: {},
        transform: { x: 0, y: 0, width: 0, height: 0, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0, originX: 0.5, originY: 0.5 },
      },
      ...boards.map(artboard),
    ],
  }
  return new TextEncoder().encode(JSON.stringify(payload))
}

const guidesOn = (doc: ReturnType<typeof deserializeDocument>, id: string) => {
  const n = doc.nodes[id]
  return n?.type === 'artboard' ? (n.guides ?? []) : []
}

describe('guides move onto their artboard', () => {
  it('lands a document guide on the artboard it crossed, in local units', () => {
    const doc = deserializeDocument(
      v2File([{ id: 'g1', axis: 'x', position: 1300 }], [{ id: 'ab', x: 1200, width: 400 }]),
    )
    expect(guidesOn(doc, 'ab')).toEqual([{ id: 'g1', axis: 'x', position: 100 }])
    expect(doc).not.toHaveProperty('guides')
  })

  it('the TOPMOST artboard claims an overlapping guide', () => {
    // Paint order, so the later one is on top — the same one a click resolves
    // to. Taking the first match would hand it to whatever was underneath.
    const doc = deserializeDocument(
      v2File([{ id: 'g1', axis: 'x', position: 250 }], [
        { id: 'under', x: 0, width: 400 },
        { id: 'over', x: 200, width: 400 },
      ]),
    )
    expect(guidesOn(doc, 'over')).toHaveLength(1)
    expect(guidesOn(doc, 'under')).toHaveLength(0)
  })

  it('a guide crossing no artboard is dropped, not kept homeless', () => {
    const doc = deserializeDocument(
      v2File([{ id: 'g1', axis: 'x', position: 9000 }], [{ id: 'ab', x: 0, width: 400 }]),
    )
    expect(guidesOn(doc, 'ab')).toHaveLength(0)
  })

  it('migrating twice changes nothing the second time', () => {
    const once = deserializeDocument(
      v2File([{ id: 'g1', axis: 'x', position: 100 }], [{ id: 'ab', x: 0, width: 400 }]),
    )
    const twice = deserializeDocument(serializeDocument(once))
    expect(guidesOn(twice, 'ab')).toEqual(guidesOn(once, 'ab'))
  })

  it('still refuses a file from a newer build', () => {
    const bytes = v2File([], [{ id: 'ab', x: 0, width: 400 }])
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as { version: number }
    payload.version = FORMAT_VERSION + 1
    expect(() => deserializeDocument(new TextEncoder().encode(JSON.stringify(payload)))).toThrow()
  })
})

describe('what comes off disk is not trusted', () => {
  const withArtboardFields = (fields: Record<string, unknown>) => {
    const bytes = v2File([], [{ id: 'ab', x: 0, width: 400 }])
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as {
      layers: Array<Record<string, unknown>>
    }
    Object.assign(payload.layers[1]!, fields)
    return deserializeDocument(new TextEncoder().encode(JSON.stringify(payload)))
  }

  it('keeps the good guides and drops the rest', () => {
    const doc = withArtboardFields({
      guides: [
        { id: 'ok', axis: 'x', position: 10 },
        { axis: 'y', position: 5 },
        null,
        { id: 'bad-axis', axis: 'z', position: 1 },
        { id: 'nan', axis: 'x', position: 'over there' },
      ],
    })
    expect(guidesOn(doc, 'ab')).toEqual([{ id: 'ok', axis: 'x', position: 10 }])
  })

  it('drops a half-formed grid whole rather than painting NaN', () => {
    const board = (g: unknown) => withArtboardFields({ grid: g }).nodes.ab as { grid?: unknown }
    expect(board({ type: 'square', size: 'big', visible: true, color: { r: 0, g: 0, b: 0, a: 1 } }).grid).toBeUndefined()
    expect(board({ type: 'square', size: 8, visible: true }).grid).toBeUndefined()
    expect(board({ type: 'nonsense' }).grid).toBeUndefined()
    expect(board('grid').grid).toBeUndefined()
    // And a well-formed one still loads, so the check is not just refusing.
    expect(board({ type: 'square', size: 8, visible: true, color: { r: 0, g: 0, b: 0, a: 0.2 } }).grid)
      .toEqual({ type: 'square', size: 8, visible: true, color: { r: 0, g: 0, b: 0, a: 0.2 } })
  })
})

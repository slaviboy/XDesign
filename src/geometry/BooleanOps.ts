/**
 * Boolean path operations: union, subtract, intersect, exclude.
 *
 * Two implementations, and the distinction is a real quality difference the user
 * can see:
 *
 *   PRIMARY  paper.js in a worker. Does true curve-curve intersection, so a
 *            union of two circles is still made of arcs afterwards.
 *   FALLBACK polyclip-ts over flattened polylines, used only when the worker is
 *            unavailable or paper returns something degenerate. Curves become
 *            line segments — correct in outline, but no longer smooth if the
 *            result is later scaled up. The caller is told when this happens.
 *
 * Paths must be transformed into a common space before they get here; the
 * caller does that with each node's world matrix.
 */

import { pathToPolylines, type FillRule } from './PathUtils'
import type { BooleanRequest, BooleanResponse } from '../workers/boolean.worker'

export type BooleanOperation = 'union' | 'subtract' | 'intersect' | 'exclude'

export interface BooleanResult {
  d: string
  /** True when curves were flattened to line segments by the fallback. */
  approximated: boolean
}

let worker: Worker | null = null
let workerBroken = false
let nextId = 1
const pending = new Map<number, (r: BooleanResponse) => void>()

function getWorker(): Worker | null {
  if (workerBroken) return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('../workers/boolean.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (event: MessageEvent<BooleanResponse>) => {
      const resolve = pending.get(event.data.id)
      if (resolve) {
        pending.delete(event.data.id)
        resolve(event.data)
      }
    }
    worker.onerror = () => {
      // One failure is enough — stop trying and use the fallback from here on.
      workerBroken = true
      for (const [id, resolve] of pending) {
        resolve({ id, ok: false, error: 'worker failed' })
      }
      pending.clear()
      worker?.terminate()
      worker = null
    }
    return worker
  } catch {
    workerBroken = true
    return null
  }
}

/** A pathological input must not hang the operation forever. */
const WORKER_TIMEOUT_MS = 8000

export async function booleanOp(
  op: BooleanOperation,
  paths: readonly string[],
  fillRule: FillRule = 'nonzero',
): Promise<BooleanResult | null> {
  if (paths.length < 2) return null

  const w = getWorker()
  if (w) {
    const id = nextId++
    const request: BooleanRequest = { id, op, paths: [...paths], fillRule }

    const response = await new Promise<BooleanResponse>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        resolve({ id, ok: false, error: 'timed out' })
      }, WORKER_TIMEOUT_MS)

      pending.set(id, (r) => {
        clearTimeout(timer)
        resolve(r)
      })
      w.postMessage(request)
    })

    if (response.ok) return { d: response.d, approximated: false }
  }

  const fallback = await booleanFallback(op, paths, fillRule)
  return fallback ? { d: fallback, approximated: true } : null
}

// ---------------------------------------------------------------------------
// Polygon fallback
// ---------------------------------------------------------------------------

type Ring = Array<[number, number]>
type Poly = Ring[]
type MultiPoly = Poly[]

/**
 * Flatten to polygons and clip. Only reached when paper is unavailable.
 * Flattening tolerance is deliberately tight — the result is permanent.
 */
async function booleanFallback(
  op: BooleanOperation,
  paths: readonly string[],
  fillRule: FillRule,
): Promise<string | null> {
  try {
    const polyclip = await import('polyclip-ts')
    const geoms = paths.map((d) => pathToMultiPolygon(d)).filter((g) => g.length > 0)
    if (geoms.length < 2) return null

    const [first, ...rest] = geoms as [MultiPoly, ...MultiPoly[]]
    let result: MultiPoly
    switch (op) {
      case 'union':
        result = polyclip.union(first as never, ...(rest as never[])) as unknown as MultiPoly
        break
      case 'subtract':
        result = polyclip.difference(first as never, ...(rest as never[])) as unknown as MultiPoly
        break
      case 'intersect':
        result = polyclip.intersection(first as never, ...(rest as never[])) as unknown as MultiPoly
        break
      case 'exclude':
        result = polyclip.xor(first as never, ...(rest as never[])) as unknown as MultiPoly
        break
    }
    void fillRule
    return multiPolygonToPath(result)
  } catch {
    return null
  }
}

function pathToMultiPolygon(d: string): MultiPoly {
  const polylines = pathToPolylines(d, 0.15)
  const rings: Ring[] = []
  for (const line of polylines) {
    if (line.points.length < 3) continue
    const ring: Ring = line.points.map((p) => [p.x, p.y] as [number, number])
    // polyclip expects explicitly closed rings.
    const first = ring[0]!
    const last = ring[ring.length - 1]!
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]])
    rings.push(ring)
  }
  if (rings.length === 0) return []
  // First ring is the outer boundary, the rest are treated as holes.
  return [rings]
}

function multiPolygonToPath(multi: MultiPoly): string {
  const parts: string[] = []
  for (const poly of multi) {
    for (const ring of poly) {
      if (ring.length < 3) continue
      const head = `M${round(ring[0]![0])} ${round(ring[0]![1])}`
      const body = ring.slice(1).map((p) => `L${round(p[0])} ${round(p[1])}`).join(' ')
      parts.push(`${head} ${body} Z`)
    }
  }
  return parts.join(' ')
}

function round(n: number): number {
  const r = Math.round(n * 10000) / 10000
  return Object.is(r, -0) ? 0 : r
}

/** Release the worker, e.g. on teardown. */
export function disposeBooleanWorker(): void {
  worker?.terminate()
  worker = null
  pending.clear()
}

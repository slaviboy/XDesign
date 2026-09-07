/**
 * Boolean path operations, off the main thread.
 *
 * paper.js is the only option here that keeps CUBIC FIDELITY. Every polygon
 * clipper — polyclip, martinez, Clipper — requires flattening curves to line
 * segments first, which is irreversible and visibly wrong on anything with a
 * curve in it once you scale the result up.
 *
 * It runs headless: PaperScope#setup -> View.create() branches on
 * `typeof window`, and in a worker there is no window, so the DOM-free base View
 * is used. No canvas element is needed. Paper is imported dynamically so its
 * ~70KB never lands in the main bundle — it loads on the first boolean op and
 * not before.
 *
 * The worker also keeps a heavy op on a complex path from janking the editor.
 */

export interface BooleanRequest {
  id: number
  op: 'union' | 'subtract' | 'intersect' | 'exclude'
  /** Path data, already transformed into a common (world) space. */
  paths: string[]
  fillRule: 'nonzero' | 'evenodd'
}

export type BooleanResponse =
  | { id: number; ok: true; d: string }
  | { id: number; ok: false; error: string }

type PathItem = {
  unite(other: PathItem, opts?: { insert?: boolean }): PathItem
  subtract(other: PathItem, opts?: { insert?: boolean }): PathItem
  intersect(other: PathItem, opts?: { insert?: boolean }): PathItem
  exclude(other: PathItem, opts?: { insert?: boolean }): PathItem
  pathData: string
  fillRule: string
  remove(): void
}

interface PaperModule {
  setup(size: unknown): void
  Size: new (w: number, h: number) => unknown
  PathItem: { create(d: string): PathItem }
  project?: { clear(): void }
}

let paperPromise: Promise<PaperModule> | null = null

async function getPaper(): Promise<PaperModule> {
  if (!paperPromise) {
    paperPromise = import('paper').then((mod) => {
      const paper = ((mod as unknown as { default?: PaperModule }).default ??
        mod) as unknown as PaperModule
      // Headless setup: no canvas, no DOM.
      paper.setup(new paper.Size(1, 1))
      return paper
    })
  }
  return paperPromise
}

function isUsable(d: string): boolean {
  if (!d || !d.trim()) return false
  // Guard against paper emitting NaN coordinates on a degenerate input.
  return !/(NaN|Infinity)/.test(d)
}

async function run(request: BooleanRequest): Promise<BooleanResponse> {
  const { id, op, paths, fillRule } = request
  if (paths.length < 2) {
    return { id, ok: false, error: 'At least two shapes are required.' }
  }

  try {
    const paper = await getPaper()
    const items = paths.map((d) => {
      const item = paper.PathItem.create(d)
      item.fillRule = fillRule
      return item
    })

    let result = items[0]!
    for (let i = 1; i < items.length; i++) {
      const other = items[i]!
      switch (op) {
        case 'union': result = result.unite(other, { insert: false }); break
        case 'subtract': result = result.subtract(other, { insert: false }); break
        case 'intersect': result = result.intersect(other, { insert: false }); break
        case 'exclude': result = result.exclude(other, { insert: false }); break
      }
    }

    const d = result.pathData
    // Clear the project so repeated ops do not accumulate items.
    try { paper.project?.clear() } catch { /* nothing to clear */ }

    if (!isUsable(d)) {
      return { id, ok: false, error: 'The operation produced an empty or invalid result.' }
    }
    return { id, ok: true, d }
  } catch (error) {
    return {
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'Boolean operation failed.',
    }
  }
}

self.onmessage = (event: MessageEvent<BooleanRequest>) => {
  void run(event.data).then((response) => {
    ;(self as unknown as Worker).postMessage(response)
  })
}

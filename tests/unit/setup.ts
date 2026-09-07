// Unit tests run in plain node by default (see vitest.config.ts). Suites that
// genuinely need a DOM opt in per-file with `// @vitest-environment happy-dom`.
//
// rAF is a scheduling primitive, not a geometry API, so polyfilling it lets the
// drag pipeline be exercised end-to-end in node. Nothing here fakes measurement:
// geometry stays pure TS precisely so it needs no such stubs.
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id as unknown as ReturnType<typeof setTimeout>)) as typeof cancelAnimationFrame
}
export {}

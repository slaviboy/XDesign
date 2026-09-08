/**
 * Fonts available to the editor.
 *
 * Two sources, both fully offline:
 *
 *  - Bundled open-source Google fonts, self-hosted via @fontsource and declared
 *    in styles/fonts.css. Nothing is fetched from a CDN, ever.
 *  - Fonts already installed on the user's machine, offered as a second group.
 *
 * The distinction matters at export time and the export dialog says so: a
 * bundled font's bytes are ours, so text using one can be embedded or converted
 * to outlines and will render identically anywhere. A system font's file is not
 * readable by the page, so exported SVG can only reference it by name and will
 * substitute on a machine that lacks it.
 */

import generated from './fonts.generated.json'

export type FontCategory = 'sans' | 'serif' | 'mono' | 'display' | 'system'

export interface FontFamilyInfo {
  family: string
  category: FontCategory
  /** Weights with a real face; others are synthesized by the browser. */
  weights: number[]
  italics: number[]
  /** True when we ship the font file and can outline or embed it on export. */
  bundled: boolean
}

interface GeneratedEntry {
  pkg: string
  family: string
  category: string
  weights: number[]
  italics: number[]
}

export const BUNDLED_FONTS: FontFamilyInfo[] = (generated as GeneratedEntry[]).map((f) => ({
  family: f.family,
  category: f.category as FontCategory,
  weights: f.weights,
  italics: f.italics,
  bundled: true,
}))

/**
 * Fonts that ship with the operating system. These render correctly inside an
 * SVG-in-<img> during raster export (the OS resolves them by name), but cannot
 * be embedded or outlined because the page cannot read the font file.
 */
export const SYSTEM_FONTS: FontFamilyInfo[] = [
  'Arial', 'Helvetica', 'Helvetica Neue', 'Times New Roman', 'Georgia', 'Garamond',
  'Courier New', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Impact', 'Palatino',
  'Menlo', 'Monaco', 'Consolas', 'system-ui',
].map((family) => ({
  family,
  category: 'system' as FontCategory,
  weights: [300, 400, 500, 600, 700],
  italics: [400, 700],
  bundled: false,
}))

export const ALL_FONTS: FontFamilyInfo[] = [...BUNDLED_FONTS, ...SYSTEM_FONTS]

const BY_FAMILY = new Map(ALL_FONTS.map((f) => [f.family.toLowerCase(), f]))

export function getFontInfo(family: string): FontFamilyInfo | undefined {
  return BY_FAMILY.get(family.toLowerCase())
}

export function isBundledFont(family: string): boolean {
  return getFontInfo(family)?.bundled ?? false
}

/** A CSS font stack with sensible fallbacks, so a missing font never renders blank. */
export function fontStack(family: string): string {
  const info = getFontInfo(family)
  const quoted = /\s/.test(family) ? `"${family}"` : family
  switch (info?.category) {
    case 'serif': return `${quoted}, Georgia, "Times New Roman", serif`
    case 'mono': return `${quoted}, Menlo, Consolas, monospace`
    case 'display': return `${quoted}, Impact, sans-serif`
    default: return `${quoted}, "Helvetica Neue", Arial, sans-serif`
  }
}

/** Nearest available real weight, so the UI does not offer faces that do not exist. */
export function nearestWeight(family: string, weight: number, italic = false): number {
  const info = getFontInfo(family)
  if (!info) return weight
  const list = italic && info.italics.length ? info.italics : info.weights
  if (list.includes(weight)) return weight
  return list.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), list[0] ?? 400)
}

const loaded = new Set<string>()

/**
 * Ensure a face is actually rasterizable before we measure or export it.
 *
 * Measuring before the face loads yields metrics for the *fallback* font, which
 * is how text boxes end up the wrong size until the user nudges them. Every
 * measurement path awaits this first.
 */
export async function ensureFontLoaded(
  family: string,
  weight = 400,
  italic = false,
): Promise<boolean> {
  const key = `${family}|${weight}|${italic ? 'i' : 'n'}`
  if (loaded.has(key)) return true
  if (typeof document === 'undefined' || !('fonts' in document)) return false

  const spec = `${italic ? 'italic ' : ''}${weight} 16px ${JSON.stringify(family)}`
  try {
    await document.fonts.load(spec, 'AaBbGg0123')
    await document.fonts.ready
    loaded.add(key)
    const ok = document.fonts.check(spec)
    if (ok) emitFontsChanged()
    return ok
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Knowing when a face has actually arrived
// ---------------------------------------------------------------------------

/**
 * A face is fetched the first time something asks to draw it, which is AFTER
 * the layout that asked for it has already been measured. Until it lands,
 * measureText answers with the fallback — usually a narrower one — so the lines
 * come out packed too full, and then the real glyphs arrive and overflow the
 * box they were fitted to. Switching a text object to Thin put 408 units of
 * text inside a 400-unit box that way.
 *
 * Nothing re-renders on its own when that happens: no prop changed, so React
 * has no reason to. Hence this signal. Everything that measures text subscribes
 * to it and measures again once the face is real, which is also what makes a
 * weight change look immediate instead of arriving a beat late.
 */
let fontsVersionCounter = 0
const fontListeners = new Set<() => void>()
let watchingFontLoading = false

export function fontsVersion(): number {
  return fontsVersionCounter
}

export function subscribeFonts(fn: () => void): () => void {
  watchFontLoading()
  fontListeners.add(fn)
  return () => fontListeners.delete(fn)
}

function emitFontsChanged(): void {
  fontsVersionCounter++
  for (const fn of fontListeners) fn()
}

/**
 * Most faces are never requested through ensureFontLoaded at all — the browser
 * fetches them itself the moment a <text> element first uses one. `loadingdone`
 * is the only event that covers those, so it is the signal that matters most.
 */
function watchFontLoading(): void {
  if (watchingFontLoading) return
  if (typeof document === 'undefined' || !('fonts' in document)) return
  watchingFontLoading = true
  document.fonts.addEventListener('loadingdone', emitFontsChanged)
}

/**
 * Every face of one family, which is exactly the set the Text panel can switch
 * between.
 *
 * Loading them the moment a text object is selected costs about 6ms for a whole
 * family and makes Bold, Italic and Thin take effect on the click rather than a
 * beat after it — the beat being the browser fetching a face it has never
 * needed before.
 */
export async function preloadFamily(family: string): Promise<void> {
  const info = getFontInfo(family)
  if (!info || !info.bundled) return
  await preloadFontsFor([
    ...info.weights.map((weight) => ({ family, weight, italic: false })),
    ...info.italics.map((weight) => ({ family, weight, italic: true })),
  ])
}

/** Preload the faces a document actually uses. Called after open/import. */
export async function preloadFontsFor(
  faces: Iterable<{ family: string; weight: number; italic: boolean }>,
): Promise<void> {
  const seen = new Set<string>()
  const jobs: Promise<unknown>[] = []
  for (const f of faces) {
    const key = `${f.family}|${f.weight}|${f.italic}`
    if (seen.has(key)) continue
    seen.add(key)
    jobs.push(ensureFontLoaded(f.family, f.weight, f.italic))
  }
  await Promise.all(jobs)
}

export const DEFAULT_FONT_FAMILY = 'Inter'

/** Grouped for the font picker. */
export function fontsByCategory(): Array<{ label: string; fonts: FontFamilyInfo[] }> {
  const groups: Array<[string, FontCategory[]]> = [
    ['Sans Serif', ['sans']],
    ['Serif', ['serif']],
    ['Monospace', ['mono']],
    ['Display', ['display']],
    ['System', ['system']],
  ]
  return groups
    .map(([label, cats]) => ({
      label,
      fonts: ALL_FONTS.filter((f) => cats.includes(f.category)).sort((a, b) =>
        a.family.localeCompare(b.family),
      ),
    }))
    .filter((g) => g.fonts.length > 0)
}

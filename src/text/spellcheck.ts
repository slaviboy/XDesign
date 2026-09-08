/**
 * Spell check.
 *
 * Two dictionaries at a time, as asked: English plus whatever the interface is
 * set to. A word found in either is accepted, which is what stops an English
 * product name in German copy lighting up.
 *
 * The dictionaries are BINARY SEARCHED over the decompressed text rather than
 * loaded into a Set. German alone is 1.7 million words; as a Set of strings
 * that is a couple of hundred megabytes of heap, while as one sorted string it
 * is the 27 MB the text already occupies and a lookup is a dozen comparisons.
 *
 * They are fetched from the app's own origin and gzipped, so the whole thing
 * works offline once the service worker has them — no third-party request ever.
 */

import { getLanguage, subscribeLanguage, type LanguageCode } from '../i18n'

/**
 * The languages a word list can actually check.
 *
 * Bulgarian's source list holds 2,697 words against a real vocabulary of
 * hundreds of thousands, so it would report nearly every correct word as wrong.
 * Chinese and Japanese put no spaces between words, so there is nothing to
 * tokenise — that needs a segmenter, not a dictionary.
 */
export const SPELLCHECK_LANGUAGES: readonly LanguageCode[] = ['en', 'de', 'es', 'fr', 'pt']

export function canSpellCheck(code: LanguageCode): boolean {
  return SPELLCHECK_LANGUAGES.includes(code)
}

export const SPELLCHECK_STORAGE_KEY = 'xdesign.spellCheck'

const loaded = new Map<LanguageCode, Dictionary>()
const loading = new Map<LanguageCode, Promise<void>>()
const listeners = new Set<() => void>()
let enabled = readStoredEnabled()

function readStoredEnabled(): boolean {
  try {
    // On by default, like every editor that has it.
    return localStorage.getItem(SPELLCHECK_STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function isSpellCheckEnabled(): boolean {
  return enabled
}

export function setSpellCheckEnabled(on: boolean): void {
  if (on === enabled) return
  enabled = on
  try {
    localStorage.setItem(SPELLCHECK_STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    // The choice still applies for this session.
  }
  if (on) void ensureDictionaries()
  emit()
}

/** Notifies when a dictionary arrives, so what is on screen can be re-checked. */
export function subscribeSpellCheck(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit(): void {
  for (const fn of listeners) fn()
}

/** The two dictionaries in play: English, and the interface language. */
export function activeLanguages(): LanguageCode[] {
  const current = getLanguage()
  const codes: LanguageCode[] = ['en']
  if (current !== 'en' && canSpellCheck(current)) codes.push(current)
  return codes
}

/**
 * Fetch whatever is missing. Safe to call repeatedly — each language is fetched
 * at most once, and a failure is not retried in a loop.
 */
export async function ensureDictionaries(): Promise<void> {
  if (!enabled) return
  await Promise.all(activeLanguages().map((code) => load(code)))
}

function load(code: LanguageCode): Promise<void> {
  if (loaded.has(code)) return Promise.resolve()
  const inFlight = loading.get(code)
  if (inFlight) return inFlight

  const task = (async () => {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}dictionaries/${code}.txt.gz`)
      if (!response.ok) throw new Error(String(response.status))
      loaded.set(code, indexLines(await readMaybeGzipped(response)))
      emit()
    } catch {
      // No dictionary means no squiggles, which is the right way to fail: a
      // checker that cannot load its words must not call everything wrong.
      loaded.set(code, indexLines(''))
    } finally {
      loading.delete(code)
    }
  })()
  loading.set(code, task)
  return task
}

/**
 * Read a .gz that the server may already have unpacked for us.
 *
 * Most static hosts see the extension and serve it with `Content-Encoding:
 * gzip`, which makes the browser decompress it transparently — so piping it
 * through DecompressionStream would be gunzipping plain text, which throws.
 * Some hosts do not. Sniffing the two magic bytes settles it either way, and
 * costs one read of the first chunk.
 */
async function readMaybeGzipped(response: Response): Promise<string> {
  const buffer = await response.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const gzipped = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
  if (!gzipped) return new TextDecoder().decode(bytes)

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

/** True once at least one dictionary is in memory. */
export function isReady(): boolean {
  return activeLanguages().some((code) => (loaded.get(code)?.starts.length ?? 0) > 0)
}

/**
 * Is this word absent from every active dictionary?
 *
 * Numbers, single letters and anything that is not a word are never reported:
 * a spell checker that underlines "3.5" or an em dash is noise.
 */
export function isMisspelled(word: string): boolean {
  if (!enabled || !isReady()) return false
  const normalised = normalise(word)
  if (!normalised) return false
  return !activeLanguages().some((code) => {
    const dictionary = loaded.get(code)
    return !!dictionary && contains(dictionary, normalised)
  })
}

/** Lower-case, and strip the punctuation that clings to a word in a sentence. */
export function normalise(word: string): string {
  const trimmed = word
    .replace(/^[^\p{L}\p{M}]+/u, '')
    .replace(/[^\p{L}\p{M}]+$/u, '')
    .toLocaleLowerCase()
  if (trimmed.length < 2) return ''
  // A digit anywhere means a code or a measurement, not a word.
  if (/\p{N}/u.test(trimmed)) return ''
  if (!/^[\p{L}\p{M}][\p{L}\p{M}'’-]*$/u.test(trimmed)) return ''
  return trimmed
}

/**
 * A loaded dictionary: the text, plus where each line starts.
 *
 * The offsets are what make the search obviously correct. Bisecting the raw
 * string means every probe has to be widened to a line boundary, and a boundary
 * can fall outside the range being searched — which silently ends the search
 * early on a word that is present. Indexing the line starts once turns it into
 * an ordinary binary search over an array.
 *
 * The cost is four bytes per word: 1.9 MB for English, 6.8 MB for German. A Set
 * of the same words is thirty times that.
 */
interface Dictionary {
  text: string
  starts: Int32Array
}

function indexLines(text: string): Dictionary {
  if (!text) return { text: '', starts: new Int32Array(0) }
  const starts: number[] = [0]
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
    if (i + 1 < text.length) starts.push(i + 1)
  }
  return { text, starts: Int32Array.from(starts) }
}

/**
 * Binary search a sorted dictionary.
 *
 * Comparison is UTF-16 code-unit order, which is exactly the order the build
 * script sorted the file in — the two agree by construction, and sorting it any
 * other way would break every lookup past the first divergence.
 */
export function contains(dictionary: Dictionary, word: string): boolean {
  const { text, starts } = dictionary
  let lo = 0
  let hi = starts.length - 1

  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const start = starts[mid]!
    const end = mid + 1 < starts.length ? starts[mid + 1]! - 1 : text.length
    const line = text.slice(start, end)
    if (line === word) return true
    if (line < word) lo = mid + 1
    else hi = mid - 1
  }
  return false
}

/** Exposed for tests: build a searchable dictionary from sorted lines. */
export function buildDictionary(text: string): Dictionary {
  return indexLines(text)
}

// The interface language is half of the pair, so changing it changes what is
// checked against.
subscribeLanguage(() => {
  void ensureDictionaries()
  emit()
})

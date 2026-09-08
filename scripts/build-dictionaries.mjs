/*
 * Copyright (C) 2026 Stanislav Georgiev
 * https://github.com/slaviboy
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Builds the spell-check dictionaries.
 *
 * Source: github.com/eymenefealtun/all-words-in-all-languages, one
 * comma-separated file per language. Run by hand, not in the build — the result
 * is committed, because the app must work with no network and cannot fetch a
 * dictionary the first time someone opens it offline.
 *
 *   node scripts/build-dictionaries.mjs
 *
 * What it does to each list, and why:
 *  - lower-cases, which collapses the capitalised duplicates the source is full
 *    of ("Abbey" and "abbey") and lets the checker be case-insensitive;
 *  - drops anything containing a digit or punctuation other than an apostrophe
 *    or hyphen, which removes the abbreviations and codes;
 *  - drops single characters, which are never misspellings worth flagging and
 *    are most of what is left after the above;
 *  - sorts and de-duplicates, which is what makes the file compress well.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

/**
 * Only the languages a word list can actually check.
 *
 * Bulgarian is in the source but holds 2,697 words, where a real vocabulary
 * runs to hundreds of thousands — it would flag nearly every correctly spelled
 * word, which is worse than not checking at all.
 *
 * Chinese and Japanese are excluded for a different reason: neither separates
 * words with spaces, so there is nothing for a word-list checker to tokenise.
 * Doing that properly needs a morphological segmenter, not a bigger list.
 */
const LANGUAGES = {
  en: 'English',
  de: 'German',
  es: 'Spanish',
  fr: 'French',
  pt: 'Portuguese',
}

const BASE = 'https://raw.githubusercontent.com/eymenefealtun/all-words-in-all-languages/main'
const OUT = join(process.cwd(), 'public', 'dictionaries')

/** Letters, marks, apostrophes and hyphens. Everything else is not a word. */
const WORD = /^[\p{L}\p{M}][\p{L}\p{M}'’-]*$/u

async function build(code, folder) {
  const url = `${BASE}/${folder}/${folder}.txt`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${folder}: HTTP ${response.status}`)
  const raw = await response.text()

  const words = new Set()
  for (const token of raw.split(/[,\r\n]+/)) {
    const word = token.trim().toLocaleLowerCase()
    if (word.length < 2 || !WORD.test(word)) continue
    words.add(word)
  }

  // Sorted, because the app binary-searches the file rather than building a
  // Set of two million strings — see spellcheck.ts.
  const sorted = [...words].sort()
  const text = sorted.join('\n')
  // Gzipped: 58 MB of word lists becomes 12, and DecompressionStream unpacks
  // them in the browser without the server having to negotiate an encoding.
  const packed = gzipSync(Buffer.from(text, 'utf8'), { level: 9 })
  await writeFile(join(OUT, `${code}.txt.gz`), packed)
  return { code, words: sorted.length, bytes: packed.length }
}

await mkdir(OUT, { recursive: true })
for (const [code, folder] of Object.entries(LANGUAGES)) {
  try {
    const r = await build(code, folder)
    console.log(`${r.code}  ${r.words.toLocaleString()} words  ${(r.bytes / 1e6).toFixed(1)} MB`)
  } catch (error) {
    console.error(`${code}: ${(error).message}`)
  }
}

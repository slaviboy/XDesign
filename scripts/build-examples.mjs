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
 * Builds the example documents in examples/.
 *
 *   npm run examples
 *
 * The examples are written in TypeScript against the editor's own modules and
 * built in a real browser, served by Vite — text is measured with the real
 * fonts, pictures are rasterised on a real canvas, and the .xdesign file is
 * written by the same serializer that saves documents in the app. So an example
 * opens exactly as if it had been drawn by hand and saved.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Every example, by folder under examples/. Each one's design.ts exports
 * buildFiles(), which returns its files as base64 keyed by path.
 */
const EXAMPLES = ['shop-app', 'banking', 'music-studio', 'social', 'messaging']

// `npm run examples -- banking social` builds only those.
const wanted = process.argv.slice(2)
const chosen = wanted.length ? EXAMPLES.filter((name) => wanted.includes(name)) : EXAMPLES
if (wanted.length && chosen.length !== wanted.length) {
  throw new Error(`Unknown example: ${wanted.filter((w) => !EXAMPLES.includes(w)).join(', ')}`)
}

const server = await createServer({ root, logLevel: 'error', server: { port: 0 } })
await server.listen()
const url = server.resolvedUrls?.local[0]
if (!url) throw new Error('Vite did not report a local URL.')

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.error('page error:', e.message))
  // A page on the dev server's origin, so the modules and fonts load from it.
  await page.goto(new URL('examples/build.html', url).href)

  for (const name of chosen) {
    const folder = join('examples', name)
    console.log(`Building ${folder}…`)
    const files = await page.evaluate(
      async (module) => (await import(/* @vite-ignore */ module)).buildFiles(),
      `/examples/${name}/design.ts`,
    )
    // What the example wrote before goes first: a screen renamed or removed
    // would otherwise leave its old SVG and preview behind.
    await rm(join(root, folder, 'svg'), { recursive: true, force: true })
    await rm(join(root, folder, 'preview'), { recursive: true, force: true })
    for (const [file, content] of Object.entries(files)) {
      const path = join(root, folder, file)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, Buffer.from(content, 'base64'))
    }
    console.log(`  ${Object.keys(files).length} files`)
  }
} finally {
  await browser.close()
  await server.close()
}

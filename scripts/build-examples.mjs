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

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const EXAMPLES = [
  { folder: 'examples/shop-app', module: '/examples/shop-app/design.ts', build: 'buildShopAppFiles' },
]

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

  for (const example of EXAMPLES) {
    console.log(`Building ${example.folder}…`)
    const files = await page.evaluate(
      async ({ module, build }) => (await import(/* @vite-ignore */ module))[build](),
      example,
    )
    for (const [name, content] of Object.entries(files)) {
      const path = join(root, example.folder, name)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, Buffer.from(content, 'base64'))
      console.log(`  ${join(example.folder, name)}`)
    }
  }
} finally {
  await browser.close()
  await server.close()
}

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
 * What every example writes, from its finished document.
 *
 *   <fileName>.xdesign       the whole design — File ▸ Open
 *   svg/<screen>.svg         one screen — File ▸ Import, into another document
 *   preview/<screen>.jpg     a picture of one screen
 *   preview/overview.jpg     every screen at once, laid out as on the canvas
 *
 * Previews are JPEG: twenty-odd screens of flat colour and photographs are a
 * fraction of the size that way, and nothing in a preview is ever transparent.
 */

import { serializeDocument } from '@/persistence/FileFormat'
import { exportNodesToSvg } from '@/svg/SvgExporter'
import { runExport } from '@/export/ExportPipeline'
import { createMatrixCache, renderBoundsOfNodes } from '@/document/SceneGraph'
import type { DesignDocument } from '@/document/types'
import { rgba } from './kit'

/** The overview's longest side, in pixels. */
const OVERVIEW_MAX_PX = 3200

function base64Of(buffer: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < buffer.length; i += 0x8000) {
    binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

async function base64(bytes: Uint8Array | Blob): Promise<string> {
  return base64Of(bytes instanceof Blob ? new Uint8Array(await bytes.arrayBuffer()) : bytes)
}

function text64(text: string): string {
  return base64Of(new TextEncoder().encode(text))
}

/** A file name from an artboard's name: "04 Card Details" → "04-card-details". */
export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Every file of an example, as base64 keyed by its path under the example's folder. */
export async function exampleFiles(
  doc: DesignDocument,
  fileName: string,
): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  files[`${fileName}.xdesign`] = await base64(serializeDocument(doc))

  const root = doc.nodes[doc.rootId]
  const boards = root && 'children' in root ? root.children.filter((id) => doc.nodes[id]?.type === 'artboard') : []
  for (const id of boards) {
    const board = doc.nodes[id]!
    const name = slug(board.name)
    const bounds = {
      x: board.transform.x,
      y: board.transform.y,
      width: board.transform.width,
      height: board.transform.height,
    }
    const { svg } = await exportNodesToSvg(doc, [id], { bounds, textHandling: 'reference' })
    files[`svg/${name}.svg`] = text64(svg)
    const jpeg = await runExport(doc, { format: 'jpeg', area: 'artboard', nodeIds: [id], scale: 1, quality: 0.86 })
    files[`preview/${name}.jpg`] = await base64(jpeg.blob)
  }

  const all = renderBoundsOfNodes(doc, boards, createMatrixCache())
  const scale = Math.min(0.5, OVERVIEW_MAX_PX / Math.max(all.width, all.height))
  const overview = await runExport(doc, {
    format: 'jpeg',
    area: 'document',
    nodeIds: boards,
    scale,
    quality: 0.86,
    padding: 80,
    background: rgba('#E9E9F0'),
  })
  files['preview/overview.jpg'] = await base64(overview.blob)
  return files
}

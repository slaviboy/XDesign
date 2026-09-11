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
 * Every picture Relay shows, rasterised once and shared: the cast's faces,
 * the photos people send, group pictures, the two wallpapers and the call
 * frames. None of them has anything to see through — a face fills its square
 * edge to edge — so all are JPEG, at no more than twice the size shown.
 */

import type { DesignDocument, ImageAsset } from '@/document/types'
import { addAsset, rasterize } from '../kit'
import { PEOPLE, person } from '../art/people'
import { sceneSvg, type SceneKind } from '../art/scenes'
import { callBackdropSvg, portraitSvg, sceneTileSvg, videoFrameSvg, wallpaperSvg } from './art'
import { H, W } from './theme'

export interface Assets {
  /** Faces by first name. */
  face: Record<string, ImageAsset>
  wallLight: ImageAsset
  wallDark: ImageAsset
  /** The photo Maya sends of the cabin's view — shown in the chat and its media. */
  cabin: ImageAsset
  /** Every other shared photo, newest first, for the media grid. */
  media: ImageAsset[]
  lisbon: ImageAsset
  family: ImageAsset
  design: ImageAsset
  channels: ImageAsset[]
  backdrop: ImageAsset
  remote: ImageAsset
  self: ImageAsset
  story: ImageAsset
}

/** Faces shown large get more pixels; everyone else is a list-sized face. */
const LARGE_FACES: Record<string, number> = { Jonas: 264, Maya: 224, Lucas: 248 }

export async function loadAssets(doc: DesignDocument): Promise<Assets> {
  const jpeg = async (name: string, svg: string, w: number, h: number) =>
    addAsset(doc, name, await rasterize(svg, w, h, 'image/jpeg'), w, h)
  const scene = (name: string, kind: SceneKind, seed: number, w: number, h: number) => jpeg(name, sceneSvg(kind, seed, w, h), w, h)
  const tile = (name: string, kind: SceneKind, seed: number, size: number) => jpeg(name, sceneTileSvg(kind, seed, size), size, size)

  const faces = await Promise.all(PEOPLE.map(async (p) => {
    const first = p.name.split(' ')[0]!
    const size = LARGE_FACES[first] ?? 112
    return [first, addAsset(doc, `Avatar / ${p.name}`, await rasterize(portraitSvg(p, size), size, size, 'image/jpeg'), size, size)] as const
  }))

  // A thumbnail in the media grid is 129 px across: 258 px covers it at 2×.
  const grid: Array<[string, SceneKind, number]> = [
    ['Photo / Morning Coffee', 'coffee', 3],
    ['Photo / Fika', 'food', 4],
    ['Photo / Forest Walk', 'forest', 2],
    ['Photo / Balcony Flowers', 'flowers', 5],
    ['Photo / Ridge Trail', 'mountains', 6],
    ['Photo / Harbour Evening', 'sunset', 3],
    ['Photo / Archipelago', 'beach', 7],
    ['Photo / Old Town Night', 'city', 2],
    ['Photo / Dunes', 'desert', 3],
    ['Photo / Midsummer Lunch', 'food', 9],
    ['Photo / Still Water', 'lake', 4],
    ['Photo / Summit', 'mountains', 11],
    ['Photo / Pier', 'beach', 12],
    ['Photo / Pines', 'forest', 8],
    ['Photo / Café Corner', 'coffee', 10],
  ]

  const [media, cabin, lisbon, family, design, channels, wallLight, wallDark, backdrop, remote, self, story] = await Promise.all([
    Promise.all(grid.map(([name, kind, seed]) => tile(name, kind, seed, 258))),
    scene('Photo / Cabin Deck View', 'lake', 3, 512, 372),
    tile('Group / Lisbon Trip', 'sunset', 6, 200),
    tile('Group / Family', 'flowers', 2, 112),
    tile('Group / Design Team', 'abstract', 4, 112),
    Promise.all([
      tile('Channel / Nordic Trails', 'aurora', 3, 112),
      tile('Channel / City Bites', 'food', 6, 112),
      tile('Channel / Pixel & Pine', 'abstract', 8, 112),
    ]),
    jpeg('Wallpaper / Light', wallpaperSvg(W, H, false, 2), W * 2, H * 2),
    jpeg('Wallpaper / Dark', wallpaperSvg(W, H, true, 2), W * 2, H * 2),
    jpeg('Call / Backdrop', callBackdropSvg('sunset', 2, W, H), W, H),
    jpeg('Video / Maya', videoFrameSvg(person('Maya'), 'lake', 8, W, H, { size: 620, top: 232, blur: 5, scale: 2 }), W * 2, H * 2),
    jpeg('Video / Me', videoFrameSvg(person('Jonas'), 'city', 6, 112, 168, { size: 200, top: 20, blur: 3, scale: 2 }), 224, 336),
    scene('Status / Maya', 'lake', 9, W * 2, H * 2),
  ])

  return {
    face: Object.fromEntries(faces),
    wallLight, wallDark, cabin, media, lisbon, family, design, channels, backdrop, remote, self, story,
  }
}

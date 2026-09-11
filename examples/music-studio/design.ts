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
 * "Riff Studio" — a music-making studio for iPad in landscape, built as an
 * XDesign document: twenty-six 1194 × 834 artboards, each a different
 * instrument or studio view, under one persistent control bar.
 *
 * The instruments are the heroes, drawn as editable vector artwork: ivory
 * and ebony keys with depth, brushed-metal knobs with value arcs, wood grain
 * as one compound path per panel, chrome drum hoops and lathed bronze
 * cymbals, tolex and grille cloth, glowing pads and LEDs.
 */

import '@/styles/fonts'
import { createDocument } from '@/document/NodeFactory'
import { createSwatchId } from '@/document/ids'
import type { DesignDocument } from '@/document/types'
import { addAsset, gridPosition, loadFonts, rasterize, rgba } from '../kit'
import { sceneSvg, type SceneKind } from '../art/scenes'
import { exampleFiles } from '../output'
import { C, H, Studio, W } from './base'
import { analogSynth, electricPiano, grandPiano, organ, smartPiano, transformPad } from './keys'
import { beatSequencer, drumKit, drumMachine, smartDrums } from './drums'
import { liveLoops, loopBrowser, mixer, songSettings, tracksView } from './timeline'
import { audioRecorder, instrumentBrowser, mySongs, sampler, type Song } from './studio'
import { acousticGuitar, bass, electricGuitar, smartGuitar, smartStrings, stringsEnsemble, zither } from './strings'

export async function buildMusicStudio(): Promise<DesignDocument> {
  await loadFonts({
    Inter: [400, 500, 600, 700],
    'JetBrains Mono': [400, 500, 700],
    'Playfair Display': [500, 700],
    Oswald: [500, 600],
  })

  const doc = createDocument('Riff Studio', false)
  doc.swatches = [C.bg, C.panel, C.amber, C.red, C.lcd, C.keys, C.drums, C.guitar, C.bass, C.synth, C.strings, C.sampler].map((hex) => ({
    id: createSwatchId(),
    color: rgba(hex),
  }))

  // Song artwork: one small JPEG per song, rasterised once.
  const catalogue: Array<[string, string, string, SceneKind, number, number]> = [
    ['Neon Harbor', '3:24', 'Today', 'city', 3, 9],
    ['Late Bus Home', '2:58', 'Yesterday', 'sunset', 5, 7],
    ['Paper Planets', '4:12', 'Sep 7', 'aurora', 2, 11],
    ['Sunday Tape', '3:05', 'Sep 3', 'coffee', 4, 6],
    ['Glass Orchard', '5:41', 'Aug 29', 'flowers', 6, 8],
    ['Coastline Demo', '1:47', 'Aug 22', 'beach', 1, 4],
    ['Midnight Ferns', '3:36', 'Aug 14', 'forest', 7, 10],
    ['Slow Satellite', '6:02', 'Aug 2', 'abstract', 8, 12],
    ['Desert Radio', '2:21', 'Jul 26', 'desert', 9, 5],
  ]
  const songs: Song[] = []
  for (const [title, length, date, kind, seed, tracks] of catalogue) {
    const jpeg = await rasterize(sceneSvg(kind, seed, 206, 206), 206, 206, 'image/jpeg')
    songs.push({ title, length, date, tracks, art: addAsset(doc, `Artwork / ${title}`, jpeg, 206, 206) })
  }

  const screens: Array<[string, (s: Studio) => void]> = [
    ['01 My Songs', (s) => mySongs(s, songs)],
    ['02 Instrument Browser', instrumentBrowser],
    ['03 Grand Piano', grandPiano],
    ['04 Electric Piano', electricPiano],
    ['05 Vintage Organ', organ],
    ['06 Analog Synth', analogSynth],
    ['07 Transform Pad', transformPad],
    ['08 Smart Piano', smartPiano],
    ['09 Drum Kit', drumKit],
    ['10 Drum Machine', drumMachine],
    ['11 Beat Sequencer', beatSequencer],
    ['12 Smart Drums', smartDrums],
    ['13 Acoustic Guitar', acousticGuitar],
    ['14 Smart Guitar', smartGuitar],
    ['15 Electric Guitar', electricGuitar],
    ['16 Bass', bass],
    ['17 Strings Ensemble', stringsEnsemble],
    ['18 Smart Strings', smartStrings],
    ['19 Sampler', sampler],
    ['20 Audio Recorder', audioRecorder],
    ['21 World Zither', zither],
    ['22 Tracks', tracksView],
    ['23 Live Loops', liveLoops],
    ['24 Mixer', mixer],
    ['25 Song Settings', songSettings],
    ['26 Loop Browser', loopBrowser],
  ]
  screens.forEach(([name, draw], i) => {
    const { x, y } = gridPosition(i, 4, W, H)
    draw(new Studio(doc, name, x, y))
  })
  return doc
}

export async function buildFiles(): Promise<Record<string, string>> {
  return exampleFiles(await buildMusicStudio(), 'Riff Studio')
}

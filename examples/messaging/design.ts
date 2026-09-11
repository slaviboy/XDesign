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
 * "Relay" — a private messaging app, built as an XDesign document.
 *
 * Nineteen 390 × 844 screens, six to a row: signing up, the chat list, a
 * one-to-one chat in light and dark, a group with a poll, a file and a
 * location, typing with the keyboard up, contact and group info, shared
 * media, calls, an incoming and a video call, updates and a status, a new
 * chat and settings.
 *
 * Every component is a named group, every label real text in a bundled font,
 * every icon an editable stroked path, bubbles and their tails are paths, and
 * the photos, faces and the doodle wallpaper are image layers on JPEG and PNG
 * assets rasterised once and shared.
 */

import '@/styles/fonts'
import { createDocument } from '@/document/NodeFactory'
import { createSwatchId } from '@/document/ids'
import type { DesignDocument } from '@/document/types'
import { gridPosition, loadFonts, rgba } from '../kit'
import { exampleFiles } from '../output'
import { loadAssets, type Assets } from './assets'
import { chatsList, emmaChat, lisbonChat, mayaDark, mayaLight } from './chats'
import {
  calls, contactInfo, groupInfo, incomingCall, mediaGrid, newChat, settings, statusViewer, updates, videoCall,
} from './more'
import { phoneNumber, profile, verify, welcome } from './onboarding'
import { Board, C, H, W } from './theme'

type Draw = (s: Board, a: Assets) => void

const SCREENS: Array<[string, string, Draw]> = [
  ['01 Welcome', C.white, welcome],
  ['02 Phone Number', C.white, (s) => phoneNumber(s)],
  ['03 Verification Code', C.white, (s) => verify(s)],
  ['04 Profile Setup', C.white, profile],
  ['05 Chats', C.white, chatsList],
  ['06 Chat — Maya', C.wall, mayaLight],
  ['07 Chat — Maya (Dark)', '#0B1215', mayaDark],
  ['08 Group Chat — Lisbon Trip', C.wall, lisbonChat],
  ['09 Chat — Keyboard', C.wall, emmaChat],
  ['10 Contact Info', C.surface, contactInfo],
  ['11 Group Info', C.surface, groupInfo],
  ['12 Media, Links & Docs', C.white, mediaGrid],
  ['13 Calls', C.white, calls],
  ['14 Incoming Call', '#0B1416', incomingCall],
  ['15 Video Call', '#000000', videoCall],
  ['16 Updates', C.white, updates],
  ['17 Status Viewer', '#000000', statusViewer],
  ['18 New Chat', '#0A0F10', newChat],
  ['19 Settings', C.surface, settings],
]

export async function buildMessaging(): Promise<DesignDocument> {
  await loadFonts({ Inter: [400, 500, 600, 700], 'DM Sans': [700], Poppins: [600] })
  const doc = createDocument('Relay — Messaging App', false)
  doc.swatches = [C.brand, C.brandDeep, C.brandTint, C.ink, C.grey, C.surface, C.wall, C.red, C.green, C.read].map((hex) => ({
    id: createSwatchId(),
    color: rgba(hex),
  }))
  const assets = await loadAssets(doc)
  SCREENS.forEach(([name, background, draw], i) => {
    const { x, y } = gridPosition(i, 6, W, H)
    draw(new Board(doc, name, x, background, y), assets)
  })
  return doc
}

export async function buildFiles(): Promise<Record<string, string>> {
  return exampleFiles(await buildMessaging(), 'Relay Messenger')
}

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
 * "Glimpse" — a photo-and-video social network, built as an XDesign document.
 *
 * Eighteen iPhone screens (390 × 844), from logging in through the feed,
 * stories, reels, explore, comments, notifications, the new-post flow,
 * profiles, saved collections, messages and settings. A clean white UI with
 * black type, one thin stroked icon set, and a signature amber → pink → violet
 * gradient for story rings, the mark and highlights. Every photograph is one
 * of the shared illustrated scenes, rasterised once as JPEG and reused wherever
 * the same post appears; every face is one of the shared cast.
 */

import '@/styles/fonts'
import { createDocument } from '@/document/NodeFactory'
import { createSwatchId } from '@/document/ids'
import { ensureFontLoaded } from '@/text/FontRegistry'
import type { DesignDocument, ImageAsset, NodeId } from '@/document/types'
import { addAsset, gridPosition, linear, loadFonts, rgba, Screen, shadow, solid } from '../kit'
import { homeIndicator, statusBar } from '../components'
import { avatar as portrait, PEOPLE, person } from '../art/people'
import type { SceneKind } from '../art/scenes'
import { exampleFiles } from '../output'
import { emoji, FILTERS, jpeg, logoMark, photoSvg, wordmark, type Emoji } from './art'
import { I } from './icons'
import {
  avatar, avatarPair, avatarStack, b, brand, button, C, cover, crop, divider, g, H, icon, iconButton, lift,
  measureRich, navBar, rich, rotate, searchField, stackWidth, tabBar, toggle, useDocument, W, type Seg,
} from './ui'

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

/** Every face in the cast, by first name. */
type Faces = Record<string, ImageAsset>

interface Pics {
  face: Faces
  me: ImageAsset
  /** Pictures by name — posts, tiles, stories. */
  p: Record<string, ImageAsset>
  filters: ImageAsset[]
}

/** Square scenes drawn on a 390 stage — the size a post is seen at — and rasterised to `px`. */
const SQUARES: Record<string, [SceneKind, number, number]> = {
  // Posts that appear full width somewhere, at 2×.
  sorapis: ['lake', 3, 780],
  amalfi: ['beach', 5, 780],
  tokyo: ['city', 2, 780],
  praia: ['beach', 11, 780],
  // Grid tiles, at 2× a 128-point tile.
  e1: ['mountains', 21, 256], e2: ['food', 4, 256], e3: ['flowers', 3, 256], e4: ['coffee', 2, 256],
  e5: ['abstract', 5, 256], e6: ['city', 10, 256], e7: ['lake', 9, 256], e8: ['sunset', 12, 256],
  e9: ['desert', 41, 256], e10: ['aurora', 6, 256], e11: ['beach', 13, 256], e12: ['flowers', 16, 256],
  e13: ['desert', 22, 256], e14: ['coffee', 13, 256],
  m1: ['mountains', 15, 256], m2: ['aurora', 18, 256], m3: ['city', 19, 256], m4: ['forest', 20, 256],
  m5: ['lake', 23, 256], m6: ['coffee', 24, 256], m7: ['desert', 25, 256], m8: ['sunset', 26, 256],
  s1: ['food', 27, 256], s2: ['mountains', 28, 256], s3: ['flowers', 29, 256], s4: ['coffee', 30, 256],
  s5: ['sunset', 31, 256], s6: ['city', 32, 256], s7: ['abstract', 7, 256], s8: ['lake', 34, 256],
  pt2: ['sunset', 11, 256], pt3: ['food', 35, 256],
}

/** Tall pictures: [kind, seed, stage w, stage h, pixel w, pixel h]. */
const TALL: Record<string, [SceneKind, number, number, number, number, number]> = {
  story: ['aurora', 4, 390, 693, 585, 1040],
  reel: ['sunset', 16, 390, 844, 585, 1266],
  tallForest: ['forest', 7, 390, 789, 256, 518],
  tallCity: ['city', 8, 390, 789, 256, 518],
}

async function loadPictures(doc: DesignDocument): Promise<Pics> {
  const face: Faces = {}
  await Promise.all(PEOPLE.map(async (who, i) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 480 480">${portrait(who, `p${i}`)}</svg>`
    face[who.name.split(' ')[0]!] = addAsset(doc, `Avatar / ${who.handle}`, await jpeg(svg, 160, 160, 0.9), 160, 160)
  }))

  const p: Record<string, ImageAsset> = {}
  await Promise.all(Object.entries(SQUARES).map(async ([key, [kind, seed, px]]) => {
    p[key] = addAsset(doc, `Photo / ${key}`, await jpeg(photoSvg(kind, seed, 390, 390), px, px, px > 400 ? 0.84 : 0.8), px, px)
  }))
  await Promise.all(Object.entries(TALL).map(async ([key, [kind, seed, sw, sh, pw, ph]]) => {
    p[key] = addAsset(doc, `Photo / ${key}`, await jpeg(photoSvg(kind, seed, sw, sh), pw, ph, 0.82), pw, ph)
  }))

  // The new post, through every filter. Normal is the photo itself; Coast is
  // the one chosen, so it is drawn full size and reused as the posted picture.
  const [kind, seed] = SQUARES.praia!
  const filters: ImageAsset[] = []
  for (const f of FILTERS) {
    if (!f.matrix) filters.push(p.praia!)
    else if (f.name === 'Coast') {
      p.praiaCoast = addAsset(doc, 'Photo / praia (Coast)', await jpeg(photoSvg(kind, seed, 390, 390, f.matrix), 780, 780), 780, 780)
      filters.push(p.praiaCoast)
    } else {
      filters.push(addAsset(doc, `Filter / ${f.name}`, await jpeg(photoSvg(kind, seed, 390, 390, f.matrix), 152, 152, 0.8), 152, 152))
    }
  }
  return { face, me: face.Maya!, p, filters }
}

// ---------------------------------------------------------------------------
// Shared pieces of the feed
// ---------------------------------------------------------------------------

let DOC: DesignDocument

const handle = (first: string) => person(first).handle

/** The home screen's bar: the wordmark, activity and messages. */
function homeTopBar(s: Screen): NodeId {
  const mark = wordmark(s, DOC, 16, 50, 28)
  return s.group('Top Bar', [
    mark.id,
    s.group('Activity', [
      icon(s, 'Icon', I.heart, 302, 55, 26),
      s.circle('Badge', 325, 57, 4.5, { fill: C.pink, stroke: { color: C.white, width: 1.5 } }),
    ]),
    s.group('Messages', [
      icon(s, 'Icon', I.send, 348, 55, 26),
      s.rect('Badge', 362, 47, 20, 18, { fill: C.pink, radius: 9, stroke: { color: C.white, width: 1.5 } }),
      s.centeredText('Count', '3', { x: 362, y: 47, w: 20, h: 18 }, { size: 11, weight: 700, color: C.white }),
    ]),
  ])
}

/** A post's header row: face, name, place and the more button. 48 tall. */
function postHeader(s: Screen, pics: Pics, first: string, place: string, y: number, ring: 'story' | 'seen' | 'none' = 'story'): NodeId {
  return s.group('Post Header', [
    avatar(s, handle(first), pics.face[first]!, 36, y + 24, 16, ring, { gap: 2, width: 2 }),
    s.text('Username', handle(first), 64, y + 6, { size: 14, weight: 600 }),
    s.text('Location', place, 64, y + 25, { size: 12 }),
    icon(s, 'More', I.more, 350, y + 12, 24, C.ink, { width: 2.6 }),
  ])
}

/** Like, comment, share and save, and optionally a carousel's dots. */
function actionRow(s: Screen, y: number, o: { liked?: boolean; pages?: number } = {}): NodeId {
  const ids: NodeId[] = [
    o.liked
      ? icon(s, 'Like', I.heart, 14, y + 10, 26, C.like, { fill: C.like })
      : icon(s, 'Like', I.heart, 14, y + 10, 26),
    icon(s, 'Comment', I.comment, 56, y + 10, 26),
    icon(s, 'Share', I.send, 98, y + 10, 26),
    icon(s, 'Save', I.bookmark, 350, y + 10, 26),
  ]
  if (o.pages) {
    const dots: NodeId[] = []
    for (let i = 0; i < o.pages; i++) {
      const x = W / 2 + (i - (o.pages - 1) / 2) * 10
      dots.push(s.circle(`Dot ${i + 1}`, x, y + 23, 3, { fill: i === 0 ? C.pink : '#CACAD2' }))
    }
    ids.push(s.group('Carousel Dots', dots))
  }
  return s.group('Actions', ids)
}

/** "Liked by …": two small faces and the sentence. */
function likedBy(s: Screen, faces: ImageAsset[], who: string, others: string, y: number): NodeId {
  const x = 16 + stackWidth(faces.length, 9) + 6
  return s.group('Liked By', [
    avatarStack(s, 'Likers', faces, 16, y + 9, 9),
    rich(s, 'Likes', ['Liked by ', b(who), ' and ', b(others)], x, y, { size: 14 }),
  ])
}

function verified(s: Screen, x: number, cy: number, r = 7): NodeId {
  return s.group('Verified', [
    s.circle('Badge', x + r, cy, r, { fill: brand(0, 1, 1, 0) }),
    icon(s, 'Check', I.check, x + r - r * 0.6, cy - r * 0.6, r * 1.2, C.white, { width: 1.8 }),
  ])
}

// ---------------------------------------------------------------------------
// 01 Log in
// ---------------------------------------------------------------------------

function login(s: Screen): void {
  statusBar(s, C.ink)
  s.group('Language', [
    s.text('Label', 'English (US)', W / 2 - 8, 62, { size: 13, color: C.grey, anchor: 'center' }),
    icon(s, 'Chevron', I.chevronDown, W / 2 + 32, 63, 14, C.grey, { width: 1.8 }),
  ])
  s.group('Brand', [
    logoMark(s, 155, 148, 80),
    wordmark(s, DOC, W / 2 - 10, 244, 44, { anchor: 'center' }).id,
    s.text('Tagline', 'Moments worth a second look.', W / 2, 314, { size: 15, color: C.grey, anchor: 'center' }),
  ])

  const field = (name: string, label: string, value: string, y: number, trailing?: string) => {
    const ids = [
      s.rect('Field', 24, y, W - 48, 58, { fill: C.field, radius: 12, stroke: { color: '#E1E1E7', width: 1 } }),
      s.text('Label', label, 40, y + 10, { size: 12, color: C.grey }),
      s.text('Value', value, 40, y + 28, { size: 16, color: C.ink, letterSpacing: value.startsWith('•') ? 0.1 : 0 }),
    ]
    if (trailing) ids.push(icon(s, 'Show Password', trailing, W - 60, y + 17, 24, C.grey))
    return s.group(`Field / ${name}`, ids)
  }
  s.group('Form', [
    field('Username', 'Username, email or mobile number', 'maya.chen', 360),
    field('Password', 'Password', '••••••••••••', 430, I.eyeOff),
    button(s, 'Log in', 24, 512, W - 48, 52, 'gradient', { size: 16, radius: 12 }),
    s.text('Forgot Password', 'Forgot password?', W / 2, 588, { size: 14, weight: 600, anchor: 'center' }),
  ])
  const orY = 640
  s.group('Divider / Or', [
    s.rect('Left', 24, orY, 150, 1, { fill: C.line }),
    s.text('Or', 'OR', W / 2, orY - 8, { size: 12, weight: 600, color: C.faint, anchor: 'center' }),
    s.rect('Right', W - 174, orY, 150, 1, { fill: C.line }),
  ])
  const pk = { size: 15, weight: 600, color: C.ink }
  const pkw = s.measure('Log in with a passkey', pk).width + 30
  s.group('Button / Passkey', [
    s.rect('Background', 24, 668, W - 48, 52, { fill: C.white, radius: 12, stroke: { color: '#D9D9E0', width: 1 } }),
    icon(s, 'Icon', I.key, (W - pkw) / 2, 682, 22, C.ink),
    s.text('Label', 'Log in with a passkey', (W - pkw) / 2 + 30, 684, pk),
  ])
  divider(s, 768)
  const lead = { size: 14, color: C.grey }
  const total = measureRich(["Don't have an account? ", b('Sign up')], lead).width
  s.group('Sign Up', [
    rich(s, 'Prompt', ["Don't have an account? ", ['Sign up', { weight: 600, color: C.link }]], (W - total) / 2, 788, lead),
  ])
  homeIndicator(s, C.ink)
}

// ---------------------------------------------------------------------------
// 02 Home feed
// ---------------------------------------------------------------------------

function home(s: Screen, pics: Pics): void {
  statusBar(s, C.ink)
  homeTopBar(s)

  const stories: Array<[string, string, 'story' | 'seen' | 'none']> = [
    ['Maya', 'Your story', 'none'],
    ['Aisha', handle('Aisha'), 'story'],
    ['Liam', handle('Liam'), 'story'],
    ['Sofia', handle('Sofia'), 'story'],
    ['Kenji', handle('Kenji'), 'story'],
    ['Zara', handle('Zara'), 'seen'],
  ]
  const cy = 132
  s.group('Stories', stories.map(([first, label, ring], i) => {
    const cx = 16 + 34.5 + i * 84
    const ids = [avatar(s, label, pics.face[first]!, cx, cy, 29, ring, { gap: 3, width: 2.5 })]
    if (first === 'Maya') {
      ids.push(s.group('Add Story', [
        s.circle('Outline', cx + 22, cy + 22, 11.5, { fill: C.white }),
        s.circle('Badge', cx + 22, cy + 22, 9.5, { fill: C.ink }),
        icon(s, 'Plus', I.plus, cx + 16, cy + 16, 12, C.white, { width: 2 }),
      ]))
    }
    ids.push(s.text('Name', label, cx, cy + 40, { size: 12, color: first === 'Maya' ? C.grey : C.ink, anchor: 'center' }))
    return s.group(`Story / ${label}`, ids)
  }))
  divider(s, 196)

  const top = 196
  s.group(`Post / ${handle('Liam')}`, [
    postHeader(s, pics, 'Liam', 'Lago di Sorapis, Dolomites', top),
    s.image('Photo', pics.p.sorapis!, 0, top + 48, W, W),
    actionRow(s, top + 48 + W),
    likedBy(s, [pics.face.Sofia!, pics.face.Kenji!], handle('Sofia'), '1,284 others', 680),
    rich(s, 'Caption', [b(handle('Liam')), ' First light, worth the 4 a.m. hike.'], 16, 701, { size: 14, width: W - 32 }),
    s.text('Comments', 'View all 24 comments', 16, 722, { size: 14, color: C.grey }),
    s.text('Time', '2 hours ago', 16, 742, { size: 11.5, color: C.grey }),
  ])
  tabBar(s, 'home', pics.me)
  homeIndicator(s, C.ink)
}

// ---------------------------------------------------------------------------
// 03 Feed, a carousel post
// ---------------------------------------------------------------------------

function carousel(s: Screen, pics: Pics): void {
  statusBar(s, C.ink)
  homeTopBar(s)
  const top = 92
  const photo = top + 48
  s.group(`Post / ${handle('Sofia')}`, [
    postHeader(s, pics, 'Sofia', 'Positano, Amalfi Coast', top, 'seen'),
    s.image('Photo 1 of 4', pics.p.amalfi!, 0, photo, W, W),
    s.group('Page Badge', [
      s.rect('Background', W - 54, photo + 14, 40, 24, { fill: solid('#111114', 0.62), radius: 12 }),
      s.centeredText('Label', '1/4', { x: W - 54, y: photo + 14, w: 40, h: 24 }, { size: 12, weight: 600, color: C.white }),
    ]),
    s.group('Tagged People', [
      s.circle('Background', 30, photo + W - 30, 14, { fill: solid('#111114', 0.62) }),
      icon(s, 'Icon', I.user, 22, photo + W - 38, 16, C.white, { width: 1.8 }),
    ]),
    actionRow(s, photo + W, { liked: true, pages: 4 }),
    likedBy(s, [pics.face.Kenji!, pics.face.Maya!], handle('Kenji'), '3,902 others', 576),
    rich(s, 'Caption', [b(handle('Sofia')), ' Four days, one coastline, zero regrets. Lemon granita count: eleven.'], 16, 597, { size: 14, width: W - 32 }),
    s.text('Comments', 'View all 118 comments', 16, 639, { size: 14, color: C.grey }),
    s.text('Time', '5 hours ago', 16, 660, { size: 11.5, color: C.grey }),
  ])
  const next = 684
  s.group(`Post / ${handle('Kenji')}`, [
    postHeader(s, pics, 'Kenji', 'Shibuya, Tokyo', next),
    crop(s.image('Photo', pics.p.tokyo!, 0, next + 48, W, H - next - 48), 0, 0, 1, (H - next - 48) / W),
  ])
  tabBar(s, 'home', pics.me)
  homeIndicator(s, C.ink)
}

// ---------------------------------------------------------------------------
// 04 Story viewer
// ---------------------------------------------------------------------------

function story(s: Screen, pics: Pics): void {
  const top = 44
  const h = 693
  s.image('Story Photo', pics.p.story!, 0, top, W, h, 12)
  s.rect('Top Scrim', 0, top, W, 130, { fill: linear([['#000000', 0, 0.5], ['#000000', 1, 0]]), radius: [12, 12, 0, 0] })
  statusBar(s, C.white)

  const bars: NodeId[] = []
  const bw = (W - 16 - 8) / 3
  for (let i = 0; i < 3; i++) {
    const x = 8 + i * (bw + 4)
    bars.push(s.rect(`Track ${i + 1}`, x, top + 8, bw, 2.5, { fill: solid(C.white, 0.38), radius: 1.25 }))
    if (i === 0) bars.push(s.rect(`Progress ${i + 1}`, x, top + 8, bw, 2.5, { fill: C.white, radius: 1.25 }))
    if (i === 1) bars.push(s.rect(`Progress ${i + 1}`, x, top + 8, bw * 0.42, 2.5, { fill: C.white, radius: 1.25 }))
  }
  s.group('Progress', bars)

  const name = { size: 14, weight: 600, color: C.white }
  const nw = s.measure(handle('Aisha'), name).width
  s.group('Story Header', [
    avatar(s, handle('Aisha'), pics.face.Aisha!, 28, top + 36, 16),
    s.text('Username', handle('Aisha'), 52, top + 27, name),
    s.text('Time', '3h', 52 + nw + 8, top + 27, { size: 14, color: C.white, opacity: 0.7 }),
    icon(s, 'More', I.more, 316, top + 24, 24, C.white, { width: 2.6 }),
    icon(s, 'Close', I.close, 352, top + 24, 24, C.white, { width: 2 }),
  ])

  // A location sticker, tilted the way a thumb leaves it.
  const loc = { size: 14, weight: 700, color: C.pink, letterSpacing: 0.04 }
  const lw = s.measure('TROMSØ, NORWAY', loc).width + 50
  const lx = (W - lw) / 2
  const ly = 214
  s.group('Sticker / Location', [
    rotate(s.rect('Background', lx, ly, lw, 38, { fill: C.white, radius: 10, shadow: shadow(6, 16, 0.25, 0, '#000000') }), -4),
    rotate(icon(s, 'Pin', I.pin, lx + 14, ly + 9, 20, C.pink, { width: 2 }), -4),
    rotate(s.text('Label', 'TROMSØ, NORWAY', lx + 38, ly + 10, loc), -4),
  ])

  // The text sticker: two lines, each on its own white highlight.
  const lines = ['Four nights of waiting.', 'Worth every minute.']
  const t = { size: 21, weight: 700, color: C.ink }
  const sticker: NodeId[] = []
  lines.forEach((line, i) => {
    const m = s.measure(line, t)
    const y = 560 + i * 40
    sticker.push(s.rect(`Highlight ${i + 1}`, (W - m.width) / 2 - 12, y, m.width + 24, 42, { fill: C.white, radius: 8 }))
    sticker.push(s.text(`Line ${i + 1}`, line, W / 2, y + (42 - m.height) / 2, { ...t, anchor: 'center' }))
  })
  s.group('Sticker / Text', sticker)

  s.group('Reply Bar', [
    s.rect('Field', 16, 754, 262, 44, { fill: solid(C.white, 0), radius: 22, stroke: { color: C.white, width: 1, alpha: 0.55 } }),
    s.text('Placeholder', 'Send message', 34, 766, { size: 15, color: C.white, opacity: 0.85 }),
    icon(s, 'Like', I.heart, 296, 763, 26, C.white),
    icon(s, 'Share', I.send, 344, 763, 26, C.white),
  ])
  homeIndicator(s, C.white)
}

// ---------------------------------------------------------------------------
// 05 Reels
// ---------------------------------------------------------------------------

function reels(s: Screen, pics: Pics): void {
  s.image('Video Frame', pics.p.reel!, 0, 0, W, H)
  s.rect('Top Scrim', 0, 0, W, 140, { fill: linear([['#000000', 0, 0.45], ['#000000', 1, 0]]) })
  s.rect('Bottom Scrim', 0, 470, W, H - 470, { fill: linear([['#000000', 0, 0], ['#000000', 1, 0.75]]) })
  statusBar(s, C.white)
  s.group('Header', [
    s.text('Title', 'Reels', 16, 54, { size: 24, weight: 700, color: C.white }),
    icon(s, 'Chevron', I.chevronDown, 86, 62, 18, C.white, { width: 2.2 }),
    icon(s, 'Camera', I.camera, 348, 56, 26, C.white),
  ])

  const counts: Array<[string, string, string]> = [['Like', I.heart, '48.2K'], ['Comment', I.comment, '1,093'], ['Share', I.send, '2,318']]
  const side: NodeId[] = counts.map(([name, d, count], i) => {
    const y = 470 + i * 70
    return s.group(`Action / ${name}`, [
      icon(s, 'Icon', d, 348, y, 28, C.white, { width: 2 }),
      s.text('Count', count, 362, y + 34, { size: 12, weight: 600, color: C.white, anchor: 'center' }),
    ])
  })
  side.push(icon(s, 'More', I.more, 350, 682, 24, C.white, { width: 2.6 }))
  side.push(s.group('Audio Cover', [
    s.rect('Frame', 346, 716, 32, 32, { fill: C.white, radius: 8 }),
    s.image('Cover', pics.p.e8!, 348, 718, 28, 28, 6),
  ]))
  s.group('Side Actions', side)

  const name = { size: 14, weight: 600, color: C.white }
  const nw = s.measure(handle('Mateo'), name).width
  s.group('Creator', [
    avatar(s, handle('Mateo'), pics.face.Mateo!, 32, 652, 16),
    s.text('Username', handle('Mateo'), 56, 643, name),
    button(s, 'Follow', 56 + nw + 12, 638, 68, 28, 'ghostLight', { size: 13, radius: 8 }),
  ])
  rich(s, 'Caption', ['Chasing the last light on the coast road. Sound on for the waves… ', ['more', { color: '#D6D6DC' }]], 16, 680, {
    size: 14, color: C.white, width: 300,
  })
  const audio = { size: 13, color: C.white }
  const aw = s.measure('Mateo Garcia · Original audio', audio).width
  s.group('Audio', [
    s.rect('Background', 16, 724, aw + 42, 26, { fill: solid(C.white, 0.2), radius: 13 }),
    icon(s, 'Note', I.music, 26, 730, 14, C.white, { width: 1.6 }),
    s.text('Track', 'Mateo Garcia · Original audio', 46, 729, audio),
  ])
  tabBar(s, 'reels', pics.me, true)
  homeIndicator(s, C.white)
}

// ---------------------------------------------------------------------------
// 06 Explore
// ---------------------------------------------------------------------------

function tileBadge(s: Screen, kind: 'reel' | 'multi', x: number, y: number, w: number): NodeId {
  return lift(icon(s, kind === 'reel' ? 'Reel' : 'Carousel', kind === 'reel' ? I.reels : I.multi, x + w - 26, y + 8, 18, C.white, { width: 1.8 }), shadow(1, 4, 0.35, 0, '#000000'))
}

function explore(s: Screen, pics: Pics): void {
  statusBar(s, C.ink)
  searchField(s, 16, 52, W - 32)
  const T = 128
  const G = 3
  const top = 102
  const col = (i: number) => i * (T + G)
  const row = (i: number) => top + i * (T + G)
  const small = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e9', 'e8', 'e10', 'e11', 'e12', 'e13', 'e14']
  const cells: Array<[number, number]> = [
    [0, 0], [1, 0], [2, 0],
    [0, 1], [1, 1], [0, 2], [1, 2],
    [0, 3], [1, 3], [2, 3],
    [1, 4], [2, 4], [1, 5], [2, 5],
  ]
  const badges: Record<number, 'reel' | 'multi'> = { 1: 'multi', 4: 'reel', 8: 'multi', 11: 'multi' }
  const tiles: NodeId[] = cells.map(([c, r], i) => {
    const key = small[i]!
    const ids = [s.image('Photo', pics.p[key]!, col(c), row(r), T, T)]
    if (badges[i]) ids.push(tileBadge(s, badges[i], col(c), row(r), T))
    return s.group(`Tile / ${key}`, ids)
  })
  const tall = (key: string, c: number, r: number, views: string) => {
    const x = col(c)
    const y = row(r)
    return s.group(`Reel Tile / ${key}`, [
      s.image('Cover', pics.p[key]!, x, y, T, T * 2 + G),
      s.rect('Scrim', x, y + T * 2 + G - 60, T, 60, { fill: linear([['#000000', 0, 0], ['#000000', 1, 0.45]]) }),
      tileBadge(s, 'reel', x, y, T),
      icon(s, 'Play', I.play, x + 8, y + T * 2 + G - 26, 16, C.white, { width: 1.4, fill: C.white }),
      s.text('Views', views, x + 28, y + T * 2 + G - 26, { size: 13, weight: 600, color: C.white }),
    ])
  }
  tiles.push(tall('tallForest', 2, 1, '1.2M'), tall('tallCity', 0, 4, '386K'))
  s.group('Explore Grid', tiles)
  tabBar(s, 'search', pics.me)
  homeIndicator(s, C.ink)
}

// ---------------------------------------------------------------------------
// 07 Search results
// ---------------------------------------------------------------------------

function searchResults(s: Screen, pics: Pics): void {
  statusBar(s, C.ink)
  s.group('Search Bar', [
    icon(s, 'Back', I.back, 8, 58, 26, C.ink, { width: 2 }),
    searchField(s, 44, 52, W - 60, { query: 'travel photo' }),
  ])
  const tabs = ['Top', 'Accounts', 'Audio', 'Tags', 'Places']
  const slot = W / tabs.length
  s.group('Tabs', [
    ...tabs.map((label, i) =>
      s.text(`Tab / ${label}`, label, slot * i + slot / 2, 110, {
        size: 15, weight: 600, color: label === 'Accounts' ? C.ink : C.faint, anchor: 'center',
      })),
    s.rect('Hairline', 0, 143, W, 1, { fill: C.line }),
    s.rect('Indicator', slot, 142, slot, 2, { fill: C.ink }),
  ])

  const rows: Array<{ face?: string; pic?: string; name: string; line: string; following?: boolean; verified?: boolean; ring?: boolean }> = [
    { face: 'Kenji', name: handle('Kenji'), line: 'Kenji Tanaka · 214K followers', verified: true, ring: true },
    { pic: 'e1', name: 'wanderframes', line: 'Wander Frames · Travel guides' },
    { face: 'Zara', name: handle('Zara'), line: 'Zara Ahmed · 41.7K followers', following: true },
    { face: 'Grace', name: handle('Grace'), line: 'Grace Okafor · Photographer', ring: true },
    { pic: 'e10', name: 'northlight.studio', line: 'North Light Studio' },
    { face: 'Lucas', name: handle('Lucas'), line: 'Lucas Silva · Travel & food' },
    { face: 'Jonas', name: handle('Jonas'), line: 'Jonas Berg · Film photography' },
    { face: 'Chloe', name: handle('Chloe'), line: 'Chloe Martin · 8,204 followers', following: true },
    { face: 'Omar', name: handle('Omar'), line: 'Omar Haddad · Travel writer' },
  ]
  const list = rows.map((r, i) => {
    const y = 152 + i * 66
    const asset = r.face ? pics.face[r.face]! : pics.p[r.pic!]!
    const name = { size: 14, weight: 600 }
    const ids = [
      avatar(s, r.name, asset, 44, y + 33, 26, r.ring ? 'story' : 'none', { gap: 2.5, width: 2 }),
      s.text('Username', r.name, 84, y + 14, name),
      s.text('Details', r.line, 84, y + 34, { size: 13, color: C.grey }),
    ]
    if (r.verified) ids.push(verified(s, 84 + s.measure(r.name, name).width + 5, y + 23, 7))
    ids.push(button(s, r.following ? 'Following' : 'Follow', W - 16 - 92, y + 17, 92, 32, r.following ? 'secondary' : 'primary', { size: 13, radius: 8 }))
    return s.group(`Account / ${r.name}`, ids)
  })
  s.group('Accounts', list)
  tabBar(s, 'search', pics.me)
  homeIndicator(s, C.ink)
}

// ---------------------------------------------------------------------------
// 08 Post detail with the comments sheet
// ---------------------------------------------------------------------------

function comments(s: Screen, pics: Pics): void {
  s.group('Post Behind', [
    postHeader(s, pics, 'Liam', 'Lago di Sorapis, Dolomites', 44),
    s.image('Photo', pics.p.sorapis!, 0, 92, W, W),
  ])
  s.rect('Dim', 0, 0, W, H, { fill: solid('#000000', 0.45) })
  statusBar(s, C.white)

  const top = 164
  s.group('Sheet', [
    s.rect('Background', 0, top, W, H - top, { fill: C.white, radius: [18, 18, 0, 0] }),
    s.rect('Grabber', W / 2 - 20, top + 8, 40, 4, { fill: '#D4D4DB', radius: 2 }),
    s.text('Title', 'Comments', W / 2, top + 24, { size: 16, weight: 700, anchor: 'center' }),
    divider(s, top + 56),
  ])

  interface Comment { first: string; time: string; text: string; likes: number; reply?: boolean; author?: boolean; liked?: boolean; moreReplies?: number }
  const thread: Comment[] = [
    { first: 'Sofia', time: '1h', text: 'That colour is unreal. Which trail did you take?', likes: 38 },
    { first: 'Liam', time: '52m', text: `@${handle('Sofia')} Trail 215 from Passo Tre Croci, about two hours each way.`, likes: 12, reply: true, author: true, moreReplies: 1 },
    { first: 'Kenji', time: '1h', text: 'Saving this for September.', likes: 9, liked: true },
    { first: 'Aisha', time: '45m', text: 'The reflection!! Framed perfectly.', likes: 21 },
    { first: 'Mateo', time: '30m', text: 'The 4 a.m. alarm clearly paid off.', likes: 4 },
  ]
  let y = top + 72
  const items: NodeId[] = []
  for (const c of thread) {
    const indent = c.reply ? 52 : 0
    const r = c.reply ? 12 : 16
    const x = 60 + indent
    const width = W - x - 56
    const who = handle(c.first)
    const head: Seg[] = [b(who), `  ${c.time}`]
    if (c.author) head.push('  ·  Author')
    const ids: NodeId[] = [
      avatar(s, who, pics.face[c.first]!, 16 + indent + r, y + r, r),
      rich(s, 'Byline', head, x, y, { size: 13, color: C.grey }),
    ]
    const textId = rich(
      s,
      'Text',
      c.text.startsWith('@') ? [[c.text.split(' ')[0]!, { color: C.link }], c.text.slice(c.text.indexOf(' '))] : [c.text],
      x, y + 19, { size: 14, width, lineHeight: 1.35 },
    )
    ids.push(textId)
    const th = measureRich([c.text], { size: 14, width, lineHeight: 1.35 }).height
    ids.push(s.text('Reply', 'Reply', x, y + 19 + th + 6, { size: 12, weight: 600, color: C.grey }))
    ids.push(c.liked
      ? icon(s, 'Like', I.heart, W - 36, y + 12, 16, C.like, { fill: C.like, width: 1.4 })
      : icon(s, 'Like', I.heart, W - 36, y + 12, 16, C.grey, { width: 1.4 }))
    ids.push(s.text('Likes', String(c.likes), W - 28, y + 31, { size: 11, color: C.grey, anchor: 'center' }))
    y += 19 + th + 6 + 16 + 14
    items.push(s.group(`Comment / ${who}`, ids))
    if (c.moreReplies) {
      items.push(s.group('View Replies', [
        s.rect('Line', x, y + 7, 24, 1, { fill: C.faint }),
        s.text('Label', `View ${c.moreReplies} more ${c.moreReplies === 1 ? 'reply' : 'replies'}`, x + 32, y, { size: 12, weight: 600, color: C.grey }),
      ]))
      y += 32
    }
  }
  s.group('Thread', items)

  const composerTop = 692
  const faces: Emoji[] = ['heart', 'joy', 'fire', 'heart-eyes', 'party', 'wow', 'grin', 'sparkles']
  const step = W / faces.length
  s.group('Composer', [
    s.rect('Background', 0, composerTop, W, H - composerTop, { fill: C.white }),
    divider(s, composerTop),
    s.group('Quick Reactions', faces.map((f, i) => emoji(s, f, step * i + step / 2, composerTop + 30, 28))),
    avatar(s, handle('Maya'), pics.me, 36, composerTop + 86, 20),
    s.rect('Field', 66, composerTop + 64, W - 82, 44, { fill: C.white, radius: 22, stroke: { color: '#DADAE0', width: 1 } }),
    s.text('Placeholder', `Add a comment for ${handle('Liam')}…`, 84, composerTop + 76, { size: 14, color: C.grey }),
    s.text('GIF', 'GIF', W - 34, composerTop + 77, { size: 12, weight: 700, color: C.grey, anchor: 'center' }),
  ])
  homeIndicator(s, C.ink)
}

// ---------------------------------------------------------------------------
// 09 Activity
// ---------------------------------------------------------------------------

function activity(s: Screen, pics: Pics): void {
  statusBar(s, C.ink)
  navBar(s, 'Notifications')

  s.group('Follow Requests', [
    avatarPair(s, 'Requests', pics.face.Omar!, pics.face.Priya!, 16, 104, 44),
    s.text('Title', 'Follow requests', 72, 107, { size: 14, weight: 600 }),
    s.text('Details', `${handle('Omar')} + 4 others`, 72, 126, { size: 14, color: C.grey }),
    s.circle('Unread', W - 44, 126, 4.5, { fill: C.pink }),
    icon(s, 'Chevron', I.chevronRight, W - 34, 116, 20, C.grey, { width: 1.8 }),
  ])
  divider(s, 160)

  type Right = { thumb: string } | { button: 'Follow back' | 'Following' }
  interface Row { faces: string[]; text: Seg[]; right: Right; ring?: boolean }
  const sections: Array<[string, Row[]]> = [
    ['Today', [
      { faces: ['Liam', 'Sofia'], text: [b(handle('Liam')), ' and ', b(handle('Sofia')), ' liked your photo. ', g('2h')], right: { thumb: 'praiaCoast' } },
      { faces: ['Kenji'], text: [b(handle('Kenji')), ' started following you. ', g('4h')], right: { button: 'Follow back' }, ring: true },
      { faces: ['Zara'], text: [b(handle('Zara')), ' mentioned you in a comment: ', ['@maya.chen', { color: C.link }], ' this light is unreal ', g('5h')], right: { thumb: 'm4' } },
    ]],
    ['This week', [
      { faces: ['Priya'], text: [b(handle('Priya')), ' liked your reel. ', g('2d')], right: { thumb: 'm8' } },
      { faces: ['Leo'], text: [b(handle('Leo')), ' started following you. ', g('3d')], right: { button: 'Following' } },
      { faces: ['Emma'], text: [b(handle('Emma')), ' commented: Take me back to Kyoto! ', g('4d')], right: { thumb: 'm3' } },
    ]],
    ['Earlier', [
      { faces: ['Jonas', 'Noah'], text: [b(handle('Jonas')), ', ', b(handle('Noah')), ' and ', b('38 others'), ' liked your photo. ', g('1w')], right: { thumb: 'm5' } },
      { faces: ['Grace'], text: [b(handle('Grace')), ' started following you. ', g('2w')], right: { button: 'Follow back' } },
    ]],
  ]
  let y = 176
  for (const [title, rows] of sections) {
    const ids: NodeId[] = [s.text('Title', title, 16, y, { size: 16, weight: 700 })]
    y += 34
    for (const row of rows) {
      const hasButton = 'button' in row.right
      const textWidth = W - 72 - 16 - (hasButton ? 116 : 56)
      const th = measureRich(row.text, { size: 14, width: textWidth, lineHeight: 1.35 }).height
      const h = Math.max(60, th + 18)
      if (y + h > H - 83) break
      const cy = y + h / 2
      const parts: NodeId[] = [
        row.faces.length > 1
          ? avatarPair(s, row.faces.join(' & '), pics.face[row.faces[0]!]!, pics.face[row.faces[1]!]!, 16, cy - 22, 44)
          : avatar(s, handle(row.faces[0]!), pics.face[row.faces[0]!]!, 38, cy, 22, row.ring ? 'story' : 'none', { gap: 2, width: 2 }),
        rich(s, 'Text', row.text, 72, cy - th / 2, { size: 14, width: textWidth, lineHeight: 1.35 }),
      ]
      if ('thumb' in row.right) {
        parts.push(s.image('Post', pics.p[row.right.thumb]!, W - 16 - 44, cy - 22, 44, 44, 6))
      } else {
        const label = row.right.button
        parts.push(button(s, label, W - 16 - 104, cy - 16, 104, 32, label === 'Following' ? 'secondary' : 'primary', { size: 13, radius: 8 }))
      }
      ids.push(s.group(`Notification / ${row.faces.map(handle).join(', ')}`, parts))
      y += h
    }
    y += 10
    s.group(`Section / ${title}`, ids)
  }
  tabBar(s, 'home', pics.me)
  homeIndicator(s, C.ink)
}

// ---------------------------------------------------------------------------
// 10 New post — the gallery picker
// ---------------------------------------------------------------------------

function newPost(s: Screen, pics: Pics): void {
  statusBar(s, C.ink)
  navBar(s, 'New post', {
    left: 'close',
    right: [s.text('Next', 'Next', W - 16, 58, { size: 16, weight: 600, color: C.link, anchor: 'right' })],
  })
  s.image('Preview', pics.p.praia!, 0, 92, W, W)
  const bar = 92 + W
  s.group('Gallery Bar', [
    s.text('Album', 'Recents', 16, bar + 14, { size: 16, weight: 700 }),
    icon(s, 'Chevron', I.chevronDown, 90, bar + 17, 18, C.ink, { width: 2 }),
    s.group('Select Multiple', [
      s.circle('Background', W - 70, bar + 24, 17, { fill: C.ink }),
      icon(s, 'Icon', I.multi, W - 80, bar + 14, 20, C.white, { width: 1.8 }),
    ]),
    s.group('Camera', [
      s.circle('Background', W - 28, bar + 24, 17, { fill: C.surface }),
      icon(s, 'Icon', I.camera, W - 38, bar + 14, 20, C.ink, { width: 1.7 }),
    ]),
  ])
  const T = 96
  const G = 2
  const top = bar + 48
  const recents = ['praia', 'pt2', 'm4', 'pt3', 'm6', 'm7', 'm1', 'm8', 'm3', 'm2', 'm5', 'e7', 'e11', 'e3', 'e13', 'e4']
  const order: Record<string, number> = { praia: 1, pt2: 2, pt3: 3 }
  s.group('Recents', recents.map((key, i) => {
    const x = (i % 4) * (T + G)
    const y = top + Math.floor(i / 4) * (T + G)
    const n = order[key]
    const ids = [s.image('Photo', pics.p[key]!, x, y, T, T)]
    if (n === 1) ids.push(s.rect('Current', x, y, T, T, { fill: solid(C.white, 0.45) }))
    ids.push(n
      ? s.group(`Badge / ${n}`, [
        s.circle('Outline', x + T - 16, y + 16, 11, { fill: C.white }),
        s.circle('Fill', x + T - 16, y + 16, 9.5, { fill: brand(0, 1, 1, 0) }),
        s.centeredText('Number', String(n), { x: x + T - 26, y: y + 6, w: 20, h: 20 }, { size: 12, weight: 700, color: C.white }),
      ])
      : s.circle('Badge / Empty', x + T - 16, y + 16, 10, { fill: solid(C.white, 0.25), stroke: { color: C.white, width: 1.5 } }))
    return s.group(`Photo / ${key}`, ids)
  }))
  const modes = ['POST', 'STORY', 'REEL', 'LIVE']
  const m = { size: 13, weight: 700, letterSpacing: 0.04 }
  const widths = modes.map((label) => s.measure(label, m).width)
  const pw = widths.reduce((a, w) => a + w, 0) + 24 * (modes.length - 1) + 40
  let mx = (W - pw) / 2 + 20
  const pill: NodeId[] = [s.rect('Background', (W - pw) / 2, 772, pw, 40, { fill: solid('#18181C', 0.9), radius: 20 })]
  modes.forEach((label, i) => {
    pill.push(s.text(label, label, mx, 784, { ...m, color: C.white, opacity: i === 0 ? 1 : 0.55 }))
    mx += widths[i]! + 24
  })
  s.group('Mode Switcher', pill)
  homeIndicator(s, C.white)
}

// ---------------------------------------------------------------------------
// 11 Edit — filters
// ---------------------------------------------------------------------------

function filters(s: Screen, pics: Pics): void {
  statusBar(s, C.ink)
  navBar(s, 'Edit', {
    right: [s.text('Next', 'Next', W - 16, 58, { size: 16, weight: 600, color: C.link, anchor: 'right' })],
  })
  s.image('Photo / Coast', pics.p.praiaCoast!, 0, 92, W, W)
  const chosen = 2
  const T = 76
  const top = 92 + W + 44
  s.group('Filter Strip', FILTERS.map((f, i) => {
    const x = 16 + i * (T + 12)
    const on = i === chosen
    const ids = [
      s.text('Name', f.name, x + T / 2, top, { size: 12, weight: on ? 700 : 500, color: on ? C.ink : C.grey, anchor: 'center' }),
      s.image('Preview', pics.filters[i]!, x, top + 24, T, T, 6),
    ]
    if (on) ids.push(s.rect('Selected', x - 3, top + 21, T + 6, T + 6, { fill: solid(C.white, 0), radius: 9, stroke: { color: C.ink, width: 2 } }))
    return s.group(`Filter / ${f.name}`, ids)
  }))
  const sy = top + 24 + T + 64
  const knob = 56 + (W - 112) * 0.75
  s.group('Strength', [
    s.rect('Track', 56, sy, W - 112, 3, { fill: '#E1E1E7', radius: 1.5 }),
    s.rect('Fill', 56, sy, knob - 56, 3, { fill: C.ink, radius: 1.5 }),
    s.circle('Knob', knob, sy + 1.5, 10, { fill: C.white, shadow: shadow(2, 8, 0.25, 0, '#000000'), stroke: { color: '#E1E1E7', width: 1 } }),
    s.text('Value', '75', knob, sy - 30, { size: 13, weight: 600, anchor: 'center' }),
  ])
  divider(s, 758)
  s.group('Mode Tabs', [
    s.text('Filter', 'Filter', W / 4, 776, { size: 15, weight: 700, anchor: 'center' }),
    s.text('Edit', 'Edit', (W * 3) / 4, 776, { size: 15, weight: 600, color: C.faint, anchor: 'center' }),
  ])
  homeIndicator(s, C.ink)
}

// ---------------------------------------------------------------------------
// 12 Share — the new post's details
// ---------------------------------------------------------------------------

function share(s: Screen, pics: Pics): void {
  statusBar(s, C.ink)
  navBar(s, 'New post')
  const caption: Seg[] = [
    'The westernmost edge of Europe, at the only hour that matters. ',
    ['#cabodaroca', { color: C.link }], ' ', ['#portugal', { color: C.link }],
  ]
  s.group('Caption', [
    s.image('Photo', pics.p.praiaCoast!, 16, 108, 76, 76, 6),
    s.group('Carousel Count', [
      s.rect('Background', 66, 114, 20, 20, { fill: solid('#111114', 0.6), radius: 10 }),
      icon(s, 'Icon', I.multi, 70, 118, 12, C.white, { width: 1.5 }),
    ]),
    rich(s, 'Text', caption, 108, 108, { size: 15, width: W - 124, lineHeight: 1.4 }),
  ])
  const chips = ['Poll', 'Prompt', 'Add a question']
  let cx = 16
  s.group('Caption Tools', chips.map((label) => {
    const w = s.measure(label, { size: 13, weight: 600 }).width + 28
    const id = s.group(`Chip / ${label}`, [
      s.rect('Background', cx, 208, w, 32, { fill: C.surface, radius: 10 }),
      s.centeredText('Label', label, { x: cx, y: 208, w, h: 32 }, { size: 13, weight: 600 }),
    ])
    cx += w + 8
    return id
  }))
  divider(s, 256)

  const row = (label: string, d: string, y: number, value?: string) => {
    const ids = [
      icon(s, 'Icon', d, 16, y + 14, 24, C.ink),
      s.text('Label', label, 54, y + 16, { size: 16 }),
      icon(s, 'Chevron', I.chevronRight, W - 36, y + 16, 20, C.grey, { width: 1.8 }),
    ]
    if (value) ids.push(s.text('Value', value, W - 42, y + 17, { size: 14, color: C.grey, anchor: 'right' }))
    return s.group(`Row / ${label}`, ids)
  }
  row('Tag people', I.user, 260, handle('Liam'))
  row('Add location', I.pin, 312, 'Cabo da Roca')
  const places = ['Cabo da Roca', 'Sintra, Portugal', 'Colares', 'Lisbon']
  let px = 54
  s.group('Suggested Places', places.map((label, i) => {
    const on = i === 0
    const w = s.measure(label, { size: 13, weight: 500 }).width + 26
    const id = s.group(`Place / ${label}`, [
      s.rect('Background', px, 362, w, 30, on ? { fill: C.ink, radius: 15 } : { fill: C.white, radius: 15, stroke: { color: '#DADAE0', width: 1 } }),
      s.centeredText('Label', label, { x: px, y: 362, w, h: 30 }, { size: 13, weight: 500, color: on ? C.white : C.ink }),
    ])
    px += w + 8
    return id
  }))
  row('Add music', I.music, 404, 'Salt & Static')
  row('Audience', I.eye, 456, 'Everyone')
  row('Advanced settings', I.sliders, 508)
  divider(s, 568)
  s.group('Also Share', [
    s.text('Title', 'Sharing options', 16, 588, { size: 16, weight: 700 }),
    s.group('Row / Your story', [
      avatar(s, 'Your story', pics.me, 36, 642, 20),
      s.text('Label', 'Your story', 68, 624, { size: 15 }),
      s.text('Details', 'Close friends · 14 people', 68, 644, { size: 13, color: C.grey }),
      toggle(s, W - 66, 627, true),
    ]),
    s.group('Row / Save original', [
      s.circle('Background', 36, 698, 20, { fill: C.surface }),
      icon(s, 'Icon', I.bookmark, 26, 688, 20, C.ink),
      s.text('Label', 'Save original photo', 68, 680, { size: 15 }),
      s.text('Details', 'Keeps an unedited copy on this phone', 68, 700, { size: 13, color: C.grey }),
      toggle(s, W - 66, 683, false),
    ]),
  ])
  s.group('Share Bar', [
    button(s, 'Share', 16, 760, W - 32, 52, 'gradient', { size: 16, radius: 12 }),
  ])
  homeIndicator(s, C.ink)
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

function stats(s: Screen, items: Array<[string, string]>, cy: number): NodeId {
  const left = 124
  const slot = (W - 16 - left) / items.length
  return s.group('Stats', items.map(([n, label], i) => {
    const x = left + slot * i + slot / 2
    return s.group(`Stat / ${label}`, [
      s.text('Count', n, x, cy - 21, { size: 17, weight: 700, anchor: 'center' }),
      s.text('Label', label, x, cy + 1, { size: 13, anchor: 'center' }),
    ])
  }))
}

function highlights(s: Screen, items: Array<[string, ImageAsset | null]>, y: number): NodeId {
  return s.group('Highlights', items.map(([label, pic], i) => {
    const cx = 48 + i * 78
    const cy = y + 32
    const ids: NodeId[] = []
    if (pic) ids.push(avatar(s, label, pic, cx, cy, 28, 'seen', { gap: 3 }))
    else {
      ids.push(s.circle('Outline', cx, cy, 32, { fill: C.white, stroke: { color: '#D6D6DD', width: 1 } }))
      ids.push(icon(s, 'Plus', I.plus, cx - 12, cy - 12, 24, C.ink, { width: 1.6 }))
    }
    ids.push(s.text('Label', label, cx, cy + 40, { size: 12, anchor: 'center' }))
    return s.group(`Highlight / ${label}`, ids)
  }))
}

function profileTabs(s: Screen, y: number): NodeId {
  const slot = W / 3
  const items: Array<[string, string]> = [['Posts', I.grid], ['Reels', I.reels], ['Tagged', I.tagged]]
  return s.group('Profile Tabs', [
    ...items.map(([label, d], i) => icon(s, `Tab / ${label}`, d, slot * i + slot / 2 - 12, y + 10, 24, i === 0 ? C.ink : C.faint, { width: i === 0 ? 2 : 1.8 })),
    s.rect('Hairline', 0, y + 44, W, 1, { fill: C.line }),
    s.rect('Indicator', 0, y + 43, slot, 1.5, { fill: C.ink }),
  ])
}

function profileGrid(s: Screen, keys: string[], pics: Pics, top: number, badges: Record<number, 'reel' | 'multi'> = {}): NodeId {
  const T = 128
  const G = 3
  return s.group('Posts Grid', keys.map((key, i) => {
    const x = (i % 3) * (T + G)
    const y = top + Math.floor(i / 3) * (T + G)
    const ids = [s.image('Photo', pics.p[key]!, x, y, T, T)]
    if (badges[i]) ids.push(tileBadge(s, badges[i], x, y, T))
    return s.group(`Post / ${key}`, ids)
  }))
}

function bio(s: Screen, name: string, category: string, lines: string, link: string, y: number): number {
  const ids: NodeId[] = [
    s.text('Name', name, 16, y, { size: 14, weight: 600 }),
    s.text('Category', category, 16, y + 19, { size: 14, color: C.grey }),
  ]
  const text = { size: 14, width: W - 32, lineHeight: 1.35 }
  const th = s.measure(lines, text).height
  ids.push(s.text('Bio', lines, 16, y + 38, text))
  const ly = y + 38 + th + 2
  ids.push(icon(s, 'Link Icon', I.link, 16, ly + 1, 16, C.link, { width: 1.8 }))
  ids.push(s.text('Link', link, 38, ly, { size: 14, weight: 600, color: C.link }))
  s.group('Bio', ids)
  return ly + 20
}

function ownProfile(s: Screen, pics: Pics): void {
  statusBar(s, C.ink)
  const title = { size: 22, weight: 700 }
  const tw = s.measure('maya.chen', title).width
  s.group('Top Bar', [
    icon(s, 'Private', I.lock, 16, 60, 16, C.ink, { width: 1.8 }),
    s.text('Username', 'maya.chen', 38, 53, title),
    icon(s, 'Switch Account', I.chevronDown, 42 + tw, 61, 16, C.ink, { width: 2.2 }),
    icon(s, 'New', I.add, 300, 55, 26),
    icon(s, 'Menu', I.menu, 348, 55, 26),
  ])
  s.group('Profile Picture', [
    avatar(s, 'maya.chen', pics.me, 58, 150, 40, 'story', { gap: 3.5, width: 3 }),
    s.circle('Add Outline', 88, 180, 12, { fill: C.white }),
    s.circle('Add', 88, 180, 10, { fill: C.ink }),
    icon(s, 'Plus', I.plus, 82, 174, 12, C.white, { width: 2 }),
  ])
  stats(s, [['248', 'posts'], ['12.4K', 'followers'], ['391', 'following']], 150)
  const after = bio(s, 'Maya Chen', 'Photographer', 'Chasing light across 31 countries.\nPrints and workshops, booking autumn ’26.', 'maya-chen.photo', 206)
  const by = after + 14
  s.group('Buttons', [
    button(s, 'Edit profile', 16, by, 155, 34, 'secondary', { size: 14, radius: 10 }),
    button(s, 'Share profile', 177, by, 155, 34, 'secondary', { size: 14, radius: 10 }),
    iconButton(s, 'Button / Discover People', I.userPlus, 338, by, 36),
  ])
  const hy = by + 50
  highlights(s, [['Iceland', pics.p.m2!], ['Kyoto', pics.p.m3!], ['Lisbon', pics.p.e11!], ['Patagonia', pics.p.m1!], ['New', null]], hy)
  const ty = hy + 92
  profileTabs(s, ty)
  profileGrid(s, ['praiaCoast', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'], pics, ty + 45, { 0: 'multi', 5: 'reel' })
  tabBar(s, 'profile', pics.me)
  homeIndicator(s, C.ink)
}

function userProfile(s: Screen, pics: Pics): void {
  statusBar(s, C.ink)
  const title = { size: 20, weight: 700 }
  const tw = s.measure(handle('Sofia'), title).width
  const tx = W / 2 - (tw + 22) / 2
  s.group('Navigation Bar', [
    icon(s, 'Back', I.back, 10, 56, 26, C.ink, { width: 2 }),
    s.text('Username', handle('Sofia'), tx, 55, title),
    verified(s, tx + tw + 6, 69, 8),
    icon(s, 'Notifications', I.bell, 306, 56, 24),
    icon(s, 'More', I.more, 350, 56, 24, C.ink, { width: 2.6 }),
  ])
  avatar(s, handle('Sofia'), pics.face.Sofia!, 58, 150, 40, 'story', { gap: 3.5, width: 3 })
  stats(s, [['1,027', 'posts'], ['86.3K', 'followers'], ['612', 'following']], 150)
  const after = bio(s, 'Sofia Rossi', 'Digital creator', 'Italian coasts, slow food and long golden hours.\nMilano, and wherever the ferry goes.', 'sofiarossi.travel', 206)
  const fy = after + 10
  const faces = [pics.face.Liam!, pics.face.Kenji!, pics.face.Aisha!]
  const fx = 16 + stackWidth(3, 10) + 8
  s.group('Followed By', [
    avatarStack(s, 'Mutuals', faces, 16, fy + 10, 10),
    rich(s, 'Text', ['Followed by ', b(handle('Liam')), ', ', b(handle('Kenji')), ' and ', b('24 others')], fx, fy + 1, { size: 13, width: W - 16 - fx }),
  ])
  const by = fy + 34
  s.group('Buttons', [
    button(s, 'Follow', 16, by, 155, 34, 'primary', { size: 14, radius: 10 }),
    button(s, 'Message', 177, by, 155, 34, 'secondary', { size: 14, radius: 10 }),
    iconButton(s, 'Button / Suggested', I.userPlus, 338, by, 36),
  ])
  const hy = by + 50
  highlights(s, [['Amalfi', pics.p.amalfi!], ['Sicily', pics.p.s5!], ['Food', pics.p.s1!], ['Milano', pics.p.s6!], ['Q&A', pics.p.s7!]], hy)
  const ty = hy + 92
  profileTabs(s, ty)
  profileGrid(s, ['amalfi', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'], pics, ty + 45, { 0: 'multi', 4: 'reel' })
  tabBar(s, 'search', pics.me)
  homeIndicator(s, C.ink)
}

// ---------------------------------------------------------------------------
// 15 Edit profile
// ---------------------------------------------------------------------------

function editProfile(s: Screen, pics: Pics): void {
  statusBar(s, C.ink)
  navBar(s, 'Edit profile', {
    left: 'none',
    right: [
      s.text('Cancel', 'Cancel', 16, 58, { size: 16 }),
      s.text('Done', 'Done', W - 16, 58, { size: 16, weight: 700, color: C.link, anchor: 'right' }),
    ],
  })
  s.group('Picture', [
    avatar(s, 'maya.chen', pics.me, W / 2, 148, 44),
    s.group('Camera Badge', [
      s.circle('Outline', W / 2 + 32, 180, 15, { fill: C.white }),
      s.circle('Background', W / 2 + 32, 180, 13, { fill: C.ink }),
      icon(s, 'Icon', I.camera, W / 2 + 24, 172, 16, C.white, { width: 1.6 }),
    ]),
    s.text('Change', 'Change profile photo', W / 2, 204, { size: 14, weight: 600, color: C.link, anchor: 'center' }),
  ])
  const field = (label: string, value: string, y: number, h = 60, chevron = false) => {
    const ids = [
      s.rect('Box', 16, y, W - 32, h, { fill: C.white, radius: 12, stroke: { color: '#DADAE0', width: 1 } }),
      s.text('Label', label, 32, y + 10, { size: 12, color: C.grey }),
      s.text('Value', value, 32, y + 28, { size: 15, width: W - 64 - (chevron ? 24 : 0), lineHeight: 1.35 }),
    ]
    if (chevron) ids.push(icon(s, 'Chevron', I.chevronRight, W - 50, y + (h - 20) / 2, 20, C.grey, { width: 1.8 }))
    return s.group(`Field / ${label}`, ids)
  }
  field('Name', 'Maya Chen', 240)
  field('Username', 'maya.chen', 312)
  field('Pronouns', 'she/her', 384)
  field('Bio', 'Chasing light across 31 countries.\nPrints and workshops, booking autumn ’26.', 456, 82)
  field('Links', 'maya-chen.photo', 550, 60, true)
  field('Gender', 'Female', 622, 60, true)
  s.group('Links / Account', [
    s.text('Professional', 'Switch to professional account', 16, 706, { size: 15, weight: 600, color: C.link }),
    s.text('Personal', 'Personal information settings', 16, 740, { size: 15, weight: 600, color: C.link }),
  ])
  homeIndicator(s, C.ink)
}

// ---------------------------------------------------------------------------
// 16 Saved
// ---------------------------------------------------------------------------

function saved(s: Screen, pics: Pics): void {
  statusBar(s, C.ink)
  navBar(s, 'Saved', { right: [icon(s, 'New Collection', I.plus, W - 40, 57, 26, C.ink, { width: 2 })] })
  const collections: Array<[string, number, string[]]> = [
    ['All posts', 312, ['sorapis', 'amalfi', 'tokyo', 'e8']],
    ['Travel ideas', 86, ['e1', 'e7', 'e11', 'tallForest']],
    ['Recipes', 41, ['e2', 'e9', 's1', 'pt3']],
    ['Café hopping', 27, ['e4', 'e14', 'm6', 's4']],
    ['Night skies', 19, ['e10', 'e6', 'm2', 'story']],
    ['Home inspo', 54, ['e3', 'e12', 'e5', 's3']],
  ]
  const cw = (W - 48) / 2
  const t = (cw - 3) / 2
  s.group('Collections', collections.map(([name, count, keys], i) => {
    const x = 16 + (i % 2) * (cw + 16)
    const y = 108 + Math.floor(i / 2) * 228
    const radii: Array<[number, number, number, number]> = [[12, 0, 0, 0], [0, 12, 0, 0], [0, 0, 0, 12], [0, 0, 12, 0]]
    const tiles = keys.map((key, j) => {
      const id = s.image(`Photo ${j + 1}`, pics.p[key]!, x + (j % 2) * (t + 3), y + Math.floor(j / 2) * (t + 3), t, t, radii[j]!)
      return key === 'story' || key.startsWith('tall') ? cover(id) : id
    })
    return s.group(`Collection / ${name}`, [
      s.group('Mosaic', tiles),
      s.text('Name', name, x, y + cw + 10, { size: 15, weight: 600 }),
      s.text('Count', `${count} posts`, x, y + cw + 30, { size: 13, color: C.grey }),
    ])
  }))
  homeIndicator(s, C.ink)
}

// ---------------------------------------------------------------------------
// 17 Messages
// ---------------------------------------------------------------------------

function messages(s: Screen, pics: Pics): void {
  statusBar(s, C.ink)
  const title = { size: 20, weight: 700 }
  const tw = s.measure('maya.chen', title).width
  const tx = W / 2 - (tw + 20) / 2
  s.group('Navigation Bar', [
    icon(s, 'Back', I.back, 10, 56, 26, C.ink, { width: 2 }),
    s.text('Title', 'maya.chen', tx, 55, title),
    icon(s, 'Switch Account', I.chevronDown, tx + tw + 4, 63, 16, C.ink, { width: 2.2 }),
    icon(s, 'New Message', I.compose, 350, 56, 24),
  ])
  searchField(s, 16, 100, W - 32)

  const notes: Array<[string, string, string]> = [
    ['Maya', 'Your note', 'Share a thought…'],
    ['Liam', handle('Liam'), 'Missing the Dolomites'],
    ['Sofia', handle('Sofia'), 'Amalfi > everything'],
    ['Kenji', handle('Kenji'), 'Kyoto tips, anyone?'],
    ['Aisha', handle('Aisha'), 'Aurora season!'],
  ]
  s.group('Notes', notes.map(([first, label, note], i) => {
    const cx = 52 + i * 90
    const cy = 236
    const text = { size: 11, color: first === 'Maya' ? C.grey : C.ink, width: 66, align: 'center' as const, lineHeight: 1.25 }
    const m = s.measure(note, text)
    const bh = m.height + 14
    const by = 190 - bh / 2
    return s.group(`Note / ${label}`, [
      avatar(s, label, pics.face[first]!, cx, cy, 32),
      s.rect('Bubble', cx - 39, by, 78, bh, { fill: C.white, radius: 14, shadow: shadow(3, 12, 0.14, 0, '#000000') }),
      s.circle('Tail', cx - 18, by + bh + 4, 3.5, { fill: C.white, shadow: shadow(1, 4, 0.12, 0, '#000000') }),
      s.text('Note', note, cx, by + 7, { ...text, anchor: 'center' }),
      s.text('Name', label, cx, cy + 38, { size: 12, color: C.grey, anchor: 'center' }),
    ])
  }))

  s.group('Section Header', [
    s.text('Title', 'Messages', 16, 304, { size: 16, weight: 700 }),
    s.text('Requests', 'Requests (2)', W - 16, 306, { size: 14, weight: 600, color: C.link, anchor: 'right' }),
  ])
  interface Chat { faces: string[]; name: string; preview: string; time: string; unread?: boolean; online?: boolean; ring?: boolean }
  const chats: Chat[] = [
    { faces: ['Sofia'], name: 'Sofia Rossi', preview: `Sent a reel by ${handle('Mateo')}`, time: '5 min', unread: true, ring: true },
    { faces: ['Liam'], name: 'Liam Carter', preview: 'Same trail as last year, haha', time: '22 min', unread: true, online: true },
    { faces: ['Mateo', 'Daniel'], name: 'Hiking Crew', preview: 'Mateo: 6am on Saturday?', time: '1h', unread: true },
    { faces: ['Kenji'], name: 'Kenji Tanaka', preview: 'You: Send me that café list!', time: '2h' },
    { faces: ['Aisha'], name: 'Aisha Khan', preview: 'Liked a message', time: '3h', online: true },
    { faces: ['Emma'], name: 'Emma Novak', preview: 'See you at the print fair', time: '1d' },
    { faces: ['Omar'], name: 'Omar Haddad', preview: 'You sent an attachment', time: '2d' },
  ]
  s.group('Conversations', chats.map((c, i) => {
    const y = 336 + i * 68
    const cy = y + 34
    const ids: NodeId[] = [
      c.faces.length > 1
        ? avatarPair(s, c.name, pics.face[c.faces[0]!]!, pics.face[c.faces[1]!]!, 16, cy - 28, 56)
        : avatar(s, c.name, pics.face[c.faces[0]!]!, 44, cy, 28, c.ring ? 'story' : 'none', { gap: 2.5, width: 2.5 }),
    ]
    if (c.online) {
      ids.push(s.circle('Online Outline', 64, cy + 20, 8, { fill: C.white }))
      ids.push(s.circle('Online', 64, cy + 20, 6, { fill: C.online }))
    }
    const pv = { size: 14, weight: c.unread ? 600 : 400, color: c.unread ? C.ink : C.grey }
    ids.push(s.text('Name', c.name, 86, cy - 20, { size: 14, weight: c.unread ? 600 : 400 }))
    ids.push(rich(s, 'Preview', [[c.preview, { weight: pv.weight, color: pv.color }], [` · ${c.time}`, { color: C.grey }]], 86, cy + 1, { size: 14 }))
    ids.push(c.unread
      ? s.circle('Unread', W - 28, cy, 5, { fill: C.pink })
      : icon(s, 'Camera', I.camera, W - 44, cy - 12, 24, C.grey, { width: 1.6 }))
    return s.group(`Conversation / ${c.name}`, ids)
  }))
  homeIndicator(s, C.ink)
}

// ---------------------------------------------------------------------------
// 18 Settings and activity
// ---------------------------------------------------------------------------

function settings(s: Screen): void {
  statusBar(s, C.ink)
  navBar(s, 'Settings and activity')
  searchField(s, 16, 100, W - 32)
  let y = 152
  const header = (label: string) => {
    const id = s.text('Header', label, 16, y, { size: 13, weight: 600, color: C.grey })
    y += 28
    return id
  }
  const row = (label: string, d: string, value?: string) => {
    const ids = [
      icon(s, 'Icon', d, 16, y + 12, 24, C.ink),
      s.text('Label', label, 54, y + 14, { size: 15 }),
      icon(s, 'Chevron', I.chevronRight, W - 36, y + 14, 20, C.faint, { width: 1.8 }),
    ]
    if (value) ids.push(s.text('Value', value, W - 42, y + 15, { size: 14, color: C.grey, anchor: 'right' }))
    const id = s.group(`Row / ${label}`, ids)
    y += 48
    return id
  }
  const band = () => {
    const id = s.rect('Separator', 0, y + 4, W, 8, { fill: C.surface })
    y += 24
    return id
  }
  const account = [
    header('Your account'),
    s.group('Row / Accounts Centre', [
      icon(s, 'Icon', I.account, 16, y + 16, 26, C.ink),
      s.text('Label', 'Accounts Centre', 56, y + 8, { size: 15 }),
      s.text('Details', 'Password, security, personal details', 56, y + 28, { size: 13, color: C.grey }),
      icon(s, 'Chevron', I.chevronRight, W - 36, y + 18, 20, C.faint, { width: 1.8 }),
    ]),
  ]
  y += 58
  s.group('Section / Your account', account)
  band()
  s.group('Section / How you use Glimpse', [
    header('How you use Glimpse'),
    row('Saved', I.bookmark),
    row('Archive', I.archive),
    row('Your activity', I.activity),
    row('Notifications', I.bell),
    row('Time management', I.clock, '42m a day'),
  ])
  band()
  s.group('Section / Who can see your content', [
    header('Who can see your content'),
    row('Account privacy', I.lock, 'Public'),
    row('Close friends', I.star, '14'),
    row('Blocked', I.block, '3'),
  ])
  band()
  s.group('Section / Your app and media', [
    header('Your app and media'),
    row('Language', I.globe, 'English'),
  ])
  homeIndicator(s, C.ink)
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export async function buildGlimpse(): Promise<DesignDocument> {
  await loadFonts({ Inter: [400, 500, 600, 700], Poppins: [600], 'Playfair Display': [700] })
  await ensureFontLoaded('Playfair Display', 700, true)

  const doc = createDocument('Glimpse — Social App', false)
  DOC = doc
  useDocument(doc)
  doc.swatches = [C.ink, C.amber, C.pink, C.violet, C.link, C.like, C.grey, C.surface, C.white].map((hex) => ({
    id: createSwatchId(),
    color: rgba(hex),
  }))

  const pics = await loadPictures(doc)
  const screens: Array<[string, string, (s: Screen) => void]> = [
    ['01 Log In', C.white, (s) => login(s)],
    ['02 Home Feed', C.white, (s) => home(s, pics)],
    ['03 Carousel Post', C.white, (s) => carousel(s, pics)],
    ['04 Story', C.black, (s) => story(s, pics)],
    ['05 Reels', C.black, (s) => reels(s, pics)],
    ['06 Explore', C.white, (s) => explore(s, pics)],
    ['07 Search Results', C.white, (s) => searchResults(s, pics)],
    ['08 Comments', C.white, (s) => comments(s, pics)],
    ['09 Activity', C.white, (s) => activity(s, pics)],
    ['10 New Post', C.white, (s) => newPost(s, pics)],
    ['11 Filters', C.white, (s) => filters(s, pics)],
    ['12 Share Post', C.white, (s) => share(s, pics)],
    ['13 Profile', C.white, (s) => ownProfile(s, pics)],
    ['14 User Profile', C.white, (s) => userProfile(s, pics)],
    ['15 Edit Profile', C.white, (s) => editProfile(s, pics)],
    ['16 Saved', C.white, (s) => saved(s, pics)],
    ['17 Messages', C.white, (s) => messages(s, pics)],
    ['18 Settings', C.white, (s) => settings(s)],
  ]
  screens.forEach(([name, background, draw], i) => {
    const { x, y } = gridPosition(i, 6, W, H)
    draw(new Screen(doc, name, x, W, H, background, y))
  })
  return doc
}

// ---------------------------------------------------------------------------
// What the build script writes
// ---------------------------------------------------------------------------

export async function buildFiles(): Promise<Record<string, string>> {
  return exampleFiles(await buildGlimpse(), 'Glimpse')
}

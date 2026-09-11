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
 * Relay's icon set: round-capped strokes on a 24-unit grid, drawn for this
 * example. The few that are easier described by their geometry than typed —
 * the gear, the star, the status ring — are computed.
 */

const f = (n: number) => Number(n.toFixed(2))

/** A point on a circle, with 0° at twelve o'clock and angles running clockwise. */
function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180
  return [f(cx + r * Math.cos(a)), f(cy + r * Math.sin(a))]
}

/** An arc from one angle to another, clockwise. */
export function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x0, y0] = polar(cx, cy, r, from)
  const [x1, y1] = polar(cx, cy, r, to)
  return `M${x0} ${y0}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`
}

function gear(): string {
  const pts: string[] = []
  for (let k = 0; k < 8; k++) {
    const a = k * 45
    for (const [da, r] of [[-15, 7.4], [-9, 9.6], [9, 9.6], [15, 7.4]] as const) {
      const [x, y] = polar(12, 12, r, a + da)
      pts.push(`${pts.length ? 'L' : 'M'}${x} ${y}`)
    }
  }
  return `${pts.join('')}Z M12 8.8a3.2 3.2 0 1 0 0 6.4a3.2 3.2 0 1 0 0-6.4z`
}

function star(): string {
  const pts: string[] = []
  for (let k = 0; k < 10; k++) {
    const [x, y] = polar(12, 12.8, k % 2 ? 4 : 9, k * 36)
    pts.push(`${k ? 'L' : 'M'}${x} ${y}`)
  }
  return `${pts.join('')}Z`
}

const RING = `${arc(12, 12, 8.5, 12, 108)} ${arc(12, 12, 8.5, 132, 228)} ${arc(12, 12, 8.5, 252, 348)}`
const CIRCLE = 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17z'
const HANDSET = 'M6.8 3.5h2.4l1.7 4.3-2.1 1.4a11.5 11.5 0 0 0 6 6l1.4-2.1 4.3 1.7v2.4a2 2 0 0 1-2.2 2.1C11.2 18.8 5.2 12.8 4.7 5.7a2 2 0 0 1 2.1-2.2z'
const CAMERA = 'M3.5 8.6a2 2 0 0 1 2-2h2.3l1.6-2.3h5.2l1.6 2.3h2.3a2 2 0 0 1 2 2v9.1a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z'
const VIDEO = 'M3 7.5a2 2 0 0 1 2-2h8.5a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M15.5 10.2l5.5-3.2v10l-5.5-3.2'
const MIC = 'M12 3.5a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0v-5a3 3 0 0 1 3-3z M5.8 11.2a6.2 6.2 0 0 0 12.4 0 M12 17.5v3'
const SPEAKER = 'M4 9.5h3.2L12 5.5v13l-4.8-4H4z'

export const I = {
  back: 'M15 4.5L7.5 12l7.5 7.5',
  chevronRight: 'M9.5 6l6 6-6 6',
  chevronDown: 'M6.5 9.5l5.5 5.5 5.5-5.5',
  chevronUp: 'M6.5 14.5L12 9l5.5 5.5',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13z M15.3 15.3L20 20',
  plus: 'M12 5v14 M5 12h14',
  close: 'M6.5 6.5l11 11 M17.5 6.5l-11 11',
  camera: `${CAMERA} M12 9.6a3.4 3.4 0 1 0 0 6.8a3.4 3.4 0 1 0 0-6.8z`,
  mic: MIC,
  micOff: `${MIC} M4 4l16 16`,
  video: VIDEO,
  videoOff: `${VIDEO} M3.5 3.5l17 17`,
  phone: HANDSET,
  newCall: `${HANDSET} M17.5 2.8v6 M14.5 5.8h6`,
  hangUp: 'M2.8 13.6c5.1-4.8 13.3-4.8 18.4 0l-2.3 2.7-3.7-1.4v-2.5a11.5 11.5 0 0 0-6.4 0v2.5l-3.7 1.4z',
  emoji: `${CIRCLE} M8.4 14a4.3 4.3 0 0 0 7.2 0 M9.2 9.6h.01 M14.8 9.6h.01`,
  sticker: 'M8 3.5h8a4.5 4.5 0 0 1 4.5 4.5v5l-7.5 7.5H8A4.5 4.5 0 0 1 3.5 16V8A4.5 4.5 0 0 1 8 3.5z M20.5 13H17a4 4 0 0 0-4 4v3.5',
  send: 'M4.5 12L20 4.5 16.5 20l-4.5-6z M12 14L20 4.5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  ticks: 'M1.5 12.8l3.8 3.8L13.8 7 M10.6 16.4l.2.2L19.3 7',
  tick: 'M4.5 12.8l3.8 3.8L16.8 7',
  pin: 'M9 3.5h6 M10.2 3.5v5.8L7 13.2h10l-3.2-3.9V3.5 M12 13.2v7.3',
  muted: `${SPEAKER} M15.5 9.5l5 5 M20.5 9.5l-5 5`,
  speaker: `${SPEAKER} M15.5 9a4.2 4.2 0 0 1 0 6 M18 6.5a7.8 7.8 0 0 1 0 11`,
  chats: 'M12 4c4.7 0 8.5 3.3 8.5 7.4s-3.8 7.4-8.5 7.4c-1.1 0-2.2-.2-3.2-.5L4.2 19.8l1.3-3.6a7 7 0 0 1-2-4.8C3.5 7.3 7.3 4 12 4z',
  bubble: 'M12 4c4.7 0 8.5 3.3 8.5 7.4s-3.8 7.4-8.5 7.4c-1.1 0-2.2-.2-3.2-.5L4.2 19.8l1.3-3.6a7 7 0 0 1-2-4.8C3.5 7.3 7.3 4 12 4z M8.5 10.5h7 M8.5 13.5h4.5',
  updates: `${RING} M12 8.8a3.2 3.2 0 1 0 0 6.4a3.2 3.2 0 1 0 0-6.4z`,
  settings: gear(),
  more: 'M5.5 12h.01 M12 12h.01 M18.5 12h.01',
  moreVertical: 'M12 5.5v.01 M12 12v.01 M12 18.5v.01',
  compose: 'M11.5 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5 M17.6 3.6l2.8 2.8-7.6 7.6H10v-2.8z',
  qr: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h2.5v2.5H14z M17.5 17.5H20V20h-2.5z M14 19.5v.5 M19.5 14v.5 M6.8 6.8h.4v.4h-.4z M16.8 6.8h.4v.4h-.4z M6.8 16.8h.4v.4h-.4z',
  key: 'M8 11a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M10.9 12.1L19 4 M15.5 7.5l2.5 2.5 M13.5 9.5l2 2',
  lock: 'M7 10.5h10a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19v-7A1.5 1.5 0 0 1 7 10.5z M8.5 10.5v-3a3.5 3.5 0 0 1 7 0v3',
  bell: 'M18 16v-5a6 6 0 0 0-12 0v5l-1.5 2h15z M10 20.5a2 2 0 0 0 4 0',
  storage: 'M8 19.5V5 M4.5 8.5L8 5l3.5 3.5 M16 4.5V19 M12.5 15.5L16 19l3.5-3.5',
  help: `${CIRCLE} M9.6 9.6a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1.1.9-1.1 1.6v.5 M12 16.8v.01`,
  info: `${CIRCLE} M12 11v5.5 M12 7.8v.01`,
  heart: 'M12 19.5s-7-4.3-7-9.4A4 4 0 0 1 12 7.6a4 4 0 0 1 7 2.5c0 5.1-7 9.4-7 9.4z',
  star: star(),
  timer: 'M12 3.5a8.5 8.5 0 1 1-8.5 8.5 M12 7.5V12l3 2 M4.6 7.8v.01 M7.4 4.8v.01',
  block: `${CIRCLE} M6 6l12 12`,
  flag: 'M5.5 21V4 M5.5 4.5h11.5l-2.2 4 2.2 4H5.5',
  people: 'M9 4.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7z M2.5 19.5c.8-3.3 3.3-5.2 6.5-5.2s5.7 1.9 6.5 5.2 M16 4.8a3.2 3.2 0 0 1 0 6.4 M18.2 14.4c1.8.6 2.9 2.3 3.3 5.1',
  personAdd: 'M10 4.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7z M3.5 19.5c.8-3.3 3.3-5.2 6.5-5.2 1.9 0 3.6.7 4.8 1.9 M18.5 13v6 M15.5 16h6',
  community: 'M12 4.8a2.8 2.8 0 1 0 0 5.6a2.8 2.8 0 1 0 0-5.6z M5.6 7.6a2.3 2.3 0 1 0 0 4.6a2.3 2.3 0 1 0 0-4.6z M18.4 7.6a2.3 2.3 0 1 0 0 4.6a2.3 2.3 0 1 0 0-4.6z M7.5 19.2c.6-3 2.3-4.6 4.5-4.6s3.9 1.6 4.5 4.6 M2.2 18.2c.4-2.1 1.6-3.3 3.3-3.6 M21.8 18.2c-.4-2.1-1.6-3.3-3.3-3.6',
  link: 'M10.2 13.8a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1 M13.8 10.2a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1',
  doc: 'M6.5 3.5h7l4.5 4.5v12.5h-11.5z M13.5 3.5V8H18',
  location: 'M12 21s-6.5-5.9-6.5-11a6.5 6.5 0 0 1 13 0c0 5.1-6.5 11-6.5 11z M12 7.6a2.4 2.4 0 1 0 0 4.8a2.4 2.4 0 1 0 0-4.8z',
  play: 'M8 5.2v13.6L18.8 12z',
  image: 'M5 5h14a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5v-11A1.5 1.5 0 0 1 5 5z M3.5 16l4.8-4.8 4 4 2.4-2.4 5.8 5.8 M15.5 8.8h.01',
  flip: `${CAMERA} M9 13a3 3 0 0 1 5.4-1.8 M15 13a3 3 0 0 1-5.4 1.8 M14.6 9.4v1.9h-1.9 M9.4 16.6v-1.9h1.9`,
  globe: `${CIRCLE} M3.5 12h17 M12 3.5c-2.4 2.4-3.4 5.3-3.4 8.5s1 6.1 3.4 8.5 M12 3.5c2.4 2.4 3.4 5.3 3.4 8.5s-1 6.1-3.4 8.5`,
  backspace: 'M8.8 5.5H19a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H8.8L3.2 12z M11 9.5l5 5 M16 9.5l-5 5',
  shift: 'M12 4.2l7.6 8.3h-4.1v6.8h-7v-6.8H4.4z',
  incoming: 'M17 7L7 17 M7 9.5V17h7.5',
  outgoing: 'M7 17L17 7 M9.5 7H17v7.5',
  clock: `${CIRCLE} M12 7.5V12l3 2`,
  archive: 'M4 5h16v4H4z M5.5 9v10h13V9 M10 12.5h4',
  filter: 'M4 6.5h16 M7 12h10 M10 17.5h4',
  poll: 'M5 20V10 M10 20V4.5 M15 20v-7 M20 20v-4',
  arrowUp: 'M12 19V5 M6 11l6-6 6 6',
  reply: 'M9.5 7L4 12l5.5 5 M4.5 12h9.5a6 6 0 0 1 6 6',
  gallery: 'M7.5 3.5h11a2 2 0 0 1 2 2v11 M5.5 6.5h11a1.5 1.5 0 0 1 1.5 1.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5z M4 16.5l4-4 3.5 3.5 2-2 4.5 4.5',
}

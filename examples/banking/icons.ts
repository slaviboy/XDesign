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
 * Nova's icon set: one stroke weight, round caps and joins, drawn on a
 * 24-unit grid with a 2-unit safe area. Every icon is an open outline so it
 * reads the same at 16 px in a list and at 28 px on a button.
 */

/** A circle as path data, for icons that need a dot or a ring. */
function ring(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0z`
}

/** A cog with `teeth` flat-topped teeth, for Settings. */
function cog(teeth = 8, outer = 9.5, inner = 7.4): string {
  const points: string[] = []
  const step = (Math.PI * 2) / teeth
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2
    const corners = [
      [a - step * 0.36, inner],
      [a - step * 0.2, outer],
      [a + step * 0.2, outer],
      [a + step * 0.36, inner],
    ] as const
    for (const [angle, r] of corners) points.push(`${(12 + Math.cos(angle) * r).toFixed(2)} ${(12 + Math.sin(angle) * r).toFixed(2)}`)
  }
  return `M${points.join('L')}Z ${ring(12, 12, 3)}`
}

export const I = {
  // Tabs
  home: 'M3.5 10.5L12 3.5l8.5 7 M5.5 9v11.5h13V9 M10 20.5V15h4v5.5',
  invest: 'M3.5 17.5l5.5-5.5 4 3.5 7.5-8 M15.5 7.5h4.5V12',
  payments: 'M4 8h15 M15.5 4.5L19 8l-3.5 3.5 M20 16H5 M8.5 12.5L5 16l3.5 3.5',
  crypto: 'M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z M12 8l4 4-4 4-4-4z',
  hub: 'M4 4h6.5v6.5H4z M13.5 4H20v6.5h-6.5z M4 13.5h6.5V20H4z M13.5 13.5H20V20h-6.5z',

  // Actions
  plus: 'M12 5v14 M5 12h14',
  move: 'M7.5 19.5v-15 M4 8l3.5-3.5L11 8 M16.5 4.5v15 M13 16l3.5 3.5L20 16',
  details: 'M6 3.5h8.5L19 8v12.5H6z M14 3.5v5h5 M9 12.5h7 M9 16h7',
  more: `${ring(5.5, 12, 1.2)} ${ring(12, 12, 1.2)} ${ring(18.5, 12, 1.2)}`,
  bell: 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z M10 20.5a2 2 0 0 0 4 0',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13z M20 20l-4.6-4.6',
  back: 'M15 5l-7 7 7 7',
  chevronRight: 'M9.5 6l6 6-6 6',
  chevronDown: 'M6.5 9.5l5.5 5.5 5.5-5.5',
  chevronLeft: 'M14.5 6l-6 6 6 6',
  close: 'M6 6l12 12 M18 6L6 18',
  sliders: 'M4 7h9 M17 7h3 M15 4.5v5 M4 17h3 M11 17h9 M9 14.5v5',
  copy: 'M8.5 8.5h11v11h-11z M15.5 8.5v-4h-11v11h4',
  download: 'M12 4v11 M7.5 10.5L12 15l4.5-4.5 M5 19.5h14',
  share: 'M12 14.5V3.5 M8 7.5l4-4 4 4 M6.5 11H5.5v9h13v-9h-1',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  edit: 'M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4',
  send: 'M7 17L17 7 M9 7h8v8',
  request: 'M17 7L7 17 M15 17H7V9',
  exchange: 'M19.5 9.5A8 8 0 0 0 5.2 7 M4.5 3.5v4h4 M4.5 14.5A8 8 0 0 0 18.8 17 M19.5 20.5v-4h-4',
  swapVertical: 'M8 4.5v15 M4.5 16L8 19.5l3.5-3.5 M16 19.5v-15 M12.5 8L16 4.5 19.5 8',
  arrowDown: 'M12 5v14 M6 13l6 6 6-6',
  arrowUp: 'M12 19V5 M6 11l6-6 6 6',
  arrowRight: 'M5 12h14 M13 6l6 6-6 6',
  split: 'M12 21v-7 M12 14L6.5 8.5 M12 14l5.5-5.5 M5 4.5v5h5 M19 4.5v5h-5',
  users: `${ring(9, 8, 3.5)} M2.5 19.5c.8-3.3 3.3-5 6.5-5s5.7 1.7 6.5 5 M16 4.5a3.5 3.5 0 0 1 0 7 M18 14.5c1.9.6 3.1 2.2 3.5 5`,
  userPlus: `${ring(10, 8, 3.8)} M3.5 20c.9-3.5 3.4-5.3 6.5-5.3 1.5 0 2.9.4 4 1.2 M18.5 13v7 M15 16.5h7`,

  // Cards and security
  card: 'M3 6h18v12H3z M3 10h18 M6.5 14.5h4',
  snowflake: 'M12 3v18 M4.2 7.5l15.6 9 M4.2 16.5l15.6-9 M9.5 4.2L12 6.2l2.5-2 M9.5 19.8l2.5-2 2.5 2',
  eye: `M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z ${ring(12, 12, 3)}`,
  gauge: 'M3.5 17a8.5 8.5 0 1 1 17 0 M12 17l3.8-5.2 M3.5 20.5h17',
  gear: cog(),
  contactless: 'M7.5 9a4.2 4.2 0 0 1 0 6 M11 6.5a7.8 7.8 0 0 1 0 11 M14.5 4a11.3 11.3 0 0 1 0 16',
  globe: `${ring(12, 12, 9)} M3 12h18 M12 3c-3.2 3-3.2 15 0 18 M12 3c3.2 3 3.2 15 0 18`,
  cash: `M3 6.5h18v11H3z ${ring(12, 12, 2.5)} M6.5 9.5v5 M17.5 9.5v5`,
  magstripe: 'M3 6h18v12H3z M3 9.5h18 M3 12h18',
  mapPin: `M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z ${ring(12, 10, 2.5)}`,
  shield: 'M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6z M8.5 12l2.5 2.5 4.5-5',
  lock: 'M6 10.5h12v10H6z M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3',
  faceId: 'M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8 M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8 M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16 ' +
    'M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16 M9 9v1.5 M15 9v1.5 M12 9v4h-1 M9 15.5c1.8 1.5 4.2 1.5 6 0',
  backspace: 'M8.5 5.5H20v13H8.5L3 12z M11.5 9.5l5 5 M16.5 9.5l-5 5',
  gamble: 'M4.5 4.5h15v15h-15z M9 9h.01 M15 15h.01 M15 9h.01 M9 15h.01',

  // Payments hub
  calendar: 'M4 6h16v14H4z M4 10.5h16 M8.5 3.5v4 M15.5 3.5v4',
  receipt: 'M6 3.5h12v17l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5z M9 8.5h6 M9 12h6 M9 15.5h3.5',
  repeat: 'M4 11V9.5a3 3 0 0 1 3-3h13 M17 3.5l3 3-3 3 M20 13v1.5a3 3 0 0 1-3 3H4 M7 20.5l-3-3 3-3',
  bank: 'M3.5 9.5L12 4l8.5 5.5z M5.5 10v7 M9.8 10v7 M14.2 10v7 M18.5 10v7 M3.5 20h17',
  phone: 'M5.5 3.5h3.5l2 5-2.5 1.5a11 11 0 0 0 5.5 5.5l1.5-2.5 5 2v3.5a2 2 0 0 1-2 2A16.5 16.5 0 0 1 3.5 5.5a2 2 0 0 1 2-2z',
  qr: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h2.5v2.5H14z M18 18h2v2h-2z M18 14h2 M14 19h2',

  // Merchants and categories
  cart: `M3 4h2.5l2 11h11l2-8H6.3 ${ring(9.5, 19.3, 1.3)} ${ring(17, 19.3, 1.3)}`,
  coffee: 'M4.5 9h12v4.5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5z M16.5 10.5h1.3a2.5 2.5 0 0 1 0 5h-1.8 M8 3.5v2.5 M12 3.5v2.5 M4 21h14',
  tram: 'M6 4.5h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z M5 11h14 M8 16.5L6.5 20 M16 16.5l1.5 3.5 M8.5 13.8h.01 M15.5 13.8h.01',
  play: 'M3.5 5h17v12.5h-17z M10 8.3v6l5-3z M8 20.5h8',
  bag: 'M5 8h14l-1.2 12.5H6.2z M9 8V6.5a3 3 0 0 1 6 0V8',
  bolt: 'M13 3L5 13.5h6L10 21l8-10.5h-6z',
  dumbbell: 'M6.5 7v10 M17.5 7v10 M3.5 9.5v5 M20.5 9.5v5 M6.5 12h11',
  suitcase: 'M4 7.5h16v12H4z M9 7.5V5h6v2.5 M4 12.5h16',
  laptop: 'M5 5.5h14v10H5z M2.5 18.5h19',
  utensils: 'M7 3.5v17 M4.5 3.5v5a2.5 2.5 0 0 0 5 0v-5 M16.5 20.5v-17c-2.5 1-3.5 4-3.5 7.5h3.5',
  briefcase: 'M3.5 7.5h17v12h-17z M9 7.5V5h6v2.5 M3.5 13h17',
  heart: 'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z',
  shield2: 'M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6z',
  plane: 'M21 12L3 5l3 7-3 7z M6 12h7',

  // Wealth
  vault: `M4 4.5h16v14H4z ${ring(12, 11.5, 3.5)} M12 11.5h2.5 M6.5 18.5v2 M17.5 18.5v2`,
  trendUp: 'M4 16.5l5-5 3.5 3.5L20 7.5 M15.5 7.5H20V12',
  pie: 'M11 4a8 8 0 1 0 8.9 9H11z M14 3v7h7a7 7 0 0 0-7-7z',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z',
  percent: `M18 6L6 18 ${ring(7.5, 7.5, 2.5)} ${ring(16.5, 16.5, 2.5)}`,
  clock: `${ring(12, 12, 9)} M12 7.5V12l3 2`,
  info: `${ring(12, 12, 9)} M12 11v5.5 M12 7.8h.01`,
  bellAlert: 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z M10 20.5a2 2 0 0 0 4 0 M20 4.5l1.5-1.5 M4 4.5L2.5 3',

  // Profile
  user: `${ring(12, 8, 4)} M4.5 20.5c1.4-3.8 4.2-5.8 7.5-5.8s6.1 2 7.5 5.8`,
  help: `${ring(12, 12, 9)} M9.5 9.5a2.5 2.5 0 0 1 5 0c0 1.8-2.5 2-2.5 4 M12 17h.01`,
  gift: 'M4 9h16v4H4z M5.5 13h13v7.5h-13z M12 9v11.5 M12 9c-1-3-5-4-5-1.5S12 9 12 9z M12 9c1-3 5-4 5-1.5S12 9 12 9z',
  sun: `${ring(12, 12, 4)} M12 2.5v2 M12 19.5v2 M2.5 12h2 M19.5 12h2 M5.3 5.3l1.4 1.4 M17.3 17.3l1.4 1.4 M5.3 18.7l1.4-1.4 M17.3 6.7l1.4-1.4`,
  language: 'M4 5h9 M8.5 3v2 M11 5c-.8 4.5-3.5 8-7 9.5 M6 8.5c1.3 2.4 3.3 4.2 5.5 5.2 M13 21l4-10 4 10 M14.5 17.5h5',
  logout: 'M14 4H5v16h9 M10 12h10.5 M17 8.5l3.5 3.5-3.5 3.5',
  document: 'M6 3.5h8.5L19 8v12.5H6z M14 3.5v5h5',
  crown: 'M3.5 8l4.5 4 4-7 4 7 4.5-4-2 11h-13z',
  sparkle: 'M12 3l1.8 5.6L19.5 10l-5.7 1.6L12 17l-1.8-5.4L4.5 10l5.7-1.4z M19 16l.8 2.2 2.2.8-2.2.8L19 22l-.8-2.2-2.2-.8 2.2-.8z',
}

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
 * Glimpse's icon set: thin, round-capped strokes on a 24-unit grid, drawn for
 * this example. Every icon is one path, so it arrives in the document as a
 * single editable outline that can be restroked or recoloured as a whole.
 */

export const I = {
  home: 'M3.5 10.2L12 3.5l8.5 6.7V19.5a1 1 0 0 1-1 1H15v-6h-6v6H4.5a1 1 0 0 1-1-1z',
  search: 'M10.5 3.5a7 7 0 1 0 0 14a7 7 0 1 0 0-14z M15.6 15.6L20.5 20.5',
  add: 'M7 3.5h10a3.5 3.5 0 0 1 3.5 3.5v10a3.5 3.5 0 0 1-3.5 3.5H7A3.5 3.5 0 0 1 3.5 17V7A3.5 3.5 0 0 1 7 3.5z M12 8v8 M8 12h8',
  reels: 'M7.5 2.5h9A2.5 2.5 0 0 1 19 5v14a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 19V5a2.5 2.5 0 0 1 2.5-2.5z M10.3 8.8v6.4l5-3.2z',
  heart: 'M12 20.3C12 20.3 3 15.1 3 9.1C3 6.3 5.1 4.2 7.7 4.2c1.8 0 3.4 1 4.3 2.5c.9-1.5 2.5-2.5 4.3-2.5c2.6 0 4.7 2.1 4.7 4.9c0 6-9 11.2-9 11.2z',
  comment: 'M20.5 11.6A8.4 8.4 0 0 1 8.3 19.1L3.6 20.4l1.3-4.4A8.4 8.4 0 1 1 20.5 11.6z',
  send: 'M21 3.5L3 10.3l7.2 3.1L13.4 20.6z M21 3.5L10.2 13.4',
  bookmark: 'M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4.6-6.5 4.6v-16a1 1 0 0 1 1-1z',
  more: 'M5.5 12h.01 M12 12h.01 M18.5 12h.01',
  back: 'M15 5l-7 7 7 7',
  chevronRight: 'M9.5 5.5l6.5 6.5-6.5 6.5',
  chevronDown: 'M6.5 9.5l5.5 5.5 5.5-5.5',
  close: 'M6 6l12 12 M18 6L6 18',
  camera: 'M4.5 7.5h3l1.6-2.5h5.8l1.6 2.5h3A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5V9a1.5 1.5 0 0 1 1.5-1.5z M12 9.8a3.6 3.6 0 1 0 0 7.2a3.6 3.6 0 1 0 0-7.2z',
  menu: 'M3.5 6.5h17 M3.5 12h17 M3.5 17.5h17',
  grid: 'M4 4h16v16H4z M9.33 4v16 M14.67 4v16 M4 9.33h16 M4 14.67h16',
  tagged: 'M5.5 3.5h13a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z M12 7.3a3 3 0 1 0 0 6a3 3 0 1 0 0-6z M6.6 20.4c1-2.8 3-4.3 5.4-4.3s4.4 1.5 5.4 4.3',
  user: 'M12 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M4.5 20.5c1.4-3.8 4.2-5.8 7.5-5.8s6.1 2 7.5 5.8',
  userPlus: 'M10 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M3 20.5c1.3-3.6 3.9-5.5 7-5.5s5.7 1.9 7 5.5 M19 8v6 M16 11h6',
  pin: 'M12 21s-6.5-5.9-6.5-11a6.5 6.5 0 0 1 13 0c0 5.1-6.5 11-6.5 11z M12 7.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z',
  music: 'M9 17.5V5.8l11-2.3v11.7 M9 17.5a3 3 0 1 1-6 0a3 3 0 1 1 6 0z M20 15.2a3 3 0 1 1-6 0a3 3 0 1 1 6 0z',
  link: 'M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2 M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2',
  lock: 'M6 10.5h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z M8 10.5V7.5a4 4 0 0 1 8 0v3',
  bell: 'M18 16.5V11a6 6 0 0 0-12 0v5.5l-1.5 2h15z M10 21a2 2 0 0 0 4 0',
  clock: 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17z M12 7.5V12l3 2',
  archive: 'M4 12a8 8 0 1 0 2.4-5.7 M4 4.5v3.8h3.8 M12 8v4.2l2.8 1.8',
  activity: 'M3.5 12h3.5l2.5-6 5 12 2.5-6h3.5',
  star: 'M12 3.8l2.5 5.2 5.6.8-4.1 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.8z',
  block: 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17z M6 6l12 12',
  globe: 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17z M3.5 12h17 M12 3.5c2.4 2.3 3.6 5.2 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.2-3.6-8.5s1.2-6.2 3.6-8.5z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  shield: 'M12 3.5l7 2.8v5.2c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9V6.3z M9 12l2.2 2.2L15.5 10',
  account: 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17z M12 7.5a3 3 0 1 0 0 6a3 3 0 1 0 0-6z M6.3 18.3c1.2-2 3.3-3.1 5.7-3.1s4.5 1.1 5.7 3.1',
  multi: 'M8 3.5h10.5a2 2 0 0 1 2 2V16 M5.5 7.5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2z',
  smile: 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17z M8.5 14a4.2 4.2 0 0 0 7 0 M9 9.5h.01 M15 9.5h.01',
  compose: 'M11 4.5H6a2 2 0 0 0-2 2v11.5a2 2 0 0 0 2 2h11.5a2 2 0 0 0 2-2V13 M17.8 3.7a2 2 0 0 1 2.8 2.8L12 15l-3.6.8.8-3.6z',
  eye: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z',
  eyeOff: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z M4 4l16 16',
  key: 'M7.5 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M11.5 12H21 M17.5 12v3 M20.5 12v2.5',
  plus: 'M12 5v14 M5 12h14',
  play: 'M7.5 4.8v14.4L19 12z',
  sliders: 'M4 7h9 M17 7h3 M15 4.5v5 M4 17h3 M11 17h9 M9 14.5v5',
  cancel: 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17z M9 9l6 6 M15 9l-6 6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  help: 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17z M9.6 9.6a2.5 2.5 0 0 1 4.8.8c0 1.7-2.4 2.2-2.4 3.7 M12 17h.01',
}

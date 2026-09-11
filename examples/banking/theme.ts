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
 * Nova's design tokens: the palette, the two type families, the shadows and
 * the screen metrics every screen of the example is laid out against.
 */

import { shadow } from '../kit'

export const W = 390
export const H = 844
/** The side margin: every screen's content sits between 24 and 366. */
export const M = 24
/** The width between the margins. */
export const CW = W - M * 2

export const C = {
  accent: '#3D5AFE',
  accentDeep: '#2438D8',
  accentSoft: '#ECEFFF',
  violet: '#7B61FF',
  ink: '#0D0E1A',
  ink2: '#30323F',
  grey: '#6B6E82',
  faint: '#A3A6B7',
  line: '#ECEDF2',
  surface: '#F4F5F8',
  white: '#FFFFFF',
  green: '#0FA968',
  greenSoft: '#E2F6EC',
  red: '#EF4438',
  redSoft: '#FDECEA',
  orange: '#FF8A1F',
  orangeSoft: '#FFF1E2',
  pink: '#EC4899',
  pinkSoft: '#FDE8F3',
  teal: '#12B5A6',
  tealSoft: '#DDF5F2',
  yellow: '#F5A524',
  yellowSoft: '#FEF3DC',
  purple: '#8B5CF6',
  purpleSoft: '#F0EAFF',
  sky: '#0EA5E9',
  skySoft: '#E0F3FD',
  rose: '#F43F5E',
  roseSoft: '#FEE7EB',
  gold: '#D9A441',
  // The dark screens: the metal card and the plans.
  night: '#0A0B14',
  nightCard: '#161826',
  nightLine: '#252838',
  nightGrey: '#8C8FA5',
}

/** Headings and figures in DM Sans; everything else in Inter. */
export const DISPLAY = 'DM Sans'
export const BODY = 'Inter'

export const FONTS: Record<string, number[]> = {
  Inter: [400, 500, 600, 700],
  'DM Sans': [500, 600, 700],
  'Roboto Mono': [500],
}

export const CARD_SHADOW = shadow(4, 18, 0.05)
export const LIFT_SHADOW = shadow(10, 28, 0.08)

/** Euros, dollars or pounds with thousands separators and a real minus sign. */
export function money(n: number, symbol = '€', o: { sign?: boolean; decimals?: number } = {}): string {
  const d = o.decimals ?? 2
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
  const sign = n < 0 ? '−' : o.sign && n > 0 ? '+' : ''
  return `${sign}${symbol}${abs}`
}

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
 * Device chrome every example shares: the status bar across the top and the
 * home indicator along the bottom. Both take their colour, so they read on a
 * dark screen as well as a light one, and fit whatever width the screen is —
 * a phone upright, a phone on its side, a tablet.
 */

import type { NodeId } from '@/document/types'
import { solid, type Screen } from './kit'

const WIFI = 'M2.5 9a14 14 0 0 1 19 0 M5.5 12.5a9.5 9.5 0 0 1 13 0 M9 16a4.5 4.5 0 0 1 6 0 M12 19.5h.01'

/**
 * The status bar: the time on the left, signal, Wi-Fi and battery on the
 * right. `top` moves it down, for a screen with something above it; `wide`
 * gives the tablet form, with the date beside the time.
 */
export function statusBar(s: Screen, color = '#000000', o: { top?: number; wide?: boolean } = {}): NodeId {
  const top = o.top ?? 0
  const right = s.width - (o.wide ? 24 : 30)
  const ids = [
    s.text('Time', o.wide ? '9:41  Mon Sep 11' : '9:41', o.wide ? 24 : 30, top + 14, {
      size: o.wide ? 13 : 15, weight: 600, family: o.wide ? 'Inter' : 'Poppins', color,
    }),
    ...[4, 6.5, 9, 11.5].map((h, i) =>
      s.rect(`Signal ${i + 1}`, right - 72 + i * 5, top + 29 - h, 3, h, { fill: color, radius: 1 }),
    ),
    s.icon('Wi-Fi', WIFI, right - 52, top + 14, 17, color, { width: 1.8 }),
    s.rect('Battery', right - 30, top + 17, 24, 12, { fill: solid(color, 0), radius: 3.5, stroke: { color, width: 1, alpha: 0.4 } }),
    s.rect('Battery Level', right - 28, top + 19, 18, 8, { fill: color, radius: 2 }),
    s.rect('Battery Cap', right - 5, top + 21, 2, 4, { fill: color, radius: 1, opacity: 0.4 }),
  ]
  return s.group('Status Bar', ids)
}

/** The bar along the bottom of a phone without a home button. */
export function homeIndicator(s: Screen, color = '#000000'): NodeId {
  return s.rect('Home Indicator', (s.width - 134) / 2, s.height - 13, 134, 5, { fill: color, radius: 3 })
}

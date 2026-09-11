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
 * The one set of facts every screen draws from, so the figures agree: it is
 * Friday 11 September 2026, 9:41, and Emma Novak banks with Nova in Lisbon.
 *
 * Accounts   EUR €8,420.55 · USD $2,150.00 · GBP £1,305.40
 * Rates      1 EUR = 1.0850 USD · 1 GBP = 1.1720 EUR
 * Total      €8,420.55 + €1,981.57 + €1,529.93 = €11,932.05
 * Spending   September so far, by category, adds up to €1,486.30
 * Vaults     €2,850 + €1,100 + €2,890 = €6,840 at 3.25% AER
 * Transfer   €120.00 to Sofia leaves €8,300.55 in the EUR account
 * Split      Lumo Trattoria, €184.00 between four: €46.00 each
 */

import type { ImageAsset } from '@/document/types'
import type { Badge, Tx } from './ui'
import { C } from './theme'
import { I } from './icons'

export const USER = { first: 'Emma', name: 'Emma Novak', handle: '@emmanovak', phone: '+351 912 480 317' }

export const ACCOUNTS = {
  eur: { code: 'EUR', name: 'Euro', symbol: '€', balance: 8420.55, iban: 'NV24 0102 3344 5566 7788 99', last4: '7788' },
  usd: { code: 'USD', name: 'US Dollar', symbol: '$', balance: 2150.0, iban: 'NV24 0102 3344 5566 1204 17', last4: '1204' },
  gbp: { code: 'GBP', name: 'British Pound', symbol: '£', balance: 1305.4, iban: 'NV24 0102 3344 5566 6031 52', last4: '6031' },
} as const

export const EUR_USD = 1.085
export const GBP_EUR = 1.172
export const TOTAL_EUR = 11932.05

export const MERCHANT: Record<string, Badge> = {
  grocer: { kind: 'solid', icon: I.cart, color: '#16A34A' },
  bean: { kind: 'solid', icon: I.coffee, color: '#C2410C' },
  lumo: { kind: 'solid', icon: I.utensils, color: C.rose },
  cityline: { kind: 'solid', icon: I.tram, color: C.sky },
  streamly: { kind: 'solid', icon: I.play, color: C.purple },
  atelier: { kind: 'solid', icon: I.bag, color: C.pink },
  voltra: { kind: 'solid', icon: I.bolt, color: C.yellow },
  pulse: { kind: 'solid', icon: I.dumbbell, color: C.teal },
  casa: { kind: 'solid', icon: I.home, color: C.accent },
  salary: { kind: 'solid', icon: I.briefcase, color: C.ink2 },
  exchange: { kind: 'soft', icon: I.exchange, color: C.accent, bg: C.accentSoft },
  vault: { kind: 'soft', icon: I.vault, color: C.teal, bg: C.tealSoft },
}

/** Everything the app draws from a person: their avatar, by first name. */
export type People = Record<string, ImageAsset>

export const CAST = [
  'Emma', 'Maya', 'Liam', 'Sofia', 'Kenji', 'Aisha', 'Chloe', 'Daniel', 'Ethan', 'Grace', 'Isabella', 'Jonas', 'Lucas', 'Noah', 'Priya',
]

/** The last few days of the EUR account, newest first. */
export function recent(people: People): Array<{ day: string; total: number; rows: Tx[] }> {
  return [
    {
      day: 'Today, Fri 11 Sep',
      total: -39.0,
      rows: [
        { title: 'Grocer & Co', subtitle: 'Groceries · 08:42', amount: -34.8, badge: MERCHANT.grocer! },
        { title: 'Bean There', subtitle: 'Café · 07:55', amount: -4.2, badge: MERCHANT.bean! },
      ],
    },
    {
      day: 'Yesterday, Thu 10 Sep',
      total: -141.9,
      rows: [
        { title: 'Lumo Trattoria', subtitle: 'Restaurants · 20:40', amount: -184.0, badge: MERCHANT.lumo! },
        { title: 'Maya Chen', subtitle: 'Cinema & snacks · 19:12', amount: 45.0, badge: { kind: 'avatar', asset: people.Maya! } },
        { title: 'CityLine Transit', subtitle: 'Transport · 08:10', amount: -2.9, badge: MERCHANT.cityline! },
      ],
    },
    {
      day: 'Wed 9 Sep',
      total: -100.99,
      rows: [
        { title: 'Atelier Nord', subtitle: 'Shopping · 18:25', amount: -89.0, badge: MERCHANT.atelier! },
        { title: 'Streamly', subtitle: 'Subscriptions · 06:00', amount: -11.99, badge: MERCHANT.streamly! },
      ],
    },
  ]
}

/** September's spending by category — it adds up to €1,486.30. */
export const SPENDING: Array<{ name: string; amount: number; budget?: number; color: string; soft: string; icon: string }> = [
  { name: 'Groceries', amount: 412.6, budget: 600, color: '#16A34A', soft: '#E3F6EA', icon: I.cart },
  { name: 'Shopping', amount: 348.9, budget: 300, color: C.pink, soft: C.pinkSoft, icon: I.bag },
  { name: 'Restaurants', amount: 286.4, budget: 350, color: C.rose, soft: C.roseSoft, icon: I.utensils },
  { name: 'Bills', amount: 214.2, budget: 250, color: C.yellow, soft: C.yellowSoft, icon: I.bolt },
  { name: 'Transport', amount: 164.2, budget: 200, color: C.sky, soft: C.skySoft, icon: I.tram },
  { name: 'Other', amount: 60.0, color: C.purple, soft: C.purpleSoft, icon: I.more },
]
export const SPENT = 1486.3

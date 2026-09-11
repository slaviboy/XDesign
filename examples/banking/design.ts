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
 * "Nova" — a neobank app, built as an XDesign document.
 *
 * Twenty-four iPhone screens (390 × 844), six to a row in flow order: the way
 * in, home and accounts, cards, payments, money tools, investing and crypto,
 * and the profile. White and pale-grey surfaces, near-black type, one electric
 * indigo accent, DM Sans figures over Inter text, and two dark screens — the
 * metal card and the plans — for contrast.
 *
 * Everything is editable artwork: named component groups, real text, flags and
 * card faces drawn from shapes, charts as paths with gradient areas, stroke
 * icons on a 24-unit grid. The only bitmaps are the welcome hero and the
 * people's portraits.
 */

import '@/styles/fonts'
import { createDocument } from '@/document/NodeFactory'
import { createSwatchId } from '@/document/ids'
import type { DesignDocument } from '@/document/types'
import { gridPosition, loadFonts, rgba, Screen } from '../kit'
import { exampleFiles } from '../output'
import { C, FONTS, H, W } from './theme'
import { heroAsset, peopleAssets } from './art'
import { CAST } from './data'
import { signUp, verify, welcome } from './onboarding'
import { account, home, transactionDetail, transactions } from './home'
import { cardDetail, cardSettings, cards } from './cards'
import { paymentsHub, sendAmount, sendRecipient, sendReview, sendSuccess, splitBill } from './payments'
import { analytics, exchange, vaults } from './money'
import { crypto, invest, stockDetail } from './wealth'
import { plans, profile } from './profile'

export async function buildNova(): Promise<DesignDocument> {
  await loadFonts(FONTS)
  const doc = createDocument('Nova — Banking App', false)
  doc.swatches = [C.accent, C.accentDeep, C.ink, C.grey, C.surface, C.green, C.red, C.orange, C.pink, C.teal, C.purple, C.night].map((hex) => ({
    id: createSwatchId(),
    color: rgba(hex),
  }))

  const hero = await heroAsset(doc)
  const people = await peopleAssets(doc, CAST)

  const screens: Array<[string, string, (s: Screen) => void]> = [
    ['01 Welcome', C.white, (s) => welcome(s, hero)],
    ['02 Sign Up', C.white, (s) => signUp(s)],
    ['03 Verify Code', C.white, (s) => verify(s)],
    ['04 Home', C.surface, (s) => home(s, people)],
    ['05 Euro Account', C.surface, (s) => account(s)],
    ['06 Transactions', C.surface, (s) => transactions(s, people)],
    ['07 Transaction Detail', C.surface, (s) => transactionDetail(s)],
    ['08 Cards', C.surface, (s) => cards(s)],
    ['09 Metal Card', C.night, (s) => cardDetail(s)],
    ['10 Card Settings', C.surface, (s) => cardSettings(s)],
    ['11 Payments', C.surface, (s) => paymentsHub(s, people)],
    ['12 Send · Recipient', C.white, (s) => sendRecipient(s, people)],
    ['13 Send · Amount', C.white, (s) => sendAmount(s, people)],
    ['14 Send · Review', C.surface, (s) => sendReview(s, people)],
    ['15 Transfer Sent', C.white, (s) => sendSuccess(s)],
    ['16 Split Bill', C.white, (s) => splitBill(s, people)],
    ['17 Exchange', C.surface, (s) => exchange(s)],
    ['18 Spending Analytics', C.surface, (s) => analytics(s)],
    ['19 Savings Vaults', C.surface, (s) => vaults(s)],
    ['20 Invest', C.surface, (s) => invest(s)],
    ['21 Stock Detail', C.white, (s) => stockDetail(s)],
    ['22 Crypto', C.surface, (s) => crypto(s)],
    ['23 Profile', C.surface, (s) => profile(s, people)],
    ['24 Plans', C.night, (s) => plans(s)],
  ]
  screens.forEach(([name, background, draw], i) => {
    const { x, y } = gridPosition(i, 6, W, H)
    draw(new Screen(doc, name, x, W, H, background, y))
  })
  return doc
}

export async function buildFiles(): Promise<Record<string, string>> {
  return exampleFiles(await buildNova(), 'Nova Bank')
}

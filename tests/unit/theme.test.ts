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
 * Theme palette contrast.
 *
 * This exists because the first dark palette shipped four WCAG AA failures that
 * looked fine by eye — --text-faint at 3.33:1 (every section title and field
 * label), and white on the accent at 3.91:1, which was actually WORSE than the
 * light theme it was modelled on. Eyeballing a dark palette does not work; this
 * measures it.
 *
 * Values are parsed out of tokens.css so the test cannot drift from the source.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// Read from disk rather than importing: Vite's CSS plugin intercepts a `.css`
// import before the `?raw` suffix is honoured under Vitest, so `?raw` yields an
// empty string here. Verified, not assumed.
const srcDir = fileURLToPath(new URL('../../src', import.meta.url))
const css = readFileSync(join(srcDir, 'styles/tokens.css'), 'utf8')

/** Every source file that can reference a token, including inline styles. */
function collectSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) collectSources(full, acc)
    else if (/\.(ts|tsx|css)$/.test(entry)) acc.push(readFileSync(full, 'utf8'))
  }
  return acc
}
const allSource = collectSources(srcDir).join('\n')

/** Pull one theme block's custom properties out of tokens.css. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector)
  expect(start, `${selector} block not found`).toBeGreaterThan(-1)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  const body = css.slice(open + 1, close)
  const out: Record<string, string> = {}
  for (const line of body.split('\n')) {
    const m = /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/i.exec(line)
    if (m) out[m[1]!] = m[2]!.trim()
  }
  return out
}

const light = tokens(':root,')
const dark = tokens(":root[data-theme='dark']")

function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const parts = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16))
  const lin = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(parts[0]!) + 0.7152 * lin(parts[1]!) + 0.0722 * lin(parts[2]!)
}

function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** WCAG AA for normal-size text. */
const AA_TEXT = 4.5
/** WCAG AA for UI components and graphical objects. */
const AA_NON_TEXT = 3

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme', (name, t) => {
  it('declares every colour the app reads', () => {
    for (const key of [
      '--bg-panel', '--bg-panel-alt', '--bg-toolbar', '--bg-workspace', '--bg-input',
      '--text', '--text-muted', '--text-faint',
      '--accent', '--accent-hover', '--accent-contrast',
      '--warn', '--error', '--magenta',
      '--notify-warn-bg', '--notify-error-bg', '--notify-success-bg',
      '--checker', '--checker-bg', '--preview-stroke', '--mark-fg',
    ]) {
      // The light block declares the shared values; dark overrides a subset.
      if (name === 'dark' && !(key in t)) continue
      expect(t[key], `${name} is missing ${key}`).toBeTruthy()
    }
  })

  it('body and muted text clear AA on every panel surface', () => {
    const surfaces = ['--bg-panel', '--bg-panel-alt', '--bg-toolbar']
    for (const surface of surfaces) {
      const bg = t[surface] ?? light[surface]!
      for (const fg of ['--text', '--text-muted', '--text-faint']) {
        const color = t[fg] ?? light[fg]!
        expect(
          contrast(color, bg),
          `${name}: ${fg} on ${surface} is ${contrast(color, bg).toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_TEXT)
      }
    }
  })

  it('white text clears AA on the accent fill', () => {
    // The accent is a BACKGROUND for white text: primary buttons, menu hover,
    // the selected layer row. This is the check the first dark palette failed.
    const accent = t['--accent'] ?? light['--accent']!
    const onAccent = t['--accent-contrast'] ?? light['--accent-contrast']!
    expect(contrast(onAccent, accent)).toBeGreaterThanOrEqual(AA_TEXT)

    const hover = t['--accent-hover'] ?? light['--accent-hover']!
    expect(contrast(onAccent, hover)).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it('the accent is distinguishable as a graphical element', () => {
    const accent = t['--accent'] ?? light['--accent']!
    const panel = t['--bg-panel'] ?? light['--bg-panel']!
    expect(contrast(accent, panel)).toBeGreaterThanOrEqual(AA_NON_TEXT)
  })

  it('status colours clear AA as text on the panel', () => {
    const panel = t['--bg-panel'] ?? light['--bg-panel']!
    for (const key of ['--warn', '--error', '--magenta']) {
      const color = t[key] ?? light[key]!
      expect(
        contrast(color, panel),
        `${name}: ${key} as text is ${contrast(color, panel).toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA_TEXT)
    }
  })

  it('white text clears AA on every notification chip', () => {
    for (const key of ['--notify-warn-bg', '--notify-error-bg', '--notify-success-bg']) {
      const bg = t[key] ?? light[key]!
      expect(
        contrast('#ffffff', bg),
        `${name}: white on ${key} is ${contrast('#ffffff', bg).toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA_TEXT)
    }
  })

  it('the checkerboard squares are visible against their own base', () => {
    const checker = t['--checker'] ?? light['--checker']!
    const base = t['--checker-bg'] ?? light['--checker-bg']!
    // Not an AA target — just has to read as a checker rather than a flat fill.
    expect(contrast(checker, base)).toBeGreaterThan(1.15)
  })

  it('the freehand preview is visible over the pasteboard', () => {
    // Black-on-near-black was invisible in the first dark palette.
    const stroke = t['--preview-stroke'] ?? light['--preview-stroke']!
    const workspace = t['--bg-workspace'] ?? light['--bg-workspace']!
    expect(contrast(stroke, workspace)).toBeGreaterThanOrEqual(AA_NON_TEXT)
  })
})

describe('theme separation', () => {
  it('the pasteboard is darker than the panels in dark mode', () => {
    // Artboards stay white, so the pasteboard has to recede behind them.
    expect(luminance(dark['--bg-workspace']!)).toBeLessThan(luminance(dark['--bg-panel']!))
  })

  it('declares no colour it never uses', () => {
    const src = allSource
    for (const key of Object.keys(light)) {
      if (!key.startsWith('--bg-') && !key.startsWith('--text') && !key.includes('-')) continue
      // Only the colour tokens are audited; metrics and font stacks are a
      // different concern.
      if (!/^--(bg|text|border|accent|magenta|warn|error|success|notify|checker|thumb|handle|guide|snap|grid|artboard|overlay|backdrop|hairline|scrollbar|preview|mark)/.test(key)) continue
      const uses = src.split(`var(${key})`).length - 1
      expect(uses, `${key} is declared but never used`).toBeGreaterThan(0)
    }
  })
})

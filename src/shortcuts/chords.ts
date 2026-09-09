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
 * Key chords: the thing a shortcut actually is.
 *
 * A chord is stored in one canonical, platform-neutral form — `Mod+Shift+S` —
 * and rendered per platform for display. `Mod` is the command key on a Mac and
 * Control everywhere else, which is what makes a keymap portable: the same
 * exported preferences file gives ⌘S on one machine and Ctrl+S on the other,
 * rather than a Mac's bindings arriving as nonsense on Windows.
 *
 * The key name comes from `e.code` for everything except letters, and that is
 * not a detail. `e.key` reports the character the keystroke PRODUCES, so
 * Shift+' is `"` and Shift+1 is `!` — which meant the old handler's
 * `case "'"` with a shift test could never match anything, and ⇧⌘' silently
 * did nothing. The physical position is what a shortcut is about. Letters are
 * the exception, taken from `e.key`, because a letter's identity is the letter
 * and not where it sits.
 */

export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** The modifiers a chord may carry, in the order they are written. */
export interface Chord {
  /** ⌘ on a Mac, Control elsewhere. */
  mod: boolean
  shift: boolean
  alt: boolean
  /** Control on a Mac only; folded into `mod` on every other platform. */
  ctrl: boolean
  /** Canonical key name: `S`, `1`, `'`, `Delete`, `ArrowLeft`, `Space`. */
  key: string
}

/** Physical keys whose produced character changes under Shift. */
const CODE_KEYS: Record<string, string> = {
  Digit0: '0', Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4',
  Digit5: '5', Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Backquote: '`', Comma: ',', Period: '.', Slash: '/',
  Space: 'Space',
  NumpadAdd: '=', NumpadSubtract: '-',
}

/** Keys that are only ever modifiers, and so can never be a chord on their own. */
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock'])

export function isModifierKey(key: string): boolean {
  return MODIFIER_KEYS.has(key)
}

/**
 * The chord a keyboard event represents, or null while only modifiers are down.
 */
export function chordFromEvent(e: KeyboardEvent): Chord | null {
  if (isModifierKey(e.key)) return null
  const key = keyNameFromEvent(e)
  if (!key) return null
  return {
    mod: IS_MAC ? e.metaKey : e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    ctrl: IS_MAC ? e.ctrlKey : false,
    key,
  }
}

function keyNameFromEvent(e: KeyboardEvent): string | null {
  // A letter is its letter, wherever it sits on the keyboard.
  if (/^[a-zA-Z]$/.test(e.key)) return e.key.toUpperCase()
  const fromCode = CODE_KEYS[e.code]
  if (fromCode) return fromCode
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3)
  if (e.key === ' ') return 'Space'
  if (e.key.length === 1) return e.key.toUpperCase()
  return e.key
}

// ---------------------------------------------------------------------------
// Canonical form
// ---------------------------------------------------------------------------

/** `Mod+Shift+S` — what gets stored and compared. */
export function chordToString(chord: Chord): string {
  const parts: string[] = []
  if (chord.mod) parts.push('Mod')
  if (chord.ctrl) parts.push('Ctrl')
  if (chord.shift) parts.push('Shift')
  if (chord.alt) parts.push('Alt')
  parts.push(chord.key)
  return parts.join('+')
}

/**
 * Parse a canonical chord. Returns null for anything malformed, because a
 * corrupt entry in an imported preferences file must not take a shortcut with
 * it — the default is used instead.
 */
export function parseChord(text: string): Chord | null {
  if (!text) return null
  // The key itself may be `+`, so only split on separators before the last part.
  const parts = text.split('+')
  let key = parts.pop() ?? ''
  if (key === '' && parts.length > 0) key = '+'
  if (!key) return null

  const chord: Chord = { mod: false, shift: false, alt: false, ctrl: false, key }
  for (const part of parts) {
    switch (part.toLowerCase()) {
      case 'mod': case 'cmd': case 'meta': chord.mod = true; break
      case 'ctrl': case 'control': chord.ctrl = true; break
      case 'shift': chord.shift = true; break
      case 'alt': case 'option': chord.alt = true; break
      case '': break
      default: return null
    }
  }
  // On anything but a Mac there is no Control separate from Mod.
  if (!IS_MAC && chord.ctrl) {
    chord.mod = true
    chord.ctrl = false
  }
  return chord
}

/** The canonical form of an event, or null while only modifiers are held. */
export function eventChordString(e: KeyboardEvent): string | null {
  const chord = chordFromEvent(e)
  return chord ? chordToString(chord) : null
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

const KEY_LABELS: Record<string, string> = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  Escape: 'Esc', Delete: 'Del', Backspace: '⌫', Enter: '↩', Tab: '⇥',
  Space: 'Space', PageUp: 'PgUp', PageDown: 'PgDn',
}

/**
 * What the user reads. Mac spells modifiers as symbols with no separator,
 * which is the platform convention and what every Adobe dialog does; every
 * other platform names them and joins with `+`.
 */
export function formatChord(text: string): string {
  const chord = parseChord(text)
  if (!chord) return text
  const key = KEY_LABELS[chord.key] ?? chord.key

  if (IS_MAC) {
    let out = ''
    if (chord.ctrl) out += '⌃'
    if (chord.alt) out += '⌥'
    if (chord.shift) out += '⇧'
    if (chord.mod) out += '⌘'
    return out + key
  }

  const parts: string[] = []
  if (chord.mod || chord.ctrl) parts.push('Ctrl')
  if (chord.shift) parts.push('Shift')
  if (chord.alt) parts.push('Alt')
  parts.push(key)
  return parts.join('+')
}

/**
 * What to show WHILE keys are being held, before a chord exists.
 *
 * The recording field has to say something the moment a modifier goes down, or
 * holding ⌘ and thinking about it looks like the field has stopped working.
 */
export function formatPartial(e: KeyboardEvent): string {
  const parts: string[] = []
  if (IS_MAC) {
    if (e.ctrlKey) parts.push('⌃')
    if (e.altKey) parts.push('⌥')
    if (e.shiftKey) parts.push('⇧')
    if (e.metaKey) parts.push('⌘')
    return parts.join('') || '…'
  }
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  return parts.length ? parts.join('+') + '+…' : '…'
}

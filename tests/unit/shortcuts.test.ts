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
 * Chords, and the keymap that binds them.
 *
 * The behaviour worth pinning down is not "does a key work" but the three
 * judgements this rests on: that a chord survives the trip to another
 * keyboard layout and another platform, that only differences from the
 * defaults are stored, and that one chord can only ever run one command.
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  chordToString, eventChordString, formatChord, isModifierKey, parseChord, IS_MAC,
} from '@/shortcuts/chords'
import {
  chordFor, clearBinding, commandForChord, conflictFor, hasCustomisations, isCustomised,
  isUnbound, keymapOverrides, resetAllBindings, resetBinding, setBinding,
  applyKeymapOverrides, shortcutLabel, SHORTCUTS_STORAGE_KEY,
} from '@/shortcuts/keymap'
import { COMMANDS, commandById } from '@/shortcuts/commands'

/** A KeyboardEvent as the browser would build it, code included. */
function key(init: { key: string; code?: string; meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean }) {
  return new KeyboardEvent('keydown', {
    key: init.key,
    code: init.code ?? '',
    metaKey: init.meta ?? false,
    ctrlKey: init.ctrl ?? false,
    shiftKey: init.shift ?? false,
    altKey: init.alt ?? false,
  })
}

/** Whichever modifier is Mod on the platform the test is running on. */
const mod = (on = true) => (IS_MAC ? { meta: on } : { ctrl: on })

beforeEach(() => {
  resetAllBindings()
  localStorage.clear()
  applyKeymapOverrides({})
})

describe('reading a chord off an event', () => {
  it('names a letter by its letter', () => {
    expect(eventChordString(key({ key: 'v', code: 'KeyV' }))).toBe('V')
    expect(eventChordString(key({ key: 'V', code: 'KeyV', shift: true }))).toBe('Shift+V')
  })

  it('names punctuation by its position, not the character it produces', () => {
    // The bug this exists for. Shift+' produces `"`, so the old handler's
    // `case "'"` with a shift test could never match, and ⇧⌘' did nothing.
    expect(eventChordString(key({ key: "'", code: 'Quote', ...mod() }))).toBe("Mod+'")
    expect(eventChordString(key({ key: '"', code: 'Quote', shift: true, ...mod() }))).toBe("Mod+Shift+'")
  })

  it('names a digit by its digit, whatever Shift makes of it', () => {
    expect(eventChordString(key({ key: '1', code: 'Digit1', ...mod() }))).toBe('Mod+1')
    expect(eventChordString(key({ key: '!', code: 'Digit1', shift: true, ...mod() }))).toBe('Mod+Shift+1')
  })

  it('keeps named keys as they are', () => {
    expect(eventChordString(key({ key: 'Delete', code: 'Delete' }))).toBe('Delete')
    expect(eventChordString(key({ key: 'ArrowLeft', code: 'ArrowLeft', shift: true }))).toBe('Shift+ArrowLeft')
    expect(eventChordString(key({ key: ' ', code: 'Space' }))).toBe('Space')
  })

  it('has no chord while only modifiers are held', () => {
    expect(eventChordString(key({ key: 'Shift', shift: true }))).toBeNull()
    expect(eventChordString(key({ key: 'Meta', meta: true }))).toBeNull()
    expect(isModifierKey('Control')).toBe(true)
    expect(isModifierKey('K')).toBe(false)
  })

  it('writes modifiers in one fixed order, so two spellings cannot differ', () => {
    expect(chordToString({ mod: true, shift: true, alt: true, ctrl: false, key: 'S' }))
      .toBe('Mod+Shift+Alt+S')
  })
})

describe('parsing a chord', () => {
  it('round-trips every default', () => {
    for (const command of COMMANDS) {
      const parsed = parseChord(command.defaultChord)
      expect(parsed, command.id).not.toBeNull()
      expect(chordToString(parsed!), command.id).toBe(command.defaultChord)
    }
  })

  it('refuses nonsense rather than inventing a binding', () => {
    expect(parseChord('')).toBeNull()
    expect(parseChord('Hyper+K')).toBeNull()
  })

  it('folds a Mac-only Control into Mod off a Mac', () => {
    const parsed = parseChord('Ctrl+K')
    expect(parsed).not.toBeNull()
    if (IS_MAC) expect(parsed!.ctrl).toBe(true)
    else expect(parsed!.mod).toBe(true)
  })

  it('formats for the platform it is read on', () => {
    const label = formatChord('Mod+Shift+S')
    expect(label).toBe(IS_MAC ? '⇧⌘S' : 'Ctrl+Shift+S')
    expect(formatChord('ArrowLeft')).toContain('←')
  })
})

describe('the command registry', () => {
  it('gives every command a unique id and a parseable default', () => {
    const ids = COMMANDS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const command of COMMANDS) {
      expect(parseChord(command.defaultChord), command.id).not.toBeNull()
      expect(command.label.length, command.id).toBeGreaterThan(0)
    }
  })

  it('ships with no two commands on the same chord', () => {
    const seen = new Map<string, string>()
    for (const command of COMMANDS) {
      const clash = seen.get(command.defaultChord)
      expect(clash, `${command.id} clashes with ${clash}`).toBeUndefined()
      seen.set(command.defaultChord, command.id)
    }
  })

  it('lets copy, cut and paste through to the browser', () => {
    // Not a style choice: preventDefault here suppresses the native clipboard
    // events, which are the only way to read what another application copied.
    for (const id of ['edit.copy', 'edit.cut', 'edit.paste']) {
      expect(commandById(id)!.passthrough, id).toBe(true)
    }
    expect(commandById('file.save')!.passthrough).toBeUndefined()
  })
})

describe('binding and rebinding', () => {
  it('starts on the defaults, with nothing stored', () => {
    expect(chordFor('file.save')).toBe('Mod+S')
    expect(isCustomised('file.save')).toBe(false)
    expect(hasCustomisations()).toBe(false)
    expect(keymapOverrides()).toEqual({})
  })

  it('runs the command a chord is bound to', () => {
    expect(commandForChord('Mod+S')?.id).toBe('file.save')
    setBinding('file.save', 'Mod+K')
    expect(commandForChord('Mod+K')?.id).toBe('file.save')
    expect(commandForChord('Mod+S')).toBeUndefined()
  })

  it('stores only the difference, so untouched shortcuts follow the app', () => {
    setBinding('file.save', 'Mod+K')
    expect(keymapOverrides()).toEqual({ 'file.save': 'Mod+K' })
  })

  it('treats rebinding to the default as no customisation at all', () => {
    setBinding('file.save', 'Mod+K')
    setBinding('file.save', 'Mod+S')
    expect(isCustomised('file.save')).toBe(false)
    expect(keymapOverrides()).toEqual({})
  })

  it('takes a chord away from whatever held it, and says so', () => {
    const result = setBinding('file.open', 'Mod+S')
    expect(result.displaced?.id).toBe('file.save')
    // One chord, one command: Save is left with none rather than both firing.
    expect(commandForChord('Mod+S')?.id).toBe('file.open')
    expect(isUnbound('file.save')).toBe(true)
    expect(chordFor('file.save')).toBe('')
  })

  it('reports a conflict before it is made', () => {
    expect(conflictFor('Mod+S', 'file.open')?.id).toBe('file.save')
    // Not a conflict with itself.
    expect(conflictFor('Mod+S', 'file.save')).toBeUndefined()
  })

  it('never lets an unbound command match an empty chord', () => {
    clearBinding('file.save')
    expect(chordFor('file.save')).toBe('')
    expect(commandForChord('')).toBeUndefined()
  })

  it('resets one command without touching the others', () => {
    setBinding('file.save', 'Mod+K')
    setBinding('file.open', 'Mod+J')
    resetBinding('file.save')
    expect(chordFor('file.save')).toBe('Mod+S')
    expect(chordFor('file.open')).toBe('Mod+J')
    expect(hasCustomisations()).toBe(true)
  })

  it('resets everything', () => {
    setBinding('file.save', 'Mod+K')
    clearBinding('file.open')
    resetAllBindings()
    expect(hasCustomisations()).toBe(false)
    expect(chordFor('file.save')).toBe('Mod+S')
    expect(chordFor('file.open')).toBe('Mod+O')
  })

  it('labels a chord for menus, and says nothing for an unbound one', () => {
    expect(shortcutLabel('file.save')).toBe(formatChord('Mod+S'))
    clearBinding('file.save')
    expect(shortcutLabel('file.save')).toBe('')
  })
})

describe('aliases', () => {
  it('answers to its convenience keys', () => {
    expect(commandForChord('Backspace')?.id).toBe('edit.delete')
    expect(commandForChord('Mod+Y')?.id).toBe('edit.redo')
  })

  it('gives up its aliases once the command is moved', () => {
    // The conveniences belong to the default binding; a command the user has
    // deliberately moved should be where they put it and nowhere else.
    setBinding('edit.delete', 'Mod+Backspace')
    expect(commandForChord('Backspace')).toBeUndefined()
    expect(commandForChord('Mod+Backspace')?.id).toBe('edit.delete')
  })

  it('lets a real binding win over someone else’s alias', () => {
    setBinding('file.save', 'Backspace')
    expect(commandForChord('Backspace')?.id).toBe('file.save')
  })
})

describe('what is stored', () => {
  it('survives a reload', () => {
    setBinding('file.save', 'Mod+K')
    expect(JSON.parse(localStorage.getItem(SHORTCUTS_STORAGE_KEY)!)).toEqual({ 'file.save': 'Mod+K' })
  })

  it('leaves nothing behind once everything is reset', () => {
    setBinding('file.save', 'Mod+K')
    resetAllBindings()
    expect(localStorage.getItem(SHORTCUTS_STORAGE_KEY)).toBeNull()
  })

  it('drops entries it cannot understand rather than refusing the lot', () => {
    applyKeymapOverrides({
      'file.save': 'Mod+K',
      'command.that.does.not.exist': 'Mod+J',
      'file.open': 'Hyper+Nonsense',
      'file.export': 42,
    })
    expect(keymapOverrides()).toEqual({ 'file.save': 'Mod+K' })
    expect(chordFor('file.open')).toBe('Mod+O')
  })
})

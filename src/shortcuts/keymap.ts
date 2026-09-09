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
 * The keymap: which chord runs which command, and what the user changed.
 *
 * Only DIFFERENCES from the defaults are stored. A keymap that recorded every
 * binding would freeze the defaults at the moment it was written — add a
 * command later, or improve a default, and every existing user would be stuck
 * with the old map forever. Storing the overrides alone means a shortcut the
 * user never touched keeps following the application.
 *
 * That is also what makes "reset" meaningful: resetting is deleting, not
 * writing the default back.
 *
 * A chord can only run one command. Binding a chord that is already taken
 * unbinds the other command rather than leaving two things on one key and
 * picking arbitrarily — and `setBinding` reports which command it displaced so
 * the dialog can say so.
 */

import { COMMANDS, commandById, type CommandSpec } from './commands'
import { formatChord, parseChord } from './chords'

export const SHORTCUTS_STORAGE_KEY = 'xdesign.shortcuts'

/** Command id to chord, holding only what differs from the default. */
export type KeymapOverrides = Record<string, string>

type Listener = () => void
const listeners = new Set<Listener>()

let overrides: KeymapOverrides = readStored()

function readStored(): KeymapOverrides {
  try {
    const raw = localStorage.getItem(SHORTCUTS_STORAGE_KEY)
    if (!raw) return {}
    return sanitize(JSON.parse(raw))
  } catch {
    // Private mode, storage blocked, or a corrupt value: the defaults are a
    // perfectly good keymap, and losing customisations beats failing to start.
    return {}
  }
}

/**
 * Keep only entries naming a real command and a parseable chord.
 *
 * An imported preferences file is the untrusted input here: it may come from a
 * newer build with commands this one has never heard of, or have been edited by
 * hand. Anything unrecognised is dropped rather than rejecting the whole file.
 */
function sanitize(value: unknown): KeymapOverrides {
  if (!value || typeof value !== 'object') return {}
  const out: KeymapOverrides = {}
  for (const [id, chord] of Object.entries(value as Record<string, unknown>)) {
    if (typeof chord !== 'string' || !commandById(id)) continue
    if (!parseChord(chord)) continue
    out[id] = chord
  }
  return out
}

function persist(): void {
  try {
    if (Object.keys(overrides).length === 0) localStorage.removeItem(SHORTCUTS_STORAGE_KEY)
    else localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(overrides))
  } catch {
    // Nothing to do: the change still applies for this session.
  }
  for (const listener of listeners) listener()
}

export function subscribeKeymap(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * The chord currently bound to a command, or the empty string when the user
 * has taken its chord away. Note the `undefined` test rather than a truthy
 * one: an unbound command IS stored, as the empty string, and must not fall
 * through to its default.
 */
export function chordFor(id: string): string {
  const override = overrides[id]
  if (override !== undefined) return override
  return commandById(id)?.defaultChord ?? ''
}

export function isCustomised(id: string): boolean {
  return overrides[id] !== undefined
}

export function hasCustomisations(): boolean {
  return Object.keys(overrides).length > 0
}

/** A copy, for export. */
export function keymapOverrides(): KeymapOverrides {
  return { ...overrides }
}

/**
 * The command a chord runs, or undefined.
 *
 * Bindings win over aliases, so a user who puts something on Backspace gets
 * that rather than Delete's convenience alias.
 */
export function commandForChord(chord: string): CommandSpec | undefined {
  // The empty string is how "no chord" is stored; it must never match.
  if (!chord) return undefined
  for (const command of COMMANDS) {
    if (chordFor(command.id) === chord) return command
  }
  for (const command of COMMANDS) {
    // An alias only applies while the command still answers to its default:
    // a rebound command has been moved, and its conveniences move with it.
    if (!isCustomised(command.id) && command.aliases?.includes(chord)) return command
  }
  return undefined
}

/** The command a chord is already taken by, ignoring one id. */
export function conflictFor(chord: string, exceptId: string): CommandSpec | undefined {
  const holder = commandForChord(chord)
  return holder && holder.id !== exceptId ? holder : undefined
}

/**
 * A command's chord as a menu or tooltip should print it, or '' when the user
 * has unbound it.
 *
 * Menus take their labels from here rather than writing ⌘S themselves, so a
 * rebound shortcut is rebound everywhere it is shown. A menu that went on
 * advertising the old key would be worse than one showing none.
 */
export function shortcutLabel(id: string): string {
  const chord = chordFor(id)
  return chord ? formatChord(chord) : ''
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * A command with no chord at all. Stored as an override so it survives a
 * reload, and never matches a real chord because a chord always has a key.
 */
export const UNBOUND = ''

export interface BindResult {
  /** The command that lost this chord, if any. */
  displaced?: CommandSpec
}

/**
 * Bind a chord to a command. Whatever held the chord is unbound, and named in
 * the result so the dialog can say what happened.
 */
export function setBinding(id: string, chord: string): BindResult {
  const command = commandById(id)
  if (!command || !parseChord(chord)) return {}

  const displaced = conflictFor(chord, id)
  const next = { ...overrides }

  if (displaced) {
    // Unbound rather than reset: putting it back on its default could displace
    // something else in turn, and a chain of surprises is worse than one gap
    // the user can see and fill.
    next[displaced.id] = UNBOUND
  }

  if (chord === command.defaultChord) delete next[id]
  else next[id] = chord

  overrides = next
  persist()
  return displaced ? { displaced } : {}
}

export function isUnbound(id: string): boolean {
  return overrides[id] === UNBOUND
}

export function clearBinding(id: string): void {
  if (!commandById(id)) return
  overrides = { ...overrides, [id]: UNBOUND }
  persist()
}

/** Put one command back to the chord it shipped with. */
export function resetBinding(id: string): void {
  if (overrides[id] === undefined) return
  const next = { ...overrides }
  delete next[id]
  overrides = next
  persist()
}

/** Put every command back. */
export function resetAllBindings(): void {
  if (Object.keys(overrides).length === 0) return
  overrides = {}
  persist()
}

/** Replace the whole map — used by preferences import. */
export function applyKeymapOverrides(value: unknown): void {
  overrides = sanitize(value)
  persist()
}

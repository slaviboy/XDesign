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
 * The Keyboard Shortcuts dialog, where the shortcuts are also changed.
 *
 * Recording a chord is a small state machine, and the states matter:
 *
 *   idle       the chord is text.
 *   recording  double-clicked. Every key event is swallowed — including ⌘W and
 *              Escape — because a recorder that let some combinations through
 *              could not record them, and the ones it could not record are
 *              exactly the ones worth rebinding.
 *   holding    a modifier is down but no key yet. The field shows ⇧⌘… so that
 *              holding a modifier and thinking looks like progress rather than
 *              a dead field.
 *   caught     a non-modifier arrived. The chord is shown, and committed when
 *              the keys come back up — which is what makes it feel like
 *              pressing a shortcut rather than filling in a form.
 *
 * Escape cancels instead of binding, because a recorder you cannot get out of
 * is a trap; Escape is bound from the row's own reset control rather than from
 * inside recording.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { COMMANDS, COMMAND_GROUP_ORDER, type CommandSpec } from '../shortcuts/commands'
import {
  chordFor, clearBinding, conflictFor, hasCustomisations, isCustomised, isUnbound,
  resetAllBindings, resetBinding, setBinding,
} from '../shortcuts/keymap'
import { useKeymap } from '../shortcuts/useKeymap'
import { eventChordString, formatChord, formatPartial, isModifierKey } from '../shortcuts/chords'
import { GESTURE_ONLY_GROUPS, gesturesFor } from '../shortcuts/bindings'
import { setShortcutRecording } from '../shortcuts/recording'
import { t } from '../i18n'
import { useLanguage } from '../state/hooks-i18n'

/** A chord recorded here, before it is committed. */
interface Recording {
  commandId: string
  /** What to show right now: a partial like ⇧⌘… or a full chord. */
  display: string
  /** The complete chord, once a non-modifier key has arrived. */
  chord: string | null
}

export function ShortcutEditor() {
  void useKeymap()
  void useLanguage()
  const [recording, setRecording] = useState<Recording | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const recordingRef = useRef<Recording | null>(null)
  recordingRef.current = recording

  const stop = useCallback(() => {
    recordingRef.current = null
    setShortcutRecording(false)
    setRecording(null)
  }, [])

  // The recorder listens on the window in the capture phase, so a chord the
  // application also binds is caught here first and never runs while it is
  // being recorded.
  useEffect(() => {
    if (!recording) return

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const current = recordingRef.current
      if (!current) return

      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        stop()
        return
      }
      if (isModifierKey(e.key)) {
        setRecording({ ...current, display: formatPartial(e), chord: null })
        return
      }
      const chord = eventChordString(e)
      if (!chord) return
      setRecording({ ...current, display: formatChord(chord), chord })
    }

    const onKeyUp = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const current = recordingRef.current
      if (!current) return

      // Nothing caught yet: a modifier came up on its own, so fall back to
      // whatever is still held rather than clearing the field.
      if (!current.chord) {
        setRecording({ ...current, display: formatPartial(e) })
        return
      }
      commit(current.commandId, current.chord)
    }

    const commit = (commandId: string, chord: string) => {
      const displaced = conflictFor(chord, commandId)
      setBinding(commandId, chord)
      setMessage(
        displaced
          ? t('shortcuts.displaced', { name: displaced.label, keys: formatChord(chord) })
          : null,
      )
      stop()
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    // A click elsewhere, or the window losing focus, ends the recording — it
    // must not outlive the moment the user is looking at it.
    window.addEventListener('blur', stop)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', stop)
      // Closing the dialog mid-recording must not leave the flag set, or every
      // later Escape would be swallowed by a recorder that no longer exists.
      setShortcutRecording(false)
    }
  }, [recording, stop])

  const start = (command: CommandSpec) => {
    setMessage(null)
    setShortcutRecording(true)
    setRecording({ commandId: command.id, display: t('shortcuts.pressKeys'), chord: null })
  }

  return (
    <>
      <p className="shortcut-hint">{t('shortcuts.hint')}</p>
      {message && <p className="shortcut-message">{message}</p>}

      <div className="shortcut-grid">
        {COMMAND_GROUP_ORDER.map((group) => {
          const commands = COMMANDS.filter((c) => c.group === group)
          const gestures = gesturesFor(group)
          if (commands.length === 0 && gestures.length === 0) return null
          return (
            <div key={group} style={{ display: 'contents' }}>
              <div className="shortcut-group-title">{group}</div>
              {commands.map((command) => (
                <ShortcutRow
                  key={command.id}
                  command={command}
                  recording={recording?.commandId === command.id ? recording : null}
                  onStart={() => start(command)}
                  onStop={stop}
                />
              ))}
              {gestures.map((gesture) => (
                <GestureRow key={gesture.keys + gesture.label} label={gesture.label} keys={gesture.keys} />
              ))}
            </div>
          )
        })}

        {GESTURE_ONLY_GROUPS.map((group) => (
          <div key={group} style={{ display: 'contents' }}>
            <div className="shortcut-group-title">{group}</div>
            {gesturesFor(group).map((gesture) => (
              <GestureRow key={gesture.keys + gesture.label} label={gesture.label} keys={gesture.keys} />
            ))}
          </div>
        ))}
      </div>

      <div className="shortcut-footer-row">
        <button
          type="button"
          className="button"
          disabled={!hasCustomisations()}
          onClick={() => {
            resetAllBindings()
            setMessage(null)
          }}
        >
          {t('shortcuts.resetAll')}
        </button>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------

function ShortcutRow({
  command,
  recording,
  onStart,
  onStop,
}: {
  command: CommandSpec
  recording: Recording | null
  onStart: () => void
  onStop: () => void
}) {
  const chord = chordFor(command.id)
  const changed = isCustomised(command.id)
  const unbound = isUnbound(command.id)

  return (
    <>
      <span className="shortcut-label">{command.label}</span>
      <span className="shortcut-keys">
        <button
          type="button"
          className={`kbd kbd-button${recording ? ' recording' : ''}${unbound ? ' unbound' : ''}`}
          // Double-click, as asked: a single click on a row of shortcuts is
          // how you scroll through them, and would start a recording by
          // accident on every pass.
          onDoubleClick={onStart}
          onBlur={recording ? onStop : undefined}
          title={t('shortcuts.doubleClickToChange')}
          aria-label={`${command.label}: ${recording ? t('shortcuts.pressKeys') : formatChord(chord) || t('shortcuts.none')}`}
        >
          {recording ? recording.display : unbound ? t('shortcuts.none') : formatChord(chord)}
        </button>
        {changed && !recording && (
          <button
            type="button"
            className="shortcut-reset"
            title={t('shortcuts.resetOne', { keys: formatChord(command.defaultChord) })}
            aria-label={t('shortcuts.resetOne', { keys: formatChord(command.defaultChord) })}
            onClick={() => resetBinding(command.id)}
          >
            ↺
          </button>
        )}
        {!changed && !recording && (
          <button
            type="button"
            className="shortcut-clear"
            title={t('shortcuts.clearOne')}
            aria-label={t('shortcuts.clearOne')}
            onClick={() => clearBinding(command.id)}
          >
            ×
          </button>
        )}
      </span>
    </>
  )
}

/** A pointer behaviour: shown so it can be learned, not changed. */
function GestureRow({ label, keys }: { label: string; keys: string }) {
  return (
    <>
      <span className="shortcut-label">{label}</span>
      <span className="shortcut-keys">
        <span className="kbd kbd-static">{keys}</span>
      </span>
    </>
  )
}

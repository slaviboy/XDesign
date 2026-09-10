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
 * Choosing what to take with you.
 *
 * Both dialogs are the same list of sections with a checkbox each, because
 * both answer the same question from opposite ends: which of these settings
 * are we moving? Each row says what it actually holds — "Deutsch", "3
 * changed", "7 settings" — because a list of abstract nouns is not enough to
 * choose between, particularly on import, where the interesting question is
 * what a file someone sent you actually contains.
 *
 * Import offers only the sections its file has. Export offers all of them, and
 * a section left unticked is ABSENT from the written file rather than null, so
 * the machine reading it can tell "nothing to say about your theme" from "set
 * no theme".
 */

import { useMemo, useState } from 'react'
import {
  PREFERENCE_SECTIONS, collectPreferences, sectionsInFile,
  type PreferenceSection, type PreferencesFile,
} from '../persistence/Preferences'
import { pendingPreferences, setPendingPreferences } from '../state/PreferencesTransfer'
import { applyImportedPreferences, writePreferencesFile } from '../app/fileOperations'
import { closeDialog } from '../state/EditorStore'
import { LANGUAGES } from '../i18n'
import { t, type MessageKey } from '../i18n'
import { useLanguage } from '../state/hooks-i18n'
import { COMMANDS } from '../shortcuts/commands'
import { DialogShell } from './DialogShell'

const SECTION_LABELS: Record<PreferenceSection, MessageKey> = {
  language: 'prefs.language',
  theme: 'menu.theme',
  spellCheck: 'label.spellCheck',
  marqueeMode: 'label.marqueeSelects',
  toolHighlight: 'label.toolHighlight',
  rememberExport: 'label.rememberExport',
  defaultGrid: 'prefs.section.defaultGrid',
  shortcuts: 'shortcuts.title',
  canvas: 'prefs.canvas',
}

/**
 * What a section actually holds, in one short phrase.
 *
 * Deliberately the VALUE rather than a description: "Dark" and "Deutsch" tell
 * you whether you want this row, and a sentence about what a theme is does not.
 */
function describeSection(file: PreferencesFile, section: PreferenceSection): string {
  switch (section) {
    case 'language': {
      // Language names are never translated: someone looking for their own
      // language is looking for the word they use for it.
      const match = LANGUAGES.find((l) => l.code === file.language)
      return match?.label ?? String(file.language ?? '')
    }
    case 'theme':
      return file.theme === 'light'
        ? t('menu.themeLight')
        : file.theme === 'dark'
          ? t('menu.themeDark')
          : t('menu.themeSystem')
    case 'spellCheck':
      return file.spellCheck ? t('prefs.on') : t('prefs.off')
    case 'rememberExport':
      return file.rememberExport ? t('prefs.on') : t('prefs.off')
    case 'marqueeMode':
      return file.marqueeMode === 'enclose' ? t('prefs.marqueeEnclose') : t('prefs.marqueeTouch')
    case 'toolHighlight':
      return file.toolHighlight === 'tint'
        ? t('prefs.toolHighlightTint')
        : t('prefs.toolHighlightFill')
    case 'defaultGrid': {
      const grid = file.defaultGrid
      if (!grid) return t('prefs.section.gridNone')
      return grid.type === 'square'
        ? t('prefs.section.gridSquare', { size: grid.size })
        : t('prefs.section.gridLayout', { columns: grid.columns })
    }
    case 'shortcuts': {
      const changed = Object.keys(file.shortcuts ?? {}).length
      return changed === 0
        ? t('prefs.section.shortcutsDefault')
        : t('prefs.section.shortcutsChanged', { count: changed, total: COMMANDS.length })
    }
    case 'canvas':
      return t('prefs.section.canvasCount', {
        count: Object.keys(file.canvas ?? {}).length,
      })
  }
}

// ---------------------------------------------------------------------------

function SectionList({
  file,
  sections,
  chosen,
  onToggle,
}: {
  file: PreferencesFile
  sections: readonly PreferenceSection[]
  chosen: Set<PreferenceSection>
  onToggle: (section: PreferenceSection) => void
}) {
  return (
    <div className="prefs-transfer-list">
      {sections.map((section) => (
        <label key={section} className="prefs-transfer-row">
          <input
            type="checkbox"
            checked={chosen.has(section)}
            onChange={() => onToggle(section)}
          />
          <span className="prefs-transfer-name">{t(SECTION_LABELS[section])}</span>
          <span className="prefs-transfer-value">{describeSection(file, section)}</span>
        </label>
      ))}
    </div>
  )
}

/** Tick-all / untick-all, which is the first thing anyone reaches for. */
function SelectAllRow({
  sections,
  chosen,
  onChange,
}: {
  sections: readonly PreferenceSection[]
  chosen: Set<PreferenceSection>
  onChange: (next: Set<PreferenceSection>) => void
}) {
  const all = chosen.size === sections.length
  return (
    <label className="prefs-transfer-row prefs-transfer-all">
      <input
        type="checkbox"
        checked={all}
        // Half-ticked when some are on: the box says "all of them?" and the
        // honest answer in between is neither yes nor no.
        ref={(el) => { if (el) el.indeterminate = !all && chosen.size > 0 }}
        onChange={() => onChange(all ? new Set() : new Set(sections))}
      />
      <span className="prefs-transfer-name">{t('prefs.transfer.all')}</span>
      <span className="prefs-transfer-value">
        {t('prefs.transfer.count', { count: chosen.size, total: sections.length })}
      </span>
    </label>
  )
}

function useChosen(sections: readonly PreferenceSection[]) {
  const [chosen, setChosen] = useState<Set<PreferenceSection>>(() => new Set(sections))
  const toggle = (section: PreferenceSection) => {
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }
  return { chosen, setChosen, toggle }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function PreferencesExportDialog() {
  void useLanguage()
  // A snapshot of everything, taken once, so the rows describe what will be
  // written rather than re-reading state that a background change could move.
  const file = useMemo(() => collectPreferences(new Date().toISOString()), [])
  const { chosen, setChosen, toggle } = useChosen(PREFERENCE_SECTIONS)

  const write = () => {
    const sections = PREFERENCE_SECTIONS.filter((s) => chosen.has(s))
    writePreferencesFile(collectPreferences(file.exported ?? new Date().toISOString(), sections))
    closeDialog()
  }

  return (
    <DialogShell
      title={t('prefs.transfer.exportTitle')}
      width={440}
      onClose={closeDialog}
      footer={
        <>
          <button type="button" className="button" onClick={closeDialog}>{t('trace.cancel')}</button>
          <button type="button" className="button primary" disabled={chosen.size === 0} onClick={write}>
            {t('prefs.transfer.export')}
          </button>
        </>
      }
    >
      <p className="prefs-transfer-hint">{t('prefs.transfer.exportHint')}</p>
      <SelectAllRow sections={PREFERENCE_SECTIONS} chosen={chosen} onChange={setChosen} />
      <SectionList file={file} sections={PREFERENCE_SECTIONS} chosen={chosen} onToggle={toggle} />
    </DialogShell>
  )
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export function PreferencesImportDialog() {
  void useLanguage()
  // Read once on mount: the picker put it there immediately before.
  const file = useMemo(() => pendingPreferences(), [])
  const available = useMemo(() => (file ? sectionsInFile(file) : []), [file])
  const { chosen, setChosen, toggle } = useChosen(available)

  const dismiss = () => {
    setPendingPreferences(null)
    closeDialog()
  }

  if (!file) return null

  const apply = () => {
    applyImportedPreferences(file, available.filter((s) => chosen.has(s)))
    dismiss()
  }

  return (
    <DialogShell
      title={t('prefs.transfer.importTitle')}
      width={440}
      onClose={dismiss}
      footer={
        <>
          <button type="button" className="button" onClick={dismiss}>{t('trace.cancel')}</button>
          <button type="button" className="button primary" disabled={chosen.size === 0} onClick={apply}>
            {t('prefs.transfer.import')}
          </button>
        </>
      }
    >
      <p className="prefs-transfer-hint">{t('prefs.transfer.importHint')}</p>
      {available.length === 0 ? (
        <p className="prefs-transfer-empty">{t('prefs.transfer.nothing')}</p>
      ) : (
        <>
          <SelectAllRow sections={available} chosen={chosen} onChange={setChosen} />
          <SectionList file={file} sections={available} chosen={chosen} onToggle={toggle} />
          {chosen.has('canvas') && (
            <p className="prefs-transfer-note">{t('prefs.transfer.canvasNote')}</p>
          )}
        </>
      )}
    </DialogShell>
  )
}

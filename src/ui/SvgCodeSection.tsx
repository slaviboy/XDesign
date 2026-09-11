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
 * The SVG Code section: markup, live.
 *
 * Two views, switched in the section's header. **Scene** is the whole
 * document as an SVG export of all of it would write it — every artboard,
 * group and loose object, pictures left out — rewritten on every change. It
 * is also what shows when nothing is selected. **Selection** is the selected
 * objects' code; for a single shape it can be edited back.
 *
 * Out of the document, the code follows it — every committed change rewrites
 * it. Into the document, typing in an editable box changes the shape as soon
 * as the code reads as one again, a short pause after the last key; one burst
 * of typing is one undo step. While the box has focus it keeps what is typed
 * rather than rewriting it under the caret; leaving it lays the code out again.
 *
 * The colours are a second copy of the text drawn exactly under a transparent
 * textarea, so the box edits like any other text field — selection, undo,
 * IME — while reading like an element inspector.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { applySvgCode } from '../history/SvgCodeCommands'
import {
  canEditSvgCode, supportsSvgCode, svgCodeFor, svgCodeForNodes, svgCodeForScene,
} from '../svg/SvgCode'
import { tokenizeSvg } from '../svg/SvgFormat'
import { breakHistoryCoalescing } from '../state/DocumentStore'
import { notify, setSvgCodeScope } from '../state/EditorStore'
import { useDocument, useEditorStore } from '../state/hooks'
import { t } from '../i18n'
import { Section } from './primitives'
import { CheckIcon, CopyIcon } from './icons'
import type { DesignDocument, DesignNode, NodeId } from '../document/types'

/** Pause after the last key before the code is applied. */
const APPLY_DELAY_MS = 350

/**
 * Pause after a change before a whole scene is written out again. A slider
 * scrub commits many times a second, and the scene's code does not need to
 * keep up with every one of them.
 */
const SCENE_DELAY_MS = 120

/**
 * Past this, the code is shown uncoloured. A traced photograph can be
 * thousands of paths, and one element per token for all of them would make
 * every keystroke elsewhere in the panel wait on the colouring.
 */
const MAX_COLOURED_CHARS = 200_000

type Target =
  | { kind: 'shape'; id: NodeId }
  | { kind: 'selection'; ids: NodeId[] }
  | { kind: 'scene' }

export function SvgCodeSection({ nodes }: { nodes: DesignNode[] }) {
  const scope = useEditorStore((s) => s.svgCodeScope)
  // Nothing selected: the scene is the only thing there is to show.
  const showing = nodes.length === 0 ? 'scene' : scope
  const target: Target =
    showing === 'scene'
      ? { kind: 'scene' }
      : nodes.length === 1 && supportsSvgCode(nodes[0])
        ? { kind: 'shape', id: nodes[0]!.id }
        : { kind: 'selection', ids: nodes.map((n) => n.id) }
  // Keyed by what it shows, so choosing another shape starts from its code
  // rather than carrying a half-typed edit across.
  const key = target.kind === 'scene' ? 'scene' : target.kind === 'shape' ? target.id : target.ids.join(',')
  return <SvgCodeEditor key={key} target={target} canChoose={nodes.length > 0} />
}

function generate(doc: DesignDocument, target: Target): Promise<string> {
  switch (target.kind) {
    case 'shape':
      return svgCodeFor(doc, target.id)
    case 'selection':
      return svgCodeForNodes(doc, target.ids)
    case 'scene':
      return svgCodeForScene(doc)
  }
}

function SvgCodeEditor({ target, canChoose }: { target: Target; canChoose: boolean }) {
  const doc = useDocument()
  const editable = target.kind === 'shape' && canEditSvgCode(doc, target.id)
  // What is in the box. The code generated from the document is kept in a ref:
  // it is what an edit is measured against, and never needs a render of its own.
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const focused = useRef(false)
  const shownRef = useRef('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Follow the document. Generation is asynchronous (the exporter is), so a
  // stale answer for an older document is dropped rather than shown.
  useEffect(() => {
    let live = true
    const run = () =>
      void generate(doc, target).then((code) => {
        if (!live) return
        shownRef.current = code
        if (!focused.current) {
          setText(code)
          setError(null)
        }
      })
    // The scene waits for changes to settle; one object's code is cheap
    // enough to follow every change as it lands.
    const wait = target.kind === 'scene' && shownRef.current ? setTimeout(run, SCENE_DELAY_MS) : null
    if (!wait) run()
    return () => {
      live = false
      if (wait) clearTimeout(wait)
    }
    // `target` is rebuilt every render; what it points at is in the key.
  }, [doc])

  const apply = useCallback(
    (code: string) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      if (target.kind !== 'shape') return
      const result = applySvgCode(target.id, code, shownRef.current, `svg-code:${target.id}`)
      setError(result.ok ? null : result.error)
    },
    // The editor is remounted for another target, so the first one is the one.
    [],
  )

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const onChange = (value: string) => {
    setText(value)
    if (!editable) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => apply(value), APPLY_DELAY_MS)
  }

  const onBlur = () => {
    focused.current = false
    // Anything still waiting is applied now, and the edit closes as one step.
    if (timer.current && editable) apply(text)
    breakHistoryCoalescing()
    setText(shownRef.current)
    setError(null)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      notify('warn', 'The code could not be copied. Select it and copy it instead.')
    }
  }

  const note =
    target.kind === 'scene'
      ? t('note.svgCodeScene')
      : target.kind === 'selection'
        ? t('note.svgCodeSelection')
        : editable
          ? null
          : t('note.svgCodeReadOnly')

  return (
    <Section
      id="svgCode"
      title={t('section.svgCode')}
      actions={
        <span className="code-actions">
          <span className="code-scope" role="group" aria-label={t('section.svgCode')}>
            <button
              type="button"
              className={target.kind !== 'scene' ? 'on' : ''}
              aria-pressed={target.kind !== 'scene'}
              data-testid="svg-code-selection"
              disabled={!canChoose}
              onClick={() => setSvgCodeScope('selection')}
            >
              {t('label.codeSelection')}
            </button>
            <button
              type="button"
              className={target.kind === 'scene' ? 'on' : ''}
              aria-pressed={target.kind === 'scene'}
              data-testid="svg-code-scene"
              onClick={() => setSvgCodeScope('scene')}
            >
              {t('label.codeScene')}
            </button>
          </span>
          <button
            type="button"
            className={`section-action${copied ? ' active' : ''}`}
            aria-label={copied ? t('label.copied') : t('label.copySvgCode')}
            title={copied ? t('label.copied') : t('label.copySvgCode')}
            data-testid="copy-svg-code"
            disabled={!text}
            onClick={() => void copy()}
          >
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          </button>
        </span>
      }
    >
      <div className="code-scroll">
        <div className="code-editor">
          <Highlighted code={text} />
          <textarea
            className="code-input"
            data-testid="svg-code"
            data-scope={target.kind}
            aria-label={t('section.svgCode')}
            value={text}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            readOnly={!editable}
            onFocus={() => {
              focused.current = true
            }}
            onBlur={onBlur}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.currentTarget.blur()
                return
              }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                if (editable) apply(text)
                return
              }
              if (e.key === 'Tab' && !e.shiftKey && editable) {
                // Indent rather than leave the box: this is code.
                e.preventDefault()
                const el = e.currentTarget
                const { selectionStart: a, selectionEnd: b } = el
                const next = `${text.slice(0, a)}  ${text.slice(b)}`
                onChange(next)
                requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2))
              }
            }}
          />
        </div>
      </div>
      {error && <div className="code-error" role="status">{error}</div>}
      {note && <div className="multi-note">{note}</div>}
    </Section>
  )
}

/** The code, coloured. A trailing newline keeps an empty last line as tall as the textarea's. */
function Highlighted({ code }: { code: string }) {
  const spans = useMemo(
    () =>
      code.length > MAX_COLOURED_CHARS
        ? code
        : tokenizeSvg(code).map((token, i) =>
            token.kind === 'space' ? token.text : (
              <span key={i} className={`code-${token.kind}`}>{token.text}</span>
            ),
          ),
    [code],
  )
  return (
    <pre className="code-highlight" aria-hidden="true">
      {spans}
      {'\n'}
    </pre>
  )
}

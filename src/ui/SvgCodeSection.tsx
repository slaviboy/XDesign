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
 * The SVG Code section: a shape's markup, live in both directions.
 *
 * Out of the document, the code follows the object — every committed change
 * rewrites it. Into the document, typing in the box changes the object as soon
 * as the code reads as a shape again, a short pause after the last key; one
 * burst of typing is one undo step, and Undo in the app takes the whole edit
 * back. While the box has focus it keeps what is typed rather than rewriting
 * it under the caret; leaving the box lays the code out again from the object.
 *
 * The colours are a second copy of the text drawn exactly under a transparent
 * textarea, so the box edits like any other text field — selection, undo,
 * IME — while reading like an element inspector.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { applySvgCode } from '../history/SvgCodeCommands'
import { canEditSvgCode, supportsSvgCode, svgCodeFor } from '../svg/SvgCode'
import { tokenizeSvg } from '../svg/SvgFormat'
import { breakHistoryCoalescing } from '../state/DocumentStore'
import { notify } from '../state/EditorStore'
import { useDocument } from '../state/hooks'
import { t } from '../i18n'
import { Section } from './primitives'
import { CheckIcon, CopyIcon } from './icons'
import type { DesignNode } from '../document/types'

/** Pause after the last key before the code is applied. */
const APPLY_DELAY_MS = 350

export function SvgCodeSection({ nodes }: { nodes: DesignNode[] }) {
  const node = nodes.length === 1 && supportsSvgCode(nodes[0]) ? nodes[0]! : null
  if (!node) return null
  // Keyed by node, so choosing another shape starts from its code rather than
  // carrying a half-typed edit across.
  return <SvgCodeEditor key={node.id} id={node.id} />
}

function SvgCodeEditor({ id }: { id: string }) {
  const doc = useDocument()
  const editable = canEditSvgCode(doc, id)
  // What is in the box. The code generated from the object is kept in a ref:
  // it is what an edit is measured against, and never needs a render of its own.
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const focused = useRef(false)
  const shownRef = useRef('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Follow the object. Generation is asynchronous (the exporter is), so a
  // stale answer for an older document is dropped rather than shown.
  useEffect(() => {
    let live = true
    void svgCodeFor(doc, id).then((code) => {
      if (!live) return
      shownRef.current = code
      if (!focused.current) {
        setText(code)
        setError(null)
      }
    })
    return () => {
      live = false
    }
  }, [doc, id])

  const apply = useCallback(
    (code: string) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      const result = applySvgCode(id, code, shownRef.current, `svg-code:${id}`)
      setError(result.ok ? null : result.error)
    },
    [id],
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

  return (
    <Section
      id="svgCode"
      title={t('section.svgCode')}
      actions={
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
      }
    >
      <div className="code-scroll">
        <div className="code-editor">
          <Highlighted code={text} />
          <textarea
            className="code-input"
            data-testid="svg-code"
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
      {!editable && <div className="multi-note">{t('note.svgCodeReadOnly')}</div>}
    </Section>
  )
}

/** The code, coloured. A trailing newline keeps an empty last line as tall as the textarea's. */
function Highlighted({ code }: { code: string }) {
  const spans = useMemo(
    () =>
      tokenizeSvg(code).map((token, i) =>
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

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
 * Reading SVG markup as text: splitting it into the pieces a code view colours,
 * and laying it out one element per line.
 *
 * A tokenizer rather than an XML parser, on purpose. The code view colours
 * whatever is in the box while it is being typed — half a tag, an unclosed
 * quote — and a parser would refuse exactly the text that most needs to stay
 * readable. Every character of the input lands in exactly one token, so the
 * coloured copy always lines up with the text under the caret.
 *
 * DOM-free.
 */

export type SvgTokenKind = 'punct' | 'tag' | 'attr' | 'value' | 'text' | 'comment' | 'space'

export interface SvgToken {
  kind: SvgTokenKind
  text: string
}

/** Split markup into tokens whose texts, joined, give back the input exactly. */
export function tokenizeSvg(source: string): SvgToken[] {
  const out: SvgToken[] = []
  const push = (kind: SvgTokenKind, text: string) => {
    if (text) out.push({ kind, text })
  }
  let i = 0
  const n = source.length

  while (i < n) {
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4)
      const stop = end < 0 ? n : end + 3
      push('comment', source.slice(i, stop))
      i = stop
      continue
    }
    if (source.startsWith('<?', i) || source.startsWith('<!', i)) {
      const end = source.indexOf('>', i + 2)
      const stop = end < 0 ? n : end + 1
      push('comment', source.slice(i, stop))
      i = stop
      continue
    }
    if (source[i] === '<') {
      const closing = source[i + 1] === '/'
      push('punct', closing ? '</' : '<')
      i += closing ? 2 : 1
      const nameEnd = scan(source, i, (c) => /[\s/>]/.test(c))
      push('tag', source.slice(i, nameEnd))
      i = nameEnd
      // Inside the tag: attributes until > or />.
      while (i < n && source[i] !== '>' && !source.startsWith('/>', i)) {
        const c = source[i]!
        if (/\s/.test(c)) {
          const end = scan(source, i, (ch) => !/\s/.test(ch))
          push('space', source.slice(i, end))
          i = end
        } else if (c === '=') {
          push('punct', '=')
          i++
        } else if (c === '"' || c === "'") {
          const end = source.indexOf(c, i + 1)
          const stop = end < 0 ? n : end + 1
          push('value', source.slice(i, stop))
          i = stop
        } else if (c === '<') {
          // A tag that never closed: let the next one start here.
          break
        } else {
          const end = scan(source, i, (ch) => /[\s=/>"'<]/.test(ch))
          // A stray "/" that is not the start of "/>" would otherwise stop the
          // scan without moving it.
          const stop = end === i ? i + 1 : end
          push('attr', source.slice(i, stop))
          i = stop
        }
      }
      if (source.startsWith('/>', i)) {
        push('punct', '/>')
        i += 2
      } else if (source[i] === '>') {
        push('punct', '>')
        i++
      }
      continue
    }
    const end = source.indexOf('<', i)
    const stop = end < 0 ? n : end
    const text = source.slice(i, stop)
    push(/^\s+$/.test(text) ? 'space' : 'text', text)
    i = stop
  }
  return out
}

function scan(s: string, from: number, stop: (c: string) => boolean): number {
  let i = from
  while (i < s.length && !stop(s[i]!)) i++
  return i
}

interface Element {
  kind: 'open' | 'close' | 'text' | 'comment'
  /** For open/close: the tag name. For text/comment: the content. */
  name: string
  attrs: string[]
  selfClosing: boolean
}

/**
 * One element per line, children indented two spaces under their parent, each
 * attribute exactly as written. Text that is only layout whitespace is
 * dropped; any other text keeps its line. Markup this cannot make sense of is
 * laid out as far as it goes, never lost.
 */
export function formatSvg(source: string): string {
  const items = readElements(tokenizeSvg(source))
  const lines: string[] = []
  let depth = 0
  const pad = () => '  '.repeat(Math.max(0, depth))

  for (let k = 0; k < items.length; k++) {
    const item = items[k]!
    if (item.kind === 'open') {
      const attrs = item.attrs.length ? ' ' + item.attrs.join(' ') : ''
      const next = items[k + 1]
      if (item.selfClosing) {
        lines.push(`${pad()}<${item.name}${attrs}/>`)
      } else if (next?.kind === 'close' && next.name === item.name) {
        // An empty element stays on one line rather than taking two.
        lines.push(`${pad()}<${item.name}${attrs}></${item.name}>`)
        k++
      } else if (next?.kind === 'text' && items[k + 2]?.kind === 'close') {
        // A short text child, such as a <text>'s words, sits with its tags.
        lines.push(`${pad()}<${item.name}${attrs}>${next.name}</${items[k + 2]!.name}>`)
        k += 2
      } else {
        lines.push(`${pad()}<${item.name}${attrs}>`)
        depth++
      }
    } else if (item.kind === 'close') {
      depth--
      lines.push(`${pad()}</${item.name}>`)
    } else {
      lines.push(`${pad()}${item.name}`)
    }
  }
  return lines.join('\n')
}

function readElements(tokens: SvgToken[]): Element[] {
  const items: Element[] = []
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]!
    if (t.kind === 'punct' && (t.text === '<' || t.text === '</')) {
      const closing = t.text === '</'
      const name = tokens[i + 1]?.kind === 'tag' ? tokens[i + 1]!.text : ''
      i += name ? 2 : 1
      const attrs: string[] = []
      let selfClosing = false
      while (i < tokens.length) {
        const a = tokens[i]!
        if (a.kind === 'punct' && (a.text === '>' || a.text === '/>')) {
          selfClosing = a.text === '/>'
          i++
          break
        }
        if (a.kind === 'punct' && (a.text === '<' || a.text === '</')) break
        if (a.kind === 'attr') {
          // name, and when present, = and its value, as one attribute.
          let attr = a.text
          if (tokens[i + 1]?.text === '=') {
            attr += '='
            i++
            if (tokens[i + 1]?.kind === 'value') {
              attr += tokens[i + 1]!.text
              i++
            }
          }
          attrs.push(attr)
        }
        i++
      }
      items.push({ kind: closing ? 'close' : 'open', name, attrs, selfClosing })
      continue
    }
    if (t.kind === 'comment') items.push({ kind: 'comment', name: t.text.trim(), attrs: [], selfClosing: false })
    else if (t.kind === 'text' && t.text.trim()) {
      items.push({ kind: 'text', name: t.text.trim(), attrs: [], selfClosing: false })
    }
    i++
  }
  return items
}

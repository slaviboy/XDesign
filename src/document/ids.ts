/**
 * ID generation.
 *
 * Every id is prefixed with a letter because these end up as SVG element ids,
 * and an id starting with a digit or a hyphen is not a valid NCName — it would
 * break `url(#…)` references in some parsers even though the DOM tolerates it.
 */

import { customAlphabet } from 'nanoid'

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
const raw = customAlphabet(ALPHABET, 12)

export function createId(prefix = 'n'): string {
  return `${prefix}${raw()}`
}

export function createNodeId(): string {
  return createId('n')
}

export function createAssetId(): string {
  return createId('a')
}

export function createStopId(): string {
  return createId('s')
}

export function createGuideId(): string {
  return createId('g')
}

export function createDocumentId(): string {
  return createId('doc')
}

/** Prefix used when namespacing ids inside imported SVG. */
export function createSvgScopeId(): string {
  return createId('svg')
}

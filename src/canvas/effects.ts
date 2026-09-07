/**
 * Shadows and blurs, as SVG filters.
 *
 * Shared by the live renderer and the SVG exporter, for the same reason paint.ts
 * is: what is on screen and what lands in the file are produced by one piece of
 * code, so they cannot drift.
 *
 * The model mirrors XD's own effect classes (see types.ts). Two conversions
 * happen here and nowhere else:
 *
 *   BLUR AMOUNT -> stdDeviation, halved. Adobe's 0..50 "Amount" — and CSS's
 *   `blur()` — describe a blur radius, while SVG's feGaussianBlur takes a
 *   standard deviation, which is half of it. Both blur kinds and both shadow
 *   kinds use the same halving, so an Amount of 20 looks like a Blur of 20.
 *
 *   BRIGHTNESS -> a CSS brightness multiplier. Adobe's -50..+50 maps onto
 *   0..2, so -50 is black and +50 is twice as bright.
 */

import { toHex } from '../document/color'
import type { BlurEffect, ShadowEffect, Style } from '../document/types'

/** Filter id for a node's effects. Stable, so a re-render reuses it. */
export const effectFilterId = (nodeId: string): string => `fx-${nodeId}`

export const blurStdDeviation = (amount: number): number => Math.max(0, amount) / 2

/** The shadow that actually paints: absent or unchecked means none. */
export function activeShadow(style: Style): ShadowEffect | null {
  const s = style.shadow
  return s && s.visible ? s : null
}

/** The blur that actually paints, of the given kind. */
export function activeBlur(style: Style, kind: BlurEffect['kind']): BlurEffect | null {
  const b = style.blur
  return b && b.visible && b.kind === kind && b.amount > 0 ? b : null
}

export interface EffectFilter {
  id: string
  /** In user space, so a zero-height line still gets a filter region. */
  x: number
  y: number
  width: number
  height: number
  /** The primitives, already serialised, in order. */
  primitives: string
}

/**
 * How far a node's own effects paint outside its box, in local units.
 *
 * Separate from the filter itself because a live resize has to keep the filter
 * region in step with the geometry: the region is the only thing standing
 * between the shape and being clipped to whatever size it was when React last
 * rendered it. The margin does not change during a gesture — a blur radius and
 * an offset are not what a resize edits — so it is snapshotted once and the
 * region recomputed from the live size.
 */
export function effectMargin(style: Style): number {
  const shadow = activeShadow(style)
  const blur = activeBlur(style, 'object')
  if (!shadow && !blur) return 0
  return (
    (blur ? blur.amount : 0) +
    (shadow ? shadow.blur + Math.abs(shadow.x) + Math.abs(shadow.y) : 0) +
    style.stroke.width +
    8
  )
}

/** The filter region for a box, given the margin its effects need around it. */
export function filterRegion(
  margin: number,
  box: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  return {
    x: -margin,
    y: -margin,
    width: Math.max(0, box.width) + margin * 2,
    height: Math.max(0, box.height) + margin * 2,
  }
}

/**
 * The filter for a node's shadow and object blur, or null if it has neither.
 *
 * Background blur is NOT here: no SVG filter primitive can read what is behind
 * an element, so it is done by re-drawing the backdrop. See the callers.
 */
export function effectFilter(
  nodeId: string,
  style: Style,
  box: { width: number; height: number },
): EffectFilter | null {
  const shadow = activeShadow(style)
  const blur = activeBlur(style, 'object')
  if (!shadow && !blur) return null

  const parts: string[] = []
  // `in` is threaded from primitive to primitive so a blurred shape casts a
  // shadow of its blurred self, rather than the two effects fighting over
  // SourceGraphic and one of them silently winning.
  let source = 'SourceGraphic'

  if (blur) {
    parts.push(
      `<feGaussianBlur in="${source}" stdDeviation="${round(blurStdDeviation(blur.amount))}" result="fx-blur"/>`,
    )
    source = 'fx-blur'
  }

  if (shadow) {
    const color = toHex(shadow.color)
    const alpha = round(shadow.color.a)
    const sd = round(blurStdDeviation(shadow.blur))
    if (shadow.kind === 'drop') {
      // feDropShadow draws the shadow AND the source over it, so it is the
      // whole effect in one primitive.
      parts.push(
        `<feDropShadow in="${source}" dx="${round(shadow.x)}" dy="${round(shadow.y)}"` +
          ` stdDeviation="${sd}" flood-color="${color}" flood-opacity="${alpha}"/>`,
      )
    } else {
      // An inner shadow is the shape MINUS a copy of itself shifted and
      // blurred: what is left is the rim inside the edge, which is then
      // flooded with the shadow colour and drawn back over the shape.
      parts.push(
        `<feOffset in="${source}" dx="${round(shadow.x)}" dy="${round(shadow.y)}" result="fx-off"/>`,
        `<feGaussianBlur in="fx-off" stdDeviation="${sd}" result="fx-offblur"/>`,
        `<feComposite operator="out" in="${source}" in2="fx-offblur" result="fx-rim"/>`,
        `<feFlood flood-color="${color}" flood-opacity="${alpha}" result="fx-color"/>`,
        `<feComposite operator="in" in="fx-color" in2="fx-rim" result="fx-shadow"/>`,
        `<feComposite operator="over" in="fx-shadow" in2="${source}"/>`,
      )
    }
  }

  // A region in user space rather than the default -10%..120% of the bounding
  // box: percentages collapse to nothing on a horizontal line, whose box has no
  // height, and clip a large offset on a small shape.
  return {
    id: effectFilterId(nodeId),
    ...filterRegion(effectMargin(style), box),
    primitives: parts.join(''),
  }
}

/**
 * The filter primitives that blur a backdrop.
 *
 * Background blur has no SVG filter of its own: `BackgroundImage`, the input
 * that would have read what is underneath, was dropped from the spec and
 * shipped in no browser. CSS `backdrop-filter` is not the answer either — it is
 * accepted on an SVG element and then ignored, which is worse than being
 * rejected, because the property reads back as set.
 *
 * So the backdrop is re-drawn: whatever is painted beneath the shape is drawn a
 * second time, blurred and clipped to the shape. Both the canvas and the
 * exporter do exactly that, from these primitives, which is why the two agree.
 */
export function backgroundBlurPrimitives(blur: BlurEffect): string {
  const parts = [`<feGaussianBlur stdDeviation="${round(blurStdDeviation(blur.amount))}"/>`]
  if (blur.brightness !== 0) {
    // Adobe's -50..+50 over a linear transfer: -50 is black, +50 twice as bright.
    const func = `type="linear" slope="${round(1 + blur.brightness / 50)}"`
    parts.push(
      `<feComponentTransfer><feFuncR ${func}/><feFuncG ${func}/><feFuncB ${func}/></feComponentTransfer>`,
    )
  }
  return parts.join('')
}

/** Filter and clip ids for a node's background blur. */
export const backdropFilterId = (nodeId: string): string => `bdblur-${nodeId}`
export const backdropClipId = (nodeId: string): string => `bdclip-${nodeId}`

/** Multiplier a background blur puts on the shape's own fill. */
export function backgroundFillOpacity(style: Style): number {
  const blur = activeBlur(style, 'background')
  return blur ? Math.min(1, Math.max(0, blur.fillOpacity)) : 1
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

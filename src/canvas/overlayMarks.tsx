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
 * The marks drawn on a path's points, shared by the two overlays that draw them.
 *
 * The path editor and the pen preview both draw anchors and direction handles,
 * and they used to do it with the same JSX copied into each — same radius, same
 * class names, written out twice. One of them then acquired a third state the
 * other did not have, which is exactly the drift a shared component prevents.
 *
 * Adobe's convention, and the one these follow: an anchor is a CIRCLE, hollow
 * when it is not the point you are working on and filled when it is. The pen's
 * documentation leans on it — "position the Pen tool over the first (hollow)
 * anchor point" is how it tells you where to click to close a path — so the
 * shape is not decoration, it is what the instructions refer to.
 */

/** Radius of an anchor and of a direction handle, in screen pixels. */
export const ANCHOR_R = 3.5

/**
 * One anchor.
 *
 * `selected` covers both meanings the fill has: a point picked in the editor,
 * and the point the pen is currently drawing from. They are the same state —
 * "this is the one you are working on" — so they share the one appearance.
 */
export function AnchorDot({
  x,
  y,
  selected,
  className = 'anchor-point',
}: {
  x: number
  y: number
  selected?: boolean
  /**
   * What this dot IS, when it is not a point of the path being edited.
   *
   * The pen draws the same mark over the ends of a path it is merely hovering,
   * and those are not anchors of anything selected — giving them their own
   * class keeps "how many points does this path have" answerable, by markup
   * and by test alike.
   */
  className?: string
}) {
  return (
    <circle className={selected ? `${className} selected` : className} cx={x} cy={y} r={ANCHOR_R} />
  )
}

/** The end of a direction line. */
export function HandleDot({ x, y }: { x: number; y: number }) {
  return <circle className="bezier-handle" cx={x} cy={y} r={ANCHOR_R} />
}

/** The line joining an anchor to one of its direction handles. */
export function HandleArm({ from, to }: { from: { x: number; y: number }; to: { x: number; y: number } }) {
  return <line className="handle-arm" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
}

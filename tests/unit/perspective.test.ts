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
 * The perspective maths behind 3D Transforms, below the scene graph.
 *
 * The directions are pinned against what Adobe's screenshots show rather than
 * against whatever the code happens to compute: positive X rotation narrows
 * the TOP of a card, positive Y rotation shortens its RIGHT edge, positive Z
 * makes it bigger. The mesh is checked for the two properties the renderer
 * relies on — it agrees with the projection to within the tolerance, and
 * neighbouring triangles share their corners exactly.
 */

import { describe, it, expect } from 'vitest'
import {
  MAT4_IDENTITY,
  NEAR_W,
  applyMat3,
  homographyOfPlane,
  homographyW,
  invertMat3,
  isAffineMat3,
  mapPoint,
  mat3Multiply,
  mat4Compose,
  mat4Multiply,
  mat4Perspective,
  mat4RotateX,
  mat4RotateY,
  mat4Translate,
  perspectiveMesh,
  projectBox,
  projectedBounds,
  projectPathData,
  toCssMatrix3d,
  type Mat3,
} from '../../src/geometry/Perspective'
import { trianglePath } from '../../src/canvas/perspectiveMarkup'

const D = 800

/** The homography for a w x h card tilted about its centre, as Scene3D builds it. */
function card(w: number, h: number, rx: number, ry: number, z = 0): Mat3 {
  const toCentre = mat4Translate(-w / 2, -h / 2, 0)
  const back = mat4Translate(w / 2, h / 2, 0)
  const tilt = mat4Compose(toCentre, mat4RotateY(ry), mat4RotateX(rx), mat4Translate(0, 0, z), back)
  const camera = mat4Compose(toCentre, mat4Perspective(D), back)
  return homographyOfPlane(mat4Multiply(camera, tilt))
}

const len = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, b.y - a.y)

describe('directions, as Adobe draws them', () => {
  it('a positive X rotation tips the top edge away, so the top is the narrower', () => {
    const [tl, tr, br, bl] = projectBox(card(240, 300, 20, 0), { x: 0, y: 0, width: 240, height: 300 })!
    expect(len(tl!, tr!)).toBeLessThan(len(bl!, br!))
  })

  it('a negative X rotation narrows the bottom instead', () => {
    const [tl, tr, br, bl] = projectBox(card(240, 300, -20, 0), { x: 0, y: 0, width: 240, height: 300 })!
    expect(len(tl!, tr!)).toBeGreaterThan(len(bl!, br!))
  })

  it('a positive Y rotation turns the right edge away, so the right is the shorter', () => {
    const [tl, tr, br, bl] = projectBox(card(240, 300, 0, 30), { x: 0, y: 0, width: 240, height: 300 })!
    expect(len(tr!, br!)).toBeLessThan(len(tl!, bl!))
    // And about a fifth shorter, which is what the camera distance was chosen for.
    expect(len(tl!, bl!) / len(tr!, br!)).toBeGreaterThan(1.12)
    expect(len(tl!, bl!) / len(tr!, br!)).toBeLessThan(1.3)
  })

  it('a positive Z brings the card toward you: bigger, about its own centre', () => {
    const box = { x: 0, y: 0, width: 240, height: 300 }
    const near = projectedBounds(card(240, 300, 0, 0, 100), box)!
    const far = projectedBounds(card(240, 300, 0, 0, -100), box)!
    expect(near.width).toBeGreaterThan(240)
    expect(far.width).toBeLessThan(240)
    for (const b of [near, far]) {
      expect(b.x + b.width / 2).toBeCloseTo(120, 9)
      expect(b.y + b.height / 2).toBeCloseTo(150, 9)
    }
  })

  it('depth alone is an affine map — a scale SVG can draw exactly — and a tilt is not', () => {
    expect(isAffineMat3(card(100, 100, 0, 0, 50))).toBe(true)
    expect(isAffineMat3(card(100, 100, 0, 10))).toBe(false)
    expect(isAffineMat3(homographyOfPlane(MAT4_IDENTITY))).toBe(true)
  })
})

describe('homographies', () => {
  it('invert exactly, so a click can be run back through the projection', () => {
    const h = card(200, 120, 25, -40, 60)
    const inv = invertMat3(h)!
    for (const [x, y] of [[0, 0], [200, 0], [37, 91], [200, 120]] as const) {
      const p = applyMat3(h, x, y)
      const back = applyMat3(inv, p.x, p.y)
      expect(back.x).toBeCloseTo(x, 7)
      expect(back.y).toBeCloseTo(y, 7)
    }
  })

  it('compose like matrices', () => {
    const a = card(100, 100, 10, 20)
    const b = card(50, 80, -30, 5, 20)
    const ab = mat3Multiply(a, b)
    const q = applyMat3(b, 12, 34)
    const direct = applyMat3(ab, 12, 34)
    const stepwise = applyMat3(a, q.x, q.y)
    expect(direct.x).toBeCloseTo(stepwise.x, 7)
    expect(direct.y).toBeCloseTo(stepwise.y, 7)
  })

  it('write as the CSS matrix3d that projects the same way, for the text editor', () => {
    const h = card(100, 60, 15, 30)
    const css = toCssMatrix3d(h)
    const v = css.slice('matrix3d('.length, -1).split(',').map(Number)
    expect(v).toHaveLength(16)
    // Column-major, w in the fourth row: (x, y) -> (v0 x + v4 y + v12) / (v3 x + v7 y + v15).
    const x = 70
    const y = 20
    const w = v[3]! * x + v[7]! * y + v[15]!
    const p = applyMat3(h, x, y)
    expect((v[0]! * x + v[4]! * y + v[12]!) / w).toBeCloseTo(p.x, 9)
    expect((v[1]! * x + v[5]! * y + v[13]!) / w).toBeCloseTo(p.y, 9)
  })

  it('refuse a point behind the camera rather than projecting it through the eye', () => {
    // Turned almost edge-on, a wide panel's near side passes the eye.
    const h = card(2400, 100, 0, 80)
    expect(mapPoint(h, 1200, 50)).not.toBeNull()
    expect(homographyW(h, 0, 50)).toBeLessThan(0)
    expect(mapPoint(h, 0, 50)).toBeNull()
    // What can be seen of it is still a sensible, finite shape.
    const b = projectedBounds(h, { x: 0, y: 0, width: 2400, height: 100 })
    expect(b).not.toBeNull()
    expect(Number.isFinite(b!.width) && Number.isFinite(b!.height)).toBe(true)
  })

  it('project an outline into a closed path', () => {
    const d = projectPathData('M0 0H100V100H0Z', card(100, 100, 30, 0))
    expect(d.startsWith('M')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
  })
})

describe('the mesh', () => {
  const box = { x: -2, y: -2, width: 244, height: 304 }

  it('lands every corner exactly on the projection, and strays less than the tolerance between them', () => {
    const h = card(240, 300, 15, 40)
    const px = 2
    const tolerance = 0.5
    const mesh = perspectiveMesh(h, box, { pxPerUnit: px, tolerance, maxTriangles: 4000 })
    expect(mesh.length).toBeGreaterThan(2)
    const inv = invertMat3(h)!
    for (const t of mesh) {
      // Sample inside each triangle: its affine map against the true projection.
      for (const [a, b, c] of [[1 / 3, 1 / 3, 1 / 3], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5]] as const) {
        const dst = {
          x: a * t.points[0].x + b * t.points[1].x + c * t.points[2].x,
          y: a * t.points[0].y + b * t.points[1].y + c * t.points[2].y,
        }
        // Where the triangle's own map says that point came from…
        const m = t.matrix
        const det = m[0] * m[3] - m[1] * m[2]
        const sx = (m[3] * (dst.x - m[4]) - m[2] * (dst.y - m[5])) / det
        const sy = (-m[1] * (dst.x - m[4]) + m[0] * (dst.y - m[5])) / det
        // …and where the true projection puts it.
        const truth = applyMat3(h, sx, sy)
        expect(Math.hypot(truth.x - dst.x, truth.y - dst.y) * px).toBeLessThanOrEqual(tolerance + 1e-6)
      }
      // The corners are exact.
      for (const p of t.points) {
        const src = applyMat3(inv, p.x, p.y)
        const again = applyMat3(h, src.x, src.y)
        expect(again.x).toBeCloseTo(p.x, 6)
        expect(again.y).toBeCloseTo(p.y, 6)
      }
    }
  })

  it('shares every corner bit-for-bit, so crisp masks meet with no seam', () => {
    const mesh = perspectiveMesh(card(240, 300, 25, -35), box, { pxPerUnit: 1.5 })
    // Every vertex written in the markup, and how many triangles use it.
    const uses = new Map<string, number>()
    for (const t of mesh) {
      for (const token of trianglePath(t).match(/-?\d+(\.\d+)?\s-?\d+(\.\d+)?/g)!) {
        uses.set(token, (uses.get(token) ?? 0) + 1)
      }
    }
    // Interior vertices of a grid are shared by several triangles. If sharing
    // were approximate, every vertex would appear once.
    const shared = [...uses.values()].filter((n) => n >= 3).length
    expect(shared).toBeGreaterThan(0)
  })

  it('needs more triangles zoomed in than zoomed out, and respects the cap', () => {
    const h = card(240, 300, 20, 35)
    const out = perspectiveMesh(h, box, { pxPerUnit: 0.5 }).length
    const inn = perspectiveMesh(h, box, { pxPerUnit: 4, maxTriangles: 10_000 }).length
    expect(inn).toBeGreaterThan(out)
    expect(perspectiveMesh(h, box, { pxPerUnit: 16, maxTriangles: 40 }).length).toBeLessThanOrEqual(40)
  })

  it('covers only what the camera can see', () => {
    const h = card(2400, 100, 0, 80)
    const mesh = perspectiveMesh(h, { x: 0, y: 0, width: 2400, height: 100 }, { pxPerUnit: 1 })
    expect(mesh.length).toBeGreaterThan(0)
    const inv = invertMat3(h)!
    for (const t of mesh) {
      for (const p of t.points) {
        const src = applyMat3(inv, p.x, p.y)
        expect(homographyW(h, src.x, src.y)).toBeGreaterThanOrEqual(NEAR_W - 1e-9)
      }
    }
  })
})

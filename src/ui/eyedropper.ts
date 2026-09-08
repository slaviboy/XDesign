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
 * Sampling a colour from the canvas.
 *
 * The artwork is rendered as SVG, so there are no pixels to read until we make
 * some: arming the eyedropper serialises the visible document through the same
 * exporter the PNG pipeline uses — bitmaps embedded, gradients intact — and
 * rasterises it ONCE. Every subsequent sample is an array lookup, so tracking
 * the pointer costs nothing.
 *
 * The native `EyeDropper` API is deliberately not used: it is Chromium-only, so
 * a fallback would be needed anyway; it takes over the screen with an OS
 * magnifier that cannot be driven by the test suite; and it cannot keep the
 * picker's own fields updating as the pointer moves.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { exportNodesToSvg } from '../svg/SvgExporter'
import { rasterizeSvgToImageData } from '../export/Rasterizer'
import { screenToDoc } from '../canvas/Viewport'
import { editorStore } from '../state/EditorStore'
import { getDoc } from '../state/DocumentStore'
import type { RGBA } from '../document/types'

export interface EyedropperSampler {
  /** @returns the colour under a page coordinate, or null where nothing is drawn. */
  sample(clientX: number, clientY: number): RGBA | null
}

/** Rasterise what is on screen right now. Null when there is nothing to sample. */
export async function armEyedropper(): Promise<EyedropperSampler | null> {
  const el = document.querySelector('[data-testid="canvas-root"]')
  if (!el) return null
  const rect = el.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return null

  const { viewport } = editorStore.getState()
  const topLeft = screenToDoc(viewport, { x: 0, y: 0 })
  const bottomRight = screenToDoc(viewport, { x: rect.width, y: rect.height })
  const bounds = {
    x: topLeft.x,
    y: topLeft.y,
    width: Math.max(1, bottomRight.x - topLeft.x),
    height: Math.max(1, bottomRight.y - topLeft.y),
  }

  const doc = getDoc()
  const root = doc.nodes[doc.rootId]
  const ids = root && 'children' in root ? root.children : []
  if (ids.length === 0) return null

  const { svg } = await exportNodesToSvg(doc, ids, {
    bounds,
    scale: viewport.zoom,
    imageHandling: 'embed',
    textHandling: 'embed-font',
    background: null,
  })

  const pixels = await rasterizeSvgToImageData(svg, {
    width: rect.width,
    height: rect.height,
  })

  return {
    sample(clientX, clientY) {
      const box = el.getBoundingClientRect()
      const x = Math.round(clientX - box.left)
      const y = Math.round(clientY - box.top)
      if (x < 0 || y < 0 || x >= pixels.width || y >= pixels.height) return null
      const i = (y * pixels.width + x) * 4
      const a = pixels.data[i + 3]! / 255
      // Transparent means nothing was drawn there; the caller holds its last
      // value rather than flashing to black.
      if (a === 0) return null
      return { r: pixels.data[i]!, g: pixels.data[i + 1]!, b: pixels.data[i + 2]!, a }
    },
  }
}

/**
 * The eyedropper as a control: arm it, sample while the pointer moves, commit on
 * click, and get out of the way on Escape or on any pan or zoom.
 *
 * Shared by the picker popover and the inspector's Fill and Stroke rows so there
 * is one implementation of "pick a colour off the canvas", not two that drift.
 */
export function useEyedropper(onPick: (color: RGBA, committing: boolean) => void): {
  armed: boolean
  arming: boolean
  toggle: () => void
  disarm: () => void
} {
  const [sampler, setSampler] = useState<EyedropperSampler | null>(null)
  const [arming, setArming] = useState(false)
  const pick = useRef(onPick)
  pick.current = onPick

  const disarm = useCallback(() => setSampler(null), [])

  const toggle = useCallback(() => {
    setSampler((current) => {
      if (current) return null
      setArming(true)
      void armEyedropper()
        .then((s) => setSampler(s))
        .catch(() => setSampler(null))
        .finally(() => setArming(false))
      return null
    })
  }, [])

  useEffect(() => {
    if (!sampler) return
    const sample = (e: PointerEvent, committing: boolean) => {
      const rgba = sampler.sample(e.clientX, e.clientY)
      if (rgba) pick.current(rgba, committing)
    }
    const onMove = (e: PointerEvent) => sample(e, false)
    const onDown = (e: PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      sample(e, true)
      disarm()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        disarm()
      }
    }
    document.body.classList.add('eyedropping')
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    // The raster is a snapshot of the current view, so a pan or zoom would make
    // it silently lie about what is under the pointer.
    const unsubscribe = editorStore.subscribe((s, prev) => {
      if (s.viewport !== prev.viewport) disarm()
    })
    return () => {
      document.body.classList.remove('eyedropping')
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      unsubscribe()
    }
  }, [sampler, disarm])

  return { armed: !!sampler, arming, toggle, disarm }
}

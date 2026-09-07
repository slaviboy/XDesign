/**
 * Custom cursors, as inline SVG data URLs.
 *
 * CSS has no rotation cursor, so the affordance has to be supplied as a cursor
 * image. A `data:` URL is used rather than a file so this stays offline-safe:
 * it is not a fetch, so it works with no network and cannot be blocked by the
 * service worker or a cold cache.
 *
 * A cursor image cannot be animated or transformed by CSS, so a rotated cursor
 * means one pre-rendered image per angle. They are generated once at module
 * load into ANGLE_BUCKETS discrete orientations — 16 buckets is 22.5 degrees
 * apart, which is below the threshold where the eye reads two adjacent
 * orientations as different, while keeping the set small enough to build
 * eagerly (each is well under 1KB of string).
 *
 * Every glyph is drawn twice: a thick white underlay and a thin black overlay.
 * That is what keeps a cursor legible over both white artboards and dark
 * artwork, which a single-colour glyph cannot do.
 */

const ANGLE_BUCKETS = 16
const BUCKET_SIZE = 360 / ANGLE_BUCKETS

/** Hotspot at the glyph's centre, so the cursor sits on the corner it rotates about. */
const HOTSPOT = 12

function svgCursor(inner: string, fallback: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${inner}</svg>`
  // encodeURIComponent rather than base64: shorter, and it keeps the markup
  // readable in devtools when debugging a cursor that will not show up.
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${HOTSPOT} ${HOTSPOT}, ${fallback}`
}

/**
 * A three-quarter circular arrow. The arc is open at the bottom-right so the
 * glyph reads as "turn this", and the arrowhead shows the direction.
 */
function rotationGlyph(angleDeg: number): string {
  const arc = 'M6.2 15.8a7 7 0 1 1 3.1 3.9'
  const head = 'M9.9 15.2l-0.7 5.1 5.1-0.7'
  return (
    `<g transform="rotate(${angleDeg} 12 12)">` +
    `<path d="${arc}" fill="none" stroke="#fff" stroke-width="4.2" stroke-linecap="round"/>` +
    `<path d="${head}" fill="none" stroke="#fff" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${arc}" fill="none" stroke="#1a1a1a" stroke-width="1.7" stroke-linecap="round"/>` +
    `<path d="${head}" fill="none" stroke="#1a1a1a" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</g>`
  )
}

const ROTATION_CURSORS: string[] = Array.from({ length: ANGLE_BUCKETS }, (_, i) =>
  svgCursor(rotationGlyph(i * BUCKET_SIZE), 'crosshair'),
)

/**
 * The rotation cursor oriented for a given direction.
 *
 * @param angleDeg direction from the selection's centre out to the corner under
 *   the pointer, in screen space. Because it is derived from the on-screen
 *   frame, it already accounts for the object's rotation AND the viewport — a
 *   corner of a 45-degree-rotated shape gets a 45-degree-rotated cursor.
 */
export function rotationCursor(angleDeg: number): string {
  const normalized = ((angleDeg % 360) + 360) % 360
  const bucket = Math.round(normalized / BUCKET_SIZE) % ANGLE_BUCKETS
  return ROTATION_CURSORS[bucket]!
}

/** Angle in degrees from `from` to `to`, in screen space. */
export function angleBetween(
  from: { x: number; y: number },
  to: { x: number; y: number },
): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI
}

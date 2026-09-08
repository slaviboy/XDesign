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
 * Every glyph is drawn twice: a white underlay and a dark shape over it. That
 * is what keeps a cursor legible over both white artboards and dark artwork,
 * which a single-colour glyph cannot do.
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
 * Geometry of the double-headed curved arrow: a circular band with a solid
 * triangular head at each end, both pointing away along the tangent.
 *
 * Built rather than written out as a literal `d` so the proportions stay
 * adjustable and the two ends cannot drift apart — every number below is a
 * measurement of the shape, not of a path someone traced by hand.
 */
const ARROW = {
  /** Centreline radius of the arc, before it is fitted into the icon. */
  radius: 13,
  /** Sweep of the whole arc in degrees. Wide and shallow, so it reads as a turn. */
  span: 110,
  /** Half-thickness of the band. */
  band: 1.7,
  headLength: 5.6,
  headHalfWidth: 4.2,
  /**
   * Radius from the icon's centre the finished glyph is scaled into.
   *
   * Fitted to a CIRCLE rather than to the 24x24 box, because the glyph is drawn
   * at sixteen different angles and a box fit would clip the diagonal ones. The
   * remainder up to 12 is the white underlay, which is drawn outside the fill.
   */
  fit: 10.4,
} as const

function buildDoubleArrow(): string {
  const { radius, band, headLength: len, headHalfWidth: wing, fit } = ARROW
  const half = ((ARROW.span / 2) * Math.PI) / 180
  // Where the band stops and the head starts, so the head is not swallowed.
  const stop = half - len / radius

  type P = { x: number; y: number }
  const at = (t: number): P => ({ x: radius * Math.sin(t), y: -radius * Math.cos(t) })
  const outward = (t: number): P => ({ x: Math.sin(t), y: -Math.cos(t) })
  const along = (t: number, sign: number): P => ({ x: sign * Math.cos(t), y: sign * Math.sin(t) })
  const step = (p: P, v: P, k: number): P => ({ x: p.x + v.x * k, y: p.y + v.y * k })

  const outer = (t: number) => step(at(t), outward(t), band)
  const inner = (t: number) => step(at(t), outward(t), -band)
  const head = (t: number, sign: number) => ({
    tip: step(at(t), along(t, sign), len),
    wingOut: step(at(t), outward(t), wing),
    wingIn: step(at(t), outward(t), -wing),
  })
  const right = head(stop, 1)
  const left = head(-stop, -1)

  // The arcs are sampled as well as the corners: in the default orientation the
  // extreme point is the top of the band, which is not a vertex.
  const samples: P[] = []
  for (let i = 0; i <= 32; i++) {
    const t = -stop + (2 * stop * i) / 32
    samples.push(outer(t), inner(t))
  }
  samples.push(right.tip, right.wingOut, right.wingIn, left.tip, left.wingOut, left.wingIn)

  const xs = samples.map((p) => p.x)
  const ys = samples.map((p) => p.y)
  const mid = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  }
  const scale = fit / Math.max(...samples.map((p) => Math.hypot(p.x - mid.x, p.y - mid.y)))

  const round = (n: number) => Math.round(n * 100) / 100
  const to = (p: P) => `${round(HOTSPOT + (p.x - mid.x) * scale)} ${round(HOTSPOT + (p.y - mid.y) * scale)}`
  const outerR = round((radius + band) * scale)
  const innerR = round((radius - band) * scale)

  return [
    `M${to(outer(-stop))}`,
    `A${outerR} ${outerR} 0 0 1 ${to(outer(stop))}`,
    `L${to(right.wingOut)}L${to(right.tip)}L${to(right.wingIn)}L${to(inner(stop))}`,
    `A${innerR} ${innerR} 0 0 0 ${to(inner(-stop))}`,
    `L${to(left.wingIn)}L${to(left.tip)}L${to(left.wingOut)}Z`,
  ].join('')
}

const DOUBLE_ARROW = buildDoubleArrow()

/**
 * The rotation glyph, turned so its arc bulges AWAY from the selection.
 *
 * @param angleDeg the outward direction, centre to corner. The arrow is built
 *   bulging upward, and up is -90 degrees on screen, so it is turned by a
 *   further quarter turn to land on the direction asked for. Bulging outward is
 *   what makes it read as turning around the object rather than along an edge.
 */
function rotationGlyph(angleDeg: number): string {
  return (
    `<g transform="rotate(${angleDeg + 90} ${HOTSPOT} ${HOTSPOT})">` +
    `<path d="${DOUBLE_ARROW}" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>` +
    `<path d="${DOUBLE_ARROW}" fill="#1a1a1a"/>` +
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

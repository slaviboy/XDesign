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
 * Icon set.
 *
 * Hand-drawn 16px SVG paths rather than an icon library: no runtime dependency,
 * no network fetch, and the stroke weight can be tuned to sit right at the small
 * sizes a dense inspector uses.
 */

import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  )
}

/**
 * Tool-rail icons.
 *
 * Drawn on a 24px grid rather than the 16px one the panel icons use: the rail
 * renders them at 20px, and the finer grid is what lets the strokes stay thin
 * and the geometry stay true at that size — matching the reference, where the
 * tool glyphs are noticeably larger and lighter than the dense inspector icons.
 */
function ToolIcon({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  )
}

/* ------------------------------------------------------------------ tools */

/**
 * The pointer, as one shape used twice.
 *
 * Both cursors are the same four-point arrow, and the only difference between
 * them is whether it is filled. That is the distinction Illustrator draws
 * between selecting an object and selecting its points, and keeping it to fill
 * alone is what makes the pair read as a pair — two outlines differing in some
 * detail of their geometry would just look like two arrows.
 */
const POINTER_PATH = 'M5.27 2.5L5.27 21.5L10.824 15.838L18.73 15.648Z'

/** Selecting whole objects: solid. */
export const CursorIcon = (p: IconProps) => (
  <ToolIcon {...p}>
    <path d={POINTER_PATH} fill="currentColor" strokeWidth={1.1} strokeLinejoin="round" />
  </ToolIcon>
)
/**
 * Selecting points: hollow. Nothing fills it, so whatever is behind shows
 * through — including the active state, where the solid arrow goes white and
 * this one stays an outline with the highlight inside it.
 */
export const DirectCursorIcon = (p: IconProps) => (
  <ToolIcon {...p}>
    <path d={POINTER_PATH} fill="none" strokeWidth={1.4} strokeLinejoin="round" />
  </ToolIcon>
)

/** A square, not a wide rectangle: the rail reads as a row of primitives, and
    the tool draws whatever you drag — so the icon should name the shape rather
    than guess at a proportion. */
export const RectIcon = (p: IconProps) => (
  <ToolIcon {...p}><rect x="4.6" y="4.6" width="14.8" height="14.8" /></ToolIcon>
)
export const EllipseIcon = (p: IconProps) => (
  <ToolIcon {...p}><circle cx="12" cy="12" r="8.4" /></ToolIcon>
)
export const TriangleIcon = (p: IconProps) => (
  <ToolIcon {...p}><path d="M12 4.1l8.3 15.8H3.7z" /></ToolIcon>
)
export const PolygonIcon = (p: IconProps) => (
  <ToolIcon {...p}><path d="M12 3.4l7.4 4.3v8.6L12 20.6l-7.4-4.3V7.7z" /></ToolIcon>
)
export const StarIcon = (p: IconProps) => (
  <ToolIcon {...p}>
    <path d="M12 3.2l2.72 5.51 6.08.89-4.4 4.29 1.04 6.05L12 17.08l-5.44 2.86 1.04-6.05-4.4-4.29 6.08-.89z" />
  </ToolIcon>
)
export const LineIcon = (p: IconProps) => (
  <ToolIcon {...p}><path d="M4.4 19.6L19.6 4.4" /></ToolIcon>
)
/**
 * Fountain-pen nib, angled the way a pen is held.
 *
 * Filled with a hole rather than stroked: the nib's outline and its slit are
 * one shape, and the counter between them is what gives the tip its taper. Even-odd
 * so the inner subpath cuts the hole whichever way round it happens to be wound.
 */
export const PenIcon = (p: IconProps) => (
  <ToolIcon {...p} fill="currentColor" stroke="none">
    <path fillRule="evenodd" d="M15.875 2.221L13.151 4.894L5.622 8.934L2.2 19.603L4.281 21.779L15.002 18.262L19.146 10.795L21.8 8.338L15.875 2.221ZM6.877 9.923L13.592 6.511L17.61 10.309L14.015 16.888L5.168 19.877C5.168 19.877 8.243 16.351 10.496 14.292C10.594 14.202 12.153 14.192 12.153 14.192L12.769 12.502L11.252 11.04L9.608 11.589C9.608 11.589 9.447 13.037 9.357 13.134C7.307 15.378 4.019 18.766 4.019 18.766L6.877 9.923Z" />
  </ToolIcon>
)
export const PencilIcon = (p: IconProps) => (
  <ToolIcon {...p}>
    <path d="M4 20l.6-4.3L15.9 4.4a2 2 0 012.9 0l.8.8a2 2 0 010 2.9L8.3 19.4z" />
    <path d="M14.6 5.7l3.7 3.7" />
  </ToolIcon>
)
/**
 * A typeset T, filled, with the slab serifs a letterform actually has.
 *
 * Filled rather than stroked: the three rules it used to be drew a T of even
 * thickness, which is a diagram of a letter rather than a letter. Everything
 * else on the rail is a shape the tool draws, and this one is a glyph.
 */
export const TextIcon = (p: IconProps) => (
  <ToolIcon {...p} fill="currentColor" stroke="none">
    <path d="M4.6 4.4h14.8v1.8h-6.5v12h2.4V20H8.7v-1.8h2.4v-12H4.6z" />
  </ToolIcon>
)
/** Artboard frame: the four rules that read as a canvas boundary. */
export const ArtboardIcon = (p: IconProps) => (
  <ToolIcon {...p}><path d="M7.6 3v18M16.4 3v18M3 7.6h18M3 16.4h18" /></ToolIcon>
)
export const ZoomIcon = (p: IconProps) => (
  <ToolIcon {...p}><circle cx="10.6" cy="10.6" r="6.6" /><path d="M15.4 15.4l5.1 5.1" /></ToolIcon>
)
export const HandIcon = (p: IconProps) => (
  <ToolIcon {...p}>
    <path d="M8.3 12V5.9a1.55 1.55 0 013.1 0V11m0-1.5a1.55 1.55 0 013.1 0V12m0-1.1a1.55 1.55 0 013.1 0v5a5.2 5.2 0 01-5.2 5.2h-1A5.9 5.9 0 015.2 14.6v-2a1.55 1.55 0 013.1 0" />
  </ToolIcon>
)

/* -------------------------------------------------------------- transform */

export const FlipHIcon = (p: IconProps) => (
  <Icon {...p}><path d="M8 2v12" strokeDasharray="2 2" /><path d="M6 5L3 8l3 3z" fill="currentColor" /><path d="M10 5l3 3-3 3z" fill="currentColor" /></Icon>
)
export const FlipVIcon = (p: IconProps) => (
  <Icon {...p}><path d="M2 8h12" strokeDasharray="2 2" /><path d="M5 6L8 3l3 3z" fill="currentColor" /><path d="M5 10l3 3 3-3z" fill="currentColor" /></Icon>
)
export const LinkIcon = (p: IconProps) => (
  <Icon {...p}><path d="M6.5 9.5a2.4 2.4 0 010-3.4l1.8-1.8a2.4 2.4 0 013.4 3.4l-.9.9" /><path d="M9.5 6.5a2.4 2.4 0 010 3.4l-1.8 1.8a2.4 2.4 0 01-3.4-3.4l.9-.9" /></Icon>
)
export const UnlinkIcon = (p: IconProps) => (
  <Icon {...p}><path d="M6.2 9.8L4.6 11.4a2.4 2.4 0 003.4 3.4" opacity="0.5" /><path d="M6.5 9.5a2.4 2.4 0 010-3.4l1.8-1.8a2.4 2.4 0 013.4 3.4l-.9.9" /><path d="M2.5 2.5l11 11" /></Icon>
)

/* ----------------------------------------------------------- transform */

/** The rotation field's leading glyph: a circular arrow. */
export const RotateIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13.1 8a5.1 5.1 0 11-1.6-3.7" />
    <path d="M13.4 2.2v2.9h-2.9" />
  </Icon>
)

/**
 * The 3D Transforms toggle: Adobe's cube, drawn in the same isometric view —
 * three visible faces meeting at the near corner.
 */
export const CubeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 1.9l5.3 3v6.2L8 14.1l-5.3-3V4.9z" />
    <path d="M2.7 4.9L8 8l5.3-3.1M8 8v6.1" />
  </Icon>
)

/**
 * Rotation about the horizontal axis: the axis, and an orbit looping over and
 * under it, arrowed the way a positive angle turns — the top away from you.
 */
export const RotateXIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M1.6 8h2.2M12.2 8h2.2" />
    <path d="M10.3 4.1A2.6 5 0 1 0 10.3 11.9" />
    <path d="M10.3 11.9l.2-2.3M10.3 11.9l-2.2-.7" />
  </Icon>
)

/** Rotation about the vertical axis: the same glyph, standing up. */
export const RotateYIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 1.6v2.2M8 12.2v2.2" />
    <path d="M4.1 5.7A5 2.6 0 1 0 11.9 5.7" />
    <path d="M11.9 5.7l-2.3-.2M11.9 5.7l-.7 2.2" />
  </Icon>
)

export const RotateLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.9 8a5.1 5.1 0 101.6-3.7" />
    <path d="M2.6 2.2v2.9h2.9" />
  </Icon>
)

/**
 * Aspect-ratio link, drawn as the bracket that spans the W and H fields.
 * Sized to the two-row grid cell rather than the usual 16px box.
 */
export const LinkBracket = ({
  locked,
  height = 54,
}: {
  locked: boolean
  height?: number
}) => (
  <svg
    width={13}
    height={height}
    viewBox={`0 0 13 ${height}`}
    fill="none"
    stroke="currentColor"
    strokeWidth={1}
    strokeLinecap="round"
  >
    {/* Tick into the W row, down the side, and back into the H row. */}
    <path d={`M0 6h5.5M12.5 6v${height / 2 - 6 - 8}M0 ${height - 6}h5.5M12.5 ${height - 6}v-${height / 2 - 6 - 8}`} />
    <path d={`M5.5 6h7M5.5 ${height - 6}h7`} opacity={0} />
    {locked ? (
      <g transform={`translate(3.5 ${height / 2 - 5})`}>
        <rect x="0.6" y="4.2" width="8" height="6" rx="1" fill="currentColor" stroke="none" />
        <path d="M2.4 4.2V2.9a2.2 2.2 0 014.4 0v1.3" />
      </g>
    ) : (
      <g transform={`translate(3.5 ${height / 2 - 5})`}>
        <rect x="0.6" y="4.2" width="8" height="6" rx="1" />
        <path d="M2.4 4.2V2.9a2.2 2.2 0 014.1-1.1" />
      </g>
    )}
  </svg>
)

/** All four corners edited together. */
export const CornersUniformIcon = (p: IconProps) => (
  <Icon {...p}><rect x="3" y="3" width="10" height="10" rx="2.6" /></Icon>
)

/** Each corner edited on its own — four independent brackets. */
export const CornersIndependentIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 6.4V5.6A2.6 2.6 0 015.6 3h.8" />
    <path d="M9.6 3h.8A2.6 2.6 0 0113 5.6v.8" />
    <path d="M13 9.6v.8a2.6 2.6 0 01-2.6 2.6h-.8" />
    <path d="M6.4 13h-.8A2.6 2.6 0 013 10.4v-.8" />
  </Icon>
)

/** Corner radius: a square with one rounded corner and its radius marked. */
export const RadiusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13.5 3.2v-.4H6.4A3.6 3.6 0 002.8 6.4v7.1" />
    <circle cx="6.6" cy="6.6" r="1.1" fill="currentColor" stroke="none" />
  </Icon>
)

/** Make every selected object as wide as the widest. */
export const MatchWidthIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.2 3v10M13.8 3v10" />
    <path d="M4.6 8h6.8M4.6 8l1.6-1.6M4.6 8l1.6 1.6M11.4 8l-1.6-1.6M11.4 8l-1.6 1.6" />
  </Icon>
)

/** Make every selected object as tall as the tallest. */
export const MatchHeightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 2.2h10M3 13.8h10" />
    <path d="M8 4.6v6.8M8 4.6L6.4 6.2M8 4.6l1.6 1.6M8 11.4l-1.6-1.6M8 11.4l1.6-1.6" />
  </Icon>
)

/** Make every selected object the same width AND height. */
export const MatchSizeIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.4" y="2.4" width="11.2" height="11.2" rx="1" />
    <path d="M2.4 5.6h11.2M5.6 2.4v11.2" opacity="0.45" />
    <rect x="5.6" y="5.6" width="4.6" height="4.6" fill="currentColor" stroke="none" opacity="0.8" />
  </Icon>
)

/* --------------------------------------------------------------- align */

export const AlignLeftIcon = (p: IconProps) => (
  <Icon {...p}><path d="M2.5 2v12" /><rect x="4.5" y="4" width="8" height="3" rx=".5" fill="currentColor" stroke="none" /><rect x="4.5" y="9" width="5" height="3" rx=".5" fill="currentColor" stroke="none" /></Icon>
)
export const AlignCenterHIcon = (p: IconProps) => (
  <Icon {...p}><path d="M8 2v12" /><rect x="4" y="4" width="8" height="3" rx=".5" fill="currentColor" stroke="none" /><rect x="5.5" y="9" width="5" height="3" rx=".5" fill="currentColor" stroke="none" /></Icon>
)
export const AlignRightIcon = (p: IconProps) => (
  <Icon {...p}><path d="M13.5 2v12" /><rect x="3.5" y="4" width="8" height="3" rx=".5" fill="currentColor" stroke="none" /><rect x="6.5" y="9" width="5" height="3" rx=".5" fill="currentColor" stroke="none" /></Icon>
)
export const AlignTopIcon = (p: IconProps) => (
  <Icon {...p}><path d="M2 2.5h12" /><rect x="4" y="4.5" width="3" height="8" rx=".5" fill="currentColor" stroke="none" /><rect x="9" y="4.5" width="3" height="5" rx=".5" fill="currentColor" stroke="none" /></Icon>
)
export const AlignCenterVIcon = (p: IconProps) => (
  <Icon {...p}><path d="M2 8h12" /><rect x="4" y="4" width="3" height="8" rx=".5" fill="currentColor" stroke="none" /><rect x="9" y="5.5" width="3" height="5" rx=".5" fill="currentColor" stroke="none" /></Icon>
)
export const AlignBottomIcon = (p: IconProps) => (
  <Icon {...p}><path d="M2 13.5h12" /><rect x="4" y="3.5" width="3" height="8" rx=".5" fill="currentColor" stroke="none" /><rect x="9" y="6.5" width="3" height="5" rx=".5" fill="currentColor" stroke="none" /></Icon>
)
export const DistributeHIcon = (p: IconProps) => (
  <Icon {...p}><path d="M2.5 2v12M13.5 2v12" /><rect x="6.5" y="5" width="3" height="6" rx=".5" fill="currentColor" stroke="none" /></Icon>
)
export const DistributeVIcon = (p: IconProps) => (
  <Icon {...p}><path d="M2 2.5h12M2 13.5h12" /><rect x="5" y="6.5" width="6" height="3" rx=".5" fill="currentColor" stroke="none" /></Icon>
)

/* ---------------------------------------------------------------- boolean */

/*
 * Two overlapping rounded squares, where the SOLID region is the result of the
 * operation and the outline shows the operand that was consumed. Built from
 * three shared paths so the four icons read as one family.
 *
 * A: back square (2,2)-(10,10)   B: front square (6,6)-(14,14)
 * The overlap is (6,6)-(10,10), which lets subtract and intersect be expressed
 * exactly with fill-rule rather than needing real boolean geometry in an icon.
 */
const BOOL_A = 'M3.6 2h4.8a1.6 1.6 0 0 1 1.6 1.6v4.8a1.6 1.6 0 0 1-1.6 1.6H3.6A1.6 1.6 0 0 1 2 8.4V3.6A1.6 1.6 0 0 1 3.6 2z'
const BOOL_B = 'M7.6 6h4.8a1.6 1.6 0 0 1 1.6 1.6v4.8a1.6 1.6 0 0 1-1.6 1.6H7.6A1.6 1.6 0 0 1 6 12.4V7.6A1.6 1.6 0 0 1 7.6 6z'
const BOOL_OVERLAP = 'M6 6h2.4a1.6 1.6 0 0 1 1.6 1.6V10H6z'

/** Both shapes merged into one solid region. */
export const UnionIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d={`${BOOL_A}${BOOL_B}`} fill="currentColor" fillRule="nonzero" stroke="none" />
  </Icon>
)

/** The back shape with the front shape's overlap removed. */
export const SubtractIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d={`${BOOL_A}${BOOL_OVERLAP}`} fill="currentColor" fillRule="evenodd" stroke="none" />
    <path d={BOOL_B} fill="none" opacity="0.5" />
  </Icon>
)

/** Only the region common to both. */
export const IntersectIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d={BOOL_A} fill="none" opacity="0.5" />
    <path d={BOOL_B} fill="none" opacity="0.5" />
    <path d={BOOL_OVERLAP} fill="currentColor" stroke="none" />
  </Icon>
)

/** Both shapes minus the region they share. */
export const ExcludeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d={`${BOOL_A}${BOOL_B}`} fill="currentColor" fillRule="evenodd" stroke="none" />
  </Icon>
)

/** 2x2 grid of squares — the Repeat Grid mark. */
export const RepeatGridIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.2" y="2.2" width="5" height="5" rx="0.9" />
    <rect x="8.8" y="2.2" width="5" height="5" rx="0.9" />
    <rect x="2.2" y="8.8" width="5" height="5" rx="0.9" />
    <rect x="8.8" y="8.8" width="5" height="5" rx="0.9" />
  </Icon>
)

/* ---------------------------------------------------------------- layers */

export const EyeIcon = (p: IconProps) => (
  <Icon {...p}><path d="M1.8 8S4 4.2 8 4.2 14.2 8 14.2 8 12 11.8 8 11.8 1.8 8 1.8 8z" /><circle cx="8" cy="8" r="1.7" /></Icon>
)
export const EyeOffIcon = (p: IconProps) => (
  <Icon {...p}><path d="M6.3 4.5A6 6 0 018 4.2C12 4.2 14.2 8 14.2 8a11 11 0 01-2 2.3M9.7 11.5a6 6 0 01-1.7.3C4 11.8 1.8 8 1.8 8a11 11 0 012-2.3" /><path d="M2 2l12 12" /></Icon>
)
export const LockIcon = (p: IconProps) => (
  <Icon {...p}><rect x="3.5" y="7" width="9" height="6" rx="1" /><path d="M5.5 7V5.2a2.5 2.5 0 015 0V7" /></Icon>
)
export const UnlockIcon = (p: IconProps) => (
  <Icon {...p}><rect x="3.5" y="7" width="9" height="6" rx="1" /><path d="M5.5 7V5.2a2.5 2.5 0 014.8-.9" /></Icon>
)
export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p} size={p.size ?? 12}><path d="M6 3.5L10.5 8 6 12.5" /></Icon>
)
export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p} size={p.size ?? 12}><path d="M3.5 6L8 10.5 12.5 6" /></Icon>
)
export const GroupIcon = (p: IconProps) => (
  <Icon {...p}><rect x="2.5" y="2.5" width="11" height="11" rx="1" strokeDasharray="2.5 2" /><rect x="5" y="5" width="6" height="6" rx=".5" /></Icon>
)
export const ImageIcon = (p: IconProps) => (
  <Icon {...p}><rect x="2.5" y="3.5" width="11" height="9" rx="1" /><circle cx="6" cy="6.5" r="1" /><path d="M3 11l3-2.5 2.5 2 2-1.5 3 2.5" /></Icon>
)
export const PathIcon = (p: IconProps) => (
  <Icon {...p}><path d="M3 12c0-5 3-8 5-8s5 2 5 5" /><rect x="1.8" y="10.8" width="2.4" height="2.4" fill="currentColor" stroke="none" /><rect x="11.8" y="7.8" width="2.4" height="2.4" fill="currentColor" stroke="none" /></Icon>
)
export const ExportBadgeIcon = (p: IconProps) => (
  <Icon {...p} size={p.size ?? 11}><path d="M8 2v8M5 6.5L8 10l3-3.5M3 12.5h10" /></Icon>
)

/* ----------------------------------------------------------------- misc */

export const MenuIcon = (p: IconProps) => (
  <Icon {...p}><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" /></Icon>
)
export const PlayIcon = (p: IconProps) => (
  <Icon {...p}><path d="M5 3.2l7 4.8-7 4.8z" fill="currentColor" strokeWidth="1" /></Icon>
)
export const PlusIcon = (p: IconProps) => (
  <Icon {...p}><path d="M8 3.5v9M3.5 8h9" /></Icon>
)
export const MinusIcon = (p: IconProps) => (
  <Icon {...p}><path d="M3.5 8h9" /></Icon>
)
export const TrashIcon = (p: IconProps) => (
  <Icon {...p}><path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.6 8.2a1 1 0 001 .8h3.8a1 1 0 001-.8l.6-8.2" /></Icon>
)
export const CloseIcon = (p: IconProps) => (
  <Icon {...p}><path d="M4 4l8 8M12 4l-8 8" /></Icon>
)
/**
 * Pipette, from the supplied artwork.
 *
 * A filled glyph on a 32-unit grid rather than the 16-unit stroked one the other
 * panel icons use, so it keeps its own viewBox instead of going through Icon.
 */
export const EyedropperIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="currentColor" {...rest}>
    <path d="M27.7,3.3c-1.5-1.5-3.9-1.5-5.4,0L17,8.6l-1.3-1.3c-0.4-0.4-1-0.4-1.4,0s-0.4,1,0,1.4l1.3,1.3L5,20.6
      c-0.6,0.6-1,1.4-1.1,2.3C3.3,23.4,3,24.2,3,25c0,1.7,1.3,3,3,3c0.8,0,1.6-0.3,2.2-0.9C9,27,9.8,26.6,10.4,26L21,15.4l1.3,1.3
      c0.2,0.2,0.5,0.3,0.7,0.3s0.5-0.1,0.7-0.3c0.4-0.4,0.4-1,0-1.4L22.4,14l5.3-5.3C29.2,7.2,29.2,4.8,27.7,3.3z M9,24.6
      c-0.4,0.4-0.8,0.6-1.3,0.5c-0.4,0-0.7,0.2-0.9,0.5C6.7,25.8,6.3,26,6,26c-0.6,0-1-0.4-1-1c0-0.3,0.2-0.7,0.5-0.8
      c0.3-0.2,0.5-0.5,0.5-0.9c0-0.5,0.2-1,0.5-1.3L17,11.4l2.6,2.6L9,24.6z" />
  </svg>
)

export const GridIcon = (p: IconProps) => (
  <Icon {...p}><path d="M6 2.5v11M10 2.5v11M2.5 6h11M2.5 10h11" /></Icon>
)
/* ----------------------------------------------------------------- stroke */

/*
 * The stroke icons draw the thing they name rather than symbolising it: the cap
 * and join glyphs are real strokes carrying the real `stroke-linecap` and
 * `stroke-linejoin`, so each icon IS its setting and the two cannot drift.
 *
 * The alignment three need a reference to be read against, so they show the
 * shape as a faint outline with the stroke band sitting inside it, outside it,
 * or straddling the edge.
 */

/**
 * The object the alignment icons measure against: a filled square, so the band
 * can be seen sitting inside it, outside it, or across its edge. A bare outline
 * disappears under the band it is meant to be compared with.
 */
const AlignShape = () => (
  <path d="M4 3H13V12H4Z" fill="currentColor" stroke="none" opacity={0.2} />
)

export const StrokeInnerIcon = (p: IconProps) => (
  <Icon {...p}>
    <AlignShape />
    <path d="M5.5 3V10.5H13" strokeWidth={3} strokeLinecap="butt" />
  </Icon>
)
export const StrokeOuterIcon = (p: IconProps) => (
  <Icon {...p}>
    <AlignShape />
    <path d="M2.5 3V13.5H13" strokeWidth={3} strokeLinecap="butt" />
  </Icon>
)
export const StrokeCenterIcon = (p: IconProps) => (
  <Icon {...p}>
    <AlignShape />
    <path d="M4 3V12H13" strokeWidth={3} strokeLinecap="butt" />
  </Icon>
)

/** Where the stroke nominally ends, so the cap's overhang is visible. */
const CapEnd = () => <path d="M10.5 3v10" strokeWidth={1} opacity={0.4} />

export const CapButtIcon = (p: IconProps) => (
  <Icon {...p}>
    <CapEnd />
    <path d="M3 8h7.5" strokeWidth={5} strokeLinecap="butt" />
  </Icon>
)
export const CapRoundIcon = (p: IconProps) => (
  <Icon {...p}>
    <CapEnd />
    <path d="M3 8h7.5" strokeWidth={5} strokeLinecap="round" />
  </Icon>
)
export const CapSquareIcon = (p: IconProps) => (
  <Icon {...p}>
    <CapEnd />
    <path d="M3 8h7.5" strokeWidth={5} strokeLinecap="square" />
  </Icon>
)

export const JoinMiterIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 13V4.5h8" strokeWidth={4.5} strokeLinejoin="miter" strokeLinecap="butt" />
  </Icon>
)
export const JoinRoundIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 13V4.5h8" strokeWidth={4.5} strokeLinejoin="round" strokeLinecap="butt" />
  </Icon>
)
export const JoinBevelIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 13V4.5h8" strokeWidth={4.5} strokeLinejoin="bevel" strokeLinecap="butt" />
  </Icon>
)

/*
 * The three text resize options. Each draws a box with the axes it controls
 * marked by arrows: both for Auto Width (it grows sideways), the vertical one
 * for Auto Height, neither for Fixed Size.
 */
export const AutoWidthIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="5" width="10" height="6" rx="1" />
    <path d="M1 8h1.5M13.5 8H15" />
  </Icon>
)
export const AutoHeightIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5" y="3" width="6" height="10" rx="1" />
    <path d="M8 1v1.5M8 13.5V15" />
  </Icon>
)
export const FixedSizeIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="3.5" width="9" height="9" rx="1" />
    <path d="M6 6h4M6 8.5h4M6 11h2" strokeWidth={1} opacity={0.55} />
  </Icon>
)

/** A tray with an arrow going into it: the universal "drop a file here". */
export const ImportIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2.5v7" />
    <path d="M5 6.5L8 9.5l3-3" />
    <path d="M2.8 10.5v1.7a1.3 1.3 0 001.3 1.3h7.8a1.3 1.3 0 001.3-1.3v-1.7" />
  </Icon>
)
export const InfoIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7.2v4" />
    <path d="M8 4.9v.1" />
  </Icon>
)
/** A column grid: three bars with gutters between them. */
export const ColumnGridIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="2.5" width="3" height="11" />
    <rect x="6.5" y="2.5" width="3" height="11" />
    <rect x="10.5" y="2.5" width="3" height="11" />
  </Icon>
)
export const MagnetIcon = (p: IconProps) => (
  <Icon {...p}><path d="M4 12V6.5a4 4 0 018 0V12" /><path d="M4 12h3V9.5M12 12H9V9.5" /></Icon>
)
export const TextAlignLeftIcon = (p: IconProps) => (
  <Icon {...p}><path d="M3 4h10M3 7h6M3 10h9M3 13h5" /></Icon>
)
export const TextAlignCenterIcon = (p: IconProps) => (
  <Icon {...p}><path d="M3 4h10M5 7h6M2.5 10h11M5.5 13h5" /></Icon>
)
/* ------------------------------------------------------------------ theme */

export const SunIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="3.1" />
    <path d="M8 1.4v1.6M8 13v1.6M1.4 8h1.6M13 8h1.6M3.3 3.3l1.15 1.15M11.55 11.55l1.15 1.15M12.7 3.3l-1.15 1.15M4.45 11.55L3.3 12.7" />
  </Icon>
)

export const MoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13.4 9.6A5.8 5.8 0 016.4 2.6a5.9 5.9 0 107 7z" />
  </Icon>
)

/** "Follow the system setting" — a display, not a sun or a moon. */
export const MonitorIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="1.8" y="3" width="12.4" height="8.2" rx="1" />
    <path d="M5.6 13.6h4.8M8 11.2v2.4" />
  </Icon>
)

export const TextAlignRightIcon = (p: IconProps) => (
  <Icon {...p}><path d="M3 4h10M7 7h6M4 10h9M8 13h5" /></Icon>
)

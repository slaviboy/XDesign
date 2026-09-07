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

/** Classic pointer: filled, with the notched tail that reads as a cursor. */
export const CursorIcon = (p: IconProps) => (
  <ToolIcon {...p}>
    <path
      d="M5.5 2.4v16.9l4.3-4.2 2.7 6.2 2.6-1.1-2.7-6.1h6.1z"
      fill="currentColor"
      strokeWidth={1.1}
      strokeLinejoin="round"
    />
  </ToolIcon>
)
export const RectIcon = (p: IconProps) => (
  <ToolIcon {...p}><rect x="3.6" y="5.1" width="16.8" height="13.8" /></ToolIcon>
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
/** Fountain-pen nib — the universal mark for a Bézier pen. */
export const PenIcon = (p: IconProps) => (
  <ToolIcon {...p}>
    <path d="M12 2.6l7 11.1-7 7.7-7-7.7z" />
    <path d="M12 2.6v11.1" />
    <circle cx="12" cy="16.1" r="1.35" />
  </ToolIcon>
)
export const PencilIcon = (p: IconProps) => (
  <ToolIcon {...p}>
    <path d="M4 20l.6-4.3L15.9 4.4a2 2 0 012.9 0l.8.8a2 2 0 010 2.9L8.3 19.4z" />
    <path d="M14.6 5.7l3.7 3.7" />
  </ToolIcon>
)
export const TextIcon = (p: IconProps) => (
  <ToolIcon {...p}><path d="M5.4 6.6V4.2h13.2v2.4M12 4.2v15.6M8.9 19.8h6.2" /></ToolIcon>
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

export const UnionIcon = (p: IconProps) => (
  <Icon {...p}><path d="M3 3h6v4h4v6H7V9H3z" fill="currentColor" fillOpacity=".18" /></Icon>
)
export const SubtractIcon = (p: IconProps) => (
  <Icon {...p}><path d="M3 3h6v6H3z" fill="currentColor" fillOpacity=".18" /><rect x="7" y="7" width="6" height="6" strokeDasharray="2 2" /></Icon>
)
export const IntersectIcon = (p: IconProps) => (
  <Icon {...p}><rect x="3" y="3" width="6" height="6" strokeDasharray="2 2" /><rect x="7" y="7" width="6" height="6" strokeDasharray="2 2" /><rect x="7" y="7" width="2" height="2" fill="currentColor" fillOpacity=".35" /></Icon>
)
export const ExcludeIcon = (p: IconProps) => (
  <Icon {...p}><path d="M3 3h6v4H7v2H3z" fill="currentColor" fillOpacity=".18" /><path d="M9 7h4v6H7V9h2z" fill="currentColor" fillOpacity=".18" /></Icon>
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
export const GridIcon = (p: IconProps) => (
  <Icon {...p}><path d="M6 2.5v11M10 2.5v11M2.5 6h11M2.5 10h11" /></Icon>
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
export const TextAlignRightIcon = (p: IconProps) => (
  <Icon {...p}><path d="M3 4h10M7 7h6M4 10h9M8 13h5" /></Icon>
)

# XDesign

An offline-first vector design editor, in the shape of Adobe XD's Design workspace.

No account. No login. No server. No database. No telemetry. Once the app has loaded,
it needs no network connection at all, and every document lives on your own machine.

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm run build    # production build in dist/
npm run preview  # serve the production build
```

---

## What it does

**Drawing** — rectangle, ellipse, polygon, line, pen (real cubic Béziers), pencil
(smoothed freehand), text, artboard. Every tool in the rail is implemented; none of them
are decorative.

**One Polygon tool**, as in XD — there is no separate Triangle or Star tool, because there
is no separate shape. Corner Count 3 is a triangle, Star Ratio below 100% is a star, and
both are reversible: turning a star back into a triangle is two field edits, not a
different object. The Star Ratio also has an on-canvas handle (Shift snaps to 10%).

**Pen** — every procedure Adobe documents. Click for corners, drag for curves, `Alt` while
dragging to split the direction lines (two curves meeting at a cusp), `Alt`-click the last
anchor to retract its handle (a curve followed by a straight line), `Shift` to constrain to
45° placing and 15° dragging. Click the first point to close, or drag from it to shape the
closing curve. `Enter`, `Escape` or a double-click ends an open path.

**Two pointers** — the filled arrow selects and moves whole objects; the hollow one
(**Direct Selection**, `D`) goes straight to the leaf and shows its points. A single click on
a rectangle puts its four corners on screen, on a line its two ends. Looking costs nothing:
the shape stays a live rectangle, with its Corners and Radius fields, until you actually move
a point — at which moment it becomes an editable path, as Illustrator does. The path being
edited is traced in a blue hairline drawn over the artwork, so the edges read even on a shape
whose fill matches what is behind it, and the trace comes from the live point model, not the
document, so it follows a point through the drag rather than snapping on release.
Double-clicking a shape with the arrow does the same thing, and lights up the Direct Selection
button while it is doing it — the rail names the mode the canvas is actually in, and the two
pointers hand the points back and forth without dropping them.

**Artboards** — double-click a name label on the canvas to rename it in place, with the whole
name selected so typing replaces it. `Enter` or clicking away commits, `Escape` abandons, and
an empty name keeps the old one rather than leaving an artboard with no name at all. Dragging
the name moves the artboard whatever tool is selected: the label is chrome rather than artwork,
so it takes the pointer itself and no tool ever sees the press. It is positioned from the live
matrix, so it travels with the artboard instead of jumping to it on release.

**Editing** — click, shift-click, marquee, nested group entry, move/resize/rotate with
snapping and smart guides, per-point Bézier editing, boolean operations, alignment and
distribution, z-ordering, grouping, locking, hiding, guides and a grid. Corners carry a
rotation cursor oriented to the corner and the object's own angle.

**Transform panel** — W/H with an aspect-ratio lock, X/Y, rotation, flips, and match
width / height / size across a selection. Every readout tracks a drag in real time.

**Gradients** — linear, radial and angular, each with an on-canvas editor while the picker is
open: a segment with draggable endpoints for a linear gradient, a centre and a radius handle for a
radial one, a centre and an angle handle for an angular one. Stops ride the widget too — click it to
add one, drag it along to reposition, drag it off to delete, or select it and press Delete. Arrow
keys nudge, Tab cycles.

**Fill and stroke** — each row leads with an on/off box and ends with an eyedropper. Off *is* `none`
in the model, so unchecking a paint also hides the controls that only apply when it exists — the
blend mode for a fill, the whole cap/join/align/dash block for a stroke — and checking it back
restores the colour that was there rather than a default. The eyedropper samples straight from the
canvas without opening the picker at all.

**Colour** — a paint-type dropdown (solid, linear, radial, angular, none), Hex / RGB / HSL / HSV
numeric modes, an opacity field, an eyedropper that samples any rendered pixel on the canvas
including images and gradients, and a document palette that starts empty and fills up as you
save colours with (+).

**Corner radius** — draggable handles inside rectangles, polygons and stars.
Drag inward to round, outward to sharpen. Each handle keeps a constant gap inside the corner
it rounds, so it stays reachable at any radius without drifting toward the centre. A
rectangle's corners can be edited together (one field) or independently (four), and the handle
follows whichever mode is selected. Every radius field carries an `R` label you can drag to
scrub the value, like every other number in the inspector.

**Repeat Grid** — repeat a selection in a grid. Edit any cell and every cell follows,
because the grid holds one source rather than N copies. Expand turns it into independent
objects.

**Dark theme** — a full dark palette, with "follow system" in the app menu. Artboard
backgrounds deliberately do NOT follow the theme: they are document data, and the artwork
has to look the same to everyone who opens the file.

**Import** — SVG and raster images (PNG, JPEG, GIF, WebP, BMP, AVIF) by drag-and-drop,
paste, or File ▸ Import. Imported SVG becomes real editable nodes: shapes stay shapes,
gradients stay gradients, groups stay groups. Nothing is ever rasterized on import.

**Export** — SVG, PNG and JPEG, of a selection, an artboard, the whole document, or every
layer marked for export, at 0.1×–10× scale.

**Files** — a self-contained `.xdesign` document you can copy to another machine and open
with every vector and every pixel intact. Plus autosave and crash recovery.

---

## Design decisions worth knowing about

### The document is a scene graph, not a canvas

The document is a normalized, DOM-free tree of typed nodes. SVG renders it; Canvas is used
only as a rasterization target when exporting PNG or JPEG. Nothing about the document
depends on the DOM, which is why the geometry engine is directly testable in Node.

Geometry is authored in **local space** — every shape spans `(0,0)…(width,height)` and a
transform maps it into its parent. Rotating a star never rewrites the star: its `sides`
and `starRatio` stay editable forever. That is what makes *group → rotate → ungroup*
round-trip exactly.

### Dragging never writes to the store

A store write runs every subscribed component's selector, which is O(nodes) per frame. So a
drag does not write to the store at all: matrices are computed in pure TypeScript and
pushed straight onto the mounted SVG elements, coalesced into one `requestAnimationFrame`
flush. One transaction is committed on pointer-up, which is also why a 200-event drag is a
single undo step.

### Resize happens in the object's own unrotated space

Scaling a rotated object in world space composes as `R·S`, and since `R·S ≠ S·R` the shape
*shears* — it visibly melts as you drag. Resize therefore transforms the pointer by
`invert(M₀)`, derives the new box from the fixed opposite corner, and re-anchors. The
rotation component is never touched. Property tests assert that skew stays at zero across
random angles and handle drags.

A group is the exception, and it has to be: a group has no size of its own — its box only
records where its children happened to be when it was formed — so writing a new
width/height changes nothing anyone can see. Its resize goes into the matrix instead, which
is what the children inherit. Every other node keeps its size in width/height so strokes,
corner radii and text layout do not scale with the box; an artboard and a repeat grid draw
their own box, so they resize like a shape.

### Three different bounding boxes

Conflating these produces a whole family of "the export is clipped" bugs:

| Box | What it is | Used for |
| --- | --- | --- |
| `geometryBounds` | exact fill outline | align, distribute, selection frame |
| `renderBounds` | ⊕ stroke, incl. miter extension | export cropping |
| `localGeometryBounds` | the same, in local space | hit testing |

A miter join on a sharp corner reaches `miterlimit × width / 2`, not `width / 2`. Bounds are
inflated in local space and *then* transformed, because `AABB(M·box) ≠ M·AABB(box)`.

### The geometry layer is fenced off from the DOM

`src/geometry/` and `src/document/` may not touch `document`, `window`, `DOMMatrix`,
`getBBox`, or `getScreenCTM` — enforced by ESLint, not convention.

This is not stylistic. jsdom has no `DOMMatrix` and no `getBBox` at all, and happy-dom
implements `getBBox()` as `return new DOMRect()` — always `0,0,0,0` — and `getCTM()` as a
fresh identity matrix. Geometry built on those would be "verified" against fabricated
values. Solving path bounds analytically instead is both more accurate than the browser's
own answer and actually testable.

### Imported SVG that cannot be modelled is preserved, not discarded

`<use>`, `<symbol>`, `<pattern>`, `<mask>`, `<filter>` and `<marker>` have no first-class
editor UI. Rather than dropping them or flattening them to a bitmap, their sanitized markup
is kept verbatim in an `svg` node along with the `<defs>` it needs. It still renders, still
scales and rotates as vector, and still exports as vector — fidelity is preserved even
where editability cannot be.

### SVG sanitization: two stages, and three corrected defaults

Imported SVG is untrusted input. DOMPurify does the XSS work — a hand-rolled allowlist would
not reproduce a decade of mXSS and namespace-confusion hardening — and then the importer
walks the sanitized DOM with a **fail-closed** mapper, because DOMPurify is not a semantic
validator: it happily keeps `url(#missing)` and nonsense attribute values.

Three of its defaults are wrong for a vector editor, and each would fail silently:

1. **`<use>` is stripped by default.** It is on DOMPurify's `svgDisallowed` list, so every
   `<symbol>`-based file would arrive gutted. Added back explicitly. `<foreignObject>`
   stays stripped on purpose — it is the top SVG→PNG rasterization failure mode.

2. **`ALLOWED_URI_REGEXP` must not be tightened.** DOMPurify uses it as a general
   attribute-value gate, not just for `href`/`src`; its default pattern ends in a catch-all
   branch that lets ordinary values through. Replacing it with a strict URL pattern strips
   `d`, `width`, `height`, `viewBox` and `fill` from *every element* — destroying the
   artwork while appearing to work. The offline-only policy is enforced in a hook instead,
   which also closes a real hole: `url(http://…)` matches DOMPurify's own URI check via its
   bare-word branch, so `fill`/`filter`/`mask` can otherwise smuggle a remote reference
   straight past it.

3. **IDs are namespaced *before* sanitizing.** `SANITIZE_DOM` deletes any `id` whose value
   is also a property on `document` — `title`, `body`, `location` — orphaning every
   `url(#…)` gradient, clip and mask that referenced it. Renaming first sidesteps the whole
   class of problem, and stops two imported files colliding.

Because remote references are structurally impossible to import, canvas tainting on raster
export is impossible rather than merely unlikely.

### Fonts are bundled, and export says what will happen

Google's open-source fonts ship with the app (self-hosted via `@fontsource`, latin subset,
~20 KB per face). Nothing is fetched from a font CDN, ever. The `@font-face` rules are
declarations only, so a face is downloaded when something actually uses it; the service
worker precaches them so every family stays available offline.

An SVG loaded through `<img>` for rasterization runs in **secure static mode**: it cannot
fetch anything, and it does not inherit the page's `document.fonts`. So a PNG export of
styled text would silently render in a substitute face.

A base64 `data:` URL is not a fetch, though — so an `@font-face` embedded directly in the
exported SVG *does* resolve inside that sandbox. This was verified empirically in real
Chromium before committing to it: the same string rendered through `<img>` produces
markedly more glyph coverage with the embedded face than with the fallback.

So export **embeds the font** by default, and raster export always does. Text stays real
`<text>` — selectable, searchable, still editable — and renders identically anywhere. The
dialog also offers **reference by name** for the smallest possible file.

This replaced an earlier plan to convert text to outlines with `opentype.js` + `wawoff2`.
Embedding turned out to be strictly better, and `wawoff2` cannot run in a browser at all —
it is CommonJS and throws `exports is not defined` the moment it is imported. Dropping both
libraries removed ~1.4 MB from the build.

System fonts can be used, but their bytes are not readable by the page, so they can only be
referenced by name. The dialog says so when a system font is in the export.

### The line tool carried its direction in a signed box

A line is the one shape that is not symmetric: its bounding box says how big the drag was,
but only its endpoints say which way round it runs. `previewBounds()` used to encode that
by returning a min corner with a *signed* width and height, and every consumer read it as
an ordinary AABB. One inconsistency, four bugs: the preview drew a full drag-delta away
from the pointer in three of the four quadrants (which is what "the line moves far away
from the cursor" was), an up-left drag satisfied `width < 0.5 && height < 0.5` and was
silently discarded, snapping saw its right and bottom edges on the wrong side, and the
commit read a different box from the preview so Shift-45° and Alt-from-centre never
reached the document.

The box is now unsigned for every kind, and direction lives in the segment — which is also
what the preview draws and what the commit rebases into local space, so the three cannot
disagree.

### One polygon, and it fills its frame

Triangle, polygon and star were three node types with three tools, three sets of
parameters (`sides`, `points`, `innerRatio`) and seven near-identical geometry switches
between them. They are now one `polygon` node with `sides` and `starRatio`, which is both
what XD ships and what the shapes actually are.

**Star Ratio is a fraction of the apothem, not of the circumradius.** That single choice is
what makes "100% is a plain polygon" true rather than a special case: at ratio 1 every
inner vertex lands exactly on the midpoint of the edge below it, so the outline is
identical to the polygon's and the now-collinear inner vertices are simply dropped. Under
the circumradius definition any ratio above `cos(π/n)` — 0.809 for a pentagon — pushes the
inner vertices outside the outer hull, and the bounding box would jump mid-drag. Documents
saved before this land are converted on load by `innerRatio / cos(π/n)`, so an existing
star keeps its shape.

**The vertices are normalised to span the box.** A regular n-gon inscribed in a circle only
touches that circle at its vertices, so generating straight into the local box left dead
margin between the shape and its own frame for every side count not divisible by four — a
hexagon reached 86.6% of the width, a pentagon 90.5% of the height. Since
`localGeometryBounds` reports the full box for these types, the selection frame,
align/distribute, the W/H readout and the export crop all claimed area the shape did not
occupy. The generator now measures the raw outer ring and maps its bounds onto
`0..w × 0..h`. Two properties fall out: three corners reproduce the old hand-authored
isosceles triangle *exactly*, and because only the outer ring is measured, the frame cannot
move while the Star Ratio handle is dragged.

### The pointer delta is in screen space, because the Hand moves its own frame of reference

The pointer event carried `deltaDoc`, a movement in document units. Exactly one tool ever read
it — the Hand — and it is the one tool that cannot use it, because panning moves the very
viewport a document delta is measured against.

Follow one drag. The press samples the pointer at screen `s0` and stores `d0 = (s0 - v0)/z`.
The next move samples `s1` against the same viewport, so the delta is the true `(s1 - s0)/z`
and the pan lands the viewport at `v1 = v0 + (s1 - s0)`. But the move after that converts `s2`
with `v1` while the stored `d1` was converted with `v0`, and the difference comes out as

    d2 - d1 = (s2 - 2·s1 + s0) / z

which is a *second* difference — the pointer's acceleration, not its movement. Drag at a
constant speed and it is zero; wobble a pixel and the whole canvas jitters around you. That is
the shake.

`deltaScreen` cannot have the bug, because screen coordinates do not depend on the viewport at
all: the difference of two of them is the movement, whatever the pan does in between. The field
was renamed rather than added, so no tool can pick up the broken one by accident.

### Point editing had no live feedback, for a subtle reason

Dragging a path point mutated the point model and then called `refreshOverlay()`. That bumps
`overlayTick` — and the only subscriber to `overlayTick` is `ToolOverlay`, which draws the pen
rubber band and drag previews but *not* path points. The component that draws them subscribes
to the LiveTransform tick instead. So neither the shape nor the anchor dots moved until the
mouse came up, and the commit only ran on pointerup.

The fix is the channel the rest of the app already uses for exactly this: `liveTransform.begin()`
on grab, `set(geomKey(id), { attrs: { d } })` per move, `end()` on release. No coordinate
conversion is needed, because the point model and the element's `d` are both in the node's local
space. The dots come along free — the flush emits, which is what the overlay listens to.

Two ordering traps came with it, and both are commented at the call sites. The commit has to run
*before* `dragging` is cleared, because any store write notifies the sync subscriber, which
reloads the point model from the document unless a drag is in progress — clearing first threw the
edit away and wrote back the pre-drag geometry. And the selection has to be set *before*
`nodeEditingId`, for the mirror-image reason.

### Any shape is point-editable, and converts only when you edit it

`beginPathEditing` used to accept `path` nodes only, so a double-clicked line fell through to
group stepping and the pen, finding no path, started a second object on top of it.

It now loads from an explicit allow-list — rect, ellipse, polygon, line, path — via `nodePathData`.
The allow-list matters: `nodePathData` falls back to a *box* for text, artboards and imported SVG,
so a bare call would have let a double-click turn a text node into a rectangle-shaped path and
throw the text away. Images are excluded for the same reason: converting one would drop its asset.

Nothing is written when the points appear. The conversion happens inside `commitPath`, on the first
real edit, and it mutates the node **in place** so the id survives. That is the whole point:
`createPath` mints a fresh id, which would orphan the selection, the point model, the Layers panel's
state and any boolean-op back-reference. Deleting the type-specific fields on an immer draft emits
`remove` patches, so undo puts the rectangle back exactly as it was — corner radius and all.

Clicking an open end with the pen goes further and *resumes* the path into the pen's own model, so
every further click appends and Enter finishes it. Extending once and then starting an unrelated
object beside it is not what "continue this line" means.

### The colour picker keeps one canonical state

HSV is held locally and everything else is a projection of it, because HSV is not recoverable from
RGB at the extremes — pure black has no hue, so a round trip through RGB would reset the hue slider
to red the moment value hits zero. HSL is derived from that same HSV through exact `hsvToHsl` /
`hslToHsv` rather than through RGB, which would quantise every value through 8 bits and collapse the
hue while you drag lightness to zero.

The panel is ordered by what each control edits: the wheel, sliders and value
fields change ONE stop, so they sit together at the top; below a rule, **Color stops** edits the
ramp as a whole and **Position** edits where the gradient sits. The two labels are what stop those
last two rows reading as more colour controls. The saturation field is square, and kept square by an
aspect ratio rather than a fixed height, so the panel's width is the only number that decides its
size. The sliders share its corner radius and its cursor — the same hollow ring, so the hue or
opacity being pointed at shows through instead of hiding under a filled dot. Hex fits beside the
model dropdown; RGB, HSL and HSV are three fields and drop to a row of their own rather than being
squeezed too narrow to show "255".

The palette is document data, alongside `guides` — it travels with the artwork rather than living in
one browser's storage, and adding a swatch is an ordinary undoable edit. The file-format field is
purely additive, so `FORMAT_VERSION` stays at 2: an older build ignores the key, and a file without
it loads with an empty palette, which is the right answer rather than a migration.

The eyedropper renders rather than inspects. The artwork is SVG, so there are no pixels to read
until we make some: arming it serialises the visible document through the same exporter the PNG
pipeline uses — bitmaps embedded, gradients intact — and rasterises it once, after which every
sample is an array lookup. It disarms on any pan or zoom, because the raster is a snapshot and would
otherwise quietly lie about what is under the pointer. The native `EyeDropper` API is deliberately
unused: it is Chromium-only, it takes the screen over with an OS magnifier no test can drive, and it
cannot keep the picker's own fields updating as the pointer moves.

### Gradient handles live in unit space, and the difference shows

Gradient coordinates are objectBoundingBox units, which means the unit square is scaled by the
node's box before anything is painted. Two consequences drive the whole widget:

- a linear endpoint at unit `(1,1)` sits at local `(width, height)`, so the segment's **on-screen
  angle is not** `atan2(y2−y1, x2−x1)` — on a 200×100 node a "45°" gradient draws at 26.6°;
- a radial `r` paints an **ellipse** with semi-axes `r·width` and `r·height`, so a circular radius
  ring would miss the paint on any node that is not square.

The widget is drawn in white with a drop shadow rather than in the accent colour, because it sits on
top of the gradient it is editing — an accent-blue line vanishes the moment the ramp passes through
blue. The default linear segment runs across the middle of the shape rather than along its top edge,
where its endpoints landed underneath the nw and ne resize handles.

So every handle is placed `unit → ×(w,h) → local → world → screen` and every drag runs the inverse,
and the radial ring is drawn as the ellipse that is actually painted rather than as a circle that
would be a lie. Endpoints are free to leave the shape, which is both what Adobe specifies and what
objectBoundingBox units already allow — they are not clamped to 0..1.

**The gradient drag writes to the store, unlike every other canvas gesture.** That is a deliberate
exception with a hard reason: an angular gradient's live geometry is a whole `<pattern>` subtree, and
a LiveTransform override is `Record<string, string>` applied with `setAttribute` — it cannot express
that at all, and one mechanism has to serve all three types. It also matches how every other paint
edit already behaves, and keeps the picker's fields, the ramp preview and the canvas in step. The
writes are throttled to one per animation frame and the run is closed with `breakHistoryCoalescing()`
rather than a final keyless write, so a drag costs exactly one undo entry — re-writing the identical
paint on release would have emitted a second `replace` patch and cost the user two.

### Angular gradients are approximated, and that is the honest word

SVG has no conic paint server. But `<pattern>` *is* a paint server, so an angular gradient renders
as a pattern of flat-coloured wedges and everything downstream — `paintToAttrs`, hit testing, PNG
export — carries on unchanged.

Flat wedges, not gradient-filled ones: a linear gradient's iso-lines are parallel and a conic's are
rays, so no linear fill can agree with its neighbour all the way down a shared edge — chord-filled
wedges leave visible spokes. Enough thin flat wedges have no seams at all, only banding, and at two
degrees apiece the step between neighbours is under one 8-bit level across a full-range ramp. Each
wedge overlaps the next so the later one paints over its antialiased edge; butt-jointed wedges leave
a lattice of half-covered pixels that reads as moiré. Every stop offset is added to the boundary
list, so a deliberate hard edge lands on a wedge edge instead of being smeared across the slice it
happens to fall in. The tile is twice the bounding box, because an angular *stroke* paints outside
the fill's box and would otherwise show the fan tiled.

The document keeps the gradient fully parametric — `cx`, `cy`, `rotation` and stops, in the same
unit space as the other two — so only the rendering is generated, and the generator is shared
between the live renderer and the exporter exactly as the other gradients' is. The cost is real and
one-way: an exported angular gradient is a pattern of paths, so re-importing that SVG gives back a
pattern, not an angular gradient. `.xdesign` round-trips it exactly.

### Corner rounding is geometry, not a filter

`roundedPolygonPath` walks each vertex back along both its edges by
`radius / tan(theta/2)` and joins the two points with an arc. Two details make it hold up:
the tangent length is clamped to half the shorter adjacent edge and the radius is then
*recomputed* from the clamped tangent, so an over-large radius shrinks instead of producing
overlapping arcs; and the sweep flag follows the sign of the cross product, which makes a
star's reflex inner vertices round inward with no special case.

Rounding a sharp apex necessarily pulls the outline in — a triangle rounded at 8px no
longer touches the top of its box, though a square still does, because its flat edges do.
The node's own width and height never change; only the drawn path insets.

The handles sit a constant gap INSIDE the corner they round: `radius * (1/sin(theta/2) - 1)` along
the inward bisector — the nearest point of the curve to the vertex — plus a fixed stand-off. Because
the bisector runs through the arc's centre, going that extra distance along it lands exactly that far
perpendicular from the curve, so the visual gap is the same at every radius. Measuring from the arc's
*centre* instead, at `radius / sin(theta/2)`, is what the code used to do: for a square corner that is
`r * 1.414` against the curve's `r * 0.414`, so the dot sat more than three times too far toward the
middle of the shape and drifted further the more you rounded it. One helper produces both that
placement and the drag's inverse, so the two cannot come apart. Dragging projects the pointer onto
the bisector, so moving sideways along an edge does not change the radius.

Rect and image carry four addressable corners; a polygon carries a single scalar, because
its vertices are generated from its corner count and there is nothing stable to key
per-corner values to.

The two-button toggle above the fields picks between one field for all four corners and
four separate ones, and the on-canvas handle honours the same choice — dragging any dot in
uniform mode moves all four. The mode is explicit but *defaults to what the data says*: a
box whose corners already differ opens in independent mode rather than silently flattening
them on the first edit. It resets with the selection, so it never leaks from one object to
the next.

### Live readouts without breaking the no-store-writes rule

The inspector updates during a drag, which sits awkwardly with the rule that drags never
write to the store. The resolution is that it subscribes to the same LiveTransform channel
the selection overlay uses, and reads the in-flight matrices from the session modules.

That means the inspector re-renders once per animation frame while a gesture runs. This is
a deliberate, bounded exception: the inspector is a few dozen elements, whereas writing to
the store would re-run every node's selector, which is O(document). The cost does not grow
with the size of the drawing.

Three cases have to be distinguished, and the readout handles each separately: a
single-node resize writes a new intrinsic size, a multi-node resize instead scales the
matrix, and a move or rotate changes neither — so the scale has to be decomposed from the
live matrix when there is one.

Getting that split *nearly* right still shows: every defect here presented the same way, as
a value that jumped at pointerup. Three were worth naming, because each is a trap the
obvious implementation falls into. The intrinsic size a resize records is pre-scale, so it
has to be multiplied by the node's own scale before it can be shown. The live matrices the
drag session publishes are in WORLD space while every field edits LOCAL values, so the
ancestor chain has to be divided out first. And a group's bounds are its children's, not
its own nominal box — that box is written once when the group is formed and never refitted
— so the live path mirrors `geometryBounds`' recursion with the in-flight matrix injected,
rather than reading the box. The end-to-end tests assert the invariant directly: what the
field shows mid-gesture must equal what it shows after release.

### The theme colours the chrome, never the artwork

A dark UI must not repaint the document. A white artboard stays white in dark mode,
because its background is a `Paint` in the scene graph rather than a CSS token — the
artwork is not part of the UI. That also constrains the canvas chrome: selection handles
and the grid sit on top of artwork, so their colours are tuned to read against a white
artboard rather than against the panels, and the grid uses a mid-grey that survives both.

The palette is measured, not eyeballed. `tests/unit/theme.test.ts` parses `tokens.css` and
asserts WCAG AA on every text/surface pair, white-on-accent for the accent fill, 3:1 for
the accent as a graphical element, and that no colour token is declared without being
used. It caught four real failures on the first pass, including a light-theme token that
had been failing at 2.81:1 since the initial release, and an accent that had been
*lightened* for dark mode — the intuitive move, but wrong, because the accent is a fill
under white text and lightening it dropped white below AA.

The preference lives in `localStorage`, not IndexedDB, specifically because
`localStorage` is synchronous: the theme must be applied before the first paint, and an
async read cannot do that. An inline script in `<head>` does it, and the `try` wraps only
the storage read so a blocked `localStorage` still falls through to `prefers-color-scheme`.

### Repeat Grid holds one source, not N copies

The grid node stores a single set of children and the renderer tiles them. That is what
makes editing propagate to every cell for free — there is only one copy of the content, so
a change to it is a change to every repeat — and it keeps a 10×10 grid the same size in the
saved file as a single cell. The trade-off is that cells cannot differ; **Expand Grid**
materialises them into independent objects when they need to.

### `.xdesign` is a zip

A ZIP holding `document.json` plus the raw bytes of every image under `assets/`. Base64
inside JSON inflates binary by 33% and then compresses badly. The reader sniffs the magic
bytes — `PK` means unzip, anything else is parsed as flat JSON — so hand-written documents
still open. Loading is defensive: a dangling parent or a broken reference is repaired rather
than failing the whole open.

### Autosave uses `pagehide`, not `beforeunload`

`beforeunload` is unreliable on mobile Safari and simply does not fire when a tab is
discarded — which is precisely the case recovery exists for. The clean-shutdown flag is set
on `pagehide` and `visibilitychange:hidden`; if it is missing at next launch, the app offers
to restore the autosaved document.

---

## Architecture

```
Document Model (pure TS, zero DOM)
      ↓
Document Store (normalized, zustand + immer patches)
      ↓ ↑
History (transactions → inverse patches)
      ↓
SVG Renderer (React, memoized per node)  ←  Interaction Engine (tools, pointer capture)
      ↓                                            ↑
   SVG DOM                                Selection · Snapping · Hit-testing
```

```
src/
  document/    typed scene graph, transforms, colour — DOM-free
  geometry/    matrices, bounds, path math, boolean ops, snapping — DOM-free
  state/       normalized stores, clipboard, React bindings
  history/     patch-based undo, commands
  canvas/      SVG renderer, overlays, viewport, live-transform fast path
  tools/       13 tools + drag session + point editing
  svg/         sanitizer, ID namespacer, importer, exporter
  text/        font registry, layout, font embedding
  images/      file import
  export/      export pipeline, rasterizer
  persistence/ .xdesign format, IndexedDB, file system, autosave
  ui/          top bar, toolbar, inspector, layers, dialogs
  shortcuts/   keyboard map
```

Selection handles live **outside** the viewport transform and outside the document group, so
they stay a constant size at any zoom and can never end up in an export.

---

## Testing

```bash
npm test           # 164 unit tests (Vitest)
npm run test:e2e   # 97 end-to-end tests (Playwright, real Chromium)
npm run lint
npm run typecheck
```

Unit tests run in **plain Node** because the geometry is DOM-free by design.

The end-to-end suite drives the real UI — toolbar clicks, canvas drags, inspector fields —
and asserts against the rendered SVG or the bytes of an actual export. There is no
test-only backdoor in the application code.

`tests/e2e/acceptance.spec.ts` covers the ten acceptance scenarios plus a run with the
network blocked, and `tests/e2e/offline.spec.ts` goes further: it installs the service
worker, cuts the network at the browser level, hard-reloads, and then draws, edits and
types in the recovered app. `tests/e2e/sanitizer.spec.ts` holds the SVG security assertions, and they
live there rather than in the unit suite for a specific reason: **DOMPurify reports
`isSupported === false` under happy-dom and returns its input unmodified**, so a "the script
was stripped" assertion would pass without any sanitization having happened. Testing a
security boundary against a fake DOM proves nothing.

---

## Browser support

Chromium, Firefox and Safari all run the editor. One difference is worth stating plainly:

**Save** uses the File System Access API where it exists (Chromium), which overwrites the
same file on disk and remembers it across sessions. Firefox and Safari have both declined
those pickers, so there Save downloads a copy and Open uses a file input. Autosave to
IndexedDB runs in parallel either way, so a document is never lost.

---

## Deploying

The build is fully static and uses relative paths, so it works from any static host,
including a GitHub Pages project subpath, with no configuration.

```bash
npm run build      # → dist/
```

`.github/workflows/deploy.yml` publishes `dist/` to GitHub Pages on push to `main`. Enable
Pages for the repository with **Source: GitHub Actions**.

Initial load is ~520 KB; paper.js is a lazy chunk fetched only when a boolean operation
actually runs. The service worker precaches the rest in the background.

Opening `dist/index.html` directly with `file://` will not work — browsers block ES modules
on that scheme. Use `npm run preview` or any static host.

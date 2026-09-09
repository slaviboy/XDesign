# XDesign

An offline-first vector design editor, in the shape of Adobe XD's Design workspace.

No account. No login. No server. No database. No telemetry. Once the app has loaded,
it needs no network connection at all, and every document lives on your own machine.

*An independent project, not affiliated with or endorsed by Adobe Inc. Apache-2.0 —
see [License](#license).*

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

**Text** — click for a box that grows with what you type, or drag one out to pour text into.
Adobe's three resize options are a segmented control in the Text section: **Auto Width** takes
both dimensions from the text and never wraps, **Auto Height** keeps the width you gave it and
grows downwards as the text wraps, and **Fixed Size** keeps both and clips what does not fit.
The mode is an invariant rather than a one-off conversion — typing, a font size, tracking, a
transformation or a width typed into the inspector all re-fit the box the way its mode says,
inside the same undo step as the edit that caused it. When Fixed Size text overflows, the
bottom resize handle turns red; double-click it and the box grows to hold everything, staying
Fixed Size. Alongside those: paragraph spacing, line height, tracking, alignment, and the four
**text transformations** (None, UPPERCASE, lowercase, Title Case). A transformation changes what
is drawn and never what is stored, so switching back to None gives you exactly what you typed,
and re-opening the editor shows the original rather than the rendering.

**Import text from a file** — File ▸ Import Text…, the button on the Text panel, or dropping a
`.txt`, `.md`, `.csv` or any other text file straight onto the canvas. With a text object
selected the file fills it; with nothing selected it becomes a new Auto Height box named after
the file, at the point you dropped it.

**Spell check** — off by default, switched on in Preferences, and it checks two languages at
once: English plus whichever language the interface is set to, which is what a designer working
in a second language actually needs. Misspelled words get a red wave under them, drawn from the
same layout the glyphs come from, so the underline sits under the word and not near it. The
dictionaries ship with the app and are read from disk; nothing is looked up online.

**Measuring distances** — with something selected, hold `⌥`/`Alt` and hover another object. The
gap between them is drawn as a dashed line per axis with the number on it, in document units.
Only an axis the two boxes are actually *separated* on gets a line: two objects that overlap
horizontally have no horizontal distance, and drawing one would be inventing a number. Where
they share no span at all the two lines run from the selection across and from the target down,
so they form an L between the pair instead of crossing at one point with the labels on top of
each other. Release `Alt` and it is gone.

**Guides** — Adobe's model, which is not Photoshop's: there are no rulers down the side of the
window. Every artboard grows a strip along its top and left border that you pull a guide out of,
and the guide belongs to that artboard. Dragging one snaps to the artboard's edges and centres,
to every object on it, and to its other guides; hold `⌘`/`Ctrl` to suspend that, `Shift` to move
in tens. While you drag, a chip at the cursor gives the guide's own coordinate — `X 138` — and a
rule along the artboard's edge gives the distance to each side of it, which is usually what you
are actually placing: a margin, or a column. Drag a guide off the artboard and it disappears
before you let go, because a guide outside the artboard it belongs to is a state the model cannot
hold. Click a guide to select it — it thickens and grows a handle at the artboard's edge, its
position appears in the panel as a scrubbable `X` or `Y`, and `Delete` removes it. Preferences
sets the guide colour and whether guides can be dragged by the line itself or only by that
handle. `⌘;` hides them, `⇧⌘;` locks them, and
right-clicking an artboard offers Copy, Paste, Remove All and Lock All Guides — pasting applies
one set of guides across as many artboards as you have selected.

**Artboard grids** — select an artboard and pick **Square** or **Layout** in its Grid section.
A square grid takes a size; a layout grid takes columns, a gutter and margins, and shows the
column width it works out from them. Both take a colour with an alpha, and **Make Default**
keeps the current grid for new artboards and new documents. This is separate from the
canvas-wide grid on the pasteboard, which keeps its own toggle and `⌘'`.

**Artboards** — double-click a name label on the canvas to rename it in place, with the whole
name selected so typing replaces it. `Enter` or clicking away commits, `Escape` abandons, and
an empty name keeps the old one rather than leaving an artboard with no name at all. Dragging
the name moves the artboard whatever tool is selected: the label is chrome rather than artwork,
so it takes the pointer itself and no tool ever sees the press. It is positioned from the live
matrix, so it travels with the artboard instead of jumping to it on release.

**Marquee selection, two ways** — Preferences > Selection chooses what a drag-selection has to
cover: *Anything it touches* (the default), where one stroke through a row picks up the whole
row, or *Objects fully inside*, which takes only what the rectangle completely surrounds. `⌥`
uses the other mode for a single selection, whichever is set, and the choice is remembered
between sessions. Every preference carries an **(i)** that opens a sentence or two on what it
actually does — behind a press rather than a hover, because six notes stacked permanently would
bury the settings they describe, and a hover tooltip is unreadable at that length.

**Dropping a file** — dragging an image over the canvas outlines the artboard it will land in with
a dashed accent border and fills it with a message: *Import*, and underneath, *Release to add it to
Artboard 2*. The highlight reads the same `artboardAtPoint` the drop itself parents by, so it
cannot promise one thing and do another. Over bare pasteboard, where there is no region to fill,
it shrinks to a chip at the cursor.

**Eight languages** — English, Български, Deutsch, Español, Français, Português, 中文 and 日本語,
chosen in Preferences and remembered on the machine. One JSON catalogue per locale keyed by
resource id, with English as the source of truth and the fallback.

**Getting back to a locked or hidden object** — locking or hiding the selection lets go of it,
and right-clicking where one sits offers to unlock or show it by name. A locked object takes no pointer events and a hidden one is not drawn, so
either way the click finds bare canvas and the Layers panel used to be the only route back.

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

**Masking** — select the objects and the shape on top of them, then **Mask With Shape**
(`⇧⌘M`, or the context menu). The topmost object becomes the mask, as Adobe specifies: what it
covers shows, the rest is hidden rather than deleted. Double-click to step inside and readjust
either the mask or what it holds; **Ungroup Mask** hands both back untouched.

**Effects** — a **Drop Shadow** or **Inner Shadow** with X, Y, blur and colour, and a
**Background Blur** or **Object Blur**. The controls and their ranges are Adobe's: Amount 0–50,
Brightness −50–+50, Opacity 0–100%, with brightness and opacity belonging to the background blur
alone. The checkbox on each turns the effect off without discarding its settings.

**Outline Stroke** (`⇧⌘O`, or Object > Path) — turns a border into a filled shape, so an icon
drawn with strokes becomes solid vector that scales, takes a gradient and joins a boolean. A
shape with both a fill and a border is separated into two objects, as Adobe describes.

**Stroke cap, join and alignment** — three dropdowns whose every option carries an icon that
*is* the setting: the cap and join glyphs are real strokes carrying the real `stroke-linecap`
and `stroke-linejoin`, so the picture and the behaviour cannot drift apart. The alignment three
show the stroke band inside, outside or straddling a filled square, because a band needs
something to be measured against.

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

**Import** — SVG, raster images (PNG, JPEG, GIF, WebP, BMP, AVIF) and plain text files by
drag-and-drop, paste, or File ▸ Import. Imported SVG becomes real editable nodes: shapes stay
shapes, gradients stay gradients, groups stay groups. Nothing is ever rasterized on import.

**SVG fidelity** — an Adobe XD or Illustrator export arrives as a scene graph, not a picture
of one. Groups stay nested and in order, and layer names come from `data-name`, so the Layers
panel reads the way it did in the tool the file came from. `clip-path` and `<mask>` become
real clips you can release, rather than a reason to give up and keep the subtree as markup.
`<style>` blocks and `class` selectors are resolved through the actual CSS cascade —
presentation attributes at the bottom, inline style above them, `!important` above that —
which is what stops a file that styles everything by class from arriving uniformly black.
`<use>` and `<symbol>` are instantiated into editable nodes. Gradients keep the space they
were authored in, along with `gradientTransform` and `spreadMethod`, instead of being
flattened into an approximation. `<tspan>` keeps its meaning: a styling span becomes a style
run inside one text object, a positioned one becomes its own object. `preserveAspectRatio` is
honoured, so a square viewBox in a wide box letterboxes rather than stretching. Content set to
`display:none` is imported hidden rather than dropped, and anything genuinely beyond the
editing model — a filter graph, a pattern — is kept as real vector and says so. The reference
export the work was built against is checked by rasterizing it alongside the app's own export
of it and comparing pixels, because "the right nodes in the right tree" can all be true while
the artwork still looks wrong.

**Image Trace** — turn a photograph, a scan or a flat logo into editable paths, with
Illustrator's panel and Illustrator's controls: eleven presets, five preview modes, colour,
greyscale or black-and-white, a palette size or a threshold, and an Advanced section holding
Paths, Corners, Noise, abutting versus overlapping regions, fills, centreline strokes,
snapping curves to lines and ignoring white. Paths, anchors and colours are counted before
you commit, because a trace with twelve thousand anchors is not a trace anyone can edit. The
preview is live: move a slider and the artwork on the canvas re-traces under it, and the View
control puts the result, its outlines, or the original picture on screen so you can see what
the settings actually did. Pressing Trace replaces the image with a group of ordinary paths —
same place, same size, same position in the stack — in one undo step.

**Clipboard** — copy an image or some text anywhere on the machine and paste it straight in,
by `⌘V`, right-click ▸ Paste, or the app menu. It lands in the artboard you are working in:
the one selected, or the one holding the selection. Text becomes a text object sized to the
artboard, an image becomes an image, and SVG markup becomes editable nodes rather than a
picture of them. Going the other way, `⌘C` puts three things on the clipboard at once — a PNG
for the applications that want a picture, the SVG for the ones that want vectors, and, when
what you copied was text, the characters themselves. Copying inside the app still keeps every
gradient, group and pixel: the copy carries its own identity, so pasting it back is recognised
as the original rather than re-imported as flattened markup.

**Export** — SVG, PNG and JPEG, of a selection, an artboard, the whole document, or every
layer marked for export, at 0.1×–10× scale.

**Two pointers that hand the object back and forth** — Direct Selection reaches inside a
group to the leaf and shows its points; clicking an edge selects that SEGMENT so it can be
dragged, and never adds a point to it. Adding points is the Pen's job. Shift-click collects
points, segments or whole objects one at a time and takes them back out again, and dragging
any member moves the whole collection, updating the shape as it goes rather than on release.
Double-clicking a corner rounds it; clicking a rounded point straightens it again. Switching
between the two pointers takes effect at once — the box for the one that moves objects, the
points for the one that moves points — with no second click to wake the tool up.

**Format text, or part of it** — click into a text object, select a word or a few
characters, and the Text panel describes those characters instead of the whole object: font,
size, weight, italic, tracking, case, and colour. Everything else stays where it belongs —
alignment, line height and paragraph spacing are properties of a block, so they keep applying
to the whole object even while a range is selected, because "these three words are centred"
is not something text can be. Where the selection disagrees, the panel says Mixed rather than
showing you the first option as though it were the answer. Formatted text stays formatted
while you edit it, caret and all.

**Keyboard shortcuts you can change** — every command in the Shortcuts dialog is
rebindable. Double-click one, and the field starts listening: it shows the modifiers as you
hold them, the whole chord once a key joins them, and commits when you let go. A changed
shortcut grows a reset control that puts back exactly what it shipped with, and Reset All
puts back everything. Binding a chord that is already taken moves it, says which command
lost it, and leaves that one visibly unbound rather than firing two things off one key.
Menus and tooltips print whatever a command is currently bound to, so a rebinding is
visible everywhere the app mentions it.

**Take your settings with you** — Export Preferences writes a small, readable `.xprefs`
file holding the interface language, the theme, spell check, marquee mode, how the toolbar
marks the active tool, the default artboard grid, the canvas settings, and the whole keymap. Both directions open a dialog with
a checkbox per section, each saying what it actually holds — "Deutsch", "3 of 55 changed", "7
settings" — so you can take the keymap without the theme, or send someone your shortcuts and
nothing else. Import offers only the sections its file contains, because a checkbox for
something that is not in the file is a promise nothing can keep. Chords are stored by meaning
rather than by symbol — `Mod+S`, never `⌘S` — so a Mac's shortcuts arrive intact on Windows
and read as Ctrl+S there.

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

### Background blur has no SVG filter, so the backdrop is drawn twice

There is no way to ask an SVG filter what is behind an element. `BackgroundImage`, the filter
input that would have done it, was dropped from the spec and shipped in no browser. CSS
`backdrop-filter` is not a way out either, and fails in the most annoying way possible: it is
*accepted* on an SVG element, reads back from `getComputedStyle` exactly as set, and then does
nothing. That was verified directly here before it was abandoned — a panel over three coloured
stripes lightened correctly and did not blur at all.

So the backdrop is re-drawn. Whatever is already painted in the container is drawn a second
time, blurred, and clipped to the shape's own outline. The canvas mounts those copies with the
same `repeat` flag repeat grids use, so a duplicate never registers itself with LiveTransform
and steals a node's live element. The exporter builds the identical construction out of a
`<use>` pointing at a `<defs>` copy of the same markup — which means an exported SVG carries a
real background blur, and PNG and JPEG do too, since both rasterise the exported SVG.

The cost is honest and bounded: the backdrop is rendered twice per blurred shape. Object blur
has none of this, being a plain `feGaussianBlur` on the shape itself.

The copies are **mirrors, not repeats**, and the distinction is the whole reason `NodeRenderer`
has a three-valued `CopyMode` rather than a `repeat` boolean. A repeat-grid cell must not
register with LiveTransform — it is the same node drawn at a different offset, and only one copy
may own the live element. A backdrop copy sits exactly where the original does, so it must
register: LiveTransform writes to every element under a key, and a copy that does not follow the
gesture leaves a blurred ghost of the artwork at the position it started from. Neither kind
carries `data-node-id`, so no duplicate is hit-testable or countable, and the mode propagates
down a subtree because a copy of a group is a copy of everything in it.

### A background blur's clip is drawn in the parent's space, and has to be moved itself

The blurred copy of the backdrop is clipped to the shape's outline, and that clip cannot live
inside the shape's own group — it has to be a sibling, because the thing it clips is the
artwork *behind* the shape. So it does not ride along when the shape's group is transformed,
and moving the panel left its blur region behind: the canvas the panel had left stayed blurred,
and the canvas it had arrived at did not. The clip therefore registers under two LiveTransform
keys — the node's own, which carries the matrix, and its geometry key, which carries `d` — so a
move and a resize both reach it in the frame they happen.

### "Does the marquee touch this?" is three questions, not one

Crossing selection existed behind `⌥` before it had a setting, and it did not work for the case
people actually reach for: sweeping a thin band through a row of objects selected none of them.
The test underneath asked only whether any *vertex of the path* fell inside the rectangle, and
sweeping across the middle of a rectangle catches none of its corners.

Overlap needs all three of:

1. a vertex inside the box — a corner of the shape caught by the marquee;
2. an **edge crossing** the box, with no vertex in it — the band across the middle touches two
   sides and no corners;
3. the box entirely **inside** the shape — the same band, once short enough to fit within the
   rectangle, meets no edge at all.

`pathOverlapsBounds` answers 1 and 2 with a Liang-Barsky segment clip against the box, which is
exact and needs no intersection points, and 3 with a point-in-path test of the box's centre under
the shape's own fill rule — so the hole in a donut is correctly not part of it. The old function
is gone rather than kept beside the new one: there was never a case that wanted the weaker answer.

### Guides belong to an artboard, and that is what makes copy and paste mean anything

Guides used to be a document-level list: one set of world-space lines across the whole canvas.
Everything about them worked — they drew, dragged, snapped and saved — except that **nothing
could create one**. `addGuide` had no callers, `createGuideId` had no callers, and the
`rulersVisible` setting that implied a way in was written by nothing and read by nothing.

Moving them onto the artboard is what Adobe's own feature set requires. "Copy and paste guides
across artboards" has nothing to copy between when there is one global set; a guide dragged out
of an artboard's border is a statement about that artboard; and positions stored in the
artboard's local space are what let one set of guides land the same way on a run of screens.

The cost is a real file-format change rather than the additive kind this codebase usually gets
away with, so `FORMAT_VERSION` went to 3 and a version-2 file's guides are distributed on load
onto the artboard each one crossed, converted to local coordinates. A guide crossing no artboard
is dropped: keeping it would mean keeping the document-level list alive for the one case it no
longer serves. Where two artboards overlap the **topmost** claims it, which is the same artboard
a click would have resolved to.

### One answer to "which artboard is here"

Three separate things need it — where a drawn or dropped object is parented, which artboard a
right-click acts on, and which one a file drag highlights — and they were drifting apart:
`containerAtPoint` walked the artboards backwards for the topmost, while the guide migration
walked them forwards and got the bottom one.

`artboardAtPoint` is now the single definition, and `containerAtPoint` is a two-line wrapper
around it that adds the entered-group case. That matters most for the drop highlight: it promises
where the file will go, and the only way that promise cannot go stale is for it to be answered by
the same function that keeps it.

### The language catalogues are checked against each other, not just parsed

A translation drifts silently: a key goes missing, one is added that English does not have, a
`{name}` placeholder gets renamed while being translated. None of that is visible until someone
switches language and finds a raw resource id, or a sentence with a hole in it where the artboard
name should be.

So three tests compare the seven translations against English rather than merely loading them —
identical key sets, identical sets of named placeholders per key, and fewer than a dozen strings
per language that are byte-identical to English, which is what catches a file that was copied and
never actually translated. Placeholders are named rather than positional precisely because word
order is what changes between languages: German does not put the artboard where English does.

English is also the runtime fallback, so a key a translation has not reached yet shows the English
words rather than `menu.file.new` — a half-finished locale degrades to a readable mixture instead
of to gibberish.

### A text box's resize option is an invariant, not a one-off conversion

Adobe's three options are usually described as things you pick, but they are really three
different answers to *who owns the box's size*. Auto Width: the text does, both dimensions.
Auto Height: you own the width, the text owns the height. Fixed Size: you own both, and text
that does not fit is clipped.

Written that way it is obvious that the rule has to hold after **every** edit, not just at the
moment you pick it — typing, a font size, tracking, a family, a transformation, a width typed
into the inspector, a resize handle. It did not, and the failure was visible: the inline editor
re-fitted the box from the *unwrapped* text on every keystroke, so typing into an Auto Height
box blew its width out until everything sat on one line. The box the user had just dragged out
was destroyed by the first character they typed into it.

So there is now one `refitTextNode`, applied inside the transaction that made the change. Two
consequences fall out of putting it there rather than at the call sites. An edit and the resize
it forces are a **single undo entry** — before, `setText` and the resize were separate
transactions under different coalesce keys, so a typing burst recorded two entries per
character. And `TextEditor` no longer has an opinion about geometry: it calls `setText` and
stops, which is what a text editor should do.

**A resize handle is the interesting case**, because it is the one edit that argues with the
mode. `commitDrag` wrote width and height and told the text nothing, so dragging a corner left
an Auto Height box 279 units tall around 398 units of text — the last lines simply hung out of
the bottom — and left an Auto Width box 146 wide around 253 of text, spilling out of the right.

Enforcing the mode instead is not the answer: the box would spring back to the width of its own
text and the handle would look broken. So the drag is read as a statement of intent, which is
also how Adobe reads it — give a width to Auto Width text and it becomes **Auto Height**,
wrapping inside what you gave it; give a height to anything and it becomes **Fixed Size**, which
is the name for owning both dimensions. The segmented control follows, so it is visible rather
than silent, and because the mode change happens inside the drag's own transaction, one `⌘Z`
puts back the size and the mode together.

And it all happens **under the pointer**, not on release. A derived height computed only at
commit means the frame sits at the height you dragged while the text quietly needs another
paragraph, and then jumps when you let go. So the in-flight size carries the wrapped height, the
renderer reads the in-flight *mode* as well as the in-flight size — a box becoming Auto Height
has to start wrapping now, and it cannot learn that from the document, which a drag never writes
to — and a Fixed Size box's clip tracks the drag instead of revealing the rest of the text all at
once at the end.

`sizingAfterResize` is where that decision lives, and it is taken **once**, while the gesture is
live, then carried to commit in the session. Recomputing it at commit looked equivalent and is
not: by then the size being compared already carries the height this code derived, so every
side-handle drag would read as a height change and end in Fixed Size. Deciding once is also what
makes the preview and the result the same answer rather than two that are expected to agree.

### Every icon was two pixels right of centre

`.icon-button` is `display: grid; place-items: center` with a fixed `width: 26px`, which looks
like it centres its glyph and does not. A `<button>` carries the browser's own `padding: 1px 6px`
unless something resets it, the reset here only covered fonts, and with the global
`box-sizing: border-box` those twelve horizontal pixels come out of the *inside*: a 26px button
minus 2px of border minus 12px of padding leaves a **12px content box** for a **16px** icon.

`place-items: center` then does nothing, because it centres the item within its grid track and
the track is exactly the item's size. What overflows is the track, and a track that overflows its
container overflows to one side — so every icon in the application sat exactly 2px right of where
it belonged. Not enough to look broken; enough to look wrong.

The fix is `padding: 0`. The test is worth more than the fix: it walks every small icon on screen
and compares its centre to its host's, failing with a list of the offenders and their offsets. It
covers 53 icons today and will catch the next control that forgets, which is the actual risk —
this was never a bug anybody would have found by reading the CSS.

One vertical case turned up with it: `.field-label` is text in most fields and an icon in a few,
and text sits on a baseline where an icon is a block, so the icon labels rode a pixel high against
the text ones beside them.

### The rotation cursor is built, not traced

CSS has no rotation cursor and cannot transform the one you supply, so a cursor that points at
its own corner means **one pre-rendered image per angle** — sixteen of them, 22.5 degrees apart,
built at module load as `data:` URLs so they need no network and cannot 404 offline.

The glyph is a double-headed curved arrow, and it is generated from a handful of measurements —
arc radius, sweep, band thickness, head length and width — rather than written out as a `d`
string someone traced. Two things fall out of that. The ends cannot drift apart, because both
heads come from the same construction reflected. And the whole shape is fitted to a **circle**
around the cursor's centre rather than to its 24x24 box: a box fit looks correct until the
diagonal orientations clip, and the diagonals are the four corners this cursor exists for.

It is turned by the outward direction from the selection's centre to the corner under the
pointer, plus a quarter turn — the arrow is built bulging upward, and up is -90 degrees on
screen. Because that direction comes from the on-screen frame, it already accounts for the
object's own rotation and the viewport: turn a rectangle 30 degrees and every corner's cursor
turns with it. Its test measures each corner's direction from the frame and checks the cursor
matches, on a rectangle that is deliberately **not square** — one aimed at a fixed 45 degrees
would pass on a square and fail here.

### The font arrives after the layout that measured it

A font face is fetched the first time something asks to draw it — which is *after* the layout
that asked for it has already been measured. Until it lands, `measureText` answers with the
fallback, usually a narrower one, so the lines come out packed too full. Then the real glyphs
arrive, wider, in a box that was fitted to the fallback. Switching a text object to Thin put
**408 units of text inside a 400-unit box**; Italic put 428 in 400. Nothing re-rendered to fix
it, because no prop had changed — which is why resizing the box by hand appeared to be the cure.

`ensureFontLoaded` was already in the codebase for exactly this, with `TextLayout`'s own header
saying *"Callers must await ensureFontLoaded() first"*. It had **no caller**. So did
`preloadFontsFor`, whose comment reads *"Called after open/import"*.

Three things now close it:

- **A font-load signal.** `subscribeFonts` fires on `document.fonts`' `loadingdone` — the only
  event that covers faces the browser fetched on its own, which is nearly all of them. Anything
  that measures text subscribes and measures again.
- **A re-fit when the face is real.** A style change that touches family, weight or slant asks
  for the face and re-fits the box when it arrives, so the stored height follows the glyphs.
- **Preloading what the panel offers.** Selecting a text object loads every weight and italic of
  its family — about **6ms for a whole family** from local files. That is what makes Bold take
  effect on the click rather than a beat after it, which was the other half of the complaint.
  Opening a document preloads the faces its text uses *before* the document is installed, so the
  first layout is measured against the real thing.

Its test asserts with **no settling time at all**: change the style, read the box. "It fixes
itself a moment later" was the bug, so a test that waits would not see it.

### A spell mark belongs to a word, so it is cropped with the word

Fixed Size text crops what does not fit. The clip was on the `<text>` element alone, and the
red waves are a sibling of it — so a cropped box left a row of squiggles floating on blank
canvas, reporting mistakes in text the user could not see, let alone correct. Both now sit
inside one clipped group; a mark cannot outlive the word it marks.

Its test asserts on **pixels**, not on the DOM, because neither of the usual handles can see a
clip: a clipped SVG element still reports its full geometry to `getBoundingClientRect` and still
answers `isVisible()`. `countRedPixels` in the e2e helpers decodes the screenshot and counts —
17 red pixels below the box before the fix, none after.

The same mistake had been made twice more. The exporter wrapped only Fixed Size text, so an Auto
Height paragraph exported as one very long line, and it emitted no clip at all, so a Fixed Size
box exported the text the canvas had cropped. Both are fixed and both are covered: the export
now has to produce the same number of `<tspan>`s the canvas laid out, and a `clip-path` when the
canvas has one.

### While you edit, the textarea is the only rendering

Inline editing overlays a real `<textarea>` on the node so the caret, selection and wrapping are
the browser's rather than reimplemented. The document kept drawing the node underneath it, which
is fine only while the two agree — and they cannot fully agree, because a textarea centres its
text in a CSS line box and SVG sits it on a baseline. Every place they disagreed showed up as
doubled letters: the editor wrapped with `white-space: pre` for anything but Fixed Size, so an
Auto Height box scrolled sideways instead of wrapping and the same sentence appeared twice at
two different offsets; a transformation was drawn upper-case behind a textarea showing what you
typed.

So the node's glyphs are not drawn at all while it is being edited, and the textarea is made to
match the layout engine instead: it wraps for both modes that own their width, breaks a
too-long word the way `breakLongWord` does, and carries the transformation as `text-transform`
— display only, so the value stays what was typed and switching back to None gives it back.

One thing CSS cannot express in a textarea is **paragraph spacing**, so a box with a non-zero ¶
value edits with its paragraphs closed up and opens out again on commit. Everything else — the
wrap, the font, the tracking, the alignment, the transformation, underline and strike — is the
same on both sides of `Escape`.

### Spell check ships five languages, and says so

The word lists come from `all-words-in-all-languages`, which covers far more than five. Three
were deliberately left out, and the reasons are worth recording because "add the rest later" is
the wrong conclusion:

- **Bulgarian** — the source list has **2,697 words**. A real vocabulary is hundreds of
  thousands. A checker built on it would underline most of a correctly spelled sentence, which
  is worse than no checker at all: it trains you to ignore the marks.
- **Chinese and Japanese** — no spaces between words. A word list has nothing to match against
  until the text is segmented, and segmentation is a different piece of software.

The dictionaries that did ship are gzipped and read from disk, never fetched from a service:
English 1.3 MB (465k words), French 0.8 MB (337k), Spanish 1.4 MB (637k), Portuguese 2.8 MB
(1.1M), German 4.9 MB (1.7M) — **12 MB of assets**, which is real and is the price of the
feature working offline. They are loaded only when spell check is switched on, and only the two
in use.

German is why the lookup is not a `Set`. 1.7 million strings in a JS `Set` costs well over a
hundred megabytes of heap and a long pause to build. Instead each dictionary stays **one sorted
string** plus an `Int32Array` of line offsets, and a lookup is a binary search over the offsets
— no per-word objects at all. The first attempt searched the raw string directly and widened
each probe to the nearest newline, which is where the bug was: widening could push the probe
outside the range still being searched, so the search stalled and reported real words as
misspelled. The offset array removed the class of bug rather than patching that instance.

One more thing the browser did quietly: a dev server sends `Content-Encoding: gzip` for a `.gz`
file, so by the time the bytes arrive they have already been decompressed, and
`DecompressionStream('gzip')` throws on them. The loader sniffs the two magic bytes `1f 8b` and
only decompresses when they are actually there.

The lists are checked in, and `npm run dictionaries` regenerates them from the upstream repo —
downloading, lower-casing, dropping anything that is not a word, sorting and gzipping. It is the
one script here that touches the network, and it is a build step: the app never does.

### Measuring is drawn as an L, on purpose

Two boxes that share no span on either axis have no single sensible place to put the two
measuring lines. Running both through the midpoint of the overlap does not work — there is no
overlap — and the obvious fallback, the midpoint of each box, puts both lines through the same
region and stacks the two number chips on top of each other.

So the horizontal line runs across the **selection** and the vertical line runs down the
**target**. The pair meets at a corner and traces the path the eye already takes between the two
objects, and neither label is ever underneath the other. It is two lines of code in
`measureBetween` and it is the difference between a readable measurement and an unreadable one.

An axis the boxes overlap on gets **no** line at all. The gap there is negative, and a negative
distance drawn between two objects is a picture of nothing.

### Locking or hiding lets go of what you were holding

A selection frame over an object you can no longer touch is a lie: the handles do nothing, the
inspector offers edits that will not apply, and the transform fields report a size that cannot be
changed. So locking or hiding drops the affected nodes from the selection — along with the point
editor and the entered group, which are two more ways to be holding on to something that has just
become untouchable.

Descendants go too, because locking a group locks everything inside it: a child selected within a
group you just locked is exactly as untouchable as the group. Unlocking and showing deliberately
do NOT select — you are often unblocking something to get it out of the way, not to work on it.

### A right-click has to reach what the pointer cannot

`blockedNodesAt` is the one hit test that deliberately ignores both the locked and the hidden
filter, because it exists to answer the question those filters make unanswerable. Everywhere
else, skipping them is the point.

It reports the **outermost node actually carrying the flag**, not the one under the cursor:
locking a group locks its children by inheritance, so offering to unlock a child that is not
itself locked would be an entry that does nothing. And a node already in the selection is left
out, because the menu's own Lock and Hide entries already act on it — two routes to one action
in a single menu is worse than one.

### The line and the handle answer different problems

A guide's line lies right across the artwork, which makes it easy to grab when you meant a shape
underneath it. The obvious fix — make guides harder to hit — trades one problem for another.

So there are two targets and a setting that chooses between them. The line always *selects*; what
the setting controls is whether it also *drags*. Selecting is what reveals the handle at the
artboard's edge, which always drags, so a guide is never unreachable in either mode and the
restrictive setting costs one click rather than access. The selected guide also thickens rather
than changing colour, because the colour is the user's setting now and has to stay recognisable
as theirs.

### A guide drag writes nothing until you let go

The obvious implementation calls `moveGuide` on every pointermove, and that is what this one did
first. It is the exact thing the store forbids: a write runs every subscribed component's
selector, so each frame re-rendered the whole inspector and the whole layer tree, marked the
document dirty and woke autosave — for one line moving.

The gesture now holds the position in its own session and commits once on release, with the
overlay drawing from `liveGuide()` while it runs. A guide being pulled out of the edge does not
exist in the document at all until the pointer comes up, which is also why creating one is a
single undo entry rather than an "Add guide" followed by a run of moves.

### A layout grid has no column width to store

Adobe: "layout grid parameters are calculated based on artboard width and number of columns so
that the grid is kept within the bounds of artboard." The way to make that true is not to clamp
a stored width — it is to have no stored width:

```
usable      = W - marginLeft - marginRight - (columns - 1) * gutter
columnWidth = usable / columns
```

The last column ends at `W - marginRight` identically, so the grid cannot spill however the
artboard is resized — including *while* it is being resized. The inspector still lets you type a
column width, because Adobe's does; since the artboard's width is fixed, what gives is the
gutter, and `gutterForColumnWidth` is the inverse. When the margins and gutters leave no room,
`layoutColumns` returns nothing at all and the panel says so, rather than drawing a negative
column as a mirrored rectangle.

### The grid's colour is document data; the canvas grid's is not

`tokens.css` states the rule: the theme colours the chrome, and every colour lives in that file.
An artboard's grid colour breaks it deliberately, and is the second thing to do so after
`ArtboardNode.background` and the saved swatches — Adobe lets you set it, alpha included, so it
travels with the artwork the way a fill does. The pasteboard grid keeps `var(--grid-line)` and
stays chrome, which is also what keeps the token audit in `theme.test.ts` honest.

The artboard grid draws inside the artboard's own body, between its background and its children,
because that is the only place that is over the fill and under the artwork — a grid beneath an
opaque artboard background is invisible, which is the defect the pasteboard grid still has by
design. That puts it inside `.document-layer`, so the structural "chrome cannot be exported"
guarantee no longer covers it; the exporter has its own artboard emitter that never emits it,
and a test asserts the exported SVG contains no grid markup.

### Live resize reaches three kinds of geometry, not one

A drag only moves things, so a matrix covers it. A resize changes what a node *is*, and how it
is expressed differs by type — which is why "resize does not preview" kept turning up in a new
guise rather than being one bug.

**Paths** are an attribute: the drag session rebuilds `d` and LiveTransform writes it. That was
always there.

**Images** are two elements that disagree. The picture is sized by `width`/`height` on an
`<image>`, while the rounded clip beside it is a `d` on a `<path>`. Only the clip was registered,
so the region grew live and the picture inside it did not move at all until commit. Both now
register under the same geometry key and the session writes both sets of attributes. That in turn
forced LiveTransform to snapshot originals **per element rather than per key**: two elements
under one key do not agree on which attributes they have, and a shared snapshot restored the
clip's absent `width` onto the image, so cancelling a resize left the picture with no width at
all.

**Text** is neither. Re-wrapping rebuilds the lines, and no attribute write can express that. So
the text body subscribes to the live tick and re-renders itself from the in-flight width — one
component, not the document, which keeps the rule that matters: a gesture still writes nothing
to the store.

### An effect's filter region has to keep up with a live resize

A drag never changes a node's box, so a shadow follows a move for free. A resize is different,
and it broke in a way that looked nothing like a shadow bug: **the shape itself was clipped.**

The filter region is in user space, sized from the node's box — `userSpaceOnUse` rather than
percentages of the bounding box, because a percentage region collapses to nothing on a
horizontal line, whose box has no height. But the box is read when React renders, and a resize
of a rect or an ellipse deliberately does not re-render: it writes a new `d` straight to the
DOM and leaves the matrix alone. The region therefore stayed at the pre-drag size, and
everything outside it — the shadow *and* the growing half of the shape — was clipped away until
the mouse came up.

A group resize does not have the problem, because it scales through the matrix and the region,
being in local space, scales with it. So the fix goes exactly where the mismatch is: the drag
session snapshots how far a node's effects paint outside its box (a blur radius is not
something a resize edits, so it is constant for the gesture) and rewrites the region from the
live size in the same place it rewrites `d`. The filter element registers under its own
LiveTransform key for that, the way geometry elements register under `geomKey`.

### A mask group is a group with a flag, not a node type of its own

Adobe's model is a `MaskGroup` whose topmost child is the mask. That could have been a new node
type; it is a `maskId` on `GroupNode` instead, and the difference is worth the paragraph.

Everything that already understands groups keeps working with no new branch: bounds, world
matrices, ungroup, duplicate, the layer tree, reparenting, the file format. What masking adds
is three specific overrides, each for a stated reason — the mask child is not painted (it is the
clip, not artwork), the group's bounds are the mask's rather than the union (framing the union
would draw a selection rectangle around artwork that is not on screen), and a point outside the
mask is not a hit (nothing is drawn there, so nothing should be clickable there).

The mask is drawn as a `<clipPath>` rather than a `<mask>`. A luminance mask would let the
shape's own fill and opacity leak into the result, so masking with a 50%-grey rectangle would
half-hide what it masks. XD's masks have hard edges; a clip is what hard edges are.

### Outlining a stroke means flattening first, and that is not a shortcut

`outlineStroke` walks each subpath offset by half the stroke width, inserting a join at every
vertex and a cap at every end: one ring per open subpath, and an outer plus a *reversed* inner
ring per closed one, so the nonzero rule reads the middle as a hole rather than as solid.

It flattens to polylines first, and every tool does, because the exact offset of a cubic is a
curve of higher degree that cubics cannot represent. The tolerance is PathUtils' own, so an
outlined stroke is exactly as smooth as everything else drawn here.

Two details that are easy to get wrong and are tested for it. **Which way is "outward" depends
on how the subpath is wound** — the left normal points out of a counter-clockwise ring and into
a clockwise one — so without checking the signed area, Inside and Outside swap over on half of
all shapes, decided by nothing more than how the path happened to be authored. And **a round
cap is a half turn, where "the shorter way round" does not pick a direction**: the arc has to
bulge past the end of the path, and the other choice carves the same half-disc *out* of the
stroke instead of adding it.

Self-intersections at tight corners are left in place rather than trimmed. The nonzero rule
fills them correctly, and trimming them is what makes naive outliners grow spikes.

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

### Tracing is potrace's algorithm, not an approximation of it

The stages are the ones Peter Selinger describes: follow the boundary between filled and
empty pixels, find the fewest straight segments that stay within half a pixel of every point
on it, adjust each vertex onto the least-squares line through the pixels it came from, then
decide per vertex whether the turn is a corner or a curve and fit cubics to the rest. The
panel's sliders are those parameters rather than post-processing: Corners is potrace's
`alphamax`, Paths is its curve-optimisation tolerance, Noise is `turdsize`.

Doing it properly is what makes the output usable. A 60-pixel disc traces to **five anchor
points**, and the curve through them is never more than **0.54 px** from the true circle —
which is the floor, because the pixel boundary the tracer is given is itself half a pixel
away from the circle that drew it. A tracer that fitted curves to the boundary directly, or
that smoothed a polygon afterwards, would need dozens of anchors for the same accuracy, and
every one of them is a point somebody has to drag later.

Holes need no special case. The boundary walk removes each region it has traced by flipping
the pixels inside it, so a filled ring becomes an island the very next scan finds — nesting
to any depth falls out of repeating one rule, with no containment tests and no tree to build.
The hole's point list is reversed where its sign is known, so an outer path and its holes
handed to any renderer come out right under the nonzero rule.

### A trace is a conversation, so it runs in a worker and the latest question wins

Tracing a photograph is a few hundred milliseconds of arithmetic. On the main thread that is
a freeze on every slider movement, so it runs in a Worker — but a drag produces dozens of
positions a second and a worker cannot look at its own queue while it is busy. The scheduler
keeps at most one trace running and at most one queued, and a new request replaces whatever
was waiting: the result you see is always for the settings you last asked for, never a
flicker back through the ones you dragged past. Requests that were superseded while they ran
are computed and then dropped, which is cheaper than the alternative of not starting them.

The decoded pixels are transferred rather than copied, and an image larger than two megapixels
is reduced once on decode rather than on every trace — a 24-megapixel photograph is a 96 MB
buffer, and the trace it produces is indistinguishable from the reduced image's.

### The preview hides the picture rather than covering it

Showing a tracing result over its source looks like a job for a layer drawn on top. It is
not: with Ignore White on, a trace is transparent everywhere the picture was white, and
anything painted over the image would show it through the gaps — the one setting whose whole
purpose is to remove the background would appear to do nothing. So the image node is told not
to render at all while a view that replaces it is showing, and the traced paths are drawn in
the viewport's own space over the hole where it was. Turning Preview off puts the picture
back untouched, which is what the checkbox promises.

### For rich text the textarea stops drawing and becomes an input sink

A `<textarea>` has one font. Editing a text object with style runs inside one lays every
character out at the same size, so the caret lands where the plain version WOULD have put it,
drifting further with each word drawn larger — and the formatting is invisible the whole time
you are editing it, which is when you most want to see it.

So text carrying runs takes a different path, the same split the layout engine already makes
between uniform and rich. The textarea goes fully transparent and keeps only the jobs it is
genuinely good at — the keyboard, the clipboard, the selection offsets, IME — while the
canvas draws the glyphs and `TextGeometry` places the caret and the highlight from the same
layout that drew them. They cannot disagree, because there is one layout. Pointer clicks are
mapped through that layout too: `offsetX`/`offsetY` on the textarea are already in the node's
local space, since CSS transforms do not affect them.

Uniform text keeps the native textarea untouched, caret and all. It is better at it than
anything drawn by hand, and nothing about ordinary text should pay for rich text existing.

### A text stroke is painted behind the glyphs

Over them, which is what SVG does by default, half of every stroke eats into the letterform:
on a stem no thicker than the stroke the fill disappears completely, counters close up, and
neighbouring letters grow into each other. Behind the fill the same stroke shows only the
half that falls outside the glyph — which is what an outlined letter is supposed to look
like, and what Adobe does, where Stroke sits below Fill in a type object's appearance. An
outer stroke is then asked for at double width so the full width lands outside.

### A click target is a screen distance, wherever the object is

The tolerance a click carries is in world units — screen pixels divided by the zoom — but
every distance it was compared against is in the node's own local space, and under a scaled
node those are not the same distance. On top of that the stroke test floored it at two world
units, which at 800% is sixteen screen pixels and at 25% is barely one. So how close you had
to be to a line depended on the zoom and on whatever scaling sat above it.

It is converted into local units now, and the floor with it. What is left varying is the
stroke's own on-screen width, which should vary: a thick line genuinely is a bigger target
than a hairline.

### The tool that adjusts a shape should not be the one most likely to add to it

Clicking an outline with Direct Selection used to insert an anchor, so every attempt to pick
up an edge and move it left a new point behind. Insertion belongs to the Pen, which is the
tool you reach for when you mean to add something; Direct Selection selects the segment
instead, and dragging it moves both of its ends.

Selection is a set, not a slot. Points and segments are collected separately and dragged
together — the moving set is the selected points plus both ends of every selected segment —
which is what lets two opposite edges of a rectangle be pulled apart in one gesture. Pressing
an already-selected member keeps the whole set, so a collection can be picked up by any one
of the things in it.

Rounding and straightening are one gesture and its opposite: double-click rounds a corner, a
plain click on a rounded point straightens it. Deciding on pointer-UP rather than pointer-DOWN
is what keeps the second from firing every time a point is picked up to be moved — a press
that turns into a drag is a move, and only a press that goes nowhere is a click.

### A control point sitting on its anchor is not a handle

Straightening one end of a curve leaves a cubic whose control point coincides with the point
it belongs to. Read back literally that is a handle, so the editor drew a dot on top of the
anchor that could be grabbed and dragged and represented nothing — and they accumulated, one
per straightened end. The path parser now treats a coincident control point as absent, which
is what it means: the curve it describes is a straight line.

### A tool should be able to see what it is waking up into

`onActivate` existed on the Tool interface and was never called, so a tool could only ever
react to a click. Switching to Direct Selection with an object already selected showed
nothing until the object was clicked a second time — a step that existed purely because
nobody was listening. It is wired now, and runs AFTER the state has changed rather than
before, which is the difference between the two handlers: a tool being torn down needs the
world it is leaving, and a tool waking up needs the world it has arrived in.

### Formatting a selection is a conversation between two panels

You select a word on the canvas and reach for a control in the inspector — and clicking the
inspector blurs the textarea holding the selection. So the selection is mirrored into the
editor store as it changes, and a blur that lands inside the inspector is deliberately not
the end of editing. Without both, the interaction cannot exist: by the time the control is
clicked, there is nothing left to say what it applies to.

The selection is read through `selectionchange` on the document rather than React's
`onSelect`, which is synthesised from React's own heuristics and does not fire for a
programmatic `setSelectionRange` — which is exactly what selecting all the text on entry is.

### While you type the textarea draws; the moment you format, the canvas does

A `<textarea>` has one font. It cannot show a bold word inside a plain sentence, and the two
renderings cannot be shown together either — a textarea centres its text in a CSS line box
while SVG sits it on a baseline, so any overlap doubles the glyphs visibly.

They are never needed at the same time, though. While you are typing, the textarea is the
rendering and the canvas keeps its text hidden. The moment focus moves to the inspector —
which is the only way to format a selection — the textarea is not what is being looked at, so
it goes transparent and the canvas draws the real, formatted text underneath. Transparent
rather than hidden, and this is load-bearing: `visibility: hidden` also makes an element
unfocusable, and this one focuses itself on mount, so it could never have come back.

### A run replaces, it does not merge

The layout engine resolves a character's style by taking the LAST run covering it and laying
it over the object's own — an earlier overlapping run is ignored outright rather than merged
into. Everything that edits or reads runs has to agree with that, or the inspector would
describe text the canvas does not draw. So `applyRunStyle` cuts runs at the edges of the
range it is given and never emits an overlap: overlapping runs are legal for the renderer,
but they make every later question ("what weight is this character?") depend on list order.

### A shortcut you can change has to exist first

The shortcuts used to be two things that did not know about each other: a `switch` in the
key handler that did the work, and a hand-written array that the dialog displayed. Nothing
could be rebound, because there was no binding to rebind — only code. And the two could
drift, which they had: the dialog advertised ⇧⌘' for snapping, while the handler compared
against a character that key combination does not produce, so it did nothing at all.

Now a command is a record — an id, a default chord, a function — and the handler, the
dialog and the keymap all read the same records. The id is the part that never changes:
labels are translated and chords belong to the user, but `file.save` is what an exported
preferences file refers to, and what it will still mean in five versions' time.

### A chord is a position, not a character

`e.key` reports what a keystroke PRODUCES, and that is not what a shortcut is about.
Shift+' produces `"`; Shift+1 produces `!`. Any handler comparing `e.key` against `'` with a
shift test is comparing against something that can never arrive — which is exactly the bug
above. So the key name comes from `e.code`, the physical position, for digits and
punctuation. Letters are the exception and come from `e.key`, because a letter's identity is
the letter rather than where the layout happens to put it.

The stored form is platform-neutral for the same reason. `Mod` is one idea — the command
modifier — that renders as ⌘ on a Mac and Ctrl elsewhere. Storing the rendered symbol would
make an exported keymap useless on the other kind of machine, which is most of the point of
being able to export one.

### The keymap stores only what you changed

A file recording every binding would freeze the defaults at the moment it was written: add a
command later, or improve a default, and every existing user is stuck with the old map
forever. Storing only the differences means a shortcut nobody touched keeps following the
application, and it is what makes "reset" a deletion rather than a write.

One chord runs one command. Binding a taken chord unbinds the command that held it, rather
than leaving two things on one key and picking between them by array order — and the dialog
says which one it displaced, because a shortcut that silently stops working is worse than
one that visibly has none.

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
  text/        font registry, layout, spell check, font embedding
  images/      file import
  trace/       Image Trace: quantize, decompose, polygon, smooth — DOM-free
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
npm test           # 680 unit tests (Vitest)
npm run test:e2e   # 354 end-to-end tests (Playwright, real Chromium)
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

---

## License

Licensed under the [Apache License, Version 2.0](LICENSE).

```
Copyright (C) 2026 Stanislav Georgiev
https://github.com/slaviboy
```

You may use, modify and redistribute this code, including commercially, provided you keep
the copyright notice and the per-file licence headers, state the changes you made, and
carry the [`NOTICE`](NOTICE) file with any redistribution or derivative work.

## Trademarks

This project is not affiliated with, endorsed by, or sponsored by Adobe Inc. "Adobe" and
"Adobe XD" are trademarks of Adobe Inc., referred to here only to describe the interface
this editor takes its shape from.

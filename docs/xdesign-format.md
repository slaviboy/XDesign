# The `.xdesign` file format

A `.xdesign` file is one complete XDesign document: every artboard, every layer, every image,
the swatches and the canvas settings. It needs nothing else to open, so you can copy it to
another machine, email it or keep it in version control.

This page explains the format so you can read `.xdesign` files in your own tools and write
files that XDesign will open. The format is open and uses nothing unusual: **a ZIP archive
holding one JSON file plus the image files.** The reference implementation is
[`src/persistence/FileFormat.ts`](../src/persistence/FileFormat.ts), and the full type
definitions are in [`src/document/types.ts`](../src/document/types.ts).

| | |
| --- | --- |
| Extension | `.xdesign` |
| MIME type | `application/x-xdesign+zip` |
| Container | ZIP (deflate), or a single plain JSON file |
| Text encoding | UTF-8 |
| Format identifier | `"format": "OfflineDesignDocument"` |
| Current version | `4` |

Contents:
- [Opening and saving in the app](#opening-and-saving-in-the-app)
- [The container](#the-container)
- [`document.json`](#documentjson)
- [The scene graph](#the-scene-graph)
- [Node reference](#node-reference)
- [Images](#images)
- [Versions and compatibility](#versions-and-compatibility)
- [What the app checks when it opens a file](#what-the-app-checks-when-it-opens-a-file)
- [Reading a file](#reading-a-file)
- [Writing a file](#writing-a-file)
- [Checklist for generated files](#checklist-for-generated-files)

---

## Opening and saving in the app

| Action | How |
| --- | --- |
| Open | **File ▸ Open…** (`Ctrl/⌘ O`), or drag a `.xdesign` file onto the canvas. Opening replaces the current document, so if you have unsaved changes the app asks first. When you drop a file, it also offers to save them before opening. |
| Save | **File ▸ Save** (`Ctrl/⌘ S`). In Chrome and Edge this overwrites the file on disk. Other browsers cannot overwrite a file, so Save downloads a new copy. |
| Save As | **File ▸ Save As…** (`Ctrl/⌘ Shift S`) always asks for a new file name and location. |

**File ▸ Open…** can also open a `.json` file, which is the plain-JSON form of the format
described below. In Chrome and Edge, choose "All files" in the dialog to see it. Dragging onto
the canvas only opens files whose name ends in `.xdesign`, so name a plain-JSON document
`.xdesign` if you want to drop it.

Separately from the files you save, the app keeps an autosave in the browser's own storage. If
the tab closes or crashes with unsaved work, it offers to restore that work the next time it
starts. The autosave uses the same format, but it lives inside the browser, not on disk.

---

## The container

A saved file is a standard ZIP archive:

```
My Design.xdesign
├── document.json          the whole document: settings, swatches, every layer
└── assets/
    ├── a9lfavgwacoj1.jpg  one file per image, the original bytes
    └── ade0ivrhi4gv2.png
```

- **`document.json`** must be at the root of the archive, not inside a folder.
- **`assets/<asset id>.<ext>`** holds each image's bytes, unchanged from the original file.
  The extension comes from the image's MIME type (`png`, `jpg`, `gif`, `webp`, `bmp`, `avif`,
  `svg`, `ico`, `tiff`, or `bin` for anything else). The app uses the `file` field in
  `document.json` to find each image, not the file name, so any path inside the archive works.

Any ZIP tool can open a `.xdesign` file. Rename it to `.zip`, or run `unzip -l "My
Design.xdesign"` to list what is inside.

### Why ZIP

Images are stored as separate files rather than as base64 text inside the JSON. Base64 makes
binary data a third larger and then compresses badly, so a document with many images would be
several times bigger as one JSON file.

### The plain-JSON form

The reader checks the first bytes of the file. If they are `PK` (the ZIP signature), it opens
the ZIP. **Anything else is read as JSON.** So a single JSON file with the same content as
`document.json` also opens. In that form each image is stored inline as a `dataUrl` (a
`data:image/png;base64,…` string) instead of a `file` path.

This form is larger, but it is easy to write by hand or from a script, and it produces readable
diffs. Save the file with a `.xdesign` or `.json` extension. Inside the repository,
`serializeDocument(doc, { plainJson: true })` writes it. The app's menus always save the ZIP
form.

---

## `document.json`

```jsonc
{
  "format": "OfflineDesignDocument",   // required, exactly this string
  "version": 4,                        // required, a number no greater than 4
  "document": {
    "id": "docmtxasv4i",
    "name": "Aura — Shopping App",     // the title shown in the app
    "createdAt": 1789151824530,        // milliseconds since 1970 (Unix epoch)
    "modifiedAt": 1789151824592,
    "settings": { … },                 // canvas settings, see below
    "swatches": [ … ],                 // the saved colours, see below
    "svgDefs": { … }                   // optional, see below
  },
  "rootId": "root",                    // id of the document root node
  "artboards": ["nynnjdogkde4p", …],   // index only, see below
  "layers": [ … ],                     // EVERY node, in one flat list
  "assets": [ … ],                     // image metadata
  "metadata": { … }                    // free-form, see below
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `format` | yes | Must be `"OfflineDesignDocument"`. Any other value is rejected. |
| `version` | yes | A number. A value above `4` is rejected: the file came from a newer app. |
| `layers` | yes | An array of nodes. This is the actual content of the document. |
| `rootId` | no | If it is missing or wrong, the reader uses the first node of type `document`, or creates one. |
| `document` | no | Every field has a default. |
| `assets` | no | Defaults to no images. |
| `artboards` | no | Written by the app for convenience and **ignored when reading**. The artboards are the `artboard` nodes in `layers`. |
| `metadata` | no | Written as `{ generator, savedAt, nodeCount, assetCount }`. Ignored when reading, so you can put your own information here. |

### `document.settings`

The canvas settings that belong to this document. Any missing key takes its default value, so
`"settings": {}` is fine.

| Key | Type | Default |
| --- | --- | --- |
| `gridSize` | number | `8` |
| `gridVisible` | boolean | `false` |
| `snapToGrid` | boolean | `false` |
| `snapToObjects` | boolean | `true` |
| `guidesVisible` | boolean | `true` |
| `guideColor` | RGBA | `{ "r": 216, "g": 55, "b": 144, "a": 1 }` |
| `guideDragMode` | `"line"` \| `"handle"` | `"line"` |

### `document.swatches`

The document's saved colours, in the order they appear in the palette:

```json
[{ "id": "w1c5b1gt4966b", "color": { "r": 255, "g": 107, "b": 61, "a": 1 } }]
```

An entry without a string `id` or a complete RGBA `color` is skipped.

### `document.svgDefs`

Optional. It holds SVG definitions (gradients, patterns and similar) that came in with an
imported SVG, keyed by id. Each value is an SVG fragment as a string. Shapes use these
definitions through a `ref` paint (see [Paint](#paint)). The app cleans each fragment with its
SVG sanitizer when it opens the file.

---

## The scene graph

`layers` is a **flat list of nodes**. The list itself has no structure and its order does not
matter. The tree is built from two fields on each node:

- `parentId`: the id of the node's parent (`null` for the root).
- `children`: on a container node, an array of child ids.

The **order of `children` is the stacking order**: the first child is at the back and the last
child is at the front. This order is also the order of the Layers panel, read from the bottom
up.

Every document has exactly one root node, of type `document`, conventionally with the id
`"root"`. Its children are the artboards, plus any objects that sit directly on the canvas
outside every artboard.

```
document "root"
├── artboard "01 Welcome"
│   ├── image "Hero"
│   └── group "Status Bar"
│       ├── text "Time"
│       └── rect "Battery"
└── artboard "02 Home"
    └── …
```

### Ids

- Ids must be unique across all nodes.
- They are referenced by `parentId`, `children`, `maskId` and `booleanSources`.
- Assets have their own ids, referenced by an image node's `assetId`.
- **Start every id with a letter** and use only letters, digits, `-`, `_` and `.`. The app
  writes ids directly into exported SVG as element ids, and in SVG an id that starts with a
  digit breaks `url(#…)` references in some programs.

The app generates ids as a one-letter prefix followed by 12 random base-36 characters: `n` for
nodes, `a` for assets, `s` for gradient stops, `w` for swatches and `g` for guides (for
example `nz2rjbdjuxpv5`). Any unique id that follows the rule above works.

### Coordinates and `transform`

Every node's geometry is defined in its own **local space**, a box that runs from `(0, 0)` to
`(width, height)`. The node's `transform` places that box inside its parent. So a child's
coordinates are relative to its parent (an artboard or a group), not to the canvas. In the
Aura example, the group "Status Bar" is at `(30, 14)` on its artboard, and its "Time" text is
at `(0, 0)` inside the group.

A group's size is not its outline: its bounds are always the union of its children. The stored
`width` and `height` still set the pivot the group rotates and scales around.

```json
"transform": {
  "x": 24, "y": 96,          // where the box sits in the parent, before rotation/scale/skew
  "width": 342, "height": 200,
  "rotation": 0,             // degrees, clockwise
  "scaleX": 1, "scaleY": 1,  // a negative value flips
  "skewX": 0, "skewY": 0,    // degrees
  "originX": 0.5, "originY": 0.5   // pivot, as a fraction of the box (0.5 = centre)
}
```

All eleven keys are required. `width` and `height` are never negative; a flipped object has a
negative `scaleX` or `scaleY` instead. The local-to-parent matrix is

```
translate(x, y) · translate(c) · rotate · skew · scale · translate(−c)
```

where `c = (originX·width, originY·height)`. Rotation, skew and scale all happen around the
pivot. Units are CSS pixels, and y increases downward, as in SVG.

A node can also carry an optional `transform3d`: `{ "rotateX", "rotateY", "z" }` (degrees,
degrees, depth in pixels) for XD-style 3D transforms. Leave it out for flat objects.
Artboards and the document root never have one.

---

## Node reference

### Fields on every node

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Unique; see [Ids](#ids). |
| `type` | string | One of the types below. |
| `name` | string | The name shown in the Layers panel. |
| `parentId` | string \| null | |
| `visible` | boolean | |
| `locked` | boolean | |
| `transform` | Transform | All eleven keys. |
| `markedForExport` | boolean | Shows the export badge; used by "export marked layers". |
| `transform3d` | Transform3D | Optional. |
| `metadata` | object | Optional and free-form. SVG import stores attributes it does not model here. |

Every node type except `document` and `artboard` also has a **`style`** (see below).

| `type` | Adds |
| --- | --- |
| `document` | `children` |
| `artboard` | `children`, `background` (Paint), `clipContent` (boolean); optional `guides`, `guidesLocked`, `grid` |
| `group` | `children`, `style`; optional `maskId` (the top child, used as a mask) and `maskMode` (`"clip"`, `"luminance"` or `"alpha"`; default `"clip"`) |
| `repeat-grid` | `children` (one source cell), `style`, `rows`, `columns`, `gutterX`, `gutterY`, `cellWidth`, `cellHeight` |
| `rect` | `style`, `cornerRadius`: four numbers `[top-left, top-right, bottom-right, bottom-left]` |
| `ellipse` | `style` |
| `polygon` | `style`, `sides` (3 to 100), `starRatio` (0.01 to 1; 1 is a plain polygon, lower values make a star), `cornerRadius` (one number) |
| `line` | `style`, `x1`, `y1`, `x2`, `y2` in local space |
| `path` | `style`, `d` (SVG path data; every command is supported), `closed` (boolean); optional `booleanOp` and `booleanSources` |
| `text` | `style`, `text`, `textStyle`; optional `runs` |
| `image` | `style`, `assetId`, `fit` (`"fill"`, `"contain"` or `"cover"`), `cornerRadius` (four numbers); optional `crop` |
| `svg` | `style`, `markup`, `defs`, `viewBox` (`{x, y, width, height}`), `preserveAspectRatio` |

Notes on specific types:

- **Artboard guides** are stored in the artboard's local space:
  `"guides": [{ "id": "g…", "axis": "x", "position": 120 }]`. An `x` guide is a vertical line
  at that x.
- **An artboard grid** is either a square grid,
  `{ "type": "square", "visible", "size", "color" }`, or a column layout grid,
  `{ "type": "layout", "visible", "columns", "gutter", "marginLeft", "marginRight", "color" }`.
- **A repeat grid** stores only one source cell. The app draws it `rows × columns` times. The
  grid's `transform.width` and `height` follow from the cell size and the gutters.
- **An image crop** is `{ "x", "y", "width", "height" }`, each a fraction from 0 to 1 of the
  whole picture. The node's box is the part that is kept.
- **An `svg` node** keeps imported SVG that the editor has no model for (such as `<use>`,
  `<pattern>`, `<filter>` or `<marker>`) as markup, and draws it as it is. The app cleans the
  markup with its SVG sanitizer every time it opens a file.

### `style`

```json
"style": {
  "fill": { "type": "solid", "color": { "r": 108, "g": 92, "b": 231, "a": 1 } },
  "fillOpacity": 1,
  "fillRule": "nonzero",
  "stroke": {
    "paint": { "type": "none" }, "width": 1, "cap": "butt", "join": "miter",
    "miterLimit": 4, "dashArray": [], "dashOffset": 0, "align": "center"
  },
  "strokeOpacity": 1,
  "opacity": 1,
  "blendMode": "normal"
}
```

| Key | Values |
| --- | --- |
| `fill` | Paint |
| `fillOpacity`, `strokeOpacity`, `opacity` | 0 to 1. `opacity` applies to the whole node. |
| `fillRule` | `"nonzero"` or `"evenodd"` |
| `stroke.cap` | `"butt"`, `"round"` or `"square"` |
| `stroke.join` | `"miter"`, `"round"` or `"bevel"` |
| `stroke.align` | `"center"`, `"inner"` or `"outer"` |
| `blendMode` | `"normal"`, `"multiply"`, `"screen"`, `"overlay"`, `"darken"`, `"lighten"`, `"color-dodge"`, `"color-burn"`, `"hard-light"`, `"soft-light"`, `"difference"`, `"exclusion"`, `"hue"`, `"saturation"`, `"color"` or `"luminosity"` |
| `shadow` | Optional drop shadow: `{ "x", "y", "blur", "color", "visible" }` |
| `innerShadow` | Optional inner shadow, with the same fields |
| `blur` | Optional: `{ "kind": "object" or "background", "amount": 0–50, "brightness": −50–50, "fillOpacity": 0–1, "visible" }` |

Groups, repeat grids, images and `svg` nodes still need a full `style`. Use `"fill":
{ "type": "none" }` when they have no fill of their own.

### Paint

Colours are **RGBA** objects: `r`, `g` and `b` from 0 to 255, and `a` from 0 to 1.

| `type` | Fields |
| --- | --- |
| `none` | none |
| `solid` | `color` |
| `linear` | `x1`, `y1`, `x2`, `y2`, `stops`; optional `units`, `transform`, `spread` |
| `radial` | `cx`, `cy`, `r`, `stops`; optional `fx`, `fy`, `fr`, `units`, `transform`, `spread` |
| `angular` | `cx`, `cy`, `rotation` (degrees), `stops` |
| `ref` | `ref`: a `url(#id)` reference to an entry in `document.svgDefs` |

Gradient coordinates are fractions from 0 to 1 of the node's own box, so a gradient stretches
with its shape. The exception is `"units": "userSpaceOnUse"`, which imported SVG sometimes
needs. Each stop is `{ "id": "s…", "offset": 0–1, "color": RGBA }`.

### Text

```json
"text": "Hello, XDesign",
"textStyle": {
  "fontFamily": "Inter", "fontSize": 24, "fontWeight": 700, "fontStyle": "normal",
  "lineHeight": 1.4, "letterSpacing": 0, "paragraphSpacing": 0, "align": "left",
  "underline": false, "strikethrough": false, "transform": "none", "sizing": "auto-width"
}
```

- `lineHeight` is a multiple of the font size. `letterSpacing` is in em. `paragraphSpacing` is
  in pixels.
- `align` is `"left"`, `"center"` or `"right"`.
- `transform` is `"none"`, `"uppercase"`, `"lowercase"` or `"titlecase"`. It only changes how
  the text is displayed; the stored `text` stays as typed.
- `sizing` is one of:
  - `"auto-width"`: the box is as wide as the text, on one line.
  - `"auto-height"`: you set the width, and the height grows with the wrapped text.
  - `"fixed"`: you set both, and text that does not fit is cut off.
- Line breaks are `\n` characters in `text`.
- The text colour is `style.fill`.

**Rich text** is stored as `runs`: character ranges over `text` with their own style.
`start` is inclusive and `end` is exclusive. Each run's `style` lists only the properties that
differ from `textStyle`, and a run can also have its own `fill`. Runs must not overlap and must
be sorted by position.

```json
"runs": [{ "start": 7, "end": 14, "style": { "fontWeight": 700 }, "fill": { "type": "solid", "color": { "r": 108, "g": 92, "b": 231, "a": 1 } } }]
```

**Fonts.** The app ships these families and never downloads fonts: Inter, Roboto, Open Sans,
Lato, Montserrat, Poppins, Raleway, Nunito, Work Sans, DM Sans, Oswald, Playfair Display,
Merriweather, Lora, Libre Baskerville, Roboto Mono, JetBrains Mono and Source Code Pro. Most
come in weights 300 to 700. Any other `fontFamily` still opens and still exports, but it only
looks right on a computer that has that font installed. Elsewhere a similar system font is
used instead.

---

## Images

Each entry in `assets` describes one image:

```json
{
  "id": "ade0ivrhi4gv2",
  "name": "Air Runner Pro",
  "mimeType": "image/png",
  "width": 480, "height": 480,           // pixel size of the original image
  "byteSize": 52314,
  "file": "assets/ade0ivrhi4gv2.png"     // ZIP form: path inside the archive
  // "dataUrl": "data:image/png;base64,…" // plain-JSON form: the image inline
}
```

An image node shows an asset through its `assetId`. Several image nodes can use the same
asset, and the image is stored only once. An asset with neither a readable `file` nor a
`dataUrl` is skipped.

---

## Versions and compatibility

| Version | What changed |
| --- | --- |
| 1 | First release. |
| 2 | Triangle and star became settings of one `polygon` type (`sides` and `starRatio`). Guides were stored on the document. |
| 3 | Guides moved from `document.guides` onto the artboard they belong to, in its local space. |
| 4 | The shadow with a `kind` field became two separate fields: `style.shadow` (drop) and `style.innerShadow`. |

The version number only goes up when existing data moves or changes meaning. A new optional
field does not change the version. So a reader should **ignore keys it does not know**, and a
writer should **leave out** optional fields it does not use; the app treats a missing optional
field as "not set".

The app opens files of any version from 1 to 4 and upgrades older data as it loads:
- `triangle` and `star` nodes become polygons.
- A version 2 file's guides move onto the artboard they cross.
- A shadow with `kind: "inner"` becomes an `innerShadow`.

It **refuses a file with a higher version** rather than opening it wrongly. It always saves at
the current version.

---

## What the app checks when it opens a file

Opening is careful. A file that cannot be opened shows a clear error and leaves the current
document untouched. The app never opens half a file.

**These errors stop the file from opening:**
- the file is empty;
- the ZIP is damaged, or it has no `document.json`;
- the JSON cannot be parsed;
- `format` is wrong;
- `version` is missing or higher than 4;
- `layers` is not an array.

**These problems are repaired, and the rest of the document opens normally:**
- A node without a string `id` is dropped.
- A child id that points to no node is removed from `children`.
- A node that no container lists as a child is moved onto the document root, outside every
  artboard.
- A wrong `parentId` is corrected from the `children` lists, and parent loops are broken.
- A malformed guide, swatch, grid, image crop or `transform3d` is dropped.
- The markup of `svg` nodes and `svgDefs` is cleaned by the SVG sanitizer, the same one used
  for SVG import. This is why a hand-edited file cannot inject scripts.

**What is not repaired: the fields inside a node.** The app creates every node with all of its
fields, and the renderer relies on that. A `rect` with no `style`, for example, opens, but it
fails when it is drawn. **A file you write must include every required field of every node.**
The easiest way to be sure is to copy a node from a file the app saved and change its values.

---

## Reading a file

### By hand

```bash
unzip -l "Nova Bank.xdesign"                      # list the contents
unzip -p "Nova Bank.xdesign" document.json | jq . # print the document
```

### Python (standard library only)

This example lists the layer tree and saves every image to `assets-out/`. It reads both the
ZIP form and the plain-JSON form.

```python
import base64, json, sys, zipfile
from pathlib import Path

def load(path):
    """Returns (document, images), where images maps an asset id to its bytes."""
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            doc = json.loads(z.read("document.json").decode("utf-8"))
            names = set(z.namelist())
            images = {a["id"]: z.read(a["file"]) for a in doc["assets"] if a.get("file") in names}
    else:  # plain-JSON form: images are inline data URLs
        doc = json.loads(Path(path).read_text("utf-8"))
        images = {a["id"]: base64.b64decode(a["dataUrl"].split(",", 1)[1])
                  for a in doc["assets"] if a.get("dataUrl")}
    if doc.get("format") != "OfflineDesignDocument":
        raise ValueError("not an XDesign document")
    if doc.get("version", 0) > 4:
        raise ValueError(f"written by a newer XDesign (format {doc['version']})")
    return doc, images

def walk(nodes, node_id, depth=0):
    """Yields (depth, node) in stacking order: the first child is at the back."""
    node = nodes[node_id]
    yield depth, node
    for child in node.get("children", []):
        if child in nodes:
            yield from walk(nodes, child, depth + 1)

doc, images = load(sys.argv[1])
nodes = {n["id"]: n for n in doc["layers"]}
print(doc["document"]["name"], f"(format {doc['version']})")
for depth, n in walk(nodes, doc["rootId"]):
    t = n["transform"]
    line = f"{n['type']:<11} {n['name']!r}  {t['width']:g}×{t['height']:g} at ({t['x']:g}, {t['y']:g})"
    if n["type"] == "text":
        line += f"  “{n['text'][:40]}”"
    print("  " * depth + line)

out = Path("assets-out")
out.mkdir(exist_ok=True)
for meta in doc["assets"]:
    if meta["id"] in images:
        name = meta.get("file", f"assets/{meta['id']}.bin").split("/")[-1]
        (out / name).write_bytes(images[meta["id"]])
```

```
$ python3 read_xdesign.py "examples/shop-app/Aura Shopping App.xdesign"
Aura — Shopping App (format 4)
document    'Document'  0×0 at (0, 0)
  artboard    '01 Welcome'  390×844 at (0, 0)
    image       'Hero'  390×520 at (0, 0)
    group       'Status Bar'  333×20 at (30, 14)
      text        'Time'  29×20 at (0, 0)  “9:41”
      rect        'Signal 1'  3×4 at (264, 11)
      …
```

### JavaScript / Node

This example uses [`fflate`](https://www.npmjs.com/package/fflate), the ZIP library the app
uses. Any ZIP library works.

```js
import { readFileSync } from 'node:fs'
import { unzipSync, strFromU8 } from 'fflate'

const bytes = new Uint8Array(readFileSync(process.argv[2]))
const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b                 // "PK"
const files = isZip ? unzipSync(bytes) : null
const doc = JSON.parse(strFromU8(files ? files['document.json'] : bytes))

if (doc.format !== 'OfflineDesignDocument') throw new Error('Not an XDesign document')
if (doc.version > 4) throw new Error(`Written by a newer XDesign (format ${doc.version})`)

const nodes = new Map(doc.layers.map((n) => [n.id, n]))
const print = (id, depth = 0) => {
  const n = nodes.get(id)
  console.log(`${'  '.repeat(depth)}${n.type} "${n.name}"${n.type === 'text' ? ` — ${n.text}` : ''}`)
  for (const child of n.children ?? []) if (nodes.has(child)) print(child, depth + 1)
}
print(doc.rootId)

for (const asset of doc.assets) {
  const data = files?.[asset.file]                                  // ZIP form: the raw bytes
    ?? Buffer.from(asset.dataUrl.split(',')[1], 'base64')           // plain JSON: the data URL
  console.log(asset.id, asset.mimeType, data.length, 'bytes')
}
```

### Inside this repository

`deserializeDocument` from [`src/persistence/FileFormat.ts`](../src/persistence/FileFormat.ts)
turns file bytes into the same `DesignDocument` the editor works on. It also upgrades older
versions and repairs problems, as described above. It runs in Node as well as the browser.
The SVG sanitizer is browser-only, so under Node stored markup is passed through as it is.

```ts
import { readFileSync } from 'node:fs'
import { deserializeDocument } from '@/persistence/FileFormat'

const doc = deserializeDocument(new Uint8Array(readFileSync('My Design.xdesign')))
```

To turn a document into a picture, use `exportNodesToSvg` from
[`src/svg/SvgExporter.ts`](../src/svg/SvgExporter.ts). It needs a DOM, which means a browser
or a DOM environment such as happy-dom.

---

## Writing a file

### The smallest file that opens

Save this as `Hello.xdesign` (or `Hello.json`) and open it. It is one artboard with one
rounded rectangle, in the plain-JSON form:

```json
{
  "format": "OfflineDesignDocument",
  "version": 4,
  "document": { "id": "dochello", "name": "Hello", "createdAt": 1789200000000, "modifiedAt": 1789200000000, "settings": {} },
  "rootId": "root",
  "artboards": ["nboard"],
  "layers": [
    {
      "id": "root", "type": "document", "name": "Document", "parentId": null,
      "visible": true, "locked": false, "markedForExport": false,
      "transform": { "x": 0, "y": 0, "width": 0, "height": 0, "rotation": 0, "scaleX": 1, "scaleY": 1, "skewX": 0, "skewY": 0, "originX": 0.5, "originY": 0.5 },
      "children": ["nboard"]
    },
    {
      "id": "nboard", "type": "artboard", "name": "Home", "parentId": "root",
      "visible": true, "locked": false, "markedForExport": false,
      "transform": { "x": 0, "y": 0, "width": 390, "height": 844, "rotation": 0, "scaleX": 1, "scaleY": 1, "skewX": 0, "skewY": 0, "originX": 0.5, "originY": 0.5 },
      "children": ["ncard"],
      "background": { "type": "solid", "color": { "r": 255, "g": 255, "b": 255, "a": 1 } },
      "clipContent": true
    },
    {
      "id": "ncard", "type": "rect", "name": "Card", "parentId": "nboard",
      "visible": true, "locked": false, "markedForExport": false,
      "transform": { "x": 24, "y": 96, "width": 342, "height": 200, "rotation": 0, "scaleX": 1, "scaleY": 1, "skewX": 0, "skewY": 0, "originX": 0.5, "originY": 0.5 },
      "style": {
        "fill": { "type": "solid", "color": { "r": 108, "g": 92, "b": 231, "a": 1 } },
        "fillOpacity": 1, "fillRule": "nonzero",
        "stroke": { "paint": { "type": "none" }, "width": 1, "cap": "butt", "join": "miter", "miterLimit": 4, "dashArray": [], "dashOffset": 0, "align": "center" },
        "strokeOpacity": 1, "opacity": 1, "blendMode": "normal"
      },
      "cornerRadius": [16, 16, 16, 16]
    }
  ],
  "assets": [],
  "metadata": {}
}
```

To make the ZIP form instead, name the JSON `document.json` and zip it. It must sit at the
root of the archive:

```bash
zip -X "Hello.xdesign" document.json            # add assets with: zip -r … document.json assets
```

### Python, with an image

This script writes a complete ZIP-form file: an artboard with a rectangle, a text layer, a
PNG image and a swatch. Only the standard library is needed. The PNG's size is read from its
header; for JPEG or other formats, use Pillow to get the size.

```python
import json, struct, time, zipfile

def transform(x, y, w, h):
    return {"x": x, "y": y, "width": w, "height": h, "rotation": 0,
            "scaleX": 1, "scaleY": 1, "skewX": 0, "skewY": 0, "originX": 0.5, "originY": 0.5}

def rgba(hex_, a=1):
    return {"r": int(hex_[1:3], 16), "g": int(hex_[3:5], 16), "b": int(hex_[5:7], 16), "a": a}

def style(fill=None):
    return {"fill": {"type": "solid", "color": fill} if fill else {"type": "none"},
            "fillOpacity": 1, "fillRule": "nonzero",
            "stroke": {"paint": {"type": "none"}, "width": 1, "cap": "butt", "join": "miter",
                       "miterLimit": 4, "dashArray": [], "dashOffset": 0, "align": "center"},
            "strokeOpacity": 1, "opacity": 1, "blendMode": "normal"}

def node(id_, type_, name, parent, t, **fields):
    return {"id": id_, "type": type_, "name": name, "parentId": parent, "visible": True,
            "locked": False, "transform": t, "markedForExport": False, **fields}

png = open("photo.png", "rb").read()
png_w, png_h = struct.unpack(">II", png[16:24])        # the PNG size, from its IHDR header

layers = [
    node("root", "document", "Document", None, transform(0, 0, 0, 0), children=["nboard"]),
    node("nboard", "artboard", "Home", "root", transform(0, 0, 390, 844),
         children=["ncard", "ntitle", "nphoto"],
         background={"type": "solid", "color": rgba("#ffffff")}, clipContent=True),
    node("ncard", "rect", "Card", "nboard", transform(24, 96, 342, 200),
         style=style(rgba("#6c5ce7")), cornerRadius=[16, 16, 16, 16]),
    node("ntitle", "text", "Title", "nboard", transform(24, 40, 200, 34),
         style=style(rgba("#1c1b2e")), text="Hello, XDesign",
         textStyle={"fontFamily": "Inter", "fontSize": 24, "fontWeight": 700, "fontStyle": "normal",
                    "lineHeight": 1.4, "letterSpacing": 0, "paragraphSpacing": 0, "align": "left",
                    "underline": False, "strikethrough": False, "transform": "none",
                    "sizing": "auto-width"}),
    node("nphoto", "image", "Photo", "nboard", transform(24, 320, 342, 342 * png_h / png_w),
         style=style(), assetId="aphoto", fit="cover", cornerRadius=[12, 12, 12, 12]),
]

now = int(time.time() * 1000)
document = {
    "format": "OfflineDesignDocument",
    "version": 4,
    "document": {"id": "dochello", "name": "Hello", "createdAt": now, "modifiedAt": now,
                 "settings": {}, "swatches": [{"id": "wbrand", "color": rgba("#6c5ce7")}]},
    "rootId": "root",
    "artboards": ["nboard"],
    "layers": layers,
    "assets": [{"id": "aphoto", "name": "photo.png", "mimeType": "image/png", "width": png_w,
                "height": png_h, "byteSize": len(png), "file": "assets/aphoto.png"}],
    "metadata": {"generator": "write_xdesign.py"},
}

with zipfile.ZipFile("Hello.xdesign", "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("document.json", json.dumps(document))
    z.writestr("assets/aphoto.png", png)
```

### Inside this repository

The simplest option in TypeScript is to use the editor's own modules. The node constructors in
[`src/document/NodeFactory.ts`](../src/document/NodeFactory.ts) fill in every field, so the
nodes are always complete. `serializeDocument` then writes exactly what the app's Save writes.

```ts
import { writeFileSync } from 'node:fs'
import { createDocument, createRect, createText } from '@/document/NodeFactory'
import { serializeDocument } from '@/persistence/FileFormat'

const doc = createDocument('Hello')                       // a root and one artboard
const board = Object.values(doc.nodes).find((n) => n.type === 'artboard')!
Object.assign(board.transform, { width: 390, height: 844 })

const card = createRect({ x: 24, y: 96, width: 342, height: 200 },
  { fill: { type: 'solid', color: { r: 108, g: 92, b: 231, a: 1 } } }, [16, 16, 16, 16])
const title = createText('Hello, XDesign', { x: 24, y: 40, width: 200, height: 34 }, {},
  { fontSize: 24, fontWeight: 700 })

for (const node of [card, title]) {
  node.parentId = board.id
  if ('children' in board) board.children.push(node.id)
  doc.nodes[node.id] = node
}

writeFileSync('Hello.xdesign', serializeDocument(doc))   // { plainJson: true } for readable JSON
```

The documents in [`examples/`](../examples/README.md) are built this way, and at a much larger
scale: five complete apps with components, icons, gradients, shadows and photos. There,
`npm run examples` runs the build in a real browser, so text is measured with the real fonts.
It is the best reference for generating large documents.

---

## Checklist for generated files

- [ ] `format` is `"OfflineDesignDocument"` and `version` is `4`.
- [ ] There is exactly one `document` node, and `rootId` points to it.
- [ ] Every node has all the fields listed for its type, including a full `transform` and,
      for every type except `document` and `artboard`, a full `style`.
- [ ] Every id is unique and starts with a letter.
- [ ] Each child's `parentId` matches the container whose `children` lists it.
- [ ] Every `image` node's `assetId` matches an entry in `assets`.
- [ ] Every asset has either a `file` that exists in the ZIP or a `dataUrl`.
- [ ] In the ZIP form, `document.json` is at the root of the archive.
- [ ] Colours use 0–255 for `r`, `g` and `b`, and 0–1 for `a`.

The quickest check is to open the file in the app. If it opens with every layer where you
expect it, the file is valid. If a layer appears on the bare canvas instead of inside its
artboard, its `parentId` and its parent's `children` do not match.

# Working in this repository

## Git

**Commit directly to `main`.** Do not create a feature branch and do not ask
first — this is a single-maintainer project and `main` is where work lands.

**Always commit as:**

```
slaviboy <slavi94slavi94@gmail.com>
```

This is already set as the repository-local identity, so a plain `git commit`
uses it. Never fall back to the machine's global git identity: every commit in
this repository is `slaviboy`, and no other identity belongs in its history.

Verify with `git log -1 --format='%an <%ae>'` after committing if the identity
was ever in doubt.

Do not push unless asked.

## Commands

```bash
npm run dev        # http://localhost:5173
npm run typecheck  # tsc -b --noEmit
npm run lint
npm test           # Vitest — tests/unit
npm run test:e2e   # Playwright — tests/e2e
npm run build      # production build into dist/
```

**`npm run build` before `npm run test:e2e`.** The Playwright config serves the
prebuilt `dist/` via `npm run preview`, not the dev server, so without a rebuild
the e2e suite silently tests the *previous* build and reports failures that have
nothing to do with the working tree. `reuseExistingServer` also keeps a stale
preview alive between runs; `lsof -ti:4173 | xargs kill -9` clears it.

Adding an i18n key means adding it to all eight files in `src/i18n/locales/`.
`tests/unit/i18n.test.ts` asserts every catalogue has exactly the same key set,
so a key added only to `en.json` fails the suite. User-facing strings in
notifications are plain English rather than `t()` in several places already —
follow whatever the surrounding module does.

## Layout

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
  export/      export pipeline, rasterizer
  persistence/ .xdesign format, IndexedDB, file system, autosave
  ui/          top bar, toolbar, inspector, layers, dialogs
  shortcuts/   keyboard map
```

`README.md` is long and genuinely explains the design decisions behind the
model — read the relevant section before changing scene-graph, geometry or text
behaviour rather than inferring intent from the code alone.

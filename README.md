# Kaliwat

Open-source, **browser-only** family tree maker. Angular front end, no backend — your tree data and photos never leave the device unless you export them.

> **Status:** not scaffolded yet. The full build plan lives in [docs/family-tree-app-plan.md](docs/family-tree-app-plan.md) and is the source of truth for scope, data model, and milestone order.

## Features (planned)

- Build, view, and edit a family tree entirely in the browser.
- Import/export **GEDCOM 5.5.1** (`.ged`) and **GEDZIP** (`.gdz`, a zip bundling GEDCOM + photos).
- Round-trip photos attached to people and families.
- Multiple views: pedigree, descendants, hourglass/family.
- Local persistence (IndexedDB) so a refresh never loses work.
- Offline-capable PWA; self-hostable as static files.

## Stack

Angular (standalone components + signals) · `d3-hierarchy`/`d3-zoom` or `family-chart` for layout · SVG card rendering · `JSZip` for `.gdz` · Dexie/IndexedDB for the model and photo blobs · hand-rolled GEDCOM serializer.

## Architecture

The normalized TypeScript model is the single source of truth. GEDCOM and photos are I/O at the edges, never the runtime format.

```
.ged/.gdz → parse + unzip → Normalized model (signals) ⇄ IndexedDB (model + blobs)
                                    ↓                          ↑
                          Layout engine → SVG cards    serializer + zip → .ged/.gdz
```

## Develop

Once scaffolded (standard Angular CLI):

```bash
ng serve   # dev server
ng build   # production build
ng test    # unit tests
```

## License

[MIT](LICENSE) © Andrew Loable

# Browser-Only Family Tree Maker — Build Plan

An open-source, web-based family tree builder inspired by MyHeritage's tree views.
Pure browser stack, **no backend**, Angular front end, with GEDCOM import/export
**including attached photos**.

---

## 1. Goals and non-goals

### Goals
- Build, view, and edit a family tree entirely in the browser.
- Import and export **GEDCOM 5.5.1** (`.ged`) and **GEDZIP** (`.gdz`).
- Round-trip **photos** attached to people (and families), bundled in a single file via GEDZIP.
- Multiple tree views (pedigree, descendants, hourglass/family) like MyHeritage.
- Persist work locally so a refresh never loses data.
- **Work fully offline.** After first load the app must run with no network at all — view, edit, import, and export all function disconnected (PWA service worker caches the app shell; data and photos already live in IndexedDB).
- Ship as an open-source project anyone can self-host as static files.

### Non-goals (explicitly out of scope)
- No server, database, or auth. Everything runs client-side.
- No record/Smart matching, DNA, or AI features (those are MyHeritage's server-side products).
- No real-time multi-user collaboration (would require a backend).
- GEDCOM 7.0 full compliance is a **stretch goal**, not v1. (GEDZIP itself works with 5.5.1+.)

---

## 2. Constraints and operating model

- **Pure browser**: served as static files (GitHub Pages / any static host). No API calls required to function.
- **Offline-capable**: should work as a PWA after first load.
- **Privacy by default**: tree data and photos never leave the device unless the user explicitly exports.
- **GEDCOM as interchange only**: it is the import/export format, *not* the runtime model.

---

## 3. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | Angular (standalone components + signals) | No NgRx needed; a signal-based store is enough |
| Tree layout | `d3-hierarchy` + `d3-zoom`, or `family-chart` | `family-chart` is MIT and framework-agnostic; `d3-dag` for full DAG control |
| Rendering | SVG cards (HTML via `foreignObject`) | Canvas fallback only if node counts get huge |
| GEDCOM parse | A maintained parser library | e.g. a current `@treeviz/gedcom-parser` / `read-gedcom`-style lib |
| GEDCOM write | **Hand-rolled serializer** | Writing GEDCOM is simple; owning it guarantees lossless round-trip |
| Zip (GEDZIP) | `JSZip` | Read and write `.gdz` archives in-browser |
| Persistence | `IndexedDB` via `Dexie` | Stores the model **and** photo blobs |
| Export download | Blob + anchor, or File System Access API | Save `.ged` / `.gdz` to disk |
| Image handling | `createImageBitmap`, `<canvas>` | Generate thumbnails client-side |

> Decision to make early: **adopt a layout library vs. own the layout.** Prototype with
> `family-chart` (fast, MyHeritage-like, MIT). Drop to `d3-dag` only if it constrains card
> design or interaction.

---

## 4. Architecture

Single source of truth is the **normalized model**. GEDCOM and photos are I/O at the edges.

```
            ┌──────────────────────┐
  .ged /    │  Import / new tree   │
  .gdz  ──▶ │  (file or blank)     │
            └──────────┬───────────┘
                       ▼
            ┌──────────────────────┐
            │   GEDCOM parser      │  flat records ─▶ objects
            │   + GEDZIP unpacker  │  (JSZip extracts media)
            └──────────┬───────────┘
                       ▼
   ┌──────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
   │  IndexedDB   │◀▶│   Normalized model   │─▶│   GEDCOM serializer  │─▶ .ged / .gdz
   │  (Dexie):    │  │   single source of   │  │   + GEDZIP packer     │   download
   │  model +     │  │   truth (signals)    │  │   (JSZip bundles      │
   │  photo blobs │  └──────────┬───────────┘  │    media)             │
   └──────────────┘             ▼              └──────────────────────┘
                     ┌──────────────────────┐
                     │    Layout engine     │  pedigree / descendants /
                     │                      │  hourglass / fan
                     └──────────┬───────────┘
                                ▼
                     ┌──────────────────────┐
                     │   SVG card render    │  pan · zoom · collapse · edit panel
                     └──────────────────────┘
```

Editing always mutates the model; views re-derive from it. Photos live as **blobs in
IndexedDB**, referenced by id from the model — never base64 in the model itself (keeps it light).

---

## 5. Data model

Keep GEDCOM out of the runtime. Normalize into plain TypeScript.

```ts
type Sex = 'M' | 'F' | 'X' | 'U';

interface PersonName {
  given?: string;
  surname?: string;
  display: string;        // full reconstructed name
}

interface LifeEvent {
  type: 'BIRT' | 'DEAT' | 'MARR' | 'DIV' | string;
  date?: string;          // keep raw GEDCOM date string + a parsed form
  parsedDate?: { year?: number; month?: number; day?: number; approx?: boolean };
  place?: string;
}

interface Individual {
  id: string;             // @I1@
  names: PersonName[];
  sex?: Sex;
  events: LifeEvent[];
  famc: string[];         // families where this person is a child  (GEDCOM FAMC)
  fams: string[];         // families where this person is a spouse (GEDCOM FAMS)
  mediaIds: string[];     // -> MediaObject.id
  primaryMediaId?: string;// the avatar shown on the card (GEDCOM _PRIM)
  notes: string[];
  raw?: GedcomNode;       // preserved original subtree for lossless export
}

interface Family {
  id: string;             // @F1@
  husbandId?: string;
  wifeId?: string;
  childIds: string[];
  events: LifeEvent[];    // MARR, DIV, ...
  mediaIds: string[];
  raw?: GedcomNode;
}

interface MediaObject {
  id: string;             // @M1@ (OBJE record)
  form?: string;          // 'jpg' | 'png' | 'gif' | ...
  title?: string;
  isPrimary?: boolean;    // _PRIM Y
  blobKey?: string;       // IndexedDB key for the full image blob
  thumbKey?: string;      // IndexedDB key for a generated thumbnail
  originalPath?: string;  // the FILE value as found in the source GEDCOM
  width?: number;
  height?: number;
}

interface TreeModel {
  individuals: Map<string, Individual>;
  families: Map<string, Family>;
  media: Map<string, MediaObject>;
  header: GedcomNode;     // preserve HEAD for round-trip fidelity
}
```

**Lossless principle:** keep the original parsed node (`raw`) for every record and merge
edits back into it on export, rather than regenerating from scratch. This preserves custom
tags, sources, and notes other software wrote — a real differentiator over toy projects.

---

## 6. GEDCOM import (with photos)

### 6.1 Plain `.ged`
1. Read text, detect encoding (UTF-8 vs legacy ANSEL — detect and warn if ANSEL).
2. Parse into the node tree, then normalize into `individuals` / `families` / `media`.
3. For each `OBJE` record, capture `FILE`, `FORM`, `TITL`, and `_PRIM`.
4. `FILE` values in a standalone `.ged` are **absolute/relative paths from the origin machine**
   and are almost always unresolvable in the browser → create the `MediaObject` as a
   **placeholder** with `originalPath` set, no blob. Prompt the user to attach the image later.

How photos attach in GEDCOM (linked form — the only form since 5.5.1):

```
0 @M1@ OBJE
1 FILE media/grandpa_jones.jpg
2 FORM jpg
1 TITL Grandpa Jones, 1948

0 @I1@ INDI
1 NAME Grandpa /Jones/
1 OBJE @M1@
2 _PRIM Y          (custom tag: this is the primary/cover photo)
```

(Some files inline `OBJE` under the person instead of using a top-level `@M1@` record —
support both shapes on import.)

### 6.2 GEDZIP `.gdz` (the photo-complete path)
1. Open the archive with `JSZip`.
2. Read the GEDCOM text entry (per the GEDZIP spec the GEDCOM file is at the archive root,
   conventionally `gedcom.ged` — **TODO: confirm exact naming/path rules against the GEDZIP
   spec at gedcom.io**).
3. Parse GEDCOM as above.
4. For each `OBJE` `FILE` path, **resolve it against the zip entries**. The referenced media
   files are stored in the archive at paths matching their `FILE` values.
5. Load each matched image as a `Blob`, write it to IndexedDB, and set `blobKey` on the
   `MediaObject`. Generate a thumbnail (`thumbKey`).

This is how photos arrive intact from other modern genealogy apps.

---

## 7. GEDCOM export (with photos)

Offer the user three multimedia modes (mirrors mainstream tools):

| Mode | Output | Photos |
|---|---|---|
| **GEDZIP** (recommended) | `.gdz` | Bundled in-archive — single portable file |
| Plain GEDCOM + folder | `.ged` + image files in a zip | Links + copied files |
| GEDCOM only (placeholders) | `.ged` | Links only, no image data |

### 7.1 Serialize the model to GEDCOM text
- Walk `header`, then each `Individual`, `Family`, and `MediaObject`.
- Emit `OBJE` records with `FILE`, `FORM`, `TITL`, and `_PRIM Y` for the primary photo.
- For GEDZIP, set each `FILE` to a **relative path inside the archive** (e.g.
  `media/<id>.<ext>`), not the original machine path.
- Merge preserved `raw` subtrees so unknown/custom tags survive the round-trip.

### 7.2 Build the GEDZIP archive (JSZip)
```
tree.gdz  (zip)
├── gedcom.ged                 ← GEDCOM text; FILE paths are relative, e.g. media/M1.jpg
└── media/
    ├── M1.jpg                 ← blob pulled from IndexedDB
    ├── M2.png
    └── ...
```
Steps:
1. Generate GEDCOM text with relative `FILE` paths.
2. For each `MediaObject` with a `blobKey`, read the blob from IndexedDB and add it to the
   zip at the matching path.
3. `zip.generateAsync({ type: 'blob' })` → trigger download as `.gdz`.

> Edge cases to handle: filename collisions (namespace by media id), very large trees
> (stream/await so the UI stays responsive), and missing blobs (fall back to placeholder link).

---

## 8. Photo handling specifics

- **Storage**: full-resolution image blobs in IndexedDB (`Dexie` table `mediaBlobs`), keyed by
  `blobKey`. Thumbnails in a second table. Never store images in the model object or in
  component state.
- **Adding a photo**: user drops/selects a file → store blob → create `MediaObject` → link to
  person → optionally mark primary (`isPrimary`, maps to `_PRIM Y`).
- **Primary photo** drives the card avatar and chart thumbnails (MyHeritage shows a face on
  each card).
- **Thumbnails**: generate on import/add via `createImageBitmap` + `<canvas>` to keep the SVG
  render fast and memory reasonable.
- **Display**: card avatars use object URLs (`URL.createObjectURL`) created lazily and revoked
  when off-screen.

---

## 9. Layout and rendering (the hard part)

Scope each view deliberately; difficulty rises left to right.

| View | Structure | Approach |
|---|---|---|
| **Pedigree** (ancestors only) | Binary tree | `d3.hierarchy` + `d3.tree()` — build first |
| **Descendants** | Tree | Same, inverted |
| **Hourglass / Family** (all relatives, marriages) | **DAG** | Union-node trick, or `d3-dag` / `family-chart` |
| **List** | Flat | Sortable/filterable table; cheap and useful early |
| **Fan** (stretch) | Radial | Polar layout of the pedigree |

**Union-node trick** (for the DAG views): insert an invisible node per marriage so edges become
`person → union → child`. This restores enough tree structure to lay out remarriages and joined
branches. It's what mature libraries do internally.

**Interaction parity with MyHeritage:**
- Pan/zoom (`d3-zoom`), home/recenter, full-screen.
- **Collapse large trees**: hide branches past a threshold (MyHeritage hides past ~50 people);
  expand on click of a branch handle.
- Generations slider, person search box, jump-to-person.

**Performance**: SVG is fine to ~1–2k cards. Beyond that, virtualize off-screen cards or move
the hot path to Canvas. Branch collapsing sidesteps most of this.

---

## 10. Persistence

- **Autosave** the whole model to IndexedDB (debounced) on every edit.
- **Photo blobs** in their own IndexedDB tables (see §8).
- **Multiple trees**: a `trees` table keyed by tree id; a lightweight switcher in the UI.
- **PWA**: service worker caches the app shell for offline use.
- **Reset/clear** action so users can wipe local data.

---

## 11. UI / UX feature list

- Onboarding: "start with yourself," then add relatives (MyHeritage's first-run flow).
- Person card: avatar (primary photo), name, birth–death, quick actions (add parent/spouse/child).
- Edit panel: names, sex, events (dates/places), notes, photo gallery, set-primary.
- Add/link relationships with validation (no self-parenting, no cycles in ancestry).
- View switcher (pedigree / descendants / hourglass / list / fan).
- Import dialog (`.ged` / `.gdz`) with progress + post-import photo-resolution prompt.
- Export dialog with multimedia mode choice (§7).
- Search, generations slider, zoom controls.

---

## 12. Milestones / build order

**M1 — Foundations**
- Angular scaffold, signal-based model store, IndexedDB (Dexie) wiring.
- Parse a `.ged` → populate store → render a **List view** (cheapest proof parsing works).

**M2 — First chart**
- Pedigree SVG view with `d3-hierarchy` + `d3-zoom`.
- Card component with avatar placeholder.

**M3 — Round-trip data**
- Hand-rolled GEDCOM serializer (no photos yet) → export `.ged`.
- Lossless round-trip test: import → export → diff.

**M4 — Photos**
- Photo storage in IndexedDB, add/link/set-primary, thumbnails.
- GEDZIP import (JSZip unpack + resolve `FILE` → blobs).
- GEDZIP export (bundle model + media into `.gdz`).

**M5 — Editing**
- Add/edit people and relationships; events; notes.

**M6 — Big views**
- Hourglass/family DAG view (`family-chart` or `d3-dag` + union trick).
- Branch collapsing, generations slider, search.

**M7 — Polish**
- PWA/offline, multiple trees, fan view (stretch), GEDCOM 7.0 read support (stretch).

---

## 13. Risks and gotchas

- **ANSEL encoding** in legacy files — many parsers don't handle it. Detect and warn; treat as
  stretch to fully support.
- **5.5.1 vs 7.0** — most real-world files are 5.5.1. Baseline on 5.5.1; treat 7.0 as additive.
- **GEDZIP path/naming rules** — confirm the exact archive layout against the official GEDZIP
  spec before finalizing the packer/unpacker.
- **Lossy export** — if you only model what you render, you silently drop other apps' data.
  Preserve `raw` and merge.
- **DAG layout** — don't force marriages through `d3.tree`; use union nodes.
- **Memory** — large trees with many full-res photos; rely on thumbnails + lazy object URLs.
- **Custom tags** — `_PRIM`, `_PRIMARY`, `_TYPE PHOTO` vary by vendor; normalize on import.

---

## 14. Testing

- **Unit**: parser, serializer, normalizer, union-node layout helper.
- **Round-trip fixtures**: a corpus of real `.ged` / `.gdz` files (incl. photos); assert
  import→export→import stability.
- **Encoding fixtures**: UTF-8 and ANSEL samples.
- **Visual/interaction**: snapshot the SVG for known trees; test zoom/collapse.
- **Large-tree perf**: a synthetic 5k-person tree for layout/render budgets.

---

## 15. Open-source setup

- **License**: MIT (matches the ecosystem libraries you'll lean on).
- **Repo layout** (suggested):
  ```
  /src/app
    /core        model store, services
    /gedcom      parser adapter, serializer, gedzip packer/unpacker
    /media       photo storage, thumbnails
    /layout      hierarchy + dag layout engines
    /views       pedigree, descendants, hourglass, list, fan
    /ui          cards, edit panel, dialogs, controls
  /public        PWA assets
  /test/fixtures sample .ged / .gdz files
  ```
- **Docs**: a clear README (live demo link, "try your own GEDCOM" upload), CONTRIBUTING,
  and a short architecture note pointing at this plan.
- **CI**: lint + unit + round-trip tests on PRs; deploy demo to static hosting on merge.

---

## Appendix A — Key GEDCOM facts driving this design

- GEDCOM is plain text: `INDI` (people) and `FAM` (families) records linked by `@id@` pointers;
  families are the only source of parent/child links.
- Multimedia uses `OBJE` records: **linked form only** since 5.5.1 (embedded image BLOBs were
  dropped). So a bare `.ged` carries *links*, not pixels.
- **GEDZIP** (`.gdz`) is a companion spec that bundles the GEDCOM text plus referenced media
  into one zip — the standard way to move photos with a tree in a single file. Works with
  5.5.1+ and is the default multimedia path in GEDCOM 7.0.
- `_PRIM` is a widely used custom tag marking the primary/cover photo used on charts.

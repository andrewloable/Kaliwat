# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git

Never commit or push automatically. Only commit or push when the user explicitly asks.

## Status

**Not scaffolded yet.** The repo currently contains only `docs/family-tree-app-plan.md` — the full build plan. Read it before starting; it is the source of truth for scope, data model, and milestone order. This file summarizes the architecture so you don't have to re-derive it each session.

## What this is

Kaliwat is an open-source, **browser-only** family tree maker (MyHeritage-style views), Angular front end, **no backend**. It imports/exports GEDCOM 5.5.1 `.ged` and GEDZIP `.gdz` (zip bundling GEDCOM + photos). Everything runs client-side; tree data and photos never leave the device unless the user exports.

## Planned stack

Angular (standalone components + **signals**, no NgRx) · `d3-hierarchy`/`d3-zoom` or `family-chart` (MIT) for layout · SVG card rendering · `JSZip` for `.gdz` · **Dexie/IndexedDB** for the model and photo blobs · hand-rolled GEDCOM serializer (lib for parsing).

When scaffolding, expect standard Angular CLI: `ng serve` (dev), `ng build`, `ng test`. Confirm against `package.json` once it exists rather than assuming.

## Architecture — the one thing to internalize

**The normalized TypeScript model is the single source of truth. GEDCOM and photos are I/O at the edges, never the runtime format.**

```
.ged/.gdz → parse + unzip → Normalized model (signals) ⇄ IndexedDB (model + blobs)
                                      ↓                          ↑
                            Layout engine → SVG cards    serializer + zip → .ged/.gdz
```

- Editing **always mutates the model**; all views re-derive from it.
- Photos are **blobs in IndexedDB**, referenced by id from the model — never base64 in the model, never images in component state.
- Model shapes: `Individual`, `Family` (the only source of parent/child links, via GEDCOM), `MediaObject`, `TreeModel`. See plan §5 for fields.

## Two principles that are easy to violate

1. **Lossless round-trip.** Keep each record's original parsed subtree (`raw`) and merge edits back into it on export — don't regenerate from scratch. This preserves custom tags / sources / notes other genealogy apps wrote. Dropping them silently is the main failure mode (plan §13).
2. **Union nodes for DAG views.** Don't force marriages through `d3.tree`. Insert an invisible node per marriage so edges become `person → union → child`. Pedigree/descendants are plain trees; hourglass/family are DAGs (plan §9).

## Build order (plan §12)

List view first (cheapest proof parsing works) → pedigree SVG → GEDCOM serializer + round-trip diff test → photos + GEDZIP → editing → DAG/hourglass view → PWA polish. Don't jump ahead; each milestone de-risks the next.

## Suggested source layout (plan §15)

`src/app/{core,gedcom,media,layout,views,ui}` — model/services, parser+serializer+gedzip, photo storage, layout engines, view components, UI. `test/fixtures` holds real `.ged`/`.gdz` samples.

## Testing focus

Unit-test the parser, serializer, normalizer, and union-node helper. The key integration test is **import → export → import stability** against a corpus of real GEDCOM files (including ones with photos and ANSEL/UTF-8 encodings).


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:7510c1e2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->

# Kaliwat — Design System

Established 2026-06-29 via /plan-design-review (Claude-authored mockups, no external design tool).
Reference mockups: `~/.gstack/projects/andrewloable-Kaliwat/designs/landing-import-20260629/` —
`landing-claude`, `list-claude`, `tree-claude` (`.html` + `.png`).

## Direction

**Heritage, not SaaS.** This is a tool about ancestors, memory, and trust. It should feel
like a well-made archival object — warm paper, ink, restraint — not a product dashboard.
The privacy promise ("your family data never leaves this device") is a *felt* part of the
look, not a banner.

## Color tokens (CSS variables)

```css
:root{
  --paper:   #f4efe6;  /* app background — warm paper */
  --paper-2: #ece4d6;  /* recessed surfaces (drop zone, active tab) */
  --card:    #faf6ee;  /* raised surface (search field, person card, hover row) */
  --ink:     #2b2420;  /* primary text — deep ink */
  --ink-soft:#6b5f54;  /* secondary text, metadata */
  --accent:  #9c5a3c;  /* the single restrained accent — terracotta */
  --line:    #d8cdba;  /* hairlines, borders */
  --focus:   #1d4e6b;  /* high-contrast focus ring (NOT the accent) */
}
```

One accent only. No second accent, no purple/indigo, no gradients. Contrast: ink on paper
and ink-soft on paper both exceed 4.5:1; accent `#9c5a3c` on white is the button/ link color.

## Typography

- **Display / names:** serif stack `"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif`.
  Used for the wordmark, headlines, and every **person name** (names are the content; they get the serif).
- **UI / body:** sans stack `"Avenir Next","Segoe UI",Helvetica,Arial,sans-serif`.
- Body text ≥ 17px. Never below 16px. Numerals in date columns use `font-variant-numeric: tabular-nums`.
- **No Inter, Roboto, or bare `system-ui` as the primary face** — the serif/sans pairing is the identity.
  (Self-hosted webfonts may replace these stacks later, but must stay first-party — see privacy.)

## Spacing & density

- Generous whitespace; one strong anchor per screen.
- List rows: 12–14px vertical padding, separated by `--line` hairlines — **not** cards.
- Radius: 8–10px on interactive surfaces; avoid uniform bubbly radius on everything.

## Components

- **Top bar:** wordmark (serif) left · global search (magnifier + field) · List/Tree view tabs ·
  Import button (accent). Persistent on every in-app screen.
- **Drop zone (landing/empty state):** the single dominant action. Dashed `--line` border on
  `--paper-2`, a serif prompt, an accent "Choose a file" button (≥48px), accepted formats line,
  a "try a sample tree" text link, and a quiet privacy reassurance with a lock glyph.
- **List row:** leading 42px circular avatar (photo, or serif initials on `--paper-2` placeholder);
  primary = name (serif, ~19px); secondary = relationship/lifespan hint (`--ink-soft`, 14px);
  trailing = birth–death years, right-aligned, tabular.
- **Person card (tree):** 194×86 `--card` with hairline border; avatar + serif name + small years.
  Focus person gets an accent border + ring. **Union node:** small accent-ringed dot (⚭) between
  spouses, labeled with the marriage year; edges run person → union → child (never spouse → child directly).
- **Multiple spouses / remarriage:** one union node *per marriage*. The focus person sits on the
  spouse row with a union node between them and each spouse (`spouseA — ⚭ — FOCUS — ⚭ — spouseB`);
  each union's children hang from that union node only, so half-siblings stay visually separated.
  This is why the data model uses explicit link entities and a person references N unions — never a
  single `spouseId`. Spouse roles are NOT gender-fixed (no husband-left/wife-right assumption).
  Shared-child / step-relationships and ex-spouses use the same union node with status on the link.
  See mockup `tree-multi-claude` for the two-marriage layout.
- **Partial-import notice:** inline band (`#f3ead8`), states counts ("imported X of Y · Z skipped")
  with a "view report" link. Not a toast — it persists until dismissed.

## Motion

- Minimal and purposeful. Honor `prefers-reduced-motion`. Candidate motions: a gentle entrance on
  the import "reveal" (records appearing), hover row tint, tree pan/zoom easing. No decorative motion.

## Accessibility (baseline, non-negotiable)

- The **List view is the accessible alternative** to the SVG tree — full keyboard nav of rows and cards.
- ARIA landmarks (banner / nav / main). Visible `:focus-visible` ring in `--focus` (3px, offset).
- Touch targets ≥ 44px. Body ≥ 16px. Text contrast ≥ 4.5:1.
- Tabs use `role="tab"`/`aria-selected`; search input has a visible-or-`aria-label`.

## Anti-slop rules (what this is NOT)

No 3-column feature grid. No icons-in-colored-circles. No centered-everything. No purple/indigo
gradient. No emoji as UI. No card mosaic where a list or layout belongs. No `border-left: 3px accent`
cards. No generic "Welcome to / Unlock the power of" copy. Cards earn their existence — the list is
hairline rows; cards appear only in the tree where the card IS the node.

## Privacy as a visual property

Self-host all fonts/icons/assets — zero third-party runtime requests (this is enforced by CSP +
a zero-egress test per the eng review). The design must never introduce a remote asset.

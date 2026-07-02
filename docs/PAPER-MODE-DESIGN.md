# Paper Mode — "Journal on a Desk" Design Notes

The skeuomorphic Paper Mode: a Leuchtturm-style dot journal lying open on a
wooden desk in afternoon sun. This document covers the deliverables that
aren't code: structure notes, assets, fonts, and regular-mode suggestions.

## Where things live

| Piece | Location |
|---|---|
| Complete annotated stylesheet | `app/paper-mode.css` (every rule scoped under `.paper-journal`) |
| Scene components (markup + interactions) | `app/page.js` — `JournalView`, `JournalEntry`, `JournalSubList`, `JournalSurfacedEntry`, `JournalRule`, `DeskPen`, `WindowLight`, coffee ring markup inside `JournalView` |
| Stylesheet import | `app/layout.js` |

There is no separate JavaScript file: all easter eggs are pure CSS
(`:hover` + transitions/keyframes), which was the brief's preference. The
"JS deliverable" is the React components listed above, since this app renders
through React rather than static HTML.

## HTML structure (before → after)

Regular mode renders the task list as cards inside the scroll container:

```jsx
// BEFORE (regular mode — unchanged)
<div className="main-scroll">
  <div className="quick-add-card"><input id="quick-add" …/></div>
  <div role="list">
    <TaskRow …/>   // checkbox button, chips, drag handles
  </div>
</div>
```

Paper Mode swaps in the scene (an early `if (paperUI) return …` inside the
same render switch — regular mode's JSX is untouched):

```jsx
// AFTER (paper mode only)
<div className="main-scroll">          // desk surface (wood shows through)
  <div className="journal-desk">       // positioning context
    <div className="journal-page">     // ivory page, dot grid, page-edge ::before/::after
      <div className="journal-datehead"><h2>Today</h2><span>…date…</span></div>
      <svg className="journal-rule"/>  // hand-drawn squiggle divider
      <div className="journal-jot">• <input id="quick-add"/></div>   // writing-line quick add
      <section>                        // one per list = journal "collection"
        <div className="journal-cat">Work</div><svg className="journal-rule"/>
        <div className="journal-entry">
          <button className="journal-mark">•</button>   // the mark IS the toggle
          <span className="journal-text">Prepare review</span>
          <span className="journal-due">— due mon 7th</span>
          <span className="journal-snooze">…</span>      // faint › on hover
        </div>
        <div className="journal-note">− note line</div>
        …nested subtasks, always expanded, indented…
      </section>
      <div className="coffee-ring"><span className="steam"/>×3</div>
    </div>
    <div className="desk-pen"><span className="pen-inkblot"/><svg…/></div>
  </div>
</div>
<div className="window-light"/>        // fixed, whole-viewport sun-pane shadow
```

Key conventions honored: `•` open / `×` done / `◦` `–` nested / `−` notes;
no checkboxes, chips, or pills inside the page; hand-drawn strikethrough
(tilted pseudo-element) on completed entries; unlimited nesting always
visible; due dates as inline lighter handwriting.

## Asset list

Everything is generated — **zero network-loaded textures**:

| Asset | How it's made |
|---|---|
| Wood desk texture | Inline SVG `feTurbulence` grain + repeating-gradient plank seams + base gradient, in `--paper-noise` (data URI in `paper-mode.css`) |
| Dot grid | `radial-gradient` on `.journal-page`, 19px pitch |
| Page depth / stacked sheets | Layered `box-shadow` + two `::before`/`::after` sheet edges |
| Hand-drawn dividers | Inline `<svg>` squiggle path (`JournalRule`) |
| Fountain pen | Inline `<svg>` (`DeskPen`) — bordeaux barrel, brass nib/bands |
| Coffee ring | Two offset ring `radial-gradient`s, `mix-blend-mode: multiply` |
| Steam wisps | Three blurred gradient `<span>`s, keyframe rise on hover |
| Window-pane sun shadow | Two perpendicular repeating gradients, static blur, multiply blend, transform-only sway |

Performance notes: blurs are static (never animated); all animation is
transform/opacity; the desk uses `background-attachment: fixed` on desktop
and falls back to `scroll` on touch devices; `prefers-reduced-motion` is
respected via the existing global clamp.

## Easter eggs (discovered, unlabeled)

- **Pen** — hover rolls it ~4° as if nudged; a small ink blot blooms beside the nib
- **Coffee ring** — hover darkens it (fresh mug) and three steam wisps rise
- **Window shadow** — sways imperceptibly on a 30s loop, like branches moving outside (implemented as ambient motion rather than hover, since the layer must stay `pointer-events: none` to never block the page)

## Font recommendation

- **Primary (page content): Caveat 500/700** — the most authentic "neat
  personal handwriting" of the candidates; real letterform variation without
  becoming hard to read at task-list sizes.
- **Chrome (header/sidebar): Kalam** — Caveat's x-height is too small for
  12–14px UI labels; Kalam holds up there while staying handwritten.
- Fallback chain: `'Caveat', 'Kalam', 'Quicksand', cursive`.

```css
@import url('https://fonts.googleapis.com/css2?family=Caveat:wght@500;600;700&family=Kalam:wght@300;400;700&display=swap');
```
(Already loaded in `globals.css`; both are OFL-licensed and self-hostable
via google-webfonts-helper if we ever drop the CDN.)

Considered and rejected: Indie Flower (too round/childlike), Patrick Hand
(too uniform — reads as a font, not a hand).

## Regular Mode cleanup suggestions (NOT implemented)

Carried over from `docs/UI-AUDIT.md` plus new observations — all regular-mode
only, none touched by this change:

1. **Delete the stale `inkwell/` duplicate directory** — a full old copy of
   the app that invites edits landing in the wrong file.
2. **Modal focus traps** — `Overlay` closes on Esc but Tab can walk behind
   the dialog; focus isn't restored to the trigger on close.
3. **Mobile rename affordance** — list/task rename relies on double-click,
   which has no touch equivalent.
4. **Detail panel on mobile** — full-screen with a top-right close button;
   a bottom-sheet with swipe-to-dismiss would fit thumbs better.
5. **Quick-add date context** — adding a task while in Upcoming still
   defaults to today; defaulting to the view's context would surprise less.
6. **Kanban column header contrast** — date-column labels use `--muted` on
   `--surface`, which sits right at the AA threshold in dark mode.
7. **`Delete` key with a single ⌘-selected task** deletes without
   confirmation (undo toast exists, but a 1-item selection is easy to make
   accidentally).

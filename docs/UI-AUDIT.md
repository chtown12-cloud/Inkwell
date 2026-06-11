# Inkwell UI Audit — June 2026

Scope: full pass over `app/page.js`, `app/components/Enhancements.js`, `app/globals.css`,
and the scan flow (`app/api/scan/route.js`), focused on: correctness of interactive
elements ("buttons work when they need to"), touch/keyboard ergonomics, feedback &
reversibility, and alignment with the app's new notebook-first direction.

Legend: ✅ fixed in this branch · 📝 recommended follow-up · 👍 already good

---

## 1. Correctness bugs

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1.1 | **`SubtaskTree` violated the Rules of Hooks** — a `useEffect` sat *below* a conditional `return null`. When a task's subtask list changed between empty and non-empty, React's hook order changed across renders, which throws ("Rendered more/fewer hooks than during the previous render") and can crash the detail panel. | High | ✅ Hook moved above the early return |
| 1.2 | **Drag "nest" indicator misplaced** — `transform: translateY(-50)` (missing `%`) in `TaskRow`, so the "↳ nest" hint wasn't vertically centred. | Low | ✅ |
| 1.3 | **Command palette → "Search tasks" focused a non-existent element** — it targeted `#task-search`, but the header search input had no id. (It still worked by accident via `autoFocus`.) | Low | ✅ id added |
| 1.4 | **Deleting a task from the detail panel was silent and irreversible** — the trash icon deleted instantly with no confirmation, no toast, no undo, while every *other* destructive path (bulk delete, drag-to-trash) has a 5-second undo. Inconsistent and dangerous next to ⌘Z history that users may not know about. | High | ✅ Now shows the same undo toast |
| 1.5 | **Oversized photos could fail the scan** — phone cameras produce 8–20 MB images; these were sent raw to the vision API (5 MB limit) and could 4xx after a long upload. | Medium | ✅ Client-side downscale to 1600 px JPEG before upload |

## 2. Touch & mobile ergonomics

| # | Finding | Status |
|---|---------|--------|
| 2.1 | **Checkbox touch targets were 15–20 px** — well under the 44 px Apple HIG / 24 px WCAG 2.5.8 minimum, on the single most-tapped control in the app. | ✅ Invisible hit-slop (`.cb-hit::after`, +9 px each side) without changing the visual size |
| 2.2 | **Bulk action bar overflowed on narrow phones** — fixed-position bar with 6 controls and `white-space: nowrap` could exceed the viewport. | ✅ Wraps and caps at `100vw - 24px` |
| 2.3 | Long-press drag system (400 ms hold, scroll-assist, edge auto-scroll, haptic pulse) is genuinely well engineered — touch-action handling, native-drag suppression on Chrome Android, and circular-nesting promotion are all handled. | 👍 |
| 2.4 | 📝 `EditableText` rename relies on **double-click**, which has no reliable mobile equivalent (list/task rename works via context menu on desktop only). Consider a rename entry in the mobile long-press context, or an edit icon in the detail panel header. | Open |
| 2.5 | 📝 The detail panel on mobile covers the full screen with no swipe-to-dismiss; the close button is top-right (far from the thumb). Consider a bottom-sheet presentation or swipe-down dismiss. | Open |

## 3. Keyboard & accessibility

| # | Finding | Status |
|---|---------|--------|
| 3.1 | **Esc didn't close all modals** — the global Esc handler covered search/detail/shortcuts/help, but Settings, the photo modal, and scan results ignored Esc. | ✅ `Overlay` now closes on Esc, covering every modal built on it |
| 3.2 | Focus-visible rings, skip-link, `prefers-reduced-motion`, dyslexic-font toggle, and text-size scale are all present. | 👍 |
| 3.3 | Checkboxes expose `role="checkbox"` + `aria-checked`; nav landmarks (`nav`, `main`, `role="dialog"`, `aria-modal`) are in place; toasts use `role="status" aria-live="polite"`. | 👍 |
| 3.4 | 📝 Modals don't trap focus (Tab can escape behind the overlay) and focus isn't restored to the trigger on close. Worth adding a small focus-trap to `Overlay`. | Open |
| 3.5 | 📝 `Delete`/`Backspace` deletes a multi-selection without confirmation. It has an undo toast, which is acceptable, but consider requiring ≥2 selected (it already does: `selectedIds.size>0` — actually fires for a single ⌘-clicked task too). | Open |
| 3.6 | New snooze menu: `aria-haspopup`, `role="menu"/"menuitem"`, Esc closes the date picker. | ✅ (shipped with feature) |

## 4. Feedback & interaction quality

| # | Finding | Status |
|---|---------|--------|
| 4.1 | Every mutating action flashes a toast; drag operations show ghost pills, drop-zone outlines, and zone indicators (before/nest/after). Undo toasts on the risky paths. | 👍 |
| 4.2 | **Rescheduling required drag precision or the date picker** — pushing a task out by a week/month meant either a careful drag onto a fan-out zone or opening a native date picker. This was the #1 "sticky" interaction. | ✅ One-tap **Snooze** menu (tomorrow / week / 2 weeks / month / 3 months / pick date) on every open task row |
| 4.3 | **Engagement mechanics worked against the product's stated purpose** (record for handwritten notes): completion-streak confetti rewarded rapid in-app completion; kanban defaults invited board-tending. | ✅ Paper Mode suppresses confetti, forces list view, and pins the app to Today |
| 4.4 | 📝 Quick-add input defaults new tasks to *today* even in Upcoming view — slightly surprising; consider defaulting to the view's context. | Open |
| 4.5 | 📝 The `inkwell/` subdirectory is a stale full copy of an older app version (3.5k lines + its own package.json). It's dead weight in the repo and a trap for edits landing in the wrong file. Recommend deleting it in a follow-up. | Open |

## 5. Paper Mode design notes (new)

The anti-stickiness changes follow one inversion: **paper is the workspace, the app is
the record.** Concretely:

- **Today is the whole app** in Paper Mode; other views/lists/boards hide behind an
  explicit, session-scoped "Weekly review" (never persisted, so the app always
  reopens pinned to Today).
- **Sanctioned verbs**: scan, check off, snooze. The command palette is filtered to
  match.
- **Carry-forward** replaces the Overdue view: unfinished tasks roll onto Today with a
  "↻ carried Nd" badge — the honest signal of BuJo re-writing without the rewriting.
- **Snooze** is the one job paper can't do (time travel). Tasks return with an
  "↩ resurfaced" badge so the morning copy-to-notebook step is obvious.
- **Defer-from-the-page**: the scanner now parses `>1w / >1m / >Fri / >Mar 3` and `*`
  priority signifiers, so rescheduling decisions can be made with a pen.
- **A five-minute session nudge** gently points the user back to the notebook.

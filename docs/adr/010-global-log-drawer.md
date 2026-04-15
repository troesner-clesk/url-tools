# ADR 010: Global log drawer instead of per-tab log blocks

**Status:** Accepted

## Context

Each tab component (Scraper, SEO Audit, Screenshots, Images, Sitemap, Link Checker, Silo) previously rendered its own inline `<div class="log-container">` under the controls, plus its own progress bar and current-URL indicator. Three problems followed from this:

- Log output is the narrow left rail, so long lines wrap and history quickly becomes unreadable.
- Every tab duplicated ~20 lines of template and CSS; they all called a per-instance `useLogger()` whose state vanished on unmount.
- Users couldn't glance at logs without scrolling past controls; on the Silo tab the log was practically invisible below a long settings panel.

## Decision

Replace the per-tab log blocks with a single global drawer pinned to the right edge of the viewport, driven by a module-level reactive store.

- **Store**: `app/composables/useLogStore.ts` holds per-tab logs, progress, current-URL, and a running flag in a `Record<TabId, …>`. `useTabLogger(tabId)` returns a bound `addLog / clearLogs / setProgress / setCurrentUrl / setRunning` API; tabs never touch other tabs' state.
- **Drawer**: `app/components/LogDrawer.vue` — fixed-position, resizable (drag handle on the left edge, 240–800 px), collapsible (vertical label handle with pulse indicator when any tab is running). Renders only the **active** tab's logs/progress/current-URL. Width and open/closed state persist in `localStorage`.
- **Active tab wiring**: `app/pages/index.vue`'s existing `switchTab` + `confirmTabSwitch` now also calls `setActiveTab()`; tab components don't need to know the drawer exists.

## Alternatives considered

- **Keep per-tab blocks, just widen them** — doesn't solve visibility on long settings panels, and doesn't dedupe code.
- **Unified cross-tab log stream with badges** — initial plan, rejected because users typically focus on one tool at a time; parallel streams add noise without clear benefit.
- **Pinia store** — overkill for this; module-level `reactive()` refs match the existing pattern (`useTheme`, `useLogger`).

## Consequences

- 7 tab components slimmed: each lost ~40 lines of template/CSS and a local `useLogger()` instance.
- Old `app/composables/useLogger.ts` deleted.
- Logs now survive tab switches — you can start a Silo crawl, flip to Sitemap, and come back to see the full history.
- Drawer overlays content at `z-index: 90`; main grid unchanged. If overlay feedback is ever negative, the sidebar can be made layout-aware by adding `padding-right: var(--drawer-width)` to `main` when open. Not yet needed.
- Resize implemented manually (no d3-drag dependency) — ~40 LOC.

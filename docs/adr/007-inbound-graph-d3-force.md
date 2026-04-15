# ADR 007: d3-force for the Silo graph view

**Status:** Accepted

## Context

The Inbound Link Analyzer needs an Obsidian-style force-directed graph showing how source pages link to target URLs. The project is Nuxt 4 / Vue 3 and ships a single client bundle; localhost-only but we still want a snappy UI. Typical graph sizes are sub-1000 edges.

## Decision

Use `d3-force` (~15 KB) combined with a custom SVG template driven by Vue reactivity, rather than a full-featured graph library.

## Alternatives considered

- **vis-network** (~600 KB, canvas). Too heavy, imperative API fights Vue reactivity.
- **cytoscape** (~400 KB). Overkill — we don't need pluggable layout algorithms.
- **sigma.js** (WebGL). Unnecessary for <1000 nodes and requires `<ClientOnly>` choreography anyway.
- **vue-force-graph / vue-d3-network** wrappers. Stale / unmaintained.

## Consequences

- Pan/zoom is a ~40 LOC custom implementation (no d3-zoom dependency).
- Styling (target highlight, hover states) is plain CSS on SVG.
- Graph logic and Vue reactivity live together; no onMounted/onBeforeUnmount gymnastics beyond simulation start/stop.
- Bundle gain is minimal (~15 KB for d3-force, ~3 KB for d3-collection peer).
- Ceiling: fluid up to ~1000 edges on SVG; if we ever need 10k+ nodes we revisit sigma.js/canvas.

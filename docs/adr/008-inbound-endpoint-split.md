# ADR 008: Separate endpoint for inbound link analysis

**Status:** Accepted

## Context

The existing `POST /api/scrape-links-stream` crawls pages and emits every link it finds, with a redirect-chain HEAD probe per target. The new Silo feature needs the inverse: crawl pages, emit only links whose target matches a user-specified set (or every internal link, for matrix mode).

## Decision

Create a second endpoint, `POST /api/analyze-inbound-links-stream`, instead of extending the existing one.

## Rationale

- **Different contract**: inbound analysis emits filtered links plus an aggregation shape; the outbound endpoint emits every discovered link verbatim.
- **Different performance profile**: outbound probes each target with HEAD for redirect chains; inbound does not need that and skipping it materially speeds up a large crawl.
- **Different default crawling**: inbound always crawls the whole site (or sitemap); outbound's `recursive` flag is opt-in. Merging both flows into one endpoint would muddy both contracts.
- Shared code lives in `server/utils/link-analyzer.ts`, `server/utils/sitemap.ts`, and `server/utils/inbound-matcher.ts` — no duplication.

## Consequences

- Two SSE endpoints to maintain, but shaped identically (`result` / `progress` / `log` / `done` / `error`).
- Frontend reuses the SSE parser almost verbatim.
- `/api/save-results` gains a third `mode` branch (`inbound-links`) writing to `output/silo/`.

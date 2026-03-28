# ADR-003: Server-Sent Events for Link Streaming

**Date:** 2025-03-01
**Status:** Accepted

## Context

The link scraper potentially crawls thousands of URLs. With a classic REST request, the user would wait minutes for a response without any feedback. Alternatives: WebSockets, polling, or Server-Sent Events.

## Decision

Server-Sent Events (SSE) for live streaming of link analysis results via `/api/scrape-links-stream`.

## Rationale

- **Simplicity:** SSE requires no library — `EventSource` is natively available in all browsers.
- **Unidirectional is sufficient:** Results only flow from server to client. No bidirectional channel needed.
- **Nitro support:** Nitro natively supports SSE responses with `eventStream()`.
- **Pause/Resume:** The connection can be closed and restarted on the client side.
- **No state management:** Each SSE connection is a standalone crawl job.

## Consequences

**Positive:**
- "Screaming Frog" feel: Links appear in the table in real time
- No timeout issues with long crawls
- Progress updates, logs, and results through the same stream

**Negative:**
- SSE only supports GET by default — workaround with POST + fetch required
- No automatic reconnect on connection loss (intentional: crawl should stop)
- Not suitable for bidirectional communication (e.g., changing crawl settings at runtime)

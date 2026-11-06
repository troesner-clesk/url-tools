# ADR-013: Host/Origin Guard for the Local API and Connection-Level SSRF Guard

**Date:** 2026-11-05
**Status:** Accepted

## Context

URL Tools has no authentication by design (ADR-005) and assumes that only the local user can reach it. That assumption does not hold for the browser: any website the user visits can send "simple" cross-site requests (e.g. a form POST or `fetch` with `Content-Type: text/plain`) to `http://localhost:3000` without a CORS preflight. Such a request could, for example, call `POST /api/clear-output` and delete the output folder, or start crawls. With DNS rebinding, an attacker domain that resolves to 127.0.0.1 can even read responses. The new MCP endpoint (ADR-012) makes this more relevant; the MCP specification requires Origin validation for local HTTP servers.

Second, the URL-string SSRF check (`server/utils/url-validator.ts`) cannot see where a hostname resolves to, and redirects are followed by `fetch` without re-checking. For a crawler that follows thousands of links and redirects, that is not enough.

## Decision

1. **Request guard** (`server/middleware/local-guard.ts`, logic in `server/utils/request-guard.ts`) for `/api/**` and `/mcp`:
   - `Host` must be `localhost`, `127.0.0.1`, `[::1]`, `*.localhost` or listed in `URL_TOOLS_ALLOWED_HOSTS` (comma-separated, `*` disables the check) → blocks DNS rebinding
   - `Sec-Fetch-Site` (if sent) must be `same-origin` or `none`: other web apps on another localhost port are `same-site` for browsers and are rejected as well
   - an `Origin` header (if present) must be exactly the server's own origin (same host and port as the `Host` header) or point to a host listed in `URL_TOOLS_ALLOWED_HOSTS`; `Origin: null` is rejected
   - requests without `Origin` (curl, MCP clients, server-side calls) pass
2. **Connection-level SSRF guard** for the site crawler (`server/crawler/net-guard.ts`): every request uses `node:http(s)` with a custom `lookup` that resolves all addresses and refuses the connection if any of them is loopback, private, link-local, CGNAT, multicast, reserved or a NAT64/IPv4-mapped form of those. Redirects are never followed automatically; each hop is a new, checked request. Literal IPs and `localhost` are rejected before any network activity. `URL_TOOLS_ALLOW_LOCALHOST=1` allows loopback only (tests, demo fixtures).
3. **Hop-by-hop check for the scraping tools** (`server/utils/safe-fetch.ts`, added 2026-11-06, #33): `safeFetch` follows redirects itself and checks the URL string and the resolved IP of every hop with the same address rules before sending the request. Used by `fetchWithRetry` (Scraper, SEO Audit, Link Checker, Silo, Sitemap, JSON), the SEO Audit link check and the image downloads; `getRedirectChain` checks each hop the same way. Screenshots use Puppeteer request interception: navigations, redirect hops and subresources to blocked targets are aborted (`ERR_BLOCKED_BY_CLIENT`), hosts are checked once per minute.

## Rationale

- Closes a real cross-site attack surface of a no-auth localhost tool with a few lines and no change for normal use
- Checking the resolved address at connect time is the only reliable SSRF defence; string checks miss `localtest.me`-style hostnames, IPv6 forms and rebinding
- Uses Node built-ins (`net.BlockList`, `dns.lookup`), no dependency

## Alternatives Considered

- **CSRF tokens:** would require changes in every UI request and do not help against DNS rebinding. Rejected.
- **Binding to 127.0.0.1 only:** good practice, but Docker needs `0.0.0.0` and it does not stop browser-based attacks anyway. Not sufficient on its own.
- **Moving the legacy tools to the socket-level guard of the crawler:** would also close the rebinding window, but replaces `fetch` in every legacy endpoint and does not work for Chromium. The hop-by-hop pre-check (decision 3) covers redirects and hostnames that resolve to private addresses with small changes.

## Consequences

**Positive:**
- Other websites can no longer trigger or read the local API
- The crawler cannot be steered into the internal network, also not via redirects or DNS

**Negative:**
- Accessing url-tools under another hostname or IP (e.g. from another device in the LAN, or behind a reverse proxy) requires `URL_TOOLS_ALLOWED_HOSTS`
- The legacy tools and Chromium resolve the hostname again when they connect: a DNS answer that changes between check and connection (rebinding) is not caught there, only in the Site Audit
- Screenshots of pages that load resources from private addresses render without those resources

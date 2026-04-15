# ADR-009: DNS-based Domain Availability Detection

**Date:** 2026-04-15
**Status:** Accepted

## Context

The Broken Link Checker could not distinguish between an HTTP error (domain exists but the page is broken) and a completely unregistered domain. Customer feedback explicitly asked for detection of "freie Domains" (available for registration) in outbound link audits.

## Decision

Use Node's built-in `dns.promises.lookup()` for every external link, parallel to the HTTP check. Cache results per-request using a Promise-valued Map to dedupe concurrent lookups. Apply a naive two-level `registrable-parent` heuristic to distinguish "domain unregistered" from "only the subdomain is missing".

## Rationale

- **Zero dependencies:** DNS is fast, free, and built-in — no external library or API key required.
- **Clean NXDOMAIN signal:** `dns.lookup()` uses the system resolver (respects the OS cache) and returns `ENOTFOUND` cleanly for NXDOMAIN.
- **Dedup via Promise cache:** A Promise-valued cache prevents a thundering herd when many links share a hostname.
- **Naive parent heuristic:** The 2-level parent check avoids introducing a Public Suffix List dependency. Accepted limitation: for multi-part TLDs like `.co.uk`, the parent check may be imprecise, but this only affects the secondary `subdomain-gone` distinction — the primary `available` signal stays correct for typical domains.

## Alternatives Considered

- **WHOIS lookups:** More precise (distinguishes registered-but-no-DNS from truly available), but slow, rate-limited per registrar, and requires an external library or paid API. Rejected for v1.
- **Public Suffix List (`psl` npm package):** Would make parent-domain detection fully accurate. Rejected because of dependency weight for marginal gain — the `subdomain-gone` status is a nice-to-have, not the primary signal.
- **Only check on HTTP failure:** Would save some DNS calls, but DNS info is useful even for successful HTTP responses (the user might want to audit even "working" links). Rejected for completeness.

## Consequences

**Positive:**
- Clear `available` signal for unregistered domains — directly addresses customer request.
- Minimal latency: DNS lookups run in parallel with HTTP checks and are cached per request.
- No new runtime dependencies.

**Negative:**
- New optional fields in `BrokenLinkResult`: `domainStatus`, `domainError`.
- New "Domain" column in the Link Checker UI, plus a new filter option "Available domains only".
- Known limitation: false positives for multi-part TLDs in the `subdomain-gone` classification (never for `available`).

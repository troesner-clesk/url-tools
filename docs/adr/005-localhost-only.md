# ADR-005: Localhost-Only Design

**Date:** 2025-01-01
**Status:** Accepted

## Context

URL Tools could theoretically be operated as a hosted service. However, that would require authentication, authorization, rate limiting, user management, and multi-tenancy.

## Decision

URL Tools is designed exclusively for local use. No auth system, no multi-user support.

## Rationale

- **Complexity reduction:** Auth, sessions, CSRF tokens, user DB — all of that would triple the codebase without increasing the core value.
- **Security through isolation:** Runs only on localhost:3000 — no external attack vector.
- **Quick start:** `npm run dev` or `docker compose up` — done. No setup wizard, no configuration.
- **Personal tool:** Built for personal use, not as a SaaS product.

## Consequences

**Positive:**
- Minimal codebase
- No user management overhead
- No compliance concerns (GDPR, etc.)

**Negative:**
- Not suitable for team use
- No remote access without VPN/tunnel
- Output folder is accessible to anyone with local access (no access control)

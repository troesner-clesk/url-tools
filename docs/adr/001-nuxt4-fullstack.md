# ADR-001: Nuxt 4 as Fullstack Framework

**Date:** 2025-01-01
**Status:** Accepted

## Context

URL Tools needed a framework that covers both the browser UI and the server-side scraping logic. Alternatives would have been: a separate frontend (React/Vue SPA) + backend (Express/Fastify), or a pure CLI tool.

## Decision

Nuxt 4 as a fullstack framework with:
- **Vue 3** (Composition API) for the UI
- **Nitro** as the server engine for API endpoints
- Unified build system and deployment

## Rationale

- **One project instead of two:** No separate backend repo needed. Frontend and backend share TypeScript types.
- **Nitro is lightweight:** No Express overhead, direct H3 handlers for API endpoints.
- **File-based routing:** Endpoints in `server/api/` are automatically registered as routes.
- **SSE support:** Nitro natively supports Server-Sent Events — important for live streaming of the link scraper.
- **Docker-friendly:** A single build step (`npm run build`) produces a self-contained `.output/` directory.

## Consequences

**Positive:**
- Rapid development through convention-over-configuration
- Type sharing between frontend and backend
- Hot reload for both frontend AND backend in development

**Negative:**
- Nuxt 4 is relatively new — fewer community examples than Next.js
- Overhead for a tool that primarily runs locally (SSR not really utilized)

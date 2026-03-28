# ADR-002: File-Based Storage Instead of a Database

**Date:** 2025-01-01
**Status:** Accepted

## Context

Scraping results (HTML files, link lists, screenshots, SEO reports) need to be persisted. Options: SQLite, PostgreSQL (via Docker), or simply the filesystem.

## Decision

All results are stored as files in the `output/` directory:
- JSON for structured data
- CSV for tabular data
- HTML/PNG/JPG/PDF as original files
- TXT for simple URL lists

## Rationale

- **Zero dependencies:** No database installation required. `npm install && npm run dev` is enough.
- **Transparency:** Results are directly viewable in Finder/Explorer — no DB client needed.
- **Docker volumes:** Simple mounting of `./output:/app/output` for persistence.
- **Export-friendly:** CSV/JSON files can be opened directly in Excel, Google Sheets, etc.
- **No schema management:** No migrations, no ORM configuration.

## Consequences

**Positive:**
- Extremely simple setup
- Results are human-readable without any tools
- Docker deployment is trivial (one volume mount)

**Negative:**
- No full-text search over past results
- No relational access (e.g., "all links that returned 404 last week")
- Not scalable for large datasets
- No concurrent access management

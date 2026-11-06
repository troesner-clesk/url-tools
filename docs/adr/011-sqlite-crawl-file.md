# ADR-011: One SQLite File per Site Crawl

**Date:** 2026-11-05
**Status:** Accepted (extends ADR-002 for the Site Audit)

## Context

The existing tools write JSON/CSV per run (ADR-002). A site crawl is different: thousands of URLs, the links between them, redirects, canonicals, hreflang pairs and sitemap entries. Most checks are relational ("pages that link to a URL that redirects", "hreflang target does not link back"), and the same data has to serve the UI, CSV exports and AI agents (ADR-012). ADR-002 already listed "no relational access" as its main drawback.

## Decision

Each Site Audit crawl is written to exactly one SQLite file `<OUTPUT_DIR>/crawls/<crawl-id>.sqlite` using Node's built-in `node:sqlite` (`DatabaseSync`). The schema is documented in `docs/data-model.md`, versioned via `PRAGMA user_version` (currently 1) and identified via `PRAGMA application_id = 0x55544C53` ("UTLS"). The issue catalog is copied into each file (`issue_catalog`), so a file is self-describing. During the crawl the file runs in WAL mode; when the crawl ends it is switched back to a rollback journal, so the result is a single file without sidecars.

The analysis (`server/crawler/analyze.ts`) only reads and writes the crawl file, so improved checks can be re-run on old crawls.

## Rationale

- **Still a file:** no database server, no install step; the result can be copied, archived or sent like a CSV
- **Open format:** any SQLite client, Python, DuckDB, Excel/BI tools or an agent can query it directly, no export needed
- **Relational checks in SQL:** chains, inlinks, duplicates and reciprocal hreflang are simple queries instead of hand-written joins over JSON
- **Scales further:** pages are written incrementally; nothing has to fit into memory as one JSON document
- **No new dependency:** `node:sqlite` ships with Node (unflagged since 22.13, stable API in 24), unlike `better-sqlite3` which needs native builds

## Alternatives Considered

- **JSON/JSONL per crawl:** consistent with ADR-002 but every relational check and every agent question would need custom code; large crawls would not fit into one JSON document. Rejected.
- **`better-sqlite3`:** mature, but a native addon (build tools, prebuilt binaries per platform and Node version). Rejected because the built-in module covers the need.
- **DuckDB:** excellent for analytics, but a heavy native dependency and less suited for incremental writes during a crawl. Rejected.

## Consequences

**Positive:**
- Crawl results are queryable and portable
- UI, exports and MCP share one read layer (`server/crawler/queries.ts`)

**Negative:**
- Requires Node 22.13+ (CI and Docker use Node 24)
- Schema changes need a version bump and a migration path for old files
- Binary files are not human-readable without a SQLite client (CSV exports remain available)

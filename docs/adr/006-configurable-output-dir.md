# ADR-006: Configurable Output Directory

**Date:** 2026-03-29
**Status:** Accepted

## Context

The output directory was hardcoded to `process.cwd() + '/output'`, placing generated data inside the project directory. This is problematic because generated scraping results don't belong in the source code repository.

## Decision

Make the output directory configurable via the `OUTPUT_DIR` environment variable. Default to `~/Documents/url-tools` for local development. In Docker, set to `/app/output` via Dockerfile ENV.

All path construction is centralized in `server/utils/path-guard.ts` which exports `OUTPUT_ROOT`.

## Rationale

- **Separation of concerns:** Generated data shouldn't live in the project directory
- **Familiar location:** `~/Documents` is a natural place for user-generated files on macOS
- **Docker compatibility:** `/app/output` with volume mount works as before
- **Single source of truth:** All endpoints import `OUTPUT_ROOT` from `path-guard.ts`
- **Zero config:** Works out of the box without setting any env vars

## Consequences

**Positive:**
- Clean project directory (no more `output/` folder in repo)
- Users can choose where data is stored
- Docker behavior unchanged

**Negative:**
- Existing `output/` folders from previous usage won't be automatically migrated
- macOS may prompt for Documents folder permission on first access

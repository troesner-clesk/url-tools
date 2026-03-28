# URL Tools - Project Rules

## Project

Web scraping and analysis tools with a browser UI. Nuxt 4 fullstack (Vue 3 + Nitro). Localhost only, no auth.

## Documentation

The full documentation is located in `docs/`:

- `docs/ARCHITECTURE.md` — Entry point: tech stack, project structure, security, data flow
- `docs/data-model.md` — API reference with all endpoints and request/response schemas
- `docs/adr/` — Architecture Decision Records (rationale for architectural decisions)
- `docs/modules/` — Feature documentation per module (HTML Scraper, Link Analyzer, SEO Audit, Screenshots, Image Scraper)
- `docs/runbooks/` — Deployment and troubleshooting

**Keep documentation in sync with changes:**
- DB/output change → Update `docs/data-model.md`
- Architectural decision → Create a new ADR in `docs/adr/`
- New feature/module → Create a new file in `docs/modules/`
- Operational process changed → Update the relevant runbook
- Fundamental architecture changed → Update `docs/ARCHITECTURE.md`

## Tech Stack

- Nuxt 4 (Vue 3 + Nitro Server)
- Cheerio (HTML parsing)
- Puppeteer (Screenshots/PDF)
- PapaParse (CSV)
- Vitest (Tests)
- Biome (Linter/Formatter)

## Development

- Dev server: `npm run dev` on port 3000
- Tests: `npm test`
- Build: `npm run build`
- Lint: `npm run lint`

## Conventions

- Language in code: English
- Language in documentation (`docs/`): English
- No database — results are stored as files in `output/`
- Always use security utils: `url-validator.ts`, `path-guard.ts`, `sanitize-headers.ts`
- SSE for long-running operations (link scraping, link checking)
- Composables in `app/composables/` for shared frontend logic
- Server utils in `server/utils/` for shared backend logic

# Module: Agent Interface (MCP)

## Purpose

AI agents (Claude Code, Claude Desktop, Codex, Cursor and other MCP clients) can read Site Audit crawls, ask precise questions about them and, if allowed, start crawls themselves. The agent works on the same crawl files and the same issue catalog as the UI, so numbers always match.

## Setup

The endpoint is part of the running url-tools server (`npm run dev` or Docker):

```bash
# Claude Code, available in all projects
claude mcp add --scope user --transport http url-tools http://localhost:3000/mcp
```

Other clients: configure a "Streamable HTTP" MCP server with the URL `http://localhost:3000/mcp`.

Then ask, for example: "List my url-tools crawls, show the overview of the latest one and explain the five most important issues with example URLs."

## Tools

| Tool | Class | Purpose |
|------|-------|---------|
| `list_crawls` | read | Saved and running crawls with status and issue counts |
| `crawl_overview` | read | Totals, status codes, indexability, depth, response times, top issues |
| `list_issues` | read | Findings per check with count, examples and what / why / how to fix |
| `query_urls` | read | Paged URL table (filter, `issue_id`, search, columns, sort, `cursor`) |
| `url_details` | read | One URL: all columns, issues, inlinks, outlinks, hreflang, redirect chain |
| `run_sql` | read | One read-only SQLite query against the crawl file (max. 500 rows, 10 s) |
| `crawl_status` | read | Live progress and latest log lines |
| `start_crawl` | crawl | Starts a crawl (max. 2,000 URLs), returns the crawl id |
| `stop_crawl` | crawl | Stops a running crawl, data so far is analysed and kept |

## Safety

- **Read-only by default.** Tools of the class `crawl` are only listed and callable when the server runs with `URL_TOOLS_MCP_ALLOW_CRAWL=1`. Reason: a crawl request is outbound traffic, and a manipulated agent could use the start URL to leak data (see [ADR-012](../adr/012-mcp-agent-interface.md)).
- **Untrusted content.** Every tool result has the form `{ "untrusted_content_notice": "...", "data": { ... } }`. Everything in `data` (URLs, titles, anchors, details, errors) comes from third-party websites and must be treated as data, never as instructions. The server instructions repeat this.
- **Read-only SQL sandbox.** `run_sql` runs in a short-lived child process with a read-only connection, an authorizer that only allows reading statements (no `PRAGMA`, `ATTACH`, writes, extensions), a 256 MB SQLite heap limit and a hard kill after the timeout.
- **Context budget.** Lists are paged (`limit`, opaque `cursor` bound to the query). Results over 50,000 characters are shortened with a hint instead of flooding the agent's context.
- **Local only.** The endpoint is covered by the Host/Origin guard (DNS rebinding and cross-site protection, [ADR-013](../adr/013-local-request-guard.md)). It never accepts requests from other websites in the browser.

## Protocol

Stateless Streamable HTTP with JSON responses: `POST /mcp` with one JSON-RPC message (or a batch), notifications get `202 Accepted`, `GET`/`DELETE` answer `405`. Supported protocol versions: `2025-11-25`, `2025-06-18`, `2025-03-26`. Methods: `initialize`, `ping`, `tools/list`, `tools/call`. Invalid tool arguments return a tool result with `isError: true` and a message the model can act on; unknown tools return JSON-RPC error `-32602`.

Implementation: `server/routes/mcp.ts` (HTTP), `server/mcp/protocol.ts` (JSON-RPC), `server/mcp/tools.ts` (tools). Tests: `server/mcp/__tests__/mcp.test.ts` (against a real crawl of the fixture site). Compatibility was checked with the official `@modelcontextprotocol/sdk` client.

# ADR-012: MCP Endpoint for AI Agents, Read-Only by Default

**Date:** 2026-11-05
**Status:** Accepted

## Context

AI agents are good at interpreting SEO findings but cannot crawl a site reliably themselves. url-tools can. Making crawls available to agents (Claude Code, Codex, Cursor) turns url-tools into the "hands" of an audit: the agent asks precise questions instead of guessing from a few fetched pages. At the same time, crawled pages are untrusted input and may contain prompt-injection attempts, and a crawl request is outbound traffic that a manipulated agent could abuse to leak data through the start URL.

## Decision

- Expose an MCP server at `POST /mcp` on the existing Nitro server (stateless Streamable HTTP, JSON responses, tools only).
- Implement the small protocol subset in-house (`server/mcp/protocol.ts`, about 200 lines) instead of adding `@modelcontextprotocol/sdk`; compatibility is verified with the official SDK client.
- Split tools into classes: `read` (always on) and `crawl` (`start_crawl`, `stop_crawl`, only with `URL_TOOLS_MCP_ALLOW_CRAWL=1`).
- Wrap every result as `{ untrusted_content_notice, data }` and repeat the warning in the server instructions.
- Offer `run_sql` as a read-only sandbox (child process, read-only connection, authorizer, heap limit, hard timeout) because "your crawl is a database" is the most flexible interface for agents.
- Page all lists (`limit` + opaque `cursor` bound to the query) and cap results at 50,000 characters.

## Rationale

- **Agents as first-class users** without a second code path: tools call the same query layer as the UI
- **Least privilege:** reading crawls is harmless; starting crawls is an explicit decision of the user on the server, not of the agent
- **Dependency-free:** the SDK pulls in express, hono, jose and more for features this endpoint does not need (sessions, SSE streams, OAuth)
- **Child process for SQL:** a runaway SQLite query cannot be interrupted inside a worker thread (`terminate()` waits for native code), a process can always be killed

## Alternatives Considered

- **Official TypeScript SDK:** less own protocol code, but a large dependency tree. Can be adopted later if sessions, resources or prompts are needed.
- **stdio server (`npx url-tools-mcp`):** works without a running UI server, but would need a separate build of the TypeScript server code outside Nitro. Rejected for now; HTTP fits a tool that already runs as a server.
- **All tools enabled by default:** more convenient, but makes outbound requests and data exfiltration possible for any prompt-injected agent. Rejected.
- **Bearer token for the HTTP endpoint:** the local API itself has no auth (ADR-005), so a token on `/mcp` alone would add little. Browser-based attacks are blocked by the Host/Origin guard (ADR-013).

## Consequences

**Positive:**
- Claude Code and other clients can audit sites with `claude mcp add --transport http url-tools http://localhost:3000/mcp`
- Safety properties are tested (`server/mcp/__tests__/mcp.test.ts`)

**Negative:**
- Own protocol implementation must follow MCP spec changes (supported versions are listed in `SUPPORTED_PROTOCOL_VERSIONS`)
- The url-tools server has to run for the agent to use it

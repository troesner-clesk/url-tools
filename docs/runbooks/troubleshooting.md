# Troubleshooting

## Puppeteer / Screenshots

### Chromium Won't Start

**Symptom:** Screenshot requests fail with `Failed to launch browser`.

**Solution:**
```bash
# Force Chromium download
npx puppeteer browsers install chrome

# Or: Use system Chromium (Linux)
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

### Chromium Sandbox Error (Docker/Linux)

**Symptom:** `Running as root without --no-sandbox is not supported`

**Solution:** In the Dockerfile, Puppeteer is already started with `--no-sandbox`. If running manually:
```bash
# Run as non-root user (recommended)
# Or: --no-sandbox flag is already set in the code
```

### Screenshots Are Blank/White

**Possible causes:**
- Page takes longer to load → Increase timeout
- JavaScript error on the page → Cannot be fixed, issue is with the target site
- Page blocks headless browsers → User-Agent is already set

---

## Port Conflicts

### Port 3000 Already in Use

**Symptom:** `EADDRINUSE: address already in use :::3000`

**Solution:**
```bash
# Find process on port 3000
lsof -i :3000

# Kill the process
kill -9 <PID>

# Or: Use a different port
PORT=3001 npm run dev
```

---

## Output Folder

### Clear Output Folder

Via the UI: "Clear Output" button in the header (with confirmation dialog).

Or manually:
```bash
rm -rf output/*
```

### Permission Error When Saving

**Symptom:** `EACCES: permission denied`

**Solution:**
```bash
# Set output folder permissions
chmod -R 755 output/

# In Docker: Check volume mount
docker compose down
docker compose up -d
```

---

## Network / Scraping

### Timeout on All URLs

**Possible causes:**
- No internet access
- Incorrect proxy settings
- Firewall blocking outgoing requests

**Solution:** Increase timeout in the request settings (max. 120s).

### SSRF Blocking

**Symptom:** `URL not allowed` error

**Cause:** URL points to localhost, a private IP, or file://.

**Solution:** This is intentional — SSRF protection prevents access to internal networks. Only public HTTP/HTTPS URLs are allowed.

All tools check the resolved IP address of every request, including each redirect hop (ADR-013). The scraping tools report `Blocked target: ...`, screenshots `Blocked target (the page or a redirect points to a private or local address)`, the Link Checker `Redirect to blocked URL`. The Site Audit checks inside the connection itself. A public hostname that resolves to a private address shows up as `crawl_state = blocked_target` with the message `Blocked target <host> → <ip> (private or reserved address)`. For local tests only: `URL_TOOLS_ALLOW_LOCALHOST=1` allows loopback addresses (never private networks).

### 403 "Host not allowed" or "Origin not allowed"

**Symptom:** The UI or an API call answers 403 with `Host not allowed (DNS rebinding protection)` or `Origin not allowed`.

**Cause:** The local request guard only accepts `localhost`, `127.0.0.1`, `[::1]` and `*.localhost` as host, and only browser requests from the url-tools page itself. Requests from other websites and from other local web apps (another port) are rejected (ADR-013).

**Solution:** When url-tools is reached under another name or IP (LAN access, reverse proxy), list it: `URL_TOOLS_ALLOWED_HOSTS=tools.internal,192.168.1.20`. `*` disables the host check (only behind your own authentication).

---

## Site Audit / MCP

### Crawl Shows Status "interrupted"

**Cause:** The server was stopped or restarted while the crawl was running. Crawls are not resumed.

**Solution:** Start the crawl again. The old file stays in `crawls/` and can be deleted.

### Many URLs With "Blocked by robots.txt" or Nothing Crawled

**Cause:** robots.txt disallows the paths, or robots.txt answered 5xx / was unreachable (RFC 9309: then nothing may be crawled). The log drawer shows the reason.

**Solution:** Check `https://<site>/robots.txt`. For your own sites you can switch off "Respect robots.txt" in the options.

### Agent Says start_crawl Is Disabled

**Cause:** MCP is read-only by default (ADR-012).

**Solution:** Start the server with `URL_TOOLS_MCP_ALLOW_CRAWL=1`, or start the crawl in the UI and let the agent read it.

### Agent Does Not See url-tools

**Solution:** The server must be running (`npm run dev` or Docker). Register it once: `claude mcp add --scope user --transport http url-tools http://localhost:3000/mcp`, then start a new Claude Code session. Check with `curl -s -X POST http://localhost:3000/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'`.

### Rate Limiting by Target Server

**Symptom:** Many 429 errors (Too Many Requests)

**Solution:**
- Reduce the rate limit in the link analyzer (e.g., 0.5 req/s)
- Reduce parallel requests to 1-2
- Increase timeout

---

## Build Issues

### npm install Fails

```bash
# Completely reinstall node modules
rm -rf node_modules package-lock.json
npm install
```

### Build Errors

```bash
# Clear cache and rebuild
rm -rf .nuxt .output
npm run build
```

---

## Docker Issues

### Container Won't Start

```bash
# Check logs
docker compose logs url-tools

# Rebuild (without cache)
docker compose build --no-cache
docker compose up -d
```

### Volume Mount Not Working

```bash
# Output folder must exist locally
mkdir -p output

# Check permissions (Linux)
sudo chown -R 1001:1001 output/
```

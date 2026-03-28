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

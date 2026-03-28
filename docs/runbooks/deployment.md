# Deployment & Development

## Local Development

### Prerequisites

- Node.js 22+
- npm

### Setup

```bash
# Install dependencies
npm install

# Start dev server (http://localhost:3000)
npm run dev

# Run tests
npm test

# Tests in watch mode
npm run test:watch

# Linting
npm run lint

# Formatting
npm run format
```

### First Launch

On the first screenshot request, Puppeteer will automatically download Chromium (~300 MB). This only happens once.

---

## Docker

### With Docker Compose (recommended)

```bash
# Build and start
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

### Manually with Docker

```bash
# Build image
docker build -t url-tools .

# Start container
docker run -p 3000:3000 -v ./output:/app/output url-tools
```

### Docker Details

- **Base image:** `node:22-slim`
- **Multi-stage build:** Build stage + Production stage
- **Chromium:** Pre-installed in the image (no download at runtime)
- **Port:** 3000
- **Volume:** `./output:/app/output` — Persist results between container restarts
- **User:** Runs as non-root user (`appuser:1001`)
- **Restart policy:** `unless-stopped`

### Environment Variables (Docker)

| Variable | Value | Description |
|----------|-------|-------------|
| `HOST` | `0.0.0.0` | Listen on all interfaces |
| `PORT` | `3000` | Server port |
| `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` | `true` | Use system Chromium |
| `PUPPETEER_EXECUTABLE_PATH` | `/usr/bin/chromium` | Path to system Chromium |

---

## CI/CD (GitHub Actions)

### Pipeline

File: `.github/workflows/ci.yml`

**Trigger:** Push and pull requests on `main`

**Steps:**
1. `npm ci` — Clean install of dependencies
2. `npm test` — Run tests
3. `npm run build` — Create production build

**Environment:** Ubuntu Latest, Node.js 22, npm cache enabled

### Production Build

```bash
# Create build
npm run build

# Output is in .output/
# Start with:
node .output/server/index.mjs
```

The `.output/` directory is self-contained and can be deployed to any server with Node.js 22.

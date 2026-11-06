import http from 'node:http'
import https from 'node:https'
import type { Readable } from 'node:stream'
import zlib from 'node:zlib'
import { sanitizeHeaders } from '../utils/sanitize-headers'
import {
  assertCrawlableUrl,
  BlockedTargetError,
  bareHostname,
  guardedLookup,
} from './net-guard'

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (compatible; URLTools/2.0; +https://github.com/troesner-clesk/url-tools)'

/** Product token matched against robots.txt `User-agent` lines. */
export const ROBOTS_TOKEN = 'urltools'

export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024

export type FetchErrorCode =
  | 'blocked_target'
  | 'timeout'
  | 'dns'
  | 'connection'
  | 'tls'
  | 'aborted'
  | 'protocol'

export class FetchError extends Error {
  constructor(
    message: string,
    readonly code: FetchErrorCode,
  ) {
    super(message)
    this.name = 'FetchError'
  }
}

export interface HttpRequestOptions {
  method?: 'GET' | 'HEAD'
  headers?: Record<string, string>
  userAgent?: string
  timeoutMs?: number
  maxBytes?: number
  /** Decides after the response headers whether the body is downloaded. */
  wantBody?: (status: number, mime: string) => boolean
  signal?: AbortSignal
}

export interface HttpResponse {
  url: string
  status: number
  headers: http.IncomingHttpHeaders
  /** Lower-cased MIME type without parameters, '' when missing. */
  mime: string
  body: string | null
  bytes: number
  truncated: boolean
  timeMs: number
}

const agents = {
  http: new http.Agent({ keepAlive: true, maxSockets: 16, timeout: 30_000 }),
  https: new https.Agent({ keepAlive: true, maxSockets: 16, timeout: 30_000 }),
}

/** Closes pooled keep-alive sockets (used by tests). */
export function destroyAgents(): void {
  agents.http.destroy()
  agents.https.destroy()
  agents.http = new http.Agent({
    keepAlive: true,
    maxSockets: 16,
    timeout: 30_000,
  })
  agents.https = new https.Agent({
    keepAlive: true,
    maxSockets: 16,
    timeout: 30_000,
  })
}

export function parseContentType(value: string): {
  mime: string
  charset: string | null
} {
  const [type, ...params] = value.split(';')
  let charset: string | null = null
  for (const param of params) {
    const [key, raw] = param.split('=')
    if (key?.trim().toLowerCase() === 'charset' && raw) {
      charset = raw.trim().replace(/^["']|["']$/g, '')
    }
  }
  return { mime: (type || '').trim().toLowerCase(), charset }
}

export function isHtmlMime(mime: string): boolean {
  return mime === 'text/html' || mime === 'application/xhtml+xml'
}

function sniffCharset(buffer: Buffer): string | null {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return 'utf-8'
  }
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return 'utf-16le'
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return 'utf-16be'
  const head = buffer.subarray(0, 2048).toString('latin1')
  const match =
    head.match(/<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i) ||
    head.match(/<\?xml[^>]+encoding\s*=\s*["']([\w-]+)/i)
  return match?.[1] ?? null
}

export function decodeBody(buffer: Buffer, headerCharset: string | null) {
  const label = headerCharset || sniffCharset(buffer) || 'utf-8'
  try {
    return new TextDecoder(label).decode(buffer)
  } catch {
    return new TextDecoder('utf-8').decode(buffer)
  }
}

const TLS_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
])

function normalizeError(error: unknown): FetchError {
  if (error instanceof FetchError) return error
  if (error instanceof BlockedTargetError) {
    return new FetchError(error.message, 'blocked_target')
  }
  const err = error as NodeJS.ErrnoException
  const code = err?.code || ''
  const message = err?.message || 'Unknown network error'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ENODATA') {
    return new FetchError(`DNS lookup failed (${code})`, 'dns')
  }
  if (
    TLS_CODES.has(code) ||
    code.startsWith('ERR_TLS') ||
    code.startsWith('ERR_SSL') ||
    code.startsWith('CERT_')
  ) {
    return new FetchError(`TLS error: ${message}`, 'tls')
  }
  if (code === 'HPE_INVALID_CONSTANT' || code.startsWith('HPE_')) {
    return new FetchError(`Invalid HTTP response: ${message}`, 'protocol')
  }
  return new FetchError(code ? `${message} (${code})` : message, 'connection')
}

function decompress(res: http.IncomingMessage): Readable {
  const encoding = String(res.headers['content-encoding'] || '')
    .trim()
    .toLowerCase()
  if (encoding === 'gzip' || encoding === 'x-gzip') {
    return res.pipe(zlib.createGunzip())
  }
  if (encoding === 'deflate') return res.pipe(zlib.createInflate())
  if (encoding === 'br') return res.pipe(zlib.createBrotliDecompress())
  return res
}

/**
 * Single HTTP request without redirect following. Every call (and therefore
 * every redirect hop the caller follows) passes the SSRF guard.
 */
export function httpRequest(
  url: string,
  options: HttpRequestOptions = {},
): Promise<HttpResponse> {
  const method = options.method ?? 'GET'
  const timeoutMs = options.timeoutMs ?? 15_000
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  let parsed: URL
  try {
    parsed = assertCrawlableUrl(url)
  } catch (error) {
    return Promise.reject(normalizeError(error))
  }
  const isHttps = parsed.protocol === 'https:'
  const started = performance.now()

  return new Promise<HttpResponse>((resolve, reject) => {
    let settled = false
    let timer: NodeJS.Timeout | undefined
    const onAbort = () => req.destroy(new FetchError('Aborted', 'aborted'))

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(normalizeError(error))
    }
    const succeed = (response: HttpResponse) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(response)
    }

    const req = (isHttps ? https : http).request({
      protocol: parsed.protocol,
      hostname: bareHostname(parsed.hostname),
      port: parsed.port || undefined,
      path: `${parsed.pathname}${parsed.search}`,
      method,
      agent: isHttps ? agents.https : agents.http,
      lookup: guardedLookup as unknown as http.RequestOptions['lookup'],
      headers: {
        'user-agent': options.userAgent || DEFAULT_USER_AGENT,
        accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-encoding': 'gzip, deflate, br',
        ...sanitizeHeaders(options.headers),
      },
    })

    timer = setTimeout(
      () =>
        req.destroy(new FetchError(`Timeout after ${timeoutMs} ms`, 'timeout')),
      timeoutMs,
    )
    if (options.signal) {
      if (options.signal.aborted) onAbort()
      else options.signal.addEventListener('abort', onAbort, { once: true })
    }

    req.on('error', fail)
    req.on('response', (res) => {
      const status = res.statusCode ?? 0
      const { mime, charset } = parseContentType(
        String(res.headers['content-type'] || ''),
      )
      const base = { url, status, headers: res.headers, mime }
      const needBody =
        method !== 'HEAD' &&
        (options.wantBody ? options.wantBody(status, mime) : true)

      if (!needBody) {
        res.destroy()
        succeed({
          ...base,
          body: null,
          bytes: 0,
          truncated: false,
          timeMs: Math.round(performance.now() - started),
        })
        return
      }

      const chunks: Buffer[] = []
      let bytes = 0
      let truncated = false
      const finish = () =>
        succeed({
          ...base,
          body: decodeBody(Buffer.concat(chunks), charset),
          bytes,
          truncated,
          timeMs: Math.round(performance.now() - started),
        })

      const stream = decompress(res)
      stream.on('data', (chunk: Buffer) => {
        if (truncated) return
        if (bytes + chunk.length > maxBytes) {
          chunks.push(chunk.subarray(0, maxBytes - bytes))
          bytes = maxBytes
          truncated = true
          res.destroy()
          finish()
          return
        }
        bytes += chunk.length
        chunks.push(chunk)
      })
      stream.on('end', finish)
      stream.on('error', (error) => {
        if (!truncated) fail(error)
      })
      res.on('error', (error) => {
        if (!truncated) fail(error)
      })
    })
    req.end()
  })
}

export interface FollowResult {
  /** Status of the first response (e.g. 301). */
  status: number
  finalUrl: string
  finalStatus: number
  hops: number
  error?: string
  errorCode?: FetchErrorCode
}

/**
 * Status check for external URLs: HEAD first, GET when HEAD is refused,
 * redirects followed up to `maxHops` (each hop passes the SSRF guard).
 */
export async function checkUrlStatus(
  url: string,
  options: Omit<HttpRequestOptions, 'method' | 'wantBody'> & {
    maxHops?: number
  } = {},
): Promise<FollowResult> {
  const maxHops = options.maxHops ?? 5
  let current = url
  let firstStatus = 0
  for (let hop = 0; hop <= maxHops; hop++) {
    let response: HttpResponse
    try {
      response = await httpRequest(current, { ...options, method: 'HEAD' })
      // Many servers refuse or mishandle HEAD (403/405/501); confirm with GET.
      if (response.status >= 400) {
        response = await httpRequest(current, {
          ...options,
          method: 'GET',
          wantBody: () => false,
        })
      }
    } catch (error) {
      const err = error as FetchError
      return {
        status: firstStatus,
        finalUrl: current,
        finalStatus: 0,
        hops: hop,
        error: err.message,
        errorCode: err.code,
      }
    }
    if (hop === 0) firstStatus = response.status
    const location = response.headers.location
    if (response.status >= 300 && response.status < 400 && location) {
      try {
        current = new URL(String(location), current).href
      } catch {
        return {
          status: firstStatus,
          finalUrl: current,
          finalStatus: response.status,
          hops: hop,
          error: 'Invalid redirect location',
          errorCode: 'protocol',
        }
      }
      continue
    }
    return {
      status: firstStatus,
      finalUrl: current,
      finalStatus: response.status,
      hops: hop,
    }
  }
  return {
    status: firstStatus,
    finalUrl: current,
    finalStatus: 0,
    hops: maxHops,
    error: `More than ${maxHops} redirects`,
    errorCode: 'protocol',
  }
}

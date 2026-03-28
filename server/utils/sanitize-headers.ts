/**
 * Sanitizes user-provided headers by removing dangerous ones
 * and limiting the total number of custom headers.
 */
export function sanitizeHeaders(headers?: Record<string, string>): Record<string, string> {
    if (!headers) return {}
    const blocked = new Set(['host', 'authorization', 'cookie', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'proxy-authorization'])
    const sanitized: Record<string, string> = {}
    const entries = Object.entries(headers).slice(0, 20) // max 20 custom headers
    for (const [key, value] of entries) {
        if (!blocked.has(key.toLowerCase())) {
            sanitized[key] = value
        }
    }
    return sanitized
}

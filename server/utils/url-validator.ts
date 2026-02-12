// Prüft ob eine URL sicher zum Fetchen ist (SSRF-Schutz)
export function isAllowedUrl(url: string): boolean {
    try {
        const parsed = new URL(url)

        // Nur http/https erlauben
        if (!['http:', 'https:'].includes(parsed.protocol)) return false

        const hostname = parsed.hostname.toLowerCase()

        // Localhost blockieren
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return false
        if (hostname.endsWith('.localhost')) return false

        // Private IP-Ranges blockieren
        if (hostname.startsWith('10.')) return false
        if (hostname.startsWith('192.168.')) return false
        if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false

        // Link-local und Cloud-Metadata blockieren
        if (hostname.startsWith('169.254.')) return false
        if (hostname === '0.0.0.0') return false

        return true
    } catch {
        return false
    }
}

// Validiert ein Array von URLs und gibt nur erlaubte zurück
export function filterAllowedUrls(urls: string[]): string[] {
    return urls.filter(isAllowedUrl)
}

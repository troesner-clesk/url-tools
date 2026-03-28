import { describe, it, expect } from 'vitest'
import { sanitizeHeaders } from '../sanitize-headers'

describe('sanitizeHeaders', () => {
    it('returns empty object for undefined input', () => {
        expect(sanitizeHeaders(undefined)).toEqual({})
    })

    it('returns empty object for empty input', () => {
        expect(sanitizeHeaders({})).toEqual({})
    })

    it('passes through normal headers unchanged', () => {
        const headers = {
            'Accept': 'text/html',
            'Accept-Language': 'en-US',
            'Cache-Control': 'no-cache',
        }
        expect(sanitizeHeaders(headers)).toEqual(headers)
    })

    it('blocks dangerous header: host', () => {
        expect(sanitizeHeaders({ host: 'evil.com' })).toEqual({})
    })

    it('blocks dangerous header: authorization', () => {
        expect(sanitizeHeaders({ authorization: 'Bearer token123' })).toEqual({})
    })

    it('blocks dangerous header: cookie', () => {
        expect(sanitizeHeaders({ cookie: 'session=abc' })).toEqual({})
    })

    it('blocks dangerous header: x-forwarded-for', () => {
        expect(sanitizeHeaders({ 'x-forwarded-for': '1.2.3.4' })).toEqual({})
    })

    it('blocks dangerous header: x-forwarded-host', () => {
        expect(sanitizeHeaders({ 'x-forwarded-host': 'evil.com' })).toEqual({})
    })

    it('blocks dangerous header: x-real-ip', () => {
        expect(sanitizeHeaders({ 'x-real-ip': '1.2.3.4' })).toEqual({})
    })

    it('blocks dangerous header: proxy-authorization', () => {
        expect(sanitizeHeaders({ 'proxy-authorization': 'Basic abc' })).toEqual({})
    })

    it('blocks headers case-insensitively', () => {
        expect(sanitizeHeaders({ Host: 'evil.com' })).toEqual({})
        expect(sanitizeHeaders({ HOST: 'evil.com' })).toEqual({})
        expect(sanitizeHeaders({ Authorization: 'Bearer x' })).toEqual({})
        expect(sanitizeHeaders({ AUTHORIZATION: 'Bearer x' })).toEqual({})
        expect(sanitizeHeaders({ Cookie: 'a=b' })).toEqual({})
        expect(sanitizeHeaders({ COOKIE: 'a=b' })).toEqual({})
        expect(sanitizeHeaders({ 'X-Forwarded-For': '1.2.3.4' })).toEqual({})
        expect(sanitizeHeaders({ 'Proxy-Authorization': 'Basic abc' })).toEqual({})
    })

    it('keeps safe headers while removing blocked ones', () => {
        const headers = {
            'Accept': 'application/json',
            'authorization': 'Bearer token',
            'X-Custom': 'value',
            'cookie': 'session=x',
        }
        expect(sanitizeHeaders(headers)).toEqual({
            'Accept': 'application/json',
            'X-Custom': 'value',
        })
    })

    it('caps at 20 headers maximum', () => {
        const headers: Record<string, string> = {}
        for (let i = 0; i < 25; i++) {
            headers[`X-Header-${i}`] = `value-${i}`
        }
        const result = sanitizeHeaders(headers)
        expect(Object.keys(result).length).toBe(20)
    })

    it('takes the first 20 headers when exceeding the limit', () => {
        const headers: Record<string, string> = {}
        for (let i = 0; i < 25; i++) {
            headers[`X-Header-${String(i).padStart(2, '0')}`] = `value-${i}`
        }
        const result = sanitizeHeaders(headers)
        // Should contain headers 00-19, not 20-24
        expect(result['X-Header-00']).toBe('value-0')
        expect(result['X-Header-19']).toBe('value-19')
        expect(result['X-Header-20']).toBeUndefined()
    })

    it('counts blocked headers toward the 20-header slice limit', () => {
        // If blocked headers are among the first 20 entries, they get sliced in
        // but then filtered out, so the result has fewer than 20
        const headers: Record<string, string> = {
            'authorization': 'secret',
            'cookie': 'session=x',
        }
        for (let i = 0; i < 20; i++) {
            headers[`X-Custom-${i}`] = `val-${i}`
        }
        const result = sanitizeHeaders(headers)
        // 2 blocked + first 18 custom = 20 sliced, 2 blocked removed = 18 in result
        expect(Object.keys(result).length).toBe(18)
    })
})

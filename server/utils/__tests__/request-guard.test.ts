import { afterEach, describe, expect, it } from 'vitest'
import {
  checkLocalRequest,
  hostnameFromHostHeader,
  isGuardedPath,
} from '../request-guard'

afterEach(() => {
  delete process.env.URL_TOOLS_ALLOWED_HOSTS
})

describe('checkLocalRequest', () => {
  it('allows the UI on localhost and non-browser clients', () => {
    expect(
      checkLocalRequest({
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
        fetchSite: 'same-origin',
      }).ok,
    ).toBe(true)
    expect(checkLocalRequest({ host: '127.0.0.1:3000' }).ok).toBe(true)
    expect(checkLocalRequest({ host: '[::1]:3000' }).ok).toBe(true)
    expect(checkLocalRequest({}).ok).toBe(true)
  })

  it('blocks cross-site requests from other websites', () => {
    expect(
      checkLocalRequest({
        host: 'localhost:3000',
        origin: 'https://evil.example',
        fetchSite: 'cross-site',
      }).ok,
    ).toBe(false)
    expect(
      checkLocalRequest({
        host: 'localhost:3000',
        origin: 'https://evil.example',
      }).ok,
    ).toBe(false)
    expect(
      checkLocalRequest({ host: 'localhost:3000', origin: 'null' }).ok,
    ).toBe(false)
  })

  it('blocks other local web apps (other port = same-site for browsers)', () => {
    expect(
      checkLocalRequest({
        host: 'localhost:3000',
        origin: 'http://localhost:5173',
        fetchSite: 'same-site',
      }).ok,
    ).toBe(false)
    expect(
      checkLocalRequest({
        host: 'localhost:3000',
        origin: 'http://localhost:5173',
      }).ok,
    ).toBe(false)
    expect(
      checkLocalRequest({ host: 'localhost:3000', fetchSite: 'same-site' }).ok,
    ).toBe(false)
    expect(
      checkLocalRequest({ host: 'localhost:3000', fetchSite: 'none' }).ok,
    ).toBe(true)
  })

  it('blocks DNS rebinding (foreign Host header)', () => {
    expect(
      checkLocalRequest({
        host: 'rebind.evil.example:3000',
        origin: 'http://rebind.evil.example:3000',
      }).ok,
    ).toBe(false)
  })

  it('accepts additional hosts from URL_TOOLS_ALLOWED_HOSTS', () => {
    process.env.URL_TOOLS_ALLOWED_HOSTS = 'tools.internal, 192.168.1.20'
    expect(
      checkLocalRequest({
        host: 'tools.internal',
        origin: 'https://tools.internal',
      }).ok,
    ).toBe(true)
    expect(checkLocalRequest({ host: '192.168.1.20:3000' }).ok).toBe(true)
  })
})

describe('helpers', () => {
  it('strips ports from Host headers', () => {
    expect(hostnameFromHostHeader('Example.com:8080')).toBe('example.com')
    expect(hostnameFromHostHeader('[::1]:3000')).toBe('[::1]')
  })

  it('guards the API and the MCP endpoint only', () => {
    expect(isGuardedPath('/api/clear-output')).toBe(true)
    expect(isGuardedPath('/mcp')).toBe(true)
    expect(isGuardedPath('/mcp?x=1')).toBe(true)
    expect(isGuardedPath('/')).toBe(false)
    expect(isGuardedPath('/_nuxt/app.js')).toBe(false)
  })
})

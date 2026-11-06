import { describe, expect, it } from 'vitest'

import { DEVELOPMENT_SERVER_URL, PRODUCTION_SERVER_URL, resolveServerUrl } from './env-vars'

describe('resolveServerUrl', () => {
  it('uses the hosted API in production when the variable is unset', () => {
    expect(resolveServerUrl({ DEV: false })).toBe(PRODUCTION_SERVER_URL)
    expect(resolveServerUrl({})).toBe(PRODUCTION_SERVER_URL)
  })

  it('uses the local gateway in development when the variable is unset', () => {
    expect(resolveServerUrl({ DEV: true })).toBe(DEVELOPMENT_SERVER_URL)
  })

  it('uses VITE_SERVER_URL and drops a trailing slash', () => {
    expect(resolveServerUrl({
      DEV: true,
      VITE_SERVER_URL: 'http://127.0.0.1:3311/',
    })).toBe('http://127.0.0.1:3311')
    expect(resolveServerUrl({
      DEV: false,
      VITE_SERVER_URL: ' https://api.example.test/ ',
    })).toBe('https://api.example.test')
  })
})

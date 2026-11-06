import { describe, expect, it } from 'vitest'

import { defaultMemoryApiKey, defaultMemoryServiceId, memoryClientConfigStatus, memoryClientEnv, readMemoryClientConfig } from '../src/client-config'

const secret = 'example-key'
const endpoint = 'https://memory.example.com'

function configuredEnv(overrides: Record<string, string> = {}) {
  return {
    [memoryClientEnv.endpoint]: 'http://127.0.0.1:8420',
    [memoryClientEnv.teamId]: 'team-1',
    [memoryClientEnv.userId]: 'user-1',
    [memoryClientEnv.agentId]: 'card-1',
    ...overrides,
  }
}

describe('readMemoryClientConfig', () => {
  it('names the missing variables and does not invent a client', () => {
    const result = readMemoryClientConfig({})

    expect(result.configured).toBe(false)
    if (result.configured)
      return
    expect(result.missing).toEqual([
      memoryClientEnv.endpoint,
      memoryClientEnv.teamId,
      memoryClientEnv.userId,
      memoryClientEnv.agentId,
    ])
    expect(result.invalid).toEqual([])
  })

  it('uses the local key and the default service id when they are empty', () => {
    const result = readMemoryClientConfig(configuredEnv())

    expect(result.configured).toBe(true)
    if (!result.configured)
      return
    expect(result.config.apiKey).toBe(defaultMemoryApiKey)
    expect(result.config.serviceId).toBe(defaultMemoryServiceId)
  })

  it('accepts a server origin and keeps the key out of the status', () => {
    const result = readMemoryClientConfig(configuredEnv({
      [memoryClientEnv.endpoint]: endpoint,
      [memoryClientEnv.apiKey]: secret,
      [memoryClientEnv.serviceId]: 'service-1',
    }))

    expect(result.configured).toBe(true)
    if (!result.configured)
      return
    expect(result.config.endpoint).toBe(endpoint)
    expect(result.config.apiKey).toBe(secret)
    expect(JSON.stringify(memoryClientConfigStatus(result))).not.toContain(secret)
    expect(JSON.stringify(memoryClientConfigStatus(result))).not.toContain(endpoint)
  })

  it('rejects a key hidden in the endpoint and does not return that key', () => {
    const result = readMemoryClientConfig(configuredEnv({
      [memoryClientEnv.endpoint]: `http://user:${secret}@memory.example.com`,
    }))

    expect(result.configured).toBe(false)
    expect(JSON.stringify(result)).not.toContain(secret)
    if (result.configured)
      return
    expect(result.invalid).toContain(memoryClientEnv.endpoint)
  })

  it('rejects a path, a query, and a blank key', () => {
    const withPath = readMemoryClientConfig(configuredEnv({
      [memoryClientEnv.endpoint]: 'http://127.0.0.1:8420/v3',
    }))
    const withQuery = readMemoryClientConfig(configuredEnv({
      [memoryClientEnv.endpoint]: `http://127.0.0.1:8420/?token=${secret}`,
    }))
    const blankKey = readMemoryClientConfig(configuredEnv({
      [memoryClientEnv.apiKey]: '   ',
    }))

    expect(withPath.configured).toBe(false)
    expect(withQuery.configured).toBe(false)
    expect(JSON.stringify(withQuery)).not.toContain(secret)
    expect(blankKey.configured).toBe(false)
    if (blankKey.configured)
      return
    expect(blankKey.invalid).toContain(memoryClientEnv.apiKey)
  })
})

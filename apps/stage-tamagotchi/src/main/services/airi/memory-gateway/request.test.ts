import { describe, expect, it } from 'vitest'

import { assertMemoryGatewayBody, forwardedHeaders, memoryGatewayBodyLimit, memoryGatewayTarget } from './request'

describe('memory gateway request', () => {
  it('adds the default service id and drops other headers', () => {
    expect(forwardedHeaders({
      'Content-Type': 'application/json',
      'Authorization': 'Bearer local',
      'X-Request-Id': 'req-1',
    })).toEqual({
      'content-type': 'application/json',
      'authorization': 'Bearer local',
      'x-tdai-service-id': 'default',
    })
  })

  it('keeps a custom service id', () => {
    expect(forwardedHeaders({
      'x-tdai-service-id': 'service-1',
    })['x-tdai-service-id']).toBe('service-1')
  })

  it('accepts a /v3/ URL on the configured endpoint', () => {
    const target = memoryGatewayTarget('http://127.0.0.1:8420', 'http://127.0.0.1:8420/v3/conversation/search')
    expect(target.pathname).toBe('/v3/conversation/search')
  })

  it('rejects a URL outside the endpoint, a credential, and a path outside /v3/', () => {
    expect(() => memoryGatewayTarget('http://127.0.0.1:8420', 'http://192.0.2.1/v3/conversation/search')).toThrow('outside the configured endpoint')
    expect(() => memoryGatewayTarget('http://127.0.0.1:8420', 'http://user:pass@127.0.0.1:8420/v3/conversation/search')).toThrow('credentials')
    expect(() => memoryGatewayTarget('http://127.0.0.1:8420', 'file:///tmp/vectors.db')).toThrow('http or https')
    expect(() => memoryGatewayTarget('http://127.0.0.1:8420', 'http://127.0.0.1:8420/health')).toThrow('must stay on /v3/')
  })

  it('rejects a body over the limit', () => {
    expect(() => assertMemoryGatewayBody('a'.repeat(memoryGatewayBodyLimit + 1))).toThrow('too large')
    expect(() => assertMemoryGatewayBody(undefined)).not.toThrow()
  })
})

import type { AddressInfo } from 'node:net'

import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'

import { afterEach, describe, expect, it } from 'vitest'

import { createMemoryClient, MemoryClientError, serviceIdHeader } from '../src/memory-client'
import { searchLongTerm } from '../src/memory-core-contract'

const secret = 'example-key'
const endpointPath = '/v3/conversation/add'

interface CapturedRequest {
  url?: string
  authorization?: string
  serviceId?: string
  requestId?: string
  body: unknown
}

const servers: Array<{ close: () => Promise<void> }> = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()))
})

async function fakeGateway(handler: (request: CapturedRequest) => { status?: number, body: unknown }) {
  const captured: CapturedRequest[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))

    const text = Buffer.concat(chunks).toString('utf8')
    const capturedRequest: CapturedRequest = {
      url: request.url,
      authorization: request.headers.authorization,
      serviceId: headerValue(request.headers['x-tdai-service-id']),
      requestId: headerValue(request.headers['x-request-id']),
      body: text ? JSON.parse(text) as unknown : undefined,
    }
    captured.push(capturedRequest)
    const result = handler(capturedRequest)
    response.writeHead(result.status ?? 200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(result.body))
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address() as AddressInfo
  servers.push({
    close: () => new Promise(resolve => server.close(() => resolve())),
  })

  return {
    captured,
    endpoint: `http://127.0.0.1:${address.port}`,
  }
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function client(endpoint: string, extras: { apiKey?: string, serviceId?: string } = {}) {
  return createMemoryClient({
    endpoint,
    teamId: 'team-1',
    userId: 'user-1',
    agentId: 'card-1',
    apiKey: 'local',
    serviceId: 'default',
    ...extras,
  })
}

describe('memory v3 client', () => {
  it('adds and searches L0 with the stable ids and the default key', async () => {
    const gateway = await fakeGateway((request) => {
      if (request.url === endpointPath) {
        return {
          body: {
            code: 0,
            message: 'ok',
            request_id: 'req-1',
            data: { accepted_ids: ['msg-1'], accepted_versions: ['v1'], total_count: 1 },
          },
        }
      }

      return {
        body: {
          code: 0,
          message: 'ok',
          data: {
            messages: [{
              id: 'msg-1',
              version: 'v1',
              role: 'user',
              content: 'AIRI memory smoke',
              score: 1,
              session_id: 'sess-1',
              team_id: 'team-1',
              user_id: 'user-1',
              agent_id: 'card-1',
            }],
          },
        },
      }
    })
    const memory = client(gateway.endpoint)

    const added = await memory.addConversation({
      sessionId: 'sess-1',
      messages: [{ role: 'user', content: 'AIRI memory smoke' }],
    })
    const found = await memory.searchConversation({ query: 'AIRI memory smoke', sessionId: 'sess-1', limit: 5 })

    expect(added).toEqual({ acceptedIds: ['msg-1'], acceptedVersions: ['v1'], totalCount: 1 })
    expect(found.messages).toEqual([{
      id: 'msg-1',
      version: 'v1',
      role: 'user',
      content: 'AIRI memory smoke',
      score: 1,
      sessionId: 'sess-1',
      teamId: 'team-1',
      userId: 'user-1',
      agentId: 'card-1',
    }])
    expect(gateway.captured[0]?.authorization).toBe('Bearer local')
    expect(gateway.captured[0]?.serviceId).toBe('default')
    expect(gateway.captured[0]?.requestId).toBeUndefined()
    expect(gateway.captured[0]?.body).toMatchObject({
      team_id: 'team-1',
      agent_id: 'card-1',
      user_id: 'user-1',
      session_id: 'sess-1',
    })
    expect(gateway.captured[1]?.body).toMatchObject({
      query: 'AIRI memory smoke',
      session_id: 'sess-1',
      limit: 5,
    })
  })

  it('omits session_id for a long-term search', async () => {
    const gateway = await fakeGateway(() => ({
      body: {
        code: 0,
        message: 'ok',
        data: { messages: [] },
      },
    }))
    const memory = client(gateway.endpoint)

    await searchLongTerm(memory, { query: '西瓜', agentId: 'card-1', limit: 5 })

    expect(gateway.captured[0]?.body).toMatchObject({
      query: '西瓜',
      team_id: 'team-1',
      user_id: 'user-1',
      agent_id: 'card-1',
      limit: 5,
    })
    expect(gateway.captured[0]?.body).not.toHaveProperty('session_id')
  })

  it('sends the bearer token and the service id when they are set', async () => {
    const gateway = await fakeGateway(() => ({
      body: {
        code: 0,
        message: 'ok',
        data: { accepted_ids: ['msg-1'], accepted_versions: ['v1'], total_count: 1 },
      },
    }))
    const memory = client(gateway.endpoint, { apiKey: secret, serviceId: 'service-1' })

    await memory.addConversation({
      sessionId: 'sess-1',
      messages: [{ role: 'assistant', content: 'Noted' }],
    })

    expect(gateway.captured[0]?.authorization).toBe(`Bearer ${secret}`)
    expect(gateway.captured[0]?.serviceId).toBe('service-1')
    expect(gateway.captured[0]?.requestId).toBeUndefined()
  })

  it('omits the default service id from a browser document and keeps a custom id', () => {
    expect(serviceIdHeader('default', true)).toEqual({})
    expect(serviceIdHeader('service-1', true)).toEqual({ 'x-tdai-service-id': 'service-1' })
    expect(serviceIdHeader('default', false)).toEqual({ 'x-tdai-service-id': 'default' })
  })

  it('redacts the key and the endpoint from a gateway error', async () => {
    let endpoint = ''
    const gateway = await fakeGateway(() => ({
      status: 401,
      body: {
        code: 401,
        message: `rejected ${secret} at ${endpoint}`,
      },
    }))
    endpoint = gateway.endpoint
    const memory = client(gateway.endpoint, { apiKey: secret })

    const error = await memory.addConversation({
      sessionId: 'sess-1',
      messages: [{ role: 'user', content: 'Hello' }],
    }).catch(caught => caught)

    expect(error).toBeInstanceOf(MemoryClientError)
    expect(error).toMatchObject({ status: 401, code: 401, path: endpointPath })
    expect((error as Error).message).not.toContain(secret)
    expect((error as Error).message).not.toContain(gateway.endpoint)
    expect((error as Error).message).toContain('[redacted]')
  })

  it('does not send a request for an empty message', async () => {
    const gateway = await fakeGateway(() => ({ body: { code: 0, message: 'ok', data: {} } }))
    const memory = client(gateway.endpoint)

    await expect(memory.addConversation({
      sessionId: 'sess-1',
      messages: [{ role: 'user', content: '' }],
    })).rejects.toBeInstanceOf(MemoryClientError)
    expect(gateway.captured).toEqual([])
  })

  it('sends an ISO timestamp and rejects a number', async () => {
    const gateway = await fakeGateway(() => ({
      body: {
        code: 0,
        message: 'ok',
        data: { accepted_ids: ['msg-1'], accepted_versions: ['v1'], total_count: 1 },
      },
    }))
    const memory = client(gateway.endpoint)

    await memory.addConversation({
      sessionId: 'sess-1',
      messages: [{ role: 'user', content: 'Hello', timestamp: '2026-11-01T00:00:00Z' }],
    })
    const numericTime: { role: 'user', content: string, timestamp?: string } = { role: 'user', content: 'Hello' }
    Object.assign(numericTime, { timestamp: 1 })
    await expect(memory.addConversation({
      sessionId: 'sess-1',
      messages: [numericTime],
    })).rejects.toBeInstanceOf(MemoryClientError)

    expect(gateway.captured).toHaveLength(1)
    expect(gateway.captured[0]?.body).toMatchObject({
      messages: [{ timestamp: '2026-11-01T00:00:00Z' }],
    })
  })

  it('reads L1 atoms, L2 scenes, and an L3 persona', async () => {
    const gateway = await fakeGateway((request) => {
      if (request.url === '/v3/atomic/query') {
        return {
          body: {
            code: 0,
            message: 'ok',
            data: {
              items: [{
                id: 'atom-1',
                version: 1,
                type: 'instruction',
                content: '先提饮品。',
                background: '饮品',
                updated_at: '2026-11-01T00:00:00Z',
              }],
              total: 1,
            },
          },
        }
      }
      if (request.url === '/v3/scenario/ls') {
        return {
          body: {
            code: 0,
            message: 'ok',
            data: {
              entries: [{ path: 'drinks.md', version: 1, summary: 'Drinks', updated_at: '2026-11-02T00:00:00Z' }],
              total: 1,
            },
          },
        }
      }
      return {
        body: {
          code: 0,
          message: 'ok',
          data: {
            content: '# Calm\n\nTea.',
            version: 2,
            updated_at: '2026-11-03T00:00:00Z',
          },
        },
      }
    })
    const memory = client(gateway.endpoint)

    const atoms = await memory.queryAtomic({ limit: 20, offset: 0 })
    const scenes = await memory.listScenarios({})
    const core = await memory.readCore({})

    expect(atoms.items[0]).toMatchObject({ id: 'atom-1', version: 1, type: 'instruction', content: '先提饮品。' })
    expect(scenes.entries[0]).toMatchObject({ path: 'drinks.md', summary: 'Drinks' })
    expect(core.content).toContain('# Calm')
    expect(gateway.captured[0]?.body).toMatchObject({ team_id: 'team-1', user_id: 'user-1', agent_id: 'card-1', limit: 20 })
    expect(gateway.captured[0]?.authorization).toBe('Bearer local')
    expect(gateway.captured[0]?.requestId).toBeUndefined()
  })

  it('sends message ids without a session id', async () => {
    const gateway = await fakeGateway((request) => {
      const body = request.body as { message_ids?: string[], session_ids?: string[] }
      if (body.session_ids)
        return { body: { code: 0, message: 'ok', data: { deleted_count: 4 } } }
      return { body: { code: 0, message: 'ok', data: { deleted_count: body.message_ids?.length === 1 ? 4 : 1 } } }
    })
    const memory = client(gateway.endpoint)

    await expect(memory.deleteConversation({ messageIds: ['msg-1'] })).resolves.toEqual({ deletedCount: 4 })
    await expect(memory.deleteConversation({ messageIds: ['msg-1'], sessionIds: ['session-1'] })).rejects.toThrow('Delete message ids or session ids, not both.')
    await expect(memory.deleteConversation({ sessionIds: ['session-1'] })).resolves.toEqual({ deletedCount: 4 })

    expect(gateway.captured[0]?.body).toEqual({
      team_id: 'team-1',
      agent_id: 'card-1',
      user_id: 'user-1',
      message_ids: ['msg-1'],
    })
    expect(gateway.captured[1]?.body).toEqual({
      team_id: 'team-1',
      agent_id: 'card-1',
      user_id: 'user-1',
      session_ids: ['session-1'],
    })
    expect(gateway.captured[0]?.body).not.toHaveProperty('session_id')
  })

  it('treats a missing persona file as empty content', async () => {
    const gateway = await fakeGateway(() => ({
      body: {
        code: 0,
        message: 'ok',
        data: { content: null, version: null, created_at: null, updated_at: null },
      },
    }))
    const memory = client(gateway.endpoint)

    await expect(memory.readCore({})).resolves.toMatchObject({ content: null })
  })
})

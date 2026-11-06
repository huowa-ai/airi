import { describe, expect, it } from 'vitest'

import { readCallTurns } from '../src/call-turns'
import { createMemoryClient } from '../src/memory-client'

const callId = '11111111-1111-4111-8111-111111111111'
const typed = `<!-- airi:meta callId=${callId} source=text -->\nAda likes tea.`

function scriptedFetch(routes: Record<string, (body: { agent_id?: string }) => unknown>): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const body = JSON.parse(String(init?.body ?? '{}')) as { agent_id?: string }
    const path = new URL(url).pathname
    const handler = routes[path]
    if (!handler)
      return Response.json({ code: 1, message: `Missing route ${path}`, data: null }, { status: 404 })
    return Response.json({ code: 0, message: 'ok', data: handler(body) })
  }
}

describe('readCallTurns', () => {
  it('keeps a typed turn and drops a row with no header', async () => {
    const fetchImpl = scriptedFetch({
      '/v3/conversation/query': (body) => {
        if (body.agent_id === 'airi:directory') {
          return {
            messages: [{ id: 'dir-1', version: 1, role: 'assistant', content: JSON.stringify({ kind: 'airi-directory', personas: ['card-1'], clearedAt: 0 }) }],
            total: 1,
          }
        }
        if (body.agent_id === 'card-1') {
          return {
            messages: [
              { id: 'fact-1', version: 1, role: 'assistant', content: '{"kind":"airi-fact"}', session_id: 'airi:facts' },
              { id: 'msg-1', version: 1, role: 'user', content: typed, session_id: 'session-1' },
            ],
            total: 2,
          }
        }
        return { messages: [], total: 0 }
      },
    })
    const client = createMemoryClient({
      endpoint: 'http://127.0.0.1:8420',
      teamId: 'team-1',
      userId: 'user-1',
      agentId: 'airi:general',
      apiKey: 'local',
      serviceId: 'default',
    }, { fetch: fetchImpl })

    const turns = await readCallTurns(client)

    expect(turns).toEqual([{
      id: 'msg-1',
      agentId: 'card-1',
      sessionId: 'session-1',
      role: 'user',
      body: 'Ada likes tea.',
      callId,
      source: 'text',
    }])
  })
})

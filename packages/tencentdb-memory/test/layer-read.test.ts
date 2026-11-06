import { describe, expect, it } from 'vitest'

import { readMemoryLayers } from '../src/layer-read'
import { createMemoryClient } from '../src/memory-client'

const directory = {
  kind: 'airi-directory',
  personas: ['card-1'],
  clearedAt: 0,
}

function scriptedFetch(routes: Record<string, (body: { agent_id?: string, path?: string }) => unknown>): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const body = JSON.parse(String(init?.body ?? '{}')) as { agent_id?: string, path?: string }
    const path = new URL(url).pathname
    const handler = routes[path]
    if (!handler)
      return Response.json({ code: 1, message: `Missing route ${path}`, data: null }, { status: 404 })
    return Response.json({ code: 0, message: 'ok', data: handler(body) })
  }
}

describe('readMemoryLayers', () => {
  it('keeps atoms for the user, skips scene directories, and keeps one persona', async () => {
    const fetchImpl = scriptedFetch({
      '/v3/conversation/query': body => ({
        messages: body.agent_id === 'airi:directory'
          ? [{ id: 'dir-1', version: 1, role: 'user', content: JSON.stringify(directory) }]
          : [],
        total: body.agent_id === 'airi:directory' ? 1 : 0,
      }),
      '/v3/atomic/query': body => ({
        items: body.agent_id === 'card-1'
          ? [{ id: 'atom-1', version: 1, type: 'persona', content: '下午喝茶。', updated_at: '2026-11-01T00:00:00Z' }]
          : [],
        total: body.agent_id === 'card-1' ? 1 : 0,
      }),
      '/v3/scenario/ls': body => ({
        entries: body.agent_id === 'airi:general'
          ? [
              { path: 'notes/', version: 0, updated_at: '2026-11-01T00:00:00Z' },
              { path: 'drinks.md', version: 1, summary: 'Drink habits', updated_at: '2026-11-02T00:00:00Z' },
            ]
          : [],
        total: body.agent_id === 'airi:general' ? 2 : 0,
      }),
      '/v3/scenario/read': () => ({
        path: 'drinks.md',
        version: 1,
        content: 'Tea in the afternoon.',
        updated_at: '2026-11-02T00:00:00Z',
      }),
      '/v3/core/read': body => ({
        content: body.agent_id === 'airi:general' ? '# Calm companion\n\nTea.' : null,
        version: body.agent_id === 'airi:general' ? 1 : null,
        updated_at: body.agent_id === 'airi:general' ? '2026-11-03T00:00:00Z' : null,
      }),
    })
    const client = createMemoryClient({
      endpoint: 'http://127.0.0.1:8420',
      teamId: 'team-1',
      userId: 'user-1',
      agentId: 'airi:general',
      apiKey: 'local',
      serviceId: 'default',
    }, { fetch: fetchImpl })

    const layers = await readMemoryLayers(client)

    expect(layers.atoms.status).toBe('ready')
    expect(layers.atoms.items).toEqual([{
      id: 'atom-1',
      agentId: 'card-1',
      type: 'persona',
      content: '下午喝茶。',
      updatedAt: Date.parse('2026-11-01T00:00:00Z'),
    }])
    expect(layers.scenes.items.map(item => item.path)).toEqual(['drinks.md'])
    expect(layers.scenes.items[0]?.content).toBe('Tea in the afternoon.')
    expect(layers.cores.items).toHaveLength(1)
    expect(layers.cores.items[0]).toMatchObject({ agentId: 'airi:general', content: '# Calm companion\n\nTea.' })
  })

  it('returns an error for a failed layer and still returns the others', async () => {
    const fetchImpl = scriptedFetch({
      '/v3/conversation/query': () => ({ messages: [], total: 0 }),
      '/v3/atomic/query': () => {
        throw new Error('atomic down')
      },
      '/v3/scenario/ls': () => ({ entries: [], total: 0 }),
      '/v3/core/read': () => ({ content: null }),
    })
    const client = createMemoryClient({
      endpoint: 'http://127.0.0.1:8420',
      teamId: 'team-1',
      userId: 'user-1',
      agentId: 'airi:general',
      apiKey: 'local',
      serviceId: 'default',
    }, { fetch: fetchImpl })

    const layers = await readMemoryLayers(client)

    expect(layers.atoms.status).toBe('error')
    expect(layers.atoms.items).toEqual([])
    expect(layers.scenes.status).toBe('ready')
    expect(layers.cores.status).toBe('ready')
    expect(layers.cores.items).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'

import { createMemoryClient, memoryClientEnv, readMemoryClientConfig } from '../src'
import { createRemoteMemoryStorage, factAgentId } from '../src/remote-memory'

const live = process.env.LIVE_MEMORY_CORE === '1'

describe.skipIf(!live)('live MemoryCore L0', () => {
  it('writes one card fact, recalls it, and hides it from another card', async () => {
    const config = readMemoryClientConfig({
      [memoryClientEnv.endpoint]: process.env.TENCENTDB_MEMORY_ENDPOINT,
      [memoryClientEnv.teamId]: 'team-example',
      [memoryClientEnv.userId]: 'user-example',
      [memoryClientEnv.agentId]: 'card-1',
      [memoryClientEnv.apiKey]: process.env.TENCENTDB_MEMORY_API_KEY,
      [memoryClientEnv.serviceId]: process.env.TENCENTDB_MEMORY_SERVICE_ID,
    })
    expect(config.configured).toBe(true)
    if (!config.configured)
      return

    const client = createMemoryClient(config.config)
    const storage = createRemoteMemoryStorage(client)
    const marker = `tea-${Date.now()}`
    const saved = await storage.write({ description: 'Drink', body: `Ada likes ${marker}` }, 'card-1', Date.now())

    expect(saved.outcome).toBe('saved')
    if (saved.outcome !== 'saved')
      return

    const entries = await storage.list()
    expect(entries.some(entry => entry.id === saved.entry.id && entry.persona === 'card-1')).toBe(true)

    const other = await client.queryConversation({ agentId: factAgentId('card-2'), sessionId: 'airi:facts', limit: 20 })
    expect(other.messages.some(message => message.content.includes(marker))).toBe(false)

    let hits = 0
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const found = await client.searchConversation({
        query: marker,
        agentId: factAgentId('card-1'),
        sessionId: 'airi:facts',
        limit: 5,
      })
      hits = found.messages.length
      if (hits > 0)
        break
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    expect(hits).toBeGreaterThan(0)
  }, 20_000)
})

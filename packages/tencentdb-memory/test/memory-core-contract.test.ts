import type { MemoryV3Client } from '../src/memory-client'

import { describe, expect, it, vi } from 'vitest'

import { memoryClientEnv, readMemoryClientConfig } from '../src/client-config'
import { createMemoryClient, MemoryClientError } from '../src/memory-client'
import { batchStartsExtraction, deleteExactMessages, factRecordRole, memoryCoreCapabilities } from '../src/memory-core-contract'

describe('memoryCore contract', () => {
  it('keeps fact batches off the extraction path', () => {
    expect(memoryCoreCapabilities.extractsOnUserMessage).toBe(true)
    expect(memoryCoreCapabilities.longTermSearchOmitsSession).toBe(true)
    expect(factRecordRole()).toBe('assistant')
    expect(batchStartsExtraction([{ role: factRecordRole() }])).toBe(false)
    expect(batchStartsExtraction([
      { role: 'user' },
      { role: 'assistant' },
    ])).toBe(true)
  })

  it('refuses a message delete whose count is not the id count', async () => {
    const calls: Array<{ messageIds?: string[], sessionIds?: string[] }> = []
    const client: MemoryV3Client = {
      async addConversation() {
        return { acceptedIds: [], acceptedVersions: [], totalCount: 0 }
      },
      async searchConversation() {
        return { messages: [] }
      },
      async queryConversation() {
        return { messages: [], total: 0 }
      },
      async deleteConversation(input) {
        calls.push({ messageIds: input.messageIds, sessionIds: input.sessionIds })
        return { deletedCount: 4 }
      },
      async deleteAtomic() {
        return { deletedCount: 0 }
      },
      async queryAtomic() {
        return { items: [], total: 0 }
      },
      async removeScenario() {
        return undefined
      },
      async listScenarios() {
        return { entries: [], total: 0 }
      },
      async readScenario(input) {
        return { path: input.path, content: null }
      },
      async readCore() {
        return { content: null }
      },
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(deleteExactMessages(client, { agentId: 'card-1', messageIds: ['msg-1'] })).rejects.toBeInstanceOf(MemoryClientError)
    await expect(deleteExactMessages(client, { agentId: 'card-1', messageIds: ['msg-1'] })).rejects.toThrow('Delete removed 4 records. Expected 1.')

    expect(calls).toEqual([
      { messageIds: ['msg-1'], sessionIds: undefined },
      { messageIds: ['msg-1'], sessionIds: undefined },
    ])
    expect(calls[0]).not.toHaveProperty('sessionIds', ['session-1'])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('accepts a message delete when the count matches the ids', async () => {
    const client: MemoryV3Client = {
      async addConversation() {
        return { acceptedIds: [], acceptedVersions: [], totalCount: 0 }
      },
      async searchConversation() {
        return { messages: [] }
      },
      async queryConversation() {
        return { messages: [], total: 0 }
      },
      async deleteConversation(input) {
        return { deletedCount: input.messageIds?.length ?? 0 }
      },
      async deleteAtomic() {
        return { deletedCount: 0 }
      },
      async queryAtomic() {
        return { items: [], total: 0 }
      },
      async removeScenario() {
        return undefined
      },
      async listScenarios() {
        return { entries: [], total: 0 }
      },
      async readScenario(input) {
        return { path: input.path, content: null }
      },
      async readCore() {
        return { content: null }
      },
    }

    await expect(deleteExactMessages(client, { agentId: 'card-1', messageIds: ['msg-1', 'msg-2'] })).resolves.toEqual({ deletedCount: 2 })
    await expect(deleteExactMessages(client, { agentId: 'card-1', messageIds: [] })).resolves.toEqual({ deletedCount: 0 })
  })
})

const live = process.env.LIVE_MEMORY_CORE === '1'

describe.skipIf(!live)('live MemoryCore contract', () => {
  it('does not extract a fact-only batch', async () => {
    const client = liveClient()
    const marker = `fact-only-${Date.now()}`
    const agentId = `contract-fact-${Date.now()}`

    await client.addConversation({
      agentId,
      sessionId: 'airi:facts',
      messages: [{ role: factRecordRole(), content: `Stored fact ${marker}` }],
    })

    let extracted = false
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const page = await client.queryAtomic({ agentId, limit: 20, offset: 0 })
      extracted = page.items.some(item => item.content.includes(marker)) || page.total > 0
      if (extracted)
        break
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    expect(extracted, 'The gateway extracted a fact-only batch. Extraction must start only when the batch has a user message.').toBe(false)
  }, 20_000)

  it('deletes one message id and leaves the other row in the session', async () => {
    const client = liveClient()
    const marker = `exact-delete-${Date.now()}`
    const agentId = `contract-delete-${Date.now()}`
    const sessionId = `session-${marker}`
    const added = await client.addConversation({
      agentId,
      sessionId,
      messages: [
        { role: 'user', content: `Keep ${marker}` },
        { role: 'assistant', content: `Drop ${marker}` },
      ],
    })
    const keepId = added.acceptedIds[0]
    const dropId = added.acceptedIds[1]
    expect(keepId).toBeTruthy()
    expect(dropId).toBeTruthy()
    if (!keepId || !dropId)
      return

    await expect(deleteExactMessages(client, { agentId, messageIds: [dropId] })).resolves.toEqual({ deletedCount: 1 })

    const page = await client.queryConversation({ agentId, sessionId, limit: 20 })
    expect(page.messages.map(message => message.id)).toEqual([keepId])

    await deleteExactMessages(client, { agentId, messageIds: [keepId] }).catch(() => {})
  }, 20_000)
})

function liveClient() {
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
    throw new Error('Set the live MemoryCore address before this contract test.')
  return createMemoryClient(config.config)
}

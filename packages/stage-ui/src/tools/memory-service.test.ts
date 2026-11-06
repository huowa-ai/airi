import type { MemoryV3Client } from '@proj-airi/tencentdb-memory'

import { createRemoteMemoryStorage } from '@proj-airi/tencentdb-memory'
import { describe, expect, it } from 'vitest'

import { createMemoryTools, READ_MEMORY_TOOL_NAME, WRITE_MEMORY_TOOL_NAME } from './memory'

interface Row {
  id: string
  agentId: string
  sessionId: string
  content: string
}

function gateway(): MemoryV3Client {
  const rows: Row[] = []
  let nextId = 1
  return {
    async addConversation(input) {
      const acceptedIds = input.messages.map((message) => {
        const id = `msg-${nextId}`
        nextId += 1
        rows.push({ id, agentId: input.agentId ?? '', sessionId: input.sessionId, content: message.content })
        return id
      })
      return { acceptedIds, acceptedVersions: acceptedIds.map(() => 'v1'), totalCount: acceptedIds.length }
    },
    async searchConversation() {
      return { messages: [] }
    },
    async queryConversation(input) {
      const messages = rows
        .filter(row => row.agentId === (input.agentId ?? '') && row.sessionId === input.sessionId)
        .map(row => ({ id: row.id, version: 'v1' as const, role: 'user' as const, content: row.content }))
      return { messages, total: messages.length }
    },
    async deleteConversation(input) {
      const ids = new Set(input.messageIds ?? [])
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (rows[index] && ids.has(rows[index].id))
          rows.splice(index, 1)
      }
      return { deletedCount: 0 }
    },
    async queryAtomic() {
      return { items: [], total: 0 }
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
    async deleteAtomic() {
      return { deletedCount: 0 }
    },
    async removeScenario() {
      return undefined
    },
  }
}

describe('memory tools on the memory service', () => {
  it('saves a fact through the chat tool and reads it back for that card only', async () => {
    const storage = createRemoteMemoryStorage(gateway())
    const card = 'card-1'
    const tools = await createMemoryTools({
      read: () => undefined,
      write: async (input) => {
        const result = await storage.write(input, card, 5)
        return result.outcome === 'saved' || result.outcome === 'unchanged' ? result.entry : undefined
      },
      forget: async () => false,
    })
    const write = tools.find(tool => tool.function.name === WRITE_MEMORY_TOOL_NAME)
    const saved = await write!.execute({
      entries: [{ id: null, description: 'Drink', body: 'Ada likes tea' }],
    }, { messages: [], toolCallId: 'call' })

    expect(saved).toContain('Saved memory')
    const entries = await storage.list()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ description: 'Drink', body: 'Ada likes tea', persona: card })

    const reader = await createMemoryTools({
      read: id => entries.find(entry => entry.id === id && (!entry.persona || entry.persona === card)),
      write: async () => undefined,
      forget: async () => false,
    })
    const read = reader.find(tool => tool.function.name === READ_MEMORY_TOOL_NAME)
    const text = await read!.execute({ ids: [entries[0]!.id] }, { messages: [], toolCallId: 'read' })
    expect(text).toContain('Ada likes tea')
    expect(text).toContain('yours')
  })
})

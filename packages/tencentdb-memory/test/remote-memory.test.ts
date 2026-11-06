import type { MemoryV3Client } from '../src/memory-client'

import { describe, expect, it } from 'vitest'

import { appendConversation } from '../src/conversation-write'
import { batchStartsExtraction } from '../src/memory-core-contract'
import { createRemoteMemoryStorage, factSessionId } from '../src/remote-memory'

interface Row {
  id: string
  agentId: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
}

function gateway(): MemoryV3Client & { rows: Row[], extractions: Array<{ agentId: string, sessionId: string }> } {
  const rows: Row[] = []
  const extractions: Array<{ agentId: string, sessionId: string }> = []
  let nextId = 1

  return {
    rows,
    extractions,
    async addConversation(input) {
      const acceptedIds = input.messages.map((message) => {
        const id = `msg-${nextId}`
        nextId += 1
        rows.push({
          id,
          agentId: input.agentId ?? '',
          sessionId: input.sessionId,
          role: message.role,
          content: message.content,
        })
        return id
      })
      if (batchStartsExtraction(input.messages))
        extractions.push({ agentId: input.agentId ?? '', sessionId: input.sessionId })
      return { acceptedIds, acceptedVersions: acceptedIds.map(() => 'v1'), totalCount: acceptedIds.length }
    },
    async searchConversation(input) {
      const messages = rows
        .filter(row => row.agentId === (input.agentId ?? '') && row.content.includes(input.query))
        .filter(row => input.sessionId === undefined || row.sessionId === input.sessionId)
        .map(hit)
      return { messages }
    },
    async queryConversation(input) {
      const matched = rows.filter(row => row.agentId === (input.agentId ?? '') && (input.sessionId === undefined || row.sessionId === input.sessionId))
      const offset = input.offset ?? 0
      const limit = input.limit ?? matched.length
      return {
        messages: matched.slice(offset, offset + limit).map(hit),
        total: matched.length,
      }
    },
    async deleteConversation(input) {
      const ids = new Set(input.messageIds ?? [])
      const sessions = new Set(input.sessionIds ?? [])
      const before = rows.length
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        const row = rows[index]
        if (!row || row.agentId !== (input.agentId ?? ''))
          continue
        if (ids.has(row.id) || sessions.has(row.sessionId))
          rows.splice(index, 1)
      }
      return { deletedCount: before - rows.length }
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

function hit(row: Row) {
  return {
    id: row.id,
    version: 'v1' as const,
    role: 'user' as const,
    content: row.content,
    sessionId: row.sessionId,
    agentId: row.agentId,
  }
}

describe('remote memory storage', () => {
  it('writes a fact for one card and does not show it as another card fact', async () => {
    const client = gateway()
    const storage = createRemoteMemoryStorage(client)

    const saved = await storage.write({ description: 'Name', body: 'Ada likes tea' }, 'card-1', 4)
    const entries = await storage.list()

    expect(saved).toMatchObject({ outcome: 'saved', entry: { description: 'Name', body: 'Ada likes tea', persona: 'card-1' } })
    expect(entries.map(entry => entry.persona)).toEqual(['card-1'])
    const factRows = client.rows.filter(row => row.sessionId === factSessionId)
    expect(factRows.map(row => row.agentId)).toEqual(['card-1'])
    expect(factRows.every(row => row.role === 'assistant')).toBe(true)
    expect(batchStartsExtraction(factRows)).toBe(false)
    expect(client.extractions).toEqual([])
    const otherCard = await client.queryConversation({ agentId: 'card-2', sessionId: factSessionId })
    expect(otherCard.messages).toEqual([])
    const found = await client.searchConversation({ query: 'tea', agentId: 'card-1', sessionId: factSessionId })
    expect(found.messages).toHaveLength(1)

    await appendConversation(client, {
      agentId: 'card-1',
      sessionId: 'session-chat',
      messages: [
        { role: 'user', content: 'Ada likes tea' },
        { role: 'assistant', content: 'I will remember that.' },
      ],
    })
    expect(client.extractions).toEqual([{ agentId: 'card-1', sessionId: 'session-chat' }])
  })

  it('keeps a general fact off the card agent after makeGeneral', async () => {
    const storage = createRemoteMemoryStorage(gateway())
    const saved = await storage.write({ id: 'fact-1', description: 'Name', body: 'Ada' }, 'card-1', 2)
    expect(saved.outcome).toBe('saved')
    await storage.makeGeneral('fact-1', 3)

    const entries = await storage.list()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.persona).toBeUndefined()
    expect(entries[0]?.id).toBe('fact-1')
  })

  it('does not let a card forget a general fact', async () => {
    const storage = createRemoteMemoryStorage(gateway())
    await storage.write({ id: 'fact-1', description: 'Name', body: 'Ada' }, 'card-1', 2)
    await storage.makeGeneral('fact-1', 3)

    expect(await storage.forget('fact-1', 'card-1', 4)).toBe(false)
    expect(await storage.list()).toHaveLength(1)
  })
})

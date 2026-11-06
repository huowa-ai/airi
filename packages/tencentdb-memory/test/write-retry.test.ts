import type { AddConversationInput, MemoryV3Client } from '../src/memory-client'

import { describe, expect, it } from 'vitest'

import { deliverConversation } from '../src/conversation-write'

interface StoredRow {
  id: string
  role: 'user' | 'assistant'
  content: string
  sessionId: string
  teamId: string
  userId: string
  agentId: string
}

/**
 * A gateway that stores the batch, then drops the success response.
 * The next retry must see the stored rows and skip a second write.
 */
function droppingGateway(drop = true) {
  const rows: StoredRow[] = []
  let dropNext = drop
  let adds = 0

  const client: MemoryV3Client = {
    async addConversation(input) {
      adds += 1
      const acceptedIds = input.messages.map((_, index) => `msg-${rows.length + index + 1}`)
      input.messages.forEach((message, index) => {
        rows.push({
          id: acceptedIds[index] ?? `msg-${rows.length + 1}`,
          role: message.role,
          content: message.content,
          sessionId: input.sessionId,
          teamId: input.teamId ?? '',
          userId: input.userId ?? '',
          agentId: input.agentId ?? '',
        })
      })
      if (dropNext) {
        dropNext = false
        throw new Error('MemoryCore response was lost.')
      }
      return { acceptedIds, acceptedVersions: acceptedIds.map(() => 'v1'), totalCount: acceptedIds.length }
    },
    async searchConversation() {
      return { messages: [] }
    },
    async queryConversation(input) {
      const matched = rows.filter(row => row.agentId === (input.agentId ?? '')
        && row.sessionId === (input.sessionId ?? row.sessionId)
        && row.teamId === (input.teamId ?? '')
        && row.userId === (input.userId ?? ''))
      const offset = input.offset ?? 0
      const limit = input.limit ?? matched.length
      return {
        messages: matched.slice(offset, offset + limit).map(row => ({
          id: row.id,
          version: 'v1',
          role: row.role,
          content: row.content,
          sessionId: row.sessionId,
          teamId: row.teamId,
          userId: row.userId,
          agentId: row.agentId,
        })),
        total: matched.length,
      }
    },
    async deleteConversation() {
      return { deletedCount: 0 }
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

  return { client, rows, adds: () => adds }
}

const batch: AddConversationInput = {
  sessionId: 'session-1',
  agentId: 'card-1',
  teamId: 'u_local_ada',
  userId: 'ada',
  messages: [
    { role: 'user', content: 'Ada likes tea.' },
    { role: 'assistant', content: 'Tea is a good drink.' },
  ],
}

describe('write retry after a lost success', () => {
  it('skips the second write when the first response was dropped', async () => {
    const gateway = droppingGateway()

    await expect(deliverConversation(gateway.client, batch)).rejects.toThrow('MemoryCore response was lost.')
    expect(gateway.rows).toHaveLength(2)
    expect(gateway.adds()).toBe(1)

    const retry = await deliverConversation(gateway.client, { ...batch, retry: true })

    expect(retry.alreadyStored).toBe(true)
    expect(retry.acceptedIds).toEqual(['msg-1', 'msg-2'])
    expect(gateway.adds()).toBe(1)
    expect(gateway.rows).toHaveLength(2)
  })

  it('writes again when the scope does not already contain the batch', async () => {
    const gateway = droppingGateway(false)
    gateway.rows.push({
      id: 'other',
      role: 'user',
      content: 'Ada likes tea.',
      sessionId: 'session-1',
      teamId: 'g_discord_room',
      userId: 'ada',
      agentId: 'card-1',
    })

    const stored = await deliverConversation(gateway.client, { ...batch, retry: true })

    expect(stored.alreadyStored).toBe(false)
    expect(gateway.adds()).toBe(1)
    expect(gateway.rows.filter(row => row.teamId === 'u_local_ada')).toHaveLength(2)
  })
})

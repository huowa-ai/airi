import type { MemoryV3Client } from '../src/memory-client'

import { describe, expect, it } from 'vitest'

import { callHeaderLine, prefixCallHeader, projectCallContent, readCallHeader } from '../src/call-header'
import { decideChatTurn } from '../src/chat-turn'
import { appendConversation } from '../src/conversation-write'
import { formatRecall, mergeRecall } from '../src/recall'

const callId = '11111111-1111-4111-8111-111111111111'
const header = `<!-- airi:meta callId=${callId} source=text -->`
const typed = `${header}\nAda likes tea.`

describe('call header', () => {
  it('writes the header, then a newline, then the body', () => {
    expect(callHeaderLine({ callId, source: 'text' })).toBe(header)
    expect(prefixCallHeader('Ada likes tea.', { callId, source: 'text' })).toBe(typed)
    expect(prefixCallHeader('Ada likes tea.', { source: 'voice' })).toBe('<!-- airi:meta source=voice -->\nAda likes tea.')
    expect(prefixCallHeader('Ada likes tea.', { callId: 'not-a-uuid', source: 'video' })).toBe('<!-- airi:meta source=video -->\nAda likes tea.')
    expect(prefixCallHeader(typed, { callId, source: 'text' })).toBe(typed)
  })

  it('reads the header and strips it for the model and the bubble', () => {
    expect(readCallHeader(typed)).toEqual({ callId, source: 'text' })
    expect(readCallHeader('<!-- airi:meta source=text -->\nAda likes tea.')).toEqual({ source: 'text' })
    expect(projectCallContent(typed)).toBe('Ada likes tea.')
    expect(projectCallContent('Ada likes tea.')).toBe('Ada likes tea.')
    expect(readCallHeader('Ada likes tea.')).toBeUndefined()
    expect(readCallHeader('<!-- airi:meta -->\nAda likes tea.')).toBeUndefined()
  })

  it('adds the header in appendConversation and does not send the fields', async () => {
    const seen: Array<{ callId?: string, source?: string, content: string }> = []
    const client: MemoryV3Client = {
      async addConversation(input) {
        seen.push({
          callId: input.callId,
          source: input.source,
          content: input.messages[0]?.content ?? '',
        })
        return { acceptedIds: ['msg-1'], acceptedVersions: ['v1'], totalCount: 1 }
      },
      async searchConversation() {
        return { messages: [] }
      },
      async queryConversation() {
        return { messages: [], total: 0 }
      },
      async deleteConversation() {
        return { deletedCount: 0 }
      },
      async queryAtomic() {
        return { items: [], total: 0 }
      },
      async deleteAtomic() {
        return { deletedCount: 0 }
      },
      async listScenarios() {
        return { entries: [], total: 0 }
      },
      async readScenario(input) {
        return { path: input.path, content: null }
      },
      async removeScenario() {
        return undefined
      },
      async readCore() {
        return { content: null }
      },
    }

    await appendConversation(client, {
      sessionId: 'session-1',
      agentId: 'card-1',
      callId,
      source: 'text',
      messages: [{ role: 'user', content: 'Ada likes tea.' }],
    })
    await appendConversation(client, {
      sessionId: 'session-1',
      messages: [{ role: 'user', content: typed }],
      callId,
      source: 'text',
    })

    expect(seen.map(item => item.content)).toEqual([typed, typed])
    expect(seen.every(item => item.callId === undefined && item.source === undefined)).toBe(true)
  })

  it('writes source=text on a typed turn and strips it from recall', () => {
    const decision = decideChatTurn({
      sessionId: 'session-1',
      turnId: 'turn-1',
      agentId: 'card-1',
      userText: 'Ada likes tea.',
      assistantText: 'I will remember that.',
      timestamp: '2026-11-01T00:00:00.000Z',
      source: 'text',
    })

    expect(decision.action).toBe('write')
    if (decision.action !== 'write')
      return
    expect(decision.input.messages[0]?.content).toBe('<!-- airi:meta source=text -->\nAda likes tea.')
    expect(decision.input.messages[1]?.content).toBe('<!-- airi:meta source=text -->\nI will remember that.')
    expect(decision.input.source).toBe('text')

    const hits = mergeRecall({
      query: 'tea',
      remote: [{ id: 'msg-1', text: decision.input.messages[0]?.content ?? '', score: 1, at: 1, source: 'remote' }],
      recent: [],
    })
    expect(hits.map(hit => hit.text)).toEqual(['Ada likes tea.'])
    expect(formatRecall(hits)).toBe('Recent memory:\n- Ada likes tea.')
  })
})

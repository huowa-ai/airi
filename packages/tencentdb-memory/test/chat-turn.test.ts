import type { MemoryV3Client } from '../src/memory-client'

import { describe, expect, it } from 'vitest'

import { createChatTurnQueue, decideChatTurn, sanitizeTurnText } from '../src/chat-turn'

const timestamp = '2026-11-01T00:00:00.000Z'

function turn(patch: Partial<Parameters<typeof decideChatTurn>[0]> = {}) {
  return {
    sessionId: 'session-1',
    turnId: 'turn-1',
    agentId: 'card-1',
    userText: 'Ada likes tea.',
    assistantText: 'I will remember that.',
    timestamp,
    ...patch,
  }
}

const memoryBlock = [
  'Long-term memory. You keep it yourself.',
  'Read entries with the memory tool.',
  'Memory index:',
  'Your own:',
  '- tea: Ada likes tea.',
].join('\n')

describe('chat turn capture', () => {
  it('keeps the owner text and the reply, and drops an injected memory block', () => {
    const decision = decideChatTurn(turn({
      userText: `<system>hidden rules</system>\nAda likes tea.`,
      assistantText: `${memoryBlock}\n\nI will remember that.`,
      systemPrompt: 'Format rules. This prompt is long enough to strip from a copied reply. Card identity.',
    }))

    expect(decision.action).toBe('write')
    if (decision.action !== 'write')
      return
    expect(decision.input).toMatchObject({
      sessionId: 'session-1',
      agentId: 'card-1',
      messages: [
        { role: 'user', content: 'Ada likes tea.', timestamp },
        { role: 'assistant', content: 'I will remember that.', timestamp },
      ],
    })
    expect(decision.input.messages[0]?.content).not.toContain('hidden rules')
    expect(decision.input.messages[1]?.content).not.toContain('Memory index:')
  })

  it('skips an empty turn, a pure command, pure emoji, and an image with no caption', () => {
    expect(decideChatTurn(turn({ userText: '   ', assistantText: 'Hi.' }))).toEqual({ action: 'skip', reason: 'empty' })
    expect(decideChatTurn(turn({ assistantText: ' ' }))).toEqual({ action: 'skip', reason: 'empty' })
    expect(decideChatTurn(turn({ userText: '/help' }))).toEqual({ action: 'skip', reason: 'command' })
    expect(decideChatTurn(turn({ userText: '/help\n/reset' }))).toEqual({ action: 'skip', reason: 'command' })
    expect(decideChatTurn(turn({ userText: '/remember Ada likes tea' })).action).toBe('write')
    expect(decideChatTurn(turn({ userText: '😀 👍' }))).toEqual({ action: 'skip', reason: 'emoji' })
    expect(decideChatTurn(turn({ userText: 'tea 😀' })).action).toBe('write')
    expect(decideChatTurn(turn({ userText: '', imageOnly: true }))).toEqual({ action: 'skip', reason: 'image' })
    expect(decideChatTurn(turn({ interrupted: true }))).toEqual({ action: 'skip', reason: 'interrupted' })
    expect(decideChatTurn(turn({ failed: true }))).toEqual({ action: 'skip', reason: 'failed' })
  })

  it('removes a copied system prompt and leaves the reply', () => {
    const systemPrompt = 'Format rules. This prompt is long enough to strip from a copied reply. Card identity.'
    expect(sanitizeTurnText(`${systemPrompt}\nTea is fine.`, systemPrompt)).toBe('Tea is fine.')
  })

  it('queues the write, ignores a duplicate turn, and continues after a failure', async () => {
    const calls: string[] = []
    const client: MemoryV3Client = {
      async addConversation(input) {
        calls.push(input.messages.map(message => message.content).join('|'))
        if (calls.length === 1)
          throw new Error('MemoryCore request failed.')
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
    const errors: unknown[] = []
    const queue = createChatTurnQueue({ onError: error => errors.push(error) })

    expect(queue.enqueue(client, turn())).toBe(true)
    expect(queue.enqueue(client, turn())).toBe(false)
    expect(queue.enqueue(client, turn({ userText: '/help' }))).toBe(false)
    expect(queue.enqueue(client, turn({ turnId: 'turn-2', userText: 'The garden needs water.' }))).toBe(true)
    await queue.flush()

    expect(calls).toEqual([
      'Ada likes tea.|I will remember that.',
      'The garden needs water.|I will remember that.',
    ])
    expect(errors).toHaveLength(1)
  })
})

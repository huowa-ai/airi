import { describe, expect, it } from 'vitest'

import { batchNotifiesExtraction } from '../src/conversation-write'

/**
 * MemoryCore `handleConversationAdd` notifies L1 extraction only when the batch
 * contains a user message. `feat/server_team` has no unit test for that branch.
 * Source: `MemoryCore/src/gateway/v2-router.ts`.
 */
describe('extraction notify on the shared agent', () => {
  it('does not notify a fact-only batch, and does notify a chat batch on the same agent', () => {
    const notified: Array<{ agentId: string, sessionId: string }> = []

    function add(agentId: string, sessionId: string, messages: Array<{ role: string }>) {
      if (batchNotifiesExtraction(messages))
        notified.push({ agentId, sessionId })
    }

    add('card-1', 'airi:facts', [{ role: 'assistant' }])
    add('airi:general', 'airi:facts', [{ role: 'assistant' }])
    expect(notified).toEqual([])

    add('card-1', 'session-chat', [
      { role: 'user' },
      { role: 'assistant' },
    ])
    expect(notified).toEqual([{ agentId: 'card-1', sessionId: 'session-chat' }])
  })
})

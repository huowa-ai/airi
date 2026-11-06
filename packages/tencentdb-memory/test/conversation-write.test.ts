import { describe, expect, it } from 'vitest'

import { batchStartsExtraction } from '../src/memory-core-contract'

/**
 * Fact batches stay off extraction. The rule is `batchStartsExtraction`.
 * A chat batch on the same agent still starts extraction.
 */
describe('extraction notify on the shared agent', () => {
  it('does not notify a fact-only batch, and does notify a chat batch on the same agent', () => {
    const notified: Array<{ agentId: string, sessionId: string }> = []

    function add(agentId: string, sessionId: string, messages: Array<{ role: string }>) {
      if (batchStartsExtraction(messages))
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

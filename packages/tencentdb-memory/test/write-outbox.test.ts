import type { WriteOutboxState } from '../src/write-outbox'

import { describe, expect, it } from 'vitest'

import { createWriteOutbox, retryBackoffMs } from '../src/write-outbox'

function memoryStore() {
  let state: WriteOutboxState = { pending: [], done: [] }
  return {
    outbox: createWriteOutbox({
      load: () => state,
      save: (next) => {
        state = { pending: next.pending.map(row => ({ ...row, messages: row.messages.map(message => ({ ...message })) })), done: [...next.done] }
      },
      now: () => 1_000,
    }),
    read: () => state,
  }
}

const batch = {
  turnId: 'turn-1',
  agentId: 'card-1',
  sessionId: 'session-1',
  messages: [{ role: 'user' as const, content: 'I am Xiaoming.' }],
}

describe('write retry outbox', () => {
  it('keeps one batch per turn id and retries with a longer wait', () => {
    const { outbox, read } = memoryStore()
    outbox.add(batch)
    outbox.add(batch)
    expect(read().pending).toHaveLength(1)
    expect(read().pending[0]?.nextAttemptAt).toBe(1_000 + retryBackoffMs(1))
    expect(outbox.due(1_000)).toEqual([])

    outbox.begin('turn-1')
    outbox.failed('turn-1', 1_000)
    expect(read().pending[0]?.attempts).toBe(2)
    expect(read().pending[0]?.nextAttemptAt).toBe(1_000 + retryBackoffMs(2))
  })

  it('does not send a turn again after success, including after reload', () => {
    const { outbox, read } = memoryStore()
    outbox.add(batch)
    outbox.begin('turn-1')
    outbox.succeeded('turn-1')
    expect(read().pending).toEqual([])
    expect(outbox.isDone('turn-1')).toBe(true)

    const reloaded = createWriteOutbox({
      load: () => read(),
      save: () => {},
      now: () => 5_000,
    })
    reloaded.add(batch)
    expect(reloaded.due(5_000)).toEqual([])
    expect(reloaded.isDone('turn-1')).toBe(true)
  })
})

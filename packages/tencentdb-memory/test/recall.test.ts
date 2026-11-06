import { describe, expect, it } from 'vitest'

import { createRecallBuffer, mergeRecall } from '../src/recall'

const recent = {
  turnId: 'turn-1',
  agentId: 'card-1',
  sessionId: 'session-1',
  text: 'I am Xiaoming.',
  at: 50,
  messageIds: [],
}

describe('same-turn recall', () => {
  it('returns a recent turn before search has it, and drops a remote copy', () => {
    const first = mergeRecall({
      query: 'what is my name',
      remote: [],
      recent: [recent],
    })
    expect(first.map(hit => hit.text)).toEqual(['I am Xiaoming.'])

    const again = mergeRecall({
      query: 'what is my name',
      remote: [{ id: 'msg-1', text: 'I am Xiaoming.', score: 0.9, at: 40, source: 'remote' }],
      recent: [recent],
    })
    expect(again).toHaveLength(1)
    expect(again[0]?.source).toBe('remote')
  })

  it('ranks by relevance, then time, and stops at the count and the character budget', () => {
    const hits = mergeRecall({
      query: 'tea',
      remote: [
        { id: 'old', text: 'tea at dawn', score: 0.4, at: 10, source: 'remote' },
        { id: 'new', text: 'tea at noon', score: 0.4, at: 30, source: 'remote' },
        { id: 'best', text: 'tea', score: 1, at: 1, source: 'remote' },
      ],
      recent: [],
      budget: { limit: 2, maxChars: 12 },
    })
    expect(hits.map(hit => hit.id)).toEqual(['best', 'new'])
    expect(hits.reduce((sum, hit) => sum + hit.text.length, 0)).toBeLessThanOrEqual(12)
  })

  it('keeps one session ring and drops the oldest turn', () => {
    const buffer = createRecallBuffer()
    for (let index = 0; index < 9; index += 1) {
      buffer.note({
        turnId: `turn-${index}`,
        agentId: 'card-1',
        sessionId: 'session-1',
        text: `line ${index}`,
        at: index,
        messageIds: [],
      })
    }
    const listed = buffer.list('card-1', 'session-1')
    expect(listed).toHaveLength(8)
    expect(listed[0]?.turnId).toBe('turn-1')
    expect(listed.at(-1)?.turnId).toBe('turn-8')
    expect(buffer.list('card-1', 'session-2')).toEqual([])
  })

  it('keeps a private ring and a group ring apart', () => {
    const buffer = createRecallBuffer()
    buffer.note({ ...recent, teamId: 'u_local_ada', userId: 'ada' })
    buffer.note({ ...recent, turnId: 'turn-group', teamId: 'g_discord_room', userId: 'ada', text: 'Group line.' })

    expect(buffer.list('card-1', 'session-1', { teamId: 'u_local_ada', userId: 'ada' }).map(turn => turn.turnId)).toEqual(['turn-1'])
    expect(buffer.list('card-1', 'session-1', { teamId: 'g_discord_room', userId: 'ada' }).map(turn => turn.text)).toEqual(['Group line.'])
  })
})

import { describe, expect, it } from 'vitest'

import { agentIdForEntry, createFakeMemoryStorage, createMemoryRecordMap, GENERAL_AGENT_ID } from '../src/memory-storage'

const teamId = 'team-1'
const userId = 'user-1'
const card = 'card-1'

function storage(records = createMemoryRecordMap()) {
  return createFakeMemoryStorage({ teamId, userId, records })
}

describe('fake memory storage', () => {
  it('keeps a caller id and lists the entry', async () => {
    const rows = storage()
    const saved = await rows.write({ id: 'fact-1', description: 'Name', body: 'Ada' }, card, 10)

    expect(saved).toEqual({
      outcome: 'saved',
      entry: { id: 'fact-1', description: 'Name', body: 'Ada', persona: card, updatedAt: 10 },
    })
    expect(await rows.list()).toEqual([saved.outcome === 'saved' ? saved.entry : undefined])
  })

  it('shares rows when two in-process storages use one map', async () => {
    const records = createMemoryRecordMap()
    const web = storage(records)
    const desktop = storage(records)

    await web.write({ id: 'fact-1', description: 'Name', body: 'Ada' }, card, 10)

    expect(await desktop.list()).toEqual([
      { id: 'fact-1', description: 'Name', body: 'Ada', persona: card, updatedAt: 10 },
    ])
  })

  it('hides rows of another team or user', async () => {
    const records = createMemoryRecordMap()
    const owner = storage(records)
    const other = createFakeMemoryStorage({ teamId: 'team-2', userId, records })

    await owner.write({ id: 'fact-1', description: 'Name', body: 'Ada' }, card, 10)

    expect(await other.list()).toEqual([])
  })

  it('keeps the newer write when two writes overlap', async () => {
    const rows = storage()

    await Promise.all([
      rows.write({ id: 'fact-1', description: 'One', body: 'first' }, card, 1),
      rows.write({ id: 'fact-1', description: 'Five', body: 'fifth' }, card, 5),
    ])

    expect(await rows.list()).toEqual([
      { id: 'fact-1', description: 'Five', body: 'fifth', persona: card, updatedAt: 5 },
    ])
  })

  it('treats the same text at the same time as one write', async () => {
    const rows = storage()
    await rows.write({ id: 'fact-1', description: 'Name', body: 'Ada' }, card, 4)
    const again = await rows.write({ id: 'fact-1', description: 'Name', body: 'Ada' }, card, 4)

    expect(again.outcome).toBe('saved')
    expect(await rows.list()).toHaveLength(1)
  })

  it('keeps the stored text when the same time carries different text', async () => {
    const rows = storage()
    await rows.write({ id: 'fact-1', description: 'Name', body: 'Ada' }, card, 4)
    const conflict = await rows.write({ id: 'fact-1', description: 'Name', body: 'Bea' }, card, 4)

    expect(conflict).toEqual({ outcome: 'stale', storedUpdatedAt: 4 })
    expect((await rows.list())[0]?.body).toBe('Ada')
  })

  it('does not restore an entry with an older write', async () => {
    const rows = storage()
    await rows.write({ id: 'fact-1', description: 'Name', body: 'Ada' }, card, 4)
    expect(await rows.forget('fact-1', card, 6)).toBe(true)

    const stale = await rows.write({ id: 'fact-1', description: 'Name', body: 'Ada' }, card, 5)

    expect(stale).toEqual({ outcome: 'stale', storedUpdatedAt: 6 })
    expect(await rows.list()).toEqual([])
  })

  it('restores the same id when a later write follows a removal', async () => {
    const rows = storage()
    await rows.write({ id: 'fact-1', description: 'Name', body: 'Ada' }, card, 4)
    await rows.forget('fact-1', card, 6)
    const restored = await rows.write({ id: 'fact-1', description: 'Name', body: 'Ada again' }, card, 7)

    expect(restored).toMatchObject({ outcome: 'saved', entry: { id: 'fact-1', updatedAt: 7 } })
  })

  it('adds a new id when the id belongs to another card', async () => {
    const rows = storage()
    await rows.write({ id: 'fact-1', description: 'Name', body: 'Ada' }, card, 4)
    const saved = await rows.write({ id: 'fact-1', description: 'Name', body: 'Other' }, 'card-2', 5)

    expect(saved.outcome).toBe('saved')
    if (saved.outcome !== 'saved')
      return
    expect(saved.entry.id).not.toBe('fact-1')
    expect(await rows.list()).toHaveLength(2)
  })

  it('makes an entry general and then refuses a card forget', async () => {
    const rows = storage()
    await rows.write({ id: 'fact-1', description: 'Name', body: 'Ada' }, card, 4)
    const general = await rows.makeGeneral('fact-1', 5)

    expect(general).toMatchObject({
      outcome: 'saved',
      entry: { id: 'fact-1', description: 'Name', body: 'Ada', updatedAt: 5 },
    })
    expect(general.outcome === 'saved' && general.entry.persona).toBeUndefined()
    expect(agentIdForEntry(general.outcome === 'saved' ? general.entry : { persona: card })).toBe(GENERAL_AGENT_ID)
    expect(await rows.forget('fact-1', card, 6)).toBe(false)
    expect(await rows.list()).toHaveLength(1)
  })

  it('drops a stale write after clear', async () => {
    const rows = storage()
    await rows.write({ id: 'fact-1', description: 'Name', body: 'Ada' }, card, 4)
    await rows.clear(10)
    const stale = await rows.write({ id: 'fact-1', description: 'Name', body: 'Ada' }, card, 10)

    expect(stale).toEqual({ outcome: 'stale', storedUpdatedAt: 10 })
    expect(await rows.list()).toEqual([])

    await rows.write({ id: 'fact-2', description: 'Next', body: 'Bea' }, card, 11)
    expect(await rows.list()).toHaveLength(1)
  })

  it('keeps source ids and asset refs, and keeps them when a later text write omits them', async () => {
    const rows = storage()
    const provenance = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      binding: 'discord:channel:1',
      modality: 'audio' as const,
      assetRefs: ['airi-asset:clip-1'],
    }

    await rows.write({ id: 'fact-1', description: 'Name', body: 'Ada', provenance }, card, 4)
    await rows.write({ id: 'fact-1', description: 'Name', body: 'Ada loves tea' }, card, 5)

    expect(await rows.list()).toEqual([{
      id: 'fact-1',
      description: 'Name',
      body: 'Ada loves tea',
      persona: card,
      updatedAt: 5,
      provenance,
    }])
  })

  it('lists facts from two sessions of one card together', async () => {
    const rows = storage()
    await rows.write({
      id: 'fact-1',
      description: 'Name',
      body: 'Ada',
      provenance: { sessionId: 'session-1', modality: 'text' },
    }, card, 1)
    await rows.write({
      id: 'fact-2',
      description: 'Drink',
      body: 'Tea',
      provenance: { sessionId: 'session-2', modality: 'text' },
    }, card, 2)

    expect((await rows.list()).map(entry => entry.id)).toEqual(['fact-1', 'fact-2'])
  })

  it('rejects an asset ref that is not an airi-asset id', async () => {
    const rows = storage()

    await expect(rows.write({
      id: 'fact-1',
      description: 'Clip',
      body: 'Heard a name',
      provenance: { modality: 'audio', assetRefs: ['data:audio/wav;base64,AAAA'] },
    }, card, 1)).rejects.toThrow('airi-asset')
    expect(await rows.list()).toEqual([])
  })

  it('saves nothing for an empty body', async () => {
    const rows = storage()
    expect(await rows.write({ description: 'Name', body: '   ' }, card, 1)).toEqual({ outcome: 'empty' })
    expect(await rows.list()).toEqual([])
  })
})

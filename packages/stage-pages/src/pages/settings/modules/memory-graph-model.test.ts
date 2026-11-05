import { describe, expect, it } from 'vitest'

import { buildMemoryGraph, readMemoryGraphSource, whalePoint } from './memory-graph-model'

const tea = {
  id: 'tea',
  description: 'Drink',
  body: 'Ada likes tea.',
  persona: 'airi',
  updatedAt: 2,
}

const name = {
  id: 'name',
  description: 'Name',
  body: 'The owner is called Yumeka.',
  updatedAt: 1,
}

describe('memory graph model', () => {
  it('draws no facts when the service is off or the read failed', () => {
    const off = buildMemoryGraph({ serviceRead: 'off', serviceError: '', facts: [tea] })
    const failed = buildMemoryGraph({ serviceRead: 'error', serviceError: 'MemoryCore request failed.', facts: [tea] })
    const loading = buildMemoryGraph({ serviceRead: 'loading', serviceError: '', facts: [tea] })

    expect(off.nodes).toEqual([])
    expect(off.links).toEqual([])
    expect(failed.nodes).toEqual([])
    expect(failed.error).toBe('MemoryCore request failed.')
    expect(loading.nodes).toEqual([])
    expect(off.absentLayers).toEqual(['L1', 'L2', 'L3'])
  })

  it('draws only the given L0 facts and labels every line as derived', () => {
    const graph = buildMemoryGraph({ serviceRead: 'ready', serviceError: '', facts: [tea, name] })

    expect(graph.nodes.map(node => node.id)).toEqual(['name', 'tea'])
    expect(graph.nodes.every(node => node.layer === 'L0')).toBe(true)
    expect(graph.links).toEqual([{ source: 'name', target: 'tea', derived: true }])
    expect(graph.absentLayers).toEqual(['L1', 'L2', 'L3'])
  })

  it('places facts on a stable whale body and keeps one fact inside it', () => {
    const first = whalePoint(0, 3)
    const again = whalePoint(0, 3)
    const only = whalePoint(0, 1)

    expect(again).toEqual(first)
    expect(only).toEqual({ x: 0, y: 0, z: 0 })
    expect(Math.abs(first.x)).toBeLessThanOrEqual(36)
    expect(Math.abs(first.y)).toBeLessThanOrEqual(14)
  })

  it('reads a stored source and ignores an empty one', () => {
    expect(readMemoryGraphSource({
      sessionId: 'session-1',
      turnId: 'turn-1',
      binding: 'discord:channel:a',
      modality: 'text',
      assetRefs: ['airi-asset:abc'],
    })).toEqual({
      sessionId: 'session-1',
      turnId: 'turn-1',
      binding: 'discord:channel:a',
      modality: 'text',
      assetRefs: ['airi-asset:abc'],
    })
    expect(readMemoryGraphSource({})).toBeUndefined()
    expect(readMemoryGraphSource('not-a-source')).toBeUndefined()
  })
})

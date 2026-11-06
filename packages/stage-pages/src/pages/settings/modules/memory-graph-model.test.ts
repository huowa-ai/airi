import { describe, expect, it } from 'vitest'

import { memoryGraphFixture } from './memory-graph-fixture'
import { buildMemoryGraph, personaSections, readMemoryGraphSource, whalePoint } from './memory-graph-model'

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
  it('draws no records when the service is off or the read failed', () => {
    const off = buildMemoryGraph({ serviceRead: 'off', serviceError: '', facts: [tea] })
    const failed = buildMemoryGraph({ serviceRead: 'error', serviceError: 'MemoryCore request failed.', facts: [tea] })
    const loading = buildMemoryGraph({ serviceRead: 'loading', serviceError: '', facts: [tea] })

    expect(off.nodes).toEqual([])
    expect(off.links).toEqual([])
    expect(off.legend).toEqual([])
    expect(failed.nodes).toEqual([])
    expect(failed.error).toBe('MemoryCore request failed.')
    expect(loading.nodes).toEqual([])
  })

  it('draws only the given L0 facts and labels every line as derived', () => {
    const graph = buildMemoryGraph({ serviceRead: 'ready', serviceError: '', facts: [tea, name] })

    expect(graph.nodes.map(node => node.id)).toEqual(['name', 'tea'])
    expect(graph.nodes.every(node => node.layer === 'L0')).toBe(true)
    expect(graph.links.every(link => link.derived)).toBe(true)
    expect(graph.links).toEqual([{ source: 'tea', target: 'name', derived: true }])
    expect(graph.legend).toEqual(['L0'])
  })

  it('places a few facts on the head, the tail, and the fins', () => {
    const points = Array.from({ length: 6 }, (_, index) => whalePoint(index, 6))
    const only = whalePoint(0, 1)

    expect(only).toEqual({ x: 0, y: 0, z: 0 })
    expect(points.some(point => point.x > 28)).toBe(true)
    expect(points.some(point => point.x < -28)).toBe(true)
    expect(points.some(point => point.y >= 12)).toBe(true)
    expect(points.some(point => Math.abs(point.z) >= 14)).toBe(true)
    expect(new Set(points.map(point => `${point.x},${point.y},${point.z}`)).size).toBe(6)
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

  it('places fixture layers in whale zones and keeps one persona node', () => {
    const graph = buildMemoryGraph({ serviceRead: 'ready', serviceError: '', ...memoryGraphFixture })
    const persona = graph.nodes.find(node => node.layer === 'L3')
    const scene = graph.nodes.find(node => node.layer === 'L2')
    const atoms = graph.nodes.filter(node => node.layer === 'L1')
    const facts = graph.nodes.filter(node => node.layer === 'L0')

    expect(facts).toHaveLength(16)
    expect(atoms).toHaveLength(11)
    expect(graph.nodes.filter(node => node.layer === 'L2')).toHaveLength(1)
    expect(graph.nodes.filter(node => node.layer === 'L3')).toHaveLength(1)
    expect(persona).toMatchObject({ label: 'Calm companion', scope: 'team-agent', x: 34, y: 8 })
    expect(scene).toMatchObject({ label: 'Drink habits', scope: 'team-agent', y: 18 })
    expect(atoms.every(node => node.scope === 'user')).toBe(true)
    expect(facts.some(node => Math.abs(node.z) >= 14)).toBe(true)
    expect(graph.legend).toEqual(['L0', 'L1', 'L2', 'L3'])
    expect(graph.links.every(link => link.derived)).toBe(true)
    expect(graph.links.every((link) => {
      const source = graph.nodes.find(node => node.id === link.source)
      const target = graph.nodes.find(node => node.id === link.target)
      return source?.layer === target?.layer
    })).toBe(true)

    const detail = graph.details.find(item => item.layer === 'L3')
    expect(detail?.sections.map(section => section.heading)).toEqual(['Calm companion', 'Drinks', '名字', 'Notes'])
    expect(detail?.scope).toBe('team-agent')
  })

  it('splits a persona on headings and keeps a file without headings as one section', () => {
    expect(personaSections('# Name\n\nAda')).toEqual([{ heading: 'Name', body: 'Ada' }])
    expect(personaSections('Ada likes tea.')).toEqual([{ heading: 'Ada likes tea.', body: 'Ada likes tea.' }])
  })
})

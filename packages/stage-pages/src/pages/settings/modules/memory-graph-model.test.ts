import { describe, expect, it } from 'vitest'

import { memoryGraphFixture } from './memory-graph-fixture'
import { buildMemoryGraph, filterMemoryGraph, personaSections, readMemoryGraphSource, whalePoint } from './memory-graph-model'

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

  it('filters L0 rows by call id and source and keeps higher layers', () => {
    const callId = '11111111-1111-4111-8111-111111111111'
    const graph = buildMemoryGraph({
      serviceRead: 'ready',
      serviceError: '',
      facts: [
        tea,
        {
          id: 'turn:typed',
          description: 'Ada likes tea.',
          body: 'Ada likes tea.',
          updatedAt: 3,
          origin: 'turn',
          callId,
          source: 'text',
        },
        {
          id: 'turn:spoken',
          description: 'Hello.',
          body: 'Hello.',
          updatedAt: 4,
          origin: 'turn',
          callId,
          source: 'voice',
        },
      ],
      atoms: [{ id: 'atom-1', type: 'persona', content: 'Ada prefers tea.' }],
    })

    const bySource = filterMemoryGraph(graph, { source: 'text' })
    const byCall = filterMemoryGraph(graph, { callId })
    const both = filterMemoryGraph(graph, { callId, source: 'text' })

    expect(bySource.nodes.filter(node => node.layer === 'L0').map(node => node.id)).toEqual(['turn:typed'])
    expect(bySource.nodes.some(node => node.layer === 'L1')).toBe(true)
    expect(bySource.details.find(item => item.id === 'turn:typed')).toMatchObject({
      body: 'Ada likes tea.',
      callId,
      source: 'text',
      removable: false,
    })
    expect(byCall.nodes.filter(node => node.layer === 'L0').map(node => node.id)).toEqual(['turn:typed', 'turn:spoken'])
    expect(both.nodes.filter(node => node.layer === 'L0').map(node => node.id)).toEqual(['turn:typed'])
    expect(filterMemoryGraph(graph, {}).nodes.filter(node => node.layer === 'L0')).toHaveLength(3)
    expect(bySource.links.every(link => bySource.nodes.some(node => node.id === link.source) && bySource.nodes.some(node => node.id === link.target))).toBe(true)
  })

  it('uses the caller label when a persona file is empty', () => {
    const graph = buildMemoryGraph({
      serviceRead: 'ready',
      serviceError: '',
      facts: [],
      cores: [{ content: '' }],
      personaLabel: 'Translated persona',
    })

    expect(graph.nodes.find(node => node.layer === 'L3')?.label).toBe('Translated persona')
    expect(graph.details.find(detail => detail.layer === 'L3')?.label).toBe('Translated persona')
  })

  it('splits a persona on headings and keeps a file without headings as one section', () => {
    expect(personaSections('# Name\n\nAda')).toEqual([{ heading: 'Name', body: 'Ada' }])
    expect(personaSections('Ada likes tea.')).toEqual([{ heading: 'Ada likes tea.', body: 'Ada likes tea.' }])
  })
})

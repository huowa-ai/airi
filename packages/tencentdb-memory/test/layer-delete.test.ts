import type { MemoryV3Client } from '../src/memory-client'

import { describe, expect, it } from 'vitest'

import { deleteLayerRecord, isForgetPhrase } from '../src/layer-delete'

function client() {
  const calls: string[] = []
  const memory: MemoryV3Client = {
    async addConversation() {
      return { acceptedIds: [], acceptedVersions: [], totalCount: 0 }
    },
    async searchConversation() {
      return { messages: [] }
    },
    async queryConversation() {
      return { messages: [], total: 0 }
    },
    async deleteConversation(input) {
      calls.push(`L0:${input.messageIds?.join(',') ?? ''}`)
      return { deletedCount: input.messageIds?.length ?? 0 }
    },
    async deleteAtomic(input) {
      calls.push(`L1:${input.ids.join(',')}`)
      return { deletedCount: input.ids.length }
    },
    async queryAtomic() {
      return { items: [], total: 0 }
    },
    async removeScenario(input) {
      calls.push(`L2:${input.path}`)
    },
    async listScenarios() {
      return { entries: [], total: 0 }
    },
    async readScenario(input) {
      return { path: input.path, content: null }
    },
    async readCore() {
      return { content: 'persona' }
    },
  }
  return { memory, calls }
}

describe('layer delete', () => {
  it('deletes L0, L1, and L2, and does not write when L3 has no delete', async () => {
    const { memory, calls } = client()
    expect(await deleteLayerRecord(memory, { layer: 'L0', agentId: 'card-1', messageIds: ['msg-1'] })).toEqual({ deleted: true, layer: 'L0' })
    expect(await deleteLayerRecord(memory, { layer: 'L1', agentId: 'card-1', ids: ['atom-1'] })).toEqual({ deleted: true, layer: 'L1' })
    expect(await deleteLayerRecord(memory, { layer: 'L2', agentId: 'card-1', path: 'notes/tea.md' })).toEqual({ deleted: true, layer: 'L2' })
    expect(await deleteLayerRecord(memory, { layer: 'L3', agentId: 'card-1' })).toEqual({ deleted: false, layer: 'L3', reason: 'no-delete-api' })
    expect(calls).toEqual(['L0:msg-1', 'L1:atom-1', 'L2:notes/tea.md'])
    expect(isForgetPhrase('Forget this!')).toBe(true)
    expect(isForgetPhrase('Forget this name')).toBe(false)
  })
})

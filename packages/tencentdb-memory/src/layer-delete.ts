import type { MemoryV3Client } from './memory-client'

/**
 * Phrases that delete the latest recalled turn.
 * The match is the whole line, after trimming and lower case.
 */
export const forgetPhrases = ['forget this'] as const

export function isForgetPhrase(text: string) {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/g, '').trim()
  return (forgetPhrases as readonly string[]).includes(normalized)
}

export type LayerDeleteResult
  = { deleted: true, layer: 'L0' | 'L1' | 'L2' }
    | { deleted: false, layer: 'L3', reason: 'no-delete-api' }

/**
 * Deletes one MemoryCore record.
 * L0 uses `conversation/delete`. L1 uses `atomic/delete`. L2 uses `scenario/rm`.
 * L3 has read, write, and count. It has no delete route, so this call does not write.
 */
export async function deleteLayerRecord(client: MemoryV3Client, input: {
  layer: 'L0' | 'L1' | 'L2' | 'L3'
  agentId: string
  messageIds?: string[]
  ids?: string[]
  path?: string
}): Promise<LayerDeleteResult> {
  if (input.layer === 'L3')
    return { deleted: false, layer: 'L3', reason: 'no-delete-api' }
  if (input.layer === 'L0') {
    await client.deleteConversation({ agentId: input.agentId, messageIds: input.messageIds ?? [] })
    return { deleted: true, layer: 'L0' }
  }
  if (input.layer === 'L1') {
    await client.deleteAtomic({ agentId: input.agentId, ids: input.ids ?? [] })
    return { deleted: true, layer: 'L1' }
  }
  await client.removeScenario({ agentId: input.agentId, path: input.path ?? '' })
  return { deleted: true, layer: 'L2' }
}

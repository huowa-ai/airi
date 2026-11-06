import type { AddConversationInput, AddConversationResult, MemoryV3Client } from './memory-client'

/**
 * Writes one L0 batch.
 * Facts and chat turns both call this. The agent id is the character card, or `airi:general`.
 * A fact batch uses session `airi:facts` and role `assistant`.
 * A chat batch uses the chat session and includes the user message.
 */
export function appendConversation(client: MemoryV3Client, input: AddConversationInput) {
  return client.addConversation(input)
}

export interface DeliverConversationResult extends AddConversationResult {
  /** True when a retry found the batch already stored and did not write again. */
  alreadyStored: boolean
}

/**
 * Hash of one batch. `conversation/add` does not accept a caller message id.
 * A retry compares this hash inside the resolved scope.
 *
 * @example
 * conversationContentHash([{ role: 'user', content: 'Ada likes tea.' }])
 * // => '8ae6eeb4'
 */
export function conversationContentHash(messages: readonly { role: string, content: string }[]) {
  const text = messages.map(message => `${message.role}\n${message.content}`).join('\n')
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1)
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619)
  return (hash >>> 0).toString(16)
}

/**
 * Writes one L0 batch.
 * On a retry, the client first queries that team, user, agent, and session.
 * When every message is already stored, the call does not write again.
 * The gateway mints message ids. It has no idempotency field on `conversation/add`.
 */
export async function deliverConversation(client: MemoryV3Client, input: AddConversationInput & { retry?: boolean }): Promise<DeliverConversationResult> {
  if (input.retry) {
    const ids = await storedMessageIds(client, input)
    if (ids)
      return { acceptedIds: ids, acceptedVersions: ids.map(() => 'v1'), totalCount: ids.length, alreadyStored: true }
  }
  const result = await appendConversation(client, input)
  return { ...result, alreadyStored: false }
}

async function storedMessageIds(client: MemoryV3Client, input: AddConversationInput) {
  const needed = input.messages.map(message => conversationContentHash([message]))
  if (needed.length === 0)
    return undefined

  const found = new Map<string, string[]>()
  let offset = 0
  let total = 0
  const limit = 100
  do {
    const page = await client.queryConversation({
      agentId: input.agentId,
      sessionId: input.sessionId,
      teamId: input.teamId,
      userId: input.userId,
      limit,
      offset,
    })
    total = page.total
    for (const message of page.messages) {
      const key = conversationContentHash([message])
      const list = found.get(key) ?? []
      list.push(message.id)
      found.set(key, list)
    }
    if (page.messages.length === 0)
      break
    offset += page.messages.length
  } while (offset < total)

  const used = new Map<string, number>()
  const ids: string[] = []
  for (const key of needed) {
    const list = found.get(key) ?? []
    const index = used.get(key) ?? 0
    const id = list[index]
    if (!id)
      return undefined
    used.set(key, index + 1)
    ids.push(id)
  }
  return ids
}

/**
 * Whether this batch starts L1 extraction.
 * MemoryCore counts messages with role `user`. A batch with none does not notify.
 *
 * Source: `feat/server_team` `MemoryCore/src/gateway/v2-router.ts` `handleConversationAdd`.
 * That branch has no unit test for this rule.
 *
 * @example
 * batchNotifiesExtraction([{ role: 'assistant' }])
 * // => false
 */
export function batchNotifiesExtraction(messages: readonly { role: string }[]) {
  return messages.filter(message => message.role === 'user').length > 0
}

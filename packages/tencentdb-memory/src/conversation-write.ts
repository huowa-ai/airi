import type { AddConversationInput, MemoryV3Client } from './memory-client'

/**
 * Writes one L0 batch.
 * Facts and chat turns both call this. The agent id is the character card, or `airi:general`.
 * A fact batch uses session `airi:facts` and role `assistant`.
 * A chat batch uses the chat session and includes the user message.
 */
export function appendConversation(client: MemoryV3Client, input: AddConversationInput) {
  return client.addConversation(input)
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

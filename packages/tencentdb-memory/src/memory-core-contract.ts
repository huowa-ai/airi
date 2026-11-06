import type { MemoryV3Client } from './memory-client'

import { MemoryClientError } from './memory-client'

/**
 * Gateway rules this package relies on.
 * Callers use this module. They do not read gateway field names.
 *
 * `extractsOnUserMessage`: L1 extraction starts only when the batch has a user message.
 * `acceptsCallerMessageId`: `conversation/add` does not accept a caller message id.
 * `messageDeleteIsExact`: one message id deletes one L0 row. A session id deletes the whole session.
 */
export interface MemoryCoreCapabilities {
  readonly extractsOnUserMessage: true
  readonly acceptsCallerMessageId: false
  readonly messageDeleteIsExact: true
}

export const memoryCoreCapabilities: MemoryCoreCapabilities = {
  extractsOnUserMessage: true,
  acceptsCallerMessageId: false,
  messageDeleteIsExact: true,
}

/**
 * Whether this batch starts L1 extraction.
 * The gateway counts messages with role `user`. A batch with none does not notify.
 *
 * @example
 * batchStartsExtraction([{ role: 'assistant' }])
 * // => false
 */
export function batchStartsExtraction(messages: readonly { role: string }[]) {
  if (!memoryCoreCapabilities.extractsOnUserMessage)
    return true
  return messages.some(message => message.role === 'user')
}

/** @deprecated Use {@link batchStartsExtraction}. The same rule, one implementation. */
export function batchNotifiesExtraction(messages: readonly { role: string }[]) {
  return batchStartsExtraction(messages)
}

/**
 * Role for a fact or a directory row.
 * The batch stays assistant-only, so the gateway does not start L1 extraction.
 *
 * @example
 * factRecordRole()
 * // => 'assistant'
 */
export function factRecordRole(): 'assistant' {
  return 'assistant'
}

/**
 * Deletes L0 rows by message id.
 * The call sends message ids only. It warns and throws when `deletedCount` is not that count.
 * A session id is not sent. The gateway treats a session id as a wipe of every row in the session.
 */
export async function deleteExactMessages(client: MemoryV3Client, input: {
  agentId: string
  messageIds: readonly string[]
  teamId?: string
  userId?: string
}) {
  const messageIds = uniqueIds(input.messageIds)
  if (messageIds.length === 0)
    return { deletedCount: 0 }

  const result = await client.deleteConversation({
    agentId: input.agentId,
    messageIds,
    ...(input.teamId === undefined ? {} : { teamId: input.teamId }),
    ...(input.userId === undefined ? {} : { userId: input.userId }),
  })
  if (result.deletedCount !== messageIds.length) {
    const message = `Delete removed ${result.deletedCount} records. Expected ${messageIds.length}.`
    console.warn(`[memory] ${message}`)
    throw new MemoryClientError({
      path: '/v3/conversation/delete',
      status: 200,
      code: 0,
      message,
    })
  }
  return { deletedCount: result.deletedCount }
}

function uniqueIds(ids: readonly string[]) {
  const seen = new Set<string>()
  const output: string[] = []
  for (const raw of ids) {
    const id = raw.trim()
    if (!id || seen.has(id))
      continue
    seen.add(id)
    output.push(id)
  }
  return output
}

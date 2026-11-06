import type { CallSource } from './call-header'
import type { AddConversationInput, ConversationMessageInput, MemoryV3Client } from './memory-client'

import { callHeaderLine, prefixCallHeader, projectCallContent } from './call-header'
import { appendConversation } from './conversation-write'

/** MemoryCore rejects conversation content longer than this. The v3 catalog limit is 8192. */
const maxContentLength = 8192

/** Recent turn keys. A second delivery of the same turn does not write again. */
const maxSeenTurns = 500

const memoryHeader = 'Long-term memory. You keep it yourself.'
const emptyIndex = 'The memory index is empty.'
const indexHeader = 'Memory index:'

export type ChatTurnSkipReason = 'empty' | 'command' | 'emoji' | 'image' | 'interrupted' | 'failed'

/**
 * One finished chat turn, before filters.
 * `systemPrompt` is removed from both sides so a recalled prompt is not stored again.
 */
export interface ChatTurnInput {
  sessionId: string
  turnId: string
  /** Character card, or `airi:general`. Manual facts use this same id. */
  agentId: string
  userText: string
  assistantText: string
  /**
   * The user message is only an image.
   * A caption is text, and then this is false.
   */
  imageOnly?: boolean
  systemPrompt?: string
  /** ISO-8601 UTC time, such as `2026-11-01T00:00:00.000Z`. */
  timestamp: string
  /** Resolved team. The retry uses this scope when the success response was lost. */
  teamId?: string
  /** Resolved user. The retry uses this scope when the success response was lost. */
  userId?: string
  /**
   * Playback stopped before the reply finished.
   * Played assistant text is stored. Empty played text is skipped.
   */
  interrupted?: boolean
  failed?: boolean
  /** One UUID for the call. Absent when the turn is not part of a call. */
  callId?: string
  /** `voice`, `video`, or `text`. A typed turn uses `text`. */
  source?: CallSource
}

export type ChatTurnDecision
  = { action: 'write', input: AddConversationInput }
    | { action: 'skip', reason: ChatTurnSkipReason }

/**
 * Decides whether a finished turn is stored as L0.
 * Empty text, a pure slash command, pure emoji, and an image with no caption are skipped.
 * An interrupted turn is stored when assistant text already played, including a played filler.
 * An interrupted turn with no played text is skipped.
 * A failed turn is skipped.
 * A call id or a source is written as the content header on each message.
 * Filler and duplicates stay with the MemoryCore L1 prompt.
 *
 * @example
 * decideChatTurn({ sessionId: 'session-1', turnId: 'turn-1', agentId: 'card-1', userText: '/help', assistantText: 'Ok.', timestamp: '2026-11-01T00:00:00.000Z' })
 * // => { action: 'skip', reason: 'command' }
 */
export function decideChatTurn(input: ChatTurnInput): ChatTurnDecision {
  if (input.failed)
    return { action: 'skip', reason: 'failed' }

  const mark = callMark(input)
  const userText = fit(sanitizeTurnText(input.userText, input.systemPrompt), mark)
  const assistantText = fit(sanitizeTurnText(input.assistantText, input.systemPrompt), mark)
  const userBody = projectCallContent(userText)
  const assistantBody = projectCallContent(assistantText)
  // An interrupt stores only text that already played. Empty playback is not a turn.
  if (input.interrupted && assistantBody === '')
    return { action: 'skip', reason: 'interrupted' }
  if (input.imageOnly && userBody === '')
    return { action: 'skip', reason: 'image' }
  if (userBody === '' || assistantBody === '')
    return { action: 'skip', reason: 'empty' }
  if (isPureCommand(userBody))
    return { action: 'skip', reason: 'command' }
  if (isPureEmoji(userBody))
    return { action: 'skip', reason: 'emoji' }

  const messages: ConversationMessageInput[] = [
    { role: 'user', content: userText, timestamp: input.timestamp },
    { role: 'assistant', content: assistantText, timestamp: input.timestamp },
  ]
  return {
    action: 'write',
    input: {
      sessionId: input.sessionId,
      agentId: input.agentId,
      messages,
      ...mark,
    },
  }
}

/**
 * Removes a copied system prompt and an injected memory block.
 * The stored turn keeps the owner text and the reply.
 */
export function sanitizeTurnText(text: string, systemPrompt?: string): string {
  let output = text
  if (systemPrompt && systemPrompt.length >= 40)
    output = output.split(systemPrompt).join('')
  output = output.replace(/<memory\b[^>]*>[\s\S]*?<\/memory>/gi, '')
  output = output.replace(/<system\b[^>]*>[\s\S]*?<\/system>/gi, '')
  output = stripMemorySection(output)
  // A copied prompt can start with a call header. The new write adds its own header.
  output = projectCallContent(output)
  return output.replace(/[ \t]+\n/g, '\n').trim()
}

export interface ChatTurnQueue {
  /**
   * Queues one L0 write. The call returns before MemoryCore answers.
   * A write failure does not reject, and it does not stop the next turn.
   */
  enqueue: (client: MemoryV3Client, input: ChatTurnInput) => boolean
  /** Resolves when every queued write has settled. Tests use this. */
  flush: () => Promise<void>
}

export interface ChatTurnQueueOptions {
  /** Called after a write fails. It must not throw into the chat turn. */
  onError?: (error: unknown) => void
  /** Called after the gateway accepts or rejects the batch. */
  onSettled?: (event: {
    input: ChatTurnInput
    prepared: AddConversationInput
    ok: boolean
    ids: string[]
  }) => void
}

/**
 * Serial background writes for chat turns.
 * The same session, agent, and turn id are one write.
 */
export function createChatTurnQueue(options: ChatTurnQueueOptions = {}): ChatTurnQueue {
  const seen = new Set<string>()
  let tail: Promise<void> = Promise.resolve()

  return {
    enqueue(client, input) {
      const decision = decideChatTurn(input)
      if (decision.action === 'skip')
        return false
      const key = `${input.agentId}\0${input.sessionId}\0${input.turnId}`
      if (seen.has(key))
        return false
      seen.add(key)
      if (seen.size > maxSeenTurns) {
        const oldest = seen.values().next().value
        if (oldest)
          seen.delete(oldest)
      }
      const prepared = decision.input
      tail = tail.then(() => appendConversation(client, prepared)).then((result) => {
        options.onSettled?.({ input, prepared, ok: true, ids: result.acceptedIds })
      }, (error: unknown) => {
        options.onSettled?.({ input, prepared, ok: false, ids: [] })
        try {
          options.onError?.(error)
        }
        catch {
          // The turn is already lost. A log failure must not stop the next turn.
        }
      })
      return true
    },
    flush: () => tail,
  }
}

function stripMemorySection(text: string) {
  let output = text
  let start = output.indexOf(memoryHeader)
  while (start !== -1) {
    const end = endOfMemorySection(output, start)
    output = `${output.slice(0, start)}${output.slice(end)}`
    start = output.indexOf(memoryHeader)
  }
  return output
}

function endOfMemorySection(text: string, start: number) {
  const emptyAt = text.indexOf(emptyIndex, start)
  const indexAt = text.indexOf(indexHeader, start)
  if (emptyAt !== -1 && (indexAt === -1 || emptyAt < indexAt))
    return emptyAt + emptyIndex.length
  if (indexAt === -1) {
    const breakAt = text.indexOf('\n\n', start)
    return breakAt === -1 ? text.length : breakAt
  }
  const lines = text.slice(indexAt + indexHeader.length).split('\n')
  let consumed = indexHeader.length
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed === 'Your own:' || trimmed === 'General:' || trimmed.startsWith('- ')) {
      consumed += line.length + 1
      continue
    }
    break
  }
  return indexAt + consumed
}

function isPureCommand(text: string) {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line !== '')
  return lines.length > 0 && lines.every(line => /^\/\S+(?:\s+\/\S+)*$/.test(line))
}

function isPureEmoji(text: string) {
  const compact = text.replace(/\s+/g, '')
  if (compact === '')
    return false
  return /^[\p{Extended_Pictographic}\u200D\uFE0F]+$/u.test(compact)
}

function callMark(input: ChatTurnInput): { callId?: string, source?: CallSource } {
  return {
    ...(input.callId ? { callId: input.callId } : {}),
    ...(input.source ? { source: input.source } : {}),
  }
}

function fit(text: string, mark: { callId?: string, source?: CallSource }) {
  const line = callHeaderLine(mark)
  const limit = line ? maxContentLength - line.length - 1 : maxContentLength
  const body = text.length <= limit ? text : text.slice(0, Math.max(limit, 0))
  return prefixCallHeader(body, mark)
}

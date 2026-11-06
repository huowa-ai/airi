import type { ChatHistoryItem, StreamingAssistantMessage } from '@proj-airi/core-agent'
import type { ChatTurnInput } from '@proj-airi/tencentdb-memory'

import { extractMessageText } from '../libs/chat-sync/wire-message'

/** Fields the memory store queues. The store resolves the agent id and the team. */
export type ChatTurnRecord = Omit<ChatTurnInput, 'agentId'> & {
  personaId: string
  /** Scene binding, such as `discord:channel:a`. Absent for a private chat. */
  binding?: string
  /** Platform speaker. Absent means the local account. */
  speakerId?: string
}

/**
 * Hands one finished chat turn to the memory store.
 * The store queues the L0 write. This function does not wait for MemoryCore.
 */
export function captureCompletedChatTurn(options: {
  message: ChatHistoryItem
  output: StreamingAssistantMessage
  outputText: string
  sessionId: string
  turnId: string
  personaId: string
  systemPrompt: string
  binding?: string
  speakerId?: string
  record: (input: ChatTurnRecord) => void
}) {
  const spoken = userSpeech(options.message)
  options.record({
    sessionId: options.sessionId,
    turnId: options.turnId,
    personaId: options.personaId,
    userText: spoken.text,
    assistantText: assistantSpeech(options.output, options.outputText),
    imageOnly: spoken.imageOnly,
    systemPrompt: options.systemPrompt,
    timestamp: new Date().toISOString(),
    interrupted: options.output.interrupted === true,
    failed: options.message.role === 'error',
    ...(options.binding ? { binding: options.binding } : {}),
    ...(options.speakerId ? { speakerId: options.speakerId } : {}),
  })
}

function userSpeech(message: ChatHistoryItem) {
  if (message.role !== 'user' || message.notice)
    return { text: '', imageOnly: false }
  const text = [extractMessageText(message), ...(message.audioTranscripts ?? [])]
    .map(part => part.trim())
    .filter(part => part !== '')
    .join('\n')
  return {
    text,
    imageOnly: text === '' && hasImage(message),
  }
}

function assistantSpeech(output: StreamingAssistantMessage, outputText: string) {
  const slices = extractMessageText(output).trim()
  return slices || outputText.trim()
}

function hasImage(message: ChatHistoryItem) {
  return Array.isArray(message.content) && message.content.some(part => (
    typeof part === 'object' && part !== null && 'type' in part && part.type === 'image_url'
  ))
}

import type { ChatHistoryItem, StreamingAssistantMessage } from '@proj-airi/core-agent'
import type { CallSource, ChatTurnInput } from '@proj-airi/tencentdb-memory'

import { readCallTurn } from '../composables/call/turn'
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
  /** One UUID for the call. Absent when the turn is not part of a call. */
  callId?: string
  /** `voice`, `video`, or `text`. A typed turn uses `text`. */
  source?: CallSource
  record: (input: ChatTurnRecord) => void
}) {
  const spoken = userSpeech(options.message)
  const reply = assistantSpeech(options.output, options.outputText)
  const interrupted = options.output.interrupted === true
  const mark = readCallTurn({
    sessionId: options.sessionId,
    turnId: options.turnId,
    interrupted,
    outputText: reply,
  })
  // Playback can still be running. The call stores the turn when it ends or is interrupted.
  if (mark?.defer)
    return
  const assistantText = mark?.assistantText !== undefined ? mark.assistantText : reply
  const callId = mark?.callId ?? options.callId
  options.record({
    sessionId: options.sessionId,
    turnId: options.turnId,
    personaId: options.personaId,
    userText: spoken.text,
    assistantText,
    imageOnly: spoken.imageOnly,
    systemPrompt: options.systemPrompt,
    timestamp: new Date().toISOString(),
    interrupted,
    failed: options.message.role === 'error',
    source: mark?.source ?? options.source ?? 'text',
    ...(callId ? { callId } : {}),
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

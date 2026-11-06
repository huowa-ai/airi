import type { ChatHistoryItem, StreamingAssistantMessage } from '@proj-airi/core-agent'

import { describe, expect, it } from 'vitest'

import { captureCompletedChatTurn } from './chat-turn-memory'

function assistant(patch: Partial<StreamingAssistantMessage> = {}): StreamingAssistantMessage {
  return {
    role: 'assistant',
    content: '',
    slices: [{ type: 'text', text: 'Tea is a good drink.' }],
    tool_results: [],
    ...patch,
  }
}

describe('completed chat turn capture', () => {
  it('passes the owner text, a transcript, and the reply', () => {
    const recorded: Array<{ userText: string, assistantText: string, imageOnly?: boolean, interrupted?: boolean }> = []
    const message: ChatHistoryItem = {
      role: 'user',
      content: [
        { type: 'text', text: 'Ada likes tea.' },
        { type: 'input_audio', input_audio: { data: 'audio', format: 'mp3' } },
      ],
      audioTranscripts: ['in the afternoon'],
    }

    captureCompletedChatTurn({
      message,
      output: assistant(),
      outputText: '',
      sessionId: 'session-1',
      turnId: 'turn-1',
      personaId: 'card-1',
      systemPrompt: 'system prompt',
      record: (input) => {
        recorded.push(input)
      },
    })

    expect(recorded).toEqual([{
      sessionId: 'session-1',
      turnId: 'turn-1',
      personaId: 'card-1',
      userText: 'Ada likes tea.\nin the afternoon',
      assistantText: 'Tea is a good drink.',
      imageOnly: false,
      systemPrompt: 'system prompt',
      timestamp: expect.any(String),
      interrupted: false,
      failed: false,
      source: 'text',
    }])
  })

  it('marks an image with no caption, a notice, and an interrupted reply', () => {
    const recorded: Array<{ userText: string, imageOnly?: boolean, interrupted?: boolean, failed?: boolean }> = []
    const record = (input: { userText: string, imageOnly?: boolean, interrupted?: boolean, failed?: boolean }) => {
      recorded.push(input)
    }
    const base = {
      outputText: 'Tea is a good drink.',
      sessionId: 'session-1',
      turnId: 'turn-1',
      personaId: 'card-1',
      systemPrompt: '',
      record,
    }

    captureCompletedChatTurn({
      ...base,
      message: { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aa' } }] },
      output: assistant(),
    })
    captureCompletedChatTurn({
      ...base,
      message: { role: 'user', content: 'A task finished.', notice: { source: 'recipe' } },
      output: assistant(),
    })
    captureCompletedChatTurn({
      ...base,
      message: { role: 'user', content: 'Ada likes tea.' },
      output: assistant({ interrupted: true }),
    })

    expect(recorded.map(item => ({
      userText: item.userText,
      imageOnly: item.imageOnly,
      interrupted: item.interrupted,
    }))).toEqual([
      { userText: '', imageOnly: true, interrupted: false },
      { userText: '', imageOnly: false, interrupted: false },
      { userText: 'Ada likes tea.', imageOnly: false, interrupted: true },
    ])
  })
})

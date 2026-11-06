import { describe, expect, it } from 'vitest'

import { VOLCENGINE_DOUBAO_SPEAKER, VOLCENGINE_DOUBAO_SPEECH_MODEL, VOLCENGINE_DOUBAO_SPEECH_PROVIDER_ID } from '../../libs/providers/providers/volcengine-doubao'
import { callSpeechSelection } from './speech'

describe('call speech selection', () => {
  it('uses the Doubao proxy voice and keeps the key off the page', () => {
    const selection = callSpeechSelection()

    expect(selection.provider).toBe(VOLCENGINE_DOUBAO_SPEECH_PROVIDER_ID)
    expect(selection.model).toBe(VOLCENGINE_DOUBAO_SPEECH_MODEL)
    expect(selection.voice_id).toBe(VOLCENGINE_DOUBAO_SPEAKER)
    expect(selection).not.toHaveProperty('apiKey')
    expect(JSON.stringify(selection)).not.toContain('X-Api-Key')
  })
})

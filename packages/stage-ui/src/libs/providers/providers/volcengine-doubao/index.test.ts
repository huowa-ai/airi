import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  providerVolcengineDoubaoSpeech,
  providerVolcengineDoubaoTranscription,
  VOLCENGINE_DOUBAO_SPEAKER,
  VOLCENGINE_DOUBAO_SPEECH_MODEL,
  VOLCENGINE_DOUBAO_TRANSCRIPTION_MODEL,
} from './index'

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('doubao speech provider', () => {
  /**
   * @example
   * provider.speech('seed-icl-2.0')
   */
  it('points speech at the AIRI proxy and stores no API key', async () => {
    const schema = await providerVolcengineDoubaoSpeech.createProviderConfig({ t: key => key })
    const config = z.parse(schema, {})

    expect(config).toEqual({})
    expect(JSON.stringify(config)).not.toContain('X-Api-Key')
    expect(providerVolcengineDoubaoSpeech.requiresCredentials).toBe(false)

    const provider = await providerVolcengineDoubaoSpeech.createProvider(config) as SpeechProviderWithExtraOptions<string, Record<string, unknown>>
    const request = provider.speech(VOLCENGINE_DOUBAO_SPEECH_MODEL, {
      apiKey: 'client-secret',
      api_key: 'client-secret',
    })

    expect(request.apiKey).toBe('')
    expect(request.model).toBe(VOLCENGINE_DOUBAO_SPEECH_MODEL)
    expect(String(request.baseURL)).toContain('/api/v1/volcengine/')
    expect(String(request.baseURL)).not.toContain('openspeech.bytedance.com')
    expect(JSON.stringify(request)).not.toContain('client-secret')
    expect(JSON.stringify(request)).not.toContain('X-Api-Key')

    const seen = new Headers()
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      new Headers(init?.headers).forEach((value, key) => {
        seen.set(key, value)
      })
      return new Response(new Uint8Array([1, 2, 3]))
    }))

    await request.fetch?.(new URL('https://example.com/api/v1/volcengine/audio/speech'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': 'client-secret',
        // Skip the chat-session store. This test only checks that the key header is removed.
        'x-airi-session-id': 'session-1',
      },
    })

    expect(seen.get('x-api-key')).toBeNull()
    expect(seen.get('content-type')).toBe('application/json')
  })

  it('lists the cloned speaker without calling the network', async () => {
    const fetchImpl = vi.fn()
    vi.stubGlobal('fetch', fetchImpl)
    const provider = await providerVolcengineDoubaoSpeech.createProvider({})
    const voices = await providerVolcengineDoubaoSpeech.extraMethods?.listVoices?.({}, provider)

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(voices).toEqual([
      expect.objectContaining({
        id: VOLCENGINE_DOUBAO_SPEAKER,
        provider: 'volcengine-doubao-speech',
      }),
    ])
    expect(JSON.stringify(voices)).not.toContain('X-Api-Key')
  })
})

describe('doubao hearing provider', () => {
  /**
   * @example
   * provider.transcription('volc.seedasr.sauc.duration')
   */
  it('points hearing at the AIRI recognition proxy and stores no API key', async () => {
    const schema = await providerVolcengineDoubaoTranscription.createProviderConfig({ t: key => key })
    const config = z.parse(schema, {})
    expect(config).toEqual({})

    const provider = await providerVolcengineDoubaoTranscription.createProvider(config) as {
      transcription: (model: string) => {
        baseURL: URL
        fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
        model: string
        apiKey?: string
      }
    }
    const request = provider.transcription(VOLCENGINE_DOUBAO_TRANSCRIPTION_MODEL)

    expect(request.model).toBe(VOLCENGINE_DOUBAO_TRANSCRIPTION_MODEL)
    expect(request.baseURL.pathname).toBe('/api/v1/volcengine/audio/transcriptions/stream')
    expect(request.baseURL.hostname).not.toBe('openspeech.bytedance.com')
    expect(request.apiKey).toBeUndefined()
    expect(JSON.stringify({ ...request, fetch: undefined })).not.toContain('X-Api-Key')

    const seen = new Headers()
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      new Headers(init?.headers).forEach((value, key) => {
        seen.set(key, value)
      })
      return new Response('data: {"type":"transcript.text.snapshot","text":"hi","isFinal":true,"locale":"und","startMilliseconds":0,"durationMilliseconds":0}\n\n')
    }))

    await request.fetch?.('https://example.com/api/v1/volcengine/audio/transcriptions/stream', {
      method: 'POST',
      headers: {
        'X-Api-Key': 'client-secret',
        'x-airi-session-id': 'session-1',
      },
    })

    expect(seen.get('x-api-key')).toBeNull()
  })
})

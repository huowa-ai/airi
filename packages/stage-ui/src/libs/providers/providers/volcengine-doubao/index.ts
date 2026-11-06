import type { ModelInfo, VoiceInfo } from '../../types'

import { createOpenAI } from '@xsai-ext/providers/create'
import { z } from 'zod'

import { SERVER_URL } from '../../../../libs/server'
import { withCredentials } from '../official/shared'
import { defineProvider } from '../registry'
import {
  VOLCENGINE_DOUBAO_SPEAKER,
  VOLCENGINE_DOUBAO_SPEECH_MODEL,
  VOLCENGINE_DOUBAO_SPEECH_PROVIDER_ID,
  VOLCENGINE_DOUBAO_TRANSCRIPTION_MODEL,
  VOLCENGINE_DOUBAO_TRANSCRIPTION_PROVIDER_ID,
} from './constants'

export {
  VOLCENGINE_DOUBAO_SPEAKER,
  VOLCENGINE_DOUBAO_SPEECH_MODEL,
  VOLCENGINE_DOUBAO_SPEECH_PROVIDER_ID,
  VOLCENGINE_DOUBAO_TRANSCRIPTION_MODEL,
  VOLCENGINE_DOUBAO_TRANSCRIPTION_PROVIDER_ID,
} from './constants'

const configSchema = z.object({})

type DoubaoProxyConfig = z.input<typeof configSchema>

const DOUBAO_ICON = 'i-lobe-icons:volcengine'

/**
 * Removes a client key before the request leaves the page.
 * The AIRI server adds `X-Api-Key` from its own environment.
 */
function proxyFetch() {
  const authed = withCredentials()
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    headers.delete('X-Api-Key')
    return authed(input, {
      ...init,
      headers,
    })
  }
}

function withoutClientSecret(options?: Record<string, unknown>): Record<string, unknown> {
  if (!options)
    return {}

  const rest: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(options)) {
    if (key === 'apiKey' || key === 'api_key' || key === 'app')
      continue
    rest[key] = value
  }
  return rest
}

function createDoubaoSpeechProvider() {
  const provider = createOpenAI('', `${SERVER_URL}/api/v1/volcengine/`)
  const originalSpeech = provider.speech.bind(provider)
  provider.speech = (model: string, extraOptions?: Record<string, unknown>) => {
    const result = {
      ...originalSpeech(model),
      ...withoutClientSecret(extraOptions),
    }
    result.apiKey = ''
    result.fetch = proxyFetch()
    return result
  }
  return provider
}

const clonedVoice: VoiceInfo = {
  id: VOLCENGINE_DOUBAO_SPEAKER,
  name: 'Doubao clone',
  provider: VOLCENGINE_DOUBAO_SPEECH_PROVIDER_ID,
  description: 'Server-side Doubao voice clone.',
  languages: [{ code: 'zh-CN', title: 'Chinese' }],
}

export const providerVolcengineDoubaoSpeech = defineProvider<DoubaoProxyConfig, typeof VOLCENGINE_DOUBAO_SPEECH_PROVIDER_ID>({
  id: VOLCENGINE_DOUBAO_SPEECH_PROVIDER_ID,
  order: 20,
  name: 'Doubao Speech',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.volcengine-doubao-speech.title'),
  description: 'AIRI speaks with the Doubao voice clone. The key stays on the server.',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.volcengine-doubao-speech.description'),
  tasks: ['text-to-speech'],
  iconColor: DOUBAO_ICON,
  requiresCredentials: false,
  configuredBy: 'authentication',
  capabilities: {
    speech: { transport: 'rest', voicesByModel: true },
  },
  createProviderConfig: () => configSchema,
  createProvider() {
    return createDoubaoSpeechProvider()
  },
  validationRequiredWhen: () => false,
  extraMethods: {
    listModels: async (): Promise<ModelInfo[]> => [{
      id: VOLCENGINE_DOUBAO_SPEECH_MODEL,
      name: 'Doubao voice clone 2.0',
      provider: VOLCENGINE_DOUBAO_SPEECH_PROVIDER_ID,
      description: 'seed-icl-2.0',
    }],
    voiceCatalogConfig: () => ({}),
    listVoices: async (): Promise<VoiceInfo[]> => [clonedVoice],
  },
})

export const providerVolcengineDoubaoTranscription = defineProvider<DoubaoProxyConfig, typeof VOLCENGINE_DOUBAO_TRANSCRIPTION_PROVIDER_ID>({
  id: VOLCENGINE_DOUBAO_TRANSCRIPTION_PROVIDER_ID,
  order: 20,
  name: 'Doubao Hearing',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.volcengine-doubao-transcription.title'),
  description: 'AIRI hears speech through the Doubao proxy. The key stays on the server.',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.volcengine-doubao-transcription.description'),
  tasks: ['speech-to-text', 'automatic-speech-recognition', 'asr', 'stt', 'streaming-transcription'],
  iconColor: DOUBAO_ICON,
  requiresCredentials: false,
  configuredBy: 'authentication',
  capabilities: {
    transcription: {
      protocol: 'http',
      generateOutput: false,
      streamOutput: true,
      streamInput: true,
    },
  },
  createProviderConfig: () => configSchema,
  createProvider() {
    return {
      transcription: (model: string) => ({
        baseURL: new URL(`${SERVER_URL}/api/v1/volcengine/audio/transcriptions/stream`),
        fetch: proxyFetch(),
        model,
      }),
    }
  },
  validationRequiredWhen: () => false,
  extraMethods: {
    listModels: async (): Promise<ModelInfo[]> => [{
      id: VOLCENGINE_DOUBAO_TRANSCRIPTION_MODEL,
      name: 'Doubao streaming recognition 2.0',
      provider: VOLCENGINE_DOUBAO_TRANSCRIPTION_PROVIDER_ID,
      description: VOLCENGINE_DOUBAO_TRANSCRIPTION_MODEL,
    }],
  },
})

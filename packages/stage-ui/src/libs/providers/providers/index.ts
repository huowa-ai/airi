import { portableProviderDefinitions } from '@proj-airi/provider-inference'

import { registerProviders } from './registry'

import './aliyun-nls'
import './apple-speech'
import './apple-vision'
import './sherpaw'
import './local-audio'
import './kokoro-local'
import './nvidia'
import './official'
import './prompt-api'
import './volcengine-doubao'

registerProviders(portableProviderDefinitions)

export {
  OFFICIAL_TRANSCRIPTION_PROVIDER_ID,
} from './official'

export {
  getDefinedProvider,
  isProviderId,
  listProviders,
} from './registry'

export type { StageProviderId } from './registry'

export {
  VOLCENGINE_DOUBAO_SPEAKER,
  VOLCENGINE_DOUBAO_SPEECH_MODEL,
  VOLCENGINE_DOUBAO_SPEECH_PROVIDER_ID,
  VOLCENGINE_DOUBAO_TRANSCRIPTION_MODEL,
  VOLCENGINE_DOUBAO_TRANSCRIPTION_PROVIDER_ID,
} from './volcengine-doubao'

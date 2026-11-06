import type { AiriExtension } from '../../types/airiCard'

import { VOLCENGINE_DOUBAO_SPEAKER, VOLCENGINE_DOUBAO_SPEECH_MODEL, VOLCENGINE_DOUBAO_SPEECH_PROVIDER_ID } from '../../libs/providers/providers/volcengine-doubao'

/**
 * Speech selection for a call reply.
 *
 * The provider is the Doubao proxy. The page does not send `X-Api-Key`.
 * The provider transport is REST, so each sentence is one synthesis request
 * and the next sentence can start while the current sentence plays.
 */
export function callSpeechSelection(): AiriExtension['modules']['speech'] {
  return {
    provider: VOLCENGINE_DOUBAO_SPEECH_PROVIDER_ID,
    model: VOLCENGINE_DOUBAO_SPEECH_MODEL,
    voice_id: VOLCENGINE_DOUBAO_SPEAKER,
  }
}

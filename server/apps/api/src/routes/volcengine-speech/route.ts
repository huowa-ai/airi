import type { Context } from 'hono'

import type { Database } from '../../libs/db'
import type { Env } from '../../libs/env'

import { createBadRequestError, createServiceUnavailableError, createUnauthorizedError } from '@proj-airi/http-error-shared'
import { literal, maxLength, nonEmpty, object, optional, picklist, pipe, safeParse, string } from 'valibot'

import { resolveRequestAuth } from '../../libs/request-auth'
import { createVolcengineSaucStreamResponse } from '../../services/adapters/stt/volcengine-sauc'
import { synthesizeVolcengineIcl, VOLCENGINE_ICL_RESOURCE_ID } from '../../services/adapters/tts/volcengine-icl'

/**
 * One spoken sentence stays under this size. The call splits replies before speech.
 */
const MAX_SPEECH_TEXT_CHARS = 8000

const speechRequestSchema = object({
  model: optional(literal(VOLCENGINE_ICL_RESOURCE_ID)),
  input: pipe(
    string(),
    nonEmpty('Volcengine speech request has no text.'),
    maxLength(MAX_SPEECH_TEXT_CHARS, 'Volcengine speech text is too long.'),
  ),
  voice: optional(pipe(string(), nonEmpty(), maxLength(128))),
  response_format: optional(picklist(['mp3', 'pcm', 'wav', 'ogg_opus'])),
})

async function requireUser(db: Database, env: Env, headers: Headers) {
  const session = await resolveRequestAuth(db, env, headers)
  if (!session?.user)
    throw createUnauthorizedError()
  return session.user
}

function requireAccessToken(env: Env): string {
  const accessToken = env.VOLCENGINE_SPEECH_ACCESS_TOKEN?.trim() ?? ''
  if (!accessToken) {
    throw createServiceUnavailableError(
      'Volcengine speech proxy has no access token. Set VOLCENGINE_SPEECH_ACCESS_TOKEN on the server.',
      'VOLCENGINE_SPEECH_NOT_CONFIGURED',
    )
  }
  return accessToken
}

export interface VolcengineSpeechHandlerOptions {
  db: Database
  env: Env
  /** Tests pass a fake fetch. Production uses the platform fetch. */
  fetchImpl?: typeof fetch
  /** Tests pass a local speech URL. The route does not read this from the client. */
  endpoint?: string
}

export interface VolcengineTranscriptionHandlerOptions {
  db: Database
  env: Env
  /** Tests pass a local socket URL. The route does not read this from the client. */
  endpoint?: string
}

/**
 * Proxies one Doubao voice-clone utterance.
 *
 * The browser sends text and a speaker id. The server adds `X-Api-Key` from
 * `VOLCENGINE_SPEECH_ACCESS_TOKEN`. A key on the request is ignored.
 */
export function createVolcengineSpeechHandler(input: VolcengineSpeechHandlerOptions) {
  return async function handleVolcengineSpeech(c: Context) {
    await requireUser(input.db, input.env, c.req.raw.headers)
    const accessToken = requireAccessToken(input.env)

    let payload: unknown
    try {
      payload = await c.req.json()
    }
    catch {
      throw createBadRequestError('Volcengine speech request is not JSON.', 'BAD_REQUEST')
    }

    const parsed = safeParse(speechRequestSchema, payload)
    if (!parsed.success)
      throw createBadRequestError('Volcengine speech request is invalid.', 'BAD_REQUEST')

    const speech = await synthesizeVolcengineIcl({
      text: parsed.output.input,
      speaker: parsed.output.voice,
      format: parsed.output.response_format,
    }, {
      accessToken,
      endpoint: input.endpoint,
      fetchImpl: input.fetchImpl,
      abortSignal: c.req.raw.signal,
    })

    const audio = new ArrayBuffer(speech.body.byteLength)
    new Uint8Array(audio).set(speech.body)
    return new Response(audio, {
      status: 200,
      headers: { 'content-type': speech.contentType },
    })
  }
}

/**
 * Proxies a microphone PCM stream to Doubao SAUC.
 *
 * The browser uploads audio and reads transcript events. The server adds the
 * access token. A key on the request is ignored.
 */
export function createVolcengineTranscriptionHandler(input: VolcengineTranscriptionHandlerOptions) {
  return async function handleVolcengineTranscription(c: Context) {
    await requireUser(input.db, input.env, c.req.raw.headers)
    const accessToken = requireAccessToken(input.env)
    const audioStream = c.req.raw.body
    if (!audioStream)
      throw createBadRequestError('Volcengine recognition request has no audio.', 'BAD_REQUEST')

    return await createVolcengineSaucStreamResponse({
      accessToken,
      audioStream,
      abortSignal: c.req.raw.signal,
      endpoint: input.endpoint,
    })
  }
}

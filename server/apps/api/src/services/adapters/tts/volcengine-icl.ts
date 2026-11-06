import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import { createBadGatewayError, createBadRequestError, createServiceUnavailableError } from '@proj-airi/http-error-shared'
import { nullable, number, object, optional, safeParse, string } from 'valibot'

/**
 * Doubao voice clone 2.0 resource. The V1 unspeech path cannot select it.
 */
export const VOLCENGINE_ICL_RESOURCE_ID = 'seed-icl-2.0'

/**
 * Cloned speaker for the call. The browser can override it with `voice`.
 */
export const VOLCENGINE_ICL_DEFAULT_SPEAKER = 'S_hMBcmqRi2'

/**
 * Official HTTP speech endpoint. The request uses `X-Api-Key` and does not send an app id.
 */
export const VOLCENGINE_ICL_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional'

const SUCCESS_CODES = new Set([0, 20000000])

const iclLineSchema = object({
  code: optional(number()),
  message: optional(string()),
  data: optional(nullable(string())),
})

export interface VolcengineIclSpeechInput {
  text: string
  speaker?: string
  format?: 'mp3' | 'pcm' | 'wav' | 'ogg_opus'
  sampleRate?: number
}

export interface VolcengineIclSpeechDependencies {
  /** Server access token. The adapter never reads a key from the caller body. */
  accessToken: string
  fetchImpl?: typeof fetch
  endpoint?: string
  requestId?: string
  abortSignal?: AbortSignal
}

export interface VolcengineIclSpeechResult {
  contentType: string
  body: Uint8Array
}

function contentTypeForFormat(format: string): string {
  switch (format) {
    case 'pcm':
      return 'audio/pcm'
    case 'wav':
      return 'audio/wav'
    case 'ogg_opus':
      return 'audio/ogg'
    default:
      return 'audio/mpeg'
  }
}

function redactSecret(text: string, secret: string): string {
  if (!secret)
    return text
  return text.split(secret).join('[redacted]')
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

/**
 * Joins base64 audio chunks from the unidirectional NDJSON body.
 *
 * @example
 * readVolcengineIclAudio('{"code":0,"data":"aGVsbG8="}\n{"code":20000000,"message":"OK"}\n', 'secret')
 * // => Uint8Array of "hello"
 */
export function readVolcengineIclAudio(payload: string, accessToken: string): Uint8Array {
  const chunks: Uint8Array[] = []
  for (const line of payload.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed)
      continue

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(trimmed)
    }
    catch {
      throw createBadGatewayError('Volcengine speech returned a line the proxy cannot read.')
    }

    const parsed = safeParse(iclLineSchema, parsedJson)
    if (!parsed.success)
      throw createBadGatewayError('Volcengine speech returned a line the proxy cannot read.')

    const code = parsed.output.code
    if (code !== undefined && !SUCCESS_CODES.has(code)) {
      const detail = redactSecret(parsed.output.message ?? '', accessToken).slice(0, 180)
      throw createBadGatewayError(
        detail
          ? `Volcengine speech failed with code ${code}. ${detail}`
          : `Volcengine speech failed with code ${code}.`,
        { lastStatusCode: code },
      )
    }

    const data = parsed.output.data
    if (!data)
      continue
    chunks.push(Buffer.from(data, 'base64'))
  }

  if (chunks.length === 0)
    throw createBadGatewayError('Volcengine speech returned no audio.')

  return concatBytes(chunks)
}

/**
 * Synthesizes one utterance with Doubao voice clone 2.0.
 *
 * The access token is the `X-Api-Key` header. This path does not call unspeech
 * and does not send an app id.
 */
export async function synthesizeVolcengineIcl(
  input: VolcengineIclSpeechInput,
  deps: VolcengineIclSpeechDependencies,
): Promise<VolcengineIclSpeechResult> {
  const accessToken = deps.accessToken.trim()
  if (!accessToken) {
    throw createServiceUnavailableError(
      'Volcengine speech proxy has no access token. Set VOLCENGINE_SPEECH_ACCESS_TOKEN on the server.',
      'VOLCENGINE_SPEECH_NOT_CONFIGURED',
    )
  }

  const text = input.text.trim()
  if (!text)
    throw createBadRequestError('Volcengine speech request has no text.', 'BAD_REQUEST')

  const format = input.format ?? 'mp3'
  const speaker = input.speaker?.trim() || VOLCENGINE_ICL_DEFAULT_SPEAKER
  const sampleRate = input.sampleRate ?? 24000
  const endpoint = deps.endpoint ?? VOLCENGINE_ICL_ENDPOINT
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch
  const body = {
    user: { uid: 'airi-server' },
    req_params: {
      text,
      speaker,
      audio_params: {
        format,
        sample_rate: sampleRate,
      },
    },
  }

  let response: Response
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': accessToken,
        'X-Api-Resource-Id': VOLCENGINE_ICL_RESOURCE_ID,
        'X-Api-Request-Id': deps.requestId ?? randomUUID(),
      },
      body: JSON.stringify(body),
      signal: deps.abortSignal,
    })
  }
  catch (error) {
    const message = error instanceof Error ? redactSecret(error.message, accessToken) : 'Volcengine speech request failed.'
    throw createBadGatewayError(message.slice(0, 180))
  }

  if (!response.ok) {
    const upstream = redactSecret(await response.text(), accessToken).slice(0, 180)
    throw createBadGatewayError(
      upstream
        ? `Volcengine speech rejected the request with status ${response.status}. ${upstream}`
        : `Volcengine speech rejected the request with status ${response.status}.`,
      { lastStatusCode: response.status },
    )
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.startsWith('audio/')) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength === 0)
      throw createBadGatewayError('Volcengine speech returned no audio.')
    return { contentType, body: bytes }
  }

  return {
    contentType: contentTypeForFormat(format),
    body: readVolcengineIclAudio(await response.text(), accessToken),
  }
}

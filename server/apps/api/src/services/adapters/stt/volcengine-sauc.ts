import type { IncomingMessage } from 'node:http'

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import WebSocket from 'ws'

import { useLogger } from '@guiiai/logg'
import { createBadGatewayError, createBadRequestError, createGatewayTimeoutError, createServiceUnavailableError } from '@proj-airi/http-error-shared'
import { number, object, optional, safeParse, string } from 'valibot'

/**
 * Doubao streaming recognition 2.0 resource. The browser does not send this header.
 */
export const VOLCENGINE_SAUC_RESOURCE_ID = 'volc.seedasr.sauc.duration'

/**
 * Bidirectional SAUC endpoint. The proxy adds `X-Api-Key` from the server environment.
 */
export const VOLCENGINE_SAUC_ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel'

/**
 * 200 ms of 16 kHz 16-bit mono PCM. The SAUC service asks for packets of this size.
 */
const SAUC_AUDIO_PACKET_BYTES = 6400

/**
 * The handshake must fail the HTTP request. A hung socket must not hold the route open.
 */
const SAUC_CONNECT_TIMEOUT_MS = 10_000

const transcriptSchema = object({
  audio_info: optional(object({
    duration: optional(number()),
  })),
  result: optional(object({
    text: optional(string()),
  })),
})

const log = useLogger('volcengine-sauc').useGlobalConfig()
const encoder = new TextEncoder()

interface SaucResponseFrame {
  kind: 'response'
  final: boolean
  payload: Buffer
}

interface SaucErrorFrame {
  kind: 'error'
  code: number
  message: string
}

type SaucServerFrame = SaucResponseFrame | SaucErrorFrame

export interface VolcengineSaucStreamOptions {
  /** Server access token. The browser request cannot replace it. */
  accessToken: string
  audioStream: ReadableStream<Uint8Array>
  abortSignal?: AbortSignal
  /** Tests pass a local socket URL. The HTTP route does not read this from the client. */
  endpoint?: string
}

function redactSecret(text: string, secret: string): string {
  if (!secret)
    return text
  return text.split(secret).join('[redacted]')
}

function toBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data))
    return data
  if (Array.isArray(data))
    return Buffer.concat(data)
  return Buffer.from(data)
}

function encodeClientFrame(messageType: number, flags: number, serialization: number, payload: Buffer): Buffer {
  const header = Buffer.from([
    0x11,
    (messageType << 4) | (flags & 0x0F),
    (serialization << 4) & 0xF0,
    0x00,
  ])
  const size = Buffer.alloc(4)
  size.writeUInt32BE(payload.length)
  return Buffer.concat([header, size, payload])
}

function fullClientRequest(): Buffer {
  const payload = Buffer.from(JSON.stringify({
    user: { uid: 'airi-server' },
    audio: {
      format: 'pcm',
      codec: 'raw',
      rate: 16000,
      bits: 16,
      channel: 1,
    },
    request: {
      model_name: 'bigmodel',
      enable_itn: true,
      enable_punc: true,
      show_utterances: true,
      result_type: 'full',
      // The call closes the upload on voice activity. This silence window ends a phrase if the upload stays open.
      end_window_size: 800,
    },
  }))
  return encodeClientFrame(0b0001, 0b0000, 0b0001, payload)
}

function audioPacket(audio: Uint8Array, final: boolean): Buffer {
  return encodeClientFrame(0b0010, final ? 0b0010 : 0b0000, 0b0000, Buffer.from(audio))
}

function decodeServerFrame(data: Buffer): SaucServerFrame {
  if (data.length < 8)
    throw createBadGatewayError('Volcengine recognition sent a short frame.')

  const headerBytes = (data[0] & 0x0F) * 4
  const messageType = data[1] >> 4
  const flags = data[1] & 0x0F
  const compression = data[2] & 0x0F
  let offset = headerBytes

  if (messageType === 0b1111) {
    if (data.length < offset + 8)
      throw createBadGatewayError('Volcengine recognition sent a short error frame.')
    const code = data.readUInt32BE(offset)
    const size = data.readUInt32BE(offset + 4)
    const message = data.subarray(offset + 8, offset + 8 + size).toString('utf8')
    return { kind: 'error', code, message }
  }

  if ((flags & 0x01) !== 0) {
    if (data.length < offset + 4)
      throw createBadGatewayError('Volcengine recognition sent a short frame.')
    offset += 4
  }

  if (data.length < offset + 4)
    throw createBadGatewayError('Volcengine recognition sent a short frame.')

  const payloadSize = data.readUInt32BE(offset)
  offset += 4
  if (compression !== 0)
    throw createBadGatewayError('Volcengine recognition compressed the frame. The proxy asked for plain bytes.')

  return {
    kind: 'response',
    final: (flags & 0x02) !== 0,
    payload: data.subarray(offset, offset + payloadSize),
  }
}

function readTranscript(payload: Buffer): { text?: string, duration?: number } {
  if (payload.length === 0)
    return {}

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(payload.toString('utf8'))
  }
  catch {
    throw createBadGatewayError('Volcengine recognition returned a transcript the proxy cannot read.')
  }

  const parsed = safeParse(transcriptSchema, parsedJson)
  if (!parsed.success)
    throw createBadGatewayError('Volcengine recognition returned a transcript the proxy cannot read.')

  return {
    text: parsed.output.result?.text,
    duration: parsed.output.audio_info?.duration,
  }
}

function encodeSnapshot(text: string, isFinal: boolean, durationMilliseconds: number): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({
    type: 'transcript.text.snapshot',
    text,
    isFinal,
    locale: 'und',
    startMilliseconds: 0,
    durationMilliseconds,
  })}\n\n`)
}

function openSocket(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createBadRequestError('Volcengine recognition was cancelled.', 'BAD_REQUEST'))
      return
    }

    const ws = new WebSocket(url, { headers })
    let settled = false
    const timer = setTimeout(() => {
      fail(createGatewayTimeoutError('Volcengine recognition did not connect.'))
      ws.terminate()
    }, SAUC_CONNECT_TIMEOUT_MS)

    function settle(error?: Error) {
      if (settled)
        return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (error) {
        reject(error)
        return
      }
      resolve(ws)
    }

    function fail(error: Error) {
      if (!settled)
        ws.terminate()
      settle(error)
    }

    function onAbort() {
      fail(createBadRequestError('Volcengine recognition was cancelled.', 'BAD_REQUEST'))
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    ws.once('open', () => settle())
    ws.once('error', () => {
      fail(createBadGatewayError('Volcengine recognition connection failed.'))
    })
    ws.on('unexpected-response', (_request, response: IncomingMessage) => {
      response.resume()
      const status = response.statusCode ?? 0
      fail(createBadGatewayError(
        `Volcengine recognition rejected the connection with status ${status}.`,
        { lastStatusCode: status },
      ))
    })
    ws.on('upgrade', (response: IncomingMessage) => {
      const logId = response.headers['x-tt-logid']
      if (typeof logId === 'string' && logId)
        log.withFields({ logId }).log('Volcengine recognition connected')
    })
  })
}

/**
 * Streams microphone PCM to Doubao SAUC and returns transcript snapshots.
 *
 * The browser posts audio to AIRI. This function adds the server access token
 * and speaks the SAUC binary protocol. The response is the SSE shape that
 * `streamTranscription` already reads.
 */
export async function createVolcengineSaucStreamResponse(options: VolcengineSaucStreamOptions): Promise<Response> {
  const accessToken = options.accessToken.trim()
  if (!accessToken) {
    throw createServiceUnavailableError(
      'Volcengine speech proxy has no access token. Set VOLCENGINE_SPEECH_ACCESS_TOKEN on the server.',
      'VOLCENGINE_SPEECH_NOT_CONFIGURED',
    )
  }

  const requestId = randomUUID()
  const ws = await openSocket(options.endpoint ?? VOLCENGINE_SAUC_ENDPOINT, {
    'X-Api-Key': accessToken,
    'X-Api-Resource-Id': VOLCENGINE_SAUC_RESOURCE_ID,
    'X-Api-Request-Id': requestId,
    'X-Api-Connect-Id': randomUUID(),
    'X-Api-Sequence': '-1',
  }, options.abortSignal)

  const queue: Buffer[] = []
  let notify: (() => void) | undefined
  let failed: Error | undefined
  let socketClosed = false

  function wake() {
    const resolve = notify
    notify = undefined
    resolve?.()
  }

  ws.on('message', (data) => {
    queue.push(toBuffer(data))
    wake()
  })
  ws.on('error', () => {
    failed ??= createBadGatewayError('Volcengine recognition connection failed.')
    wake()
  })
  ws.on('close', () => {
    socketClosed = true
    wake()
  })

  async function takeFrame(): Promise<SaucServerFrame> {
    for (;;) {
      const next = queue.shift()
      if (next)
        return decodeServerFrame(next)
      if (failed)
        throw failed
      if (socketClosed)
        throw createBadGatewayError('Volcengine recognition closed before the final transcript.')
      await new Promise<void>((resolve) => {
        notify = resolve
      })
    }
  }

  let serverDone = false
  let lastText = ''
  let durationMilliseconds = 0

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const responseTask = (async () => {
        while (!serverDone) {
          const frame = await takeFrame()
          if (frame.kind === 'error') {
            const detail = redactSecret(frame.message, accessToken).slice(0, 180)
            throw createBadGatewayError(
              detail
                ? `Volcengine recognition failed with code ${frame.code}. ${detail}`
                : `Volcengine recognition failed with code ${frame.code}.`,
              { lastStatusCode: frame.code },
            )
          }

          const transcript = readTranscript(frame.payload)
          if (typeof transcript.duration === 'number')
            durationMilliseconds = transcript.duration
          if (typeof transcript.text === 'string' && transcript.text !== lastText) {
            lastText = transcript.text
            controller.enqueue(encodeSnapshot(transcript.text, frame.final, durationMilliseconds))
          }
          else if (frame.final && lastText) {
            controller.enqueue(encodeSnapshot(lastText, true, durationMilliseconds))
          }

          if (frame.final) {
            serverDone = true
            return
          }
        }
      })()

      ws.send(fullClientRequest())
      const reader = options.audioStream.getReader()
      let pending = Buffer.alloc(0)
      try {
        while (ws.readyState === WebSocket.OPEN) {
          const next = await reader.read()
          if (next.done)
            break
          if (next.value)
            pending = Buffer.concat([pending, Buffer.from(next.value)])
          while (pending.length >= SAUC_AUDIO_PACKET_BYTES && ws.readyState === WebSocket.OPEN) {
            ws.send(audioPacket(pending.subarray(0, SAUC_AUDIO_PACKET_BYTES), false))
            pending = pending.subarray(SAUC_AUDIO_PACKET_BYTES)
          }
        }
        if (ws.readyState === WebSocket.OPEN)
          ws.send(audioPacket(pending, true))
        await responseTask
        controller.close()
        if (ws.readyState === WebSocket.OPEN)
          ws.close(1000, 'completed')
      }
      catch (error) {
        serverDone = true
        if (ws.readyState === WebSocket.OPEN)
          ws.close(1011, 'recognition_failed')
        await responseTask.catch(() => undefined)
        controller.error(error)
      }
      finally {
        reader.releaseLock()
      }
    },
    cancel() {
      serverDone = true
      if (ws.readyState === WebSocket.OPEN)
        ws.close(1000, 'client_cancelled')
    },
  })

  return new Response(body, {
    headers: {
      'cache-control': 'no-cache',
      'content-type': 'text/event-stream',
    },
  })
}

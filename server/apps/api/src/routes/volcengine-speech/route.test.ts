import type { AddressInfo } from 'node:net'

import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'

import { useLogger } from '@guiiai/logg'
import { createErrorHandler } from '@proj-airi/http-error-shared'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'

import { parseEnv } from '../../libs/env'
import { VOLCENGINE_ICL_ENDPOINT } from '../../services/adapters/tts/volcengine-icl'
import { createVolcengineSpeechHandler, createVolcengineTranscriptionHandler } from './route'

function routeEnv(token?: string) {
  return parseEnv({
    DATABASE_URL: 'postgres://example',
    REDIS_URL: 'redis://example',
    S3_BUCKET: 'private-bucket',
    S3_REGION: 'auto',
    LLM_ROUTER_MASTER_KEY: Buffer.alloc(32, 0xAA).toString('base64'),
    TEST_AUTH_TOKEN: 'test-token',
    ...(token ? { VOLCENGINE_SPEECH_ACCESS_TOKEN: token } : {}),
  })
}

function speechApp(token?: string, fetchImpl?: typeof fetch) {
  return new Hono()
    .onError(createErrorHandler(useLogger('test')))
    .post('/api/v1/volcengine/audio/speech', createVolcengineSpeechHandler({
      db: {} as never,
      env: routeEnv(token),
      fetchImpl,
    }))
}

describe('volcengine speech proxy route', () => {
  it('rejects an anonymous speech request', async () => {
    const response = await speechApp('server-token').request('/api/v1/volcengine/audio/speech', {
      method: 'POST',
      body: JSON.stringify({ input: 'Hello' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(401)
  })

  it('returns 503 when the server token is unset', async () => {
    const response = await speechApp().request('/api/v1/volcengine/audio/speech', {
      method: 'POST',
      headers: {
        'authorization': 'Bearer test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ input: 'Hello' }),
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ error: 'VOLCENGINE_SPEECH_NOT_CONFIGURED' })
  })

  /**
   * @example
   * POST /api/v1/volcengine/audio/speech { input: 'Hello', api_key: 'client-secret' }
   */
  it('forwards the server token and drops a client key', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      const audio = Buffer.from('hello-audio').toString('base64')
      return new Response(`${JSON.stringify({ code: 0, data: audio })}\n`, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const response = await speechApp('server-token', fetchImpl).request('/api/v1/volcengine/audio/speech', {
      method: 'POST',
      headers: {
        'authorization': 'Bearer test-token',
        'content-type': 'application/json',
        'x-api-key': 'client-secret',
      },
      body: JSON.stringify({
        model: 'seed-icl-2.0',
        input: 'Hello',
        voice: 'S_hMBcmqRi2',
        api_key: 'client-secret',
      }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('audio/mpeg')
    expect(response.headers.get('x-api-key')).toBeNull()
    expect(Buffer.from(await response.arrayBuffer()).toString('utf8')).toBe('hello-audio')
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(VOLCENGINE_ICL_ENDPOINT)
    expect(new Headers(init?.headers).get('x-api-key')).toBe('server-token')
    expect(String(init?.body)).not.toContain('client-secret')
  })
})

describe('volcengine recognition proxy route', () => {
  it('rejects an anonymous recognition request', async () => {
    const app = new Hono()
      .onError(createErrorHandler(useLogger('test')))
      .post('/api/v1/volcengine/audio/transcriptions/stream', createVolcengineTranscriptionHandler({
        db: {} as never,
        env: routeEnv('server-token'),
      }))

    const response = await app.request('/api/v1/volcengine/audio/transcriptions/stream', {
      method: 'POST',
      body: new Uint8Array([1, 2, 3]),
    })

    expect(response.status).toBe(401)
  })

  it('proxies PCM with the server token when the client also sends a key', async () => {
    const observed: { key?: string | string[], resource?: string | string[] } = {}
    const httpServer = createServer()
    const wss = new WebSocketServer({ server: httpServer })
    wss.on('connection', (socket, request) => {
      observed.key = request.headers['x-api-key']
      observed.resource = request.headers['x-api-resource-id']
      socket.on('message', (data) => {
        const frame = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
        const messageType = frame[1] >> 4
        const flags = frame[1] & 0x0F
        if (messageType === 0b0010 && (flags & 0x02) !== 0) {
          const payload = Buffer.from(JSON.stringify({ result: { text: 'proxy hello' } }))
          const header = Buffer.from([0x11, 0x93, 0x10, 0x00])
          const sequence = Buffer.alloc(4)
          sequence.writeInt32BE(-1)
          const size = Buffer.alloc(4)
          size.writeUInt32BE(payload.length)
          socket.send(Buffer.concat([header, sequence, size, payload]))
        }
      })
    })
    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', resolve)
    })
    const port = (httpServer.address() as AddressInfo).port

    try {
      const app = new Hono()
        .onError(createErrorHandler(useLogger('test')))
        .post('/api/v1/volcengine/audio/transcriptions/stream', createVolcengineTranscriptionHandler({
          db: {} as never,
          env: routeEnv('server-token'),
          endpoint: `ws://127.0.0.1:${port}/api/v3/sauc/bigmodel`,
        }))
      const response = await app.request('/api/v1/volcengine/audio/transcriptions/stream', {
        method: 'POST',
        headers: {
          'authorization': 'Bearer test-token',
          'x-api-key': 'client-secret',
        },
        body: new Uint8Array(32),
      })

      expect(response.status).toBe(200)
      expect(observed.key).toBe('server-token')
      expect(observed.key).not.toBe('client-secret')
      expect(observed.resource).toBe('volc.seedasr.sauc.duration')
      await expect(response.text()).resolves.toContain('proxy hello')
    }
    finally {
      await new Promise<void>((resolve, reject) => {
        wss.close((error) => {
          if (error)
            reject(error)
          else
            httpServer.close(() => resolve())
        })
      })
    }
  })
})

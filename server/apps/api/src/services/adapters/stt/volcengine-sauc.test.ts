import type { AddressInfo } from 'node:net'

import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'

import { describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'

import { createVolcengineSaucStreamResponse, VOLCENGINE_SAUC_RESOURCE_ID } from './volcengine-sauc'

function serverFrame(payload: unknown, final: boolean): Buffer {
  const bytes = Buffer.from(JSON.stringify(payload))
  const header = Buffer.from([0x11, final ? 0x93 : 0x91, 0x10, 0x00])
  const sequence = Buffer.alloc(4)
  sequence.writeInt32BE(final ? -1 : 1)
  const size = Buffer.alloc(4)
  size.writeUInt32BE(bytes.length)
  return Buffer.concat([header, sequence, size, bytes])
}

function readClientPayload(frame: Buffer): { messageType: number, flags: number, json?: unknown } {
  const messageType = frame[1] >> 4
  const flags = frame[1] & 0x0F
  const serialization = frame[2] >> 4
  const size = frame.readUInt32BE(4)
  const payload = frame.subarray(8, 8 + size)
  return {
    messageType,
    flags,
    json: serialization === 1 ? JSON.parse(payload.toString('utf8')) as unknown : undefined,
  }
}

describe('createVolcengineSaucStreamResponse', () => {
  /**
   * @example
   * createVolcengineSaucStreamResponse({ accessToken: 'server-token', audioStream, endpoint })
   */
  it('sends the server token to SAUC and returns the transcript', async () => {
    const observedHeaders: Record<string, string | string[] | undefined> = {}
    const clientFrames: Buffer[] = []
    const httpServer = createServer()
    const wss = new WebSocketServer({ server: httpServer })

    wss.on('connection', (socket, request) => {
      Object.assign(observedHeaders, request.headers)
      socket.on('message', (data) => {
        const frame = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
        clientFrames.push(frame)
        const decoded = readClientPayload(frame)
        if (decoded.messageType === 0b0001) {
          socket.send(serverFrame({ result: { text: '' } }, false))
          return
        }
        const final = (decoded.flags & 0x02) !== 0
        socket.send(serverFrame({
          audio_info: { duration: 200 },
          result: { text: final ? 'hello airi' : 'hello' },
        }, final))
      })
    })

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', resolve)
    })
    const port = (httpServer.address() as AddressInfo).port

    try {
      const audio = new Uint8Array(7000)
      const audioStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(audio)
          controller.close()
        },
      })
      const response = await createVolcengineSaucStreamResponse({
        accessToken: 'server-token',
        audioStream,
        endpoint: `ws://127.0.0.1:${port}/api/v3/sauc/bigmodel`,
      })
      const text = await response.text()

      expect(response.headers.get('content-type')).toContain('text/event-stream')
      expect(observedHeaders['x-api-key']).toBe('server-token')
      expect(observedHeaders['x-api-resource-id']).toBe(VOLCENGINE_SAUC_RESOURCE_ID)
      expect(observedHeaders['x-api-app-key']).toBeUndefined()
      expect(JSON.stringify(observedHeaders)).not.toContain('client-secret')
      expect(text).toContain('transcript.text.snapshot')
      expect(text).toContain('hello airi')

      const fullRequest = clientFrames.map(readClientPayload).find(frame => frame.messageType === 0b0001)
      expect(fullRequest?.json).toMatchObject({
        audio: { format: 'pcm', rate: 16000 },
        request: { model_name: 'bigmodel' },
      })
      expect(JSON.stringify(fullRequest?.json)).not.toContain('server-token')
      expect(JSON.stringify(fullRequest?.json)).not.toContain('appid')
      const audioFrames = clientFrames.map(readClientPayload).filter(frame => frame.messageType === 0b0010)
      const lastAudio = audioFrames.at(-1)
      expect(audioFrames.length).toBeGreaterThan(1)
      expect(lastAudio).toBeDefined()
      expect((lastAudio?.flags ?? 0) & 0x02).toBe(0x02)
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

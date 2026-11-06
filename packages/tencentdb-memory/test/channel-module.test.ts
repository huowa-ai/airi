import type { AddressInfo } from 'node:net'

import type { WebSocketEvent } from '@proj-airi/server-sdk'

import type { MemoryV3Client } from '../src/memory-client'

import { parseEvent, stringifyEvent } from '@proj-airi/server-sdk'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'

import { memoryModuleName, startMemoryModule } from '../src/channel-module'
import { createFakeMemoryStorage } from '../src/memory-storage'

const servers: WebSocketServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })))
})

async function fakeChannel() {
  const received: WebSocketEvent[] = []
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  servers.push(server)

  server.on('connection', (socket) => {
    socket.on('message', (raw) => {
      const event = parseEvent(raw.toString())
      received.push(event)
      if (event.type !== 'extension:module:announce')
        return

      socket.send(stringifyEvent({
        type: 'extension:module:announced',
        data: event.data,
        metadata: {
          source: { kind: 'plugin', id: 'fake-server', plugin: { id: 'fake-server' } },
          event: { id: 'announced-1' },
        },
      }))
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve())
    server.once('error', reject)
  })

  const address = server.address() as AddressInfo
  return {
    received,
    url: `ws://127.0.0.1:${address.port}/ws`,
  }
}

describe('channel module', () => {
  it('announces itself and does not send input:text', async () => {
    const channel = await fakeChannel()
    const storage = createFakeMemoryStorage({ teamId: 'team-1', userId: 'user-1' })
    const calls: string[] = []
    const memoryClient: MemoryV3Client = {
      async addConversation() {
        calls.push('add')
        throw new Error('unexpected add')
      },
      async searchConversation() {
        calls.push('search')
        throw new Error('unexpected search')
      },
      async queryConversation() {
        calls.push('query')
        throw new Error('unexpected query')
      },
      async deleteConversation() {
        calls.push('delete')
        throw new Error('unexpected delete')
      },
      async queryAtomic() {
        calls.push('atomic')
        throw new Error('unexpected atomic')
      },
      async listScenarios() {
        calls.push('scenario')
        throw new Error('unexpected scenario')
      },
      async readScenario() {
        calls.push('scenario-read')
        throw new Error('unexpected scenario read')
      },
      async readCore() {
        calls.push('core')
        throw new Error('unexpected core')
      },
    }

    const started = await startMemoryModule({
      url: channel.url,
      storage,
      memoryClient,
      connectTimeoutMs: 3_000,
    })

    try {
      expect(started.channel.connectionStatus).toBe('ready')
      expect(started.storage).toBe(storage)
      expect(calls).toEqual([])

      const types = channel.received.map(event => event.type)
      expect(types).toContain('extension:module:announce')
      expect(types.filter(type => type !== 'transport:connection:heartbeat')).toEqual([
        'extension:module:announce',
      ])

      const announce = channel.received.find(event => event.type === 'extension:module:announce')
      expect(announce?.data).toMatchObject({
        name: memoryModuleName,
        possibleEvents: [],
      })
      expect(JSON.stringify(channel.received)).not.toContain('input:text')
    }
    finally {
      started.close()
    }
  })
})

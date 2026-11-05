import type { MemoryV3Client } from './memory-client'
import type { MemoryStorage } from './memory-storage'

import { Client } from '@proj-airi/server-sdk'

/** Channel name for this module. The server lists the module under this name. */
export const memoryModuleName = 'tencentdb-memory'

/** Default AIRI channel. `AIRI_URL` replaces it for the process entry. */
export const defaultChannelUrl = 'ws://localhost:6121/ws'

/**
 * Events this module declares. The list is empty.
 * `input:text` stays with the chat consumer group `chat-ingestion`.
 */
export const memoryModulePossibleEvents = [] as const

/** A connected channel client and the storage it serves. */
export interface MemoryModule {
  channel: Client
  storage: MemoryStorage
  memoryClient?: MemoryV3Client
  close: () => void
}

export interface StartMemoryModuleOptions {
  /** AIRI channel URL. @default ws://localhost:6121/ws */
  url?: string
  storage: MemoryStorage
  /** Present when the environment has a complete MemoryCore config. Startup does not call it. */
  memoryClient?: MemoryV3Client
  /** @default 15000 */
  connectTimeoutMs?: number
  signal?: AbortSignal
}

/**
 * Connects to the AIRI channel and announces this module.
 * The call resolves when the server accepts the announcement.
 * The module does not register a listener for `input:text`.
 */
export async function startMemoryModule(options: StartMemoryModuleOptions): Promise<MemoryModule> {
  const channel = new Client({
    name: memoryModuleName,
    url: options.url ?? defaultChannelUrl,
    possibleEvents: [...memoryModulePossibleEvents],
  })

  try {
    await channel.connect({
      timeout: options.connectTimeoutMs ?? 15_000,
      abortSignal: options.signal,
    })
  }
  catch (error) {
    channel.close()
    throw error
  }

  let closed = false

  return {
    channel,
    storage: options.storage,
    memoryClient: options.memoryClient,
    close() {
      if (closed)
        return
      closed = true
      channel.close()
    },
  }
}

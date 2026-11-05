import process from 'node:process'

import { Format, LogLevel, setGlobalFormat, setGlobalLogLevel, useLogg } from '@guiiai/logg'
import { errorMessageFrom } from '@moeru/std'
import { runUntilSignal } from '@proj-airi/server-sdk/utils/node'

import { defaultChannelUrl, startMemoryModule } from './channel-module'
import { memoryClientConfigStatus, readMemoryClientConfig } from './client-config'
import { createMemoryClient } from './memory-client'
import { createFakeMemoryStorage } from './memory-storage'

setGlobalFormat(Format.Pretty)
setGlobalLogLevel(LogLevel.Log)

/**
 * Starts the memory module and waits for a stop signal.
 *
 * Call stack:
 *
 * main
 *   -> {@link readMemoryClientConfig}
 *   -> {@link createFakeMemoryStorage}
 *   -> {@link startMemoryModule}
 *     -> Client.connect
 */
async function main() {
  const log = useLogg('tencentdb-memory').useGlobalConfig()
  const channelUrl = process.env.AIRI_URL || defaultChannelUrl
  const configResult = readMemoryClientConfig(process.env)
  const status = memoryClientConfigStatus(configResult)
  const storage = createFakeMemoryStorage({
    teamId: configResult.configured ? configResult.config.teamId : 'unconfigured',
    userId: configResult.configured ? configResult.config.userId : 'unconfigured',
  })
  const memoryClient = configResult.configured ? createMemoryClient(configResult.config) : undefined

  if (status.configured) {
    log.log('MemoryCore client is configured. Startup does not call it.')
  }
  else {
    const missing = status.missing.join(', ') || 'none'
    const invalid = status.invalid.join(', ') || 'none'
    log.log(`MemoryCore client is not configured. Missing: ${missing}. Invalid: ${invalid}.`)
  }

  const started = await startMemoryModule({
    url: channelUrl,
    storage,
    memoryClient,
  })
  log.log('Announced tencentdb-memory on the channel.')

  process.on('SIGINT', () => started.close())
  process.on('SIGTERM', () => started.close())
  runUntilSignal()
}

main().catch((error) => {
  console.error(errorMessageFrom(error) ?? 'The memory module failed to start.')
  process.exit(1)
})

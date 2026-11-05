import process from 'node:process'

import { errorMessageFrom } from '@moeru/std'

import { memoryClientConfigStatus, readMemoryClientConfig } from './client-config'
import { createMemoryClient } from './memory-client'

/**
 * Adds one L0 message and searches for it.
 * Run this only when a MemoryCore gateway is already up.
 *
 * Call stack:
 *
 * main
 *   -> {@link readMemoryClientConfig}
 *   -> {@link createMemoryClient}
 *     -> addConversation
 *     -> searchConversation
 */
async function main() {
  const result = readMemoryClientConfig(process.env)
  const status = memoryClientConfigStatus(result)
  if (!result.configured) {
    const missing = status.missing.join(', ') || 'none'
    const invalid = status.invalid.join(', ') || 'none'
    console.error(`MemoryCore client is not configured. Missing: ${missing}. Invalid: ${invalid}.`)
    process.exit(1)
  }

  const client = createMemoryClient(result.config)
  const sessionId = `airi-smoke-${crypto.randomUUID()}`
  const added = await client.addConversation({
    sessionId,
    messages: [{ role: 'user', content: 'AIRI memory smoke' }],
  })
  const found = await client.searchConversation({
    query: 'AIRI memory smoke',
    sessionId,
    limit: 5,
  })

  console.info(`L0 add accepted ${added.totalCount}. L0 search hits ${found.messages.length}.`)
}

main().catch((error) => {
  const message = errorMessageFrom(error) ?? 'L0 smoke failed.'
  console.error(message.includes('://') ? 'L0 smoke failed.' : message)
  process.exit(1)
})

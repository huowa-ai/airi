import type { CallSource } from './call-header'
import type { MemoryV3Client } from './memory-client'

import { projectCallContent, readCallHeader } from './call-header'
import { GENERAL_AGENT_ID } from './memory-storage'
import { readFactAgentIds } from './remote-memory'

const pageSize = 100
/** Messages read for one agent. Later rows stay unread. */
const maxScan = 1000
/** Tagged rows kept for the graph. */
const maxTurns = 200

/**
 * One L0 chat row that carries a call header.
 * `body` has the header removed. The graph draws this text.
 */
export interface CallTurnRecord {
  id: string
  agentId: string
  sessionId?: string
  role: 'user' | 'assistant'
  body: string
  callId?: string
  source?: CallSource
}

/**
 * Reads L0 rows whose content starts with the call header.
 * The directory agents are always included. `extraAgentIds` adds cards that have no fact yet.
 * A failed agent is skipped. The other agents still return.
 */
export async function readCallTurns(client: MemoryV3Client, extraAgentIds: readonly string[] = []): Promise<CallTurnRecord[]> {
  const agents = new Set<string>([GENERAL_AGENT_ID])
  try {
    for (const agentId of await readFactAgentIds(client))
      agents.add(agentId)
  }
  catch {
    // The directory read failed. Extra agent ids still get a read.
  }
  for (const agentId of extraAgentIds) {
    if (agentId)
      agents.add(agentId)
  }

  const items: CallTurnRecord[] = []
  for (const agentId of agents) {
    if (items.length >= maxTurns)
      break
    try {
      await readAgent(client, agentId, items)
    }
    catch {
      // One agent query failed. The next agent still runs.
    }
  }
  return items
}

async function readAgent(client: MemoryV3Client, agentId: string, items: CallTurnRecord[]) {
  let offset = 0
  let scanned = 0
  let total = Number.POSITIVE_INFINITY
  while (offset < total && scanned < maxScan && items.length < maxTurns) {
    const page = await client.queryConversation({ agentId, limit: pageSize, offset })
    total = page.total
    if (page.messages.length === 0)
      break
    for (const message of page.messages) {
      scanned += 1
      const mark = readCallHeader(message.content)
      if (mark) {
        items.push({
          id: message.id,
          agentId,
          role: message.role,
          body: projectCallContent(message.content),
          ...(message.sessionId ? { sessionId: message.sessionId } : {}),
          ...(mark.callId ? { callId: mark.callId } : {}),
          ...(mark.source ? { source: mark.source } : {}),
        })
      }
      if (items.length >= maxTurns || scanned >= maxScan)
        return
    }
    offset += page.messages.length
  }
}

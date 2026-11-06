import { projectCallContent } from './call-header'

/**
 * Recall limits for one query.
 * `limit` is the maximum number of hits. `maxChars` is the maximum text length.
 */
export const defaultRecallBudget = {
  limit: 5,
  maxChars: 800,
} as const

/** How many recent turns one session keeps before MemoryCore search returns them. */
const ringSize = 8

export interface RecallBudget {
  limit?: number
  maxChars?: number
}

export interface RecallPlace {
  teamId?: string
  userId?: string
}

export interface RecentTurn {
  turnId: string
  agentId: string
  sessionId: string
  /** Team from `resolveMemoryScope`. Rings for two teams stay separate. */
  teamId?: string
  /** User from `resolveMemoryScope`. Rings for two users stay separate. */
  userId?: string
  text: string
  at: number
  messageIds: string[]
}

export interface RecallHit {
  id: string
  text: string
  score: number
  at: number
  source: 'remote' | 'recent'
  agentId?: string
  sessionId?: string
  messageIds?: string[]
}

/**
 * Recent turns for one agent and session.
 * A turn stays here until a remote hit has the same text.
 */
export function createRecallBuffer() {
  const turns: RecentTurn[] = []

  return {
    note(turn: RecentTurn) {
      const place = { teamId: turn.teamId, userId: turn.userId }
      const index = turns.findIndex(item => item.turnId === turn.turnId && samePlace(item, turn.agentId, turn.sessionId, place))
      if (index >= 0)
        turns.splice(index, 1)
      turns.push({ ...turn, messageIds: [...turn.messageIds] })
      const mine = turns.filter(item => samePlace(item, turn.agentId, turn.sessionId, place))
      while (mine.length > ringSize) {
        const oldest = mine.shift()
        const at = oldest ? turns.indexOf(oldest) : -1
        if (at >= 0)
          turns.splice(at, 1)
      }
    },
    attach(turnId: string, sessionId: string, messageIds: string[], place?: RecallPlace) {
      const turn = turns.find(item => item.turnId === turnId && item.sessionId === sessionId && sameTeam(item, place))
      if (turn)
        turn.messageIds = [...messageIds]
    },
    drop(turnId: string, sessionId: string, place?: RecallPlace) {
      const index = turns.findIndex(item => item.turnId === turnId && item.sessionId === sessionId && sameTeam(item, place))
      if (index >= 0)
        turns.splice(index, 1)
    },
    newest(agentId: string, sessionId: string, place?: RecallPlace) {
      return turns.filter(item => samePlace(item, agentId, sessionId, place)).at(-1)
    },
    list(agentId: string, sessionId: string, place?: RecallPlace) {
      return turns.filter(item => samePlace(item, agentId, sessionId, place))
    },
  }
}

/**
 * Merges remote hits with recent turns.
 * The same normalized text is one hit. Rank is relevance, then time.
 * The result stops at the count and the character budget.
 */
export function mergeRecall(input: {
  query: string
  remote: RecallHit[]
  recent: RecentTurn[]
  budget?: RecallBudget
}): RecallHit[] {
  const limit = input.budget?.limit ?? defaultRecallBudget.limit
  const maxChars = input.budget?.maxChars ?? defaultRecallBudget.maxChars
  const remoteText = input.remote.map(hit => normalizeRecallText(projectCallContent(hit.text)))
  const recentHits = input.recent.flatMap((turn) => {
    const text = projectCallContent(turn.text).trim()
    if (text === '')
      return []
    const key = normalizeRecallText(text)
    if (remoteText.some(item => item === key || item.includes(key) || key.includes(item)))
      return []
    const overlap = tokenOverlap(input.query, text)
    return [{
      id: turn.turnId,
      text,
      score: Math.max(overlap, 0.5),
      at: turn.at,
      source: 'recent' as const,
      agentId: turn.agentId,
      sessionId: turn.sessionId,
      messageIds: [...turn.messageIds],
    }]
  })
  const ranked = [...input.remote, ...recentHits].sort((left, right) => right.score - left.score || right.at - left.at)
  const chosen: RecallHit[] = []
  let used = 0
  for (const hit of ranked) {
    if (chosen.length >= limit)
      break
    if (used >= maxChars)
      break
    const room = maxChars - used
    const plain = projectCallContent(hit.text)
    const text = plain.length <= room ? plain : plain.slice(0, room)
    if (text === '')
      continue
    chosen.push({ ...hit, text })
    used += text.length
  }
  return chosen
}

export function formatRecall(hits: readonly RecallHit[]) {
  if (hits.length === 0)
    return ''
  // The model prompt and the recall text use the body. The call header stays out.
  return ['Recent memory:', ...hits.map(hit => `- ${projectCallContent(hit.text)}`)].join('\n')
}

function samePlace(item: RecentTurn, agentId: string, sessionId: string, place?: RecallPlace) {
  if (item.agentId !== agentId || item.sessionId !== sessionId)
    return false
  return sameTeam(item, place)
}

function sameTeam(item: RecentTurn, place?: RecallPlace) {
  if (place === undefined)
    return true
  return (item.teamId ?? '') === (place.teamId ?? '') && (item.userId ?? '') === (place.userId ?? '')
}

function normalizeRecallText(text: string) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()
}

function tokenOverlap(query: string, text: string) {
  const left = new Set(normalizeRecallText(query).split(' ').filter(token => token.length > 1))
  const right = new Set(normalizeRecallText(text).split(' ').filter(token => token.length > 1))
  if (left.size === 0 || right.size === 0)
    return 0
  let shared = 0
  for (const token of left) {
    if (right.has(token))
      shared += 1
  }
  return shared / left.size
}

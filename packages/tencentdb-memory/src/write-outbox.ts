import type { ConversationMessageInput } from './memory-client'

export interface PendingWrite {
  turnId: string
  agentId: string
  sessionId: string
  /** Team from `resolveMemoryScope`. A retry sends this team. */
  teamId?: string
  /** User from `resolveMemoryScope`. A retry sends this user. */
  userId?: string
  /** Hash of the batch. The gateway does not store the turn id. */
  contentHash?: string
  messages: ConversationMessageInput[]
  attempts: number
  nextAttemptAt: number
}

export interface WriteOutboxState {
  pending: PendingWrite[]
  done: string[]
}

/** Waits before the next send of a failed batch. The first retry waits 1 second. The cap is 30 seconds. */
export function retryBackoffMs(attempts: number) {
  return Math.min(30_000, 1_000 * 2 ** Math.max(0, attempts - 1))
}

/**
 * Failed conversation writes, keyed by turn id.
 * A turn id in `done` is not sent again. A turn id in `pending` is one batch.
 */
export function createWriteOutbox(options: {
  load: () => WriteOutboxState
  save: (state: WriteOutboxState) => void
  now?: () => number
}) {
  const now = options.now ?? Date.now
  const state = options.load()
  const inflight = new Set<string>()

  function persist() {
    options.save({
      pending: state.pending.map(copyWrite),
      done: [...state.done],
    })
  }

  function rememberDone(turnId: string) {
    if (!state.done.includes(turnId))
      state.done.push(turnId)
    if (state.done.length > 200)
      state.done.splice(0, state.done.length - 200)
  }

  return {
    isDone(turnId: string) {
      return state.done.includes(turnId)
    },
    add(input: Omit<PendingWrite, 'attempts' | 'nextAttemptAt'>) {
      if (state.done.includes(input.turnId) || state.pending.some(row => row.turnId === input.turnId))
        return
      const attempts = 1
      state.pending.push({
        ...input,
        messages: input.messages.map(message => ({ ...message })),
        attempts,
        nextAttemptAt: now() + retryBackoffMs(attempts),
      })
      persist()
    },
    drop(turnId: string) {
      state.pending = state.pending.filter(row => row.turnId !== turnId)
      inflight.delete(turnId)
      rememberDone(turnId)
      persist()
    },
    due(at = now()) {
      return state.pending.filter(row => row.nextAttemptAt <= at && !inflight.has(row.turnId)).map(copyWrite)
    },
    begin(turnId: string) {
      inflight.add(turnId)
    },
    succeeded(turnId: string) {
      inflight.delete(turnId)
      state.pending = state.pending.filter(row => row.turnId !== turnId)
      rememberDone(turnId)
      persist()
    },
    failed(turnId: string, at = now()) {
      inflight.delete(turnId)
      const row = state.pending.find(item => item.turnId === turnId)
      if (!row)
        return
      row.attempts += 1
      row.nextAttemptAt = at + retryBackoffMs(row.attempts)
      persist()
    },
    nextWait(at = now()) {
      const times = state.pending.filter(row => !inflight.has(row.turnId)).map(row => row.nextAttemptAt)
      if (times.length === 0)
        return undefined
      return Math.max(0, Math.min(...times) - at)
    },
    pendingCount() {
      return state.pending.length
    },
  }
}

function copyWrite(row: PendingWrite): PendingWrite {
  return {
    ...row,
    messages: row.messages.map(message => ({ ...message })),
  }
}

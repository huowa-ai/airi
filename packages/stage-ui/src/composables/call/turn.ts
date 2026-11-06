import type { CallSource } from '@proj-airi/tencentdb-memory'

/**
 * Partial text starts recall after this many characters.
 * A shorter fragment changes too often to search.
 */
export const CALL_PARTIAL_RECALL_CHARS = 4

/**
 * Recall that is still pending after this delay speaks the filler.
 * The reply model still waits for recall.
 */
export const CALL_FILLER_DELAY_MS = 400

/**
 * Temporary filler lines.
 *
 * TODO:
 * Pull request H owns the i18n keys for these lines.
 * English is the ADR line. Chinese matches the played-filler memory text.
 */
export const CALL_FILLER_EN = 'Let me think.'
export const CALL_FILLER_ZH = '嗯，我想想'

/**
 * Picks the filler line from the active locale.
 *
 * @example
 * callFillerLine('zh-CN')
 * // => '嗯，我想想'
 */
export function callFillerLine(locale: string) {
  return locale.toLowerCase().startsWith('zh') ? CALL_FILLER_ZH : CALL_FILLER_EN
}

/**
 * Returns the partial text that is long enough to prefetch recall.
 * The same text again is the caller's job to skip.
 */
export function partialRecallQuery(text: string) {
  const query = text.trim()
  if ([...query].length < CALL_PARTIAL_RECALL_CHARS)
    return undefined
  return query
}

export interface RecallOrFillerOptions {
  recall: Promise<unknown>
  /** @default 400 */
  delayMs?: number
  wait: (ms: number) => Promise<void>
  onSlow: () => Promise<void> | void
}

/**
 * Waits for recall. When recall is still pending after the delay, `onSlow` runs.
 * The returned promise still waits for recall, so the reply model does not start early.
 */
export async function recallOrFiller(options: RecallOrFillerOptions) {
  let ready = false
  const recall = options.recall.finally(() => {
    ready = true
  })
  await Promise.race([
    recall,
    options.wait(options.delayMs ?? CALL_FILLER_DELAY_MS),
  ])
  if (!ready)
    await options.onSlow()
  await recall
}

/**
 * Assistant text for one call turn.
 * An interrupt returns only the text that already played, or an empty string when nothing played.
 * A finished turn returns undefined when the model text can be stored as it is.
 * A played filler is added in front of that model text.
 */
export function callTurnAssistantText(input: {
  interrupted: boolean
  outputText: string
  playedText: string
  fillerHeard?: string
}) {
  if (input.interrupted)
    return input.playedText.trim()
  if (input.fillerHeard && !input.outputText.startsWith(input.fillerHeard))
    return `${input.fillerHeard}\n${input.outputText}`.trim()
  return undefined
}

/** Joins sentences that already started playback. */
export function joinPlayedText(lines: readonly string[]) {
  return lines.map(line => line.trim()).filter(line => line !== '').join(' ')
}

/** One spoken call input, before the chat hook reads it. */
interface CallUtterance {
  sessionId: string
  turnId: string
}

let utterance: CallUtterance | undefined

/** Marks the next chat turn of this id as speech from the active call. */
export function noteCallUtterance(sessionId: string, turnId: string) {
  utterance = { sessionId, turnId }
}

/** Reads the mark without removing it. */
export function peekCallUtterance(sessionId: string, turnId: string) {
  return utterance?.sessionId === sessionId && utterance.turnId === turnId
}

/** Removes the mark when this turn consumes it. Another turn id leaves the mark. */
export function takeCallUtterance(sessionId: string, turnId: string) {
  if (!peekCallUtterance(sessionId, turnId))
    return false
  utterance = undefined
  return true
}

export interface CallTurnRead {
  sessionId: string
  turnId: string
  interrupted: boolean
  outputText: string
}

export interface CallTurnMark {
  callId?: string
  source?: CallSource
  /**
   * Replaces the assistant text.
   * An empty string means the interrupt played nothing, so the turn is skipped.
   */
  assistantText?: string
  /**
   * The call writes the turn after playback ends or an interrupt.
   * The chat hook does not write it now.
   */
  defer?: boolean
}

type CallTurnReader = (input: CallTurnRead) => CallTurnMark | undefined

let reader: CallTurnReader | undefined

/** The orchestrator installs this. The chat capture reads it. There is no import cycle. */
export function bindCallTurnReader(next: CallTurnReader) {
  reader = next
  return () => {
    if (reader === next)
      reader = undefined
  }
}

/** The mark for one finished turn. Undefined when this turn is not part of a call. */
export function readCallTurn(input: CallTurnRead) {
  return reader?.(input)
}

export interface CallRecallInput {
  sessionId: string
  turnId: string
  message: string
  /** Scene replies and background tasks stay out of the call. */
  speaks: boolean
}

type CallRecallWait = (input: CallRecallInput) => Promise<boolean>

let recallWait: CallRecallWait | undefined

/**
 * The orchestrator installs this. The chat compose hook calls it.
 * A true result means recall already ran, including a filler when recall was slow.
 */
export function bindCallRecall(next: CallRecallWait) {
  recallWait = next
  return () => {
    if (recallWait === next)
      recallWait = undefined
  }
}

/** False when no call owns the turn. The chat hook then recalls as it does for typing. */
export function waitForCallRecall(input: CallRecallInput) {
  return recallWait?.(input) ?? Promise.resolve(false)
}

type CallInterrupt = (turn: { sessionId: string, turnId: string }) => void

let interrupt: CallInterrupt | undefined

/** The voice controller calls this when playback is interrupted. The orchestrator stores played text. */
export function bindCallInterrupt(next: CallInterrupt) {
  interrupt = next
  return () => {
    if (interrupt === next)
      interrupt = undefined
  }
}

/** No work when this turn is not part of a call. */
export function noteCallInterrupt(turn: { sessionId: string, turnId: string }) {
  interrupt?.(turn)
}

const hasSound = /[\p{L}\p{N}]/u

/** A sentence is ready when its trim ends in sentence punctuation. */
function endsSentence(text: string) {
  return /[.!?。？！…]$/.test(text.trim())
}

/**
 * Splits text into sentences that can be spoken, and the unfinished tail.
 *
 * @example
 * takeSentences(new Intl.Segmenter('en', { granularity: 'sentence' }), 'Hello. Still', false)
 * // => { ready: ['Hello.'], rest: ' Still' }
 */
export function takeSentences(segmenter: Intl.Segmenter, text: string, final: boolean) {
  if (text === '')
    return { ready: [] as string[], rest: '' }

  const parts = [...segmenter.segment(text)].map(part => part.segment).filter(part => part !== '')
  if (final)
    return { ready: parts, rest: '' }

  const rest = parts.at(-1) ?? ''
  const ready = parts.slice(0, -1)
  if (endsSentence(rest))
    return { ready: [...ready, rest], rest: '' }
  return { ready, rest }
}

export interface SentenceSpeechOptions {
  /**
   * Speaks one sentence.
   * The next sentence starts before this promise resolves, so synthesis of
   * the next sentence overlaps playback of the current sentence.
   * `signal` aborts when the call cancels unplayed speech.
   */
  speak: (sentence: string, signal: AbortSignal) => Promise<void>
}

/**
 * Splits a reply into sentences and starts each one without waiting for playback.
 *
 * `cancel` drops text that was not sent yet. A sentence already given to
 * `speak` stops through `signal`.
 */
export function createSentenceSpeech(options: SentenceSpeechOptions) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' })
  const abort = new AbortController()
  let buffer = ''
  let stopped = false

  function emit(sentence: string) {
    const text = sentence.trim()
    if (!hasSound.test(text) || abort.signal.aborted)
      return
    const signal = abort.signal
    // Start synthesis now. Do not wait for playback. The next sentence overlaps it.
    void options.speak(text, signal).catch(() => {})
  }

  function drain(final: boolean) {
    const split = takeSentences(segmenter, buffer, final)
    buffer = split.rest
    for (const sentence of split.ready)
      emit(sentence)
  }

  return {
    /** Appends model text. A finished sentence starts speech at once. */
    write(text: string) {
      if (stopped)
        return
      buffer += text
      drain(false)
    },
    /** Sends the unfinished tail, then accepts more text. A special token uses this. */
    flush() {
      if (stopped)
        return
      drain(true)
    },
    /** Sends the unfinished tail and accepts no more text. */
    end() {
      if (stopped)
        return
      drain(true)
      stopped = true
    },
    /** Drops text that has not started. Speech that already started gets the abort signal. */
    cancel() {
      stopped = true
      buffer = ''
      abort.abort()
    },
  }
}

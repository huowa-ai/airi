import { describe, expect, it } from 'vitest'

import { createSentenceSpeech, takeSentences } from './sentences'

describe('call sentence speech', () => {
  it('keeps a decimal inside the sentence and holds the unfinished tail', () => {
    const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' })

    expect(takeSentences(segmenter, 'Pi is 3.14. Next', false).ready.map(part => part.trim())).toEqual(['Pi is 3.14.'])
    expect(takeSentences(segmenter, 'Pi is 3.14. Next', false).rest.trim()).toBe('Next')
  })

  it('starts the next sentence while the first sentence is still speaking', async () => {
    const started: string[] = []
    let release: () => void = () => {}
    const first = new Promise<void>((resolve) => {
      release = resolve
    })
    const speech = createSentenceSpeech({
      speak: async (sentence) => {
        started.push(sentence)
        if (started.length === 1)
          await first
      },
    })

    speech.write('Hello there. How are you?')
    speech.flush()
    await Promise.resolve()

    expect(started).toEqual(['Hello there.', 'How are you?'])
    release()
  })

  it('drops a sentence that was not sent when speech is cancelled', async () => {
    const started: string[] = []
    const speech = createSentenceSpeech({
      speak: async (sentence) => {
        started.push(sentence)
      },
    })

    speech.write('Hello there. ')
    await Promise.resolve()
    speech.cancel()
    speech.write('How are you? ')
    speech.end()
    await Promise.resolve()

    expect(started).toEqual(['Hello there.'])
  })

  it('splits Chinese sentences', () => {
    const segmenter = new Intl.Segmenter('zh', { granularity: 'sentence' })
    const split = takeSentences(segmenter, '你好。我是艾丽。', true)

    expect(split.ready.map(part => part.trim())).toEqual(['你好。', '我是艾丽。'])
    expect(split.rest).toBe('')
  })
})

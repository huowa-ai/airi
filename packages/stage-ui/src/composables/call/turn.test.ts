import { describe, expect, it } from 'vitest'

import { CALL_FILLER_EN, CALL_FILLER_ZH, callFillerLine, callTurnAssistantText, joinPlayedText, noteCallUtterance, partialRecallQuery, peekCallUtterance, recallOrFiller, takeCallUtterance } from './turn'

describe('call turn recall and played text', () => {
  it('prefetches a partial name and skips a short fragment', () => {
    expect(partialRecallQuery('Ada')).toBe(undefined)
    expect(partialRecallQuery('  Ada likes')).toBe('Ada likes')
  })

  it('uses the Chinese filler for a Chinese locale', () => {
    expect(callFillerLine('en-US')).toBe(CALL_FILLER_EN)
    expect(callFillerLine('zh-CN')).toBe(CALL_FILLER_ZH)
  })

  it('speaks the filler when recall is still pending, then waits for recall', async () => {
    let release: () => void = () => {}
    const recall = new Promise<void>((resolve) => {
      release = resolve
    })
    let filler = 0
    let recallDone = false
    void recall.then(() => {
      recallDone = true
    })
    const pending = recallOrFiller({
      recall,
      delayMs: 20,
      wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
      onSlow: () => {
        filler += 1
      },
    })

    await new Promise(resolve => setTimeout(resolve, 40))
    expect(filler).toBe(1)
    expect(recallDone).toBe(false)
    release()
    await pending
    expect(recallDone).toBe(true)
  })

  it('does not speak the filler when recall is already ready', async () => {
    let filler = 0
    await recallOrFiller({
      recall: Promise.resolve(),
      delayMs: 30,
      wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
      onSlow: () => {
        filler += 1
      },
    })
    await new Promise(resolve => setTimeout(resolve, 40))

    expect(filler).toBe(0)
  })

  it('keeps only played text after an interrupt, including a played filler', () => {
    expect(callTurnAssistantText({
      interrupted: true,
      outputText: 'Let me think. The tea is here. The rest was not spoken.',
      playedText: joinPlayedText(['Let me think.', 'The tea is here.']),
    })).toBe('Let me think. The tea is here.')
    expect(callTurnAssistantText({
      interrupted: true,
      outputText: 'Nothing was heard.',
      playedText: '',
    })).toBe('')
  })

  it('adds a played filler in front of a finished reply', () => {
    expect(callTurnAssistantText({
      interrupted: false,
      outputText: 'Ada likes tea.',
      playedText: CALL_FILLER_EN,
      fillerHeard: CALL_FILLER_EN,
    })).toBe(`${CALL_FILLER_EN}\nAda likes tea.`)
    expect(callTurnAssistantText({
      interrupted: false,
      outputText: 'Ada likes tea.',
      playedText: '',
    })).toBeUndefined()
  })

  it('marks one spoken turn and leaves a different turn id', () => {
    noteCallUtterance('session-1', 'turn-1')

    expect(peekCallUtterance('session-1', 'turn-1')).toBe(true)
    expect(takeCallUtterance('session-1', 'turn-2')).toBe(false)
    expect(takeCallUtterance('session-1', 'turn-1')).toBe(true)
    expect(peekCallUtterance('session-1', 'turn-1')).toBe(false)
  })
})

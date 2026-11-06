import { describe, expect, it } from 'vitest'

import { createDanceCutout } from './playback'

describe('dance cutout playback', () => {
  it('hides the model before the cutout and restores the model after it', async () => {
    const dance = createDanceCutout()

    const starting = dance.start()
    expect(dance.phase.value).toBe('covering')
    expect(dance.hidesModel.value).toBe(true)
    expect(dance.showsCutout.value).toBe(false)

    await starting
    expect(dance.phase.value).toBe('playing')
    expect(dance.showsCutout.value).toBe(true)

    const stopping = dance.stop()
    expect(dance.phase.value).toBe('restoring')
    expect(dance.showsCutout.value).toBe(false)
    expect(dance.hidesModel.value).toBe(true)

    await stopping
    expect(dance.phase.value).toBe('idle')
    expect(dance.hidesModel.value).toBe(false)
  })

  it('cancels a start before the cutout appears', async () => {
    const dance = createDanceCutout()
    const starting = dance.start()
    const stopping = dance.stop()

    await starting
    await stopping

    expect(dance.phase.value).toBe('idle')
    expect(dance.showsCutout.value).toBe(false)
    expect(dance.hidesModel.value).toBe(false)
  })

  it('ignores a second start while the clip is playing', async () => {
    const dance = createDanceCutout()
    await dance.start()

    await expect(dance.start()).resolves.toBe(false)
    expect(dance.phase.value).toBe('playing')
  })

  it('drops a wait that reset cancelled', async () => {
    const dance = createDanceCutout()
    const starting = dance.start()
    dance.reset()
    await starting

    expect(dance.phase.value).toBe('idle')
    expect(dance.showsCutout.value).toBe(false)
  })
})

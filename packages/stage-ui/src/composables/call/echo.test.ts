import { describe, expect, it } from 'vitest'

import { forceEchoCancellation } from './echo'

function track(initial: boolean, fail = false) {
  let enabled = initial
  return {
    applyConstraints: async (constraints: MediaTrackConstraints) => {
      if (fail)
        throw new DOMException('unsupported', 'OverconstrainedError')
      if (constraints.echoCancellation === true)
        enabled = true
    },
    getSettings: () => ({ echoCancellation: enabled }),
  }
}

function stream(tracks: ReturnType<typeof track>[]) {
  return { getAudioTracks: () => tracks }
}

describe('forced echo cancellation', () => {
  it('applies echo cancellation when the track opened without it', async () => {
    const audio = track(false)

    expect(await forceEchoCancellation(stream([audio]))).toBe(true)
    expect(audio.getSettings().echoCancellation).toBe(true)
  })

  it('keeps a track that already has echo cancellation', async () => {
    const audio = track(true)
    let applied = 0
    audio.applyConstraints = async () => {
      applied += 1
    }

    expect(await forceEchoCancellation(stream([audio]))).toBe(true)
    expect(applied).toBe(0)
  })

  it('returns false when the browser rejects the constraint', async () => {
    expect(await forceEchoCancellation(stream([track(false, true)]))).toBe(false)
  })

  it('returns false when the stream has no audio track', async () => {
    expect(await forceEchoCancellation(stream([]))).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'

import { resetCutoutSourceCache, resolveCutoutSource } from './alpha'

describe('resolveCutoutSource', () => {
  it('uses the video when the alpha probe passes', async () => {
    resetCutoutSourceCache()
    let calls = 0

    await expect(resolveCutoutSource(async () => {
      calls += 1
      return true
    })).resolves.toBe('video')
    await expect(resolveCutoutSource(async () => {
      calls += 1
      return false
    })).resolves.toBe('video')
    expect(calls).toBe(1)
  })

  it('uses the WebP fallback when the probe fails or throws', async () => {
    resetCutoutSourceCache()
    await expect(resolveCutoutSource(async () => false)).resolves.toBe('webp')

    resetCutoutSourceCache()
    await expect(resolveCutoutSource(async () => {
      throw new Error('decode failed')
    })).resolves.toBe('webp')
  })
})

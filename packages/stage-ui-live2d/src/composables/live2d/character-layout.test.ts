import { describe, expect, it } from 'vitest'

import { live2dCharacterBoxFromFit } from './character-layout'

describe('live2d character box', () => {
  it('uses the same center and size as the fitted model', () => {
    const box = live2dCharacterBoxFromFit({
      fitScale: 0.5,
      fitX: 400,
      fitY: 600,
      modelWidth: 1000,
      modelHeight: 2000,
      viewScale: 0.8,
      offsetX: 10,
      offsetY: -20,
    })

    expect(box).toEqual({
      centerX: 410,
      centerY: 580,
      width: 400,
      height: 800,
    })
  })

  it('returns nothing until the model has a size', () => {
    expect(live2dCharacterBoxFromFit({
      fitScale: 1,
      fitX: 0,
      fitY: 0,
      modelWidth: 0,
      modelHeight: 100,
      viewScale: 1,
      offsetX: 0,
      offsetY: 0,
    })).toBeUndefined()
  })
})

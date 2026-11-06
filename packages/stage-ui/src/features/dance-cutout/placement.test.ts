import { describe, expect, it } from 'vitest'

import { placeCutoutFrame } from './placement'

const model = { centerX: 50, centerY: 100, width: 100, height: 200 }
const body = { width: 100, height: 200, head: 0.1, foot: 0.9 }

describe('placeCutoutFrame', () => {
  it('puts the feet on the bottom of the model and the head on the top', () => {
    const frame = placeCutoutFrame(model, body)

    const footY = frame.top + body.foot * frame.height
    const headY = frame.top + body.head * frame.height
    const modelTop = model.centerY - model.height / 2
    const modelBottom = model.centerY + model.height / 2

    expect(footY).toBeCloseTo(modelBottom)
    expect(headY).toBeCloseTo(modelTop)
    expect(frame.left + frame.width / 2).toBeCloseTo(model.centerX)
  })

  it('keeps the frame aspect ratio', () => {
    const frame = placeCutoutFrame(model, { ...body, width: 736, height: 1280 })

    expect(frame.width / frame.height).toBeCloseTo(736 / 1280)
  })

  it('grows the body from the feet when the height scale changes', () => {
    const frame = placeCutoutFrame(model, body, 1.25)
    const footY = frame.top + body.foot * frame.height
    const bodyHeight = (body.foot - body.head) * frame.height

    expect(footY).toBeCloseTo(model.centerY + model.height / 2)
    expect(bodyHeight).toBeCloseTo(model.height * 1.25)
  })

  it('rejects a body whose feet are not below the head', () => {
    expect(() => placeCutoutFrame(model, { ...body, head: 0.9, foot: 0.1 })).toThrow(/foot/)
  })
})

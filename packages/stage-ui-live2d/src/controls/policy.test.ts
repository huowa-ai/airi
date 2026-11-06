import { describe, expect, it } from 'vitest'

import {
  createLive2DControlPolicy,
  isLive2DControlEnabled,
  updateLive2DControlPolicy,
} from './policy'

describe('live2D control policy', () => {
  it('enables every control in an empty policy', () => {
    const policy = createLive2DControlPolicy()

    expect(isLive2DControlEnabled(policy, { kind: 'expression', id: 'happy' })).toBe(true)
    expect(isLive2DControlEnabled(policy, { kind: 'motion', id: 'wave.motion3.json' })).toBe(true)
  })

  it('returns a new policy when one control changes', () => {
    const policy = createLive2DControlPolicy()
    const disabled = updateLive2DControlPolicy(policy, { kind: 'expression', id: 'happy' }, false)

    expect(disabled).toEqual({
      disabledExpressions: ['happy'],
      disabledMotions: [],
    })
    expect(policy).toEqual({
      disabledExpressions: [],
      disabledMotions: [],
    })

    expect(updateLive2DControlPolicy(disabled, { kind: 'expression', id: 'happy' }, true)).toEqual(policy)
  })

  it('keeps the parameter mapping when one expression changes', () => {
    const policy = {
      ...createLive2DControlPolicy(),
      parameterMapping: { headAngleX: [{ paramId: 'AngleX' }, { paramId: 'ParamAngleX', scale: 1 }] },
      skipMouthOpen: false,
    }
    const next = updateLive2DControlPolicy(policy, { kind: 'motion', id: 'idle.motion3.json' }, false)

    expect(next.disabledMotions).toEqual(['idle.motion3.json'])
    expect(next.parameterMapping).toEqual(policy.parameterMapping)
    expect(next.skipMouthOpen).toBe(false)
    expect(policy.disabledMotions).toEqual([])
    expect(next.parameterMapping).not.toBe(policy.parameterMapping)
  })
})

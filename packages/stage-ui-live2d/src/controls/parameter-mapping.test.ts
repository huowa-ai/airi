import { describe, expect, it, vi } from 'vitest'

import {
  addLive2DParameter,
  defaultLive2DParameterRig,
  forEachLoadedLive2DMotion,
  installLive2DFocusMapping,
  readLive2DCoreParameterIds,
  readLive2DParameter,
  readLive2DPhysicsInputIds,
  resolveLive2DParameterRig,
  resolveLive2DSkipMouthOpen,
  sweepLive2DParameterChannel,
  writeLive2DParameter,
} from './parameter-mapping'

function createModel(initial: Record<string, number> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getParameterValueById: vi.fn((id: string) => values.get(id) ?? 0),
    setParameterValueById: vi.fn((id: string, value: number) => {
      values.set(id, value)
    }),
    addParameterValueById: vi.fn((id: string, value: number) => {
      values.set(id, (values.get(id) ?? 0) + value)
    }),
  }
}

const dafeiyuPhysics = {
  Version: 3,
  PhysicsSettings: [
    {
      Id: 'PhysicsSetting1',
      Input: [{ Source: { Target: 'Parameter', Id: 'AngleX' }, Weight: 100, Type: 'X', Reflect: false }],
      Output: [{ Destination: { Target: 'Parameter', Id: 'ParamHairFront' }, Type: 'Angle' }],
    },
    {
      Input: [{ Source: { Target: 'Parameter', Id: 'AngleY' } }],
    },
    {
      Input: [{ Source: { Target: 'Parameter', Id: 'AngleZ' } }],
    },
  ],
}

describe('live2d parameter writer', () => {
  it('writes the standard id when the model has no mapping', () => {
    const model = createModel()

    writeLive2DParameter(model, defaultLive2DParameterRig, 'headAngleX', 12)
    writeLive2DParameter(model, defaultLive2DParameterRig, 'mouthOpen', 0.4)

    expect(model.values.get('ParamAngleX')).toBe(12)
    expect(model.values.get('ParamMouthOpenY')).toBe(0.4)
    expect(model.values.has('AngleX')).toBe(false)
  })

  it('fans one logical value out with scale and offset', () => {
    const model = createModel()
    const rig = resolveLive2DParameterRig({
      headAngleX: [
        { paramId: 'ParamAngleX', scale: 2 },
        { paramId: 'AngleX', offset: 1 },
      ],
    })

    writeLive2DParameter(model, rig, 'headAngleX', 10)

    expect(model.values.get('ParamAngleX')).toBe(20)
    expect(model.values.get('AngleX')).toBe(11)
  })

  it('adds a scaled delta and does not apply offset', () => {
    const model = createModel({ ParamAngleX: 4, AngleX: 4 })
    const rig = resolveLive2DParameterRig({
      headAngleX: [
        { paramId: 'ParamAngleX', scale: 2, offset: 9 },
        { paramId: 'AngleX', scale: 0.5 },
      ],
    })

    addLive2DParameter(model, rig, 'headAngleX', 3)

    expect(model.values.get('ParamAngleX')).toBe(10)
    expect(model.values.get('AngleX')).toBe(5.5)
    expect(readLive2DParameter(model, rig, 'headAngleX')).toBe(0.5)
  })

  it('does not write a channel the card cleared', () => {
    const model = createModel({ ParamAngleX: 3 })
    const rig = resolveLive2DParameterRig({ headAngleX: [] })

    writeLive2DParameter(model, rig, 'headAngleX', 20)

    expect(model.values.get('ParamAngleX')).toBe(3)
    expect(rig.channels.headAngleX.layer).toBe('card')
  })
})

describe('live2d parameter rig layers', () => {
  it('lets the card mapping replace physics and name detection', () => {
    const rig = resolveLive2DParameterRig(
      { headAngleX: [{ paramId: 'AngleX' }] },
      {
        parameterIds: ['ParamAngleX', 'AngleX', 'ParamAngleY', 'AngleY'],
        physicsInputIds: ['AngleX', 'AngleY'],
      },
    )

    expect(rig.channels.headAngleX).toEqual({
      channel: 'headAngleX',
      bindings: [{ paramId: 'AngleX' }],
      layer: 'card',
    })
    expect(rig.channels.headAngleY.layer).toBe('structural')
    expect(rig.channels.headAngleY.bindings.map(binding => binding.paramId)).toEqual(['ParamAngleY', 'AngleY'])
  })

  it('maps a physics input and the standard id when both exist', () => {
    const physicsInputIds = readLive2DPhysicsInputIds(dafeiyuPhysics)
    const rig = resolveLive2DParameterRig(undefined, {
      parameterIds: ['ParamAngleX', 'AngleX', 'ParamAngleY', 'AngleY', 'ParamAngleZ', 'AngleZ', 'ParamBodyAngleX'],
      physicsInputIds,
    })

    expect(physicsInputIds).toEqual(['AngleX', 'AngleY', 'AngleZ'])
    expect(rig.channels.headAngleX.layer).toBe('structural')
    expect(rig.channels.headAngleX.bindings).toEqual([
      { paramId: 'ParamAngleX' },
      { paramId: 'AngleX' },
    ])
    expect(rig.channels.headAngleY.bindings.map(binding => binding.paramId)).toEqual(['ParamAngleY', 'AngleY'])
    expect(rig.channels.headAngleZ.bindings.map(binding => binding.paramId)).toEqual(['ParamAngleZ', 'AngleZ'])
    expect(rig.channels.bodyAngleX.layer).toBe('default')
    expect(rig.channels.bodyAngleX.bindings).toEqual([{ paramId: 'ParamBodyAngleX' }])
    expect(rig.channels.headAngleX.bindings.some(binding => binding.paramId === 'ParamHairFront')).toBe(false)
  })

  it('keeps the default layer when physics names only the standard id', () => {
    const rig = resolveLive2DParameterRig(undefined, {
      parameterIds: ['ParamAngleX', 'AngleX'],
      physicsInputIds: ['ParamAngleX'],
    })

    expect(rig.channels.headAngleX.layer).toBe('default')
    expect(rig.channels.headAngleX.bindings).toEqual([{ paramId: 'ParamAngleX' }])
  })

  it('uses a known alias only after physics and only when the standard id is missing', () => {
    const named = resolveLive2DParameterRig(undefined, {
      parameterIds: ['AngleX', 'ParamAngleY'],
      physicsInputIds: [],
    })
    const bothNames = resolveLive2DParameterRig(undefined, {
      parameterIds: ['ParamAngleX', 'AngleX'],
      physicsInputIds: [],
    })

    expect(named.channels.headAngleX).toEqual({
      channel: 'headAngleX',
      bindings: [{ paramId: 'AngleX' }],
      layer: 'name',
    })
    expect(bothNames.channels.headAngleX.layer).toBe('default')
    expect(bothNames.channels.headAngleX.bindings).toEqual([{ paramId: 'ParamAngleX' }])
  })

  it('does not let the name layer replace a physics match', () => {
    const rig = resolveLive2DParameterRig(undefined, {
      parameterIds: ['AngleX', 'PARAM_ANGLE_X'],
      physicsInputIds: ['PARAM_ANGLE_X'],
    })

    expect(rig.channels.headAngleX.layer).toBe('structural')
    expect(rig.channels.headAngleX.bindings).toEqual([{ paramId: 'PARAM_ANGLE_X' }])
  })

  it('reads parameter ids from string and Cubism id handles', () => {
    const ids = readLive2DCoreParameterIds({
      getParameterCount: () => 3,
      getParameterId: (index: number) => ['ParamAngleX', { getString: () => 'AngleX' }, { s: 'ParamBodyAngleX' }][index],
    })

    expect(ids).toEqual(['ParamAngleX', 'AngleX', 'ParamBodyAngleX'])
    expect(readLive2DCoreParameterIds({ _parameterIds: ['ParamAngleX', 'AngleX'] })).toEqual(['ParamAngleX', 'AngleX'])
    expect(readLive2DCoreParameterIds({})).toEqual([])
  })

  it('fans body follow out to hip and shoulder parameters from physics groups and display names', () => {
    const rig = resolveLive2DParameterRig(undefined, {
      parameterIds: [
        'ParamAngleX',
        'AngleX',
        'ParamBodyAngleX',
        'ParamBodyAngleY',
        'ParamBodyAngleZ',
        'HipAngleX',
        'HipAngleY',
        'ParamBodyAngleRX',
        'PoseAngleX',
        'ShoulderX',
        'ShoulderZ',
        'HipAngleZ',
        'ParamHairFront',
        'ParamEyeLOpen',
        'ParamBustX',
      ],
      physicsInputIds: ['AngleX', 'ParamAngleX', 'ParamBodyAngleX', 'HipAngleX', 'ParamBodyAngleRX', 'PoseAngleX', 'ParamBodyAngleY', 'HipAngleY', 'ParamEyeLOpen'],
      physicsGroups: [
        ['AngleX', 'ParamAngleX', 'ParamEyeLOpen'],
        ['ParamBodyAngleX', 'HipAngleX', 'ParamBodyAngleRX', 'PoseAngleX'],
        ['ParamBodyAngleY', 'HipAngleY'],
      ],
      parameterRanges: {
        ParamBodyAngleX: { min: -30, max: 30 },
        HipAngleX: { min: -30, max: 30 },
        ShoulderX: { min: -10, max: 10 },
      },
      parameterDescriptors: [
        { id: 'ShoulderX', name: '肩 X', group: '身体' },
        { id: 'HipAngleZ', name: '胯 Z', group: '身体' },
        { id: 'ParamHairFront', name: '头发', group: '头' },
        { id: 'ParamBustX', name: '胸部', group: '身体' },
      ],
    })

    expect(rig.channels.bodyAngleX.layer).toBe('structural')
    expect(rig.channels.bodyAngleX.bindings).toEqual([
      { paramId: 'ParamBodyAngleX' },
      { paramId: 'HipAngleX' },
      { paramId: 'ParamBodyAngleRX' },
      { paramId: 'ShoulderX', scale: 0.333 },
      { paramId: 'PoseAngleX' },
    ])
    expect(rig.channels.bodyAngleY.bindings.map(binding => binding.paramId)).toEqual(['ParamBodyAngleY', 'HipAngleY'])
    expect(rig.channels.bodyAngleZ.bindings.map(binding => binding.paramId)).toEqual(['ParamBodyAngleZ', 'ShoulderZ', 'HipAngleZ'])
    expect(rig.channels.headAngleX.bindings.map(binding => binding.paramId)).toEqual(['ParamAngleX', 'AngleX'])
    expect(rig.channels.headAngleX.bindings.some(binding => binding.paramId === 'ParamEyeLOpen')).toBe(false)
    expect(rig.channels.headAngleX.bindings.some(binding => binding.paramId === 'ParamHairFront')).toBe(false)
    expect(rig.channels.bodyAngleX.bindings.some(binding => binding.paramId === 'ParamBustX')).toBe(false)
  })

  it('keeps a bundled model on the standard ids', () => {
    const rig = resolveLive2DParameterRig(undefined, {
      parameterIds: [
        'ParamAngleX',
        'ParamAngleY',
        'ParamAngleZ',
        'ParamBodyAngleX',
        'ParamBodyAngleY',
        'ParamBodyAngleZ',
        'ParamEyeBallX',
        'ParamEyeBallY',
        'ParamMouthOpenY',
        'ParamMouthForm',
        'ParamBreath',
        'ParamHairFront',
        'ParamBustX',
      ],
      physicsInputIds: ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamBodyAngleX', 'ParamEyeBallX', 'ParamEyeBallY'],
      physicsGroups: [
        ['ParamAngleX'],
        ['ParamAngleY'],
        ['ParamAngleZ'],
        ['ParamBodyAngleX'],
        ['ParamEyeBallX', 'ParamEyeBallY'],
      ],
      parameterDescriptors: [
        { id: 'ParamAngleX', name: '角度 X', group: '头' },
        { id: 'ParamBodyAngleX', name: '身体 X', group: '身体' },
        { id: 'ParamHairFront', name: '头发', group: '头' },
        { id: 'ParamBustX', name: '胸部', group: '身体' },
        { id: 'ParamBreath', name: '呼吸', group: '身体' },
      ],
    })

    expect(rig.channels.headAngleX.layer).toBe('default')
    expect(rig.channels.headAngleX.bindings).toEqual([{ paramId: 'ParamAngleX' }])
    expect(rig.channels.bodyAngleX.layer).toBe('default')
    expect(rig.channels.bodyAngleX.bindings).toEqual([{ paramId: 'ParamBodyAngleX' }])
    expect(rig.channels.bodyAngleX.bindings.some(binding => binding.paramId === 'PositionX')).toBe(false)
    expect(rig.channels.eyeBallX.layer).toBe('default')
    expect(rig.channels.breath.layer).toBe('default')
    expect(rig.channels.breath.bindings).toEqual([{ paramId: 'ParamBreath' }])
  })

  it('maps physics root pose inputs onto the body channels', () => {
    const rig = resolveLive2DParameterRig(undefined, {
      parameterIds: ['ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ', 'PositionX', 'PositionY', 'PositionZ', 'LeanInput', 'HipAngleX'],
      physicsInputIds: ['PositionX', 'LeanInput', 'PositionY', 'PositionZ', 'ParamBodyAngleX', 'HipAngleX'],
    })

    expect(rig.channels.bodyAngleX.bindings.map(binding => binding.paramId)).toEqual([
      'ParamBodyAngleX',
      'PositionX',
      'LeanInput',
      'HipAngleX',
    ])
    expect(rig.channels.bodyAngleY.bindings.map(binding => binding.paramId)).toEqual(['ParamBodyAngleY', 'PositionY'])
    expect(rig.channels.bodyAngleZ.bindings.map(binding => binding.paramId)).toEqual(['ParamBodyAngleZ', 'PositionZ'])
  })

  it('lets a card body mapping replace the structural fan-out', () => {
    const rig = resolveLive2DParameterRig(
      { bodyAngleX: [{ paramId: 'HipAngleX' }] },
      {
        parameterIds: ['ParamBodyAngleX', 'HipAngleX'],
        physicsInputIds: ['ParamBodyAngleX', 'HipAngleX'],
        physicsGroups: [['ParamBodyAngleX', 'HipAngleX']],
      },
    )

    expect(rig.channels.bodyAngleX).toEqual({
      channel: 'bodyAngleX',
      bindings: [{ paramId: 'HipAngleX' }],
      layer: 'card',
    })
  })
})

describe('live2d focus mapping', () => {
  it('adds the focus delta to every bound head, eye, and body parameter', () => {
    const model = createModel()
    const focus = { x: 1, y: 0.5 }
    const target = {
      focusController: focus,
      coreModel: model,
      updateFocus: () => undefined,
    }
    installLive2DFocusMapping(target, () => resolveLive2DParameterRig({
      headAngleX: [{ paramId: 'ParamAngleX' }, { paramId: 'AngleX' }],
      headAngleZ: [{ paramId: 'AngleZ' }],
    }))

    target.updateFocus()

    expect(model.values.get('ParamEyeBallX')).toBe(1)
    expect(model.values.get('ParamEyeBallY')).toBe(0.5)
    expect(model.values.get('ParamAngleX')).toBe(30)
    expect(model.values.get('AngleX')).toBe(30)
    expect(model.values.get('ParamAngleY')).toBe(15)
    expect(model.values.get('AngleZ')).toBe(-15)
    expect(model.values.get('ParamBodyAngleX')).toBe(10)
    expect(model.values.has('ParamAngleZ')).toBe(false)
  })

  it('writes the probe after the focus add', () => {
    const model = createModel()
    const target = {
      focusController: { x: 1, y: 0 },
      coreModel: model,
      updateFocus: () => undefined,
    }
    installLive2DFocusMapping(
      target,
      () => defaultLive2DParameterRig,
      () => ({ channel: 'headAngleX', value: 8 }),
    )

    target.updateFocus()

    expect(model.values.get('ParamAngleX')).toBe(8)
  })

  it('sets physics root inputs absolutely and leaves a model without them unchanged', () => {
    const model = createModel()
    const ids = ['PositionX', 'LeanInput', 'PositionY', 'PositionZ', 'ParamBodyAngleX']
    const withRoots = { ...model, _parameterIds: ids }
    const focus = { x: 1, y: 0.5 }
    const target = {
      focusController: focus,
      coreModel: withRoots,
      updateFocus: () => undefined,
    }
    installLive2DFocusMapping(target, () => defaultLive2DParameterRig)

    target.updateFocus()
    target.updateFocus()

    expect(withRoots.values.get('PositionX')).toBe(30)
    expect(withRoots.values.get('LeanInput')).toBe(30)
    expect(withRoots.values.get('PositionY')).toBe(15)
    expect(withRoots.values.get('PositionZ')).toBe(10)
    expect(withRoots.values.get('ParamBodyAngleX')).toBe(20)

    const plain = createModel()
    const hiyori = {
      focusController: { x: 1, y: 0 },
      coreModel: { ...plain, _parameterIds: ['ParamAngleX', 'ParamBodyAngleX'] },
      updateFocus: () => undefined,
    }
    installLive2DFocusMapping(hiyori, () => defaultLive2DParameterRig)
    hiyori.updateFocus()

    expect(hiyori.coreModel.values.has('PositionX')).toBe(false)
    expect(hiyori.coreModel.values.has('LeanInput')).toBe(false)
    expect(hiyori.coreModel.values.get('ParamBodyAngleX')).toBe(10)
  })
})

describe('live2d skip mouth open', () => {
  it('uses the card value, then a mapped mouth, then the global setting', () => {
    expect(resolveLive2DSkipMouthOpen({ globalSkip: true, cardSkip: false, mouthOpenMapped: false })).toBe(false)
    expect(resolveLive2DSkipMouthOpen({ globalSkip: false, cardSkip: true, mouthOpenMapped: true })).toBe(true)
    expect(resolveLive2DSkipMouthOpen({ globalSkip: true, mouthOpenMapped: true })).toBe(false)
    expect(resolveLive2DSkipMouthOpen({ globalSkip: true, mouthOpenMapped: false })).toBe(true)
    expect(resolveLive2DSkipMouthOpen({ globalSkip: false, mouthOpenMapped: false })).toBe(false)
  })
})

describe('live2d unloaded motions', () => {
  it('skips a null motion and a motion without curves', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const visited: string[] = []

    forEachLoadedLive2DMotion([
      null,
      { _motionData: { curves: [{ id: 'ParamEyeBallX' }] } },
      { _motionData: undefined },
      undefined,
    ], (motion) => {
      visited.push(motion._motionData.curves[0]?.id ?? '')
    })

    expect(visited).toEqual(['ParamEyeBallX'])
    expect(warn).toHaveBeenCalledTimes(3)
    warn.mockRestore()
  })
})

describe('live2d parameter sweep', () => {
  it('moves the probe to both ends and then clears it', async () => {
    const probes: Array<{ value: number } | undefined> = []

    await sweepLive2DParameterChannel('headAngleX', (probe) => {
      probes.push(probe ? { value: probe.value } : undefined)
    }, {
      durationMs: 120,
      wait: async () => undefined,
    })

    const values = probes.flatMap(probe => probe ? [probe.value] : [])
    expect(values[0]).toBe(-30)
    expect(values).toContain(30)
    expect(probes.at(-1)).toBeUndefined()
  })
})

import type { Live2DProbeDrawable, Live2DProbeParameter, Live2DProbeTarget } from './parameter-probe'

import { describe, expect, it } from 'vitest'

import { resolveLive2DParameterRig } from './parameter-mapping'
import {
  live2dProbeCacheFromMotions,
  live2dProbeCacheMatches,
  live2dProbeNudge,
  measureLive2DParameterMotions,
} from './parameter-probe'

function box(x: number, y: number, width = 20, height = 20): Live2DProbeDrawable {
  return { x, y, width, height }
}

function targetFor(options: {
  parameters: Live2DProbeParameter[]
  resting: Live2DProbeDrawable[]
  movedFor: (id: string) => Live2DProbeDrawable[] | undefined
}): Live2DProbeTarget & { values: Map<string, number> } {
  const values = new Map(options.parameters.map(parameter => [parameter.id, parameter.value]))
  let drawables = options.resting
  return {
    values,
    parameters: options.parameters,
    drawables: () => drawables,
    setParameter: (id, value) => {
      values.set(id, value)
      const original = options.parameters.find(parameter => parameter.id === id)?.value
      drawables = value === original ? options.resting : (options.movedFor(id) ?? options.resting)
    },
    update: () => undefined,
  }
}

describe('live2d parameter probe', () => {
  it('scales the nudge to each parameter range', () => {
    expect(live2dProbeNudge({ id: 'HipAngleX', value: 0, min: -30, max: 30 })).toBeCloseTo(21)
    expect(live2dProbeNudge({ id: 'Small', value: 0, min: 0, max: 1 })).toBeCloseTo(0.35)
  })

  it('classifies a torso mover, prunes a still parameter, and lists an unused mover', async () => {
    const resting = [box(0, 0, 100, 40), box(0, 70, 100, 50), box(0, 140, 100, 20)]
    const target = targetFor({
      parameters: [
        { id: 'ParamBodyAngleX', value: 0, min: -30, max: 30 },
        { id: 'HipAngleX', value: 0, min: -30, max: 30 },
        { id: 'StillAngleX', value: 0, min: -10, max: 10 },
        { id: 'ExtraX', value: 0, min: -10, max: 10 },
      ],
      resting,
      movedFor: (id) => {
        if (id === 'HipAngleX' || id === 'ParamBodyAngleX')
          return [box(0, 0, 100, 40), box(30, 70, 100, 50), box(0, 140, 100, 20)]
        if (id === 'ExtraX')
          return [box(0, 0, 100, 40), box(0, 70, 100, 50), box(0, 220, 100, 20)]
        return undefined
      },
    })

    const motions = await measureLive2DParameterMotions(target)
    expect(target.values.get('HipAngleX')).toBe(0)
    expect(motions.find(motion => motion.paramId === 'HipAngleX')).toMatchObject({ moved: true, region: 'torso', axis: 'x' })
    expect(motions.find(motion => motion.paramId === 'StillAngleX')?.moved).toBe(false)
    expect(motions.find(motion => motion.paramId === 'ExtraX')).toMatchObject({ moved: true, region: 'other' })

    const catalog = {
      parameterIds: ['ParamBodyAngleX', 'HipAngleX', 'StillAngleX', 'ExtraX'],
      physicsInputIds: ['ParamBodyAngleX', 'HipAngleX', 'StillAngleX'],
      physicsGroups: [['ParamBodyAngleX', 'HipAngleX', 'StillAngleX']],
    }
    const cache = live2dProbeCacheFromMotions(catalog, motions, 'hash-1')

    expect(cache.mapping.bodyAngleX?.map(binding => binding.paramId)).toEqual(['ParamBodyAngleX', 'HipAngleX'])
    expect(cache.unused.map(parameter => parameter.paramId)).toEqual(['ExtraX'])
    expect(live2dProbeCacheMatches('hash-1', cache)).toBe(true)
    expect(live2dProbeCacheMatches('hash-2', cache)).toBe(false)

    const rig = resolveLive2DParameterRig(undefined, {
      ...catalog,
      modelHash: 'hash-1',
      parameterProbe: cache,
    })
    expect(rig.channels.bodyAngleX.layer).toBe('probe')
    expect(rig.channels.bodyAngleX.bindings.map(binding => binding.paramId)).toEqual(['ParamBodyAngleX', 'HipAngleX'])

    const stale = resolveLive2DParameterRig(undefined, {
      ...catalog,
      modelHash: 'hash-2',
      parameterProbe: cache,
    })
    expect(stale.channels.bodyAngleX.layer).toBe('structural')
    expect(stale.channels.bodyAngleX.bindings.some(binding => binding.paramId === 'StillAngleX')).toBe(true)
  })

  it('keeps a standard model unchanged when every standard parameter moves', async () => {
    const resting = [box(40, 20, 80, 40), box(30, 90, 100, 70)]
    const target = targetFor({
      parameters: [
        { id: 'ParamAngleX', value: 0, min: -30, max: 30 },
        { id: 'ParamBodyAngleX', value: 0, min: -30, max: 30 },
      ],
      resting,
      movedFor: (id) => {
        if (id === 'ParamAngleX')
          return [box(70, 20, 80, 40), box(30, 90, 100, 70)]
        return [box(40, 20, 80, 40), box(60, 90, 100, 70)]
      },
    })
    const motions = await measureLive2DParameterMotions(target)
    const catalog = {
      parameterIds: ['ParamAngleX', 'ParamBodyAngleX'],
      physicsInputIds: ['ParamAngleX', 'ParamBodyAngleX'],
      physicsGroups: [['ParamAngleX'], ['ParamBodyAngleX']],
    }
    const cache = live2dProbeCacheFromMotions(catalog, motions, 'hiyori')

    expect(cache.mapping).toEqual({})
    expect(cache.unused).toEqual([])
    const rig = resolveLive2DParameterRig(undefined, {
      ...catalog,
      modelHash: 'hiyori',
      parameterProbe: cache,
    })
    expect(rig.channels.headAngleX.layer).toBe('default')
    expect(rig.channels.headAngleX.bindings).toEqual([{ paramId: 'ParamAngleX' }])
    expect(rig.channels.bodyAngleX.layer).toBe('default')
  })

  it('lets a card mapping replace the measurement', () => {
    const rig = resolveLive2DParameterRig(
      { bodyAngleX: [{ paramId: 'HipAngleX' }] },
      {
        parameterIds: ['ParamBodyAngleX', 'HipAngleX'],
        physicsInputIds: ['HipAngleX'],
        modelHash: 'hash-1',
        parameterProbe: {
          modelHash: 'hash-1',
          mapping: { bodyAngleX: [{ paramId: 'ParamBodyAngleX' }, { paramId: 'HipAngleX' }] },
          unused: [],
        },
      },
    )

    expect(rig.channels.bodyAngleX.layer).toBe('card')
    expect(rig.channels.bodyAngleX.bindings).toEqual([{ paramId: 'HipAngleX' }])
  })
})

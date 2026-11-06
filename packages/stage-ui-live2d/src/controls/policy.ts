import type { Live2DControlPolicy } from '../types/avatar-model'
import type { Live2DParameterBinding, Live2DParameterMapping, Live2DParameterProbeCache, Live2DUnusedParameter } from './parameter-mapping'

import { live2dParameterChannels } from './parameter-mapping'

/** Identifies one expression or motion in a Live2D model. */
export type Live2DControlTarget
  = | { kind: 'expression', id: string }
    | { kind: 'motion', id: string }

/** Returns an empty policy that enables every model control. */
export function createLive2DControlPolicy(): Live2DControlPolicy {
  return {
    disabledExpressions: [],
    disabledMotions: [],
  }
}

function copyBinding(binding: Live2DParameterBinding): Live2DParameterBinding {
  return {
    paramId: binding.paramId,
    ...(binding.scale !== undefined ? { scale: binding.scale } : {}),
    ...(binding.offset !== undefined ? { offset: binding.offset } : {}),
  }
}

function copyParameterMapping(mapping: Live2DParameterMapping): Live2DParameterMapping {
  const copy: Live2DParameterMapping = {}
  for (const channel of live2dParameterChannels) {
    const bindings = mapping[channel]
    if (!bindings)
      continue
    copy[channel] = bindings.map(copyBinding)
  }
  return copy
}

/** Returns a policy copy that keeps the parameter mapping and the mouth override. */
export function copyLive2DControlPolicy(policy: Live2DControlPolicy): Live2DControlPolicy {
  return {
    disabledExpressions: [...policy.disabledExpressions],
    disabledMotions: [...policy.disabledMotions],
    ...(policy.parameterMapping ? { parameterMapping: copyParameterMapping(policy.parameterMapping) } : {}),
    ...(policy.parameterProbe ? { parameterProbe: copyParameterProbe(policy.parameterProbe) } : {}),
    ...(typeof policy.skipMouthOpen === 'boolean' ? { skipMouthOpen: policy.skipMouthOpen } : {}),
  }
}

function copyUnused(parameter: Live2DUnusedParameter): Live2DUnusedParameter {
  return {
    paramId: parameter.paramId,
    region: parameter.region,
    ...(parameter.axis ? { axis: parameter.axis } : {}),
    ...(parameter.channel ? { channel: parameter.channel } : {}),
  }
}

function copyParameterProbe(probe: Live2DParameterProbeCache): Live2DParameterProbeCache {
  return {
    modelHash: probe.modelHash,
    mapping: copyParameterMapping(probe.mapping),
    unused: probe.unused.map(copyUnused),
  }
}

/** Returns whether a Character policy enables one Live2D control. */
export function isLive2DControlEnabled(
  policy: Live2DControlPolicy,
  target: Live2DControlTarget,
): boolean {
  const disabledIds = target.kind === 'expression'
    ? policy.disabledExpressions
    : policy.disabledMotions

  return !disabledIds.includes(target.id)
}

/**
 * Returns a policy with one Live2D control enabled or disabled.
 *
 * This function does not change the input policy.
 */
export function updateLive2DControlPolicy(
  policy: Live2DControlPolicy,
  target: Live2DControlTarget,
  enabled: boolean,
): Live2DControlPolicy {
  const disabledIds = target.kind === 'expression'
    ? policy.disabledExpressions
    : policy.disabledMotions
  const nextDisabledIds = enabled
    ? disabledIds.filter(id => id !== target.id)
    : [...new Set([...disabledIds, target.id])]

  return copyLive2DControlPolicy({
    disabledExpressions: target.kind === 'expression'
      ? nextDisabledIds
      : [...policy.disabledExpressions],
    disabledMotions: target.kind === 'motion'
      ? nextDisabledIds
      : [...policy.disabledMotions],
    parameterMapping: policy.parameterMapping,
    parameterProbe: policy.parameterProbe,
    skipMouthOpen: policy.skipMouthOpen,
  })
}

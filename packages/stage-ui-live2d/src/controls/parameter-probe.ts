import type { Live2DParameterCatalog, Live2DParameterChannel, Live2DParameterMapping, Live2DParameterProbeCache, Live2DUnusedParameter } from './parameter-mapping'

import { live2dParameterChannels, resolveLive2DParameterRig } from './parameter-mapping'

/** One drawable box in model canvas space. Y grows downward. */
export interface Live2DProbeDrawable {
  x: number
  y: number
  width: number
  height: number
}

/** One parameter on the offscreen model. */
export interface Live2DProbeParameter {
  id: string
  value: number
  min: number
  max: number
}

/**
 * An offscreen model.
 *
 * The visible avatar is a different instance. Nudges on this target do not
 * change the model on screen.
 */
export interface Live2DProbeTarget {
  parameters: readonly Live2DProbeParameter[]
  drawables: () => readonly Live2DProbeDrawable[]
  setParameter: (id: string, value: number) => void
  update: () => void
}

/** What one nudged parameter did to the mesh. */
export interface Live2DParameterMotion {
  paramId: string
  moved: boolean
  region: 'head' | 'torso' | 'other'
  axis?: 'x' | 'y' | 'z'
  /** The moved drawables cover a small part of the head. */
  tight: boolean
}

/** Share of the parameter range used for one nudge. */
const nudgeShare = 0.35
/** Travel below this, in model canvas units, is not a visible move. */
const visibleTravel = 0.75

const excludedIdPattern = /open|smile|squint|brow|tear|lash|highlight|leg|arm|hand|finger|hair|skirt|ear|ribbon/i

/**
 * Returns true when the stored measurement belongs to this model file.
 */
export function live2dProbeCacheMatches(modelHash: string | undefined, cache: Live2DParameterProbeCache | undefined): boolean {
  return !!modelHash && !!cache && cache.modelHash === modelHash
}

/**
 * Nudge distance for one parameter.
 *
 * The distance is a share of that parameter's own range, so a 0..1 mouth and
 * a -30..30 angle both move by the same fraction.
 */
export function live2dProbeNudge(parameter: Live2DProbeParameter): number {
  const span = parameter.max - parameter.min
  if (!(span > 0))
    return parameter.value
  const delta = span * nudgeShare
  const towardMax = Math.abs(parameter.max - parameter.value) >= Math.abs(parameter.value - parameter.min)
  const next = towardMax ? parameter.value + delta : parameter.value - delta
  return Math.min(parameter.max, Math.max(parameter.min, next))
}

function axisFromId(id: string): 'x' | 'y' | 'z' | undefined {
  const fromAngle = id.match(/angle[a-z]*?([xyz])/i)
  if (fromAngle?.[1])
    return fromAngle[1].toLowerCase() as 'x' | 'y' | 'z'
  const trailing = id.match(/([xyz])(?=\d*$)/i)
  if (trailing?.[1])
    return trailing[1].toLowerCase() as 'x' | 'y' | 'z'
  return undefined
}

function travelled(before: Live2DProbeDrawable, after: Live2DProbeDrawable): { distance: number, dx: number, dy: number } {
  const dx = after.x - before.x
  const dy = after.y - before.y
  return {
    dx,
    dy,
    distance: Math.hypot(dx, dy) + Math.hypot(after.width - before.width, after.height - before.height),
  }
}

function unionOf(drawables: readonly Live2DProbeDrawable[]): Live2DProbeDrawable | undefined {
  let box: Live2DProbeDrawable | undefined
  for (const drawable of drawables) {
    if (drawable.width <= 0 || drawable.height <= 0)
      continue
    if (!box) {
      box = { ...drawable }
      continue
    }
    const right = Math.max(box.x + box.width, drawable.x + drawable.width)
    const bottom = Math.max(box.y + box.height, drawable.y + drawable.height)
    box.x = Math.min(box.x, drawable.x)
    box.y = Math.min(box.y, drawable.y)
    box.width = right - box.x
    box.height = bottom - box.y
  }
  return box
}

function channelForMotion(motion: Live2DParameterMotion): Live2DParameterChannel | undefined {
  const axis = motion.axis ?? axisFromId(motion.paramId)
  if (!axis)
    return undefined
  const suffix = axis.toUpperCase()
  if (motion.region === 'head' && motion.tight)
    return `eyeBall${suffix}` as Live2DParameterChannel
  if (motion.region === 'head')
    return `headAngle${suffix}` as Live2DParameterChannel
  if (motion.region === 'torso')
    return `bodyAngle${suffix}` as Live2DParameterChannel
  return undefined
}

/**
 * Nudges each candidate on an offscreen target and records what moved.
 *
 * Each parameter is restored before the next one. `afterEach` lets the caller
 * yield so a long model does not freeze the page.
 */
export async function measureLive2DParameterMotions(
  target: Live2DProbeTarget,
  options?: { afterEach?: () => Promise<void> },
): Promise<Live2DParameterMotion[]> {
  const motions: Live2DParameterMotion[] = []
  for (const parameter of target.parameters) {
    if (excludedIdPattern.test(parameter.id))
      continue
    const nudged = live2dProbeNudge(parameter)
    if (nudged === parameter.value) {
      motions.push({ paramId: parameter.id, moved: false, region: 'other', tight: false })
      continue
    }

    const resting = target.drawables().map(drawable => ({ ...drawable }))
    let movedDrawables = resting
    try {
      target.setParameter(parameter.id, nudged)
      target.update()
      movedDrawables = target.drawables().map(drawable => ({ ...drawable }))
    }
    finally {
      target.setParameter(parameter.id, parameter.value)
      target.update()
    }

    motions.push(classifyMotion(parameter.id, resting, movedDrawables))
    await options?.afterEach?.()
  }
  return motions
}

function classifyMotion(
  paramId: string,
  resting: readonly Live2DProbeDrawable[],
  moved: readonly Live2DProbeDrawable[],
): Live2DParameterMotion {
  const model = unionOf(resting)
  let maxTravel = 0
  let weight = 0
  let sumY = 0
  let sumDx = 0
  let sumDy = 0
  const movedBoxes: Live2DProbeDrawable[] = []
  for (let index = 0; index < resting.length; index += 1) {
    const before = resting[index]
    const after = moved[index] ?? before
    if (!before)
      continue
    const travel = travelled(before, after)
    maxTravel = Math.max(maxTravel, travel.distance)
    if (travel.distance <= 0)
      continue
    const centerY = before.y + before.height / 2
    sumY += centerY * travel.distance
    sumDx += travel.dx
    sumDy += travel.dy
    weight += travel.distance
    movedBoxes.push(before)
  }

  if (!model || model.height <= 0 || maxTravel < visibleTravel) {
    return { paramId, moved: false, region: 'other', axis: axisFromId(paramId), tight: false }
  }

  const relativeY = (sumY / weight - model.y) / model.height
  const region = relativeY < 0.42 ? 'head' : relativeY < 0.78 ? 'torso' : 'other'
  const movedBox = unionOf(movedBoxes)
  const tight = !!movedBox
    && region === 'head'
    && (movedBox.width * movedBox.height) < model.width * model.height * 0.08
  const axis = axisFromId(paramId) ?? axisFromTravel(sumDx, sumDy)
  return { paramId, moved: true, region, axis, tight }
}

function axisFromTravel(dx: number, dy: number): 'x' | 'y' | 'z' {
  if (Math.abs(dx) > Math.abs(dy) * 1.5)
    return 'x'
  if (Math.abs(dy) > Math.abs(dx) * 1.5)
    return 'y'
  return 'z'
}

function sameIds(left: readonly { paramId: string }[], right: readonly string[]): boolean {
  if (left.length !== right.length)
    return false
  return left.every((binding, index) => binding.paramId === right[index])
}

/**
 * Builds the card cache from measured motions.
 *
 * Bindings that do not move a mesh are removed. A mover in the head or the
 * torso is added to that channel. Other movers stay in `unused`.
 */
export function live2dProbeCacheFromMotions(
  catalog: Live2DParameterCatalog,
  motions: readonly Live2DParameterMotion[],
  modelHash: string,
): Live2DParameterProbeCache {
  const measured = new Map(motions.map(motion => [motion.paramId, motion]))
  const base = resolveLive2DParameterRig(undefined, {
    ...catalog,
    modelHash: undefined,
    parameterProbe: undefined,
  })
  const mapping: Live2DParameterMapping = {}
  const used = new Set<string>()

  for (const channel of live2dParameterChannels) {
    const ids = base.channels[channel].bindings.map(binding => binding.paramId)
      .filter((id) => {
        const motion = measured.get(id)
        return !motion || motion.moved
      })
    for (const motion of motions) {
      if (!motion.moved || channelForMotion(motion) !== channel || ids.includes(motion.paramId))
        continue
      ids.push(motion.paramId)
    }
    for (const id of ids)
      used.add(id)
    if (!sameIds(base.channels[channel].bindings, ids))
      mapping[channel] = ids.map(paramId => ({ paramId }))
  }

  const unused: Live2DUnusedParameter[] = []
  for (const motion of motions) {
    if (!motion.moved || used.has(motion.paramId))
      continue
    const channel = channelForMotion(motion)
    unused.push({
      paramId: motion.paramId,
      region: motion.region,
      ...(motion.axis ? { axis: motion.axis } : {}),
      ...(channel ? { channel } : {}),
    })
  }

  return { modelHash, mapping, unused }
}

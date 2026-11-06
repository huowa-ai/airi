/**
 * Maps AIRI logical channels onto the parameter ids a Live2D model actually moves.
 *
 * Writers keep one channel, such as `headAngleX`. The rig decides which model
 * parameters receive that value. A model with no evidence keeps the standard
 * Cubism ids, so existing models stay unchanged.
 */

/** Logical channels that AIRI writes. */
export const live2dParameterChannels = [
  'headAngleX',
  'headAngleY',
  'headAngleZ',
  'bodyAngleX',
  'bodyAngleY',
  'bodyAngleZ',
  'eyeBallX',
  'eyeBallY',
  'mouthOpen',
  'mouthForm',
  'breath',
] as const

/** One logical channel that AIRI writes. */
export type Live2DParameterChannel = typeof live2dParameterChannels[number]

/**
 * One model parameter that receives a logical channel.
 *
 * The written value is `logical * scale + offset`. A missing scale is 1.
 * A missing offset is 0.
 */
export interface Live2DParameterBinding {
  paramId: string
  /** Multiplier applied to the logical value. */
  scale?: number
  /** Added after the scale. */
  offset?: number
}

/**
 * Card-owned bindings.
 *
 * A present channel is authoritative for that channel, including an empty list.
 * An absent channel is resolved from the model.
 */
export type Live2DParameterMapping = Partial<Record<Live2DParameterChannel, readonly Live2DParameterBinding[]>>

/** The source that selected the bindings for one channel. */
export type Live2DParameterMappingLayer = 'card' | 'physics' | 'name' | 'default'

/** Bindings for one channel and the layer that selected them. */
export interface Live2DResolvedParameterChannel {
  channel: Live2DParameterChannel
  bindings: readonly Live2DParameterBinding[]
  layer: Live2DParameterMappingLayer
}

/** The bindings every writer uses for the loaded model. */
export interface Live2DResolvedParameterRig {
  channels: Readonly<Record<Live2DParameterChannel, Live2DResolvedParameterChannel>>
}

/**
 * Parameter ids read from a loaded model and from its physics file.
 *
 * `parameterIds` comes from the runtime model. `physicsInputIds` comes from
 * physics3.json inputs. Those inputs are the parameters that drive hair,
 * clothes, and body physics. Physics outputs are the driven parameters, so
 * they are not write targets.
 */
export interface Live2DParameterCatalog {
  parameterIds: readonly string[]
  physicsInputIds: readonly string[]
}

/** A value held on one channel while the settings test sweep runs. */
export interface Live2DParameterProbe {
  channel: Live2DParameterChannel
  /** Logical value before scale and offset. */
  value: number
}

/** Cubism model surface the mapping writers need. */
export interface Live2DParameterWriter {
  setParameterValueById: (id: string, value: number, weight?: number) => unknown
  addParameterValueById?: (id: string, value: number, weight?: number) => unknown
  getParameterValueById?: (id: string) => number
}

/** Focus controller values, in the same units Cubism's updateFocus consumes. */
export interface Live2DFocusModel {
  focusController: { readonly x: number, readonly y: number }
  coreModel: Live2DParameterWriter
}

/** A motion slot that finished loading and still has curves. */
export interface Live2DLoadedMotion {
  _motionData: {
    curves: Array<{ id?: string }>
  }
}

/**
 * Known ids for each channel.
 *
 * The first id is the Cubism standard id. Later ids are aliases used by
 * exported models and by physics files.
 */
export const live2dParameterChannelAliases = {
  headAngleX: ['ParamAngleX', 'AngleX', 'PARAM_ANGLE_X'],
  headAngleY: ['ParamAngleY', 'AngleY', 'PARAM_ANGLE_Y'],
  headAngleZ: ['ParamAngleZ', 'AngleZ', 'PARAM_ANGLE_Z'],
  bodyAngleX: ['ParamBodyAngleX', 'BodyAngleX', 'PARAM_BODY_ANGLE_X'],
  bodyAngleY: ['ParamBodyAngleY', 'BodyAngleY', 'PARAM_BODY_ANGLE_Y'],
  bodyAngleZ: ['ParamBodyAngleZ', 'BodyAngleZ', 'PARAM_BODY_ANGLE_Z'],
  eyeBallX: ['ParamEyeBallX', 'EyeBallX', 'PARAM_EYE_BALL_X'],
  eyeBallY: ['ParamEyeBallY', 'EyeBallY', 'PARAM_EYE_BALL_Y'],
  mouthOpen: ['ParamMouthOpenY', 'MouthOpenY', 'PARAM_MOUTH_OPEN_Y'],
  mouthForm: ['ParamMouthForm', 'MouthForm', 'PARAM_MOUTH_FORM'],
  breath: ['ParamBreath', 'Breath', 'PARAM_BREATH'],
} as const satisfies Record<Live2DParameterChannel, readonly string[]>

/** Logical range used by the settings test sweep. */
export const live2dParameterSweepRange = {
  headAngleX: { min: -30, max: 30 },
  headAngleY: { min: -30, max: 30 },
  headAngleZ: { min: -30, max: 30 },
  bodyAngleX: { min: -10, max: 10 },
  bodyAngleY: { min: -10, max: 10 },
  bodyAngleZ: { min: -10, max: 10 },
  eyeBallX: { min: -1, max: 1 },
  eyeBallY: { min: -1, max: 1 },
  mouthOpen: { min: 0, max: 1 },
  mouthForm: { min: -1, max: 1 },
  breath: { min: 0, max: 1 },
} as const satisfies Record<Live2DParameterChannel, { min: number, max: number }>

const defaultBindings = Object.fromEntries(live2dParameterChannels.map(channel => [
  channel,
  Object.freeze([{ paramId: live2dParameterChannelAliases[channel][0] }]),
])) as Record<Live2DParameterChannel, readonly Live2DParameterBinding[]>

function createDefaultRig(): Live2DResolvedParameterRig {
  const channels = {} as Record<Live2DParameterChannel, Live2DResolvedParameterChannel>
  for (const channel of live2dParameterChannels) {
    channels[channel] = Object.freeze({
      channel,
      bindings: defaultBindings[channel],
      layer: 'default',
    })
  }
  return Object.freeze({ channels: Object.freeze(channels) })
}

/** Rig used when a model has no card mapping and no detected alias. */
export const defaultLive2DParameterRig: Live2DResolvedParameterRig = createDefaultRig()

/** Empty catalog. Detection then keeps the standard ids. */
export const emptyLive2DParameterCatalog: Live2DParameterCatalog = Object.freeze({
  parameterIds: Object.freeze([]),
  physicsInputIds: Object.freeze([]),
})

function standardParameterId(channel: Live2DParameterChannel): string {
  return live2dParameterChannelAliases[channel][0]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeBinding(value: Live2DParameterBinding): Live2DParameterBinding | undefined {
  if (typeof value?.paramId !== 'string')
    return undefined

  const binding: Live2DParameterBinding = { paramId: value.paramId }
  if (typeof value.scale === 'number' && Number.isFinite(value.scale))
    binding.scale = value.scale
  if (typeof value.offset === 'number' && Number.isFinite(value.offset))
    binding.offset = value.offset
  return binding
}

function bindingsFromCard(
  mapping: Live2DParameterMapping | undefined,
  channel: Live2DParameterChannel,
): readonly Live2DParameterBinding[] | undefined {
  if (!mapping || !Object.hasOwn(mapping, channel))
    return undefined

  const bindings = mapping[channel]
  if (!Array.isArray(bindings))
    return undefined

  return bindings.flatMap((binding) => {
    const normalized = normalizeBinding(binding)
    return normalized ? [normalized] : []
  })
}

function sameAsDefault(channel: Live2DParameterChannel, bindings: readonly Live2DParameterBinding[]): boolean {
  return bindings.length === 1
    && bindings[0]?.paramId === standardParameterId(channel)
    && bindings[0]?.scale === undefined
    && bindings[0]?.offset === undefined
}

/**
 * Physics inputs that belong to this channel.
 *
 * When the model also has the standard id, both ids are returned. The standard
 * id keeps the current AIRI write. The physics id is the one that deforms the
 * body and drives physics.
 */
function bindingsFromPhysics(
  channel: Live2DParameterChannel,
  catalog: Live2DParameterCatalog,
): readonly Live2DParameterBinding[] | undefined {
  const aliases = new Set<string>(live2dParameterChannelAliases[channel])
  const matched = catalog.physicsInputIds.filter(id => aliases.has(id))
  if (matched.length === 0)
    return undefined

  const known = new Set(catalog.parameterIds)
  const knowsParameters = known.size > 0
  const standardId = standardParameterId(channel)
  const ids: string[] = []
  // An empty parameter list means the runtime ids were not readable. Keep the
  // standard id so a normal model still receives the pose.
  if (!knowsParameters || known.has(standardId))
    ids.push(standardId)
  for (const id of matched) {
    if (!ids.includes(id))
      ids.push(id)
  }

  const bindings = ids.map(paramId => ({ paramId }))
  // Physics that names only the standard id is the normal Cubism rig.
  if (sameAsDefault(channel, bindings))
    return undefined
  return bindings
}

/** The first known alias that exists when the standard id does not. */
function bindingsFromName(
  channel: Live2DParameterChannel,
  catalog: Live2DParameterCatalog,
): readonly Live2DParameterBinding[] | undefined {
  if (catalog.parameterIds.length === 0)
    return undefined

  const known = new Set(catalog.parameterIds)
  const standardId = standardParameterId(channel)
  if (known.has(standardId))
    return undefined

  const alias = live2dParameterChannelAliases[channel].slice(1).find(id => known.has(id))
  if (!alias)
    return undefined
  return [{ paramId: alias }]
}

function resolveChannel(
  channel: Live2DParameterChannel,
  cardMapping: Live2DParameterMapping | undefined,
  catalog: Live2DParameterCatalog,
): Live2DResolvedParameterChannel {
  // Layer 1. The character card is authoritative for a channel it lists.
  const cardBindings = bindingsFromCard(cardMapping, channel)
  if (cardBindings)
    return { channel, bindings: cardBindings, layer: 'card' }

  // Layer 2. Physics inputs name the parameters that move the rig.
  const physicsBindings = bindingsFromPhysics(channel, catalog)
  if (physicsBindings)
    return { channel, bindings: physicsBindings, layer: 'physics' }

  // Layer 3. A known alias is used only when the standard id is absent.
  const nameBindings = bindingsFromName(channel, catalog)
  if (nameBindings)
    return { channel, bindings: nameBindings, layer: 'name' }

  // Layer 4. Write the standard id. Cubism ignores an id the model does not have.
  return defaultLive2DParameterRig.channels[channel]
}

/**
 * Resolves one rig from a card mapping and a model catalog.
 *
 * Priority for each channel is card, then physics inputs, then a parameter
 * name, then the standard Cubism id.
 *
 * @example
 * resolveLive2DParameterRig(undefined, {
 *   parameterIds: ['ParamAngleX', 'AngleX'],
 *   physicsInputIds: ['AngleX'],
 * }).channels.headAngleX
 * // => bindings for ParamAngleX and AngleX, layer 'physics'
 */
export function resolveLive2DParameterRig(
  cardMapping: Live2DParameterMapping | undefined,
  catalog: Live2DParameterCatalog = emptyLive2DParameterCatalog,
): Live2DResolvedParameterRig {
  const channels = {} as Record<Live2DParameterChannel, Live2DResolvedParameterChannel>
  for (const channel of live2dParameterChannels)
    channels[channel] = resolveChannel(channel, cardMapping, catalog)
  return { channels }
}

function appliedValue(binding: Live2DParameterBinding, value: number): number {
  return value * (binding.scale ?? 1) + (binding.offset ?? 0)
}

function writableBindings(rig: Live2DResolvedParameterRig, channel: Live2DParameterChannel): readonly Live2DParameterBinding[] {
  return rig.channels[channel].bindings.filter(binding => binding.paramId.length > 0)
}

/** Writes one logical value to every parameter bound to the channel. */
export function writeLive2DParameter(
  model: Live2DParameterWriter,
  rig: Live2DResolvedParameterRig,
  channel: Live2DParameterChannel,
  value: number,
): void {
  for (const binding of writableBindings(rig, channel))
    model.setParameterValueById(binding.paramId, appliedValue(binding, value))
}

/**
 * Adds a logical delta to every parameter bound to the channel.
 *
 * Offset is not applied. A delta of 0 does not write.
 */
export function addLive2DParameter(
  model: Live2DParameterWriter,
  rig: Live2DResolvedParameterRig,
  channel: Live2DParameterChannel,
  delta: number,
): void {
  if (!delta)
    return

  const add = model.addParameterValueById
  for (const binding of writableBindings(rig, channel)) {
    const amount = delta * (binding.scale ?? 1)
    if (add)
      add.call(model, binding.paramId, amount)
    else
      model.setParameterValueById(binding.paramId, (model.getParameterValueById?.(binding.paramId) ?? 0) + amount)
  }
}

/** Reads the logical value from the first binding of the channel. */
export function readLive2DParameter(
  model: Live2DParameterWriter,
  rig: Live2DResolvedParameterRig,
  channel: Live2DParameterChannel,
): number {
  const binding = writableBindings(rig, channel)[0]
  if (!binding)
    return 0

  const raw = model.getParameterValueById?.(binding.paramId)
  if (typeof raw !== 'number' || !Number.isFinite(raw))
    return 0

  const scale = binding.scale ?? 1
  if (scale === 0)
    return 0
  return (raw - (binding.offset ?? 0)) / scale
}

/**
 * Degrees applied by Cubism's built-in focus update.
 *
 * These match `Cubism4InternalModel.updateFocus` in pixi-live2d-display.
 * Eye values stay in the -1 to 1 focus range.
 */
const focusDegrees = { head: 30, body: 10 } as const

/**
 * Replaces the built-in focus update so every bound parameter receives it.
 *
 * The built-in update adds the focus delta only to the standard ids, and it
 * runs after the motion parameters are saved. The replacement keeps that
 * timing. A probe, when set, is written after the focus add so the settings
 * test is the value physics reads.
 */
export function installLive2DFocusMapping(
  model: Live2DFocusModel,
  rig: () => Live2DResolvedParameterRig,
  probe?: () => Live2DParameterProbe | undefined,
): void {
  // updateFocus is public at runtime and absent from the Pixi model type.
  const focusModel = model as Live2DFocusModel & { updateFocus: () => void }
  focusModel.updateFocus = () => {
    const focus = focusModel.focusController
    const current = rig()
    addLive2DParameter(focusModel.coreModel, current, 'eyeBallX', focus.x)
    addLive2DParameter(focusModel.coreModel, current, 'eyeBallY', focus.y)
    addLive2DParameter(focusModel.coreModel, current, 'headAngleX', focus.x * focusDegrees.head)
    addLive2DParameter(focusModel.coreModel, current, 'headAngleY', focus.y * focusDegrees.head)
    addLive2DParameter(focusModel.coreModel, current, 'headAngleZ', focus.x * focus.y * -focusDegrees.head)
    addLive2DParameter(focusModel.coreModel, current, 'bodyAngleX', focus.x * focusDegrees.body)

    const currentProbe = probe?.()
    if (currentProbe)
      writeLive2DParameter(focusModel.coreModel, current, currentProbe.channel, currentProbe.value)
  }
}

function parameterIdText(id: unknown): string | undefined {
  if (typeof id === 'string')
    return id
  if (!isRecord(id))
    return undefined
  if (typeof id.getString === 'function') {
    const text = id.getString()
    return typeof text === 'string' ? text : undefined
  }
  if (typeof id.s === 'string')
    return id.s
  if (typeof id._id === 'string')
    return id._id
  return undefined
}

/**
 * Reads parameter ids from a Cubism core model.
 *
 * pixi-live2d-display keeps the ids on `_parameterIds`. An older core exposes
 * `getParameterId`. An unreadable model returns an empty list.
 */
export function readLive2DCoreParameterIds(coreModel: object): string[] {
  const model = coreModel as {
    getParameterCount?: () => number
    getParameterId?: (index: number) => unknown
    _parameterIds?: readonly unknown[]
  }
  if (Array.isArray(model._parameterIds)) {
    return model._parameterIds.flatMap((id) => {
      const text = parameterIdText(id)
      return text ? [text] : []
    })
  }
  if (typeof model.getParameterCount !== 'function' || typeof model.getParameterId !== 'function')
    return []

  const count = model.getParameterCount()
  if (!Number.isFinite(count) || count <= 0)
    return []

  const ids: string[] = []
  for (let index = 0; index < count; index += 1) {
    const id = parameterIdText(model.getParameterId(index))
    if (id)
      ids.push(id)
  }
  return ids
}

function sourceParameterId(value: unknown): string | undefined {
  if (!isRecord(value))
    return undefined

  const source = isRecord(value.Source) ? value.Source : value
  if (source.Target !== undefined && source.Target !== 'Parameter')
    return undefined
  return typeof source.Id === 'string' && source.Id.length > 0 ? source.Id : undefined
}

/**
 * Reads physics input parameter ids.
 *
 * Outputs are ignored. They are the parameters physics writes, such as hair.
 *
 * @example
 * readLive2DPhysicsInputIds({
 *   PhysicsSettings: [{ Input: [{ Source: { Target: 'Parameter', Id: 'AngleX' } }] }],
 * })
 * // => ['AngleX']
 */
export function readLive2DPhysicsInputIds(physics: unknown): string[] {
  if (!isRecord(physics) || !Array.isArray(physics.PhysicsSettings))
    return []

  const ids: string[] = []
  for (const setting of physics.PhysicsSettings) {
    if (!isRecord(setting) || !Array.isArray(setting.Input))
      continue
    for (const input of setting.Input) {
      const id = sourceParameterId(input)
      if (id && !ids.includes(id))
        ids.push(id)
    }
  }
  return ids
}

/** Settings fields used to locate a physics file after a model loads. */
export interface Live2DPhysicsSettingsSource {
  physics?: string
  resolveURL?: (path: string) => string
  /** Input ids already read from the archive. */
  _physicsInputIds?: readonly string[]
}

/**
 * Reads physics input ids from archive metadata or from the physics file URL.
 *
 * A missing file returns an empty list. Detection then uses the name layer.
 */
export async function loadLive2DPhysicsInputIds(settings?: Live2DPhysicsSettingsSource): Promise<readonly string[]> {
  if (!settings)
    return []
  if (settings._physicsInputIds)
    return settings._physicsInputIds
  if (!settings.physics)
    return []

  const url = settings.resolveURL?.(settings.physics) ?? settings.physics
  try {
    const response = await fetch(url)
    if (!response.ok)
      return []
    return readLive2DPhysicsInputIds(await response.json())
  }
  catch (error) {
    console.warn('[Live2D] Physics inputs were not read.', error)
    return []
  }
}

/**
 * Decides whether MAGIC motion clears mouth opening.
 *
 * A card value wins. Without one, a mouth channel that did not come from the
 * default layer is driven. Every other model uses the global setting.
 */
export function resolveLive2DSkipMouthOpen(options: {
  globalSkip: boolean
  cardSkip?: boolean
  mouthOpenMapped: boolean
}): boolean {
  if (typeof options.cardSkip === 'boolean')
    return options.cardSkip
  if (options.mouthOpenMapped)
    return false
  return options.globalSkip
}

/** Reports one motion slot that is missing or has no curve data. */
export function reportUnloadedLive2DMotion(): void {
  console.warn('[Live2D] Skipped a motion that did not load.')
}

function isLoadedMotion(value: unknown): value is Live2DLoadedMotion {
  if (!isRecord(value) || !isRecord(value._motionData))
    return false
  return Array.isArray(value._motionData.curves)
}

/**
 * Visits motions that loaded.
 *
 * A null slot or a motion without curves is skipped. The caller still renders.
 */
export function forEachLoadedLive2DMotion(
  motions: readonly unknown[] | undefined,
  visit: (motion: Live2DLoadedMotion) => void,
): void {
  if (!motions)
    return

  for (const motion of motions) {
    if (!isLoadedMotion(motion)) {
      reportUnloadedLive2DMotion()
      continue
    }
    visit(motion)
  }
}

function sweepValue(min: number, max: number, step: number, steps: number): number {
  const turn = step / steps
  // One trip from the low end to the high end and back.
  const wave = turn < 0.5 ? turn * 2 : (1 - turn) * 2
  return min + (max - min) * wave
}

/**
 * Moves one channel from its low value to its high value and back.
 *
 * `setProbe` receives `undefined` when the sweep ends. A later sweep can ignore
 * those calls by dropping probes after it starts.
 */
export async function sweepLive2DParameterChannel(
  channel: Live2DParameterChannel,
  setProbe: (probe: Live2DParameterProbe | undefined) => void,
  options?: {
    /** Length of the sweep in milliseconds. @default 900 */
    durationMs?: number
    wait?: (ms: number) => Promise<void>
    /** Return false to stop the sweep early. */
    active?: () => boolean
  },
): Promise<void> {
  const durationMs = options?.durationMs ?? 900
  const steps = 12
  const wait = options?.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const range = live2dParameterSweepRange[channel]
  const stepMs = durationMs / steps

  try {
    for (let step = 0; step <= steps; step += 1) {
      if (options?.active && !options.active())
        return
      setProbe({
        channel,
        value: sweepValue(range.min, range.max, step, steps),
      })
      if (step < steps)
        await wait(stepMs)
    }
  }
  finally {
    if (!options?.active || options.active())
      setProbe(undefined)
  }
}

import type { Live2DProbeDrawable, Live2DProbeParameter, Live2DProbeTarget } from './parameter-probe'

import { Live2DFactory, Live2DModel } from 'pixi-live2d-display/cubism4'

import { readLive2DCoreParameterIds, readLive2DCoreParameterRanges } from './parameter-mapping'

/**
 * Loads a second Live2D model that is not on the visible stage.
 *
 * Nudges update this copy only. The avatar on screen is a different instance.
 */
export async function openOffscreenLive2DProbeTarget(source: File | string): Promise<Live2DProbeTarget & { destroy: () => void }> {
  const file = typeof source === 'string'
    ? new File([await (await fetch(source)).blob()], 'model.zip')
    : source
  const model = new Live2DModel({ autoUpdate: false, autoInteract: false })
  await Live2DFactory.setupLive2DModel(model, [file], { autoInteract: false })
  model.autoUpdate = false

  const internal = model.internalModel as {
    coreModel: {
      update: () => void
      getDrawableCount?: () => number
      setParameterValueById: (id: string, value: number) => void
      getParameterValueById: (id: string) => number
    }
    getDrawableBounds: (index: number) => Live2DProbeDrawable
  }
  const core = internal.coreModel
  const ranges = readLive2DCoreParameterRanges(core)
  const parameters: Live2DProbeParameter[] = readLive2DCoreParameterIds(core).map(id => ({
    id,
    value: core.getParameterValueById(id),
    min: ranges[id]?.min ?? 0,
    max: ranges[id]?.max ?? 1,
  }))

  return {
    parameters,
    drawables: () => {
      const count = core.getDrawableCount?.() ?? 0
      const drawables: Live2DProbeDrawable[] = []
      for (let index = 0; index < count; index += 1)
        drawables.push({ ...internal.getDrawableBounds(index) })
      return drawables
    },
    setParameter: (id, value) => {
      core.setParameterValueById(id, value)
    },
    update: () => {
      core.update()
    },
    destroy: () => {
      model.destroy()
    },
  }
}

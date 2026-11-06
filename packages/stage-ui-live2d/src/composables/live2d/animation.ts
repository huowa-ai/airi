import type { InternalModel } from 'pixi-live2d-display/cubism4'

import type { Live2DParameterWriter, Live2DResolvedParameterRig } from '../../controls/parameter-mapping'

import { MathUtils } from 'three'

import { defaultLive2DParameterRig, readLive2DParameter, writeLive2DParameter } from '../../controls/parameter-mapping'
import { randomSaccadeInterval } from '../../utils/eye-motions'

/**
 * This is to simulate idle eye saccades and focus (head) movements in a *pretty* naive way.
 * Not using any reactivity here as it's not yet needed.
 * Keeping it here as a composable for future extension.
 */
export function useLive2DIdleEyeFocus(
  parameterRig: () => Live2DResolvedParameterRig = () => defaultLive2DParameterRig,
) {
  let nextSaccadeAfter = -1
  let focusTarget: [number, number] | undefined
  let lastSaccadeAt = -1

  // Function to handle idle eye saccades and focus (head) movements
  function update(model: InternalModel, now: number) {
    if (now >= nextSaccadeAfter || now < lastSaccadeAt) {
      focusTarget = [MathUtils.randFloat(-1, 1), MathUtils.randFloat(-1, 0.7)]
      lastSaccadeAt = now
      nextSaccadeAfter = now + (randomSaccadeInterval() / 1000)
      model.focusController.focus(focusTarget![0] * 0.5, focusTarget![1] * 0.5, false)
    }

    model.focusController.update(now - lastSaccadeAt)
    const coreModel = model.coreModel as Live2DParameterWriter
    const rig = parameterRig()
    const nextX = MathUtils.lerp(readLive2DParameter(coreModel, rig, 'eyeBallX'), focusTarget![0], 0.3)
    const nextY = MathUtils.lerp(readLive2DParameter(coreModel, rig, 'eyeBallY'), focusTarget![1], 0.3)
    writeLive2DParameter(coreModel, rig, 'eyeBallX', nextX)
    writeLive2DParameter(coreModel, rig, 'eyeBallY', nextY)
  }

  return { update }
}

/** The standing Live2D model box, in CSS pixels of the stage. */
export interface Live2DCharacterBox {
  centerX: number
  centerY: number
  width: number
  height: number
}

/**
 * The fitted model box that `setScaleAndPosition` writes onto the Pixi model.
 *
 * `fitScale`, `fitX`, and `fitY` come from `useFitModel`.
 * `viewScale` and the offsets come from the stage view control.
 */
export function live2dCharacterBoxFromFit(input: {
  fitScale: number
  fitX: number
  fitY: number
  modelWidth: number
  modelHeight: number
  viewScale: number
  offsetX: number
  offsetY: number
}): Live2DCharacterBox | undefined {
  if (input.modelWidth <= 0 || input.modelHeight <= 0 || input.fitScale <= 0 || input.viewScale <= 0)
    return undefined

  const displayScale = input.fitScale * input.viewScale
  return {
    centerX: input.fitX + input.offsetX,
    centerY: input.fitY + input.offsetY,
    width: input.modelWidth * displayScale,
    height: input.modelHeight * displayScale,
  }
}

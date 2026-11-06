/** Standing model box in CSS pixels of the stage. */
export interface DanceModelBox {
  centerX: number
  centerY: number
  width: number
  height: number
}

/** Opaque body of one cutout frame, measured from the top of the frame. */
export interface DanceCutoutBody {
  width: number
  height: number
  /** Fraction of the frame height from the top to the top of the head. */
  head: number
  /** Fraction of the frame height from the top to the feet. */
  foot: number
}

/** Cutout frame box in CSS pixels of the stage. */
export interface DanceCutoutFrame {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Places the cutout frame on the standing model.
 *
 * The feet sit on the bottom of the model box.
 * The span from the head to the feet matches the model height times `heightScale`.
 *
 * @example
 * placeCutoutFrame(
 *   { centerX: 50, centerY: 100, width: 100, height: 200 },
 *   { width: 100, height: 200, head: 0.1, foot: 0.9 },
 * )
 * // => { left: -12.5, top: -25, width: 125, height: 250 }
 */
export function placeCutoutFrame(
  model: DanceModelBox,
  body: DanceCutoutBody,
  heightScale = 1,
): DanceCutoutFrame {
  const bodySpan = body.foot - body.head
  if (!(bodySpan > 0) || !(body.width > 0) || !(body.height > 0) || !(heightScale > 0))
    throw new Error('The cutout body must have a positive height and a foot below the head.')

  const frameHeight = (model.height * heightScale) / bodySpan
  const frameWidth = frameHeight * (body.width / body.height)
  const modelBottom = model.centerY + model.height / 2

  return {
    left: model.centerX - frameWidth / 2,
    top: modelBottom - body.foot * frameHeight,
    width: frameWidth,
    height: frameHeight,
  }
}

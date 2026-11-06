import type { DanceCutoutBody } from './placement'

/**
 * Opaque body of the 大肥鱼 cutout, measured on the source frame.
 *
 * `head` and `foot` are fractions of the frame height from the top.
 * Change them when the feet or the head do not meet the Live2D model.
 */
export const dafeiYuCutoutBody = {
  width: 736,
  height: 1280,
  head: 0.052,
  foot: 0.966,
} as const satisfies DanceCutoutBody

/** VP9 WebM with an alpha plane. Browsers that keep the plane play this file. */
export const danceCutoutVideoUrl = new URL('../../assets/dance-cutout/dafei-yu.webm', import.meta.url).href

/**
 * Animated WebP at 12 frames per second.
 *
 * Browsers that drop VP9 alpha play this file instead.
 */
export const danceCutoutFallbackUrl = new URL('../../assets/dance-cutout/dafei-yu.webp', import.meta.url).href

/**
 * Playback length of `dafei-yu.webp`.
 *
 * The file has 164 frames and each frame lasts 83 ms.
 * The image element has no end event, so the player stops on this timer.
 */
export const danceCutoutFallbackDurationMs = 164 * 83

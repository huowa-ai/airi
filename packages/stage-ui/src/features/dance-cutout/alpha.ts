export type DanceCutoutSource = 'video' | 'webp'

let cachedSource: DanceCutoutSource | undefined

/** Chooses the clip source. A failed alpha probe selects the WebP fallback. */
export async function resolveCutoutSource(probe: () => Promise<boolean>): Promise<DanceCutoutSource> {
  if (cachedSource)
    return cachedSource

  try {
    cachedSource = await probe() ? 'video' : 'webp'
  }
  catch {
    cachedSource = 'webp'
  }

  return cachedSource
}

export function resetCutoutSourceCache() {
  cachedSource = undefined
}

/**
 * Reads one decoded video frame.
 *
 * The corner of this clip is empty. The center covers the character.
 * Alpha works when the corner stays transparent and the center stays opaque.
 */
export function probeWebmAlpha(url: string): Promise<boolean> {
  // NOTICE:
  // A browser can decode VP9 and still drop the alpha plane.
  // Transparent pixels then become opaque black, which covers the stage.
  // Observed on Safari's HTML video element for VP9 WebM.
  // Remove the WebP fallback when this probe returns true on every browser the stage supports.
  const video = document.createElement('video')
  video.muted = true
  video.defaultMuted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = url

  return new Promise((resolve) => {
    let settled = false
    let timer = 0
    const finish = (value: boolean) => {
      if (settled)
        return
      settled = true
      window.clearTimeout(timer)
      video.pause()
      video.removeAttribute('src')
      video.load()
      resolve(value)
    }

    timer = window.setTimeout(finish, 2000, false)
    video.onerror = () => finish(false)

    video.play().then(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve())
      })
      const width = video.videoWidth
      const height = video.videoHeight
      if (width <= 0 || height <= 0) {
        finish(false)
        return
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) {
        finish(false)
        return
      }

      context.drawImage(video, 0, 0, width, height)
      const corner = context.getImageData(1, 1, 1, 1).data[3] ?? 255
      const center = context.getImageData(Math.floor(width / 2), Math.floor(height / 2), 1, 1).data[3] ?? 0
      finish(center > 128 && corner < 128)
    }).catch(() => finish(false))
  })
}

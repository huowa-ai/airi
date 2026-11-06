/** The track fields a call needs to force echo cancellation. */
export interface EchoTrack {
  applyConstraints: (constraints: MediaTrackConstraints) => Promise<void>
  getSettings: () => MediaTrackSettings
}

/** A microphone stream. `MediaStream` satisfies this. */
export interface EchoStream {
  getAudioTracks: () => readonly EchoTrack[]
}

/**
 * Forces echo cancellation on an open microphone track.
 *
 * The capture constraints already ask for it. Some browsers still open the
 * track without it, and barge-in then hears the speaker. Applying the
 * constraint on the live track is the second request.
 *
 * Returns true when every audio track reports echo cancellation.
 * A browser that rejects the constraint returns false. The call stays up.
 */
export async function forceEchoCancellation(stream: EchoStream): Promise<boolean> {
  const tracks = stream.getAudioTracks()
  if (tracks.length === 0)
    return false

  const applied = await Promise.all(tracks.map(async (track) => {
    try {
      if (track.getSettings().echoCancellation === true)
        return true
      await track.applyConstraints({ echoCancellation: true })
      return track.getSettings().echoCancellation === true
    }
    catch {
      return false
    }
  }))
  return applied.every(Boolean)
}

import { computed, nextTick, ref } from 'vue'

export type DancePhase = 'idle' | 'covering' | 'playing' | 'restoring'

/**
 * Playback of one cutout clip.
 *
 * `start` hides the model, waits one frame, then shows the cutout.
 * `stop` hides the cutout, waits one frame, then shows the model.
 * A later `start`, `stop`, or `reset` cancels the wait that is in progress.
 */
export function createDanceCutout() {
  const phase = ref<DancePhase>('idle')
  let run = 0

  const hidesModel = computed(() => phase.value !== 'idle')
  const showsCutout = computed(() => phase.value === 'playing')

  async function start() {
    if (phase.value !== 'idle')
      return false

    const token = ++run
    phase.value = 'covering'
    await nextTick()
    if (token !== run || phase.value !== 'covering')
      return false

    phase.value = 'playing'
    return true
  }

  async function stop() {
    if (phase.value === 'idle' || phase.value === 'restoring')
      return

    const token = ++run
    phase.value = 'restoring'
    await nextTick()
    if (token !== run || phase.value !== 'restoring')
      return

    phase.value = 'idle'
  }

  function reset() {
    run += 1
    phase.value = 'idle'
  }

  return {
    phase,
    hidesModel,
    showsCutout,
    start,
    stop,
    reset,
  }
}

const danceCutout = createDanceCutout()

/** The stage and the Dance button share this playback. */
export function useDanceCutout() {
  return danceCutout
}

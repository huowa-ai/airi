<script setup lang="ts">
import type { DanceCutoutSource } from './alpha'
import type { DanceCutoutFrame, DanceModelBox } from './placement'

import { OverlayButton } from '@proj-airi/ui'
import { useElementSize } from '@vueuse/core'
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useL2dViewControl } from '../../stores/live2d'
import { probeWebmAlpha, resolveCutoutSource } from './alpha'
import {
  dafeiYuCutoutBody,
  danceCutoutFallbackDurationMs,
  danceCutoutFallbackUrl,
  danceCutoutVideoUrl,
} from './assets'
import { placeCutoutFrame } from './placement'
import { useDanceCutout } from './playback'

const props = defineProps<{
  /** Reads the standing Live2D model box in this stage's CSS pixels. */
  layout: () => DanceModelBox | undefined
}>()

const { t } = useI18n()
const { phase, showsCutout, start, stop, reset } = useDanceCutout()
const { position, scale } = useL2dViewControl()
const root = ref<HTMLDivElement>()
const { width: stageWidth, height: stageHeight } = useElementSize(root)

const preparing = ref(false)
const source = shallowRef<DanceCutoutSource>('video')
const frame = shallowRef<DanceCutoutFrame>()
let prepareToken = 0
let endTimer: ReturnType<typeof setTimeout> | undefined

const busy = computed(() => preparing.value || phase.value !== 'idle')

const frameStyle = computed(() => {
  const current = frame.value
  if (!current)
    return undefined

  return {
    'left': `${current.left}px`,
    'top': `${current.top}px`,
    'width': `${current.width}px`,
    'height': `${current.height}px`,
    '--stage-width': `${stageWidth.value}px`,
    '--stage-height': `${stageHeight.value}px`,
    '--dance-foot': String(dafeiYuCutoutBody.foot),
  }
})

function refreshFrame() {
  const model = props.layout()
  if (!model)
    return
  frame.value = placeCutoutFrame(model, dafeiYuCutoutBody)
}

watch(
  () => [showsCutout.value, position.value.x, position.value.y, scale.value, stageWidth.value, stageHeight.value] as const,
  () => {
    if (showsCutout.value)
      refreshFrame()
  },
)

function clearEndTimer() {
  if (endTimer === undefined)
    return
  clearTimeout(endTimer)
  endTimer = undefined
}

watch(showsCutout, (shown) => {
  clearEndTimer()
  if (!shown || source.value !== 'webp')
    return

  endTimer = setTimeout(() => {
    void stop()
  }, danceCutoutFallbackDurationMs)
})

async function onPress() {
  if (busy.value) {
    prepareToken += 1
    preparing.value = false
    await stop()
    return
  }

  const token = ++prepareToken
  preparing.value = true
  try {
    source.value = await resolveCutoutSource(() => probeWebmAlpha(danceCutoutVideoUrl))
    if (token !== prepareToken)
      return

    refreshFrame()
    if (!frame.value)
      return

    await start()
  }
  finally {
    if (token === prepareToken)
      preparing.value = false
  }
}

function onClipEnded() {
  void stop()
}

function onVideoReady(event: Event) {
  const video = event.target
  if (!(video instanceof HTMLVideoElement))
    return

  video.play().catch(() => {
    void stop()
  })
}

onUnmounted(() => {
  prepareToken += 1
  clearEndTimer()
  reset()
})
</script>

<template>
  <div
    ref="root"
    :class="[
      'pointer-events-none absolute inset-0 z-10',
    ]"
  >
    <div
      v-if="showsCutout && frameStyle"
      data-testid="dance-cutout-frame"
      :class="['dance-cutout-frame pointer-events-none absolute']"
      :style="frameStyle"
    >
      <video
        v-if="source === 'video'"
        :src="danceCutoutVideoUrl"
        muted
        playsinline
        autoplay
        aria-hidden="true"
        :class="['pointer-events-none block h-full w-full object-fill']"
        @ended="onClipEnded"
        @error="onClipEnded"
        @loadeddata="onVideoReady"
      />
      <img
        v-else
        :src="danceCutoutFallbackUrl"
        alt=""
        aria-hidden="true"
        draggable="false"
        :class="['pointer-events-none block h-full w-full object-fill']"
        @error="onClipEnded"
      >
    </div>
    <div
      :class="[
        'pointer-events-auto absolute left-3 top-3',
      ]"
    >
      <OverlayButton
        size="sm"
        data-testid="dance-cutout-button"
        :icon="busy ? 'i-solar:stop-bold' : 'i-solar:play-bold'"
        :label="busy ? t('stage.dance-cutout.stop') : t('stage.dance-cutout.start')"
        :aria-pressed="busy"
        @click="onPress"
      />
    </div>
  </div>
</template>

<style scoped>
/*
 * Tune these on `.dance-cutout-frame` while the clip plays.
 * `--dance-height-scale` grows the clip from the foot line. 1 keeps the matched height.
 * `--dance-offset-x` is a fraction of the stage width. A positive value moves the clip right.
 * `--dance-offset-y` is a fraction of the stage height. A positive value moves the clip down.
 */
.dance-cutout-frame {
  --dance-height-scale: 1;
  --dance-offset-x: 0;
  --dance-offset-y: 0;
  transform: translate(
    calc(var(--dance-offset-x) * var(--stage-width)),
    calc(var(--dance-offset-y) * var(--stage-height))
  ) scale(var(--dance-height-scale));
  transform-origin: 50% calc(var(--dance-foot) * 100%);
}
</style>

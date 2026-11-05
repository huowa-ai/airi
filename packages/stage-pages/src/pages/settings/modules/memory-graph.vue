<script setup lang="ts">
import type { MemoryGraphFact } from './memory-graph-model'

import { useMemoryStore } from '@proj-airi/stage-ui/stores/memory'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { Alert } from '@proj-airi/ui'
import { usePreferredReducedMotion } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import MemoryGraphView from './components/memory-graph-view.vue'

import { buildMemoryGraph, readMemoryGraphSource } from './memory-graph-model'

const { t } = useI18n()
const memory = useMemoryStore()
const { serviceRead, serviceError } = storeToRefs(memory)
const { cards } = storeToRefs(useAiriCardStore())
const reducedMotion = usePreferredReducedMotion()
const selectedId = ref('')
const graphUnavailable = ref(false)

const KEY = 'settings.pages.modules.memory-long-term.graph'

const model = computed(() => buildMemoryGraph({
  serviceRead: serviceRead.value,
  serviceError: serviceError.value,
  facts: memory.listFacts(),
}))

const showGraph = computed(() => reducedMotion.value !== 'reduce' && model.value.status === 'ready' && model.value.nodes.length > 0 && !graphUnavailable.value)

const selected = computed(() => memory.listFacts().find(entry => entry.id === selectedId.value))
const selectedSource = computed(() => readMemoryGraphSource(sourceOf(selected.value)))

const themeHue = computed(() => {
  if (typeof document === 'undefined')
    return 220.44
  const parsed = Number(getComputedStyle(document.documentElement).getPropertyValue('--chromatic-hue'))
  return Number.isFinite(parsed) ? parsed : 220.44
})

const backgroundColor = computed(() => `hsl(${themeHue.value}, 45%, 7%)`)
const nodeColor = computed(() => `hsl(${themeHue.value}, 85%, 68%)`)
const linkColor = computed(() => `hsl(${themeHue.value}, 55%, 62%)`)

function sourceOf(entry: MemoryGraphFact | undefined) {
  if (!entry || !('provenance' in entry))
    return undefined
  return entry.provenance
}

function cardName(persona: string | undefined) {
  if (!persona)
    return t(`${KEY}.shared`)
  return cards.value.get(persona)?.name || persona
}
</script>

<template>
  <div :class="['flex flex-col', 'gap-4']">
    <p :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">
      {{ t(`${KEY}.description`) }}
    </p>

    <Alert v-if="model.status === 'off'" tone="warning" :title="t(`${KEY}.off-title`)">
      {{ t(`${KEY}.off`) }}
    </Alert>
    <Alert v-else-if="model.status === 'error'" tone="danger" :title="t(`${KEY}.error-title`)">
      {{ model.error || t(`${KEY}.error`) }}
    </Alert>
    <Alert v-else-if="model.status === 'loading'" tone="info" :title="t(`${KEY}.loading`)" loading />
    <Alert v-else-if="model.nodes.length === 0" tone="info" :title="t(`${KEY}.empty-title`)">
      {{ t(`${KEY}.empty`) }}
    </Alert>

    <div :class="['grid gap-4', 'lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.8fr)]']">
      <section :class="['flex flex-col', 'gap-3', 'rounded-xl', 'bg-neutral-950', 'p-4', 'text-neutral-100']" :aria-label="t(`${KEY}.canvas-label`, { count: model.nodes.length, lines: model.links.length })">
        <div :class="['flex flex-wrap', 'gap-x-4 gap-y-2', 'text-xs']">
          <span :class="['inline-flex items-center', 'gap-2']">
            <span :class="['inline-block', 'size-2.5', 'rounded-full', 'bg-primary-300']" aria-hidden="true" />
            {{ t(`${KEY}.layers.l0`) }}
          </span>
          <span v-for="layer in model.absentLayers" :key="layer">
            {{ t(`${KEY}.layers.absent`, { layer }) }}
          </span>
          <span>{{ t(`${KEY}.derived`) }}</span>
        </div>
        <p v-if="reducedMotion === 'reduce'" :class="['text-sm', 'text-neutral-300']">
          {{ t(`${KEY}.reduced`) }}
        </p>
        <Alert v-else-if="graphUnavailable" tone="warning" :title="t(`${KEY}.unavailable-title`)">
          {{ t(`${KEY}.unavailable`) }}
        </Alert>
        <div v-else-if="showGraph" :class="['h-80', 'overflow-hidden', 'rounded-lg']">
          <MemoryGraphView
            :nodes="model.nodes"
            :links="model.links"
            :selected-id="selectedId"
            :derived-label="t(`${KEY}.derived`)"
            :background-color="backgroundColor"
            :node-color="nodeColor"
            :link-color="linkColor"
            @select="selectedId = $event"
            @unavailable="graphUnavailable = true"
          />
        </div>
        <p :class="['text-xs', 'text-neutral-400']">
          {{ t(`${KEY}.counts`, { count: model.nodes.length, lines: model.links.length }) }}
        </p>
      </section>

      <section :class="['flex flex-col', 'gap-3']">
        <h2 :class="['text-sm font-medium']">
          {{ t(`${KEY}.facts`) }}
        </h2>
        <p v-if="model.nodes.length === 0" :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">
          {{ t(`${KEY}.list-empty`) }}
        </p>
        <ul v-else :class="['flex flex-col', 'gap-2']">
          <li v-for="node in model.nodes" :key="node.id">
            <button
              type="button"
              :aria-current="node.id === selectedId ? 'true' : undefined"
              :class="[
                'w-full',
                'rounded-lg',
                'px-3 py-2',
                'text-left',
                'bg-neutral-50 dark:bg-neutral-800/60',
                node.id === selectedId ? 'ring-2 ring-primary-400' : '',
              ]"
              @click="selectedId = node.id"
            >
              <span :class="['block', 'text-sm font-medium', 'break-words']">{{ node.label }}</span>
              <span :class="['block', 'text-xs', 'text-neutral-500 dark:text-neutral-400']">{{ t(`${KEY}.layers.l0`) }}</span>
            </button>
          </li>
        </ul>

        <div v-if="selected" :class="['flex flex-col', 'gap-2', 'rounded-xl', 'bg-neutral-50 dark:bg-neutral-800/60', 'p-4']">
          <h2 :class="['text-sm font-medium']">
            {{ t(`${KEY}.detail`) }}
          </h2>
          <p :class="['text-sm', 'whitespace-pre-wrap break-words']">
            {{ selected.body }}
          </p>
          <dl :class="['grid grid-cols-[7rem_minmax(0,1fr)]', 'gap-y-1', 'text-xs']">
            <dt :class="['text-neutral-500 dark:text-neutral-400']">
              {{ t(`${KEY}.card`) }}
            </dt>
            <dd :class="['break-words']">
              {{ cardName(selected.persona) }}
            </dd>
            <dt :class="['text-neutral-500 dark:text-neutral-400']">
              {{ t(`${KEY}.updated`) }}
            </dt>
            <dd>{{ new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(selected.updatedAt) }}</dd>
            <dt :class="['text-neutral-500 dark:text-neutral-400']">
              {{ t(`${KEY}.source`) }}
            </dt>
            <dd v-if="selectedSource" :class="['flex flex-col', 'gap-1', 'break-words']">
              <span v-if="selectedSource.sessionId">{{ t(`${KEY}.session`, { id: selectedSource.sessionId }) }}</span>
              <span v-if="selectedSource.turnId">{{ t(`${KEY}.turn`, { id: selectedSource.turnId }) }}</span>
              <span v-if="selectedSource.binding">{{ t(`${KEY}.binding`, { id: selectedSource.binding }) }}</span>
              <span v-if="selectedSource.modality">{{ t(`${KEY}.modality`, { name: selectedSource.modality }) }}</span>
              <span v-for="asset in selectedSource.assetRefs" :key="asset">{{ asset }}</span>
            </dd>
            <dd v-else>
              {{ t(`${KEY}.no-source`) }}
            </dd>
          </dl>
        </div>
      </section>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.memory-long-term.graph.title
  subtitleKey: settings.pages.modules.memory-long-term.title
  stageTransition:
    name: slide
</route>

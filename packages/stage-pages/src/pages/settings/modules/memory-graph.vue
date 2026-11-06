<script setup lang="ts">
import type { MemoryGraphFact, MemoryGraphLayer } from './memory-graph-model'

import { useMemoryStore } from '@proj-airi/stage-ui/stores/memory'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { Alert } from '@proj-airi/ui'
import { usePreferredReducedMotion } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import MemoryGraphView from './components/memory-graph-view.vue'

import { buildMemoryGraph, memoryLayerColor, readMemoryGraphSource } from './memory-graph-model'

const { t } = useI18n()
const memory = useMemoryStore()
const { serviceRead, serviceError, layers, scope } = storeToRefs(memory)
const { cards } = storeToRefs(useAiriCardStore())
const reducedMotion = usePreferredReducedMotion()
const selectedId = ref('')
const graphUnavailable = ref(false)

const KEY = 'settings.pages.modules.memory-long-term.graph'
const UNKNOWN = 'settings.pages.modules.memory-long-term.unknown-character'

const model = computed(() => {
  const ready = serviceRead.value === 'ready'
  const snapshot = layers.value
  return buildMemoryGraph({
    serviceRead: serviceRead.value,
    serviceError: serviceError.value,
    facts: memory.listFacts(),
    atoms: ready ? snapshot.atoms.items : [],
    scenes: ready ? snapshot.scenes.items : [],
    cores: ready ? snapshot.cores.items : [],
    layerErrors: ready
      ? (['atoms', 'scenes', 'cores'] as const).flatMap((key) => {
          const layer = snapshot[key]
          const name = { atoms: 'L1', scenes: 'L2', cores: 'L3' } as const
          return layer.status === 'error' ? [{ layer: name[key], message: layer.error }] : []
        })
      : [],
    truncatedLayers: ready
      ? [
          ...(snapshot.atoms.truncated ? ['L1' as const] : []),
          ...(snapshot.scenes.truncated ? ['L2' as const] : []),
          ...(snapshot.cores.truncated ? ['L3' as const] : []),
        ]
      : [],
  })
})

const listNodes = computed(() => {
  const rank: Record<MemoryGraphLayer, number> = { L3: 0, L2: 1, L1: 2, L0: 3 }
  return [...model.value.nodes].sort((left, right) => rank[left.layer] - rank[right.layer] || left.label.localeCompare(right.label))
})

const showGraph = computed(() => reducedMotion.value !== 'reduce' && model.value.status === 'ready' && model.value.nodes.length > 0 && !graphUnavailable.value)
const showScope = computed(() => model.value.legend.includes('L2') || model.value.legend.includes('L3'))

const selected = computed(() => model.value.details.find(entry => entry.id === selectedId.value))
const selectedFact = computed(() => {
  if (selected.value?.kind !== 'fact')
    return undefined
  return memory.listFacts().find(entry => entry.id === selected.value?.id)
})
const selectedSource = computed(() => readMemoryGraphSource(sourceOf(selectedFact.value)))

const themeHue = computed(() => {
  if (typeof document === 'undefined')
    return 220.44
  const parsed = Number(getComputedStyle(document.documentElement).getPropertyValue('--chromatic-hue'))
  return Number.isFinite(parsed) ? parsed : 220.44
})

const backgroundColor = computed(() => `hsl(${themeHue.value}, 45%, 7%)`)
const linkColor = computed(() => `hsl(${themeHue.value}, 55%, 62%)`)

function sourceOf(entry: MemoryGraphFact | undefined) {
  if (!entry || !('provenance' in entry))
    return undefined
  return entry.provenance
}

function cardName(persona: string | undefined) {
  if (!persona)
    return t(`${KEY}.shared`)
  const name = cards.value.get(persona)?.name?.trim()
  return name || t(UNKNOWN)
}

function layerLabel(layer: MemoryGraphLayer) {
  return t(`${KEY}.layers.${layer.toLowerCase()}`)
}

function typeLabel(type: string | undefined) {
  if (type === 'episodic' || type === 'persona' || type === 'instruction')
    return t(`${KEY}.types.${type}`)
  return t(`${KEY}.types.other`)
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
    <Alert v-else-if="serviceError" tone="danger" :title="t(`${KEY}.error-title`)">
      {{ serviceError }}
    </Alert>
    <Alert v-else-if="model.nodes.length === 0" tone="info" :title="t(`${KEY}.empty-title`)">
      {{ t(`${KEY}.empty`) }}
    </Alert>

    <div :class="['grid gap-4', 'items-start', 'lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.8fr)]']">
      <section :class="['flex flex-col', 'gap-3', 'self-start', 'rounded-xl', 'bg-neutral-950', 'p-4', 'text-neutral-100']" :aria-label="t(`${KEY}.canvas-label`, { count: model.nodes.length, lines: model.links.length })">
        <div :class="['flex flex-wrap', 'gap-x-4 gap-y-2', 'text-xs']">
          <span v-for="layer in model.legend" :key="layer" :class="['inline-flex items-center', 'gap-2']">
            <span :class="['inline-block', 'size-2.5', 'rounded-full']" :style="{ backgroundColor: memoryLayerColor(layer, themeHue) }" aria-hidden="true" />
            {{ layerLabel(layer) }}
          </span>
          <span>{{ t(`${KEY}.derived`) }}</span>
        </div>
        <p v-if="model.status === 'ready' && scope" :class="['text-xs', 'text-neutral-300']">
          {{ t(`${KEY}.scope-current`, { team: scope.teamId }) }}
        </p>
        <p v-if="showScope && scope" :class="['text-xs', 'text-neutral-300']">
          {{ t(`${KEY}.scope-note`, { team: scope.teamId }) }}
        </p>
        <p v-for="failure in model.layerErrors" :key="failure.layer" :class="['text-xs', 'text-red-300']">
          {{ t(`${KEY}.layer-error`, { layer: failure.layer, message: failure.message }) }}
        </p>
        <p v-for="layer in model.truncatedLayers" :key="layer" :class="['text-xs', 'text-neutral-300']">
          {{ t(`${KEY}.truncated`, { layer }) }}
        </p>
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
            :hue="themeHue"
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
        <div v-if="selected" :class="['flex flex-col', 'gap-2', 'max-h-80', 'overflow-y-auto', 'rounded-xl', 'bg-neutral-50 dark:bg-neutral-800/60', 'p-4']">
          <h2 :class="['text-sm font-medium']">
            {{ selected.kind === 'fact' ? t(`${KEY}.detail`) : layerLabel(selected.layer) }}
          </h2>
          <div v-if="selected.sections.length > 0" :class="['flex flex-col', 'gap-3']">
            <section v-for="section in selected.sections" :key="section.heading" :class="['flex flex-col', 'gap-1']">
              <h3 :class="['text-sm font-medium']">
                {{ section.heading }}
              </h3>
              <p :class="['text-sm', 'whitespace-pre-wrap break-words']">
                {{ section.body }}
              </p>
            </section>
          </div>
          <p v-else :class="['text-sm', 'whitespace-pre-wrap break-words']">
            {{ selected.body }}
          </p>
          <dl :class="['grid grid-cols-[7rem_minmax(0,1fr)]', 'gap-y-1', 'text-xs']">
            <dt :class="['text-neutral-500 dark:text-neutral-400']">
              {{ t(`${KEY}.card`) }}
            </dt>
            <dd :class="['break-words']">
              {{ cardName(selected.persona) }}
            </dd>
            <template v-if="selected.scope === 'team-agent' && scope">
              <dt :class="['text-neutral-500 dark:text-neutral-400']">
                {{ t(`${KEY}.scope`) }}
              </dt>
              <dd>{{ t(`${KEY}.scope-team`, { team: scope.teamId }) }}</dd>
            </template>
            <template v-if="selected.type">
              <dt :class="['text-neutral-500 dark:text-neutral-400']">
                {{ t(`${KEY}.type`) }}
              </dt>
              <dd>{{ typeLabel(selected.type) }}</dd>
            </template>
            <template v-if="selected.path">
              <dt :class="['text-neutral-500 dark:text-neutral-400']">
                {{ t(`${KEY}.path`) }}
              </dt>
              <dd :class="['break-words']">
                {{ selected.path }}
              </dd>
            </template>
            <template v-if="selected.summary">
              <dt :class="['text-neutral-500 dark:text-neutral-400']">
                {{ t(`${KEY}.summary`) }}
              </dt>
              <dd :class="['break-words']">
                {{ selected.summary }}
              </dd>
            </template>
            <template v-if="selected.background">
              <dt :class="['text-neutral-500 dark:text-neutral-400']">
                {{ t(`${KEY}.background`) }}
              </dt>
              <dd :class="['break-words']">
                {{ selected.background }}
              </dd>
            </template>
            <template v-if="selected.updatedAt !== undefined">
              <dt :class="['text-neutral-500 dark:text-neutral-400']">
                {{ t(`${KEY}.updated`) }}
              </dt>
              <dd>{{ new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(selected.updatedAt) }}</dd>
            </template>
            <template v-if="selected.kind === 'fact'">
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
            </template>
          </dl>
        </div>

        <h2 :class="['text-sm font-medium']">
          {{ t(`${KEY}.facts`) }}
        </h2>
        <p v-if="listNodes.length === 0" :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">
          {{ t(`${KEY}.list-empty`) }}
        </p>
        <ul v-else :class="['m-0 flex flex-col', 'gap-2', 'max-h-80', 'list-none', 'overflow-y-auto', 'p-0']">
          <li v-for="node in listNodes" :key="node.id">
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
              <span :class="['block', 'text-xs', 'text-neutral-500 dark:text-neutral-400']">{{ layerLabel(node.layer) }}</span>
            </button>
          </li>
        </ul>
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

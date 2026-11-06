<script setup lang="ts">
import type { Live2DParameterBinding, Live2DParameterChannel, Live2DParameterMappingLayer } from '@proj-airi/stage-ui-live2d'

import { live2dParameterChannels, resolveLive2DParameterRig, useLive2DParameterRig } from '@proj-airi/stage-ui-live2d'
import { Button, FieldInput, FieldSelect } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useAiriCardStore } from '../../../../stores/modules/airi-card'

const { t } = useI18n()
const airiCardStore = useAiriCardStore()
const { activeCardId, selectedAvatarModel } = storeToRefs(airiCardStore)
const parameterRig = useLive2DParameterRig()
const { catalog, testingChannel } = storeToRefs(parameterRig)

const channelLabel = computed<Record<Live2DParameterChannel, string>>(() => ({
  headAngleX: t('settings.live2d.parameters.mapping.channels.head-angle-x'),
  headAngleY: t('settings.live2d.parameters.mapping.channels.head-angle-y'),
  headAngleZ: t('settings.live2d.parameters.mapping.channels.head-angle-z'),
  bodyAngleX: t('settings.live2d.parameters.mapping.channels.body-angle-x'),
  bodyAngleY: t('settings.live2d.parameters.mapping.channels.body-angle-y'),
  bodyAngleZ: t('settings.live2d.parameters.mapping.channels.body-angle-z'),
  eyeBallX: t('settings.live2d.parameters.mapping.channels.eye-ball-x'),
  eyeBallY: t('settings.live2d.parameters.mapping.channels.eye-ball-y'),
  mouthOpen: t('settings.live2d.parameters.mapping.channels.mouth-open'),
  mouthForm: t('settings.live2d.parameters.mapping.channels.mouth-form'),
  breath: t('settings.live2d.parameters.mapping.channels.breath'),
}))

const layerLabel = computed<Record<Live2DParameterMappingLayer, string>>(() => ({
  card: t('settings.live2d.parameters.mapping.layer.card'),
  physics: t('settings.live2d.parameters.mapping.layer.physics'),
  name: t('settings.live2d.parameters.mapping.layer.name'),
  default: t('settings.live2d.parameters.mapping.layer.default'),
}))

const controls = computed(() => selectedAvatarModel.value?.type === 'live2d'
  ? selectedAvatarModel.value.config.controls
  : undefined)
const resolved = computed(() => resolveLive2DParameterRig(controls.value?.parameterMapping, catalog.value))
const skipMode = computed(() => {
  if (controls.value?.skipMouthOpen === true)
    return 'skip'
  if (controls.value?.skipMouthOpen === false)
    return 'drive'
  return 'auto'
})
const skipOptions = computed(() => [
  { value: 'auto', label: t('settings.live2d.parameters.mapping.skip-mouth.auto') },
  { value: 'skip', label: t('settings.live2d.parameters.mapping.skip-mouth.skip') },
  { value: 'drive', label: t('settings.live2d.parameters.mapping.skip-mouth.drive') },
])

function copyBinding(binding: Live2DParameterBinding): Live2DParameterBinding {
  return {
    paramId: binding.paramId,
    ...(binding.scale !== undefined ? { scale: binding.scale } : {}),
    ...(binding.offset !== undefined ? { offset: binding.offset } : {}),
  }
}

async function saveControls(patch: {
  parameterMapping?: NonNullable<typeof controls.value>['parameterMapping']
  skipMouthOpen?: boolean
  clearMapping?: boolean
  clearSkip?: boolean
}) {
  const avatar = selectedAvatarModel.value
  if (!avatar || avatar.type !== 'live2d')
    return

  const current = avatar.config.controls
  await airiCardStore.updateLive2DControlPolicy(activeCardId.value, avatar.id, {
    disabledExpressions: current.disabledExpressions,
    disabledMotions: current.disabledMotions,
    ...(patch.clearMapping ? {} : { parameterMapping: patch.parameterMapping ?? current.parameterMapping }),
    ...(patch.clearSkip ? {} : { skipMouthOpen: patch.skipMouthOpen ?? current.skipMouthOpen }),
  })
}

async function saveChannel(channel: Live2DParameterChannel, bindings: readonly Live2DParameterBinding[] | undefined) {
  const current = controls.value?.parameterMapping ?? {}
  const parameterMapping = { ...current }
  if (bindings)
    parameterMapping[channel] = bindings.map(copyBinding)
  else
    delete parameterMapping[channel]

  const hasChannel = live2dParameterChannels.some(item => parameterMapping[item])
  await saveControls(hasChannel
    ? { parameterMapping }
    : { clearMapping: true })
}

function drafts(channel: Live2DParameterChannel): Live2DParameterBinding[] {
  return resolved.value.channels[channel].bindings.map(copyBinding)
}

async function updateBinding(channel: Live2DParameterChannel, index: number, patch: Partial<Live2DParameterBinding>) {
  const next = drafts(channel)
  const current = next[index]
  if (!current)
    return
  const binding = { ...current, ...patch }
  if ('scale' in patch && patch.scale === undefined)
    delete binding.scale
  if ('offset' in patch && patch.offset === undefined)
    delete binding.offset
  next[index] = binding
  await saveChannel(channel, next)
}

function finiteNumber(value: string | number | undefined): number | undefined {
  if (value === undefined || value === '')
    return undefined
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : undefined
}

async function setSkipMode(mode: string | number | undefined) {
  if (mode === 'skip')
    await saveControls({ skipMouthOpen: true })
  else if (mode === 'drive')
    await saveControls({ skipMouthOpen: false })
  else
    await saveControls({ clearSkip: true })
}
</script>

<template>
  <div :class="['grid gap-3']">
    <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
      {{ t('settings.live2d.parameters.mapping.description') }}
    </p>
    <FieldSelect
      :model-value="skipMode"
      :label="t('settings.live2d.parameters.mapping.skip-mouth.title')"
      :description="t('settings.live2d.parameters.mapping.skip-mouth.description')"
      :options="skipOptions"
      layout="horizontal"
      @update:model-value="setSkipMode"
    />
    <div
      v-for="channel in live2dParameterChannels"
      :key="channel"
      :class="['grid gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-700']"
    >
      <div :class="['flex flex-wrap items-center gap-2']">
        <div :class="['text-sm font-medium']">
          {{ channelLabel[channel] }}
        </div>
        <div :class="['rounded-full px-2 py-0.5 text-xs text-neutral-500 dark:text-neutral-400']">
          {{ layerLabel[resolved.channels[channel].layer] }}
        </div>
        <Button
          size="sm"
          :disabled="testingChannel === channel"
          @click="parameterRig.testChannel(channel)"
        >
          {{ t('settings.live2d.parameters.mapping.actions.test') }}
        </Button>
        <Button
          v-if="resolved.channels[channel].layer === 'card'"
          size="sm"
          @click="saveChannel(channel, undefined)"
        >
          {{ t('settings.live2d.parameters.mapping.actions.reset') }}
        </Button>
      </div>
      <div
        v-for="(binding, index) in resolved.channels[channel].bindings"
        :key="`${channel}-${index}`"
        :class="[
          'grid gap-2',
          'md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_auto]',
        ]"
      >
        <FieldInput
          :model-value="binding.paramId"
          :label="t('settings.live2d.parameters.mapping.columns.parameter')"
          @update:model-value="updateBinding(channel, index, { paramId: String($event ?? '') })"
        />
        <FieldInput
          :model-value="binding.scale"
          type="number"
          :label="t('settings.live2d.parameters.mapping.columns.scale')"
          @update:model-value="updateBinding(channel, index, { scale: finiteNumber($event) })"
        />
        <FieldInput
          :model-value="binding.offset"
          type="number"
          :label="t('settings.live2d.parameters.mapping.columns.offset')"
          @update:model-value="updateBinding(channel, index, { offset: finiteNumber($event) })"
        />
        <Button
          size="sm"
          :aria-label="t('settings.live2d.parameters.mapping.actions.remove')"
          @click="saveChannel(channel, drafts(channel).filter((_, item) => item !== index))"
        >
          {{ t('settings.live2d.parameters.mapping.actions.remove') }}
        </Button>
      </div>
      <div>
        <Button
          size="sm"
          @click="saveChannel(channel, [...drafts(channel), { paramId: '' }])"
        >
          {{ t('settings.live2d.parameters.mapping.actions.add') }}
        </Button>
      </div>
    </div>
  </div>
</template>

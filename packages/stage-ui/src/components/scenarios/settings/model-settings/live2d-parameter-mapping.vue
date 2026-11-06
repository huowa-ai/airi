<script setup lang="ts">
import type { Live2DParameterBinding, Live2DParameterChannel, Live2DParameterMappingLayer } from '@proj-airi/stage-ui-live2d'

import { live2dParameterChannels, live2dProbeCacheFromMotions, live2dProbeCacheMatches, measureLive2DParameterMotions, openOffscreenLive2DProbeTarget, resolveLive2DParameterRig, useLive2DParameterRig } from '@proj-airi/stage-ui-live2d'
import { Button, FieldInput, FieldSelect } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { hashLive2DDisplayModel, useLive2DModelFileHash } from '../../../../composables/use-live2d-model-file-hash'
import { useDisplayModelsStore } from '../../../../stores/display-models'
import { useAiriCardStore } from '../../../../stores/modules/airi-card'

const { t } = useI18n()
const airiCardStore = useAiriCardStore()
const displayModels = useDisplayModelsStore()
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
  probe: t('settings.live2d.parameters.mapping.layer.probe'),
  structural: t('settings.live2d.parameters.mapping.layer.structural'),
  name: t('settings.live2d.parameters.mapping.layer.name'),
  default: t('settings.live2d.parameters.mapping.layer.default'),
}))

const controls = computed(() => selectedAvatarModel.value?.type === 'live2d'
  ? selectedAvatarModel.value.config.controls
  : undefined)
const modelHash = useLive2DModelFileHash(() => selectedAvatarModel.value?.displayModelId)
const detecting = ref(false)
const probeMatchesModel = computed(() => live2dProbeCacheMatches(modelHash.value, controls.value?.parameterProbe))
const resolved = computed(() => resolveLive2DParameterRig(controls.value?.parameterMapping, {
  ...catalog.value,
  modelHash: modelHash.value,
  parameterProbe: controls.value?.parameterProbe,
}))
const unusedParameters = computed(() => {
  if (!probeMatchesModel.value)
    return []
  const used = new Set(live2dParameterChannels.flatMap(channel => resolved.value.channels[channel].bindings.map(binding => binding.paramId)))
  return (controls.value?.parameterProbe?.unused ?? []).filter(parameter => !used.has(parameter.paramId))
})
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
  parameterProbe?: NonNullable<typeof controls.value>['parameterProbe']
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
    parameterProbe: patch.parameterProbe ?? current.parameterProbe,
    ...(patch.clearSkip ? {} : { skipMouthOpen: patch.skipMouthOpen ?? current.skipMouthOpen }),
  })
}

async function detectParameters() {
  const avatar = selectedAvatarModel.value
  if (!avatar || avatar.type !== 'live2d' || detecting.value)
    return
  const displayModel = await displayModels.getDisplayModel(avatar.displayModelId)
  if (!displayModel)
    return
  detecting.value = true
  try {
    const hash = modelHash.value ?? await hashLive2DDisplayModel(displayModel)
    if (live2dProbeCacheMatches(hash, avatar.config.controls.parameterProbe))
      return
    const target = await openOffscreenLive2DProbeTarget(displayModel.type === 'file' ? displayModel.file : displayModel.url)
    try {
      const motions = await measureLive2DParameterMotions(target, {
        afterEach: () => new Promise(resolve => setTimeout(resolve, 0)),
      })
      const cache = live2dProbeCacheFromMotions({
        ...catalog.value,
        modelHash: hash,
      }, motions, hash)
      await saveControls({ parameterProbe: cache })
    }
    finally {
      target.destroy()
    }
  }
  finally {
    detecting.value = false
  }
}

async function addUnusedParameter(parameter: { paramId: string, channel?: Live2DParameterChannel }) {
  const channel = parameter.channel ?? 'bodyAngleX'
  const next = drafts(channel).filter(binding => binding.paramId !== parameter.paramId)
  next.push({ paramId: parameter.paramId })
  await saveChannel(channel, next)
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
    <div :class="['flex flex-wrap items-center gap-2']">
      <Button
        size="sm"
        :disabled="detecting || probeMatchesModel"
        @click="detectParameters"
      >
        {{ detecting
          ? t('settings.live2d.parameters.mapping.detect.running')
          : t('settings.live2d.parameters.mapping.detect.action') }}
      </Button>
      <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ probeMatchesModel
          ? t('settings.live2d.parameters.mapping.detect.cached')
          : t('settings.live2d.parameters.mapping.detect.description') }}
      </p>
    </div>
    <div
      v-if="unusedParameters.length > 0"
      :class="['grid gap-2']"
    >
      <div :class="['text-sm font-medium']">
        {{ t('settings.live2d.parameters.mapping.unused.title') }}
      </div>
      <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ t('settings.live2d.parameters.mapping.unused.description') }}
      </p>
      <div
        v-for="parameter in unusedParameters"
        :key="parameter.paramId"
        :class="['flex flex-wrap items-center gap-2']"
      >
        <span :class="['text-sm']">{{ parameter.paramId }}</span>
        <Button
          size="sm"
          @click="addUnusedParameter(parameter)"
        >
          {{ t('settings.live2d.parameters.mapping.unused.add', {
            channel: parameter.channel
              ? channelLabel[parameter.channel]
              : channelLabel.bodyAngleX,
          }) }}
        </Button>
      </div>
    </div>
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

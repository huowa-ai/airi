<script setup lang="ts">
import type { TranscriptionProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import {
  ProviderSettingsContainer,
  ProviderSettingsLayout,
  TranscriptionPlayground,
} from '@proj-airi/stage-ui/components'
import { selectProviderMetadata } from '@proj-airi/stage-ui/libs'
import {
  VOLCENGINE_DOUBAO_TRANSCRIPTION_MODEL,
  VOLCENGINE_DOUBAO_TRANSCRIPTION_PROVIDER_ID,
} from '@proj-airi/stage-ui/libs/providers'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useHearingStore } from '@proj-airi/stage-ui/stores/modules/hearing'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { Callout } from '@proj-airi/ui'
import { computedAsync } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

const router = useRouter()
const { t } = useI18n()
const authStore = useAuthStore()
const hearingStore = useHearingStore()
const providersStore = useProviderStore()
const { isAuthenticated, needsLogin } = storeToRefs(authStore)

const providerId = VOLCENGINE_DOUBAO_TRANSCRIPTION_PROVIDER_ID
const providerMetadata = computedAsync(() => selectProviderMetadata(providersStore.getProviderDefinition(providerId), t, { id: providerId }))

function handleLogin() {
  needsLogin.value = true
}

onMounted(async () => {
  await providersStore.initializeProvider(providerId)
  if (authStore.isAuthenticated)
    await providersStore.forceProviderConfigured(providerId)
})

async function handleGenerateTranscription(file: File) {
  const provider = await providersStore.getProviderInstance<TranscriptionProviderWithExtraOptions<string, Record<string, unknown>>>(providerId)
  if (!provider)
    throw new Error('Failed to initialize Doubao hearing provider')

  return await hearingStore.transcription(
    providerId,
    provider,
    VOLCENGINE_DOUBAO_TRANSCRIPTION_MODEL,
    file,
    'json',
  )
}
</script>

<template>
  <ProviderSettingsLayout
    v-if="providerMetadata"
    :provider-name="providerMetadata.localizedName"
    :provider-icon-color="providerMetadata.iconColor"
    :on-back="() => router.back()"
  >
    <ProviderSettingsContainer>
      <div
        v-if="!isAuthenticated"
        :class="['flex flex-col gap-4']"
      >
        <Callout theme="primary">
          <template #label>
            {{ t('settings.pages.providers.provider.volcengine-doubao-transcription.title') }}
          </template>
          <div :class="['flex flex-col gap-3']">
            <p>{{ t('settings.dialogs.onboarding.loginPrompt') }}</p>
            <button
              type="button"
              :class="[
                'w-fit rounded-lg px-4 py-2 text-white',
                'bg-primary-500 transition-colors hover:bg-primary-600 active:scale-95',
              ]"
              @click="handleLogin"
            >
              {{ t('settings.dialogs.onboarding.loginAction') }}
            </button>
          </div>
        </Callout>
      </div>

      <div
        v-else
        :class="['flex flex-col gap-6']"
      >
        <p :class="['text-sm text-neutral-600 dark:text-neutral-300']">
          {{ t('settings.pages.providers.provider.volcengine-doubao-transcription.proxy-note') }}
        </p>
        <TranscriptionPlayground
          :generate-transcription="handleGenerateTranscription"
          :api-key-configured="true"
        />
      </div>
    </ProviderSettingsContainer>
  </ProviderSettingsLayout>
</template>

<route lang="yaml">
meta:
  layout: settings
  stageTransition:
    name: slide
</route>

<script setup lang="ts">
import type { VoiceInfo } from '@proj-airi/provider-inference'
import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import {
  ProviderSettingsContainer,
  ProviderSettingsLayout,
  SpeechPlayground,
} from '@proj-airi/stage-ui/components'
import { selectProviderMetadata } from '@proj-airi/stage-ui/libs'
import {
  VOLCENGINE_DOUBAO_SPEAKER,
  VOLCENGINE_DOUBAO_SPEECH_MODEL,
  VOLCENGINE_DOUBAO_SPEECH_PROVIDER_ID,
} from '@proj-airi/stage-ui/libs/providers'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
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
const speechStore = useSpeechStore()
const providersStore = useProviderStore()
const { isAuthenticated, needsLogin } = storeToRefs(authStore)

const providerId = VOLCENGINE_DOUBAO_SPEECH_PROVIDER_ID
const providerMetadata = computedAsync(() => selectProviderMetadata(providersStore.getProviderDefinition(providerId), t, { id: providerId }))

const availableVoices: VoiceInfo[] = [{
  id: VOLCENGINE_DOUBAO_SPEAKER,
  name: 'Doubao clone',
  provider: providerId,
  languages: [{ code: 'zh-CN', title: 'Chinese' }],
}]

function handleLogin() {
  needsLogin.value = true
}

onMounted(async () => {
  await providersStore.initializeProvider(providerId)
  if (authStore.isAuthenticated)
    await providersStore.forceProviderConfigured(providerId)
})

async function handleGenerateSpeech(input: string, voiceId: string, _useSSML: boolean) {
  const provider = await providersStore.getProviderInstance<SpeechProviderWithExtraOptions<string, Record<string, unknown>>>(providerId)
  if (!provider)
    throw new Error('Failed to initialize Doubao speech provider')

  return await speechStore.speech(provider, VOLCENGINE_DOUBAO_SPEECH_MODEL, input, voiceId, {})
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
            {{ t('settings.pages.providers.provider.volcengine-doubao-speech.title') }}
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
          {{ t('settings.pages.providers.provider.volcengine-doubao-speech.proxy-note') }}
        </p>
        <SpeechPlayground
          :available-voices="availableVoices"
          :generate-speech="handleGenerateSpeech"
          :api-key-configured="true"
          default-text="Hello. This is the Doubao voice clone."
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

<script setup lang="ts">
import { useMemoryStore } from '@proj-airi/stage-ui/stores/memory'
import { FieldCheckbox, FieldInput } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

const { t } = useI18n()
const {
  enabled,
  serviceEnabled,
  serviceEndpoint,
  serviceUserId,
  serviceApiKey,
  serviceId,
  serviceError,
  scope,
} = storeToRefs(useMemoryStore())
</script>

<template>
  <div :class="['flex flex-col', 'gap-4']">
    <div :class="['rounded-xl', 'bg-neutral-100 dark:bg-neutral-900', 'p-4']">
      <FieldCheckbox v-model="enabled" :label="t('settings.pages.modules.memory-long-term.enable')" :description="t('settings.pages.modules.memory-long-term.enable-description')" />
    </div>
    <div :class="['flex flex-col', 'gap-4', 'rounded-xl', 'bg-neutral-100 dark:bg-neutral-900', 'p-4']">
      <FieldCheckbox
        v-model="serviceEnabled"
        :label="t('settings.pages.modules.memory-long-term.service.enable')"
        :description="t('settings.pages.modules.memory-long-term.service.enable-description')"
      />
      <FieldInput
        v-model="serviceEndpoint"
        :label="t('settings.pages.modules.memory-long-term.service.endpoint')"
        :description="t('settings.pages.modules.memory-long-term.service.endpoint-description')"
        placeholder="http://127.0.0.1:8420"
      />
      <div v-if="scope" :class="['flex flex-col', 'gap-1']">
        <p :class="['text-sm font-medium']">
          {{ t('settings.pages.modules.memory-long-term.service.team') }}
        </p>
        <p :class="['text-sm', 'break-all']">
          {{ scope.teamId }}
        </p>
        <p :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">
          {{ t('settings.pages.modules.memory-long-term.service.team-description') }}
        </p>
      </div>
      <FieldInput
        v-model="serviceUserId"
        :label="t('settings.pages.modules.memory-long-term.service.user')"
        :description="t('settings.pages.modules.memory-long-term.service.user-description')"
      />
      <FieldInput
        v-model="serviceId"
        :label="t('settings.pages.modules.memory-long-term.service.service-id')"
        :description="t('settings.pages.modules.memory-long-term.service.service-id-description')"
      />
      <FieldInput
        v-model="serviceApiKey"
        type="password"
        autocomplete="off"
        :label="t('settings.pages.modules.memory-long-term.service.key')"
        :description="t('settings.pages.modules.memory-long-term.service.key-description')"
      />
      <p v-if="serviceError" :class="['text-sm', 'text-red-600 dark:text-red-400']">
        {{ serviceError }}
      </p>
    </div>
    <RouterLink
      to="/settings/modules/memory-long-term-recipes"
      :class="[
        'flex items-center',
        'gap-3',
        'rounded-lg',
        'bg-neutral-50 dark:bg-neutral-800',
        'p-4',
        'transition-colors',
        'hover:bg-neutral-100 dark:hover:bg-neutral-700',
      ]"
    >
      <div :class="['i-solar:book-bookmark-bold-duotone', 'text-2xl', 'text-primary-500 dark:text-primary-400']" />
      <div :class="['flex-1', 'flex flex-col', 'gap-1']">
        <span :class="['text-lg font-medium']">{{ t('settings.pages.modules.memory-long-term.recipes.entry.title') }}</span>
        <span :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">{{ t('settings.pages.modules.memory-long-term.recipes.entry.description') }}</span>
      </div>
      <div :class="['i-solar:alt-arrow-right-linear', 'text-neutral-400']" />
    </RouterLink>
    <RouterLink
      to="/settings/modules/memory-graph"
      :class="[
        'flex items-center',
        'gap-3',
        'rounded-lg',
        'bg-neutral-50 dark:bg-neutral-800',
        'p-4',
        'transition-colors',
        'hover:bg-neutral-100 dark:hover:bg-neutral-700',
      ]"
    >
      <div :class="['i-solar:share-circle-bold-duotone', 'text-2xl', 'text-primary-500 dark:text-primary-400']" />
      <div :class="['flex-1', 'flex flex-col', 'gap-1']">
        <span :class="['text-lg font-medium']">{{ t('settings.pages.modules.memory-long-term.graph.entry.title') }}</span>
        <span :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">{{ t('settings.pages.modules.memory-long-term.graph.entry.description') }}</span>
      </div>
      <div :class="['i-solar:alt-arrow-right-linear', 'text-neutral-400']" />
    </RouterLink>
    <RouterLink
      to="/settings/modules/memory-long-term-memories"
      :class="[
        'flex items-center',
        'gap-3',
        'rounded-lg',
        'bg-neutral-50 dark:bg-neutral-800',
        'p-4',
        'transition-colors',
        'hover:bg-neutral-100 dark:hover:bg-neutral-700',
      ]"
    >
      <div :class="['i-solar:notebook-bookmark-bold-duotone', 'text-2xl', 'text-primary-500 dark:text-primary-400']" />
      <div :class="['flex-1', 'flex flex-col', 'gap-1']">
        <span :class="['text-lg font-medium']">{{ t('settings.pages.modules.memory-long-term.memories.entry.title') }}</span>
        <span :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">{{ t('settings.pages.modules.memory-long-term.memories.entry.description') }}</span>
      </div>
      <div :class="['i-solar:alt-arrow-right-linear', 'text-neutral-400']" />
    </RouterLink>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.memory-long-term.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>

import { memoryServiceAddressError } from '@proj-airi/stage-ui/stores/memory'
import { useI18n } from 'vue-i18n'

/** Translates a memory-service error. Unknown text uses the generic failure. */
export function useMemoryServiceMessage() {
  const { t } = useI18n()

  return (error: string) => {
    if (error === memoryServiceAddressError)
      return t('settings.pages.modules.memory-long-term.service.address-missing')
    return t('settings.pages.modules.memory-long-term.service.request-failed')
  }
}

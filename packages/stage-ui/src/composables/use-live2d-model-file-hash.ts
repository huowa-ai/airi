import type { MaybeRefOrGetter } from 'vue'

import type { DisplayModel } from '../stores/display-models'

import { shallowRef, toValue, watch } from 'vue'

import { sha256Hex } from '../libs/file-transfer/transfer'
import { useDisplayModelsStore } from '../stores/display-models'

const hashes = new Map<string, Promise<string>>()

/** Hashes the model file bytes. The same id returns the same hash. */
export function hashLive2DDisplayModel(model: DisplayModel): Promise<string> {
  const cached = hashes.get(model.id)
  if (cached)
    return cached
  const pending = model.type === 'file'
    ? sha256Hex(model.file)
    : fetch(model.url).then(response => response.blob()).then(blob => sha256Hex(blob))
  hashes.set(model.id, pending)
  return pending
}

/** The file hash for the selected display model, or undefined while it loads. */
export function useLive2DModelFileHash(displayModelId: MaybeRefOrGetter<string | undefined>) {
  const hash = shallowRef<string>()
  const displayModels = useDisplayModelsStore()
  let token = 0

  watch(() => toValue(displayModelId), async (id) => {
    const current = ++token
    hash.value = undefined
    if (!id)
      return
    const model = await displayModels.getDisplayModel(id)
    if (!model || current !== token)
      return
    const next = await hashLive2DDisplayModel(model)
    if (current === token)
      hash.value = next
  }, { immediate: true })

  return hash
}

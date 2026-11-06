import type { Live2DParameterCatalog, Live2DParameterChannel, Live2DParameterProbe } from '../controls/parameter-mapping'

import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'

import { emptyLive2DParameterCatalog, sweepLive2DParameterChannel } from '../controls/parameter-mapping'

/** Broadcast name shared by the stage window and the settings window. */
export const live2dParameterCatalogChannel = 'airi-live2d-parameter-catalog'

/** A catalog message that can cross same-origin windows. */
export type Live2DCatalogBroadcast
  = | { type: 'catalog', modelId: string, catalog: Live2DParameterCatalog }
    | { type: 'request' }

/** What one window knows before it applies a broadcast. */
export interface Live2DCatalogWindowState {
  hasLocalCatalog: boolean
  modelId: string
  catalog: Live2DParameterCatalog
}

/**
 * Applies one catalog broadcast.
 *
 * A window that loaded the model keeps its catalog. A window with an empty
 * catalog, such as the settings window, takes the stage catalog.
 * `reply` means the caller should send its local catalog.
 */
export function catalogAfterBroadcast(
  state: Live2DCatalogWindowState,
  message: Live2DCatalogBroadcast,
): Live2DCatalogWindowState | 'reply' | undefined {
  if (message.type === 'request')
    return state.hasLocalCatalog ? 'reply' : undefined
  if (state.hasLocalCatalog)
    return undefined
  if (message.catalog.parameterIds.length === 0 && message.catalog.physicsInputIds.length === 0)
    return undefined
  return {
    hasLocalCatalog: false,
    modelId: message.modelId,
    catalog: message.catalog,
  }
}

/**
 * Runtime catalog and the settings test probe for the loaded Live2D model.
 *
 * The character card owns the mapping. This store holds the parameter ids and
 * physics inputs read from the model in this window. A window that has not
 * loaded the model takes the catalog from the window that has.
 */
export const useLive2DParameterRig = defineStore('live2d-parameter-rig', () => {
  const catalog = shallowRef<Live2DParameterCatalog>(emptyLive2DParameterCatalog)
  const probe = shallowRef<Live2DParameterProbe | undefined>(undefined)
  const testingChannel = ref<Live2DParameterChannel | undefined>(undefined)
  const modelId = ref('')
  let hasLocalCatalog = false
  let sweepToken = 0
  let channel: BroadcastChannel | undefined

  function windowState(): Live2DCatalogWindowState {
    return { hasLocalCatalog, modelId: modelId.value, catalog: catalog.value }
  }

  function postCatalog() {
    channel?.postMessage({
      type: 'catalog',
      modelId: modelId.value,
      catalog: catalog.value,
    } satisfies Live2DCatalogBroadcast)
  }

  function onMessage(event: MessageEvent<Live2DCatalogBroadcast>) {
    const message = event.data
    if (!message || typeof message !== 'object' || (message.type !== 'catalog' && message.type !== 'request'))
      return
    const next = catalogAfterBroadcast(windowState(), message)
    if (next === 'reply') {
      postCatalog()
      return
    }
    if (!next)
      return
    catalog.value = next.catalog
    modelId.value = next.modelId
  }

  function ensureChannel() {
    if (channel || typeof BroadcastChannel === 'undefined')
      return
    channel = new BroadcastChannel(live2dParameterCatalogChannel)
    channel.addEventListener('message', onMessage)
    channel.postMessage({ type: 'request' } satisfies Live2DCatalogBroadcast)
  }

  function publishCatalog(next: Live2DParameterCatalog, nextModelId = '') {
    ensureChannel()
    catalog.value = next
    modelId.value = nextModelId
    if (next.parameterIds.length === 0 && next.physicsInputIds.length === 0)
      return
    hasLocalCatalog = true
    postCatalog()
  }

  /** Sweeps one channel so the user can see which parameters move. */
  async function testChannel(nextChannel: Live2DParameterChannel) {
    const token = ++sweepToken
    testingChannel.value = nextChannel
    try {
      await sweepLive2DParameterChannel(nextChannel, (next) => {
        if (token === sweepToken)
          probe.value = next
      }, {
        active: () => token === sweepToken,
      })
    }
    finally {
      if (token === sweepToken)
        testingChannel.value = undefined
    }
  }

  ensureChannel()

  return {
    catalog,
    probe,
    testingChannel,
    modelId,
    publishCatalog,
    testChannel,
  }
})

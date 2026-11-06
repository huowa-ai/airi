import type { Live2DParameterCatalog, Live2DParameterChannel, Live2DParameterProbe } from '../controls/parameter-mapping'

import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'

import { emptyLive2DParameterCatalog, sweepLive2DParameterChannel } from '../controls/parameter-mapping'

/**
 * Runtime catalog and the settings test probe for the loaded Live2D model.
 *
 * The character card owns the mapping. This store holds the parameter ids and
 * physics inputs read from the model in this window, plus the value a test
 * sweep asks the renderer to hold.
 */
export const useLive2DParameterRig = defineStore('live2d-parameter-rig', () => {
  const catalog = shallowRef<Live2DParameterCatalog>(emptyLive2DParameterCatalog)
  const probe = shallowRef<Live2DParameterProbe | undefined>(undefined)
  const testingChannel = ref<Live2DParameterChannel | undefined>(undefined)
  let sweepToken = 0

  function publishCatalog(next: Live2DParameterCatalog) {
    catalog.value = next
  }

  /** Sweeps one channel so the user can see which parameters move. */
  async function testChannel(channel: Live2DParameterChannel) {
    const token = ++sweepToken
    testingChannel.value = channel
    try {
      await sweepLive2DParameterChannel(channel, (next) => {
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

  return {
    catalog,
    probe,
    testingChannel,
    publishCatalog,
    testChannel,
  }
})

import type { SettingsSearchModule } from '@proj-airi/stage-ui/libs/settings-search'

import { useMemoryStore } from '@proj-airi/stage-ui/stores/memory'

import { buildMemoryGraph } from './memory-graph-model'

/** The memory graph page. Search lists the same service facts the page draws. Those facts use the character card id. */
export default {
  routes: [{
    path: '/settings/modules/memory-graph',
    items: async () => {
      const memory = useMemoryStore()
      await memory.ready()
      return buildMemoryGraph({
        serviceRead: memory.serviceRead,
        serviceError: memory.serviceError,
        facts: memory.listFacts(),
      }).nodes.map(node => ({ title: node.label, key: node.id }))
    },
  }],
} satisfies SettingsSearchModule

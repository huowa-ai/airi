import type { MemoryStorage } from '@proj-airi/tencentdb-memory'

import type { MemoryEntry, MemoryWrite } from '../types/memory'

import { errorMessageFrom } from '@moeru/std'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { createMemoryClient, createRemoteMemoryStorage, GENERAL_AGENT_ID, memoryClientEnv, readMemoryClientConfig } from '@proj-airi/tencentdb-memory'
import { useBroadcastChannel } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

const serviceOffMessage = 'The memory service is off.'
const serviceConfigMessage = 'Set the service address, the team id, and the user id.'

/**
 * Long-term memory as a small index and one entry per fact, kept by the character itself.
 * MemoryCore is the only store this module calls. A service that is off or unreachable leaves the index empty.
 *
 * Use when:
 * - A run reads the index or an entry, writes or forgets a fact, or Settings lists the memories by card.
 *
 * Expects:
 * - Callers pass the character card of the run. It reads its own memories and the general ones.
 * - Only the owner makes a memory general, in Settings. A run writes and forgets only its own card's memories.
 *
 * Returns:
 * - Whether memory is on, entries, `ready` for the first read, the index for a card, and actions that change entries.
 */
export const useMemoryStore = defineStore('memory', () => {
  const enabled = useLocalStorageManualReset<boolean>('memory/enabled', true)
  const serviceEnabled = useLocalStorageManualReset<boolean>('memory/service-enabled', false)
  const serviceEndpoint = useLocalStorageManualReset('memory/service-endpoint', '')
  const serviceTeamId = useLocalStorageManualReset('memory/service-team-id', '')
  const serviceUserId = useLocalStorageManualReset('memory/service-user-id', '')
  const serviceApiKey = useLocalStorageManualReset('memory/service-api-key', '')
  const serviceId = useLocalStorageManualReset('memory/service-id', '')
  const serviceError = ref(serviceOffMessage)
  const entries = ref<MemoryEntry[]>([])
  let remote: MemoryStorage | undefined

  function connectService() {
    if (!serviceEnabled.value) {
      remote = undefined
      entries.value = []
      serviceError.value = serviceOffMessage
      return
    }

    const config = readMemoryClientConfig({
      [memoryClientEnv.endpoint]: serviceEndpoint.value,
      [memoryClientEnv.teamId]: serviceTeamId.value,
      [memoryClientEnv.userId]: serviceUserId.value,
      [memoryClientEnv.agentId]: GENERAL_AGENT_ID,
      [memoryClientEnv.apiKey]: serviceApiKey.value,
      [memoryClientEnv.serviceId]: serviceId.value,
    })
    if (!config.configured) {
      remote = undefined
      entries.value = []
      serviceError.value = serviceConfigMessage
      return
    }

    remote = createRemoteMemoryStorage(createMemoryClient(config.config))
    serviceError.value = ''
  }
  const { data: changed, post } = useBroadcastChannel<string[], string[]>({ name: 'airi:memory' })
  let pendingLoad = Promise.resolve()

  /** Reads the entries again, after the reads that started before. */
  function load() {
    pendingLoad = pendingLoad.catch(() => {}).then(async () => {
      if (!remote) {
        entries.value = []
        return
      }
      try {
        entries.value = await remote.list()
        serviceError.value = ''
      }
      catch (error) {
        entries.value = []
        serviceError.value = publicServiceError(error)
      }
    })
    return pendingLoad
  }

  /**
   * Resolves after every read that started before the call, the first read included.
   * Until then, `entries` is empty because nothing is read yet, not because nothing is remembered.
   */
  function ready() {
    return pendingLoad.catch(() => {})
  }

  /** Reads the entries again after a change, and tells the other windows. */
  async function publish(ids: string[]) {
    await load()
    post(ids)
  }

  /**
   * The index for a card: its own memories, then general ones, each as an id and its description.
   * A run reads it when it starts, from the entries that the window read last.
   */
  function indexFor(personaId: string) {
    const line = (entry: MemoryEntry) => `- ${entry.id}: ${entry.description}`
    const own = entries.value.filter(entry => entry.persona === personaId).map(line)
    const general = entries.value.filter(entry => !entry.persona).map(line)
    return [
      ...(own.length ? [`Your own:\n${own.join('\n')}`] : []),
      ...(general.length ? [`General:\n${general.join('\n')}`] : []),
    ].join('\n')
  }

  /** Reads an entry that the persona can see by its id: one of its own, or a general one. */
  function read(id: string, personaId: string) {
    return entries.value.find(entry => entry.id === id && (!entry.persona || entry.persona === personaId))
  }

  /**
   * Saves a fact on the card. An id of the card's own entry replaces that entry. Any other id, for example of a general
   * entry that only the owner changes, adds a new entry. Resolves to the stored entry, or undefined for an empty body.
   */
  async function write(input: MemoryWrite, personaId: string) {
    const body = input.body.trim()
    if (!body)
      return undefined
    if (!remote) {
      serviceError.value = serviceEnabled.value ? serviceConfigMessage : serviceOffMessage
      return undefined
    }
    try {
      const result = await remote.write({ id: input.id, description: input.description.trim(), body }, personaId, Date.now())
      if (result.outcome === 'empty')
        return undefined
      if (result.outcome !== 'saved' && result.outcome !== 'unchanged') {
        await publish([])
        return undefined
      }
      await publish([result.entry.id])
      return result.entry
    }
    catch (error) {
      serviceError.value = publicServiceError(error)
      entries.value = []
      return undefined
    }
  }

  /** Makes a card's memory general, so every card reads it. */
  async function makeGeneral(entry: Pick<MemoryEntry, 'id'>) {
    if (!remote) {
      serviceError.value = serviceEnabled.value ? serviceConfigMessage : serviceOffMessage
      return
    }
    try {
      const result = await remote.makeGeneral(entry.id, Date.now())
      if (result.outcome === 'saved')
        await publish([entry.id])
    }
    catch (error) {
      serviceError.value = publicServiceError(error)
      entries.value = []
    }
  }

  /** Removes one entry from Settings. */
  async function remove(entry: Pick<MemoryEntry, 'id'>) {
    if (!remote) {
      serviceError.value = serviceEnabled.value ? serviceConfigMessage : serviceOffMessage
      return
    }
    try {
      await remote.remove([entry.id], Date.now())
      await publish([entry.id])
    }
    catch (error) {
      serviceError.value = publicServiceError(error)
      entries.value = []
    }
  }

  /** Forgets an entry of the card by its id. General memories belong to the owner, so a run cannot forget them. */
  async function forget(id: string, personaId: string) {
    if (!remote) {
      serviceError.value = serviceEnabled.value ? serviceConfigMessage : serviceOffMessage
      return false
    }
    try {
      const forgot = await remote.forget(id, personaId, Date.now())
      if (forgot)
        await publish([id])
      return forgot
    }
    catch (error) {
      serviceError.value = publicServiceError(error)
      entries.value = []
      return false
    }
  }

  async function resetState() {
    enabled.reset()
    if (remote) {
      try {
        await remote.clear(Date.now())
      }
      catch (error) {
        serviceError.value = publicServiceError(error)
      }
    }
    serviceEnabled.reset()
    remote = undefined
    entries.value = []
    serviceError.value = serviceOffMessage
    await publish([])
  }

  function reload() {
    void load().catch(error => console.warn('[memory] Failed to read the entries:', errorMessageFrom(error)))
  }
  watch(changed, reload)
  watch([serviceEnabled, serviceEndpoint, serviceTeamId, serviceUserId, serviceApiKey, serviceId], () => {
    connectService()
    reload()
  })
  connectService()
  reload()

  return {
    enabled,
    serviceEnabled,
    serviceEndpoint,
    serviceTeamId,
    serviceUserId,
    serviceApiKey,
    serviceId,
    serviceError,
    entries: computed(() => entries.value),
    ready,
    indexFor,
    read,
    write,
    makeGeneral,
    forget,
    remove,
    resetState,
  }
})

function publicServiceError(error: unknown) {
  const message = errorMessageFrom(error) ?? 'The memory service request failed.'
  return message.includes('://') ? 'The memory service request failed.' : message
}

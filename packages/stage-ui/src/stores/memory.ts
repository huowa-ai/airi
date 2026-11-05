import type { MemoryStorage } from '@proj-airi/tencentdb-memory'

import type { MemoryEntry, MemoryWrite } from '../types/memory'

import { errorMessageFrom } from '@moeru/std'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { createMemoryClient, createRemoteMemoryStorage, GENERAL_AGENT_ID, memoryClientEnv, readMemoryClientConfig } from '@proj-airi/tencentdb-memory'
import { useBroadcastChannel } from '@vueuse/core'
import { defineStore } from 'pinia'
import { v7 as uuidv7 } from 'uuid'
import { computed, ref, watch } from 'vue'

import { memoryRepo } from '../database/repos/memory.repo'

const LEGACY_ENTRIES_STORAGE_KEY = 'memory/entries'

// NOTICE:
// v0.13.1 kept entries in localStorage under `memory/entries`, keyed by a model-chosen name.
// Two facts could share a name. IndexedDB stores them now, with store-made ids.
// The lock stops two windows that start together from moving the same entries twice.
// Removal condition: two releases after the release that moves them.
async function moveLegacyEntries() {
  if (!globalThis.localStorage?.getItem(LEGACY_ENTRIES_STORAGE_KEY))
    return
  await navigator.locks.request('airi:memory-move', async () => {
    const stored = localStorage.getItem(LEGACY_ENTRIES_STORAGE_KEY)
    if (!stored)
      return
    const legacy: (Omit<MemoryEntry, 'id'> & { name: string })[] = JSON.parse(stored)
    await memoryRepo.add(legacy.map(({ description, body, persona, updatedAt }) => ({ id: uuidv7(), description, body, persona, updatedAt })))
    localStorage.removeItem(LEGACY_ENTRIES_STORAGE_KEY)
  })
}

/**
 * Long-term memory as a small index and one entry per fact, kept by the character itself.
 * IndexedDB keeps the entries. After each change, the other windows read them again.
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
  const serviceError = ref('')
  const entries = ref<MemoryEntry[]>([])
  let remote: MemoryStorage | undefined

  function connectService() {
    if (!serviceEnabled.value) {
      remote = undefined
      serviceError.value = ''
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
      serviceError.value = 'Set the service address, the team id, and the user id.'
      return
    }

    remote = createRemoteMemoryStorage(createMemoryClient(config.config))
    serviceError.value = ''
  }
  const { data: changed, post } = useBroadcastChannel<string[], string[]>({ name: 'airi:memory' })
  let pendingLoad = moveLegacyEntries()
    .catch(error => console.warn('[memory] Failed to move the entries from localStorage:', errorMessageFrom(error)))

  /** Reads the entries again, after the reads that started before. */
  function load() {
    pendingLoad = pendingLoad.catch(() => {}).then(async () => {
      if (!serviceEnabled.value) {
        entries.value = await memoryRepo.list()
        return
      }
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
   * Resolves after every read that started before the call, the first read and the move from localStorage included.
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
    if (serviceEnabled.value) {
      if (!remote) {
        serviceError.value = 'Set the service address, the team id, and the user id.'
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
        return undefined
      }
    }
    const entry = await memoryRepo.write({ id: input.id, description: input.description.trim(), body }, personaId, Date.now())
    await publish([entry.id])
    return entry
  }

  /** Makes a card's memory general, so every card reads it. */
  async function makeGeneral(entry: Pick<MemoryEntry, 'id'>) {
    if (serviceEnabled.value) {
      if (!remote)
        return
      try {
        const result = await remote.makeGeneral(entry.id, Date.now())
        if (result.outcome === 'saved')
          await publish([entry.id])
      }
      catch (error) {
        serviceError.value = publicServiceError(error)
      }
      return
    }
    if (await memoryRepo.makeGeneral(entry.id, Date.now()))
      await publish([entry.id])
  }

  /** Removes one entry from Settings. */
  async function remove(entry: Pick<MemoryEntry, 'id'>) {
    if (serviceEnabled.value) {
      if (!remote)
        return
      try {
        await remote.remove([entry.id], Date.now())
        await publish([entry.id])
      }
      catch (error) {
        serviceError.value = publicServiceError(error)
      }
      return
    }
    await memoryRepo.remove([entry.id], Date.now())
    await publish([entry.id])
  }

  /** Forgets an entry of the card by its id. General memories belong to the owner, so a run cannot forget them. */
  async function forget(id: string, personaId: string) {
    if (serviceEnabled.value) {
      if (!remote)
        return false
      try {
        const forgot = await remote.forget(id, personaId, Date.now())
        if (forgot)
          await publish([id])
        return forgot
      }
      catch (error) {
        serviceError.value = publicServiceError(error)
        return false
      }
    }
    if (!await memoryRepo.forget(id, personaId, Date.now()))
      return false
    await publish([id])
    return true
  }

  async function resetState() {
    enabled.reset()
    if (remote)
      await remote.clear(Date.now()).catch(() => {})
    serviceEnabled.reset()
    remote = undefined
    await memoryRepo.clear()
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

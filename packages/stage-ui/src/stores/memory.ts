import type { CallTurnRecord, IdentityLink, IdentityMap, MemoryScope, MemoryScopeRequest, MemoryStorage, MemoryV3Client, RecallHit, WriteOutboxState } from '@proj-airi/tencentdb-memory'

import type { MemoryEntry, MemoryWrite } from '../types/memory'
import type { ChatTurnRecord } from './chat-turn-memory'
import type { MemoryCallTurn } from './memory-layers'

import { errorMessageFrom } from '@moeru/std'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { agentIdForEntry, bindMemoryScope, confirmIdentityLink, conversationContentHash, createChatTurnQueue, createMemoryClient, createRecallBuffer, createRemoteMemoryStorage, createWriteOutbox, defaultRecallBudget, deleteExactMessages, deleteLayerRecord, deliverConversation, formatRecall, GENERAL_AGENT_ID, isForgetPhrase, localScopeSessionId, memoryClientEnv, mergeRecall, parseSceneBinding, readCallTurns, readIdentityMap, readMemoryClientConfig, readMemoryLayers, resolveLocalAccountId, resolveMemoryScope, sanitizeScopeId } from '@proj-airi/tencentdb-memory'
import { useBroadcastChannel } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { EMPTY_MEMORY_LAYERS, viewCallTurn, viewMemoryLayers } from './memory-layers'

const serviceConfigError = 'Set the service address.'

/** The live list is empty until a MemoryCore read for this service identity succeeds. */
const NO_ENTRIES: MemoryEntry[] = []

/** What the last MemoryCore read did. `off` and `error` leave the live list empty. */
export type MemoryServiceRead = 'off' | 'loading' | 'error' | 'ready'

/**
 * Long-term memory as a small index and one entry per fact, kept by the character itself.
 * The live list is the MemoryCore service for the local private scope. The device repository is not on this path.
 * After each change, the other windows read the service again.
 *
 * Use when:
 * - A run reads the index or an entry, writes or forgets a fact, or Settings lists the memories by card.
 *
 * Expects:
 * - Callers pass the character card of the run. It reads its own memories and the general ones.
 * - Only the owner makes a memory general, in Settings. A run writes and forgets only its own card's memories.
 * - The service is on and configured. Otherwise the live list stays empty.
 *
 * Returns:
 * - Whether memory is on, the service read state, entries, `ready` for the first read, the index for a card, and actions that change entries.
 */
export const useMemoryStore = defineStore('memory', () => {
  const enabled = useLocalStorageManualReset<boolean>('memory/enabled', true)
  const serviceEnabled = useLocalStorageManualReset<boolean>('memory/service-enabled', false)
  const serviceEndpoint = useLocalStorageManualReset('memory/service-endpoint', '')
  const serviceTeamId = useLocalStorageManualReset('memory/service-team-id', '')
  const serviceUserId = useLocalStorageManualReset('memory/service-user-id', '')
  const serviceApiKey = useLocalStorageManualReset('memory/service-api-key', '')
  const serviceId = useLocalStorageManualReset('memory/service-id', '')
  const localAccountId = useLocalStorageManualReset('memory/local-account-id', '')
  const identityMap = useLocalStorageManualReset<IdentityMap>('memory/identity-map', { links: [] })
  const serviceError = ref('')
  const serviceRead = ref<MemoryServiceRead>('loading')
  const entries = ref<MemoryEntry[]>(NO_ENTRIES)
  const layers = ref(EMPTY_MEMORY_LAYERS)
  const callTurns = ref<MemoryCallTurn[]>([])
  const knownAgents = new Set<string>()
  let turnGeneration = 0
  let remote: MemoryStorage | undefined
  let memoryClient: MemoryV3Client | undefined
  const storages = new Map<string, MemoryStorage>()
  const scopedFacts = new Map<string, MemoryEntry[]>()
  let serviceGeneration = 0
  const buffer = createRecallBuffer()
  const recallBlocks = new Map<string, string>()
  const outbox = createWriteOutbox({
    load: readWriteOutbox,
    save: writeOutbox,
  })
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  const chatTurns = createChatTurnQueue({
    onError: (error) => {
      console.warn('[memory] Chat turn was not stored.', errorMessageFrom(error) ?? '')
    },
    onSettled: (event) => {
      const place = { teamId: event.input.teamId, userId: event.input.userId }
      if (event.ok) {
        buffer.attach(event.input.turnId, event.input.sessionId, event.ids, place)
        outbox.succeeded(event.input.turnId)
        void refreshCallTurns()
        return
      }
      outbox.add({
        turnId: event.input.turnId,
        agentId: event.prepared.agentId ?? event.input.agentId,
        sessionId: event.prepared.sessionId,
        teamId: event.input.teamId,
        userId: event.input.userId,
        contentHash: conversationContentHash(event.prepared.messages),
        messages: event.prepared.messages,
      })
      scheduleRetry()
    },
  })

  function clearLiveEntries() {
    entries.value = NO_ENTRIES
  }

  function storedIdentityMap() {
    return readIdentityMap(identityMap.value)
  }

  function syncAccountId() {
    const resolved = resolveLocalAccountId({
      settingsUserId: serviceUserId.value,
      storedAccountId: localAccountId.value,
      createId: () => crypto.randomUUID(),
    })
    if (resolved.storedAccountId !== undefined && localAccountId.value !== resolved.storedAccountId)
      localAccountId.value = resolved.storedAccountId
    return resolved.accountId
  }

  function localScope(): MemoryScope {
    return resolveMemoryScope({
      platform: 'local',
      userId: syncAccountId(),
      sessionId: localScopeSessionId,
      identityMap: storedIdentityMap(),
    })
  }

  function resolveRequest(request?: MemoryScopeRequest) {
    if (!request)
      return localScope()
    return resolveMemoryScope({
      ...request,
      userId: request.userId || syncAccountId(),
      identityMap: request.identityMap ?? storedIdentityMap(),
    })
  }

  function scopeKey(scope: MemoryScope) {
    return `${scope.teamId}\0${scope.userId}`
  }

  function sameScope(left: MemoryScope, right: MemoryScope) {
    return left.teamId === right.teamId && left.userId === right.userId
  }

  function storageFor(scope: MemoryScope) {
    const client = memoryClient
    if (!client)
      return undefined
    const key = scopeKey(scope)
    const existing = storages.get(key)
    if (existing)
      return existing
    const created = createRemoteMemoryStorage(bindMemoryScope(client, scope))
    storages.set(key, created)
    return created
  }

  function factsFor(scope: MemoryScope) {
    if (sameScope(scope, localScope()))
      return entries.value
    return scopedFacts.get(scopeKey(scope)) ?? NO_ENTRIES
  }

  function connectService() {
    serviceGeneration += 1
    storages.clear()
    scopedFacts.clear()
    clearLiveEntries()
    layers.value = EMPTY_MEMORY_LAYERS
    callTurns.value = []
    if (!serviceEnabled.value) {
      remote = undefined
      memoryClient = undefined
      serviceError.value = ''
      serviceRead.value = 'off'
      return
    }

    const scope = localScope()
    const config = readMemoryClientConfig({
      [memoryClientEnv.endpoint]: serviceEndpoint.value,
      [memoryClientEnv.teamId]: scope.teamId,
      [memoryClientEnv.userId]: scope.userId,
      [memoryClientEnv.agentId]: GENERAL_AGENT_ID,
      [memoryClientEnv.apiKey]: serviceApiKey.value,
      [memoryClientEnv.serviceId]: serviceId.value,
    })
    if (!config.configured) {
      remote = undefined
      memoryClient = undefined
      serviceError.value = serviceConfigError
      serviceRead.value = 'error'
      return
    }

    memoryClient = createMemoryClient(config.config)
    remote = createRemoteMemoryStorage(memoryClient)
    storages.set(scopeKey(scope), remote)
    serviceError.value = ''
    serviceRead.value = 'loading'
    scheduleRetry()
  }
  const { data: changed, post } = useBroadcastChannel<string[], string[]>({ name: 'airi:memory' })
  let pendingLoad = Promise.resolve()

  /** Reads the service again, after the reads that started before. A stopped or failed service leaves the list empty. */
  function load() {
    const generation = serviceGeneration
    const client = remote
    const raw = memoryClient
    pendingLoad = pendingLoad.catch(() => {}).then(async () => {
      if (generation !== serviceGeneration)
        return
      if (!serviceEnabled.value || !client || !raw) {
        clearLiveEntries()
        layers.value = EMPTY_MEMORY_LAYERS
        callTurns.value = []
        serviceRead.value = serviceEnabled.value ? 'error' : 'off'
        return
      }
      const turnRead = ++turnGeneration
      const [listed, snapshot, turns] = await Promise.all([
        client.list().then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error })),
        readMemoryLayers(raw),
        readCallTurns(raw, [...knownAgents]).then(value => ({ ok: true as const, value }), () => ({ ok: false as const, value: [] as CallTurnRecord[] })),
      ])
      if (generation !== serviceGeneration)
        return
      layers.value = viewMemoryLayers(snapshot)
      if (turnRead === turnGeneration)
        callTurns.value = turns.value.map(viewCallTurn)
      if (listed.ok) {
        entries.value = listed.value
        serviceError.value = ''
      }
      else {
        clearLiveEntries()
        serviceError.value = publicServiceError(listed.error)
      }
      const layerCount = layers.value.atoms.items.length + layers.value.scenes.items.length + layers.value.cores.items.length
      serviceRead.value = !listed.ok && layerCount === 0 ? 'error' : 'ready'
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

  /** Reads one scope again after a change, and tells the other windows. */
  async function publish(scope: MemoryScope, ids: string[]) {
    if (sameScope(scope, localScope()))
      await load()
    else
      await refreshScopedFacts(scope)
    post(ids)
  }

  async function refreshScopedFacts(scope: MemoryScope) {
    const storage = storageFor(scope)
    if (!storage)
      return
    scopedFacts.set(scopeKey(scope), await storage.list())
  }

  function failScope(scope: MemoryScope, error: unknown) {
    if (!sameScope(scope, localScope()))
      return
    serviceError.value = publicServiceError(error)
    serviceRead.value = 'error'
    clearLiveEntries()
  }

  /** Loads the fact list for one scope before a prompt reads it. A group read never copies the private list. */
  async function prepareScope(request?: MemoryScopeRequest) {
    const scope = resolveRequest(request)
    if (sameScope(scope, localScope())) {
      await load()
      return
    }
    try {
      await refreshScopedFacts(scope)
    }
    catch {
      // A failed group read keeps the last group list. It does not show private facts.
    }
  }

  function requestForSession(input: { sessionId: string, personaId?: string, binding?: string, speakerId?: string }): MemoryScopeRequest {
    const scene = input.binding ? parseSceneBinding(input.binding) : undefined
    return {
      platform: scene?.platform ?? 'local',
      userId: input.speakerId || syncAccountId(),
      ...(scene ? { groupId: scene.groupId } : {}),
      personaId: input.personaId,
      sessionId: input.sessionId,
      identityMap: storedIdentityMap(),
    }
  }

  function confirmIdentities(link: IdentityLink) {
    identityMap.value = confirmIdentityLink(storedIdentityMap(), link, true)
  }

  /**
   * The index for a card: its own memories, then general ones, each as an id and its description.
   * A run reads it when it starts, from the entries that the window read last.
   */
  function indexFor(personaId: string, request?: MemoryScopeRequest) {
    const list = factsFor(resolveRequest(request))
    const line = (entry: MemoryEntry) => `- ${entry.id}: ${entry.description}`
    const own = list.filter(entry => entry.persona === personaId).map(line)
    const general = list.filter(entry => !entry.persona).map(line)
    return [
      ...(own.length ? [`Your own:\n${own.join('\n')}`] : []),
      ...(general.length ? [`General:\n${general.join('\n')}`] : []),
    ].join('\n')
  }

  /**
   * The live MemoryCore facts for this team and user.
   * Each fact is L0 on the character card, in session `airi:facts`. Chat turns use that same card id.
   * Empty when the service is off, the read is still running, or the read failed.
   * Callers must not replace this list with device facts or example facts.
   */
  function listFacts() {
    if (serviceRead.value !== 'ready')
      return NO_ENTRIES
    return entries.value
  }

  /** Reads an entry that the persona can see by its id: one of its own, or a general one. */
  function read(id: string, personaId: string, request?: MemoryScopeRequest) {
    return factsFor(resolveRequest(request)).find(entry => entry.id === id && (!entry.persona || entry.persona === personaId))
  }

  /**
   * Saves a fact on the card through the memory service.
   * An id of the card's own entry replaces that entry. Any other id, for example of a general
   * entry that only the owner changes, adds a new entry.
   * Resolves to the stored entry, or undefined when the body is empty or the service is not available.
   */
  async function write(input: MemoryWrite, personaId: string, request?: MemoryScopeRequest) {
    const body = input.body.trim()
    if (!body)
      return undefined
    const scope = resolveRequest(request)
    const storage = storageFor(scope)
    if (!storage) {
      if (serviceEnabled.value && serviceError.value === '')
        serviceError.value = serviceConfigError
      return undefined
    }
    try {
      const result = await storage.write({ id: input.id, description: input.description.trim(), body }, personaId, Date.now())
      if (result.outcome === 'empty')
        return undefined
      if (result.outcome !== 'saved' && result.outcome !== 'unchanged') {
        await publish(scope, [])
        return undefined
      }
      await publish(scope, [result.entry.id])
      return result.entry
    }
    catch (error) {
      failScope(scope, error)
      return undefined
    }
  }

  /** Makes a card's memory general, so every card reads it. */
  async function makeGeneral(entry: Pick<MemoryEntry, 'id'>, request?: MemoryScopeRequest) {
    const scope = resolveRequest(request)
    const storage = storageFor(scope)
    if (!storage)
      return
    try {
      const result = await storage.makeGeneral(entry.id, Date.now())
      if (result.outcome === 'saved')
        await publish(scope, [entry.id])
    }
    catch (error) {
      failScope(scope, error)
    }
  }

  /** Removes one entry from Settings. */
  async function remove(entry: Pick<MemoryEntry, 'id'>, request?: MemoryScopeRequest) {
    const scope = resolveRequest(request)
    const storage = storageFor(scope)
    if (!storage)
      return
    try {
      await storage.remove([entry.id], Date.now())
      await publish(scope, [entry.id])
    }
    catch (error) {
      failScope(scope, error)
    }
  }

  function scopeForTurn(input: ChatTurnRecord) {
    return resolveRequest(requestForSession({
      sessionId: input.sessionId,
      personaId: input.personaId,
      binding: input.binding,
      speakerId: input.speakerId,
    }))
  }

  /**
   * Queues one finished chat turn as L0 on the chat agent.
   * The call returns before MemoryCore answers. A write failure does not change the fact list.
   * Nothing is queued when memory is off or the service client is missing.
   */
  function recordChatTurn(input: ChatTurnRecord) {
    if (isForgetPhrase(input.userText)) {
      void forgetLatest(input)
      return false
    }
    const client = memoryClient
    if (!enabled.value || !client || outbox.isDone(input.turnId))
      return false
    const scope = scopeForTurn(input)
    knownAgents.add(scope.agentId)
    const queued = chatTurns.enqueue(bindMemoryScope(client, scope), {
      sessionId: scope.sessionId,
      turnId: input.turnId,
      agentId: scope.agentId,
      teamId: scope.teamId,
      userId: scope.userId,
      userText: input.userText,
      assistantText: input.assistantText,
      imageOnly: input.imageOnly,
      systemPrompt: input.systemPrompt,
      timestamp: input.timestamp,
      interrupted: input.interrupted,
      failed: input.failed,
      ...(input.callId ? { callId: input.callId } : {}),
      ...(input.source ? { source: input.source } : {}),
    })
    if (!queued)
      return false
    const at = Date.parse(input.timestamp)
    buffer.note({
      turnId: input.turnId,
      agentId: scope.agentId,
      sessionId: scope.sessionId,
      teamId: scope.teamId,
      userId: scope.userId,
      text: `${input.userText}\n${input.assistantText}`,
      at: Number.isFinite(at) ? at : Date.now(),
      messageIds: [],
    })
    return true
  }

  /**
   * Recall for the next prompt. Recent turns fill the gap until search returns the same text.
   * A search failure still keeps the recent turns. The call does not throw.
   */
  async function prepareRecall(input: { sessionId: string, personaId: string, query: string, binding?: string, speakerId?: string }) {
    const scope = resolveRequest(requestForSession(input))
    const place = { teamId: scope.teamId, userId: scope.userId }
    const recent = buffer.list(scope.agentId, scope.sessionId, place)
    const remote = await searchRecall(input.query, scope)
    const hits = mergeRecall({ query: input.query, remote, recent, budget: defaultRecallBudget })
    const text = formatRecall(hits)
    if (text)
      recallBlocks.set(scope.sessionId, text)
    else
      recallBlocks.delete(scope.sessionId)
    return hits
  }

  function recallBlock(sessionId: string) {
    return recallBlocks.get(sessionId) ?? ''
  }

  /**
   * Adds character cards that the next L0 read must include.
   * A card with no manual fact is still absent from the directory.
   */
  function includeCallAgents(agentIds: readonly string[]) {
    let added = false
    for (const agentId of agentIds) {
      const id = agentId.trim()
      if (!id || knownAgents.has(id))
        continue
      knownAgents.add(id)
      added = true
    }
    if (added)
      void refreshCallTurns()
  }

  async function refreshCallTurns() {
    const generation = ++turnGeneration
    const client = memoryClient
    if (!serviceEnabled.value || !client) {
      callTurns.value = []
      return
    }
    try {
      const records = await readCallTurns(client, [...knownAgents])
      if (generation !== turnGeneration)
        return
      callTurns.value = records.map(viewCallTurn)
    }
    catch {
      if (generation === turnGeneration)
        callTurns.value = []
    }
  }

  async function forgetLatest(input: ChatTurnRecord) {
    const scope = scopeForTurn(input)
    const place = { teamId: scope.teamId, userId: scope.userId }
    const newest = buffer.newest(scope.agentId, scope.sessionId, place)
    if (!newest)
      return false
    buffer.drop(newest.turnId, scope.sessionId, place)
    outbox.drop(newest.turnId)
    recallBlocks.delete(scope.sessionId)
    const client = memoryClient
    if (client && newest.messageIds.length > 0) {
      await deleteExactMessages(bindMemoryScope(client, scope), {
        agentId: scope.agentId,
        messageIds: newest.messageIds,
      }).catch((error: unknown) => {
        console.warn('[memory] Latest turn was not deleted.', errorMessageFrom(error) ?? '')
      })
    }
    return true
  }

  async function deleteRecord(input: { kind: 'fact' | 'atom' | 'scene' | 'core', id: string, recordId?: string, path?: string, persona?: string, request?: MemoryScopeRequest }) {
    const scope = resolveRequest(input.request)
    const client = memoryClient
    const storage = storageFor(scope)
    if (!client || !storage)
      return { deleted: false as const, reason: 'unavailable' as const }
    const scoped = bindMemoryScope(client, scope)
    const agentId = agentIdForEntry({ persona: input.persona })
    if (input.kind === 'core')
      return deleteLayerRecord(scoped, { layer: 'L3', agentId })
    if (input.kind === 'fact') {
      const deleted = await storage.destroy(input.id)
      if (deleted)
        await publish(scope, [input.id])
      return { deleted, layer: 'L0' as const }
    }
    if (input.kind === 'atom') {
      const result = await deleteLayerRecord(scoped, { layer: 'L1', agentId, ids: [input.recordId || input.id] })
      await publish(scope, [input.id])
      return result
    }
    const result = await deleteLayerRecord(scoped, { layer: 'L2', agentId, path: input.path || '' })
    await publish(scope, [input.id])
    return result
  }

  async function searchRecall(query: string, scope: MemoryScope): Promise<RecallHit[]> {
    const client = memoryClient
    const text = query.trim().slice(0, 2048)
    if (!client || text === '')
      return []
    try {
      const found = await bindMemoryScope(client, scope).searchConversation({
        query: text,
        agentId: scope.agentId,
        sessionId: scope.sessionId,
        limit: defaultRecallBudget.limit,
      })
      return found.messages.map(hit => ({
        id: hit.id,
        text: hit.content,
        score: hit.score ?? 0,
        at: 0,
        source: 'remote' as const,
        agentId: scope.agentId,
        sessionId: hit.sessionId,
        messageIds: [hit.id],
      }))
    }
    catch {
      return []
    }
  }

  function scheduleRetry() {
    if (retryTimer !== undefined)
      return
    const wait = outbox.nextWait()
    if (wait === undefined)
      return
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      void pumpOutbox()
    }, wait)
  }

  async function pumpOutbox() {
    const client = memoryClient
    if (!client) {
      scheduleRetry()
      return
    }
    const due = outbox.due()
    await Promise.all(due.map(async (row) => {
      outbox.begin(row.turnId)
      const place = { teamId: row.teamId, userId: row.userId }
      try {
        const scoped = row.teamId && row.userId
          ? bindMemoryScope(client, { teamId: row.teamId, userId: row.userId })
          : client
        const result = await deliverConversation(scoped, {
          agentId: row.agentId,
          sessionId: row.sessionId,
          teamId: row.teamId,
          userId: row.userId,
          messages: row.messages,
          retry: true,
        })
        outbox.succeeded(row.turnId)
        buffer.attach(row.turnId, row.sessionId, result.acceptedIds, place)
      }
      catch {
        outbox.failed(row.turnId)
      }
    }))
    scheduleRetry()
  }

  /** Forgets an entry of the card by its id. General memories belong to the owner, so a run cannot forget them. */
  async function forget(id: string, personaId: string, request?: MemoryScopeRequest) {
    const scope = resolveRequest(request)
    const storage = storageFor(scope)
    if (!storage)
      return false
    try {
      const forgot = await storage.forget(id, personaId, Date.now())
      if (forgot)
        await publish(scope, [id])
      return forgot
    }
    catch (error) {
      failScope(scope, error)
      return false
    }
  }

  async function resetState() {
    enabled.reset()
    const client = remote
    if (client)
      await client.clear(Date.now()).catch(() => {})
    serviceEnabled.reset()
    const pending = new Set(storages.values())
    if (remote)
      pending.add(remote)
    for (const storage of pending)
      await storage.clear(Date.now()).catch(() => {})
    remote = undefined
    memoryClient = undefined
    storages.clear()
    scopedFacts.clear()
    clearLiveEntries()
    layers.value = EMPTY_MEMORY_LAYERS
    callTurns.value = []
    knownAgents.clear()
    serviceError.value = ''
    serviceRead.value = 'off'
    post([])
  }

  function reload() {
    void load().catch(error => console.warn('[memory] Failed to read the entries:', errorMessageFrom(error)))
  }
  const scope = computed(() => {
    const account = sanitizeScopeId(serviceUserId.value) || sanitizeScopeId(localAccountId.value)
    if (!account)
      return undefined
    return resolveMemoryScope({
      platform: 'local',
      userId: account,
      sessionId: localScopeSessionId,
      identityMap: storedIdentityMap(),
    })
  })
  const accountId = computed(() => sanitizeScopeId(serviceUserId.value) || sanitizeScopeId(localAccountId.value))

  syncAccountId()
  watch(changed, reload)
  watch([serviceEnabled, serviceEndpoint, serviceUserId, serviceApiKey, serviceId, localAccountId, identityMap], () => {
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
    localAccountId,
    identityMap,
    accountId,
    scope,
    serviceError,
    serviceRead,
    entries: computed(() => entries.value),
    layers,
    callTurns: computed(() => callTurns.value),
    includeCallAgents,
    listFacts,
    ready,
    prepareScope,
    requestForSession,
    confirmIdentities,
    indexFor,
    read,
    write,
    recordChatTurn,
    prepareRecall,
    recallBlock,
    deleteRecord,
    makeGeneral,
    forget,
    remove,
    resetState,
  }
})

const writeOutboxKey = 'memory/write-outbox'

function readWriteOutbox(): WriteOutboxState {
  try {
    const raw = localStorage.getItem(writeOutboxKey)
    if (!raw)
      return { pending: [], done: [] }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object')
      return { pending: [], done: [] }
    const pending = 'pending' in parsed && Array.isArray(parsed.pending) ? parsed.pending as WriteOutboxState['pending'] : []
    const done = 'done' in parsed && Array.isArray(parsed.done) ? parsed.done.filter((item): item is string => typeof item === 'string') : []
    return { pending, done }
  }
  catch {
    return { pending: [], done: [] }
  }
}

function writeOutbox(state: WriteOutboxState) {
  localStorage.setItem(writeOutboxKey, JSON.stringify(state))
}

function publicServiceError(error: unknown) {
  const message = errorMessageFrom(error) ?? 'The memory service request failed.'
  return message.includes('://') ? 'The memory service request failed.' : message
}

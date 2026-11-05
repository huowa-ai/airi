import type { MemoryV3Client } from './memory-client'
import type { MemoryEntry, MemoryMutation, MemoryProvenance, MemoryStorage, MemoryWrite } from './memory-storage'

import { v7 as uuidv7 } from 'uuid'
import { array, boolean, literal, number, object, optional, safeParse, string } from 'valibot'

import { GENERAL_AGENT_ID } from './memory-storage'

/** L0 session that holds fact records. It is not a chat transcript. */
export const factSessionId = 'airi:facts'

const directoryAgentId = 'airi:directory'
const directorySessionId = 'airi:directory'
const pageSize = 100

const provenanceSchema = object({
  sessionId: optional(string()),
  turnId: optional(string()),
  binding: optional(string()),
  modality: optional(string()),
  assetRefs: optional(array(string())),
})

const factSchema = object({
  kind: literal('airi-fact'),
  id: string(),
  description: string(),
  body: string(),
  updatedAt: number(),
  deleted: optional(boolean()),
  provenance: optional(provenanceSchema),
})

const directorySchema = object({
  kind: literal('airi-directory'),
  personas: array(string()),
  clearedAt: number(),
})

interface DirectoryState {
  personas: string[]
  clearedAt: number
  messageIds: string[]
}

/**
 * Stores AIRI facts as L0 messages on MemoryCore.
 * One team and one user. The agent id is the character card, or {@link GENERAL_AGENT_ID}.
 * IndexedDB is not written here.
 */
export function createRemoteMemoryStorage(client: MemoryV3Client): MemoryStorage {
  let tail: Promise<void> = Promise.resolve()

  function run<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task)
    tail = result.then(() => undefined, () => undefined)
    return result
  }

  return {
    list: () => run(async () => collapse(await loadFacts(client, await readDirectory(client)))),

    write: (input, persona, updatedAt) => run(() => writeFact(client, input, persona, updatedAt)),

    makeGeneral: (id, updatedAt) => run(() => makeFactGeneral(client, id, updatedAt)),

    forget: (id, persona, updatedAt) => run(() => forgetFact(client, id, persona, updatedAt)),

    remove: (ids, updatedAt) => run(() => removeFacts(client, ids, updatedAt)),

    clear: updatedAt => run(() => clearFacts(client, updatedAt)),
  }
}

async function writeFact(client: MemoryV3Client, input: MemoryWrite, persona: string, updatedAt: number): Promise<MemoryMutation> {
  const description = input.description.trim()
  const body = input.body.trim()
  if (!body)
    return { outcome: 'empty' }

  const directory = await readDirectory(client)
  if (updatedAt <= directory.clearedAt)
    return { outcome: 'stale', storedUpdatedAt: directory.clearedAt }

  const facts = await loadFacts(client, directory)
  const current = newest(facts, input.id)
  const ownsCurrent = current !== undefined && !current.deleted && current.entry.persona === persona
  const restoresCurrent = current?.deleted === true

  if ((ownsCurrent || restoresCurrent) && current.updatedAt > updatedAt)
    return { outcome: 'stale', storedUpdatedAt: current.updatedAt }
  if (ownsCurrent && current.updatedAt === updatedAt) {
    if (current.entry.description === description && current.entry.body === body)
      return { outcome: 'saved', entry: current.entry }
    return { outcome: 'stale', storedUpdatedAt: current.updatedAt }
  }
  if (restoresCurrent && current.updatedAt === updatedAt)
    return { outcome: 'stale', storedUpdatedAt: current.updatedAt }

  const id = ownsCurrent || restoresCurrent
    ? current.entry.id
    : input.id && !current ? input.id : uuidv7()

  if (!directory.personas.includes(persona)) {
    await saveDirectory(client, {
      ...directory,
      personas: [...directory.personas, persona],
    })
  }

  if (ownsCurrent || restoresCurrent)
    await deleteMessages(client, current.agentId, current.messageIds)

  const entry: MemoryEntry = {
    id,
    description,
    body,
    persona,
    updatedAt,
    ...(input.provenance ? { provenance: input.provenance } : {}),
  }
  await addFact(client, persona, entry, false)
  return { outcome: 'saved', entry }
}

async function makeFactGeneral(client: MemoryV3Client, id: string, updatedAt: number): Promise<MemoryMutation> {
  const directory = await readDirectory(client)
  const current = newest(await loadFacts(client, directory), id)
  if (!current || current.deleted)
    return { outcome: 'missing' }
  if (!current.entry.persona)
    return { outcome: 'unchanged', entry: current.entry }
  if (updatedAt <= current.updatedAt || updatedAt <= directory.clearedAt)
    return { outcome: 'stale', storedUpdatedAt: Math.max(current.updatedAt, directory.clearedAt) }

  const { persona: _persona, ...rest } = current.entry
  const general: MemoryEntry = { ...rest, updatedAt }
  await deleteMessages(client, current.agentId, current.messageIds)
  await addFact(client, GENERAL_AGENT_ID, general, false)
  return { outcome: 'saved', entry: general }
}

async function forgetFact(client: MemoryV3Client, id: string, persona: string, updatedAt: number) {
  const directory = await readDirectory(client)
  const current = newest(await loadFacts(client, directory), id)
  if (!current || current.deleted || current.entry.persona !== persona)
    return false
  if (updatedAt <= current.updatedAt || updatedAt <= directory.clearedAt)
    return false

  await deleteMessages(client, current.agentId, current.messageIds)
  await addFact(client, persona, { ...current.entry, updatedAt }, true)
  return true
}

async function removeFacts(client: MemoryV3Client, ids: string[], updatedAt: number) {
  const directory = await readDirectory(client)
  if (updatedAt <= directory.clearedAt)
    return
  const facts = await loadFacts(client, directory)
  for (const id of ids) {
    const current = newest(facts, id)
    if (!current || current.deleted || updatedAt <= current.updatedAt)
      continue
    await deleteMessages(client, current.agentId, current.messageIds)
    await addFact(client, current.agentId, { ...current.entry, updatedAt }, true)
  }
}

async function clearFacts(client: MemoryV3Client, updatedAt: number) {
  const directory = await readDirectory(client)
  const agents = [GENERAL_AGENT_ID, ...directory.personas]
  for (const agentId of agents) {
    await client.deleteConversation({ agentId, sessionIds: [factSessionId] })
  }
  await saveDirectory(client, {
    personas: [],
    clearedAt: Math.max(directory.clearedAt, updatedAt),
    messageIds: directory.messageIds,
  })
}

interface LiveFact {
  entry: MemoryEntry
  updatedAt: number
  deleted: boolean
  agentId: string
  messageIds: string[]
}

async function loadFacts(client: MemoryV3Client, directory: DirectoryState) {
  const agents = [GENERAL_AGENT_ID, ...directory.personas]
  const facts: LiveFact[] = []
  for (const agentId of agents) {
    const messages = await queryAll(client, agentId, factSessionId)
    for (const message of messages) {
      const parsed = safeParse(factSchema, parseJson(message.content))
      if (!parsed.success)
        continue
      if (parsed.output.updatedAt <= directory.clearedAt)
        continue
      const persona = agentId === GENERAL_AGENT_ID ? undefined : agentId
      facts.push({
        entry: factEntry(parsed.output, persona),
        updatedAt: parsed.output.updatedAt,
        deleted: parsed.output.deleted === true,
        agentId,
        messageIds: [message.id],
      })
    }
  }
  return facts
}

function collapse(facts: LiveFact[]) {
  const byId = new Map<string, LiveFact>()
  for (const fact of facts) {
    const previous = byId.get(fact.entry.id)
    if (!previous || fact.updatedAt >= previous.updatedAt)
      byId.set(fact.entry.id, fact)
  }
  return [...byId.values()]
    .filter(fact => !fact.deleted)
    .map(fact => fact.entry)
    .sort((left, right) => left.updatedAt - right.updatedAt || left.id.localeCompare(right.id))
}

function newest(facts: LiveFact[], id: string | undefined) {
  if (!id)
    return undefined
  return facts.filter(fact => fact.entry.id === id).sort((left, right) => right.updatedAt - left.updatedAt)[0]
}

async function addFact(client: MemoryV3Client, agentId: string, entry: MemoryEntry, deleted: boolean) {
  await client.addConversation({
    agentId,
    sessionId: factSessionId,
    messages: [{
      role: 'user',
      content: JSON.stringify({
        kind: 'airi-fact',
        id: entry.id,
        description: entry.description,
        body: entry.body,
        updatedAt: entry.updatedAt,
        ...(deleted ? { deleted: true } : {}),
        ...(entry.provenance ? { provenance: entry.provenance } : {}),
      }),
    }],
  })
}

async function deleteMessages(client: MemoryV3Client, agentId: string, messageIds: string[]) {
  if (messageIds.length === 0)
    return
  await client.deleteConversation({ agentId, messageIds })
}

async function readDirectory(client: MemoryV3Client): Promise<DirectoryState> {
  const messages = await queryAll(client, directoryAgentId, directorySessionId)
  const parsed = messages.flatMap((message) => {
    const result = safeParse(directorySchema, parseJson(message.content))
    return result.success ? [{ state: result.output, id: message.id }] : []
  })
  const latest = parsed.at(-1)
  return {
    personas: latest?.state.personas ?? [],
    clearedAt: latest?.state.clearedAt ?? 0,
    messageIds: parsed.map(item => item.id),
  }
}

async function saveDirectory(client: MemoryV3Client, state: DirectoryState) {
  if (state.messageIds.length > 0)
    await client.deleteConversation({ agentId: directoryAgentId, messageIds: state.messageIds })
  await client.addConversation({
    agentId: directoryAgentId,
    sessionId: directorySessionId,
    messages: [{
      role: 'user',
      content: JSON.stringify({
        kind: 'airi-directory',
        personas: state.personas,
        clearedAt: state.clearedAt,
      }),
    }],
  })
}

async function queryAll(client: MemoryV3Client, agentId: string, sessionId: string) {
  const messages = []
  let offset = 0
  let total = Number.POSITIVE_INFINITY
  while (offset < total) {
    const page = await client.queryConversation({
      agentId,
      sessionId,
      limit: pageSize,
      offset,
    })
    messages.push(...page.messages)
    total = page.total
    if (page.messages.length === 0)
      break
    offset += page.messages.length
  }
  return messages
}

function factEntry(value: {
  id: string
  description: string
  body: string
  updatedAt: number
  provenance?: {
    sessionId?: string
    turnId?: string
    binding?: string
    modality?: string
    assetRefs?: string[]
  }
}, persona: string | undefined): MemoryEntry {
  const provenance = provenanceFrom(value.provenance)
  return {
    id: value.id,
    description: value.description,
    body: value.body,
    updatedAt: value.updatedAt,
    ...(persona ? { persona } : {}),
    ...(provenance ? { provenance } : {}),
  }
}

function provenanceFrom(value: {
  sessionId?: string
  turnId?: string
  binding?: string
  modality?: string
  assetRefs?: string[]
} | undefined): MemoryProvenance | undefined {
  if (!value)
    return undefined
  const modality = value.modality === 'text' || value.modality === 'audio' || value.modality === 'image'
    ? value.modality
    : undefined
  const provenance: MemoryProvenance = {
    ...(value.sessionId ? { sessionId: value.sessionId } : {}),
    ...(value.turnId ? { turnId: value.turnId } : {}),
    ...(value.binding ? { binding: value.binding } : {}),
    ...(modality ? { modality } : {}),
    ...(value.assetRefs && value.assetRefs.length > 0 ? { assetRefs: value.assetRefs } : {}),
  }
  return Object.keys(provenance).length > 0 ? provenance : undefined
}

function parseJson(text: string) {
  try {
    return JSON.parse(text) as unknown
  }
  catch {
    return undefined
  }
}

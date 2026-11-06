import type { GenericSchema } from 'valibot'

import type { MemoryClientConfig } from './client-config'

import {
  array,
  nullable,
  number,
  object,
  optional,
  picklist,
  safeParse,
  string,
  union,
  unknown,
} from 'valibot'

const addPath = '/v3/conversation/add'
const searchPath = '/v3/conversation/search'
const queryPath = '/v3/conversation/query'
const deletePath = '/v3/conversation/delete'
const atomicDeletePath = '/v3/atomic/delete'
const atomicQueryPath = '/v3/atomic/query'
const scenarioListPath = '/v3/scenario/ls'
const scenarioReadPath = '/v3/scenario/read'
const scenarioRemovePath = '/v3/scenario/rm'
const coreReadPath = '/v3/core/read'

export interface ConversationMessageInput {
  role: 'user' | 'assistant'
  content: string
  /** ISO-8601 UTC time, such as `2026-11-01T00:00:00Z`. The gateway rejects a number. */
  timestamp?: string
}

/** Team and user for one call. Absent fields use the client config. */
export interface MemoryCallScope {
  teamId?: string
  userId?: string
}

export interface AddConversationInput extends MemoryCallScope {
  sessionId: string
  messages: ConversationMessageInput[]
  /** Replaces the config agent id for this call. */
  agentId?: string
}

export interface AddConversationResult {
  acceptedIds: string[]
  acceptedVersions: string[]
  totalCount: number
}

export interface SearchConversationInput extends MemoryCallScope {
  query: string
  limit?: number
  sessionId?: string
  agentId?: string
}

export interface ConversationHit {
  id: string
  version: string | number
  role: 'user' | 'assistant'
  content: string
  score?: number
  sessionId?: string
  teamId?: string
  userId?: string
  agentId?: string
}

export interface SearchConversationResult {
  messages: ConversationHit[]
}

export interface QueryConversationInput extends MemoryCallScope {
  sessionId?: string
  agentId?: string
  limit?: number
  offset?: number
}

export interface QueryConversationResult {
  messages: ConversationHit[]
  total: number
}

export interface DeleteConversationInput extends MemoryCallScope {
  messageIds?: string[]
  sessionIds?: string[]
  agentId?: string
}

export interface DeleteConversationResult {
  deletedCount: number
}

export interface DeleteAtomicInput extends MemoryCallScope {
  ids: string[]
  agentId?: string
}

export interface DeleteAtomicResult {
  deletedCount: number
}

export interface RemoveScenarioInput extends MemoryCallScope {
  path: string
  agentId?: string
}

export interface AtomicRecord {
  id: string
  version: string | number
  type: string
  content: string
  background?: string
  createdAt?: string
  updatedAt?: string
  teamId?: string
  userId?: string
  agentId?: string
}

export interface QueryAtomicInput extends MemoryCallScope {
  agentId?: string
  limit?: number
  offset?: number
  type?: string
}

export interface QueryAtomicResult {
  items: AtomicRecord[]
  total: number
}

export interface ScenarioRecord {
  path: string
  summary?: string
  version: string | number
  createdAt?: string
  updatedAt?: string
  teamId?: string
  agentId?: string
}

export interface ListScenariosInput extends MemoryCallScope {
  agentId?: string
  pathPrefix?: string
}

export interface ListScenariosResult {
  entries: ScenarioRecord[]
  total: number
}

export interface ReadScenarioInput extends MemoryCallScope {
  path: string
  agentId?: string
}

export interface ReadScenarioResult {
  path: string
  version?: string | number
  content: string | null
  createdAt?: string
  updatedAt?: string
}

export interface CoreRecord {
  content: string | null
  version?: string | number
  teamId?: string
  agentId?: string
  createdAt?: string
  updatedAt?: string
}

export interface ReadCoreInput extends MemoryCallScope {
  agentId?: string
}

/**
 * L0 writes and L0–L3 reads on a MemoryCore v3 gateway.
 * The client sends `team_id`, `agent_id`, and `user_id` on every call.
 * It does not write L1, L2, or L3.
 */
export interface MemoryV3Client {
  addConversation: (input: AddConversationInput) => Promise<AddConversationResult>
  searchConversation: (input: SearchConversationInput) => Promise<SearchConversationResult>
  queryConversation: (input: QueryConversationInput) => Promise<QueryConversationResult>
  deleteConversation: (input: DeleteConversationInput) => Promise<DeleteConversationResult>
  deleteAtomic: (input: DeleteAtomicInput) => Promise<DeleteAtomicResult>
  queryAtomic: (input: QueryAtomicInput) => Promise<QueryAtomicResult>
  removeScenario: (input: RemoveScenarioInput) => Promise<void>
  listScenarios: (input: ListScenariosInput) => Promise<ListScenariosResult>
  readScenario: (input: ReadScenarioInput) => Promise<ReadScenarioResult>
  readCore: (input: ReadCoreInput) => Promise<CoreRecord>
}

export interface MemoryV3ClientOptions {
  fetch?: typeof fetch
  timeoutMs?: number
}

/** Failure from MemoryCore or from a check that runs before the request. The message omits the key and the endpoint. */
export class MemoryClientError extends Error {
  readonly path: string
  readonly status: number
  readonly code: number

  constructor(details: { path: string, status: number, code: number, message: string }) {
    super(details.message)
    this.name = 'MemoryClientError'
    this.path = details.path
    this.status = details.status
    this.code = details.code
  }
}

const envelopeSchema = object({
  code: number(),
  message: string(),
  request_id: optional(string()),
  data: optional(nullable(unknown())),
})

const addDataSchema = object({
  accepted_ids: array(string()),
  accepted_versions: array(string()),
  total_count: number(),
})

const hitSchema = object({
  id: string(),
  // The reviewed catalog includes version. This local gateway omits it on L0 query.
  version: optional(union([string(), number()])),
  role: picklist(['user', 'assistant']),
  content: string(),
  score: optional(number()),
  session_id: optional(string()),
  team_id: optional(string()),
  user_id: optional(string()),
  agent_id: optional(string()),
})

const searchDataSchema = object({
  messages: array(hitSchema),
})

const queryDataSchema = object({
  messages: array(hitSchema),
  total: number(),
})

const deleteDataSchema = object({
  deleted_count: number(),
})

const atomicItemSchema = object({
  id: string(),
  version: optional(union([string(), number()])),
  type: string(),
  background: optional(string()),
  content: string(),
  created_at: optional(string()),
  updated_at: optional(string()),
  team_id: optional(string()),
  user_id: optional(string()),
  agent_id: optional(string()),
})

const atomicQuerySchema = object({
  items: array(atomicItemSchema),
  total: number(),
})

const scenarioEntrySchema = object({
  path: string(),
  summary: optional(string()),
  version: union([string(), number()]),
  team_id: optional(string()),
  agent_id: optional(string()),
  created_at: optional(string()),
  updated_at: optional(string()),
})

const scenarioListSchema = object({
  entries: array(scenarioEntrySchema),
  total: number(),
})

const scenarioReadSchema = object({
  path: string(),
  version: optional(nullable(union([string(), number()]))),
  content: nullable(string()),
  created_at: optional(nullable(string())),
  updated_at: optional(nullable(string())),
})

const coreReadSchema = object({
  content: nullable(string()),
  version: optional(nullable(union([string(), number()]))),
  team_id: optional(nullable(string())),
  agent_id: optional(nullable(string())),
  created_at: optional(nullable(string())),
  updated_at: optional(nullable(string())),
})

/**
 * Builds a v3 client. Call this only with a config from {@link readMemoryClientConfig}.
 * The client does not log the endpoint or the key.
 */
export function createMemoryClient(config: MemoryClientConfig, options: MemoryV3ClientOptions = {}): MemoryV3Client {
  const fetchImpl = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? 15_000
  const secrets = [config.apiKey, config.endpoint].filter((value): value is string => Boolean(value))

  return {
    async addConversation(input) {
      const agentId = input.agentId ?? config.agentId
      assertSessionId(addPath, input.sessionId)
      assertAgentId(addPath, agentId)
      assertMessages(input.messages)

      return post(fetchImpl, config, secrets, timeoutMs, addPath, {
        team_id: input.teamId ?? config.teamId,
        agent_id: agentId,
        user_id: input.userId ?? config.userId,
        session_id: input.sessionId,
        messages: input.messages.map(message => ({
          role: message.role,
          content: message.content,
          ...(message.timestamp === undefined ? {} : { timestamp: message.timestamp }),
        })),
      }, addDataSchema, data => ({
        acceptedIds: data.accepted_ids,
        acceptedVersions: data.accepted_versions,
        totalCount: data.total_count,
      }))
    },

    async searchConversation(input) {
      const agentId = input.agentId ?? config.agentId
      assertAgentId(searchPath, agentId)
      assertQuery(input.query)
      assertLimit(input.limit)
      if (input.sessionId !== undefined)
        assertSessionId(searchPath, input.sessionId)

      return post(fetchImpl, config, secrets, timeoutMs, searchPath, {
        team_id: input.teamId ?? config.teamId,
        agent_id: agentId,
        user_id: input.userId ?? config.userId,
        query: input.query,
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.sessionId === undefined ? {} : { session_id: input.sessionId }),
      }, searchDataSchema, data => ({
        messages: data.messages.map(mapHit),
      }))
    },

    async queryConversation(input) {
      const agentId = input.agentId ?? config.agentId
      assertAgentId(queryPath, agentId)
      assertLimit(input.limit)
      assertOffset(input.offset)
      if (input.sessionId !== undefined)
        assertSessionId(queryPath, input.sessionId)

      return post(fetchImpl, config, secrets, timeoutMs, queryPath, {
        team_id: input.teamId ?? config.teamId,
        agent_id: agentId,
        user_id: input.userId ?? config.userId,
        ...(input.sessionId === undefined ? {} : { session_id: input.sessionId }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.offset === undefined ? {} : { offset: input.offset }),
      }, queryDataSchema, data => ({
        messages: data.messages.map(mapHit),
        total: data.total,
      }))
    },

    async deleteConversation(input) {
      const agentId = input.agentId ?? config.agentId
      assertAgentId(deletePath, agentId)
      const messageIds = uniqueIds(input.messageIds ?? [])
      const sessionIds = uniqueIds(input.sessionIds ?? [])
      if (messageIds.length > 0 && sessionIds.length > 0)
        rejectInput(deletePath, 'Delete message ids or session ids, not both.')
      if (messageIds.length === 0 && sessionIds.length === 0)
        rejectInput(deletePath, 'Delete needs message ids or session ids.')

      // Transport only. deleteExactMessages checks the count.
      // A message delete sends message_ids only. session_id deletes the whole session.
      const result = await post(fetchImpl, config, secrets, timeoutMs, deletePath, {
        team_id: input.teamId ?? config.teamId,
        agent_id: agentId,
        user_id: input.userId ?? config.userId,
        ...(messageIds.length === 0 ? { session_ids: sessionIds } : { message_ids: messageIds }),
      }, deleteDataSchema, data => data)
      return { deletedCount: result.deleted_count }
    },

    async deleteAtomic(input) {
      const agentId = input.agentId ?? config.agentId
      assertAgentId(atomicDeletePath, agentId)
      if (input.ids.length === 0)
        rejectInput(atomicDeletePath, 'Delete needs atom ids.')

      return post(fetchImpl, config, secrets, timeoutMs, atomicDeletePath, {
        team_id: input.teamId ?? config.teamId,
        agent_id: agentId,
        user_id: input.userId ?? config.userId,
        ids: input.ids,
      }, deleteDataSchema, data => ({
        deletedCount: data.deleted_count,
      }))
    },

    async queryAtomic(input) {
      const agentId = input.agentId ?? config.agentId
      assertAgentId(atomicQueryPath, agentId)
      assertPage(atomicQueryPath, input.limit, input.offset)

      return post(fetchImpl, config, secrets, timeoutMs, atomicQueryPath, {
        team_id: input.teamId ?? config.teamId,
        agent_id: agentId,
        user_id: input.userId ?? config.userId,
        ...(input.type === undefined ? {} : { type: input.type }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.offset === undefined ? {} : { offset: input.offset }),
      }, atomicQuerySchema, data => ({
        items: data.items.map(mapAtomic),
        total: data.total,
      }))
    },

    async listScenarios(input) {
      const agentId = input.agentId ?? config.agentId
      assertAgentId(scenarioListPath, agentId)
      if (input.pathPrefix !== undefined)
        assertRelativePath(scenarioListPath, input.pathPrefix)

      return post(fetchImpl, config, secrets, timeoutMs, scenarioListPath, {
        team_id: input.teamId ?? config.teamId,
        agent_id: agentId,
        user_id: input.userId ?? config.userId,
        ...(input.pathPrefix === undefined ? {} : { path_prefix: input.pathPrefix }),
      }, scenarioListSchema, data => ({
        entries: data.entries.map(mapScenario),
        total: data.total,
      }))
    },

    async removeScenario(input) {
      const agentId = input.agentId ?? config.agentId
      assertAgentId(scenarioRemovePath, agentId)
      assertRelativePath(scenarioRemovePath, input.path)

      await post(fetchImpl, config, secrets, timeoutMs, scenarioRemovePath, {
        team_id: input.teamId ?? config.teamId,
        agent_id: agentId,
        user_id: input.userId ?? config.userId,
        path: input.path,
      }, optional(nullable(unknown())), () => undefined)
    },

    async readScenario(input) {
      const agentId = input.agentId ?? config.agentId
      assertAgentId(scenarioReadPath, agentId)
      assertRelativePath(scenarioReadPath, input.path)

      return post(fetchImpl, config, secrets, timeoutMs, scenarioReadPath, {
        team_id: input.teamId ?? config.teamId,
        agent_id: agentId,
        user_id: input.userId ?? config.userId,
        path: input.path,
      }, scenarioReadSchema, data => ({
        path: data.path,
        content: data.content,
        ...(data.version === undefined || data.version === null ? {} : { version: data.version }),
        ...(data.created_at ? { createdAt: data.created_at } : {}),
        ...(data.updated_at ? { updatedAt: data.updated_at } : {}),
      }))
    },

    async readCore(input) {
      const agentId = input.agentId ?? config.agentId
      assertAgentId(coreReadPath, agentId)

      return post(fetchImpl, config, secrets, timeoutMs, coreReadPath, {
        team_id: input.teamId ?? config.teamId,
        agent_id: agentId,
        user_id: input.userId ?? config.userId,
      }, coreReadSchema, data => ({
        content: data.content,
        ...(data.version === undefined || data.version === null ? {} : { version: data.version }),
        ...(data.team_id ? { teamId: data.team_id } : {}),
        ...(data.agent_id ? { agentId: data.agent_id } : {}),
        ...(data.created_at ? { createdAt: data.created_at } : {}),
        ...(data.updated_at ? { updatedAt: data.updated_at } : {}),
      }))
    },
  }
}

/**
 * Returns a client that sends one resolved team and user on every call.
 * Agent id and session id stay on the call. Facts and chat pass the same agent id.
 */
export function bindMemoryScope(client: MemoryV3Client, scope: { teamId: string, userId: string }): MemoryV3Client {
  const bound = { teamId: scope.teamId, userId: scope.userId }
  return {
    addConversation: input => client.addConversation({ ...input, ...bound }),
    searchConversation: input => client.searchConversation({ ...input, ...bound }),
    queryConversation: input => client.queryConversation({ ...input, ...bound }),
    deleteConversation: input => client.deleteConversation({ ...input, ...bound }),
    deleteAtomic: input => client.deleteAtomic({ ...input, ...bound }),
    queryAtomic: input => client.queryAtomic({ ...input, ...bound }),
    removeScenario: input => client.removeScenario({ ...input, ...bound }),
    listScenarios: input => client.listScenarios({ ...input, ...bound }),
    readScenario: input => client.readScenario({ ...input, ...bound }),
    readCore: input => client.readCore({ ...input, ...bound }),
  }
}

function mapHit(message: {
  id: string
  version?: string | number
  role: 'user' | 'assistant'
  content: string
  score?: number
  session_id?: string
  team_id?: string
  user_id?: string
  agent_id?: string
}): ConversationHit {
  return {
    id: message.id,
    version: message.version ?? 0,
    role: message.role,
    content: message.content,
    ...(message.score === undefined ? {} : { score: message.score }),
    ...(message.session_id === undefined ? {} : { sessionId: message.session_id }),
    ...(message.team_id === undefined ? {} : { teamId: message.team_id }),
    ...(message.user_id === undefined ? {} : { userId: message.user_id }),
    ...(message.agent_id === undefined ? {} : { agentId: message.agent_id }),
  }
}

async function post<TSchema, TResult>(
  fetchImpl: typeof fetch,
  config: MemoryClientConfig,
  secrets: string[],
  timeoutMs: number,
  path: string,
  body: Record<string, unknown>,
  schema: GenericSchema<unknown, TSchema>,
  map: (data: TSchema) => TResult,
): Promise<TResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetchImpl(new URL(path, `${config.endpoint}/`), {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  }
  catch {
    throw new MemoryClientError({
      path,
      status: 0,
      code: 0,
      message: 'MemoryCore request failed.',
    })
  }
  finally {
    clearTimeout(timer)
  }

  const text = await response.text()
  const envelope = parseEnvelope(text, path, response.status, secrets)
  if (!response.ok || envelope.code !== 0) {
    throw new MemoryClientError({
      path,
      status: response.status,
      code: envelope.code,
      message: redact(envelope.message, secrets) || 'MemoryCore rejected the request.',
    })
  }

  const parsed = safeParse(schema, envelope.data)
  if (!parsed.success) {
    throw new MemoryClientError({
      path,
      status: response.status,
      code: envelope.code,
      message: 'MemoryCore returned an unexpected response.',
    })
  }

  return map(parsed.output)
}

function headers(config: MemoryClientConfig) {
  return {
    'content-type': 'application/json',
    'authorization': `Bearer ${config.apiKey}`,
    'x-tdai-service-id': config.serviceId,
  }
}

function parseEnvelope(text: string, path: string, status: number, secrets: string[]) {
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  }
  catch {
    throw new MemoryClientError({
      path,
      status,
      code: 0,
      message: 'MemoryCore returned a response that is not JSON.',
    })
  }

  const parsed = safeParse(envelopeSchema, value)
  if (!parsed.success) {
    throw new MemoryClientError({
      path,
      status,
      code: 0,
      message: 'MemoryCore returned an unexpected response.',
    })
  }

  return {
    code: parsed.output.code,
    message: redact(parsed.output.message, secrets),
    data: parsed.output.data,
  }
}

function redact(text: string, secrets: string[]) {
  let output = text.slice(0, 180)
  for (const secret of secrets) {
    if (secret.length < 4)
      continue
    output = output.split(secret).join('[redacted]')
  }
  return output
}

function uniqueIds(ids: string[]) {
  const seen = new Set<string>()
  const output: string[] = []
  for (const raw of ids) {
    const id = raw.trim()
    if (!id || seen.has(id))
      continue
    seen.add(id)
    output.push(id)
  }
  return output
}

function rejectInput(path: string, message: string): never {
  throw new MemoryClientError({ path, status: 0, code: 400, message })
}

function assertSessionId(path: string, sessionId: string) {
  if (sessionId.trim() === '' || sessionId.length > 256)
    rejectInput(path, 'Session id must be 1 to 256 characters.')
}

function assertAgentId(path: string, agentId: string) {
  if (agentId.trim() === '' || agentId.length > 256)
    rejectInput(path, 'Agent id must be 1 to 256 characters.')
}

function assertMessages(messages: ConversationMessageInput[]) {
  if (messages.length < 1 || messages.length > 100)
    rejectInput(addPath, 'Conversation add needs 1 to 100 messages.')

  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant')
      rejectInput(addPath, 'Conversation message role must be user or assistant.')
    if (message.content.length < 1 || message.content.length > 8192)
      rejectInput(addPath, 'Conversation message content must be 1 to 8192 characters.')
    // The gateway returns 400 when `timestamp` is a number. It accepts `2026-11-01T00:00:00Z`.
    if (message.timestamp !== undefined && (typeof message.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(message.timestamp)))
      rejectInput(addPath, 'Conversation message time must be an ISO-8601 UTC time.')
  }
}

function assertQuery(query: string) {
  if (query.length < 1 || query.length > 2048)
    rejectInput(searchPath, 'Search query must be 1 to 2048 characters.')
}

function assertLimit(limit: number | undefined) {
  if (limit === undefined)
    return
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    rejectInput(searchPath, 'Search limit must be an integer from 1 to 100.')
}

function assertOffset(offset: number | undefined) {
  if (offset === undefined)
    return
  if (!Number.isInteger(offset) || offset < 0)
    rejectInput(queryPath, 'Query offset must be a non-negative integer.')
}

function assertPage(path: string, limit: number | undefined, offset: number | undefined) {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100))
    rejectInput(path, 'Query limit must be an integer from 1 to 100.')
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0))
    rejectInput(path, 'Query offset must be a non-negative integer.')
}

function assertRelativePath(path: string, value: string) {
  if (value.trim() === '' || value.length > 512 || value.includes('..') || value.startsWith('/') || value.includes('\\'))
    rejectInput(path, 'Scenario path must be a relative path.')
}

function mapAtomic(item: {
  id: string
  version?: string | number
  type: string
  background?: string
  content: string
  created_at?: string
  updated_at?: string
  team_id?: string
  user_id?: string
  agent_id?: string
}): AtomicRecord {
  return {
    id: item.id,
    version: item.version ?? 0,
    type: item.type,
    content: item.content,
    ...(item.background ? { background: item.background } : {}),
    ...(item.created_at ? { createdAt: item.created_at } : {}),
    ...(item.updated_at ? { updatedAt: item.updated_at } : {}),
    ...(item.team_id ? { teamId: item.team_id } : {}),
    ...(item.user_id ? { userId: item.user_id } : {}),
    ...(item.agent_id ? { agentId: item.agent_id } : {}),
  }
}

function mapScenario(entry: {
  path: string
  summary?: string
  version: string | number
  created_at?: string
  updated_at?: string
  team_id?: string
  agent_id?: string
}): ScenarioRecord {
  return {
    path: entry.path,
    version: entry.version,
    ...(entry.summary ? { summary: entry.summary } : {}),
    ...(entry.created_at ? { createdAt: entry.created_at } : {}),
    ...(entry.updated_at ? { updatedAt: entry.updated_at } : {}),
    ...(entry.team_id ? { teamId: entry.team_id } : {}),
    ...(entry.agent_id ? { agentId: entry.agent_id } : {}),
  }
}

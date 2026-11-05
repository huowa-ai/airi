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

export interface ConversationMessageInput {
  role: 'user' | 'assistant'
  content: string
  timestamp?: number
}

export interface AddConversationInput {
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

export interface SearchConversationInput {
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

export interface QueryConversationInput {
  sessionId?: string
  agentId?: string
  limit?: number
  offset?: number
}

export interface QueryConversationResult {
  messages: ConversationHit[]
  total: number
}

export interface DeleteConversationInput {
  messageIds?: string[]
  sessionIds?: string[]
  agentId?: string
}

export interface DeleteConversationResult {
  deletedCount: number
}

/**
 * L0 calls on a MemoryCore v3 gateway.
 * The client sends `team_id`, `agent_id`, and `user_id` on every call.
 */
export interface MemoryV3Client {
  addConversation: (input: AddConversationInput) => Promise<AddConversationResult>
  searchConversation: (input: SearchConversationInput) => Promise<SearchConversationResult>
  queryConversation: (input: QueryConversationInput) => Promise<QueryConversationResult>
  deleteConversation: (input: DeleteConversationInput) => Promise<DeleteConversationResult>
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
        team_id: config.teamId,
        agent_id: agentId,
        user_id: config.userId,
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
        team_id: config.teamId,
        agent_id: agentId,
        user_id: config.userId,
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
        team_id: config.teamId,
        agent_id: agentId,
        user_id: config.userId,
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
      const messageIds = input.messageIds ?? []
      const sessionIds = input.sessionIds ?? []
      if (messageIds.length === 0 && sessionIds.length === 0)
        rejectInput(deletePath, 'Delete needs message ids or session ids.')

      return post(fetchImpl, config, secrets, timeoutMs, deletePath, {
        team_id: config.teamId,
        agent_id: agentId,
        user_id: config.userId,
        ...(messageIds.length === 0 ? {} : { message_ids: messageIds }),
        ...(sessionIds.length === 0 ? {} : { session_ids: sessionIds }),
      }, deleteDataSchema, data => ({
        deletedCount: data.deleted_count,
      }))
    },
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
  const result: Record<string, string> = {
    'content-type': 'application/json',
    'x-request-id': crypto.randomUUID(),
  }

  if (config.apiKey)
    result.authorization = `Bearer ${config.apiKey}`
  if (config.serviceId)
    result['x-tdai-service-id'] = config.serviceId

  return result
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
    if (message.timestamp !== undefined && !Number.isFinite(message.timestamp))
      rejectInput(addPath, 'Conversation message time must be a finite number.')
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

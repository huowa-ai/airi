import { check, maxLength, minLength, pipe, safeParse, string } from 'valibot'

/**
 * Environment names for the MemoryCore client.
 * Values stay in the environment. Source code and logs do not carry them.
 */
export const memoryClientEnv = {
  endpoint: 'TENCENTDB_MEMORY_ENDPOINT',
  teamId: 'TENCENTDB_MEMORY_TEAM_ID',
  userId: 'TENCENTDB_MEMORY_USER_ID',
  agentId: 'TENCENTDB_MEMORY_AGENT_ID',
  serviceId: 'TENCENTDB_MEMORY_SERVICE_ID',
  apiKey: 'TENCENTDB_MEMORY_API_KEY',
} as const

const requiredEnv = [
  memoryClientEnv.endpoint,
  memoryClientEnv.teamId,
  memoryClientEnv.userId,
  memoryClientEnv.agentId,
] as const

/**
 * Local gateway values.
 * A v3 call without `Authorization` or `x-tdai-service-id` returns 401, including when gateway auth is disabled.
 * The gateway does not read the service id from the query or the body. `default` is not a substitute for the header.
 */
export const defaultMemoryApiKey = 'local'
export const defaultMemoryServiceId = 'default'

/** One deployment, one owner, and the default agent id for a v3 call. */
export interface MemoryClientConfig {
  /** `http` or `https` origin. The local gateway is `http://127.0.0.1:8420`. */
  endpoint: string
  teamId: string
  userId: string
  /** Default `agent_id` when a call does not pass one. */
  agentId: string
  /** Service id. An empty setting becomes {@link defaultMemoryServiceId}. Node sends it as `x-tdai-service-id`. */
  serviceId: string
  /** Sent as `Authorization: Bearer`. An empty setting becomes {@link defaultMemoryApiKey}. */
  apiKey: string
}

export type MemoryClientConfigResult = {
  configured: true
  config: MemoryClientConfig
} | {
  configured: false
  missing: string[]
  invalid: string[]
}

const idSchema = pipe(
  string(),
  minLength(1),
  maxLength(256),
  check(value => value === value.trim(), 'Id has outer space.'),
  check(value => !hasControlCharacter(value), 'Id has a control character.'),
)

type EnvSource = Record<string, string | undefined>

/**
 * Reads the MemoryCore client settings from an environment map.
 * A secret that fails the check is named in `invalid` and is not copied into the result text.
 */
export function readMemoryClientConfig(env: EnvSource): MemoryClientConfigResult {
  const missing: string[] = []
  const invalid: string[] = []

  const endpoint = readEndpoint(env[memoryClientEnv.endpoint], missing, invalid)
  const teamId = readId(env[memoryClientEnv.teamId], memoryClientEnv.teamId, missing, invalid)
  const userId = readId(env[memoryClientEnv.userId], memoryClientEnv.userId, missing, invalid)
  const agentId = readId(env[memoryClientEnv.agentId], memoryClientEnv.agentId, missing, invalid)
  const serviceId = readDefaultedId(env[memoryClientEnv.serviceId], memoryClientEnv.serviceId, invalid, defaultMemoryServiceId)
  const apiKey = readDefaultedId(env[memoryClientEnv.apiKey], memoryClientEnv.apiKey, invalid, defaultMemoryApiKey)

  if (missing.length > 0 || invalid.length > 0 || !endpoint || !teamId || !userId || !agentId || !serviceId || !apiKey) {
    return { configured: false, missing, invalid }
  }

  return {
    configured: true,
    config: {
      endpoint,
      teamId,
      userId,
      agentId,
      serviceId,
      apiKey,
    },
  }
}

/**
 * The part of a config result that is safe to log.
 * It lists environment names and never the endpoint, the key, or the ids.
 */
export function memoryClientConfigStatus(result: MemoryClientConfigResult) {
  if (result.configured) {
    return { configured: true as const, missing: [] as string[], invalid: [] as string[] }
  }

  return {
    configured: false as const,
    missing: result.missing,
    invalid: result.invalid,
  }
}

function hasControlCharacter(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127)
      return true
  }
  return false
}

function readId(value: string | undefined, name: string, missing: string[], invalid: string[]) {
  if (value === undefined || value === '') {
    missing.push(name)
    return undefined
  }

  const parsed = safeParse(idSchema, value)
  if (!parsed.success) {
    invalid.push(name)
    return undefined
  }

  return parsed.output
}

function readDefaultedId(value: string | undefined, name: string, invalid: string[], fallback: string) {
  if (value === undefined || value === '')
    return fallback

  const parsed = safeParse(idSchema, value)
  if (!parsed.success) {
    invalid.push(name)
    return undefined
  }

  return parsed.output
}

function readEndpoint(value: string | undefined, missing: string[], invalid: string[]) {
  const name = memoryClientEnv.endpoint
  if (value === undefined || value === '') {
    missing.push(name)
    return undefined
  }

  const endpoint = endpointOrigin(value)
  if (!endpoint) {
    invalid.push(name)
    return undefined
  }

  return endpoint
}

/** Accepts an http(s) origin and rejects credentials, a query, a hash, and a path. */
function endpointOrigin(value: string) {
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    return undefined
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return undefined
  if (url.username || url.password)
    return undefined
  if (url.search || url.hash)
    return undefined
  if (url.pathname !== '/' && url.pathname !== '')
    return undefined

  return url.origin
}

export const memoryClientRequiredEnv = requiredEnv

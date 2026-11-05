/**
 * In-memory MemoryCore L0 gateway for tests.
 * One team id and one user id share one row list. A second user does not.
 */

interface GatewayRow {
  id: string
  agentId: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
}

interface GatewayBody {
  team_id?: string
  user_id?: string
  agent_id?: string
  session_id?: string
  messages?: Array<{ role?: 'user' | 'assistant', content?: string }>
  limit?: number
  offset?: number
  message_ids?: string[]
  session_ids?: string[]
}

export function createMemoryCoreFetch() {
  const scopes = new Map<string, GatewayRow[]>()
  let nextId = 1
  let failure = ''

  function rowsFor(body: GatewayBody) {
    const key = `${body.team_id ?? ''}\0${body.user_id ?? ''}`
    const existing = scopes.get(key)
    if (existing)
      return existing
    const created: GatewayRow[] = []
    scopes.set(key, created)
    return created
  }

  const fetchImpl: typeof fetch = async (input, init) => {
    if (failure)
      return Response.json({ code: 1, message: failure, data: null }, { status: 500 })

    const url = requestUrl(input)
    const body = parseBody(init?.body)
    const rows = rowsFor(body)
    const agentId = body.agent_id ?? ''

    if (url.includes('/v3/conversation/add')) {
      const acceptedIds = (body.messages ?? []).map((message) => {
        const id = `msg-${nextId}`
        nextId += 1
        rows.push({
          id,
          agentId,
          sessionId: body.session_id ?? '',
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: message.content ?? '',
        })
        return id
      })
      return Response.json({
        code: 0,
        message: 'ok',
        data: {
          accepted_ids: acceptedIds,
          accepted_versions: acceptedIds.map(() => 'v1'),
          total_count: acceptedIds.length,
        },
      })
    }

    if (url.includes('/v3/conversation/delete')) {
      const ids = new Set(body.message_ids ?? [])
      const sessions = new Set(body.session_ids ?? [])
      const before = rows.length
      const kept = rows.filter((row) => {
        if (row.agentId !== agentId)
          return true
        if (ids.has(row.id))
          return false
        if (sessions.has(row.sessionId))
          return false
        return true
      })
      rows.splice(0, rows.length, ...kept)
      return Response.json({
        code: 0,
        message: 'ok',
        data: { deleted_count: before - rows.length },
      })
    }

    const matched = rows.filter(row => row.agentId === agentId && (body.session_id === undefined || row.sessionId === body.session_id))
    const offset = body.offset ?? 0
    const limit = body.limit ?? matched.length
    const page = matched.slice(offset, offset + limit)
    return Response.json({
      code: 0,
      message: 'ok',
      data: {
        messages: page.map(row => ({
          id: row.id,
          version: 'v1',
          role: row.role,
          content: row.content,
          session_id: row.sessionId,
          agent_id: row.agentId,
          team_id: body.team_id,
          user_id: body.user_id,
        })),
        total: matched.length,
      },
    })
  }

  return {
    fetch: fetchImpl,
    fail(message: string) {
      failure = message
    },
    reset() {
      scopes.clear()
      nextId = 1
      failure = ''
    },
  }
}

/** Writes the service settings the store reads at startup. Values are examples, not secrets. */
export function enableMemoryService(userId = 'user-1', teamId = 'team-1') {
  localStorage.setItem('memory/service-enabled', 'true')
  localStorage.setItem('memory/service-endpoint', 'http://127.0.0.1:8420')
  localStorage.setItem('memory/service-team-id', teamId)
  localStorage.setItem('memory/service-user-id', userId)
}

export function clearMemoryServiceSettings() {
  localStorage.removeItem('memory/service-enabled')
  localStorage.removeItem('memory/service-endpoint')
  localStorage.removeItem('memory/service-team-id')
  localStorage.removeItem('memory/service-user-id')
  localStorage.removeItem('memory/service-api-key')
  localStorage.removeItem('memory/service-id')
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string')
    return input
  if (input instanceof URL)
    return input.href
  return input.url
}

function parseBody(body: BodyInit | null | undefined): GatewayBody {
  if (typeof body !== 'string' || body === '')
    return {}
  return JSON.parse(body) as GatewayBody
}

/**
 * In-memory MemoryCore gateway for tests.
 * One team id and one user id share one L0 row list. A second user does not.
 * L2 and L3 are stored by team and agent. The user id does not split them.
 */

import { factAgentId } from '@proj-airi/tencentdb-memory'

interface GatewayRow {
  id: string
  agentId: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
}

interface GatewayAtom {
  teamId: string
  userId: string
  id: string
  agentId: string
  type: string
  content: string
  background?: string
  updatedAt?: string
}

interface GatewayScene {
  teamId: string
  path: string
  agentId: string
  summary?: string
  content?: string
  updatedAt?: string
}

interface GatewayCore {
  teamId: string
  agentId: string
  content: string | null
  updatedAt?: string
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
  path?: string
}

export interface MemoryCoreFixture {
  facts?: Array<{ id: string, description: string, body: string, persona?: string, updatedAt: number }>
  atoms?: Array<{ id: string, type: string, content: string, background?: string, persona?: string, updatedAt?: string }>
  scenes?: Array<{ path: string, summary?: string, content?: string, persona?: string, updatedAt?: string }>
  cores?: Array<{ content: string, persona?: string, updatedAt?: string }>
}

const generalAgentId = 'airi:general'
const factSessionId = 'airi:facts'
const directoryAgentId = 'airi:directory'
const directorySessionId = 'airi:directory'

export function createMemoryCoreFetch() {
  const scopes = new Map<string, GatewayRow[]>()
  const atoms: GatewayAtom[] = []
  const scenes: GatewayScene[] = []
  const cores: GatewayCore[] = []
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

    if (url.includes('/v3/atomic/query')) {
      const matched = atoms.filter(atom => atom.teamId === (body.team_id ?? '') && atom.userId === (body.user_id ?? '') && atom.agentId === agentId)
      const offset = body.offset ?? 0
      const limit = body.limit ?? matched.length
      const page = matched.slice(offset, offset + limit)
      return Response.json({
        code: 0,
        message: 'ok',
        data: {
          items: page.map(atom => ({
            id: atom.id,
            version: 1,
            type: atom.type,
            content: atom.content,
            ...(atom.background ? { background: atom.background } : {}),
            ...(atom.updatedAt ? { updated_at: atom.updatedAt } : {}),
            agent_id: atom.agentId,
            team_id: body.team_id,
            user_id: body.user_id,
          })),
          total: matched.length,
        },
      })
    }

    if (url.includes('/v3/scenario/ls')) {
      const matched = scenes.filter(scene => scene.teamId === (body.team_id ?? '') && scene.agentId === agentId)
      return Response.json({
        code: 0,
        message: 'ok',
        data: {
          entries: matched.map(scene => ({
            path: scene.path,
            version: scene.path.endsWith('/') ? 0 : 1,
            ...(scene.summary ? { summary: scene.summary } : {}),
            ...(scene.updatedAt ? { updated_at: scene.updatedAt } : {}),
            agent_id: scene.agentId,
            team_id: body.team_id,
          })),
          total: matched.length,
        },
      })
    }

    if (url.includes('/v3/scenario/read')) {
      const scene = scenes.find(item => item.teamId === (body.team_id ?? '') && item.agentId === agentId && item.path === body.path)
      return Response.json({
        code: 0,
        message: 'ok',
        data: {
          path: body.path ?? '',
          version: scene ? 1 : null,
          content: scene?.content ?? null,
          created_at: scene?.updatedAt ?? null,
          updated_at: scene?.updatedAt ?? null,
        },
      })
    }

    if (url.includes('/v3/core/read')) {
      const core = cores.find(item => item.teamId === (body.team_id ?? '') && item.agentId === agentId)
      return Response.json({
        code: 0,
        message: 'ok',
        data: {
          content: core?.content ?? null,
          version: core ? 1 : null,
          agent_id: agentId,
          team_id: body.team_id,
          created_at: core?.updatedAt ?? null,
          updated_at: core?.updatedAt ?? null,
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
    /**
     * Loads fixture rows for one team and user.
     * Fact personas become directory entries. L2 and L3 ignore the user id.
     */
    seed(fixture: MemoryCoreFixture, teamId = 'team-1', userId = 'user-1') {
      const key = `${teamId}\0${userId}`
      const rows = rowsFor({ team_id: teamId, user_id: userId })
      rows.splice(0, rows.length)
      const personas = new Set<string>()
      for (const fact of fixture.facts ?? []) {
        if (fact.persona)
          personas.add(fact.persona)
        rows.push({
          id: fact.id,
          agentId: factAgentId(fact.persona),
          sessionId: factSessionId,
          role: 'assistant',
          content: JSON.stringify({
            kind: 'airi-fact',
            id: fact.id,
            description: fact.description,
            body: fact.body,
            updatedAt: fact.updatedAt,
          }),
        })
      }
      if (personas.size > 0) {
        rows.push({
          id: 'directory',
          agentId: directoryAgentId,
          sessionId: directorySessionId,
          role: 'user',
          content: JSON.stringify({
            kind: 'airi-directory',
            personas: [...personas],
            clearedAt: 0,
          }),
        })
      }
      scopes.set(key, rows)
      atoms.splice(0, atoms.length, ...(fixture.atoms ?? []).map(atom => ({
        teamId,
        userId,
        id: atom.id,
        agentId: atom.persona || generalAgentId,
        type: atom.type,
        content: atom.content,
        ...(atom.background ? { background: atom.background } : {}),
        ...(atom.updatedAt ? { updatedAt: atom.updatedAt } : {}),
      })))
      scenes.splice(0, scenes.length, ...(fixture.scenes ?? []).map(scene => ({
        teamId,
        path: scene.path,
        agentId: scene.persona || generalAgentId,
        ...(scene.summary ? { summary: scene.summary } : {}),
        ...(scene.content ? { content: scene.content } : {}),
        ...(scene.updatedAt ? { updatedAt: scene.updatedAt } : {}),
      })))
      cores.splice(0, cores.length, ...(fixture.cores ?? []).map(core => ({
        teamId,
        agentId: core.persona || generalAgentId,
        content: core.content,
        ...(core.updatedAt ? { updatedAt: core.updatedAt } : {}),
      })))
    },
    reset() {
      scopes.clear()
      atoms.splice(0, atoms.length)
      scenes.splice(0, scenes.length)
      cores.splice(0, cores.length)
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

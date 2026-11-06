import { describe, expect, it } from 'vitest'

import { bindMemoryScope, createMemoryClient } from '../src/memory-client'
import { searchLongTerm } from '../src/memory-core-contract'
import { resolveMemoryScope } from '../src/memory-scope'
import { createRemoteMemoryStorage } from '../src/remote-memory'

interface Row {
  teamId: string
  userId: string
  agentId: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
}

interface Scene {
  teamId: string
  agentId: string
  path: string
  content: string
}

interface CoreRow {
  teamId: string
  agentId: string
  content: string
}

interface Atom {
  teamId: string
  userId: string
  agentId: string
  id: string
  content: string
}

function isolationGateway() {
  const rows: Row[] = []
  const scenes: Scene[] = []
  const cores: CoreRow[] = []
  const atoms: Atom[] = []
  let nextId = 1

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {}
    const teamId = String(body.team_id ?? '')
    const userId = String(body.user_id ?? '')
    const agentId = String(body.agent_id ?? '')

    if (url.includes('/v3/conversation/add')) {
      const messages = Array.isArray(body.messages) ? body.messages as Array<{ role?: string, content?: string }> : []
      const acceptedIds = messages.map((message) => {
        const id = `msg-${nextId}`
        nextId += 1
        rows.push({
          teamId,
          userId,
          agentId,
          sessionId: String(body.session_id ?? ''),
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: message.content ?? '',
        })
        return id
      })
      return Response.json({ code: 0, message: 'ok', data: { accepted_ids: acceptedIds, accepted_versions: acceptedIds.map(() => 'v1'), total_count: acceptedIds.length } })
    }

    if (url.includes('/v3/conversation/query') || url.includes('/v3/conversation/search')) {
      const sessionId = body.session_id === undefined ? undefined : String(body.session_id)
      const query = body.query === undefined ? undefined : String(body.query)
      const matched = rows.filter(row => row.teamId === teamId && row.userId === userId && row.agentId === agentId && (sessionId === undefined || row.sessionId === sessionId) && (query === undefined || row.content.includes(query)))
      return Response.json({
        code: 0,
        message: 'ok',
        data: {
          messages: matched.map(row => ({ id: row.content, version: 'v1', role: row.role, content: row.content, session_id: row.sessionId, team_id: row.teamId, user_id: row.userId, agent_id: row.agentId })),
          total: matched.length,
        },
      })
    }

    if (url.includes('/v3/conversation/delete')) {
      return Response.json({ code: 0, message: 'ok', data: { deleted_count: 0 } })
    }

    if (url.includes('/v3/atomic/query')) {
      const matched = atoms.filter(atom => atom.teamId === teamId && atom.userId === userId && atom.agentId === agentId)
      return Response.json({ code: 0, message: 'ok', data: { items: matched.map(atom => ({ id: atom.id, version: 1, type: 'episodic', content: atom.content })), total: matched.length } })
    }

    if (url.includes('/v3/scenario/ls')) {
      const matched = scenes.filter(scene => scene.teamId === teamId && scene.agentId === agentId)
      return Response.json({ code: 0, message: 'ok', data: { entries: matched.map(scene => ({ path: scene.path, version: 1, summary: scene.content })), total: matched.length } })
    }

    if (url.includes('/v3/scenario/read')) {
      const scene = scenes.find(item => item.teamId === teamId && item.agentId === agentId && item.path === body.path)
      return Response.json({ code: 0, message: 'ok', data: { path: String(body.path ?? ''), version: scene ? 1 : null, content: scene?.content ?? null } })
    }

    if (url.includes('/v3/core/read')) {
      const core = cores.find(item => item.teamId === teamId && item.agentId === agentId)
      return Response.json({ code: 0, message: 'ok', data: { content: core?.content ?? null, version: core ? 1 : null, team_id: teamId, agent_id: agentId } })
    }

    return Response.json({ code: 1, message: 'unknown', data: null }, { status: 404 })
  }

  return { fetchImpl, scenes, cores, atoms }
}

describe('scope isolation on a fake gateway', () => {
  it('keeps L0, L2, and L3 apart for two users and one group', async () => {
    const gateway = isolationGateway()
    const raw = createMemoryClient({
      endpoint: 'http://127.0.0.1:8420',
      teamId: 'unused',
      userId: 'unused',
      agentId: 'airi:general',
      serviceId: 'default',
      apiKey: 'local',
    }, { fetch: gateway.fetchImpl })

    const ada = resolveMemoryScope({ platform: 'discord', userId: 'ada', personaId: 'card-1', sessionId: 'session-ada' })
    const bob = resolveMemoryScope({ platform: 'discord', userId: 'bob', personaId: 'card-1', sessionId: 'session-bob' })
    const groupAda = resolveMemoryScope({ platform: 'discord', userId: 'ada', groupId: 'room-1', personaId: 'card-1', sessionId: 'session-group' })
    const groupBob = resolveMemoryScope({ platform: 'discord', userId: 'bob', groupId: 'room-1', personaId: 'card-1', sessionId: 'session-group' })

    await bindMemoryScope(raw, ada).addConversation({
      sessionId: ada.sessionId,
      agentId: ada.agentId,
      messages: [{ role: 'user', content: 'Ada private turn' }, { role: 'assistant', content: 'Ada private reply' }],
    })
    await bindMemoryScope(raw, bob).addConversation({
      sessionId: bob.sessionId,
      agentId: bob.agentId,
      messages: [{ role: 'user', content: 'Bob private turn' }, { role: 'assistant', content: 'Bob private reply' }],
    })
    await bindMemoryScope(raw, groupAda).addConversation({
      sessionId: groupAda.sessionId,
      agentId: groupAda.agentId,
      messages: [{ role: 'user', content: 'Ada group turn' }, { role: 'assistant', content: 'Ada group reply' }],
    })

    await createRemoteMemoryStorage(bindMemoryScope(raw, ada)).write({ description: 'Secret', body: 'Ada private fact' }, 'card-1', 1)
    await createRemoteMemoryStorage(bindMemoryScope(raw, bob)).write({ description: 'Secret', body: 'Bob private fact' }, 'card-1', 1)
    await createRemoteMemoryStorage(bindMemoryScope(raw, groupAda)).write({ description: 'Rule', body: 'Group fact from Ada' }, 'card-1', 1)

    gateway.scenes.push(
      { teamId: ada.teamId, agentId: 'card-1', path: 'private.md', content: 'Ada private scene' },
      { teamId: groupAda.teamId, agentId: 'card-1', path: 'group.md', content: 'Group scene' },
    )
    gateway.cores.push(
      { teamId: ada.teamId, agentId: 'card-1', content: 'Ada private persona' },
      { teamId: groupAda.teamId, agentId: 'card-1', content: 'Group persona' },
    )
    gateway.atoms.push(
      { teamId: ada.teamId, userId: ada.userId, agentId: 'card-1', id: 'atom-ada', content: 'Ada private atom' },
      { teamId: groupAda.teamId, userId: groupAda.userId, agentId: 'card-1', id: 'atom-group-ada', content: 'Ada group atom' },
      { teamId: groupBob.teamId, userId: groupBob.userId, agentId: 'card-1', id: 'atom-group-bob', content: 'Bob group atom' },
    )

    const adaFacts = await createRemoteMemoryStorage(bindMemoryScope(raw, ada)).list()
    const bobFacts = await createRemoteMemoryStorage(bindMemoryScope(raw, bob)).list()
    const groupAdaFacts = await createRemoteMemoryStorage(bindMemoryScope(raw, groupAda)).list()
    const groupBobFacts = await createRemoteMemoryStorage(bindMemoryScope(raw, groupBob)).list()
    const adaChat = await bindMemoryScope(raw, ada).queryConversation({ agentId: ada.agentId, sessionId: ada.sessionId, limit: 20 })
    const groupChat = await bindMemoryScope(raw, groupAda).queryConversation({ agentId: groupAda.agentId, sessionId: groupAda.sessionId, limit: 20 })
    const adaScenes = await bindMemoryScope(raw, ada).listScenarios({ agentId: 'card-1' })
    const groupScenes = await bindMemoryScope(raw, groupBob).listScenarios({ agentId: 'card-1' })
    const adaCore = await bindMemoryScope(raw, ada).readCore({ agentId: 'card-1' })
    const groupCore = await bindMemoryScope(raw, groupBob).readCore({ agentId: 'card-1' })
    const adaAtoms = await bindMemoryScope(raw, ada).queryAtomic({ agentId: 'card-1', limit: 20 })
    const groupAdaAtoms = await bindMemoryScope(raw, groupAda).queryAtomic({ agentId: 'card-1', limit: 20 })
    const groupBobAtoms = await bindMemoryScope(raw, groupBob).queryAtomic({ agentId: 'card-1', limit: 20 })

    expect(ada.teamId).not.toBe(bob.teamId)
    expect(ada.teamId).not.toBe(groupAda.teamId)
    expect(groupAda.teamId).toBe(groupBob.teamId)
    expect(adaFacts.map(entry => entry.body)).toEqual(['Ada private fact'])
    expect(bobFacts.map(entry => entry.body)).toEqual(['Bob private fact'])
    expect(groupAdaFacts.map(entry => entry.body)).toEqual(['Group fact from Ada'])
    expect(groupBobFacts).toEqual([])
    expect(adaChat.messages.map(message => message.content)).toEqual(['Ada private turn', 'Ada private reply'])
    expect(groupChat.messages.map(message => message.content)).toEqual(['Ada group turn', 'Ada group reply'])
    expect(adaScenes.entries.map(entry => entry.summary)).toEqual(['Ada private scene'])
    expect(groupScenes.entries.map(entry => entry.summary)).toEqual(['Group scene'])
    expect(adaCore.content).toBe('Ada private persona')
    expect(groupCore.content).toBe('Group persona')
    expect(adaAtoms.items.map(item => item.content)).toEqual(['Ada private atom'])
    expect(groupAdaAtoms.items.map(item => item.content)).toEqual(['Ada group atom'])
    expect(groupBobAtoms.items.map(item => item.content)).toEqual(['Bob group atom'])
  })

  it('returns a fact from another session and keeps other users and agents out', async () => {
    const gateway = isolationGateway()
    const raw = createMemoryClient({
      endpoint: 'http://127.0.0.1:8420',
      teamId: 'unused',
      userId: 'unused',
      agentId: 'airi:general',
      serviceId: 'default',
      apiKey: 'local',
    }, { fetch: gateway.fetchImpl })

    const ada = resolveMemoryScope({ platform: 'discord', userId: 'ada', personaId: 'card-1', sessionId: 'session-a' })
    const adaLater = resolveMemoryScope({ platform: 'discord', userId: 'ada', personaId: 'card-1', sessionId: 'session-b' })
    const bob = resolveMemoryScope({ platform: 'discord', userId: 'bob', personaId: 'card-1', sessionId: 'session-bob' })
    const otherCard = resolveMemoryScope({ platform: 'discord', userId: 'ada', personaId: 'card-2', sessionId: 'session-other' })
    const fact = '我喜欢吃西瓜'

    await bindMemoryScope(raw, ada).addConversation({
      sessionId: ada.sessionId,
      agentId: ada.agentId,
      messages: [{ role: 'user', content: fact }],
    })
    await bindMemoryScope(raw, adaLater).addConversation({
      sessionId: adaLater.sessionId,
      agentId: adaLater.agentId,
      messages: [{ role: 'user', content: '今天天气好' }],
    })
    await bindMemoryScope(raw, bob).addConversation({
      sessionId: bob.sessionId,
      agentId: bob.agentId,
      messages: [{ role: 'user', content: fact }],
    })
    await bindMemoryScope(raw, otherCard).addConversation({
      sessionId: otherCard.sessionId,
      agentId: otherCard.agentId,
      messages: [{ role: 'user', content: fact }],
    })

    const found = await searchLongTerm(bindMemoryScope(raw, adaLater), {
      query: '西瓜',
      agentId: adaLater.agentId,
      limit: 5,
    })
    const bobFound = await searchLongTerm(bindMemoryScope(raw, bob), {
      query: '西瓜',
      agentId: bob.agentId,
      limit: 5,
    })
    const otherFound = await searchLongTerm(bindMemoryScope(raw, otherCard), {
      query: '西瓜',
      agentId: otherCard.agentId,
      limit: 5,
    })

    expect(ada.teamId).toBe(adaLater.teamId)
    expect(ada.userId).toBe(adaLater.userId)
    expect(ada.agentId).toBe(adaLater.agentId)
    expect(ada.teamId).not.toBe(bob.teamId)
    expect(ada.agentId).not.toBe(otherCard.agentId)
    expect(found.messages.map(message => message.content)).toEqual([fact])
    expect(found.messages.map(message => message.sessionId)).toEqual(['session-a'])
    expect(bobFound.messages.map(message => message.sessionId)).toEqual(['session-bob'])
    expect(otherFound.messages.map(message => message.sessionId)).toEqual(['session-other'])
    expect(bobFound.messages.map(message => message.content)).not.toContain('今天天气好')
    expect(otherFound.messages.map(message => message.content)).not.toContain('今天天气好')
  })
})

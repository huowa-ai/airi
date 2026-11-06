import { describe, expect, it, vi } from 'vitest'

import { confirmIdentityLink, EMPTY_IDENTITY_MAP, parseSceneBinding, readIdentityMap, resolveLocalAccountId, resolveMemoryScope, sanitizeScopeId } from '../src/memory-scope'

describe('resolveMemoryScope', () => {
  it('builds a private team, a group team, and one agent id', () => {
    const local = resolveMemoryScope({ platform: 'local', userId: 'ada', sessionId: 'session-1' })
    const card = resolveMemoryScope({ platform: 'discord', userId: 'ada', personaId: 'card-1', sessionId: 'session-1' })
    const group = resolveMemoryScope({ platform: 'discord', userId: 'ada', groupId: 'channel:a', personaId: 'card-1', sessionId: 'session-1' })

    expect(local).toEqual({ teamId: 'u_local_ada', agentId: 'airi:general', userId: 'ada', sessionId: 'session-1' })
    expect(card.agentId).toBe('card-1')
    expect(card.teamId).toBe('u_discord_ada')
    expect(group.teamId).toBe('g_discord_channel:a')
    expect(group.agentId).toBe('card-1')
    expect(group.userId).toBe('ada')
  })

  it('strips separator and control characters from ids', () => {
    expect(sanitizeScopeId(' ada|bob/chan\\nel\n ')).toBe('adabobchannel')
    const scope = resolveMemoryScope({
      platform: 'dis|cord',
      userId: 'ad/a',
      groupId: 'chan\\nel',
      sessionId: 'ses|sion',
    })

    expect(scope.teamId).toBe('g_discord_channel')
    expect(scope.userId).toBe('ada')
    expect(scope.sessionId).toBe('session')
  })

  it('uses a confirmed identity link for a private team only', () => {
    const link = {
      identities: [
        { platform: 'discord', userId: 'ada' },
        { platform: 'local', userId: 'acct-1' },
      ],
      canonicalTeamId: 'u_canonical',
    }
    const empty = confirmIdentityLink(EMPTY_IDENTITY_MAP, link, false)
    const confirmed = confirmIdentityLink(EMPTY_IDENTITY_MAP, link, true)

    expect(empty).toBe(EMPTY_IDENTITY_MAP)
    expect(confirmed.links).toHaveLength(1)
    expect(resolveMemoryScope({ platform: 'local', userId: 'acct-1', sessionId: 'session-1', identityMap: confirmed }).teamId).toBe('u_canonical')
    expect(resolveMemoryScope({ platform: 'discord', userId: 'ada', groupId: 'room', sessionId: 'session-1', identityMap: confirmed }).teamId).toBe('g_discord_room')
  })

  it('does not call the cross-group hook', () => {
    const teamIdForGroup = vi.fn(() => 'g_shared')
    const scope = resolveMemoryScope({
      platform: 'discord',
      userId: 'ada',
      groupId: 'room-1',
      sessionId: 'session-1',
      crossGroupShare: { teamIdForGroup },
    })

    expect(scope.teamId).toBe('g_discord_room-1')
    expect(teamIdForGroup).not.toHaveBeenCalled()
  })

  it('reuses a stored local account id and creates one only when both sources are empty', () => {
    const createId = vi.fn(() => 'created-1')

    expect(resolveLocalAccountId({ settingsUserId: 'from-settings', storedAccountId: 'stored', createId })).toEqual({ accountId: 'from-settings' })
    expect(resolveLocalAccountId({ settingsUserId: '', storedAccountId: 'stored', createId })).toEqual({ accountId: 'stored' })
    expect(resolveLocalAccountId({ settingsUserId: '', storedAccountId: '', createId })).toEqual({ accountId: 'created-1', storedAccountId: 'created-1' })
    expect(createId).toHaveBeenCalledTimes(1)
  })

  it('parses a scene binding and rejects a map with no links', () => {
    expect(parseSceneBinding('discord:channel:a')).toEqual({ platform: 'discord', groupId: 'channel:a' })
    expect(parseSceneBinding('local')).toBeUndefined()
    expect(readIdentityMap({ links: [] })).toBe(EMPTY_IDENTITY_MAP)
    expect(readIdentityMap({ links: 'nope' })).toBe(EMPTY_IDENTITY_MAP)
  })
})

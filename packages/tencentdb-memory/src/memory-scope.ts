import { array, object, safeParse, string } from 'valibot'

import { agentIdForEntry } from './memory-storage'

const maxPartLength = 80
const maxIdLength = 240

/** Session id for the local settings scope. Chat turns pass the chat session instead. */
export const localScopeSessionId = 'airi:local'

const EMPTY_LINKS: readonly IdentityLink[] = []

/** No confirmed links. The resolver does not merge identities. */
export const EMPTY_IDENTITY_MAP: IdentityMap = { links: EMPTY_LINKS }

/**
 * One platform account that can join a confirmed identity link.
 * `platform` is `local`, `discord`, or another scene name. `userId` is that platform's speaker id.
 */
export interface PlatformIdentity {
  platform: string
  userId: string
}

/**
 * Several platform identities that the owner confirmed as one private team.
 * The resolver reads a stored link. It does not create one.
 */
export interface IdentityLink {
  identities: PlatformIdentity[]
  canonicalTeamId: string
}

/** Confirmed identity links. An empty `links` list merges nothing. */
export interface IdentityMap {
  links: readonly IdentityLink[]
}

/**
 * A later opt-in can name one team for two groups.
 * {@link resolveMemoryScope} does not call this hook. Cross-group sharing stays off.
 */
export interface CrossGroupShareHook {
  teamIdForGroup?: (group: { platform: string, groupId: string }) => string | undefined
}

/**
 * The MemoryCore address for one read or write.
 * Facts and chat use the same `agentId`. The fact session stays `airi:facts` at the write site.
 */
export interface MemoryScope {
  teamId: string
  agentId: string
  userId: string
  sessionId: string
}

/** Input for {@link resolveMemoryScope}. `groupId` selects a group team. */
export interface MemoryScopeRequest {
  platform: string
  /** Real speaker. The local web app uses the stable local account id. */
  userId: string
  /** Set for a group scene. Absent for a private chat. */
  groupId?: string
  /** Character card id. Empty becomes `airi:general`. */
  personaId?: string
  /** AIRI chat session, or the scene binding when that is the session. */
  sessionId: string
  /** Confirmed links only. The default is {@link EMPTY_IDENTITY_MAP}. */
  identityMap?: IdentityMap
  /** Present for a later opt-in. This resolver does not read it. */
  crossGroupShare?: CrossGroupShareHook
}

const identityMapSchema = object({
  links: array(object({
    canonicalTeamId: string(),
    identities: array(object({
      platform: string(),
      userId: string(),
    })),
  })),
})

/**
 * Removes `|`, `/`, `\`, and control characters from one scope id.
 *
 * @example
 * sanitizeScopeId('ada|bob/chan\\nel')
 * // => 'adabobchannel'
 */
export function sanitizeScopeId(value: string) {
  let output = ''
  const source = value.trim()
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? ''
    const code = char.charCodeAt(0)
    if (code <= 31 || code === 127)
      continue
    if (char === '|' || char === '/' || char === '\\')
      continue
    output += char
  }
  return output.length <= maxIdLength ? output : output.slice(0, maxIdLength)
}

/**
 * Reads a stored identity map. A foreign shape is {@link EMPTY_IDENTITY_MAP}.
 *
 * @example
 * readIdentityMap({ links: [] })
 * // => { links: [] }
 */
export function readIdentityMap(value: unknown): IdentityMap {
  const parsed = safeParse(identityMapSchema, value)
  if (!parsed.success || parsed.output.links.length === 0)
    return EMPTY_IDENTITY_MAP
  return {
    links: parsed.output.links.map(link => ({
      canonicalTeamId: link.canonicalTeamId,
      identities: link.identities.map(identity => ({
        platform: identity.platform,
        userId: identity.userId,
      })),
    })),
  }
}

/**
 * Adds one confirmed link. `confirmed` false returns the same map and writes nothing.
 * A link needs two identities. The caller stores the result. This function does not auto-merge.
 *
 * @example
 * confirmIdentityLink({ links: [] }, { identities: [], canonicalTeamId: 'u_canonical' }, false)
 * // => { links: [] }
 */
export function confirmIdentityLink(map: IdentityMap, link: IdentityLink, confirmed: boolean): IdentityMap {
  if (!confirmed)
    return map

  const canonicalTeamId = sanitizeScopeId(link.canonicalTeamId)
  const identities = link.identities.flatMap((identity) => {
    const platform = clipPart(sanitizeScopeId(identity.platform))
    const userId = clipPart(sanitizeScopeId(identity.userId))
    if (!platform || !userId)
      return []
    return [{ platform, userId }]
  })
  if (!canonicalTeamId || identities.length < 2)
    return map

  const next = { identities, canonicalTeamId }
  if (map.links.some(item => sameLink(item, next)))
    return map
  return { links: [...map.links, next] }
}

/**
 * The stable local account id.
 * A settings user id wins. Otherwise the stored id is reused. A missing id is created once.
 *
 * @example
 * resolveLocalAccountId({ settingsUserId: '', storedAccountId: 'acct-1', createId: () => 'new' })
 * // => { accountId: 'acct-1' }
 */
export function resolveLocalAccountId(input: {
  settingsUserId: string
  storedAccountId: string
  createId: () => string
}) {
  const settingsUserId = sanitizeScopeId(input.settingsUserId)
  if (settingsUserId)
    return { accountId: clipPart(settingsUserId) }

  const storedAccountId = sanitizeScopeId(input.storedAccountId)
  if (storedAccountId)
    return { accountId: clipPart(storedAccountId) }

  const created = clipPart(sanitizeScopeId(input.createId()))
  if (!created)
    throw new Error('Local account id is empty.')
  return { accountId: created, storedAccountId: created }
}

/**
 * Resolves `{teamId, agentId, userId, sessionId}` for one speaker.
 * Private and local chats use `u_<platform>_<userId>`. A group uses `g_<platform>_<groupId>`.
 * A confirmed identity link can replace the private team. It does not replace a group team.
 * The agent id is the character card, or `airi:general`. Facts use that same id.
 *
 * @example
 * resolveMemoryScope({ platform: 'local', userId: 'ada', sessionId: 'session-1' })
 * // => { teamId: 'u_local_ada', agentId: 'airi:general', userId: 'ada', sessionId: 'session-1' }
 */
export function resolveMemoryScope(input: MemoryScopeRequest): MemoryScope {
  const platform = clipPart(sanitizeScopeId(input.platform))
  const userId = clipPart(sanitizeScopeId(input.userId))
  const sessionId = sanitizeScopeId(input.sessionId)
  if (!platform)
    throw new Error('Memory scope platform is empty.')
  if (!userId)
    throw new Error('Memory scope user id is empty.')
  if (!sessionId)
    throw new Error('Memory scope session id is empty.')

  const groupId = input.groupId === undefined ? '' : clipPart(sanitizeScopeId(input.groupId))
  if (input.groupId !== undefined && !groupId)
    throw new Error('Memory scope group id is empty.')

  // The hook stays on the request so a later opt-in has a typed slot. Sharing stays off.
  const teamId = groupId
    ? groupTeamId(platform, groupId)
    : privateTeamId(platform, userId, input.identityMap)

  return {
    teamId,
    agentId: agentIdForEntry({ persona: input.personaId }),
    userId,
    sessionId,
  }
}

/**
 * Splits a scene binding into a platform and a group id.
 * `discord:channel:a` keeps `channel:a` as the group id.
 *
 * @example
 * parseSceneBinding('discord:channel:a')
 * // => { platform: 'discord', groupId: 'channel:a' }
 */
export function parseSceneBinding(binding: string) {
  const cleaned = sanitizeScopeId(binding)
  const splitAt = cleaned.indexOf(':')
  if (splitAt <= 0 || splitAt >= cleaned.length - 1)
    return undefined
  const platform = clipPart(cleaned.slice(0, splitAt))
  const groupId = clipPart(cleaned.slice(splitAt + 1))
  if (!platform || !groupId)
    return undefined
  return { platform, groupId }
}

function privateTeamId(platform: string, userId: string, map: IdentityMap | undefined) {
  const links = map?.links ?? EMPTY_LINKS
  for (const link of links) {
    const canonicalTeamId = sanitizeScopeId(link.canonicalTeamId)
    if (!canonicalTeamId)
      continue
    const matched = link.identities.some(identity => identity.platform === platform && identity.userId === userId)
    if (matched)
      return clipId(canonicalTeamId)
  }
  return groupOrPrivateTeam('u', platform, userId)
}

function groupTeamId(platform: string, groupId: string) {
  return groupOrPrivateTeam('g', platform, groupId)
}

function groupOrPrivateTeam(prefix: 'u' | 'g', platform: string, id: string) {
  return clipId(`${prefix}_${platform}_${id}`)
}

function clipPart(value: string) {
  return value.length <= maxPartLength ? value : value.slice(0, maxPartLength)
}

function clipId(value: string) {
  return value.length <= maxIdLength ? value : value.slice(0, maxIdLength)
}

function sameLink(left: IdentityLink, right: IdentityLink) {
  if (left.canonicalTeamId !== right.canonicalTeamId || left.identities.length !== right.identities.length)
    return false
  return left.identities.every(identity => right.identities.some(other => other.platform === identity.platform && other.userId === identity.userId))
}

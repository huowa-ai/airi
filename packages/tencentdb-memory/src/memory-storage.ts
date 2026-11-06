import type { ChatEventAttachment } from '@proj-airi/plugin-protocol/types'

import { ASSET_REF_PREFIX } from '@proj-airi/plugin-protocol/types'
import { v7 as uuidv7 } from 'uuid'

/**
 * Reserved `agent_id` for a memory the owner made general.
 * The entry has no `persona`. Every card reads it.
 */
export const GENERAL_AGENT_ID = 'airi:general'

/**
 * How the source turn was captured.
 * `text` is a chat text turn. `audio` and `image` match `ChatEventAttachment.type`.
 * A video frame is an image asset ref. This package does not store a video byte stream.
 */
export type MemoryModality = 'text' | ChatEventAttachment['type']

/**
 * Where a fact came from. The card still owns the fact. The session does not split the card's memory.
 * Asset refs use `airi-asset:<id>`. The bytes stay in the asset store.
 */
export interface MemoryProvenance {
  /** Chat session or voice `TurnRef.sessionId`. */
  sessionId?: string
  /** Voice `TurnRef.turnId`, or a chat message id when the host has one. */
  turnId?: string
  /** External scene from `InputMessageOverrides.binding`. */
  binding?: string
  modality?: MemoryModality
  /** `ChatEventAttachment.ref` values. Not audio, image, or video bytes. */
  assetRefs?: readonly string[]
}

/**
 * One remembered fact.
 * `id`, `description`, `body`, `persona`, and `updatedAt` match `packages/stage-ui/src/types/memory.ts`.
 * `provenance` is optional source data the stage store does not read yet.
 */
export interface MemoryEntry {
  /** Stable id. The store mints a UUIDv7, or the caller passes an id it already uses. */
  id: string
  description: string
  body: string
  /** The character card. Absent means the memory is general. */
  persona?: string
  updatedAt: number
  provenance?: MemoryProvenance
}

/** A fact to save. An owned id replaces that entry. A missing id adds an entry. */
export interface MemoryWrite {
  id?: string
  description: string
  body: string
  /**
   * Present when this write knows the source turn.
   * Omitted on a replace keeps the stored provenance.
   */
  provenance?: MemoryProvenance
}

export type MemoryMutation
  = | { outcome: 'saved', entry: MemoryEntry }
    | { outcome: 'unchanged', entry: MemoryEntry }
    | { outcome: 'empty' }
    | { outcome: 'missing' }
    | { outcome: 'stale', storedUpdatedAt: number }

/**
 * Records for one team and one user, inside one process.
 * `useMemoryStore` will call this instead of the IndexedDB repo.
 * A newer `updatedAt` replaces a record in this process. An older time does not.
 * That rule is not cross-device sync.
 */
export interface MemoryStorage {
  /** Live entries, oldest change first. */
  list: () => Promise<MemoryEntry[]>
  /**
   * Saves a fact on the card.
   * An empty body saves nothing.
   * An id that this card owns, or that is absent from the scope, keeps that id.
   * An id of another card or of a general entry adds a new id.
   */
  write: (input: MemoryWrite, persona: string, updatedAt: number) => Promise<MemoryMutation>
  /** Makes a card entry general when `updatedAt` is newer. */
  makeGeneral: (id: string, updatedAt: number) => Promise<MemoryMutation>
  /**
   * Removes one entry of the card.
   * A general entry stays. An older time stays. Resolves to whether this call removed it.
   */
  forget: (id: string, persona: string, updatedAt: number) => Promise<boolean>
  /** Removes entries for the owner, general entries included, when `updatedAt` is newer. */
  remove: (ids: string[], updatedAt: number) => Promise<void>
  /** Drops every record in the scope. A later write at or before `updatedAt` does not return. */
  clear: (updatedAt: number) => Promise<void>
  /** Deletes one fact by id. The row does not stay as a tombstone. */
  destroy: (id: string) => Promise<boolean>
}

interface MemoryTombstone {
  id: string
  updatedAt: number
  deleted: true
}

type StoredMemory = MemoryEntry | MemoryTombstone

interface ScopeBucket {
  records: Map<string, StoredMemory>
  clearedAt: number
}

/**
 * In-process rows keyed by team id and user id.
 * Two storages can share one map in tests. That does not sync two devices.
 * Writes on one map run one at a time.
 */
export class MemoryRecordMap {
  private readonly buckets = new Map<string, ScopeBucket>()
  private tail: Promise<void> = Promise.resolve()

  run<T>(task: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(task)
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }

  bucket(teamId: string, userId: string) {
    const key = `${teamId}\0${userId}`
    const existing = this.buckets.get(key)
    if (existing)
      return existing

    const created: ScopeBucket = { records: new Map(), clearedAt: 0 }
    this.buckets.set(key, created)
    return created
  }
}

export function createMemoryRecordMap() {
  return new MemoryRecordMap()
}

/** The `agent_id` for an entry. A general entry uses {@link GENERAL_AGENT_ID}. */
export function agentIdForEntry(entry: Pick<MemoryEntry, 'persona'>) {
  return entry.persona && entry.persona.length > 0 ? entry.persona : GENERAL_AGENT_ID
}

export interface FakeMemoryStorageOptions {
  teamId: string
  userId: string
  /** Pass one map to more than one storage so those callers share rows. */
  records?: MemoryRecordMap
  createId?: () => string
}

/**
 * In-process `MemoryStorage`. Tests and the module use it until the MemoryCore adapter exists.
 *
 * @example
 * const records = createMemoryRecordMap()
 * const web = createFakeMemoryStorage({ teamId: 'team-1', userId: 'user-1', records })
 * const desktop = createFakeMemoryStorage({ teamId: 'team-1', userId: 'user-1', records })
 */
export function createFakeMemoryStorage(options: FakeMemoryStorageOptions): MemoryStorage {
  assertScopeId(options.teamId, 'teamId')
  assertScopeId(options.userId, 'userId')

  return new FakeMemoryStorage(
    options.teamId,
    options.userId,
    options.records ?? createMemoryRecordMap(),
    options.createId ?? uuidv7,
  )
}

class FakeMemoryStorage implements MemoryStorage {
  constructor(
    private readonly teamId: string,
    private readonly userId: string,
    private readonly records: MemoryRecordMap,
    private readonly createId: () => string,
  ) {}

  list() {
    return this.records.run(() => {
      const bucket = this.records.bucket(this.teamId, this.userId)
      return [...bucket.records.values()]
        .filter((record): record is MemoryEntry => !isTombstone(record))
        .map(copyEntry)
        .sort((left, right) => left.updatedAt - right.updatedAt || left.id.localeCompare(right.id))
    })
  }

  write(input: MemoryWrite, persona: string, updatedAt: number) {
    assertPersona(persona)
    assertTime(updatedAt)
    const description = input.description.trim()
    const body = input.body.trim()
    const provenanceProvided = input.provenance !== undefined

    return this.records.run(() => {
      const provenance = input.provenance === undefined ? undefined : normalizeProvenance(input.provenance)
      if (!body)
        return { outcome: 'empty' as const }

      const bucket = this.records.bucket(this.teamId, this.userId)
      if (updatedAt <= bucket.clearedAt)
        return { outcome: 'stale' as const, storedUpdatedAt: bucket.clearedAt }

      const existing = input.id ? bucket.records.get(input.id) : undefined
      if (!existing) {
        const entry = this.entry(input.id ?? this.createId(), description, body, persona, updatedAt, provenance)
        bucket.records.set(entry.id, entry)
        return { outcome: 'saved' as const, entry: copyEntry(entry) }
      }

      if (isTombstone(existing)) {
        if (updatedAt <= existing.updatedAt)
          return { outcome: 'stale' as const, storedUpdatedAt: existing.updatedAt }

        const entry = this.entry(existing.id, description, body, persona, updatedAt, provenance)
        bucket.records.set(entry.id, entry)
        return { outcome: 'saved' as const, entry: copyEntry(entry) }
      }

      if (existing.persona === persona)
        return this.replace(bucket, existing, description, body, persona, updatedAt, provenance, provenanceProvided)

      const entry = this.entry(this.createId(), description, body, persona, updatedAt, provenance)
      bucket.records.set(entry.id, entry)
      return { outcome: 'saved' as const, entry: copyEntry(entry) }
    })
  }

  makeGeneral(id: string, updatedAt: number) {
    assertTime(updatedAt)

    return this.records.run(() => {
      const bucket = this.records.bucket(this.teamId, this.userId)
      const existing = bucket.records.get(id)
      if (!existing || isTombstone(existing))
        return { outcome: 'missing' as const }
      if (!existing.persona)
        return { outcome: 'unchanged' as const, entry: copyEntry(existing) }
      if (updatedAt <= existing.updatedAt)
        return { outcome: 'stale' as const, storedUpdatedAt: existing.updatedAt }
      if (updatedAt <= bucket.clearedAt)
        return { outcome: 'stale' as const, storedUpdatedAt: bucket.clearedAt }

      const { persona: _persona, ...rest } = existing
      const entry: MemoryEntry = { ...rest, updatedAt }
      bucket.records.set(id, entry)
      return { outcome: 'saved' as const, entry: copyEntry(entry) }
    })
  }

  forget(id: string, persona: string, updatedAt: number) {
    assertPersona(persona)
    assertTime(updatedAt)

    return this.records.run(() => {
      const bucket = this.records.bucket(this.teamId, this.userId)
      const existing = bucket.records.get(id)
      if (!existing || isTombstone(existing) || existing.persona !== persona)
        return false
      if (updatedAt <= existing.updatedAt || updatedAt <= bucket.clearedAt)
        return false

      bucket.records.set(id, { id, updatedAt, deleted: true })
      return true
    })
  }

  remove(ids: string[], updatedAt: number) {
    assertTime(updatedAt)

    return this.records.run(() => {
      const bucket = this.records.bucket(this.teamId, this.userId)
      if (updatedAt <= bucket.clearedAt)
        return

      for (const id of ids) {
        const existing = bucket.records.get(id)
        if (!existing || isTombstone(existing) || updatedAt <= existing.updatedAt)
          continue

        bucket.records.set(id, { id, updatedAt, deleted: true })
      }
    })
  }

  destroy(id: string) {
    return this.records.run(() => {
      const bucket = this.records.bucket(this.teamId, this.userId)
      return bucket.records.delete(id)
    })
  }

  clear(updatedAt: number) {
    assertTime(updatedAt)

    return this.records.run(() => {
      const bucket = this.records.bucket(this.teamId, this.userId)
      bucket.records.clear()
      if (updatedAt > bucket.clearedAt)
        bucket.clearedAt = updatedAt
    })
  }

  private replace(
    bucket: ScopeBucket,
    existing: MemoryEntry,
    description: string,
    body: string,
    persona: string,
    updatedAt: number,
    provenance: MemoryProvenance | undefined,
    provenanceProvided: boolean,
  ): MemoryMutation {
    if (updatedAt < existing.updatedAt)
      return { outcome: 'stale', storedUpdatedAt: existing.updatedAt }

    const nextProvenance = provenanceProvided ? provenance : existing.provenance
    if (updatedAt === existing.updatedAt) {
      if (existing.description === description && existing.body === body && sameProvenance(existing.provenance, nextProvenance))
        return { outcome: 'saved', entry: copyEntry(existing) }
      return { outcome: 'stale', storedUpdatedAt: existing.updatedAt }
    }

    const entry = this.entry(existing.id, description, body, persona, updatedAt, nextProvenance)
    bucket.records.set(entry.id, entry)
    return { outcome: 'saved', entry: copyEntry(entry) }
  }

  private entry(
    id: string,
    description: string,
    body: string,
    persona: string,
    updatedAt: number,
    provenance: MemoryProvenance | undefined,
  ): MemoryEntry {
    return {
      id,
      description,
      body,
      persona,
      updatedAt,
      ...(provenance ? { provenance } : {}),
    }
  }
}

function copyEntry(entry: MemoryEntry): MemoryEntry {
  if (!entry.provenance)
    return { ...entry }

  return {
    ...entry,
    provenance: copyProvenance(entry.provenance),
  }
}

function copyProvenance(value: MemoryProvenance): MemoryProvenance {
  return {
    ...value,
    ...(value.assetRefs ? { assetRefs: [...value.assetRefs] } : {}),
  }
}

function sameProvenance(left: MemoryProvenance | undefined, right: MemoryProvenance | undefined) {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {})
}

function normalizeProvenance(value: MemoryProvenance): MemoryProvenance | undefined {
  const sessionId = optionalToken(value.sessionId, 'A session id')
  const turnId = optionalToken(value.turnId, 'A turn id')
  const binding = optionalToken(value.binding, 'A binding')
  const modality = value.modality
  if (modality !== undefined && modality !== 'text' && modality !== 'audio' && modality !== 'image')
    throw new Error('Memory modality must be text, audio, or image.')

  const assetRefs = value.assetRefs?.map(assetRef)
  if (assetRefs && assetRefs.length > 8)
    throw new Error('A memory fact can cite at most 8 asset refs.')

  const provenance: MemoryProvenance = {
    ...(sessionId ? { sessionId } : {}),
    ...(turnId ? { turnId } : {}),
    ...(binding ? { binding } : {}),
    ...(modality ? { modality } : {}),
    ...(assetRefs && assetRefs.length > 0 ? { assetRefs } : {}),
  }

  return Object.keys(provenance).length > 0 ? provenance : undefined
}

function optionalToken(value: string | undefined, label: string) {
  if (value === undefined)
    return undefined
  if (value.trim() === '' || value !== value.trim() || value.length > 256)
    throw new Error(`${label} must be 1 to 256 characters.`)
  return value
}

function assetRef(ref: string) {
  if (!ref.startsWith(ASSET_REF_PREFIX))
    throw new Error('An asset ref must start with the airi-asset prefix.')

  const id = ref.slice(ASSET_REF_PREFIX.length)
  if (id.length < 1 || id.length > 128 || id !== id.trim() || /\s/.test(id))
    throw new Error('An asset ref id must be 1 to 128 characters without space.')

  return ref
}

function isTombstone(record: StoredMemory): record is MemoryTombstone {
  return 'deleted' in record
}

function assertTime(updatedAt: number) {
  if (!Number.isFinite(updatedAt))
    throw new Error('Memory time must be a finite number.')
}

function assertPersona(persona: string) {
  if (persona.trim() === '')
    throw new Error('A card memory needs a persona id.')
}

function assertScopeId(value: string, label: string) {
  if (value.trim() === '')
    throw new Error(`A memory scope needs a ${label}.`)
}

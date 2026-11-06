import type { MemoryV3Client } from './memory-client'

import { errorMessageFrom } from '@moeru/std'

import { readFactAgentIds } from './remote-memory'

const pageSize = 100
const maxAtoms = 500
const maxScenes = 40

export interface MemoryAtom {
  id: string
  agentId: string
  type: string
  content: string
  background?: string
  updatedAt?: number
}

export interface MemorySceneFile {
  path: string
  agentId: string
  summary?: string
  content?: string
  updatedAt?: number
}

export interface MemoryCoreText {
  agentId: string
  content: string
  updatedAt?: number
}

export interface MemoryLayerResult<T> {
  status: 'ready' | 'error'
  error: string
  truncated: boolean
  items: T[]
}

/**
 * L1 atoms, L2 scene files, and L3 persona text for the fact agents.
 * L2 and L3 follow the team and the agent. The user id is sent and does not isolate those layers.
 * A failed layer returns no rows. The other layers still return.
 */
export interface MemoryLayerSnapshot {
  atoms: MemoryLayerResult<MemoryAtom>
  scenes: MemoryLayerResult<MemorySceneFile>
  cores: MemoryLayerResult<MemoryCoreText>
}

/**
 * Reads L1, L2, and L3 for every fact agent.
 * L2 directories are skipped. A missing L3 persona is an empty result, not an error.
 */
export async function readMemoryLayers(client: MemoryV3Client): Promise<MemoryLayerSnapshot> {
  let agents: string[]
  try {
    agents = await readFactAgentIds(client)
  }
  catch (error) {
    const message = layerError(error)
    return {
      atoms: failed(message),
      scenes: failed(message),
      cores: failed(message),
    }
  }

  const [atoms, scenes, cores] = await Promise.all([
    readAtoms(client, agents),
    readScenes(client, agents),
    readCores(client, agents),
  ])
  return { atoms, scenes, cores }
}

async function readAtoms(client: MemoryV3Client, agents: readonly string[]): Promise<MemoryLayerResult<MemoryAtom>> {
  try {
    const items: MemoryAtom[] = []
    let truncated = false
    for (const agentId of agents) {
      if (items.length >= maxAtoms) {
        truncated = true
        break
      }
      let offset = 0
      let total = Number.POSITIVE_INFINITY
      while (offset < total && items.length < maxAtoms) {
        const page = await client.queryAtomic({ agentId, limit: pageSize, offset })
        total = page.total
        if (page.items.length === 0)
          break
        for (const item of page.items) {
          if (items.length >= maxAtoms) {
            truncated = true
            break
          }
          items.push({
            id: item.id,
            agentId,
            type: item.type,
            content: item.content,
            ...(item.background ? { background: item.background } : {}),
            ...timeField(item.updatedAt),
          })
        }
        offset += page.items.length
      }
      if (offset < total)
        truncated = true
    }
    return { status: 'ready', error: '', truncated, items }
  }
  catch (error) {
    return failed(layerError(error))
  }
}

async function readScenes(client: MemoryV3Client, agents: readonly string[]): Promise<MemoryLayerResult<MemorySceneFile>> {
  try {
    const files: Array<{ agentId: string, path: string, summary?: string, updatedAt?: string }> = []
    for (const agentId of agents) {
      const listed = await client.listScenarios({ agentId })
      for (const entry of listed.entries) {
        if (entry.path.endsWith('/'))
          continue
        files.push({
          agentId,
          path: entry.path,
          ...(entry.summary ? { summary: entry.summary } : {}),
          ...(entry.updatedAt ? { updatedAt: entry.updatedAt } : {}),
        })
      }
    }

    const truncated = files.length > maxScenes
    const items: MemorySceneFile[] = []
    for (const file of files.slice(0, maxScenes)) {
      const read = await client.readScenario({ agentId: file.agentId, path: file.path })
      const content = read.content?.trim()
      items.push({
        path: file.path,
        agentId: file.agentId,
        ...(file.summary ? { summary: file.summary } : {}),
        ...(content ? { content } : {}),
        ...timeField(read.updatedAt ?? file.updatedAt),
      })
    }
    return { status: 'ready', error: '', truncated, items }
  }
  catch (error) {
    return failed(layerError(error))
  }
}

async function readCores(client: MemoryV3Client, agents: readonly string[]): Promise<MemoryLayerResult<MemoryCoreText>> {
  try {
    const items: MemoryCoreText[] = []
    for (const agentId of agents) {
      const read = await client.readCore({ agentId })
      const content = read.content?.trim() ?? ''
      if (!content)
        continue
      items.push({
        agentId,
        content,
        ...timeField(read.updatedAt),
      })
    }
    return { status: 'ready', error: '', truncated: false, items }
  }
  catch (error) {
    return failed(layerError(error))
  }
}

function timeField(value: string | undefined) {
  const updatedAt = timeFromIso(value)
  return updatedAt === undefined ? {} : { updatedAt }
}

function timeFromIso(value: string | undefined) {
  if (!value)
    return undefined
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : undefined
}

function failed<T>(message: string): MemoryLayerResult<T> {
  return { status: 'error', error: message, truncated: false, items: [] }
}

function layerError(error: unknown) {
  return errorMessageFrom(error) ?? 'MemoryCore request failed.'
}

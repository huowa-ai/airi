import type { CallTurnRecord, MemoryLayerSnapshot } from '@proj-airi/tencentdb-memory'

import { GENERAL_AGENT_ID } from '@proj-airi/tencentdb-memory'

export interface MemoryLayerItemState<T> {
  status: 'ready' | 'error'
  error: string
  truncated: boolean
  items: readonly T[]
}

export interface MemoryAtomView {
  id: string
  persona?: string
  type: string
  content: string
  background?: string
  updatedAt?: number
}

export interface MemorySceneView {
  path: string
  persona?: string
  summary?: string
  content?: string
  updatedAt?: number
}

export interface MemoryCoreView {
  persona?: string
  content: string
  updatedAt?: number
}

/** One tagged L0 chat row. The body has the call header removed. */
export interface MemoryCallTurn {
  id: string
  body: string
  persona?: string
  callId?: string
  source?: 'voice' | 'video' | 'text'
  sessionId?: string
}

/** L1–L3 rows for the graph. L2 and L3 follow the resolved team and the character. */
export interface MemoryLayerView {
  atoms: MemoryLayerItemState<MemoryAtomView>
  scenes: MemoryLayerItemState<MemorySceneView>
  cores: MemoryLayerItemState<MemoryCoreView>
}

const NO_ITEMS: readonly never[] = []

function emptyLayer<T>(): MemoryLayerItemState<T> {
  return { status: 'ready', error: '', truncated: false, items: NO_ITEMS }
}

export const EMPTY_MEMORY_LAYERS: MemoryLayerView = {
  atoms: emptyLayer(),
  scenes: emptyLayer(),
  cores: emptyLayer(),
}

/**
 * Maps a MemoryCore layer snapshot onto character ids the graph can label.
 * `airi:general` has no persona. Any other agent id is the character card id.
 */
/** Maps a tagged L0 row onto a character id the graph can label. */
export function viewCallTurn(record: CallTurnRecord): MemoryCallTurn {
  return {
    id: record.id,
    body: record.body,
    ...personaField(record.agentId),
    ...(record.callId ? { callId: record.callId } : {}),
    ...(record.source ? { source: record.source } : {}),
    ...(record.sessionId ? { sessionId: record.sessionId } : {}),
  }
}

export function viewMemoryLayers(snapshot: MemoryLayerSnapshot): MemoryLayerView {
  return {
    atoms: {
      status: snapshot.atoms.status,
      error: snapshot.atoms.error,
      truncated: snapshot.atoms.truncated,
      items: snapshot.atoms.items.map(item => ({
        id: item.id,
        ...personaField(item.agentId),
        type: item.type,
        content: item.content,
        ...(item.background ? { background: item.background } : {}),
        ...(item.updatedAt === undefined ? {} : { updatedAt: item.updatedAt }),
      })),
    },
    scenes: {
      status: snapshot.scenes.status,
      error: snapshot.scenes.error,
      truncated: snapshot.scenes.truncated,
      items: snapshot.scenes.items.map(item => ({
        path: item.path,
        ...personaField(item.agentId),
        ...(item.summary ? { summary: item.summary } : {}),
        ...(item.content ? { content: item.content } : {}),
        ...(item.updatedAt === undefined ? {} : { updatedAt: item.updatedAt }),
      })),
    },
    cores: {
      status: snapshot.cores.status,
      error: snapshot.cores.error,
      truncated: snapshot.cores.truncated,
      items: snapshot.cores.items.map(item => ({
        ...personaField(item.agentId),
        content: item.content,
        ...(item.updatedAt === undefined ? {} : { updatedAt: item.updatedAt }),
      })),
    },
  }
}

function personaField(agentId: string) {
  if (agentId === GENERAL_AGENT_ID)
    return {}
  return { persona: agentId }
}

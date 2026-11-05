import { array, object, optional, safeParse, string } from 'valibot'

/** Layers this page does not invent. They appear only after a real query returns them. */
export const ABSENT_MEMORY_LAYERS = ['L1', 'L2', 'L3'] as const

export type MemoryGraphStatus = 'off' | 'loading' | 'error' | 'ready'

export interface MemoryGraphFact {
  id: string
  description: string
  body: string
  persona?: string
  updatedAt: number
  provenance?: unknown
}

/** One L0 fact placed inside an approximate whale body. The coordinates are layout, not stored data. */
export interface MemoryGraphNode {
  id: string
  label: string
  layer: 'L0'
  x: number
  y: number
  z: number
}

/** A line the view draws so the facts sit in one picture. It is not a stored relation. */
export interface MemoryGraphLink {
  source: string
  target: string
  derived: true
}

export interface MemoryGraphModel {
  status: MemoryGraphStatus
  error: string
  nodes: readonly MemoryGraphNode[]
  links: readonly MemoryGraphLink[]
  absentLayers: readonly ('L1' | 'L2' | 'L3')[]
}

export interface MemoryGraphSource {
  sessionId?: string
  turnId?: string
  binding?: string
  modality?: string
  assetRefs: readonly string[]
}

const sourceSchema = object({
  sessionId: optional(string()),
  turnId: optional(string()),
  binding: optional(string()),
  modality: optional(string()),
  assetRefs: optional(array(string())),
})

/**
 * Builds the graph from the live service list.
 * `off`, `loading`, and `error` draw no nodes, even when `facts` is not empty.
 * Every node is an L0 fact. Every link is derived.
 */
export function buildMemoryGraph(input: {
  serviceRead: MemoryGraphStatus
  serviceError: string
  facts: readonly MemoryGraphFact[]
}): MemoryGraphModel {
  if (input.serviceRead !== 'ready') {
    return {
      status: input.serviceRead,
      error: input.serviceRead === 'error' ? input.serviceError : '',
      nodes: [],
      links: [],
      absentLayers: ABSENT_MEMORY_LAYERS,
    }
  }

  const facts = [...input.facts].sort((left, right) => left.updatedAt - right.updatedAt || left.id.localeCompare(right.id))
  const nodes = facts.map((fact, index) => {
    const point = whalePoint(index, facts.length)
    return {
      id: fact.id,
      label: fact.description.trim() || fact.body.trim() || fact.id,
      layer: 'L0' as const,
      x: point.x,
      y: point.y,
      z: point.z,
    }
  })

  return {
    status: 'ready',
    error: '',
    nodes,
    links: derivedLinks(nodes),
    absentLayers: ABSENT_MEMORY_LAYERS,
  }
}

/** Reads source fields when a fact has them. A missing or foreign shape returns undefined. */
export function readMemoryGraphSource(provenance: unknown): MemoryGraphSource | undefined {
  const parsed = safeParse(sourceSchema, provenance)
  if (!parsed.success)
    return undefined
  const source: MemoryGraphSource = {
    ...(parsed.output.sessionId ? { sessionId: parsed.output.sessionId } : {}),
    ...(parsed.output.turnId ? { turnId: parsed.output.turnId } : {}),
    ...(parsed.output.binding ? { binding: parsed.output.binding } : {}),
    ...(parsed.output.modality ? { modality: parsed.output.modality } : {}),
    assetRefs: parsed.output.assetRefs ?? [],
  }
  if (!source.sessionId && !source.turnId && !source.binding && !source.modality && source.assetRefs.length === 0)
    return undefined
  return source
}

/**
 * Places fact `index` inside a side-view whale body.
 * The body is an approximate oval. Tail and fins are not modeled.
 */
export function whalePoint(index: number, count: number) {
  if (count <= 1)
    return { x: 0, y: 0, z: 0 }
  const slot = index / (count - 1)
  const along = -36 + slot * 72
  const body = Math.sin(slot * Math.PI)
  const turn = index * 2.399
  return {
    x: along,
    y: Math.cos(turn) * body * 14,
    z: Math.sin(turn) * body * 8,
  }
}

function derivedLinks(nodes: readonly MemoryGraphNode[]): MemoryGraphLink[] {
  const links: MemoryGraphLink[] = []
  for (let index = 1; index < nodes.length; index += 1) {
    const source = nodes[index - 1]
    const target = nodes[index]
    if (!source || !target)
      continue
    links.push({ source: source.id, target: target.id, derived: true })
  }
  return links
}

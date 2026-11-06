import { array, object, optional, safeParse, string } from 'valibot'

export type MemoryGraphStatus = 'off' | 'loading' | 'error' | 'ready'
export type MemoryGraphLayer = 'L0' | 'L1' | 'L2' | 'L3'
export type MemoryGraphKind = 'fact' | 'atom' | 'scene' | 'core'
export type MemoryGraphScope = 'user' | 'team-agent'
export type MemoryGraphCallSource = 'voice' | 'video' | 'text'

export interface MemoryGraphFact {
  id: string
  description: string
  body: string
  persona?: string
  updatedAt?: number
  provenance?: unknown
  /** Set on a chat row. A manual fact omits it. */
  origin?: 'turn'
  callId?: string
  source?: MemoryGraphCallSource
}

export interface MemoryGraphAtom {
  id: string
  persona?: string
  type: string
  content: string
  background?: string
  updatedAt?: number
}

export interface MemoryGraphScene {
  path: string
  persona?: string
  summary?: string
  content?: string
  updatedAt?: number
}

export interface MemoryGraphCore {
  persona?: string
  content: string
  updatedAt?: number
}

export interface MemoryGraphLayerError {
  layer: 'L1' | 'L2' | 'L3'
  message: string
}

/** One record placed in a whale zone. The coordinates are layout, not stored data. */
export interface MemoryGraphNode {
  id: string
  label: string
  layer: MemoryGraphLayer
  kind: MemoryGraphKind
  scope: MemoryGraphScope
  x: number
  y: number
  z: number
  callId?: string
  source?: MemoryGraphCallSource
}

/** A line the view draws so the records sit in one picture. It is not a stored relation. */
export interface MemoryGraphLink {
  source: string
  target: string
  derived: true
}

export interface MemoryGraphSection {
  heading: string
  body: string
}

export interface MemoryGraphDetail {
  id: string
  label: string
  layer: MemoryGraphLayer
  kind: MemoryGraphKind
  scope: MemoryGraphScope
  persona?: string
  body: string
  background?: string
  type?: string
  path?: string
  /** Service id for an atom. `id` on an atom detail is the layout id. */
  recordId?: string
  summary?: string
  updatedAt?: number
  sections: readonly MemoryGraphSection[]
  callId?: string
  source?: MemoryGraphCallSource
  /** False for a call turn. Fact delete does not own that row. */
  removable?: boolean
}

export interface MemoryGraphCallFilter {
  callId?: string
  source?: MemoryGraphCallSource
}

export interface MemoryGraphModel {
  status: MemoryGraphStatus
  error: string
  nodes: readonly MemoryGraphNode[]
  links: readonly MemoryGraphLink[]
  details: readonly MemoryGraphDetail[]
  /** Layers that returned at least one record. Empty layers are omitted. */
  legend: readonly MemoryGraphLayer[]
  layerErrors: readonly MemoryGraphLayerError[]
  truncatedLayers: readonly ('L1' | 'L2' | 'L3')[]
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

const NO_ATOMS: readonly MemoryGraphAtom[] = []
const NO_SCENES: readonly MemoryGraphScene[] = []
const NO_CORES: readonly MemoryGraphCore[] = []
const NO_ERRORS: readonly MemoryGraphLayerError[] = []
const NO_TRUNCATED: readonly ('L1' | 'L2' | 'L3')[] = []

/**
 * Builds the graph from the records a MemoryCore read returned.
 * `off`, `loading`, and `error` draw no nodes.
 * L3 is one persona node per character. Sections stay in the detail.
 * Every link is derived. L2 and L3 use team-and-character scope.
 */
export function buildMemoryGraph(input: {
  serviceRead: MemoryGraphStatus
  serviceError: string
  facts: readonly MemoryGraphFact[]
  atoms?: readonly MemoryGraphAtom[]
  scenes?: readonly MemoryGraphScene[]
  cores?: readonly MemoryGraphCore[]
  layerErrors?: readonly MemoryGraphLayerError[]
  truncatedLayers?: readonly ('L1' | 'L2' | 'L3')[]
  /** Label for a persona file that has no heading and no text. */
  personaLabel?: string
}): MemoryGraphModel {
  const layerErrors = input.layerErrors ?? NO_ERRORS
  const truncatedLayers = input.truncatedLayers ?? NO_TRUNCATED
  if (input.serviceRead !== 'ready') {
    return {
      status: input.serviceRead,
      error: input.serviceRead === 'error' ? input.serviceError : '',
      nodes: [],
      links: [],
      details: [],
      legend: [],
      layerErrors: [],
      truncatedLayers: [],
    }
  }

  const facts = [...input.facts].sort((left, right) => (left.updatedAt ?? 0) - (right.updatedAt ?? 0) || left.id.localeCompare(right.id))
  const atoms = [...(input.atoms ?? NO_ATOMS)].sort((left, right) => (left.updatedAt ?? 0) - (right.updatedAt ?? 0) || left.id.localeCompare(right.id))
  const scenes = [...(input.scenes ?? NO_SCENES)].sort((left, right) => left.path.localeCompare(right.path))
  const cores = [...(input.cores ?? NO_CORES)].sort((left, right) => (left.persona ?? '').localeCompare(right.persona ?? ''))
  const personaLabel = input.personaLabel ?? ''
  const layered = atoms.length + scenes.length + cores.length > 0

  const factNodes = facts.map((fact, index) => ({
    ...node({
      id: fact.id,
      label: fact.description.trim() || fact.body.trim() || fact.id,
      layer: 'L0',
      kind: 'fact',
      scope: 'user',
      point: layered ? tailPoint(index, facts.length) : whalePoint(index, facts.length),
    }),
    ...callFields(fact),
  }))
  const atomNodes = atoms.map((atom, index) => node({
    id: `l1:${atom.persona ?? 'general'}:${atom.id}`,
    label: shortLabel(atom.content, atom.id),
    layer: 'L1',
    kind: 'atom',
    scope: 'user',
    point: bodyPoint(index, atoms.length, -8, 24, 10, 7),
  }))
  const sceneNodes = scenes.map((scene, index) => node({
    id: `l2:${scene.persona ?? 'general'}:${scene.path}`,
    label: scene.summary?.trim() || scene.path,
    layer: 'L2',
    kind: 'scene',
    scope: 'team-agent',
    point: dorsalPoint(index, scenes.length),
  }))
  const coreNodes = cores.map((core, index) => node({
    id: `l3:${core.persona ?? 'general'}`,
    label: personaSections(core.content, personaLabel)[0]?.heading || shortLabel(core.content, personaLabel),
    layer: 'L3',
    kind: 'core',
    scope: 'team-agent',
    point: headPoint(index, cores.length),
  }))

  const nodes = [...factNodes, ...atomNodes, ...sceneNodes, ...coreNodes]
  const details = [
    ...facts.map(fact => detail({
      id: fact.id,
      label: fact.description.trim() || fact.body.trim() || fact.id,
      layer: 'L0',
      kind: 'fact',
      scope: 'user',
      persona: fact.persona,
      body: fact.body,
      ...(fact.updatedAt === undefined ? {} : { updatedAt: fact.updatedAt }),
      ...callFields(fact),
      ...(fact.origin === 'turn' ? { removable: false } : {}),
    })),
    ...atoms.map(atom => detail({
      id: `l1:${atom.persona ?? 'general'}:${atom.id}`,
      label: shortLabel(atom.content, atom.id),
      layer: 'L1',
      kind: 'atom',
      scope: 'user',
      persona: atom.persona,
      body: atom.content,
      background: atom.background,
      type: atom.type,
      recordId: atom.id,
      updatedAt: atom.updatedAt,
    })),
    ...scenes.map(scene => detail({
      id: `l2:${scene.persona ?? 'general'}:${scene.path}`,
      label: scene.summary?.trim() || scene.path,
      layer: 'L2',
      kind: 'scene',
      scope: 'team-agent',
      persona: scene.persona,
      body: scene.content ?? '',
      path: scene.path,
      summary: scene.summary,
      updatedAt: scene.updatedAt,
    })),
    ...cores.map(core => detail({
      id: `l3:${core.persona ?? 'general'}`,
      label: personaSections(core.content, personaLabel)[0]?.heading || shortLabel(core.content, personaLabel),
      layer: 'L3',
      kind: 'core',
      scope: 'team-agent',
      persona: core.persona,
      body: core.content,
      updatedAt: core.updatedAt,
      sections: personaSections(core.content, personaLabel),
    })),
  ]

  return {
    status: 'ready',
    error: '',
    nodes,
    links: derivedLinks(nodes),
    details,
    legend: (['L0', 'L1', 'L2', 'L3'] as const).filter(layer => nodes.some(item => item.layer === layer)),
    layerErrors,
    truncatedLayers,
  }
}

/**
 * One tagged chat row as an L0 fact.
 * The body is already free of the call header.
 */
export function callTurnFact(turn: {
  id: string
  body: string
  persona?: string
  callId?: string
  source?: MemoryGraphCallSource
  sessionId?: string
}): MemoryGraphFact {
  const body = turn.body.trim()
  const description = body.split('\n').map(line => line.trim()).find(Boolean)?.slice(0, 80) || turn.id
  return {
    id: `turn:${turn.id}`,
    description,
    body,
    origin: 'turn',
    ...(turn.persona ? { persona: turn.persona } : {}),
    ...(turn.callId ? { callId: turn.callId } : {}),
    ...(turn.source ? { source: turn.source } : {}),
    ...(turn.sessionId ? { provenance: { sessionId: turn.sessionId, assetRefs: [] } } : {}),
  }
}

/**
 * Keeps L0 rows that match the call id and the source.
 * L1, L2, and L3 stay. An empty filter returns the same model.
 * An L0 row with no call id and no source is hidden while a filter is set.
 */
export function filterMemoryGraph(model: MemoryGraphModel, filter: MemoryGraphCallFilter): MemoryGraphModel {
  const callId = filter.callId?.trim() ?? ''
  const source = filter.source
  if (model.status !== 'ready' || (!callId && !source))
    return model
  const nodes = model.nodes.filter(item => item.layer !== 'L0' || matchesCall(item, callId, source))
  const ids = new Set(nodes.map(item => item.id))
  return {
    ...model,
    nodes,
    links: derivedLinks(nodes),
    details: model.details.filter(item => ids.has(item.id)),
    legend: (['L0', 'L1', 'L2', 'L3'] as const).filter(layer => nodes.some(item => item.layer === layer)),
  }
}

function matchesCall(node: MemoryGraphNode, callId: string, source: MemoryGraphCallSource | undefined) {
  if (!node.callId && !node.source)
    return false
  if (callId && node.callId !== callId)
    return false
  if (source && node.source !== source)
    return false
  return true
}

function callFields(fact: MemoryGraphFact) {
  return {
    ...(fact.callId ? { callId: fact.callId } : {}),
    ...(fact.source ? { source: fact.source } : {}),
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
 * Splits a persona file on markdown headings.
 * A file with no heading is one section. The graph still draws one persona node.
 *
 * @example
 * personaSections('# Name\n\nAda', 'Persona')
 * // => [{ heading: 'Name', body: 'Ada' }]
 */
export function personaSections(content: string, emptyLabel = ''): MemoryGraphSection[] {
  const sections: MemoryGraphSection[] = []
  let heading = ''
  let body: string[] = []
  const push = () => {
    const text = body.join('\n').trim()
    if (!heading && !text)
      return
    const firstLine = text.split('\n').map(line => line.trim()).find(Boolean) ?? ''
    sections.push({ heading: heading || firstLine.slice(0, 80) || emptyLabel, body: text })
  }

  for (const line of content.split(/\r?\n/)) {
    const nextHeading = markdownHeading(line)
    if (nextHeading !== undefined) {
      if (heading || body.some(part => part.trim()))
        push()
      heading = nextHeading
      body = []
      continue
    }
    body.push(line)
  }
  push()
  return sections
}

/**
 * Places fact `index` on a side-view whale.
 * One fact sits in the body. A few facts use the head, the tail, and the fins.
 * Further facts fill the body and stay off the center line.
 */
export function whalePoint(index: number, count: number) {
  if (count <= 1)
    return { x: 0, y: 0, z: 0 }
  const anchors = whaleAnchors(count)
  if (index < anchors.length)
    return anchors[index]!
  return bodyPoint(index - anchors.length, count - anchors.length, -16, 22, 11, 8)
}

/** Theme hue for one layer. The graph and the legend share this color. */
export function memoryLayerColor(layer: MemoryGraphLayer, hue: number) {
  if (layer === 'L1')
    return `hsl(${hue}, 62%, 58%)`
  if (layer === 'L2')
    return `hsl(${hue}, 48%, 74%)`
  if (layer === 'L3')
    return `hsl(${hue}, 78%, 84%)`
  return `hsl(${hue}, 85%, 68%)`
}

const silhouette = [
  { x: 34, y: 8, z: 0 },
  { x: -34, y: 4, z: 0 },
  { x: 8, y: -6, z: 18 },
  { x: 8, y: -6, z: -18 },
  { x: 0, y: 16, z: 0 },
  { x: 0, y: 0, z: 0 },
]

function whaleAnchors(count: number) {
  return silhouette.slice(0, Math.min(count, silhouette.length))
}

function headPoint(index: number, count: number) {
  if (count <= 1)
    return { x: 34, y: 8, z: 0 }
  return { x: 34, y: 8, z: (index - (count - 1) / 2) * 6 }
}

function dorsalPoint(index: number, count: number) {
  if (count <= 1)
    return { x: 2, y: 18, z: 0 }
  const slot = index / (count - 1)
  return { x: -8 + slot * 20, y: 17, z: 0 }
}

function tailPoint(index: number, count: number) {
  const anchors = [
    { x: -36, y: 8, z: 8 },
    { x: -36, y: 8, z: -8 },
    { x: -28, y: 2, z: 0 },
    { x: 10, y: -8, z: 18 },
    { x: 10, y: -8, z: -18 },
    { x: -4, y: -10, z: 0 },
  ]
  if (index < Math.min(count, anchors.length))
    return anchors[index]!
  return bodyPoint(index - anchors.length, Math.max(count - anchors.length, 1), -18, 12, 9, 7)
}

function bodyPoint(index: number, count: number, x0: number, x1: number, yRadius: number, zRadius: number) {
  const slot = count <= 1 ? 0.5 : index / Math.max(count - 1, 1)
  const along = x0 + slot * (x1 - x0)
  const turn = index * 2.399
  return {
    x: along,
    y: Math.cos(turn) * yRadius * 0.72,
    z: Math.sin(turn) * zRadius * 0.72,
  }
}

function node(input: {
  id: string
  label: string
  layer: MemoryGraphLayer
  kind: MemoryGraphKind
  scope: MemoryGraphScope
  point: { x: number, y: number, z: number }
}): MemoryGraphNode {
  return {
    id: input.id,
    label: input.label,
    layer: input.layer,
    kind: input.kind,
    scope: input.scope,
    x: input.point.x,
    y: input.point.y,
    z: input.point.z,
  }
}

function detail(input: {
  id: string
  label: string
  layer: MemoryGraphLayer
  kind: MemoryGraphKind
  scope: MemoryGraphScope
  persona?: string
  body: string
  background?: string
  type?: string
  path?: string
  recordId?: string
  summary?: string
  updatedAt?: number
  callId?: string
  source?: MemoryGraphCallSource
  removable?: boolean
  sections?: readonly MemoryGraphSection[]
}): MemoryGraphDetail {
  return {
    id: input.id,
    label: input.label,
    layer: input.layer,
    kind: input.kind,
    scope: input.scope,
    ...(input.persona ? { persona: input.persona } : {}),
    body: input.body,
    ...(input.background ? { background: input.background } : {}),
    ...(input.type ? { type: input.type } : {}),
    ...(input.path ? { path: input.path } : {}),
    ...(input.recordId ? { recordId: input.recordId } : {}),
    ...(input.summary ? { summary: input.summary } : {}),
    ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt }),
    ...(input.callId ? { callId: input.callId } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.removable === undefined ? {} : { removable: input.removable }),
    sections: input.sections ?? [],
  }
}

function markdownHeading(line: string) {
  let marks = 0
  while (marks < line.length && marks < 3 && line[marks] === '#')
    marks += 1
  if (marks === 0 || line[marks] !== ' ')
    return undefined
  const heading = line.slice(marks + 1).trim()
  return heading || undefined
}

function shortLabel(text: string, fallback: string) {
  const line = text.split('\n').map(part => part.trim()).find(Boolean) ?? ''
  const clean = line.replace(/^#+\s*/, '')
  return clean.slice(0, 80) || fallback
}

function derivedLinks(nodes: readonly MemoryGraphNode[]): MemoryGraphLink[] {
  const links: MemoryGraphLink[] = []
  for (const layer of ['L0', 'L1', 'L2', 'L3'] as const) {
    const group = nodes.filter(item => item.layer === layer).sort((left, right) => left.x - right.x || left.z - right.z)
    for (let index = 1; index < group.length; index += 1) {
      const source = group[index - 1]
      const target = group[index]
      if (!source || !target)
        continue
      links.push({ source: source.id, target: target.id, derived: true })
    }
  }
  return links
}

<script setup lang="ts">
import type { ForceGraph3DInstance } from '3d-force-graph'

import type { MemoryGraphLink, MemoryGraphNode } from '../memory-graph-model'

import ForceGraph3D from '3d-force-graph'

import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'

const props = defineProps<{
  nodes: readonly MemoryGraphNode[]
  links: readonly MemoryGraphLink[]
  selectedId: string
  derivedLabel: string
  backgroundColor: string
  nodeColor: string
  linkColor: string
}>()

const emit = defineEmits<{
  select: [id: string]
  unavailable: []
}>()

interface GraphNode extends MemoryGraphNode {
  fx: number
  fy: number
  fz: number
}

const root = useTemplateRef<HTMLElement>('root')
let graph: ForceGraph3DInstance | undefined
let observer: ResizeObserver | undefined

function graphNodes(): GraphNode[] {
  return props.nodes.map(node => ({ ...node, fx: node.x, fy: node.y, fz: node.z }))
}

function applyData() {
  graph?.graphData({
    nodes: graphNodes(),
    links: props.links.map(link => ({ ...link })),
  })
}

function nodeText(node: object) {
  if ('label' in node && typeof node.label === 'string')
    return node.label
  if ('id' in node && (typeof node.id === 'string' || typeof node.id === 'number'))
    return String(node.id)
  return ''
}

function nodeId(node: object) {
  if ('id' in node && typeof node.id === 'string')
    return node.id
  return ''
}

function resize() {
  const element = root.value
  if (!element || !graph)
    return
  graph.width(element.clientWidth).height(Math.max(element.clientHeight, 280))
}

onMounted(() => {
  const element = root.value
  if (!element)
    return
  try {
    graph = new ForceGraph3D(element)
      .backgroundColor(props.backgroundColor)
      .showNavInfo(false)
      .enableNodeDrag(false)
      .cooldownTicks(0)
      .warmupTicks(0)
      .nodeLabel(node => nodeText(node))
      .nodeColor(() => props.nodeColor)
      .nodeVal(node => nodeId(node) === props.selectedId ? 6 : 2)
      .linkLabel(() => props.derivedLabel)
      .linkColor(props.linkColor)
      .linkWidth(0.6)
      .linkOpacity(0.7)
      .onNodeClick((node) => {
        const id = nodeId(node)
        if (id)
          emit('select', id)
      })
      .cameraPosition({ x: 0, y: 24, z: 110 }, { x: 0, y: 0, z: 0 }, 0)
    applyData()
    resize()
    observer = new ResizeObserver(() => resize())
    observer.observe(element)
  }
  catch {
    emit('unavailable')
  }
})

watch(() => [props.nodes, props.links, props.selectedId, props.derivedLabel], () => {
  if (!graph)
    return
  graph.nodeVal(node => nodeId(node) === props.selectedId ? 6 : 2)
  graph.linkLabel(() => props.derivedLabel)
  applyData()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = undefined
  graph?._destructor()
  graph = undefined
})
</script>

<template>
  <div ref="root" :class="['h-full w-full']" />
</template>

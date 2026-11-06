<script setup lang="ts">
import type { ForceGraph3DInstance } from '3d-force-graph'

import type { MemoryGraphLayer, MemoryGraphLink, MemoryGraphNode } from '../memory-graph-model'

import ForceGraph3D from '3d-force-graph'

import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'

import { memoryLayerColor } from '../memory-graph-model'

const props = defineProps<{
  nodes: readonly MemoryGraphNode[]
  links: readonly MemoryGraphLink[]
  selectedId: string
  derivedLabel: string
  backgroundColor: string
  hue: number
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

function nodeLayer(node: object): MemoryGraphLayer {
  if ('layer' in node && (node.layer === 'L0' || node.layer === 'L1' || node.layer === 'L2' || node.layer === 'L3'))
    return node.layer
  return 'L0'
}

function nodeSize(node: object) {
  const layer = nodeLayer(node)
  const base = layer === 'L3' ? 8 : layer === 'L2' ? 4 : layer === 'L0' ? 2.4 : 1.7
  return nodeId(node) === props.selectedId ? base * 1.6 : base
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
      .nodeColor(node => memoryLayerColor(nodeLayer(node), props.hue))
      .nodeVal(node => nodeSize(node))
      .linkLabel(() => props.derivedLabel)
      .linkColor(props.linkColor)
      .linkWidth(0.4)
      .linkOpacity(0.45)
      .onNodeClick((node) => {
        const id = nodeId(node)
        if (id)
          emit('select', id)
      })
      .cameraPosition({ x: 18, y: 28, z: 132 }, { x: 0, y: 2, z: 0 }, 0)
    applyData()
    resize()
    observer = new ResizeObserver(() => resize())
    observer.observe(element)
  }
  catch {
    emit('unavailable')
  }
})

watch(() => [props.nodes, props.links, props.selectedId, props.derivedLabel, props.hue], () => {
  if (!graph)
    return
  graph.nodeColor(node => memoryLayerColor(nodeLayer(node), props.hue))
  graph.nodeVal(node => nodeSize(node))
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

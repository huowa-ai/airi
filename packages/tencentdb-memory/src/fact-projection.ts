import type { MemoryEntry } from './memory-storage'

/**
 * Facts a later graph view is allowed to read.
 * The type has no edges. A line the view draws is derived, not a stored relation.
 * L1 atoms in MemoryCore have no relation field. This package does not add one.
 */
export interface MemoryFactProjection {
  listFacts: () => Promise<readonly MemoryEntry[]>
}

/**
 * A later notice that facts were stored or recalled.
 * `stored` follows a write or a removal. `recalled` follows a read a view can highlight.
 * The notice carries ids only. It does not carry edges or media bytes.
 * The reviewed MemoryCore v3 catalog has no client subscription for writes.
 * This package does not emit notices.
 */
export interface MemoryNotice {
  kind: 'stored' | 'recalled'
  ids: readonly string[]
}

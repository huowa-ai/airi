import localforage from 'localforage'

import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { useMemoryStore } from './memory'

const records = localforage.createInstance({ name: 'airi-memory', storeName: 'entries' })
const stores: ReturnType<typeof createPinia>[] = []

function createStore() {
  const pinia = createPinia()
  stores.push(pinia)
  return useMemoryStore(pinia)
}

async function storedCount() {
  let count = 0
  await records.iterate(() => {
    count += 1
  })
  return count
}

describe('memory store', () => {
  beforeEach(async () => {
    await records.clear()
    localStorage.removeItem('memory/entries')
    localStorage.removeItem('memory/service-enabled')
    localStorage.removeItem('memory/service-endpoint')
    localStorage.removeItem('memory/service-team-id')
    localStorage.removeItem('memory/service-user-id')
    localStorage.removeItem('memory/service-api-key')
    localStorage.removeItem('memory/service-id')
  })

  afterEach(async () => {
    for (const pinia of stores.splice(0))
      disposePinia(pinia)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.removeItem('memory/entries')
    localStorage.removeItem('memory/service-enabled')
    localStorage.removeItem('memory/service-endpoint')
    localStorage.removeItem('memory/service-team-id')
    localStorage.removeItem('memory/service-user-id')
    localStorage.removeItem('memory/service-api-key')
    localStorage.removeItem('memory/service-id')
    await records.clear()
  })

  it('leaves the index empty and names the reason when the service is off', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const memory = createStore()
    await memory.ready()

    expect(await memory.write({ description: 'Name', body: 'Ada' }, 'airi')).toBeUndefined()
    expect(memory.entries).toEqual([])
    expect(memory.serviceError).toBe('The memory service is off.')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await storedCount()).toBe(0)
  })

  it('does not call the service when the address or ids are missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const memory = createStore()
    memory.serviceEnabled = true
    await nextTick()
    await memory.ready()

    expect(await memory.write({ description: 'Name', body: 'Ada' }, 'airi')).toBeUndefined()
    expect(memory.entries).toEqual([])
    expect(memory.serviceError).toBe('Set the service address, the team id, and the user id.')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await storedCount()).toBe(0)
  })

  it('clears the index when the service cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))
    const memory = createStore()
    memory.serviceEnabled = true
    memory.serviceEndpoint = 'http://127.0.0.1:9'
    memory.serviceTeamId = 'team-1'
    memory.serviceUserId = 'user-1'
    await nextTick()
    await memory.ready()

    expect(await memory.write({ description: 'Name', body: 'Ada' }, 'airi')).toBeUndefined()
    expect(memory.entries).toEqual([])
    expect(memory.serviceError).not.toBe('')
    expect(memory.serviceError).not.toContain('127.0.0.1')
    expect(await storedCount()).toBe(0)
  })
})

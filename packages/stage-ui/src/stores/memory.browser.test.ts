import localforage from 'localforage'

import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { memoryRepo } from '../database/repos/memory.repo'
import { useMemoryStore } from './memory'
import { clearMemoryServiceSettings, createMemoryCoreFetch, enableMemoryService } from './memory-core-fake'

const records = localforage.createInstance({ name: 'airi-memory', storeName: 'entries' })
const stores: ReturnType<typeof createPinia>[] = []
const gateway = createMemoryCoreFetch()

/** Each store stands for one window. */
function createStore() {
  const pinia = createPinia()
  stores.push(pinia)
  return useMemoryStore(pinia)
}

describe('memory store', () => {
  beforeEach(async () => {
    await records.clear()
    localStorage.removeItem('memory/entries')
    clearMemoryServiceSettings()
    gateway.reset()
    vi.stubGlobal('fetch', gateway.fetch)
    enableMemoryService()
    // The entries are in the order of their changes, so each change gets its own time.
    let now = 1
    vi.spyOn(Date, 'now').mockImplementation(() => now++)
  })

  afterEach(async () => {
    for (const pinia of stores.splice(0))
      disposePinia(pinia)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.removeItem('memory/entries')
    clearMemoryServiceSettings()
    await records.clear()
  })

  it('gives each new fact its own id, changes an entry by its id, and lists it in the index', async () => {
    const memory = createStore()
    const game = (await memory.write({ description: 'What the owner plays.', body: 'Porridge games.' }, 'airi'))!
    // Two facts with the same index line stay two entries.
    const other = (await memory.write({ description: 'What the owner plays.', body: 'Puzzle games on the train.' }, 'airi'))!
    await memory.write({ id: game.id, description: 'What the owner plays now.', body: 'Minecraft.' }, 'airi')

    expect(other.id).not.toBe(game.id)
    expect(memory.entries).toHaveLength(2)
    expect(memory.read(game.id, 'airi')?.body).toBe('Minecraft.')
    expect(memory.indexFor('airi')).toBe(`Your own:\n- ${other.id}: What the owner plays.\n- ${game.id}: What the owner plays now.`)
    expect(memory.serviceRead).toBe('ready')
  })

  // A card keeps its own memories. Only the owner makes one general, and then every card reads it.
  it('keeps memories on their card until the owner makes one general', async () => {
    const memory = createStore()
    const nickname = (await memory.write({ description: 'What the owner likes to be called.', body: 'Yumeka.' }, 'airi'))!
    const rules = (await memory.write({ description: 'Rules of the Discord channel.', body: 'No spoilers.' }, 'discord-host'))!

    expect(memory.indexFor('discord-host')).toBe(`Your own:\n- ${rules.id}: Rules of the Discord channel.`)
    expect(memory.read(nickname.id, 'discord-host')).toBeUndefined()

    await memory.makeGeneral(nickname)

    expect(memory.indexFor('discord-host')).toBe(`Your own:\n- ${rules.id}: Rules of the Discord channel.\nGeneral:\n- ${nickname.id}: What the owner likes to be called.`)
    expect(memory.read(nickname.id, 'discord-host')?.body).toBe('Yumeka.')
    expect(memory.entries.find(entry => entry.id === nickname.id)?.persona).toBeUndefined()
  })

  it('changes and forgets only the card own entries, and refuses an empty body', async () => {
    const memory = createStore()
    const tone = (await memory.write({ description: '', body: 'Calm.' }, 'airi'))!
    await memory.makeGeneral(tone)
    // A general memory belongs to the owner, so a write with its id adds the card's own entry.
    const own = (await memory.write({ id: tone.id, description: '', body: 'Short sentences.' }, 'focus'))!

    expect(own.id).not.toBe(tone.id)
    expect(memory.read(tone.id, 'focus')?.body).toBe('Calm.')
    expect(await memory.forget(own.id, 'focus')).toBe(true)
    // A run cannot forget a general memory either.
    expect(await memory.forget(tone.id, 'focus')).toBe(false)
    expect(await memory.write({ description: '', body: ' ' }, 'airi')).toBeUndefined()
  })

  it('shows a service change in every window', async () => {
    const chat = createStore()
    const settings = createStore()
    const nickname = (await chat.write({ description: 'What the owner likes to be called.', body: 'Yumeka.' }, 'airi'))!
    const tone = (await chat.write({ description: 'How to answer.', body: 'Calm.' }, 'airi'))!
    await vi.waitFor(() => expect(settings.entries).toHaveLength(2))

    await settings.remove(nickname)
    await settings.makeGeneral(tone)

    await vi.waitFor(() => expect(chat.entries.find(entry => entry.id === nickname.id)).toBeUndefined())
    expect(chat.entries.find(entry => entry.id === tone.id)?.persona).toBeUndefined()
    expect(settings.entries).toHaveLength(1)
  })

  it('keeps the service entries across restarts of the store', async () => {
    const chat = createStore()
    const nickname = (await chat.write({ description: 'What the owner likes to be called.', body: 'Yumeka.' }, 'airi'))!

    const restarted = createStore()
    await restarted.ready()

    expect(restarted.read(nickname.id, 'airi')?.body).toBe('Yumeka.')
  })

  it('does not read or write the device repository', async () => {
    const list = vi.spyOn(memoryRepo, 'list')
    const write = vi.spyOn(memoryRepo, 'write')
    await memoryRepo.add([{ id: 'device-fact', description: 'Device only', body: 'Porridge on this device.', updatedAt: 1 }])
    const memory = createStore()
    await memory.write({ description: 'Drink', body: 'Ada likes tea.' }, 'airi')

    expect(memory.entries.map(entry => entry.body)).toEqual(['Ada likes tea.'])
    expect(memory.entries.map(entry => entry.body)).not.toContain('Porridge on this device.')
    expect(list).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
    expect((await memoryRepo.list()).map(entry => entry.id)).toEqual(['device-fact'])
  })

  it('stays empty when the service is off', async () => {
    clearMemoryServiceSettings()
    await memoryRepo.add([{ id: 'device-fact', description: 'Device only', body: 'Porridge on this device.', updatedAt: 1 }])
    const memory = createStore()
    await memory.ready()

    expect(memory.serviceRead).toBe('off')
    expect(memory.entries).toEqual([])
    expect(await memory.write({ description: 'Drink', body: 'Ada likes tea.' }, 'airi')).toBeUndefined()
    expect(memory.entries).toEqual([])
    expect((await memoryRepo.list()).map(entry => entry.body)).toEqual(['Porridge on this device.'])
  })

  it('stays empty when the service read fails and does not use device facts', async () => {
    gateway.fail('MemoryCore request failed.')
    await memoryRepo.add([{ id: 'device-fact', description: 'Device only', body: 'Porridge on this device.', updatedAt: 1 }])
    const memory = createStore()
    await memory.ready()

    expect(memory.serviceRead).toBe('error')
    expect(memory.serviceError).toBe('MemoryCore request failed.')
    expect(memory.entries).toEqual([])
    expect(memory.serviceError).not.toContain('127.0.0.1')
  })

  it('keeps one user list away from another user', async () => {
    const owner = createStore()
    await owner.write({ description: 'Drink', body: 'Ada likes tea.' }, 'airi')
    enableMemoryService('user-2')
    const other = createStore()
    await other.ready()

    expect(other.entries).toEqual([])
    expect(owner.entries.map(entry => entry.body)).toEqual(['Ada likes tea.'])
  })

  it('drops service facts when data reset runs, and does not load legacy local storage', async () => {
    localStorage.setItem('memory/entries', JSON.stringify([
      { name: 'nickname', description: 'What the owner likes to be called.', body: 'Yumeka.', persona: 'airi', updatedAt: 10 },
    ]))
    const memory = createStore()
    await memory.write({ description: 'Drink', body: 'Ada likes tea.' }, 'airi')
    expect(memory.entries.map(entry => entry.body)).toEqual(['Ada likes tea.'])
    expect(localStorage.getItem('memory/entries')).not.toBeNull()

    await memory.resetState()
    enableMemoryService()
    memory.serviceEnabled = true
    await vi.waitFor(() => expect(memory.serviceRead).toBe('ready'))

    expect(memory.entries).toEqual([])
  })

  it('reports an error when the service settings are incomplete', async () => {
    localStorage.removeItem('memory/service-team-id')
    const memory = createStore()
    await memory.ready()

    expect(memory.serviceRead).toBe('error')
    expect(memory.serviceError).toBe('Set the service address, the team id, and the user id.')
    expect(memory.entries).toEqual([])
  })
})

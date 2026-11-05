import en from '@proj-airi/i18n/locales/en'

import { useMemoryStore } from '@proj-airi/stage-ui/stores/memory'
import { clearMemoryServiceSettings, createMemoryCoreFetch, enableMemoryService } from '@proj-airi/stage-ui/stores/memory-core-fake'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import MemoryGraphPage from './memory-graph.vue'

import 'virtual:uno.css'

const pinias: ReturnType<typeof createPinia>[] = []

afterEach(() => {
  cleanup()
  pinias.splice(0).forEach(pinia => disposePinia(pinia))
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

async function renderPage() {
  await page.viewport(1280, 800)
  const pinia = createPinia()
  pinias.push(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  })
  await router.push('/settings/modules/memory-graph')
  const screen = render(MemoryGraphPage, {
    global: {
      plugins: [pinia, router, createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false })],
    },
  })
  return { screen, memory: useMemoryStore(pinia) }
}

function preferReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  }))
}

describe('memory graph page', () => {
  it('stays empty when the service is off and does not keep a written fact', async () => {
    clearMemoryServiceSettings()
    const { screen, memory } = await renderPage()
    await memory.write({ description: 'Device only', body: 'Porridge on this device.' }, 'airi')

    await expect.element(screen.getByText('Memory service is off')).toBeVisible()
    await expect.element(screen.getByText('Porridge on this device.')).not.toBeInTheDocument()
    await expect.element(screen.getByText('Facts: 0. Derived layout lines: 0.')).toBeVisible()
  })

  it('shows the service error and no invented facts when the service is unreachable', async () => {
    enableMemoryService()
    localStorage.removeItem('memory/service-team-id')
    const { screen, memory } = await renderPage()
    await memory.write({ description: 'Device only', body: 'Porridge on this device.' }, 'airi')

    await expect.element(screen.getByText('Set the service address, the team id, and the user id.')).toBeVisible()
    await expect.element(screen.getByText('Porridge on this device.')).not.toBeInTheDocument()
  })

  it('lists the same L0 facts the service returned and labels layout lines as derived', async () => {
    const gateway = createMemoryCoreFetch()
    vi.stubGlobal('fetch', gateway.fetch)
    enableMemoryService()
    preferReducedMotion(false)
    const { screen, memory } = await renderPage()
    const saved = await memory.write({ description: 'Drink', body: 'Ada likes tea.' }, 'airi')

    expect(saved?.body).toBe('Ada likes tea.')
    await expect.element(screen.getByRole('button', { name: /Drink/ })).toBeVisible()
    await expect.element(screen.getByText('L1 was not returned')).toBeVisible()
    await expect.element(screen.getByText('Derived layout line. This line is not a stored relation.')).toBeVisible()
    await screen.getByRole('button', { name: /Drink/ }).click()
    await expect.element(screen.getByText('Ada likes tea.')).toBeVisible()
    await expect.element(screen.getByText('No source is stored for this fact.')).toBeVisible()
  })

  it('shows the fact list and does not start the graph when motion is reduced', async () => {
    const gateway = createMemoryCoreFetch()
    vi.stubGlobal('fetch', gateway.fetch)
    enableMemoryService()
    preferReducedMotion(true)
    const { screen, memory } = await renderPage()
    await memory.write({ description: 'Drink', body: 'Ada likes tea.' }, 'airi')

    await expect.element(screen.getByRole('button', { name: /Drink/ })).toBeVisible()
    await expect.element(screen.getByText('Motion is reduced. The graph stays still. The list shows the same facts.')).toBeVisible()
    expect(screen.container.querySelector('canvas')).toBeNull()
  })
})

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { setMemoryTransport } from '@proj-airi/stage-ui/stores/memory-transport'

import { memoryGatewayRequest } from '../shared/eventa/memory-gateway'

/**
 * Sends MemoryCore calls through the main process.
 * The page fetch is not used. The gateway CORS list does not allow `x-tdai-service-id`.
 */
export function installMemoryGatewayTransport() {
  const ipc = window.electron?.ipcRenderer
  if (!ipc)
    return

  const request = useElectronEventaInvoke(memoryGatewayRequest)
  setMemoryTransport(async (input, init) => {
    const url = input instanceof URL
      ? input
      : new URL(typeof input === 'string' ? input : input.url)
    const source = new Headers(init?.headers)
    const headers: Record<string, string> = {}
    source.forEach((value, name) => {
      headers[name] = value
    })
    // The setting is the endpoint the store already checked. Main refuses a URL on another origin.
    const configured = localStorage.getItem('memory/service-endpoint')?.trim() ?? ''
    const result = await request({
      url: url.href,
      endpoint: configured || url.origin,
      headers,
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
    })
    return new Response(result.body, {
      status: result.status,
      headers: { 'content-type': 'application/json' },
    })
  })
}

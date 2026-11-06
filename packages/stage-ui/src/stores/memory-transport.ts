/**
 * Optional fetch for MemoryCore.
 * Electron installs a main-process fetch before the store opens a client.
 * A browser page keeps the default `fetch`.
 */
let transport: typeof fetch | undefined

export function setMemoryTransport(fetchImpl: typeof fetch | undefined) {
  transport = fetchImpl
}

export function memoryTransport() {
  return transport
}

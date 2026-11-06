import { resolveServerUrl } from '@proj-airi/stage-shared'

export interface DesktopAuthConfiguration {
  clientId: string
  serverUrl: string
}

export const desktopAuthConfiguration: DesktopAuthConfiguration = {
  clientId: import.meta.env.VITE_OIDC_CLIENT_ID || 'airi-stage-electron',
  serverUrl: resolveServerUrl(import.meta.env),
}

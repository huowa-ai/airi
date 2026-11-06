/**
 * Returns true if the provided environment variable represents a truthy value.
 *
 * Truthy values: `true`, `t`, `yes`, `y`, `on`, `1`
 */
export function isEnvTruthy(value: string | undefined | null): boolean {
  if (value == null)
    return false
  return /^(?:1|true|t|yes|y|on)$/i.test(value.trim())
}

export function isFluxPurchaseDisabled(): boolean {
  return isEnvTruthy(import.meta.env.VITE_DISABLE_FLUX_PURCHASE)
}

/** Public web billing key for RevenueCat purchases-js. Unset means web purchase is unavailable. */
export function getRevenuecatWebKey(): string | null {
  const key = import.meta.env.VITE_REVENUECAT_WEB_KEY as string | undefined
  return key && key.trim().length > 0 ? key : null
}

/**
 * Whether this build can show and sell a Capacitor.
 * Builds without the web key, such as the desktop and mobile releases, hide every Capacitor entry.
 */
export function isCapacitorAvailable(): boolean {
  return !isFluxPurchaseDisabled() && getRevenuecatWebKey() != null
}

export function isCustomProvidersDisabled(): boolean {
  return isEnvTruthy(import.meta.env.VITE_DISABLE_CUSTOM_PROVIDERS)
}

/** Hosted AIRI API. Production uses this when `VITE_SERVER_URL` is unset. */
export const PRODUCTION_SERVER_URL = 'https://api.airi.build'

/**
 * Local gateway from `pnpm dev:backend`.
 * The API process listens on port 3000. Set `VITE_SERVER_URL` for another port.
 */
export const DEVELOPMENT_SERVER_URL = 'http://127.0.0.1:6112'

export interface ServerUrlEnv {
  DEV?: boolean
  VITE_SERVER_URL?: string
}

/**
 * Resolves the AIRI API origin.
 * A set `VITE_SERVER_URL` wins. Development uses the local gateway.
 * Production uses the hosted API.
 */
export function resolveServerUrl(env: ServerUrlEnv): string {
  const configured = env.VITE_SERVER_URL?.trim().replace(/\/+$/, '')
  if (configured)
    return configured
  return env.DEV ? DEVELOPMENT_SERVER_URL : PRODUCTION_SERVER_URL
}

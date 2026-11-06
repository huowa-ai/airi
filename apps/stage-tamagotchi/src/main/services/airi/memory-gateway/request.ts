import { defaultMemoryServiceId } from '@proj-airi/tencentdb-memory'

/**
 * Request rules for the MemoryCore gateway call.
 * The main process owns the socket. These checks keep the call on `/v3/` of one endpoint.
 */

const forwardedHeaderNames = new Set(['content-type', 'authorization', 'x-tdai-service-id'])

/** How long one gateway call may take. The renderer client uses the same limit. */
export const memoryGatewayTimeoutMs = 15_000

/** Largest JSON body the main process forwards. A conversation batch stays under this size. */
export const memoryGatewayBodyLimit = 1_000_000

/**
 * Builds the headers the gateway accepts.
 * A missing service id becomes `default`. The gateway returns 401 when the header is absent.
 */
export function forwardedHeaders(headers: Record<string, string>) {
  const output: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase()
    if (!forwardedHeaderNames.has(key) || value.trim() === '')
      continue
    output[key] = value
  }
  if (!output['x-tdai-service-id'])
    output['x-tdai-service-id'] = defaultMemoryServiceId
  return output
}

/**
 * Accepts one MemoryCore URL on the configured endpoint.
 * The path must stay under `/v3/`. The URL must not carry credentials.
 */
export function memoryGatewayTarget(endpoint: string, url: string) {
  let target: URL
  let origin: URL
  try {
    target = new URL(url)
    origin = new URL(endpoint)
  }
  catch {
    throw new Error('Memory gateway URL is not valid.')
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:')
    throw new Error('Memory gateway URL must use http or https.')
  if (origin.protocol !== 'http:' && origin.protocol !== 'https:')
    throw new Error('Memory gateway URL must use http or https.')
  if (target.username || target.password || origin.username || origin.password)
    throw new Error('Memory gateway URL must not carry credentials.')
  if (target.origin !== origin.origin)
    throw new Error('Memory gateway URL is outside the configured endpoint.')
  if (!target.pathname.startsWith('/v3/') || target.pathname.includes('..'))
    throw new Error('Memory gateway URL must stay on /v3/.')
  return target
}

export function assertMemoryGatewayBody(body: string | undefined) {
  if (body !== undefined && body.length > memoryGatewayBodyLimit)
    throw new Error('Memory gateway body is too large.')
}

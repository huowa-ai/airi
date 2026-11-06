import type { createContext } from '@moeru/eventa/adapters/electron/main'

import { defineInvokeHandler } from '@moeru/eventa'

import { memoryGatewayRequest } from '../../../../shared/eventa/memory-gateway'
import { assertMemoryGatewayBody, forwardedHeaders, memoryGatewayTarget, memoryGatewayTimeoutMs } from './request'

/**
 * Registers the MemoryCore gateway call.
 *
 * Use when:
 * - The Electron renderer must reach MemoryCore without a browser preflight
 *
 * Expects:
 * - `context` is the Electron main IPC context
 *
 * Returns:
 * - Nothing. The handler stays registered for the lifetime of the application.
 */
export function setupMemoryGateway(context: ReturnType<typeof createContext>['context']) {
  defineInvokeHandler(context, memoryGatewayRequest, async (input) => {
    const target = memoryGatewayTarget(input.endpoint, input.url)
    assertMemoryGatewayBody(input.body)
    const headers = forwardedHeaders(input.headers)

    let response: Response
    try {
      response = await fetch(target, {
        method: 'POST',
        headers,
        body: input.body,
        signal: AbortSignal.timeout(memoryGatewayTimeoutMs),
      })
    }
    catch {
      return { status: 0, body: '' }
    }

    return {
      status: response.status,
      body: await response.text(),
    }
  })
}

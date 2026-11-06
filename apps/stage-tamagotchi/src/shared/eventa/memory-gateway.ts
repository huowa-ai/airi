import { defineInvokeEventa } from '@moeru/eventa'

/**
 * One MemoryCore call the main process performs for a renderer.
 * The page does not open the socket. The gateway CORS list cannot carry `x-tdai-service-id`.
 */
export interface MemoryGatewayRequest {
  /** Full `http` or `https` URL on the configured endpoint, under `/v3/`. */
  url: string
  /** Origin from the memory service setting. The URL must use this origin. */
  endpoint: string
  headers: Record<string, string>
  body?: string
}

export interface MemoryGatewayResponse {
  status: number
  body: string
}

export const memoryGatewayRequest = defineInvokeEventa<MemoryGatewayResponse, MemoryGatewayRequest>('eventa:invoke:memory-gateway:request')

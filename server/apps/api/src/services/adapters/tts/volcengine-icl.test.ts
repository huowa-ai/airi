import { Buffer } from 'node:buffer'

import { ApiError } from '@proj-airi/http-error-shared'
import { describe, expect, it, vi } from 'vitest'

import { readVolcengineIclAudio, synthesizeVolcengineIcl, VOLCENGINE_ICL_DEFAULT_SPEAKER, VOLCENGINE_ICL_ENDPOINT, VOLCENGINE_ICL_RESOURCE_ID } from './volcengine-icl'

describe('readVolcengineIclAudio', () => {
  /**
   * @example
   * readVolcengineIclAudio('{"code":0,"data":"aGVsbG8="}\n{"code":20000000}', 'secret')
   */
  it('joins base64 audio chunks and stops on the success code', () => {
    const first = Buffer.from('hello').toString('base64')
    const second = Buffer.from('-audio').toString('base64')
    const payload = [
      JSON.stringify({ code: 0, data: first }),
      JSON.stringify({ code: 0, data: second }),
      JSON.stringify({ code: 20000000, message: 'OK', data: null }),
    ].join('\n')

    expect(Buffer.from(readVolcengineIclAudio(payload, 'secret')).toString('utf8')).toBe('hello-audio')
  })

  it('redacts the access token from an upstream error line', () => {
    const payload = JSON.stringify({ code: 45000030, message: 'rejected secret-token' })

    expect(() => readVolcengineIclAudio(payload, 'secret-token')).toThrowError(ApiError)
    expect(() => readVolcengineIclAudio(payload, 'secret-token')).toThrowError(/\[redacted\]/)
    expect(() => readVolcengineIclAudio(payload, 'secret-token')).not.toThrowError(/secret-token/)
  })
})

describe('synthesizeVolcengineIcl', () => {
  /**
   * @example
   * synthesizeVolcengineIcl({ text: 'Hello' }, { accessToken: 'server-token', fetchImpl })
   */
  it('sends the server token to the ICL 2.0 endpoint and ignores a client key', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      const audio = Buffer.from('hello-audio').toString('base64')
      return new Response([
        JSON.stringify({ code: 0, data: audio }),
        JSON.stringify({ code: 20000000, message: 'OK' }),
      ].join('\n'), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    const result = await synthesizeVolcengineIcl({
      text: 'Hello',
    }, {
      accessToken: 'server-token',
      fetchImpl,
    })

    expect(Buffer.from(result.body).toString('utf8')).toBe('hello-audio')
    expect(result.contentType).toBe('audio/mpeg')
    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(VOLCENGINE_ICL_ENDPOINT)
    const headers = new Headers(init?.headers)
    expect(headers.get('x-api-key')).toBe('server-token')
    expect(headers.get('x-api-resource-id')).toBe(VOLCENGINE_ICL_RESOURCE_ID)
    expect(headers.get('x-api-app-id')).toBeNull()
    expect(headers.get('authorization')).toBeNull()
    const body: unknown = JSON.parse(String(init?.body))
    expect(body).toMatchObject({
      req_params: {
        text: 'Hello',
        speaker: VOLCENGINE_ICL_DEFAULT_SPEAKER,
      },
    })
    expect(body).not.toHaveProperty('app')
    expect(JSON.stringify(body)).not.toContain('client-secret')
  })

  it('refuses to call upstream when the server token is missing', async () => {
    const fetchImpl = vi.fn()

    await expect(synthesizeVolcengineIcl({ text: 'Hello' }, {
      accessToken: ' ',
      fetchImpl,
    })).rejects.toMatchObject({ errorCode: 'VOLCENGINE_SPEECH_NOT_CONFIGURED' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

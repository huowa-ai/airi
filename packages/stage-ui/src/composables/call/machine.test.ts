import { describe, expect, it } from 'vitest'

import { idleCall, reduceCall, releasesCamera } from './machine'

describe('call state machine', () => {
  it('walks from idle through an active voice call to ended', () => {
    const dialing = reduceCall(idleCall, { type: 'dial' })
    const connecting = reduceCall(dialing, { type: 'connect', mode: 'voice' })
    const active = reduceCall(connecting, { type: 'ready' })
    const ending = reduceCall(active, { type: 'hang-up' })
    const ended = reduceCall(ending, { type: 'ended' })

    expect(dialing.phase).toBe('dialing')
    expect(connecting).toEqual({ phase: 'connecting', mode: 'voice' })
    expect(active).toEqual({ phase: 'active', mode: 'voice' })
    expect(ending.phase).toBe('ending')
    expect(ended).toEqual({ phase: 'ended', mode: 'voice' })
    expect(reduceCall(ended, { type: 'dismiss' })).toEqual(idleCall)
  })

  it('keeps the call when the camera turns off', () => {
    const active = { phase: 'active' as const, mode: 'video' as const }
    const voice = reduceCall(active, { type: 'camera', on: false })
    const video = reduceCall(voice, { type: 'camera', on: true })

    expect(voice).toEqual({ phase: 'active', mode: 'voice' })
    expect(video).toEqual({ phase: 'active', mode: 'video' })
    expect(releasesCamera(active, voice)).toBe(true)
    expect(releasesCamera(voice, video)).toBe(false)
    expect(releasesCamera(active, reduceCall(active, { type: 'hang-up' }))).toBe(true)
  })

  it('fails a connection and can retry or cancel', () => {
    const connecting = reduceCall({ phase: 'dialing', mode: 'voice' }, { type: 'connect', mode: 'video' })
    const failed = reduceCall(connecting, { type: 'fail' })
    const retry = reduceCall(failed, { type: 'connect', mode: 'video' })

    expect(failed).toEqual({ phase: 'failed', mode: 'video' })
    expect(retry).toEqual({ phase: 'connecting', mode: 'video' })
    expect(reduceCall(failed, { type: 'cancel' })).toEqual(idleCall)
  })

  it('ignores a camera change before the call is active', () => {
    const connecting = { phase: 'connecting' as const, mode: 'voice' as const }

    expect(reduceCall(connecting, { type: 'camera', on: true })).toEqual(connecting)
  })
})

/**
 * Call phases and the mode that sits on an active call.
 *
 * `listening`, `thinking`, and `speaking` are not phases. They run together
 * while the phase is `active`. Camera and mute stay inside `active`.
 * Only hang-up leaves the call.
 */
export type CallPhase = 'idle' | 'dialing' | 'connecting' | 'active' | 'ending' | 'ended' | 'failed'

/** `voice` keeps the camera off. `video` keeps it on. */
export type CallMode = 'voice' | 'video'

export interface CallState {
  phase: CallPhase
  mode: CallMode
}

export type CallCommand
  = { type: 'dial' }
    | { type: 'connect', mode: CallMode }
    | { type: 'ready' }
    | { type: 'fail' }
    | { type: 'cancel' }
    | { type: 'hang-up' }
    | { type: 'ended' }
    | { type: 'dismiss' }
    | { type: 'camera', on: boolean }

export const idleCall: CallState = { phase: 'idle', mode: 'voice' }

/**
 * The camera track stops when the call leaves `active`, and when video becomes voice.
 * Camera off does not hang up. `next.phase` stays `active` in that case.
 */
export function releasesCamera(previous: CallState, next: CallState) {
  if (next.phase === 'ending' || next.phase === 'ended' || next.phase === 'idle' || next.phase === 'failed')
    return true
  return next.mode === 'voice' && previous.mode === 'video'
}

/**
 * Moves the call one step.
 * A command that does not apply to the current phase leaves the state as it is.
 * Camera on or off changes `mode` and stays in `active`.
 */
export function reduceCall(state: CallState, command: CallCommand): CallState {
  switch (command.type) {
    case 'dial':
      if (state.phase === 'idle' || state.phase === 'ended')
        return { phase: 'dialing', mode: state.mode }
      return state
    case 'connect':
      if (state.phase === 'dialing' || state.phase === 'failed')
        return { phase: 'connecting', mode: command.mode }
      return state
    case 'ready':
      if (state.phase === 'connecting')
        return { phase: 'active', mode: state.mode }
      return state
    case 'fail':
      if (state.phase === 'connecting' || state.phase === 'dialing')
        return { phase: 'failed', mode: state.mode }
      return state
    case 'cancel':
      if (state.phase === 'dialing' || state.phase === 'failed' || state.phase === 'connecting')
        return idleCall
      return state
    case 'hang-up':
      if (state.phase === 'active' || state.phase === 'connecting' || state.phase === 'dialing')
        return { phase: 'ending', mode: state.mode }
      return state
    case 'ended':
      if (state.phase === 'ending')
        return { phase: 'ended', mode: state.mode }
      return state
    case 'dismiss':
      if (state.phase === 'ended')
        return idleCall
      return state
    case 'camera':
      if (state.phase !== 'active')
        return state
      return { phase: 'active', mode: command.on ? 'video' : 'voice' }
  }
}

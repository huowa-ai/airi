import type { TurnRef } from '@proj-airi/core-agent'

import type { VoiceCallStartFailure, VoiceCallStartOptions } from './voice-call'

import { errorMessageFrom } from '@moeru/std'
import { defineStore } from 'pinia'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { forceEchoCancellation } from '../composables/call/echo'
import { idleCall, reduceCall, releasesCamera } from '../composables/call/machine'
import { createSentenceSpeech } from '../composables/call/sentences'
import { bindCallInterrupt, bindCallRecall, bindCallTurnReader, CALL_FILLER_DELAY_MS, callFillerLine, callTurnAssistantText, joinPlayedText, partialRecallQuery, peekCallUtterance, recallOrFiller, takeCallUtterance } from '../composables/call/turn'
import { useChatSessionStore } from './chat/session-store'
import { useMemoryStore } from './memory'
import { useAiriCardStore } from './modules/airi-card'
import { useSettingsAudioDevice } from './settings/audio-device'
import { useVoiceStore } from './voice'
import { useVoiceCallStore } from './voice-call'

export type { CallMode, CallPhase, CallState } from '../composables/call/machine'
export { callSpeechSelection } from '../composables/call/speech'

/** A voice-call failure, or a camera that the browser did not open. The call does not hang up for a camera failure during `active`. */
export type CallConnectFailure = VoiceCallStartFailure | 'camera-denied'

type CameraFacing = 'user' | 'environment'

interface OpenTurn {
  callId: string
  source: 'voice' | 'video' | 'text'
  userText: string
  fillerLine?: string
  fillerHeard: boolean
}

interface PendingCallWrite {
  sessionId: string
  turnId: string
  userText: string
  outputText: string
  callId: string
  source: 'voice' | 'video' | 'text'
}

type PlaybackStatus = 'finished' | 'cancelled' | 'interrupted' | 'failed' | undefined

/**
 * Runs one voice or video call.
 *
 * Phases: idle, dialing, connecting, active, ending, then ended or failed.
 * Inside active, listening, thinking, and speaking run together.
 * `mode` is voice or video. Camera off sets voice and stays in the call.
 * Mute keeps the microphone track open. The voice activity rule ignores it.
 * A slow recall speaks a filler, then the reply model starts.
 * Call replies use the Doubao proxy, one sentence at a time.
 * An interrupt stores only the sentences whose playback started.
 * Typing in the same chat is not locked. Its source is `text`.
 */
export const useCallOrchestratorStore = defineStore('call-orchestrator', () => {
  const { locale } = useI18n()
  const voice = useVoiceStore()
  const voiceCall = useVoiceCallStore()
  const memory = useMemoryStore()
  const sessions = useChatSessionStore()
  const cards = useAiriCardStore()
  const devices = useSettingsAudioDevice()

  const state = shallowRef(idleCall)
  const callId = shallowRef<string>()
  const speakerOn = shallowRef(true)
  const thinking = shallowRef(false)
  const speaking = shallowRef(false)
  const cameraStream = shallowRef<MediaStream>()
  const cameraError = shallowRef('')
  const facing = shallowRef<CameraFacing>('user')
  const turns = new Map<string, OpenTurn>()
  const played = new Map<string, string[]>()
  const replies = new Map<string, ReturnType<typeof createSentenceSpeech>>()
  const pendingWrites = new Map<string, PendingCallWrite>()
  const closedMarks = new Map<string, { callId: string, source: OpenTurn['source'], assistantText: string }>()
  const settledWrites = new Set<string>()
  let playing = 0
  let recallTail: Promise<void> = Promise.resolve()
  let recallLatest = ''
  let recallQueued = ''
  let recallDone = ''

  const phase = computed(() => state.value.phase)
  // A direct `state.value.phase` read stays narrowed after `await`.
  function currentPhase() {
    return state.value.phase
  }
  const mode = computed(() => state.value.mode)
  const activities = computed(() => ({
    listening: state.value.phase === 'active' && !voice.callMuted,
    thinking: thinking.value,
    speaking: speaking.value,
  }))

  function apply(next: typeof state.value) {
    const previous = state.value
    state.value = next
    if (releasesCamera(previous, next))
      releaseCamera()
    return next
  }

  function releaseCamera() {
    const stream = cameraStream.value
    cameraStream.value = undefined
    stream?.getTracks().forEach(track => track.stop())
  }

  function replaceCamera(stream: MediaStream) {
    releaseCamera()
    cameraStream.value = stream
  }

  function openCamera(next: CameraFacing) {
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: next },
    })
  }

  function personaOf(sessionId: string) {
    return sessions.sessionMetas[sessionId]?.characterId || cards.activeCardId || 'default'
  }

  /**
   * Recall for one query. A newer query replaces an older one that has not started.
   * A finished query is not searched again until the text changes.
   */
  function recallQuery(sessionId: string, query: string) {
    const requested = `${sessionId}\0${query}`
    recallLatest = requested
    if (recallDone === requested || recallQueued === requested)
      return recallTail
    recallQueued = requested
    const run = recallTail.then(async () => {
      if (recallLatest !== requested)
        return
      const binding = sessions.sessionMetas[sessionId]?.bindings?.[0]
      await memory.prepareRecall({
        sessionId,
        personaId: personaOf(sessionId),
        query,
        ...(binding ? { binding } : {}),
      })
      if (recallLatest === requested)
        recallDone = requested
      if (recallQueued === requested)
        recallQueued = ''
    })
    recallTail = run.then(() => {}, () => {})
    return run
  }

  function resetRecall() {
    recallLatest = ''
    recallQueued = ''
    recallDone = ''
  }

  function replySpeech(turn: TurnRef) {
    const existing = replies.get(turn.turnId)
    if (existing)
      return existing
    const handle: { cancel: () => void } = { cancel: () => {} }
    const created = createSentenceSpeech({
      speak: async (sentence, signal) => {
        if (signal.aborted || !speakerOn.value)
          return
        voice.startResponse(turn)
        const stream = voice.getSpeech(turn)
        if (!stream || signal.aborted)
          return
        if (stream.write(sentence).status === 'closed') {
          handle.cancel()
          return
        }
        stream.flush()
      },
    })
    handle.cancel = () => created.cancel()
    replies.set(turn.turnId, created)
    return created
  }

  function speakFiller(turn: TurnRef, line: string) {
    try {
      const speech = replySpeech(turn)
      speech.write(`${line} `)
      speech.flush()
    }
    catch (error) {
      console.warn('[call] The filler did not play.', errorMessageFrom(error) ?? '')
    }
  }

  async function awaitTurnRecall(input: { sessionId: string, turnId: string, message: string, speaks: boolean }) {
    const spoken = peekCallUtterance(input.sessionId, input.turnId)
    const phaseNow = state.value.phase
    const openCall = phaseNow === 'active' || ((phaseNow === 'ending' || phaseNow === 'ended') && spoken)
    if (!input.speaks || !callId.value || !openCall)
      return false
    takeCallUtterance(input.sessionId, input.turnId)
    const source = spoken ? (state.value.mode === 'video' ? 'video' : 'voice') : 'text'
    const fillerLine = spoken ? callFillerLine(locale.value) : undefined
    turns.set(input.turnId, {
      callId: callId.value,
      source,
      userText: input.message,
      fillerHeard: false,
      ...(fillerLine ? { fillerLine } : {}),
    })
    const query = input.message.trim()
    const recall = query === '' ? Promise.resolve() : recallQuery(input.sessionId, query)
    thinking.value = true
    try {
      if (spoken && speakerOn.value && fillerLine) {
        await recallOrFiller({
          recall,
          delayMs: CALL_FILLER_DELAY_MS,
          wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
          onSlow: () => speakFiller({ sessionId: input.sessionId, turnId: input.turnId }, fillerLine),
        })
      }
      else {
        await recall
      }
    }
    catch (error) {
      console.warn('[call] Recall was not ready.', errorMessageFrom(error) ?? '')
    }
    finally {
      thinking.value = false
    }
    return true
  }

  function playedText(turnId: string) {
    return joinPlayedText(played.get(turnId) ?? [])
  }

  function dropTurn(turnId: string) {
    turns.delete(turnId)
    played.delete(turnId)
    replies.delete(turnId)
    pendingWrites.delete(turnId)
  }

  function commitTurn(record: PendingCallWrite, status: PlaybackStatus) {
    if (settledWrites.has(record.turnId))
      return
    settledWrites.add(record.turnId)
    const open = turns.get(record.turnId)
    const interrupted = status === 'interrupted'
    const heard = open?.fillerHeard ? open.fillerLine : undefined
    const assistantText = interrupted
      ? playedText(record.turnId)
      : (callTurnAssistantText({
          interrupted: false,
          outputText: record.outputText,
          playedText: playedText(record.turnId),
          ...(heard ? { fillerHeard: heard } : {}),
        }) ?? record.outputText)
    const binding = sessions.sessionMetas[record.sessionId]?.bindings?.[0]
    memory.recordChatTurn({
      sessionId: record.sessionId,
      turnId: record.turnId,
      personaId: personaOf(record.sessionId),
      userText: record.userText,
      assistantText,
      systemPrompt: '',
      timestamp: new Date().toISOString(),
      interrupted,
      failed: status === 'failed',
      callId: record.callId,
      source: record.source,
      ...(binding ? { binding } : {}),
    })
    closedMarks.set(record.turnId, {
      callId: record.callId,
      source: record.source,
      assistantText,
    })
    dropTurn(record.turnId)
  }

  function readTurn(input: { sessionId: string, turnId: string, interrupted: boolean, outputText: string }) {
    const closed = closedMarks.get(input.turnId)
    if (closed) {
      closedMarks.delete(input.turnId)
      return closed
    }
    const open = turns.get(input.turnId)
    if (!open)
      return undefined
    if (input.interrupted) {
      replies.get(input.turnId)?.cancel()
      // A later playback end must not store the unplayed reply.
      settledWrites.add(input.turnId)
      const assistantText = playedText(input.turnId)
      dropTurn(input.turnId)
      return {
        callId: open.callId,
        source: open.source,
        assistantText,
      }
    }
    pendingWrites.set(input.turnId, {
      sessionId: input.sessionId,
      turnId: input.turnId,
      userText: open.userText,
      outputText: input.outputText,
      callId: open.callId,
      source: open.source,
    })
    return { defer: true as const }
  }

  function onInterrupt(turn: { sessionId: string, turnId: string }) {
    const open = turns.get(turn.turnId)
    if (!open)
      return
    replies.get(turn.turnId)?.cancel()
    const waiting = pendingWrites.get(turn.turnId)
    const record = waiting ?? {
      sessionId: turn.sessionId,
      turnId: turn.turnId,
      userText: open.userText,
      outputText: '',
      callId: open.callId,
      source: open.source,
    }
    commitTurn(record, 'interrupted')
  }

  const unbindRecall = bindCallRecall(awaitTurnRecall)
  const unbindReader = bindCallTurnReader(readTurn)
  const unbindInterrupt = bindCallInterrupt(onInterrupt)

  function finishEnd() {
    const phaseNow = state.value.phase
    if (phaseNow !== 'active' && phaseNow !== 'connecting' && phaseNow !== 'dialing')
      return
    apply(reduceCall(state.value, { type: 'hang-up' }))
    voiceCall.hangUp()
    apply(reduceCall(state.value, { type: 'ended' }))
    resetRecall()
    speakerOn.value = true
  }

  watch(() => voice.callActive, (active, was) => {
    if (was && !active && state.value.phase === 'active')
      finishEnd()
  })

  watch(() => devices.stream, (stream) => {
    if (!stream)
      return
    if (state.value.phase !== 'active' && state.value.phase !== 'connecting')
      return
    void forceEchoCancellation(stream).catch((error) => {
      console.warn('[call] Echo cancellation was not applied.', errorMessageFrom(error) ?? '')
    })
  })

  watch(() => voice.transcript?.corrected.text, (text) => {
    if (!text || state.value.phase !== 'active' || voice.callMuted)
      return
    const query = partialRecallQuery(text)
    const sessionId = voice.transcript?.sessionId
    if (!query || !sessionId)
      return
    void recallQuery(sessionId, query)
  })

  /**
   * Asks for the microphone, and for the camera when `mode` is video.
   * The camera request starts before the first await, so the click still counts.
   */
  async function begin(mode: 'voice' | 'video', options: VoiceCallStartOptions = {}): Promise<CallConnectFailure | undefined> {
    if (state.value.phase === 'connecting')
      return undefined
    if (state.value.phase === 'active' && voice.callActive)
      return undefined
    if (state.value.phase === 'idle' || state.value.phase === 'ended')
      apply(reduceCall(state.value, { type: 'dial' }))
    const started = apply(reduceCall(state.value, { type: 'connect', mode }))
    if (started.phase !== 'connecting')
      return undefined

    cameraError.value = ''
    const cameraReady = mode === 'video' ? openCamera(facing.value) : undefined
    const failure = await voiceCall.start(options)
    if (failure || !voice.callActive) {
      if (cameraReady)
        void cameraReady.then(releaseStream).catch(() => {})
      apply(reduceCall(state.value, { type: 'fail' }))
      return failure ?? 'unconfigured'
    }
    if (cameraReady) {
      try {
        const stream = await cameraReady
        if (currentPhase() !== 'connecting') {
          releaseStream(stream)
          return undefined
        }
        replaceCamera(stream)
      }
      catch (error) {
        cameraError.value = errorMessageFrom(error) ?? 'The camera did not open.'
        voiceCall.hangUp()
        apply(reduceCall(state.value, { type: 'fail' }))
        return 'camera-denied'
      }
    }
    callId.value = crypto.randomUUID()
    apply(reduceCall(state.value, { type: 'ready' }))
    if (devices.stream)
      void forceEchoCancellation(devices.stream).catch(() => {})
    return undefined
  }

  function releaseStream(stream: MediaStream) {
    stream.getTracks().forEach(track => track.stop())
  }

  function openDialer() {
    apply(reduceCall(state.value, { type: 'dial' }))
  }

  function placeVoiceCall(options?: VoiceCallStartOptions) {
    return begin('voice', options)
  }

  function chooseMode(mode: 'voice' | 'video', options?: VoiceCallStartOptions) {
    return begin(mode, options)
  }

  function retry(options?: VoiceCallStartOptions) {
    if (state.value.phase !== 'failed')
      return Promise.resolve(undefined)
    return begin(state.value.mode, options)
  }

  function cancel() {
    if (state.value.phase === 'active')
      return
    voiceCall.hangUp()
    apply(reduceCall(state.value, { type: 'cancel' }))
    resetRecall()
  }

  function dismiss() {
    apply(reduceCall(state.value, { type: 'dismiss' }))
  }

  /** Mute keeps the microphone track. Voice activity accepts no input while this is set. */
  function setMuted(muted: boolean) {
    voice.setCallMuted(muted)
  }

  function setSpeaker(on: boolean) {
    speakerOn.value = on
    if (on)
      return
    for (const [turnId, speech] of replies) {
      speech.cancel()
      replies.delete(turnId)
    }
    for (const turn of voice.activeTurns)
      voice.getSpeech(turn)?.cancel('The call speaker is off')
    playing = 0
    speaking.value = false
  }

  async function setCamera(on: boolean) {
    if (state.value.phase !== 'active')
      return
    if (on && state.value.mode === 'video' && cameraStream.value)
      return
    if (!on) {
      apply(reduceCall(state.value, { type: 'camera', on: false }))
      return
    }
    try {
      const stream = await openCamera(facing.value)
      if (state.value.phase !== 'active') {
        releaseStream(stream)
        return
      }
      replaceCamera(stream)
      cameraError.value = ''
      apply(reduceCall(state.value, { type: 'camera', on: true }))
    }
    catch (error) {
      cameraError.value = errorMessageFrom(error) ?? 'The camera did not open.'
    }
  }

  async function flipCamera() {
    if (state.value.phase !== 'active' || state.value.mode !== 'video')
      return
    const next: CameraFacing = facing.value === 'user' ? 'environment' : 'user'
    try {
      const stream = await openCamera(next)
      if (state.value.phase !== 'active' || state.value.mode !== 'video') {
        releaseStream(stream)
        return
      }
      facing.value = next
      replaceCamera(stream)
      cameraError.value = ''
    }
    catch (error) {
      cameraError.value = errorMessageFrom(error) ?? 'The camera did not open.'
    }
  }

  function owns(turn: { turnId: string }) {
    return turns.has(turn.turnId)
  }

  function writeReply(turn: TurnRef, text: string) {
    if (!speakerOn.value || !turns.has(turn.turnId))
      return
    replySpeech(turn).write(text)
  }

  function flushReply(turnId: string) {
    replies.get(turnId)?.flush()
  }

  function finishReply(turnId: string) {
    replies.get(turnId)?.end()
  }

  /** One sentence started playback. An interrupt keeps these sentences. */
  function notePlayed(turnId: string, text: string) {
    const line = text.trim()
    const open = turns.get(turnId)
    if (!line || !open)
      return
    const lines = played.get(turnId) ?? []
    lines.push(line)
    played.set(turnId, lines)
    if (open.fillerLine && line.includes(open.fillerLine))
      open.fillerHeard = true
    playing += 1
    speaking.value = true
  }

  function notePlaybackEnded() {
    playing = Math.max(0, playing - 1)
    speaking.value = playing > 0
  }

  /**
   * Playback of this reply ended, or it never started.
   * An interrupt stores only the sentences that started. Any other end stores the reply.
   */
  function playbackSettled(turnId: string, status: PlaybackStatus) {
    const waiting = pendingWrites.get(turnId)
    if (!waiting)
      return
    if (status === 'interrupted')
      replies.get(turnId)?.cancel()
    commitTurn(waiting, status)
  }

  onScopeDispose(() => {
    unbindRecall()
    unbindReader()
    unbindInterrupt()
    releaseCamera()
  })

  return {
    state,
    phase,
    mode,
    callId,
    speakerOn,
    cameraStream,
    cameraError,
    facing,
    activities,
    openDialer,
    placeVoiceCall,
    chooseMode,
    retry,
    cancel,
    hangUp: finishEnd,
    dismiss,
    setMuted,
    setSpeaker,
    setCamera,
    flipCamera,
    owns,
    writeReply,
    flushReply,
    finishReply,
    notePlayed,
    notePlaybackEnded,
    playbackSettled,
  }
})

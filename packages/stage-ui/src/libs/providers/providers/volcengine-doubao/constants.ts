/** Speech provider that calls the AIRI Doubao proxy. The page does not store `X-Api-Key`. */
export const VOLCENGINE_DOUBAO_SPEECH_PROVIDER_ID = 'volcengine-doubao-speech'

/** Hearing provider that calls the AIRI Doubao recognition proxy. */
export const VOLCENGINE_DOUBAO_TRANSCRIPTION_PROVIDER_ID = 'volcengine-doubao-transcription'

/** Doubao voice clone 2.0 resource. The server proxy selects this resource. */
export const VOLCENGINE_DOUBAO_SPEECH_MODEL = 'seed-icl-2.0'

/** Doubao streaming recognition 2.0 resource. The server proxy selects this resource. */
export const VOLCENGINE_DOUBAO_TRANSCRIPTION_MODEL = 'volc.seedasr.sauc.duration'

/** Cloned speaker the call uses when the page does not choose another voice. */
export const VOLCENGINE_DOUBAO_SPEAKER = 'S_hMBcmqRi2'

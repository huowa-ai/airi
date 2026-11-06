/**
 * Call id and source for one L0 row.
 * The gateway stores `role`, `content`, and `timestamp` only. It drops other fields.
 * These two values stay in the first line of `content`.
 */
export interface CallMark {
  /** One UUID for the call. Absent when the turn is not part of a call. */
  callId?: string
  /** `voice`, `video`, or `text`. A typed turn uses `text`. */
  source?: CallSource
}

export const callSources = ['voice', 'video', 'text'] as const

export type CallSource = typeof callSources[number]

const callIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const headerPattern = /^<!-- airi:meta((?: callId=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?(?: source=(?:voice|video|text))?) -->\n/i

/**
 * The first line of a stored L0 body.
 * `callId` comes before `source`. A missing value is left out.
 *
 * @example
 * callHeaderLine({ callId: '11111111-1111-4111-8111-111111111111', source: 'text' })
 * // => '<!-- airi:meta callId=11111111-1111-4111-8111-111111111111 source=text -->'
 */
export function callHeaderLine(mark: CallMark): string | undefined {
  const callId = mark.callId && callIdPattern.test(mark.callId) ? mark.callId : undefined
  const source = mark.source && isCallSource(mark.source) ? mark.source : undefined
  if (!callId && !source)
    return undefined
  const fields = [
    ...(callId ? [`callId=${callId}`] : []),
    ...(source ? [`source=${source}`] : []),
  ]
  return `<!-- airi:meta ${fields.join(' ')} -->`
}

/**
 * Writes the call header, then a newline, then the body.
 * A body that already starts with the header is unchanged.
 *
 * @example
 * prefixCallHeader('Ada likes tea.', { callId: '11111111-1111-4111-8111-111111111111', source: 'text' })
 * // => '<!-- airi:meta callId=11111111-1111-4111-8111-111111111111 source=text -->\nAda likes tea.'
 */
export function prefixCallHeader(body: string, mark: CallMark): string {
  if (readCallHeader(body))
    return body
  const line = callHeaderLine(mark)
  if (!line)
    return body
  return `${line}\n${body}`
}

/**
 * Removes the call header.
 * The model prompt and the chat bubble read this text. Recall display reads it too.
 *
 * @example
 * projectCallContent('<!-- airi:meta callId=11111111-1111-4111-8111-111111111111 source=text -->\nAda likes tea.')
 * // => 'Ada likes tea.'
 */
export function projectCallContent(content: string): string {
  const mark = headerPattern.exec(content)
  if (!mark?.[1])
    return content
  return content.slice(mark[0].length)
}

/**
 * Reads `callId` and `source` from the first line of a stored L0 body.
 * A body with no header returns undefined.
 *
 * @example
 * readCallHeader('<!-- airi:meta source=text -->\nAda likes tea.')
 * // => { source: 'text' }
 */
export function readCallHeader(content: string): CallMark | undefined {
  const match = headerPattern.exec(content)
  const fields = match?.[1]
  if (!fields)
    return undefined
  const callId = /callId=([0-9a-f-]{36})/i.exec(fields)?.[1]
  const sourceText = /source=(voice|video|text)/.exec(fields)?.[1]
  const source = sourceText && isCallSource(sourceText) ? sourceText : undefined
  if (!callId && !source)
    return undefined
  return {
    ...(callId ? { callId } : {}),
    ...(source ? { source } : {}),
  }
}

function isCallSource(value: string): value is CallSource {
  return value === 'voice' || value === 'video' || value === 'text'
}

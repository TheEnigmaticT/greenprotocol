/** Parses one `event: x\ndata: {...}` frame from the chat SSE stream. */
export function parseSseEvent(frame: string): { event: string; data: Record<string, unknown> } {
  const [eventLine, dataLine] = frame.split('\n')
  return {
    event: eventLine.replace('event: ', ''),
    data: JSON.parse(dataLine.replace('data: ', '')) as Record<string, unknown>,
  }
}

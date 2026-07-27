export function parseSystemFeedPayload(payloadJson: string) {
  const envelope = JSON.parse(payloadJson) as Record<string, unknown>;
  return typeof envelope?.text === 'string'
    ? (JSON.parse(envelope.text) as Record<string, unknown>)
    : envelope;
}

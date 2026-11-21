// One call to Solar, read as it is written.

const UPSTAGE_URL = 'https://api.upstage.ai/v1/chat/completions';
export const MODEL = process.env.SOLAR_MODEL || 'solar-pro4';

export class SolarError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Asks, and calls `onText(piece)` for every piece of the answer as it arrives.
 * Resolves with { finish, usage, ms, firstMs, chars } when the answer has ended.
 * Throws a SolarError when the model cannot be asked; `signal` ends the call from outside.
 */
export async function ask({ messages, maxTokens, signal, onText, temperature = 0.15 }) {
  const started = Date.now();
  let response;
  try {
    response = await fetch(UPSTAGE_URL, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.UPSTAGE_API_KEY}` },
      body: JSON.stringify({ model: MODEL, temperature, max_tokens: maxTokens, messages, stream: true, stream_options: { include_usage: true } }),
    });
  } catch (error) {
    throw new SolarError(504, 'model_timeout', error?.name === 'AbortError' ? 'The model took too long' : 'The model could not be reached');
  }
  if (response.status === 401 || response.status === 403) throw new SolarError(503, 'not_configured', 'The model key was rejected');
  if (response.status === 429) throw new SolarError(429, 'busy', 'Too many analyses are running. Try again in a minute');
  if (!response.ok || !response.body) {
    console.error('solar error', response.status, (await response.text().catch(() => '')).slice(0, 500));
    throw new SolarError(502, 'model_error', 'The model returned an error');
  }

  const result = { finish: null, usage: null, ms: 0, firstMs: null, chars: 0 };
  const decoder = new TextDecoder();
  let buffer = '';
  const event = (line) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let json;
    try { json = JSON.parse(data); } catch { return; }
    if (json.usage) result.usage = json.usage;
    const choice = json.choices?.[0];
    if (choice?.finish_reason) result.finish = choice.finish_reason;
    const piece = choice?.delta?.content;
    if (typeof piece === 'string' && piece) {
      result.firstMs ??= Date.now() - started;
      result.chars += piece.length;
      onText(piece);
    }
  };
  try {
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      for (;;) {
        const end = buffer.indexOf('\n');
        if (end < 0) break;
        event(buffer.slice(0, end).trimEnd());
        buffer = buffer.slice(end + 1);
      }
    }
    if (buffer) event(buffer.trimEnd());
  } catch (error) {
    if (error?.name === 'AbortError') throw new SolarError(504, 'model_timeout', 'The model took too long');
    throw new SolarError(502, 'model_error', 'The answer broke off');
  }
  result.ms = Date.now() - started;
  return result;
}

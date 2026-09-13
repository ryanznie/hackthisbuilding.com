import { ApiFailure, type AIBinding } from './generation';

const API_BASE = 'https://openrouter.ai/api/v1';
const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_MAX_BYTES = 32 * 1024;

export interface OpenRouterRequestOptions {
  timeoutMs?: number;
  maxBytes?: number;
  fetcher?: typeof fetch;
}

function upstreamFailure(status: number): ApiFailure {
  if (status === 401 || status === 403) return new ApiFailure(503, 'GENERATION_UNAVAILABLE', 'The AI connection is unavailable right now. Please try again later.');
  if (status === 402) return new ApiFailure(503, 'GENERATION_CREDITS_UNAVAILABLE', 'The AI service has no available credits. Please try again later.');
  if (status === 429) return new ApiFailure(503, 'GENERATION_RATE_LIMITED', 'The AI service is busy. Please try again shortly.');
  return new ApiFailure(502, 'GENERATION_UPSTREAM_ERROR', 'The AI service could not complete this request. Please try again.');
}

/** Exactly one provider request. Credentials never accompany redirects or errors. */
export async function requestOpenRouter(
  apiKey: string,
  path: '/chat/completions' | '/images',
  body: unknown,
  options: OpenRouterRequestOptions = {},
): Promise<unknown> {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new ApiFailure(503, 'GENERATION_UNAVAILABLE', 'The AI connection is unavailable right now. Please try again later.');
  if (path !== '/chat/completions' && path !== '/images') throw new ApiFailure(500, 'INVALID_PROVIDER_ENDPOINT', 'The AI request could not be prepared.');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new ApiFailure(500, 'INVALID_PROVIDER_LIMIT', 'The AI request could not be prepared.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetcher ?? fetch)(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://www.hackthisbuilding.com',
        'X-Title': 'Hack This Building',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      // Workerd supports manual/follow; reject 3xx below without forwarding credentials.
      redirect: 'manual',
    });
    if (!response.ok) {
      console.warn('OpenRouter request failed', { path, status: response.status });
      // Do not read, log, or return provider error bodies: they may echo secrets.
      await response.body?.cancel().catch(() => undefined);
      throw upstreamFailure(response.status);
    }
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new ApiFailure(502, 'AI_RESPONSE_TOO_LARGE', 'The AI result was too large. Please try a simpler request.');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new ApiFailure(502, 'AI_INVALID_RESPONSE', 'The AI service returned an empty result. Please try again.');
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ApiFailure(502, 'AI_RESPONSE_TOO_LARGE', 'The AI result was too large. Please try a simpler request.');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let decoded: unknown;
    try { decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
    catch { throw new ApiFailure(502, 'AI_INVALID_RESPONSE', 'The AI service returned an invalid result. Please try again.'); }
    if (decoded && typeof decoded === 'object' && 'error' in decoded && decoded.error) throw upstreamFailure(502);
    return decoded;
  } catch (error) {
    if (error instanceof ApiFailure) throw error;
    console.warn('OpenRouter transport failure', { path, type: error instanceof Error ? error.name : 'unknown' });
    if (controller.signal.aborted) throw new ApiFailure(503, 'GENERATION_TIMEOUT', 'The AI service took too long. Please try again.');
    throw new ApiFailure(502, 'GENERATION_UPSTREAM_ERROR', 'The AI service could not complete this request. Please try again.');
  } finally { clearTimeout(timer); }
}

/** The existing moderation/generation pipeline consumes the returned JSON. */
export function createOpenRouterAI(
  apiKey: string,
  model = 'openai/gpt-4.1-mini',
  options: Pick<OpenRouterRequestOptions, 'fetcher'> = {},
): AIBinding {
  return {
    run(_model, input) {
      return requestOpenRouter(apiKey, '/chat/completions', {
        model,
        messages: input.messages,
        temperature: input.temperature ?? 0.15,
        max_tokens: input.max_tokens ?? 1400,
        response_format: { type: 'json_object' },
        stream: false,
      }, options);
    },
  };
}

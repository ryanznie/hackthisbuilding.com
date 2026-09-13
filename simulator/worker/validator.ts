import { ApiFailure } from './generation';

export interface ValidationService {
  moderate(text: string): Promise<void>;
  validateAnimation<T>(animation: T): Promise<T>;
}

export function createValidationService(url: string, token?: string): ValidationService {
  async function post(path: string, body: unknown, attempts: number, timeoutMs: number): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const response = await fetch(`${url.replace(/\/$/, '')}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
        const data = await response.json() as Record<string, unknown>;
        if (response.ok) return data;
        if (response.status === 422) throw new ApiFailure(502, 'AI_INVALID_RESPONSE', 'The generated result did not match the display format. Please try again.');
        throw new Error('validator unavailable');
      } catch (error) {
        if (error instanceof ApiFailure) throw error;
        if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt));
      }
    }
    throw new ApiFailure(503, 'VALIDATION_UNAVAILABLE', 'The safety check is temporarily unavailable. Please try again.');
  }
  return {
    async moderate(text) {
      // Python owns the three model attempts (20s each plus 750ms backoff).
      // One HTTP request avoids duplicating paid moderation when the server retries.
      const result = await post('/moderate', { text }, 1, 65_000);
      if (result.allowed === true && result.adversarial === false && result.category === 'allowed') return;
      const adversarial = result.adversarial === true;
      const reason = typeof result.reason === 'string' ? result.reason : 'This idea is outside the public display rules.';
      throw new ApiFailure(422, adversarial ? 'ADVERSARIAL_PROMPT' : 'PROMPT_REJECTED', adversarial ? `This prompt appears to be trying to bypass the display rules. ${reason}` : reason);
    },
    async validateAnimation<T>(animation: T) {
      const result = await post('/validate-animation', animation, 3, 5_000);
      return result.animation as T;
    },
  };
}

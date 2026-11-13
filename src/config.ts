import { DEFAULT_TIMEOUT_MS } from './constants.js';
import { YilyError, YilyErrorCode } from './errors.js';
import { normalizeBaseURL } from './utils.js';

/** Options accepted by {@link Client}. */
export interface Config {
  /** Root URL of the Yily instance, for example `https://yily.example.com`. */
  baseURL: string;

  /** Environment ID (`ENV…`) to read variables from. */
  environmentID: string;

  /** Read-scoped Personal Access Token prefixed with `yily_`. */
  token: string;

  /**
   * Per-request timeout in milliseconds. Defaults to 5000; a zero or negative
   * value also selects the default.
   */
  timeout?: number;

  /**
   * Optional fetch implementation, for tests or runtimes without a global
   * `fetch`. Defaults to `globalThis.fetch`.
   */
  fetch?: typeof fetch;
}

/** Normalized configuration consumed by {@link Client}. */
export interface ValidatedConfig {
  baseURL: string;
  environmentID: string;
  token: string;
  timeout: number;
  fetch?: typeof fetch;
}

/**
 * Validates a {@link Config} and returns its normalized form.
 *
 * @throws {YilyError} with a configuration error code when a required value is
 * missing or malformed.
 */
export function validateConfig(config: Config): ValidatedConfig {
  if (config === null || typeof config !== 'object') {
    throw new YilyError(YilyErrorCode.MissingBaseURL, 'yily: base URL is required');
  }

  const rawBaseURL = typeof config.baseURL === 'string' ? config.baseURL.trim() : '';
  if (rawBaseURL === '') {
    throw new YilyError(YilyErrorCode.MissingBaseURL, 'yily: base URL is required');
  }
  validateBaseURL(rawBaseURL);

  const token = typeof config.token === 'string' ? config.token.trim() : '';
  if (token === '') {
    throw new YilyError(YilyErrorCode.MissingToken, 'yily: token is required');
  }
  if (!token.startsWith('yily_') || token.length === 'yily_'.length) {
    throw new YilyError(YilyErrorCode.InvalidToken, 'yily: token must be a Yily PAT');
  }

  const environmentID =
    typeof config.environmentID === 'string' ? config.environmentID.trim() : '';
  if (environmentID === '') {
    throw new YilyError(YilyErrorCode.MissingEnvironmentID, 'yily: environment ID is required');
  }

  let timeout = DEFAULT_TIMEOUT_MS;
  if (config.timeout !== undefined) {
    if (typeof config.timeout !== 'number' || !Number.isFinite(config.timeout)) {
      throw new YilyError(
        YilyErrorCode.InvalidTimeout,
        'yily: timeout must be a finite number of milliseconds',
      );
    }
    if (config.timeout > 0) {
      timeout = config.timeout;
    }
  }

  if (config.fetch !== undefined && typeof config.fetch !== 'function') {
    throw new YilyError(YilyErrorCode.InvalidFetch, 'yily: fetch must be a function');
  }

  const validated: ValidatedConfig = {
    baseURL: normalizeBaseURL(rawBaseURL),
    environmentID,
    token,
    timeout,
  };
  if (config.fetch !== undefined) {
    validated.fetch = config.fetch;
  }
  return validated;
}

/**
 * Rejects anything that is not an absolute HTTP(S) URL without credentials,
 * query string or fragment.
 */
function validateBaseURL(raw: string): void {
  const invalid = (): never => {
    throw new YilyError(
      YilyErrorCode.InvalidBaseURL,
      'yily: base URL must be an absolute HTTP or HTTPS URL',
    );
  };

  // Require an explicit authority (scheme plus host).
  if (!/^https?:\/\//i.test(raw)) {
    invalid();
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return invalid();
  }

  const protocol = parsed.protocol;
  if (
    (protocol !== 'http:' && protocol !== 'https:') ||
    parsed.hostname === '' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parsed.href.includes('?') // Rejects a bare trailing "?".
  ) {
    invalid();
  }
}

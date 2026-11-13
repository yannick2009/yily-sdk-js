import { validateConfig, type Config } from './config.js';
import { APIError, YilyError, YilyErrorCode, type APIErrorOptions } from './errors.js';
import {
  decodeFields,
  inspectSchema,
  type Loaded,
  type Schema,
} from './schema.js';
import { normalizeVariableName } from './utils.js';

/** Options accepted by every client method. */
export interface RequestOptions {
  /** Cancels the request when aborted. */
  signal?: AbortSignal;
}

interface BatchVariable {
  name: string;
  version?: number;
}

interface BatchValuesRequest {
  variables: BatchVariable[];
}

/**
 * Client reads configuration variables from a Yily environment.
 *
 * A client is immutable after construction and can be shared safely across
 * concurrent requests.
 *
 * @example
 * ```ts
 * const client = new Client({
 *   baseURL: 'https://yily.example.com',
 *   environmentID: 'ENVxxxxxxxxxxxx',
 *   token: process.env.YILY_TOKEN!,
 * });
 *
 * const apiKey = await client.get('API_KEY');
 * ```
 */
export class Client {
  private readonly baseURL: string;
  private readonly environmentID: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeout: number;

  /**
   * Validates `config` and creates a client for the configured environment.
   *
   * @throws {YilyError} when a required option is missing or malformed.
   */
  constructor(config: Config) {
    const validated = validateConfig(config);

    let fetchImpl: typeof fetch;
    if (validated.fetch !== undefined) {
      fetchImpl = validated.fetch;
    } else if (typeof globalThis.fetch === 'function') {
      // Call through globalThis so browsers do not reject an unbound fetch.
      fetchImpl = (input, init) => globalThis.fetch(input, init);
    } else {
      throw new YilyError(
        YilyErrorCode.InvalidFetch,
        'yily: no global fetch implementation is available; pass Config.fetch',
      );
    }

    this.baseURL = validated.baseURL;
    this.environmentID = validated.environmentID;
    this.token = validated.token;
    this.fetchImpl = fetchImpl;
    this.timeout = validated.timeout;
  }

  /**
   * Returns the active value of a single configuration variable.
   *
   * The name is normalized to Yily's convention (upper case, whitespace runs
   * replaced by underscores).
   *
   * @throws {YilyError} with `INVALID_VARIABLE_NAME` when the normalized name
   * is empty, or `VARIABLE_NOT_FOUND` when the variable does not exist.
   */
  async get(name: string, options: RequestOptions = {}): Promise<string> {
    return this.getValue(name, 0, options);
  }

  /**
   * Returns the value of a single configuration variable at a specific
   * version.
   *
   * @throws {YilyError} with `INVALID_VERSION` when `version` is not a positive
   * integer.
   */
  async getVersion(name: string, version: number, options: RequestOptions = {}): Promise<string> {
    if (!Number.isInteger(version) || version <= 0) {
      throw new YilyError(
        YilyErrorCode.InvalidVersion,
        'yily: variable version must be a positive integer',
      );
    }
    return this.getValue(name, version, options);
  }

  /**
   * Returns every variable of the environment as a map of variable name to
   * active value.
   *
   * Two requests are performed: the variable names are listed, then their
   * values are read in one batch. Changes made between the two requests may
   * affect the result, so the map is not an atomic snapshot.
   */
  async getAll(options: RequestOptions = {}): Promise<Record<string, string>> {
    const path = `/environments/${encodeURIComponent(this.environmentID)}/variables`;
    const parsed = await this.request('GET', path, undefined, options.signal);
    const names = parseVariableList(extractData(parsed));

    if (names.length === 0) {
      return {};
    }

    return this.fetchBatchValues(
      names.map((name) => ({ name })),
      options.signal,
    );
  }

  /**
   * Loads every field of `schema` and returns a new object.
   *
   * The object's type is inferred from the schema: string specs produce
   * strings, while object specs produce the JavaScript value matching their
   * `type`.
   *
   * @example
   * ```ts
   * const cfg = await client.load({
   *   host: { name: 'DB_HOST' },
   *   port: { name: 'DB_PORT', type: 'int' },
   * });
   * ```
   */
  async load<S extends Schema>(schema: S, options: RequestOptions = {}): Promise<Loaded<S>> {
    const fields = inspectSchema(schema);
    if (fields.length === 0) {
      return {} as Loaded<S>;
    }

    const values = await this.fetchBatchValues(
      fields.map((field) => ({ name: field.varName, version: field.version })),
      options.signal,
    );

    return decodeFields(fields, values) as Loaded<S>;
  }

  private async getValue(
    name: string,
    version: number,
    options: RequestOptions,
  ): Promise<string> {
    const normalizedName = typeof name === 'string' ? normalizeVariableName(name) : '';
    if (normalizedName === '') {
      throw new YilyError(YilyErrorCode.InvalidVariableName, 'yily: variable name cannot be empty');
    }

    const values = await this.fetchBatchValues(
      [{ name: normalizedName, version }],
      options.signal,
    );

    if (!Object.hasOwn(values, normalizedName)) {
      throw new YilyError(YilyErrorCode.VariableNotFound, 'yily: variable not found');
    }

    const value = values[normalizedName];
    if (value === undefined) {
      throw new YilyError(YilyErrorCode.VariableNotFound, 'yily: variable not found');
    }
    return value;
  }

  /**
   * Retrieves values from the batch endpoint, normalizing and deduplicating
   * selections. Two selections of the same variable must request the same
   * version. Unknown names are omitted by the server and therefore absent
   * from the returned map.
   */
  private async fetchBatchValues(
    selections: readonly BatchVariable[],
    signal?: AbortSignal,
  ): Promise<Record<string, string>> {
    if (selections.length === 0) {
      return {};
    }

    const requestedVersion = new Map<string, number>();
    const deduped: BatchVariable[] = [];

    for (const selection of selections) {
      const name = normalizeVariableName(selection.name);
      if (name === '') {
        continue;
      }

      const version = selection.version ?? 0;
      if (requestedVersion.has(name)) {
        if (requestedVersion.get(name) !== version) {
          throw new YilyError(
            YilyErrorCode.ConflictingVariableVersion,
            `yily: a variable cannot use different versions in one load: ${name}`,
          );
        }
        continue;
      }

      requestedVersion.set(name, version);
      deduped.push(version > 0 ? { name, version } : { name });
    }

    if (deduped.length === 0) {
      return {};
    }

    let body: string;
    try {
      body = JSON.stringify({ variables: deduped } satisfies BatchValuesRequest);
    } catch (error) {
      throw new YilyError(
        YilyErrorCode.EncodeFailed,
        `yily: failed to encode request: ${errorMessage(error)}`,
        { cause: error },
      );
    }

    const path = `/environments/${encodeURIComponent(this.environmentID)}/variables/values`;
    const parsed = await this.request('POST', path, body, signal);

    return parseValuesMap(extractData(parsed));
  }

  /**
   * Sends one HTTP request, applies the bearer token and the per-request
   * timeout, and decodes the response envelope.
   */
  private async request(
    method: string,
    path: string,
    body: string | undefined,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('request timed out')), this.timeout);
    const onAbort = (): void => controller.abort(signal?.reason);

    if (signal !== undefined) {
      if (signal.aborted) {
        controller.abort(signal.reason);
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
      };
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }

      let response: Response;
      try {
        const init: RequestInit = {
          method,
          headers,
          signal: controller.signal,
        };
        if (body !== undefined) {
          init.body = body;
        }

        const fetchImpl = this.fetchImpl;
        response = await fetchImpl(`${this.baseURL}${path}`, init);
      } catch (error) {
        throw new YilyError(
          YilyErrorCode.RequestFailed,
          `yily: request failed: ${errorMessage(error)}`,
          { cause: error },
        );
      }

      let text: string;
      try {
        text = await response.text();
      } catch (error) {
        throw new YilyError(
          YilyErrorCode.RequestFailed,
          `yily: failed to read response body: ${errorMessage(error)}`,
          { cause: error },
        );
      }

      if (response.status < 200 || response.status >= 300) {
        throw toApiError(response, text);
      }

      try {
        return JSON.parse(text) as unknown;
      } catch (error) {
        throw new YilyError(
          YilyErrorCode.DecodeFailed,
          `yily: failed to decode response: ${errorMessage(error)}`,
          { cause: error },
        );
      }
    } finally {
      clearTimeout(timer);
      if (signal !== undefined) {
        signal.removeEventListener('abort', onAbort);
      }
    }
  }
}

/**
 * Returns the `data` member of the standard Yily response envelope.
 */
function extractData(parsed: unknown): unknown {
  if (!isRecord(parsed)) {
    throw new YilyError(
      YilyErrorCode.DecodeFailed,
      'yily: failed to decode response: expected a JSON object',
    );
  }
  return parsed.data;
}

/** Parses the variable list returned by `GET /environments/:id/variables`. */
function parseVariableList(data: unknown): string[] {
  if (data === undefined || data === null) {
    return [];
  }
  if (!Array.isArray(data)) {
    throw new YilyError(
      YilyErrorCode.DecodeFailed,
      'yily: failed to decode response: variable list must be an array',
    );
  }

  const names: string[] = [];
  for (const item of data) {
    if (item === null || item === undefined) {
      continue;
    }
    if (!isRecord(item)) {
      throw new YilyError(
        YilyErrorCode.DecodeFailed,
        'yily: failed to decode response: variable list item must be an object',
      );
    }

    const name = item.name;
    if (name === undefined || name === null) {
      continue;
    }
    if (typeof name !== 'string') {
      throw new YilyError(
        YilyErrorCode.DecodeFailed,
        'yily: failed to decode response: variable name must be a string',
      );
    }
    names.push(name);
  }
  return names;
}

/** Parses the batch values returned by the values endpoint. */
function parseValuesMap(data: unknown): Record<string, string> {
  if (data === undefined || data === null) {
    return {};
  }
  if (!isRecord(data)) {
    throw new YilyError(
      YilyErrorCode.DecodeFailed,
      'yily: failed to decode response: variable values must be an object',
    );
  }

  const values: Record<string, string> = {};
  for (const [name, value] of Object.entries(data)) {
    if (typeof value !== 'string') {
      throw new YilyError(
        YilyErrorCode.DecodeFailed,
        'yily: failed to decode response: variable values must be strings',
      );
    }
    // defineProperty keeps a server-supplied "__proto__" key from mutating
    // the prototype of the returned map.
    Object.defineProperty(values, name, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return values;
}

/** Converts a non-2xx response into an {@link APIError}. */
function toApiError(response: Response, text: string): APIError {
  const status = response.status;
  const envelope = parseErrorEnvelope(text);

  if (envelope !== undefined && (envelope.code !== '' || envelope.message !== '')) {
    const options: APIErrorOptions = {};
    if (envelope.code !== '') {
      options.apiCode = envelope.code;
    }
    if (status === 401) {
      options.code = YilyErrorCode.Unauthorized;
    } else if (status === 404) {
      options.code = YilyErrorCode.NotFound;
    }

    const message =
      envelope.code === ''
        ? `yily: api error (status ${status}): ${envelope.message}`
        : `yily: api error (status ${status}, code ${envelope.code}): ${envelope.message}`;
    return new APIError(status, message, options);
  }

  if (status === 401) {
    return new APIError(401, 'yily: unauthorized', { code: YilyErrorCode.Unauthorized });
  }
  if (status === 404) {
    return new APIError(404, 'yily: not found', { code: YilyErrorCode.NotFound });
  }

  return new APIError(status, `yily: api error (status ${status}): ${response.statusText}`);
}

/**
 * Reads the optional `{code, message}` part of an error response.
 *
 * Returns undefined when the body is not a JSON object or when those members
 * are not strings, so the caller falls back to a status-only error.
 */
function parseErrorEnvelope(text: string): { code: string; message: string } | undefined {
  if (text === '') {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }

  if (!isRecord(parsed)) {
    return undefined;
  }

  const code = parsed.code;
  const message = parsed.message;
  if (code !== undefined && code !== null && typeof code !== 'string') {
    return undefined;
  }
  if (message !== undefined && message !== null && typeof message !== 'string') {
    return undefined;
  }

  return {
    code: typeof code === 'string' ? code : '',
    message: typeof message === 'string' ? message : '',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

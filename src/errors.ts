/**
 * Stable, machine-readable error codes carried by {@link YilyError}.
 *
 * See the README for the full list of codes and their meanings.
 */
export const YilyErrorCode = {
  MissingBaseURL: 'MISSING_BASE_URL',
  InvalidBaseURL: 'INVALID_BASE_URL',
  MissingToken: 'MISSING_TOKEN',
  InvalidToken: 'INVALID_TOKEN',
  MissingEnvironmentID: 'MISSING_ENVIRONMENT_ID',
  InvalidTimeout: 'INVALID_TIMEOUT',
  InvalidFetch: 'INVALID_FETCH',

  InvalidField: 'INVALID_FIELD',
  InvalidVariableName: 'INVALID_VARIABLE_NAME',
  InvalidVersion: 'INVALID_VERSION',
  ConflictingVariableVersion: 'CONFLICTING_VARIABLE_VERSION',
  UnsupportedType: 'UNSUPPORTED_TYPE',
  InvalidValue: 'INVALID_VALUE',
  VariableNotFound: 'VARIABLE_NOT_FOUND',

  RequestFailed: 'REQUEST_FAILED',
  EncodeFailed: 'ENCODE_FAILED',
  DecodeFailed: 'DECODE_FAILED',
  ApiError: 'API_ERROR',
  Unauthorized: 'UNAUTHORIZED',
  NotFound: 'NOT_FOUND',
} as const;

/** Union of every error code produced by the SDK. */
export type YilyErrorCode = (typeof YilyErrorCode)[keyof typeof YilyErrorCode];

/** Base class for every error raised by the SDK. */
export class YilyError extends Error {
  /** Stable code identifying the failure. */
  readonly code: YilyErrorCode;

  constructor(code: YilyErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'YilyError';
    this.code = code;
  }
}

/** Options accepted by {@link APIError}. */
export interface APIErrorOptions extends ErrorOptions {
  /** SDK error code; defaults to {@link YilyErrorCode.ApiError}. */
  code?: YilyErrorCode;
  /** Machine-readable code returned by the Yily API, when present. */
  apiCode?: string;
}

/**
 * Error returned when the Yily API answers with a non-2xx status.
 *
 * HTTP 401 and 404 responses use {@link YilyErrorCode.Unauthorized} and
 * {@link YilyErrorCode.NotFound} respectively, while still exposing the
 * server status and API code here.
 */
export class APIError extends YilyError {
  /** HTTP status code of the response. */
  readonly statusCode: number;

  /** Machine-readable code returned by the Yily API, when present. */
  readonly apiCode?: string;

  constructor(statusCode: number, message: string, options: APIErrorOptions = {}) {
    super(options.code ?? YilyErrorCode.ApiError, message, options);
    this.name = 'APIError';
    this.statusCode = statusCode;
    if (options.apiCode !== undefined) {
      this.apiCode = options.apiCode;
    }
  }
}

/** Returns true when `value` is a {@link YilyError}. */
export function isYilyError(value: unknown): value is YilyError {
  return value instanceof YilyError;
}

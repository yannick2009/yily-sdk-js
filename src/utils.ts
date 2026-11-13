import { DEFAULT_API_PREFIX } from './constants.js';

/**
 * Normalizes the base URL: trim surrounding whitespace and trailing slashes,
 * drop one trailing `/api/v1` suffix, then append exactly one.
 */
export function normalizeBaseURL(raw: string): string {
  let value = raw.trim().replace(/\/+$/, '');
  if (value.endsWith(DEFAULT_API_PREFIX)) {
    value = value.slice(0, -DEFAULT_API_PREFIX.length);
  }
  return value + DEFAULT_API_PREFIX;
}

/**
 * Normalizes a variable name to Yily's convention: upper case, with each run
 * of whitespace replaced by a single underscore.
 */
export function normalizeVariableName(name: string): string {
  return name.trim().toUpperCase().split(/\s+/).join('_');
}

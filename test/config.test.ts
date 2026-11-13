import { describe, expect, it } from 'vitest';

import { Client, YilyError, YilyErrorCode } from '../src/index.js';

const validConfig = {
  baseURL: 'https://yily.example.com',
  environmentID: 'ENV_TEST',
  token: 'yily_test_token',
};

function expectErrorCode(run: () => unknown, code: YilyErrorCode): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(YilyError);
    expect((error as YilyError).code).toBe(code);
    return;
  }
  throw new Error('expected the call to throw');
}

describe('Client configuration', () => {
  it('accepts a valid configuration', () => {
    expect(() => new Client(validConfig)).not.toThrow();
  });

  it('trims the base URL, token and environment ID', () => {
    expect(
      () =>
        new Client({
          baseURL: '  https://yily.example.com/  ',
          environmentID: '  ENV_TEST  ',
          token: '  yily_test_token  ',
        }),
    ).not.toThrow();
  });

  it('rejects a missing or blank base URL', () => {
    expectErrorCode(() => new Client({ ...validConfig, baseURL: '' }), YilyErrorCode.MissingBaseURL);
    expectErrorCode(
      () => new Client({ ...validConfig, baseURL: '   ' }),
      YilyErrorCode.MissingBaseURL,
    );
    expectErrorCode(
      () => new Client(undefined as unknown as typeof validConfig),
      YilyErrorCode.MissingBaseURL,
    );
  });

  it.each([
    'ftp://yily.example.com',
    'yily.example.com',
    '/relative',
    'https://user:pass@yily.example.com',
    'https://yily.example.com/?token=1',
    'https://yily.example.com/?',
    'https://yily.example.com/#fragment',
    'http:yily.example.com',
  ])('rejects invalid base URL %s', (baseURL) => {
    expectErrorCode(
      () => new Client({ ...validConfig, baseURL }),
      YilyErrorCode.InvalidBaseURL,
    );
  });

  it('accepts http and https base URLs with a path', () => {
    expect(() => new Client({ ...validConfig, baseURL: 'http://localhost:16529' })).not.toThrow();
    expect(
      () => new Client({ ...validConfig, baseURL: 'https://example.com/yily' }),
    ).not.toThrow();
  });

  it('rejects a missing or blank token', () => {
    expectErrorCode(() => new Client({ ...validConfig, token: '' }), YilyErrorCode.MissingToken);
    expectErrorCode(
      () => new Client({ ...validConfig, token: '   ' }),
      YilyErrorCode.MissingToken,
    );
  });

  it.each(['token', 'yily_', 'YILY_token', ' yily_ '])('rejects invalid token %s', (token) => {
    expectErrorCode(() => new Client({ ...validConfig, token }), YilyErrorCode.InvalidToken);
  });

  it('rejects a missing or blank environment ID', () => {
    expectErrorCode(
      () => new Client({ ...validConfig, environmentID: '' }),
      YilyErrorCode.MissingEnvironmentID,
    );
    expectErrorCode(
      () => new Client({ ...validConfig, environmentID: '   ' }),
      YilyErrorCode.MissingEnvironmentID,
    );
  });

  it('defaults a zero or negative timeout instead of failing', () => {
    expect(() => new Client({ ...validConfig, timeout: 0 })).not.toThrow();
    expect(() => new Client({ ...validConfig, timeout: -100 })).not.toThrow();
  });

  it('rejects a non-finite timeout', () => {
    expectErrorCode(
      () => new Client({ ...validConfig, timeout: Number.NaN }),
      YilyErrorCode.InvalidTimeout,
    );
    expectErrorCode(
      () => new Client({ ...validConfig, timeout: Number.POSITIVE_INFINITY }),
      YilyErrorCode.InvalidTimeout,
    );
  });

  it('rejects a non-function fetch', () => {
    expectErrorCode(
      () => new Client({ ...validConfig, fetch: 'fetch' as unknown as typeof fetch }),
      YilyErrorCode.InvalidFetch,
    );
  });
});

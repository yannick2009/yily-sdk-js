import { describe, expect, it } from 'vitest';

import { YilyError, YilyErrorCode, type Schema } from '../src/index.js';
import { createClient, envelope, jsonResponse, requestBody } from './helpers.js';

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
}

describe('Client.load', () => {
  it('converts every supported type', async () => {
    const { client, requests } = createClient([
      jsonResponse(
        envelope({
          DB_HOST: 'localhost',
          DB_PORT: '5432',
          BIG_ID: '9007199254740993',
          RATIO: '3.14',
          DEBUG: 'true',
          TIMEOUT: '1h30m',
        }),
      ),
    ]);

    const loaded = await client.load({
      dbHost: { name: 'DB_HOST' },
      dbPort: { name: 'DB_PORT', type: 'int' },
      bigId: { name: 'BIG_ID', type: 'int64' },
      ratio: { name: 'RATIO', type: 'float64' },
      debug: { name: 'DEBUG', type: 'bool' },
      timeout: { name: 'TIMEOUT', type: 'duration' },
    });

    expect(loaded).toEqual({
      dbHost: 'localhost',
      dbPort: 5432,
      bigId: 9_007_199_254_740_993n,
      ratio: 3.14,
      debug: true,
      timeout: 5_400_000,
    });
    expect(requestBody(requests[0]!)).toEqual({
      variables: [
        { name: 'DB_HOST' },
        { name: 'DB_PORT' },
        { name: 'BIG_ID' },
        { name: 'RATIO' },
        { name: 'DEBUG' },
        { name: 'TIMEOUT' },
      ],
    });
  });

  it('infers the loaded object type from the schema', async () => {
    const { client } = createClient([
      jsonResponse(envelope({ DB_HOST: 'localhost', DB_PORT: '5432' })),
    ]);

    const loaded = await client.load({
      host: { name: 'DB_HOST' },
      port: { name: 'DB_PORT', type: 'int' },
    });

    const host: string = loaded.host;
    const port: number = loaded.port;
    expect(host).toBe('localhost');
    expect(port).toBe(5432);
  });

  it('supports the shorthand, including versions', async () => {
    const { client, requests } = createClient([
      jsonResponse(envelope({ LEGACY_KEY: 'old', ACTIVE_KEY: 'new' })),
    ]);

    const loaded = await client.load({
      legacy: 'legacy key,version=2',
      active: 'ACTIVE_KEY',
    });

    expect(loaded).toEqual({ legacy: 'old', active: 'new' });
    expect(requestBody(requests[0]!)).toEqual({
      variables: [{ name: 'LEGACY_KEY', version: 2 }, { name: 'ACTIVE_KEY' }],
    });
  });

  it('ignores fields whose spec is "-"', async () => {
    const { client, requests } = createClient([]);

    await expect(client.load({ ignored: '-' })).resolves.toEqual({});
    expect(requests).toHaveLength(0);
  });

  it('returns an empty object for an empty schema without a request', async () => {
    const { client, requests } = createClient([]);

    await expect(client.load({})).resolves.toEqual({});
    expect(requests).toHaveLength(0);
  });

  it('deduplicates selections of the same variable and version', async () => {
    const { client, requests } = createClient([jsonResponse(envelope({ SHARED: 'value' }))]);

    const loaded = await client.load({
      first: 'SHARED',
      second: { name: 'shared' },
    });

    expect(loaded).toEqual({ first: 'value', second: 'value' });
    expect(requestBody(requests[0]!)).toEqual({ variables: [{ name: 'SHARED' }] });
  });

  it('rejects two different versions of the same variable before fetching', async () => {
    const { client, requests } = createClient([]);
    const error = await captureError(
      client.load({
        first: 'SHARED,version=1',
        second: 'SHARED,version=2',
      }),
    );

    expect(error).toBeInstanceOf(YilyError);
    expect((error as YilyError).code).toBe(YilyErrorCode.ConflictingVariableVersion);
    expect(requests).toHaveLength(0);
  });

  it('rejects a variable missing from the response', async () => {
    const { client } = createClient([jsonResponse(envelope({}))]);
    const error = await captureError(client.load({ host: 'DB_HOST' }));

    expect(error).toBeInstanceOf(YilyError);
    expect((error as YilyError).code).toBe(YilyErrorCode.VariableNotFound);
    expect((error as Error).message).toContain('DB_HOST');
  });

  it.each([
    ['1', true],
    ['t', true],
    ['T', true],
    ['TRUE', true],
    ['true', true],
    ['True', true],
    ['0', false],
    ['f', false],
    ['F', false],
    ['FALSE', false],
    ['false', false],
    ['False', false],
  ])('parses the bool value %s', async (raw, expected) => {
    const { client } = createClient([jsonResponse(envelope({ FLAG: raw }))]);
    await expect(client.load({ flag: { name: 'FLAG', type: 'bool' } })).resolves.toEqual({
      flag: expected,
    });
  });

  it('parses float64 special values', async () => {
    const { client } = createClient([
      jsonResponse(envelope({ NAN: 'NaN', INF: 'Inf', NEG_INF: '-Infinity', ONE: '1e3' })),
    ]);

    const loaded = await client.load({
      nan: { name: 'NAN', type: 'float64' },
      inf: { name: 'INF', type: 'float64' },
      negInf: { name: 'NEG_INF', type: 'float64' },
      one: { name: 'ONE', type: 'float64' },
    });

    expect(Number.isNaN(loaded.nan)).toBe(true);
    expect(loaded.inf).toBe(Number.POSITIVE_INFINITY);
    expect(loaded.negInf).toBe(Number.NEGATIVE_INFINITY);
    expect(loaded.one).toBe(1000);
  });

  it('preserves int64 precision', async () => {
    const { client } = createClient([
      jsonResponse(
        envelope({
          MAX: '9223372036854775807',
          MIN: '-9223372036854775808',
          PLUS: '+42',
        }),
      ),
    ]);

    const loaded = await client.load({
      max: { name: 'MAX', type: 'int64' },
      min: { name: 'MIN', type: 'int64' },
      plus: { name: 'PLUS', type: 'int64' },
    });

    expect(loaded.max).toBe(9_223_372_036_854_775_807n);
    expect(loaded.min).toBe(-9_223_372_036_854_775_808n);
    expect(loaded.plus).toBe(42n);
  });

  it.each([
    ['int', 'abc'],
    ['int', '1.5'],
    ['int', '9007199254740992'],
    ['int64', 'abc'],
    ['int64', '1.5'],
    ['int64', '9223372036854775808'],
    ['float64', 'abc'],
    ['float64', ''],
    ['float64', '1e999'],
    ['bool', 'yes'],
    ['bool', ''],
    ['duration', 'abc'],
    ['duration', '5'],
  ] as const)('rejects invalid %s value %j', async (type, raw) => {
    const { client } = createClient([jsonResponse(envelope({ VALUE: raw }))]);
    const error = await captureError(client.load({ value: { name: 'VALUE', type } }));

    expect(error).toBeInstanceOf(YilyError);
    expect((error as YilyError).code).toBe(YilyErrorCode.InvalidValue);
  });

  it.each([
    [{ field: '' }, YilyErrorCode.InvalidField],
    [{ field: '   ' }, YilyErrorCode.InvalidField],
    [{ field: 'A,version=0' }, YilyErrorCode.InvalidField],
    [{ field: 'A,version=abc' }, YilyErrorCode.InvalidField],
    [{ field: 'A,version' }, YilyErrorCode.InvalidField],
    [{ field: 'A,version=1,version=2' }, YilyErrorCode.InvalidField],
    [{ field: 'A,version=1,extra=2' }, YilyErrorCode.InvalidField],
    [{ field: { name: '  ' } }, YilyErrorCode.InvalidField],
    [{ field: { name: 'A', version: -1 } }, YilyErrorCode.InvalidField],
    [{ field: { name: 'A', version: 1.5 } }, YilyErrorCode.InvalidField],
    [{ field: { name: 'A', extra: true } }, YilyErrorCode.InvalidField],
    [{ field: 42 }, YilyErrorCode.InvalidField],
    [{ field: { name: 'A', type: 'date' } }, YilyErrorCode.UnsupportedType],
    [null, YilyErrorCode.InvalidField],
    [[], YilyErrorCode.InvalidField],
  ])('rejects invalid schema %j', async (schema, code) => {
    const { client, requests } = createClient([]);
    const error = await captureError(client.load(schema as unknown as Schema));

    expect(error).toBeInstanceOf(YilyError);
    expect((error as YilyError).code).toBe(code);
    expect(requests).toHaveLength(0);
  });
});

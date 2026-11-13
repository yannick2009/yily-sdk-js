import { describe, expect, it, vi } from 'vitest';

import { APIError, Client, YilyError, YilyErrorCode } from '../src/index.js';
import { createClient, envelope, jsonResponse, requestBody } from './helpers.js';

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
}

describe('Client.get', () => {
  it('fetches one variable through the batch endpoint', async () => {
    const { client, requests } = createClient([jsonResponse(envelope({ API_KEY: 'secret' }))]);

    await expect(client.get('API_KEY')).resolves.toBe('secret');

    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.url).toBe(
      'https://yily.example.com/api/v1/environments/ENV_TEST/variables/values',
    );
    expect(request.init.method).toBe('POST');

    const headers = new Headers(request.init.headers);
    expect(headers.get('Authorization')).toBe('Bearer yily_test_token');
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(requestBody(request)).toEqual({ variables: [{ name: 'API_KEY' }] });
  });

  it('normalizes the variable name', async () => {
    const { client, requests } = createClient([jsonResponse(envelope({ DB_HOST: 'localhost' }))]);

    await expect(client.get('  db   host ')).resolves.toBe('localhost');
    expect(requestBody(requests[0]!)).toEqual({ variables: [{ name: 'DB_HOST' }] });
  });

  it('rejects an empty variable name without sending a request', async () => {
    const { client, requests } = createClient([]);
    const error = await captureError(client.get('   '));

    expect(error).toBeInstanceOf(YilyError);
    expect((error as YilyError).code).toBe(YilyErrorCode.InvalidVariableName);
    expect(requests).toHaveLength(0);
  });

  it('rejects when the server omits the requested variable', async () => {
    const { client } = createClient([jsonResponse(envelope({}))]);
    const error = await captureError(client.get('MISSING'));

    expect(error).toBeInstanceOf(YilyError);
    expect((error as YilyError).code).toBe(YilyErrorCode.VariableNotFound);
  });

  it('encodes the environment ID in the request path', async () => {
    const { client, requests } = createClient(
      [jsonResponse(envelope({ A: '1' }))],
      { environmentID: 'ENV/1' },
    );

    await client.get('A');
    expect(requests[0]!.url).toContain('/environments/ENV%2F1/variables/values');
  });

  it.each([
    'https://yily.example.com',
    'https://yily.example.com/',
    'https://yily.example.com/api/v1',
    'https://yily.example.com/api/v1/',
  ])('normalizes base URL %s', async (baseURL) => {
    const { client, requests } = createClient([jsonResponse(envelope({ A: '1' }))], { baseURL });

    await client.get('A');
    expect(requests[0]!.url).toBe(
      'https://yily.example.com/api/v1/environments/ENV_TEST/variables/values',
    );
  });
});

describe('Client.getVersion', () => {
  it('requests the selected version', async () => {
    const { client, requests } = createClient([jsonResponse(envelope({ API_KEY: 'old' }))]);

    await expect(client.getVersion('API_KEY', 2)).resolves.toBe('old');
    expect(requestBody(requests[0]!)).toEqual({
      variables: [{ name: 'API_KEY', version: 2 }],
    });
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects invalid version %s', async (version) => {
    const { client, requests } = createClient([]);
    const error = await captureError(client.getVersion('API_KEY', version));

    expect(error).toBeInstanceOf(YilyError);
    expect((error as YilyError).code).toBe(YilyErrorCode.InvalidVersion);
    expect(requests).toHaveLength(0);
  });
});

describe('Client.getAll', () => {
  it('lists variables then fetches their values', async () => {
    const { client, requests } = createClient([
      jsonResponse(envelope([{ name: 'A' }, { name: 'B' }, { name: 'A' }])),
      jsonResponse(envelope({ A: '1', B: '2' })),
    ]);

    await expect(client.getAll()).resolves.toEqual({ A: '1', B: '2' });

    expect(requests).toHaveLength(2);
    expect(requests[0]!.url).toBe(
      'https://yily.example.com/api/v1/environments/ENV_TEST/variables',
    );
    expect(requests[0]!.init.method).toBe('GET');
    expect(requestBody(requests[1]!)).toEqual({
      variables: [{ name: 'A' }, { name: 'B' }],
    });
  });

  it('returns an empty map for an empty environment without a second request', async () => {
    const { client, requests } = createClient([jsonResponse(envelope([]))]);

    await expect(client.getAll()).resolves.toEqual({});
    expect(requests).toHaveLength(1);
  });

  it('treats missing list data as an empty environment', async () => {
    const { client, requests } = createClient([jsonResponse({ status: 200, message: 'ok' })]);

    await expect(client.getAll()).resolves.toEqual({});
    expect(requests).toHaveLength(1);
  });
});

describe('Client error mapping', () => {
  it('maps 401 envelope responses to Unauthorized APIError', async () => {
    const { client } = createClient([
      jsonResponse({ status: 401, code: 'INVALID_TOKEN', message: 'bad token' }, 401),
    ]);
    const error = await captureError(client.get('A'));

    expect(error).toBeInstanceOf(APIError);
    const apiError = error as APIError;
    expect(apiError.code).toBe(YilyErrorCode.Unauthorized);
    expect(apiError.statusCode).toBe(401);
    expect(apiError.apiCode).toBe('INVALID_TOKEN');
    expect(apiError.message).toBe(
      'yily: api error (status 401, code INVALID_TOKEN): bad token',
    );
  });

  it('maps 404 envelope responses to NotFound APIError', async () => {
    const { client } = createClient([
      jsonResponse({ status: 404, code: 'ENV_NOT_FOUND', message: 'no such env' }, 404),
    ]);
    const error = await captureError(client.getAll());

    expect(error).toBeInstanceOf(APIError);
    const apiError = error as APIError;
    expect(apiError.code).toBe(YilyErrorCode.NotFound);
    expect(apiError.statusCode).toBe(404);
    expect(apiError.apiCode).toBe('ENV_NOT_FOUND');
  });

  it('maps other statuses to a generic APIError', async () => {
    const { client } = createClient([
      jsonResponse({ status: 500, code: 'INTERNAL', message: 'boom' }, 500),
    ]);
    const error = await captureError(client.get('A'));

    expect(error).toBeInstanceOf(APIError);
    const apiError = error as APIError;
    expect(apiError.code).toBe(YilyErrorCode.ApiError);
    expect(apiError.statusCode).toBe(500);
    expect(apiError.apiCode).toBe('INTERNAL');
  });

  it('maps a bodyless 401 to Unauthorized', async () => {
    const { client } = createClient([new Response('nope', { status: 401 })]);
    const error = await captureError(client.get('A'));

    expect(error).toBeInstanceOf(APIError);
    expect((error as APIError).code).toBe(YilyErrorCode.Unauthorized);
    expect((error as APIError).message).toBe('yily: unauthorized');
  });

  it('falls back to the HTTP status when the error body is not JSON', async () => {
    const { client } = createClient([
      new Response('oops', { status: 500, statusText: 'Internal Server Error' }),
    ]);
    const error = await captureError(client.get('A'));

    expect(error).toBeInstanceOf(APIError);
    expect((error as APIError).message).toBe(
      'yily: api error (status 500): Internal Server Error',
    );
  });
});

describe('Client response decoding', () => {
  it('rejects a success response that is not JSON', async () => {
    const { client } = createClient([new Response('not json', { status: 200 })]);
    const error = await captureError(client.get('A'));

    expect(error).toBeInstanceOf(YilyError);
    expect((error as YilyError).code).toBe(YilyErrorCode.DecodeFailed);
  });

  it('rejects a success response that is not an envelope object', async () => {
    const { client } = createClient([jsonResponse([])]);
    const error = await captureError(client.get('A'));

    expect(error).toBeInstanceOf(YilyError);
    expect((error as YilyError).code).toBe(YilyErrorCode.DecodeFailed);
  });

  it('rejects a values payload that is not an object', async () => {
    const { client } = createClient([jsonResponse(envelope([]))]);
    const error = await captureError(client.get('A'));

    expect(error).toBeInstanceOf(YilyError);
    expect((error as YilyError).code).toBe(YilyErrorCode.DecodeFailed);
  });

  it('rejects non-string variable values', async () => {
    const { client } = createClient([jsonResponse(envelope({ A: 1 }))]);
    const error = await captureError(client.get('A'));

    expect(error).toBeInstanceOf(YilyError);
    expect((error as YilyError).code).toBe(YilyErrorCode.DecodeFailed);
  });

  it('does not let a "__proto__" key pollute object prototypes', async () => {
    const values = JSON.parse('{"__proto__":"polluted","SAFE":"ok"}') as Record<string, string>;
    const { client } = createClient([
      jsonResponse(envelope([{ name: 'SAFE' }])),
      jsonResponse(envelope(values)),
    ]);

    const all = await client.getAll();

    expect(all.SAFE).toBe('ok');
    expect(Object.hasOwn(all, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(all)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('Client timeout and cancellation', () => {
  it('applies the configured timeout', async () => {
    const hangingFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted === true) {
          reject(signal.reason);
          return;
        }
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });

    const client = new Client({
      baseURL: 'https://yily.example.com',
      environmentID: 'ENV_TEST',
      token: 'yily_test_token',
      timeout: 10,
      fetch: hangingFetch as unknown as typeof fetch,
    });

    const error = await captureError(client.get('A'));
    expect(error).toBeInstanceOf(YilyError);
    expect((error as YilyError).code).toBe(YilyErrorCode.RequestFailed);
    expect((error as Error).message).toContain('request timed out');
  });

  it('propagates an AbortSignal', async () => {
    const hangingFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
          once: true,
        });
      });
    });

    const client = new Client({
      baseURL: 'https://yily.example.com',
      environmentID: 'ENV_TEST',
      token: 'yily_test_token',
      fetch: hangingFetch as unknown as typeof fetch,
    });

    const controller = new AbortController();
    const promise = client.get('A', { signal: controller.signal });
    controller.abort(new Error('stopped by caller'));

    const error = await captureError(promise);
    expect(error).toBeInstanceOf(YilyError);
    expect((error as YilyError).code).toBe(YilyErrorCode.RequestFailed);
    expect((error as Error).message).toContain('stopped by caller');
  });
});

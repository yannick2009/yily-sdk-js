import { vi } from 'vitest';

import { Client, type Config } from '../src/index.js';

export interface RecordedRequest {
  url: string;
  init: RequestInit;
}

export type FetchResponder =
  | Response
  | ((request: RecordedRequest) => Response | Promise<Response>);

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Builds the standard Yily success envelope. */
export function envelope(data: unknown): Record<string, unknown> {
  return { status: 200, message: 'ok', data };
}

/**
 * Creates a client backed by a scripted fetch mock and records every request.
 */
export function createClient(
  responses: readonly FetchResponder[],
  overrides: Partial<Config> = {},
): { client: Client; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  let callCount = 0;

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request: RecordedRequest = { url: String(input), init: init ?? {} };
    requests.push(request);

    const responder = responses[callCount];
    callCount += 1;
    if (responder === undefined) {
      throw new Error(`unexpected fetch call #${callCount}`);
    }

    return typeof responder === 'function' ? responder(request) : responder;
  });

  const client = new Client({
    baseURL: 'https://yily.example.com',
    environmentID: 'ENV_TEST',
    token: 'yily_test_token',
    ...overrides,
    fetch: fetchMock as unknown as typeof fetch,
  });

  return { client, requests };
}

/** Parses the JSON request body of a recorded request. */
export function requestBody(request: RecordedRequest): unknown {
  return JSON.parse(String(request.init.body));
}

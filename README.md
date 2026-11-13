# Yily TypeScript/JavaScript SDK

Official lightweight TypeScript and JavaScript SDK for retrieving configuration variables and secrets from [Yily](https://github.com/yannick2009/yily).

It is written in TypeScript and ships both ESM and CommonJS builds with bundled type declarations.

## Requirements

- **Node.js**: 18 or later (a global `fetch` implementation is required), or any browser/runtime that provides `fetch`. You can also pass a custom implementation through `Config.fetch`.
- **Yily Server**: Requires a Yily instance that supports the batch variable values endpoint (`POST /api/v1/environments/:environmentID/variables/values`), including the optional per-variable `version` field.

## Installation

```bash
npm install yily-sdk-js
```

The package also works with `pnpm`, `yarn`, Bun, Deno (with `npm:` specifiers) and modern browsers.

## Quickstart

### TypeScript

```ts
import { Client } from 'yily-sdk-js';

const client = new Client({
  baseURL: 'http://localhost:16529',
  environmentID: 'ENVxxxxxxxxxxxx',
  token: process.env.YILY_TOKEN!,
});

// 1. Load a typed object from a schema.
const cfg = await client.load({
  dbHost: { name: 'DB_HOST' },
  dbPort: { name: 'DB_PORT', type: 'int' },
  debug: { name: 'DEBUG', type: 'bool' },
  timeout: { name: 'TIMEOUT', type: 'duration' },
});
// cfg is typed as { dbHost: string; dbPort: number; debug: boolean; timeout: number }

// 2. Retrieve all active variables as a map.
const allVars = await client.getAll(); // Record<string, string>

// 3. Retrieve an individual variable by name.
const apiKey = await client.get('API_KEY');

// 4. Retrieve a specific version of an individual variable.
const legacyKey = await client.getVersion('API_KEY', 1);
```

### JavaScript (ESM)

```js
import { Client } from 'yily-sdk-js';

const client = new Client({
  baseURL: 'http://localhost:16529',
  environmentID: 'ENVxxxxxxxxxxxx',
  token: process.env.YILY_TOKEN,
});

const cfg = await client.load({
  dbHost: { name: 'DB_HOST' },
  dbPort: { name: 'DB_PORT', type: 'int' },
  debug: { name: 'DEBUG', type: 'bool' },
  timeout: { name: 'TIMEOUT', type: 'duration' },
});

const apiKey = await client.get('API_KEY');
const legacyKey = await client.getVersion('API_KEY', 1);
const allVars = await client.getAll();
```

### JavaScript (CommonJS)

```js
const { Client } = require('yily-sdk-js');

const client = new Client({
  baseURL: 'http://localhost:16529',
  environmentID: 'ENVxxxxxxxxxxxx',
  token: process.env.YILY_TOKEN,
});
```

`environmentID` is the environment's `ENV…` identifier, shown in the Yily web interface and CLI. The SDK treats it as an opaque string and URL-encodes it in request paths.

Use a read-scoped PAT for applications that only need to load configuration. PATs are created and managed through Yily's web interface. `load` makes one batch request for the requested values (active by default, or the versions selected in the schema). `get` and `getVersion` make one batch request with a single variable. `getAll` makes one request to list the environment's variables and a second batch request to fetch their active values.

Use HTTPS for deployed applications. The HTTP URL in the examples is intended for local development only.

## Configuration

`new Client(config)` accepts:

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `baseURL` | `string` | yes | Root URL of the Yily instance. Must be an absolute HTTP or HTTPS URL without credentials, query string or fragment. A trailing `/api/v1` is accepted and normalized. |
| `environmentID` | `string` | yes | Environment identifier (`ENV…`) to read from. |
| `token` | `string` | yes | Read-scoped PAT prefixed with `yily_`. |
| `timeout` | `number` | no | Per-request timeout in **milliseconds**. Defaults to `5000`. Zero or negative values also select the default. |
| `fetch` | `typeof fetch` | no | Custom fetch implementation. Defaults to `globalThis.fetch`. |

Constructor validation happens eagerly and throws a `YilyError` with a configuration error code.

## Loading typed configuration

The loader uses a **schema**: an object that maps each target property to a field specification.

### Field specifications

A field can be:

- a shorthand string: `"DB_HOST"` or `"API_KEY,version=2"` (string type);
- an object: `{ name: "DB_PORT", type: "int", version: 2 }`.

The string shorthand supports an optional `version=N` suffix. Use the object form when the variable name itself contains a comma. A spec equal to `"-"` skips the field.

### Supported types

| `type` | Result | Notes |
| --- | --- | --- |
| `"string"` (default) | `string` | Raw value. |
| `"int"` | `number` | Must be a safe integer (`Number.isSafeInteger`). |
| `"int64"` | `bigint` | Exact 64-bit signed integer. |
| `"float64"` | `number` | Decimal/exponent syntax plus `NaN`, `Inf`, `Infinity` and their signed forms. |
| `"bool"` | `boolean` | Accepts `1`/`0`, `t`/`f`, and the `TRUE`/`FALSE`, `true`/`false`, `True`/`False` variants. |
| `"duration"` | `number` | Duration syntax such as `5s`, `250ms`, `1h30m` or `0`, returned in **milliseconds**. |

Values are retrieved in one batch request and converted before the result is returned. If retrieval or conversion fails for any field, no value is returned.

### `load(schema)` — returns a new object

```ts
const cfg = await client.load({
  host: { name: 'DB_HOST' },
  port: { name: 'DB_PORT', type: 'int' },
  apiKey: { name: 'API_KEY', version: 2 },
});
```

The result type is inferred from the schema.

### Filling an existing object

`load` always returns a new object. To update an existing object while keeping its identity, assign the result. If loading fails, the target stays untouched because the assignment is never reached.

```ts
const cfg = { host: '', port: 0 };
Object.assign(
  cfg,
  await client.load({
    host: 'DB_HOST',
    port: { name: 'DB_PORT', type: 'int' },
  }),
);
```

`Object.assign` can write some properties before failing on a read-only one. If you need strict all-or-nothing updates on such targets, validate the destinations before assigning.

### Versions

Omit `version` to load the active version. Versions must be positive integers. Two fields may select the same variable only with the same version; otherwise `CONFLICTING_VARIABLE_VERSION` is thrown before any request. For a single read, use `getVersion`.

### Refreshing values at runtime

Call `load` or `getAll` again to retrieve the latest active values. The SDK does not start background refreshes automatically. `getAll` issues two sequential requests (list, then batch values), so it is not an atomic snapshot if variables are modified or removed concurrently.

## API reference

### `new Client(config)`

Validates the configuration and creates a client. Clients are immutable after construction and safe to share across concurrent requests.

### `client.get(name, options?)`

Returns the active value of one variable as a string. The name is normalized to Yily's convention (upper case, whitespace runs replaced by underscores). Throws `INVALID_VARIABLE_NAME` when the normalized name is empty and `VARIABLE_NOT_FOUND` when the variable does not exist.

### `client.getVersion(name, version, options?)`

Returns the value at a specific version. `version` must be a positive integer (`INVALID_VERSION`).

### `client.getAll(options?)`

Returns every variable of the environment as `Record<string, string>`. An empty environment returns `{}` after the list request, without a second request.

### `client.load(schema, options?)`

Loads a new typed object; see above.

### Request options

Every method accepts `{ signal?: AbortSignal }`:

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 1000);

const value = await client.get('API_KEY', { signal: controller.signal });
```

The client timeout and the caller signal are combined: whichever fires first aborts the request, which then rejects with `REQUEST_FAILED`.

## Error handling

All SDK errors extend `YilyError` and carry a stable `code`:

```ts
import { APIError, YilyError, YilyErrorCode } from 'yily-sdk-js';

try {
  await client.get('API_KEY');
} catch (error) {
  if (error instanceof APIError) {
    console.error(error.statusCode, error.apiCode, error.message);
  } else if (error instanceof YilyError) {
    switch (error.code) {
      case YilyErrorCode.VariableNotFound:
        // ...
        break;
      case YilyErrorCode.Unauthorized:
        // invalid or expired token
        break;
      default:
        console.error(error.code, error.message);
    }
  }
}
```

`APIError` is used for every non-2xx response and exposes:

- `statusCode`: the HTTP status;
- `apiCode`: the server's machine-readable `code`, when present;
- `code`: `UNAUTHORIZED` for HTTP 401, `NOT_FOUND` for HTTP 404, otherwise `API_ERROR`.

### Error codes

| Code | Meaning |
| --- | --- |
| `MISSING_BASE_URL` | `baseURL` is missing or blank. |
| `INVALID_BASE_URL` | `baseURL` is not an absolute HTTP(S) URL without credentials, query string or fragment. |
| `MISSING_TOKEN` | `token` is missing or blank. |
| `INVALID_TOKEN` | `token` is not a Yily PAT (`yily_…`). |
| `MISSING_ENVIRONMENT_ID` | `environmentID` is missing or blank. |
| `INVALID_TIMEOUT` | `timeout` is not a finite number. |
| `INVALID_FETCH` | `fetch` is not a function, or no global `fetch` is available. |
| `INVALID_FIELD` | A schema field specification is malformed. |
| `INVALID_VARIABLE_NAME` | A variable name is empty after normalization. |
| `INVALID_VERSION` | A version is not a positive integer. |
| `CONFLICTING_VARIABLE_VERSION` | One variable is requested with two different versions in the same load. |
| `UNSUPPORTED_TYPE` | A field type is not supported. |
| `INVALID_VALUE` | A retrieved value cannot be converted to the field's type. |
| `VARIABLE_NOT_FOUND` | A requested variable does not exist. |
| `REQUEST_FAILED` | The network request failed, timed out or was aborted. |
| `ENCODE_FAILED` | The request body could not be serialized. |
| `DECODE_FAILED` | The server response was not valid JSON or had an unexpected shape. |
| `API_ERROR` | Generic non-2xx API error (401/404 use their dedicated codes). |
| `UNAUTHORIZED` | HTTP 401. |
| `NOT_FOUND` | HTTP 404. |

Note: `INVALID_VALUE` messages intentionally do not include the secret value.

## Building from source with Nix

The repository ships a Nix flake so that Node.js and npm come from Nix and nothing is installed globally on the machine. npm dependencies and the npm cache stay inside the project.

```bash
# Enter the development shell (Node.js 24, npm from Nix)
nix develop

# Install dependencies into ./node_modules (project-local)
npm install

# Type-check, test, and build ESM + CJS + declarations
npm run typecheck
npm test
npm run build
```

Without flakes, use `nix-shell` with the provided `shell.nix`.

Build outputs:

- `dist/index.js` — ESM;
- `dist/index.cjs` — CommonJS;
- `dist/index.d.ts` / `dist/index.d.cts` — TypeScript declarations;
- source maps.

### Examples

The examples import the package by name, so build first:

```bash
nix develop
npm install
npm run build

YILY_TOKEN=yily_xxx node examples/typescript.ts   # Node.js 24 runs erasable TypeScript directly
YILY_TOKEN=yily_xxx node examples/javascript.mjs
YILY_TOKEN=yily_xxx node examples/javascript.cjs
```

## Security notes

- Never log secret values. The examples only print lengths and counts.
- Prefer read-scoped PATs and HTTPS in deployed environments.
- `int64` values use `bigint` to avoid silent precision loss.
- `int` values outside the safe-integer range are rejected instead of being rounded.
- Error messages for invalid values never echo the value itself.
- Server-provided keys such as `__proto__` are copied as own data properties, avoiding prototype pollution.

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

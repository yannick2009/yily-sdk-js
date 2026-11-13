import { Client, YilyError } from 'yily-sdk-js';

async function main(): Promise<void> {
  const token = process.env.YILY_TOKEN;
  if (token === undefined || token === '') {
    console.error('Set YILY_TOKEN to a read-scoped PAT before running this example.');
    process.exitCode = 1;
    return;
  }

  // Create the client once and reuse it for every call.
  const client = new Client({
    baseURL: process.env.YILY_BASE_URL ?? 'http://localhost:16529',
    environmentID: process.env.YILY_ENVIRONMENT_ID ?? 'ENVxxxxxxxxxxxx',
    token,
  });

  // 1. Load a new typed object from a schema; the returned type is inferred
  // from the field specs.
  const cfg = await client.load({
    dbHost: { name: 'DB_HOST' },
    dbPort: { name: 'DB_PORT', type: 'int' },
    debug: { name: 'DEBUG', type: 'bool' },
    timeout: { name: 'TIMEOUT', type: 'duration' },
    apiToken: { name: 'API_TOKEN' },
    legacyKey: { name: 'LEGACY_KEY', version: 2 },
  });
  console.log(
    `configuration loaded: host=${cfg.dbHost} port=${cfg.dbPort} debug=${cfg.debug} ` +
      `timeout=${cfg.timeout}ms legacy_key_loaded=${cfg.legacyKey !== ''}`,
  );

  // 2. Read a single variable by name. Do not log secret values in production.
  const apiToken = await client.get('API_TOKEN');
  console.log(`API_TOKEN retrieved (${apiToken.length} characters)`);

  // 3. Read a specific version of a single variable.
  const legacyToken = await client.getVersion('API_TOKEN', 1);
  console.log(`API_TOKEN version 1 retrieved (${legacyToken.length} characters)`);

  // 4. Read every variable of the environment as a map.
  const all = await client.getAll();
  console.log(`retrieved ${Object.keys(all).length} variables`);
}

main().catch((error: unknown) => {
  if (error instanceof YilyError) {
    console.error(`yily error ${error.code}: ${error.message}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

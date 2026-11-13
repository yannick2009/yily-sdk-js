import { parseDurationToMilliseconds } from './duration.js';
import { YilyError, YilyErrorCode } from './errors.js';
import { normalizeVariableName } from './utils.js';

/** Target types supported by the loader. */
export type FieldType = 'string' | 'int' | 'int64' | 'float64' | 'bool' | 'duration';

/** Explicit field definition used by {@link Client.load}. */
export interface FieldDefinition {
  /** Yily variable name. The server convention (upper case, underscores) is applied. */
  name: string;

  /** Target type; defaults to `"string"`. */
  type?: FieldType;

  /** Positive version number; omit to load the active version. */
  version?: number;
}

/**
 * A field specification.
 *
 * A plain string is either a variable name or shorthand such as
 * `"API_KEY,version=2"`. Use an object for a literal name containing a comma,
 * an explicit type, or a version.
 */
export type FieldSpec = string | FieldDefinition;

/** Schema accepted by {@link Client.load}. */
export type Schema = Record<string, FieldSpec>;

/** JavaScript value produced by a field of type `T`. */
export type FieldValue<T extends FieldType> = T extends 'string'
  ? string
  : T extends 'int'
    ? number
    : T extends 'int64'
      ? bigint
      : T extends 'float64'
        ? number
        : T extends 'bool'
          ? boolean
          : T extends 'duration'
            ? number
            : never;

/** JavaScript value produced by one field specification. */
export type LoadedValue<D extends FieldSpec> = D extends string
  ? string
  : D extends { type?: infer T }
    ? T extends FieldType
      ? FieldValue<T>
      : string
    : string;

/** Object returned by {@link Client.load}. */
export type Loaded<S extends Schema> = { [K in keyof S]: LoadedValue<S[K]> };

/** One field selected for loading. */
export interface FieldInfo {
  /** Key on the target object. */
  key: string;
  /** Normalized variable name. */
  varName: string;
  /** Requested version; 0 selects the active version. */
  version: number;
  /** Target conversion type. */
  type: FieldType;
}

const FIELD_TYPES: readonly FieldType[] = [
  'string',
  'int',
  'int64',
  'float64',
  'bool',
  'duration',
];

const FIELD_TYPE_SET: ReadonlySet<string> = new Set(FIELD_TYPES);
const ALLOWED_DEFINITION_KEYS: ReadonlySet<string> = new Set(['name', 'type', 'version']);
const INTEGER_PATTERN = /^[+-]?\d+$/;
const DECIMAL_FLOAT_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

const INT64_MIN = -9_223_372_036_854_775_808n;
const INT64_MAX = 9_223_372_036_854_775_807n;

/**
 * Validates a schema and returns its fields in declaration order.
 *
 * The schema object maps target property names to {@link FieldSpec} values.
 * A field whose spec is the string `"-"` is ignored. Two fields may select the
 * same variable only when they request the same version.
 *
 * @throws {YilyError} with `INVALID_FIELD`, `UNSUPPORTED_TYPE` or
 * `CONFLICTING_VARIABLE_VERSION`.
 */
export function inspectSchema(schema: Schema): FieldInfo[] {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    throw invalidField('schema must be an object');
  }

  const fields: FieldInfo[] = [];
  const seen = new Map<string, number>();

  for (const [key, spec] of Object.entries(schema)) {
    if (spec === '-') {
      continue;
    }

    const parsed = parseFieldSpec(spec, key);
    const varName = normalizeVariableName(parsed.name);

    if (varName === '') {
      throw invalidField(`missing variable name for field "${key}"`);
    }

    const previousVersion = seen.get(varName);
    if (previousVersion !== undefined && previousVersion !== parsed.version) {
      throw new YilyError(
        YilyErrorCode.ConflictingVariableVersion,
        `yily: a variable cannot use different versions in one load: ${varName}`,
      );
    }
    seen.set(varName, parsed.version);

    fields.push({ key, varName, version: parsed.version, type: parsed.type });
  }

  return fields;
}

/**
 * Resolves every field of a schema from the batch response.
 *
 * Values are converted before anything is returned; a missing variable or an
 * invalid value aborts the whole load.
 *
 * @throws {YilyError} with `VARIABLE_NOT_FOUND`, `INVALID_VALUE`, or
 * `UNSUPPORTED_TYPE`.
 */
export function decodeFields(
  fields: readonly FieldInfo[],
  values: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const entries: Array<[string, unknown]> = [];

  for (const field of fields) {
    if (!Object.hasOwn(values, field.varName)) {
      throw new YilyError(
        YilyErrorCode.VariableNotFound,
        `yily: variable not found: ${field.varName}`,
      );
    }

    const raw = values[field.varName];
    if (raw === undefined) {
      throw new YilyError(
        YilyErrorCode.VariableNotFound,
        `yily: variable not found: ${field.varName}`,
      );
    }

    entries.push([field.key, convertValue(raw, field.type, field.varName)]);
  }

  // Object.fromEntries defines own data properties, which keeps keys such as
  // "__proto__" from mutating the result's prototype.
  return Object.fromEntries(entries);
}

interface ParsedFieldSpec {
  name: string;
  version: number;
  type: FieldType;
}

function parseFieldSpec(spec: FieldSpec, key: string): ParsedFieldSpec {
  if (typeof spec === 'string') {
    const shorthand = parseShorthand(spec);
    return { name: shorthand.name, version: shorthand.version, type: 'string' };
  }

  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    throw invalidField(`field "${key}" must be a string or an object`);
  }

  for (const option of Object.keys(spec)) {
    if (!ALLOWED_DEFINITION_KEYS.has(option)) {
      throw invalidField(`unsupported option "${option}" for field "${key}"`);
    }
  }

  if (typeof spec.name !== 'string') {
    throw invalidField(`field "${key}" must define a variable name`);
  }

  const name = spec.name.trim();
  if (name === '') {
    throw invalidField(`missing variable name for field "${key}"`);
  }

  let type: FieldType = 'string';
  if (spec.type !== undefined) {
    if (typeof spec.type !== 'string' || !FIELD_TYPE_SET.has(spec.type)) {
      throw new YilyError(
        YilyErrorCode.UnsupportedType,
        `yily: unsupported field type: "${String(spec.type)}" for variable "${name}"`,
      );
    }
    type = spec.type as FieldType;
  }

  let version = 0;
  if (spec.version !== undefined) {
    if (!Number.isSafeInteger(spec.version) || spec.version <= 0) {
      throw invalidField(`version must be a positive integer for field "${key}"`);
    }
    version = spec.version;
  }

  return { name, version, type };
}

/**
 * Parses the shorthand `NAME[,version=N]`.
 *
 * A missing name, an unknown option, a repeated option, or a non-positive
 * version is rejected.
 */
function parseShorthand(shorthand: string): { name: string; version: number } {
  const parts = shorthand.split(',');
  const name = (parts[0] ?? '').trim();
  if (name === '') {
    throw invalidField('missing variable name');
  }

  let version = 0;
  let versionSet = false;

  for (const rawPart of parts.slice(1)) {
    const part = rawPart.trim();
    const separator = part.indexOf('=');
    if (separator === -1) {
      throw invalidField(`unsupported or repeated option "${part}"`);
    }

    const optionKey = part.slice(0, separator).trim();
    const optionValue = part.slice(separator + 1).trim();
    if (optionKey !== 'version' || versionSet) {
      throw invalidField(`unsupported or repeated option "${part}"`);
    }

    if (!INTEGER_PATTERN.test(optionValue)) {
      throw invalidField('version must be a positive integer');
    }
    const parsed = Number(optionValue);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw invalidField('version must be a positive integer');
    }

    version = parsed;
    versionSet = true;
  }

  return { name, version };
}

function convertValue(raw: string, type: FieldType, varName: string): unknown {
  switch (type) {
    case 'string':
      return raw;

    case 'int': {
      if (!INTEGER_PATTERN.test(raw)) {
        throw invalidValue(varName, 'int');
      }
      const value = Number(raw);
      if (!Number.isSafeInteger(value)) {
        throw invalidValue(varName, 'int');
      }
      return value === 0 ? 0 : value;
    }

    case 'int64': {
      if (!INTEGER_PATTERN.test(raw)) {
        throw invalidValue(varName, 'int64');
      }
      const text = raw.startsWith('+') ? raw.slice(1) : raw;
      let value: bigint;
      try {
        value = BigInt(text);
      } catch {
        throw invalidValue(varName, 'int64');
      }
      if (value < INT64_MIN || value > INT64_MAX) {
        throw invalidValue(varName, 'int64');
      }
      return value;
    }

    case 'float64':
      return parseFloat64(raw, varName);

    case 'bool':
      return parseBool(raw, varName);

    case 'duration': {
      try {
        return parseDurationToMilliseconds(raw);
      } catch {
        throw invalidValue(varName, 'duration');
      }
    }

    default:
      throw new YilyError(
        YilyErrorCode.UnsupportedType,
        `yily: unsupported field type: "${String(type)}" for variable "${varName}"`,
      );
  }
}

function parseFloat64(raw: string, varName: string): number {
  if (DECIMAL_FLOAT_PATTERN.test(raw)) {
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw invalidValue(varName, 'float64');
    }
    return value;
  }

  switch (raw.toLowerCase()) {
    case 'nan':
      return Number.NaN;
    case 'inf':
    case '+inf':
    case 'infinity':
    case '+infinity':
      return Number.POSITIVE_INFINITY;
    case '-inf':
    case '-infinity':
      return Number.NEGATIVE_INFINITY;
    default:
      throw invalidValue(varName, 'float64');
  }
}

function parseBool(raw: string, varName: string): boolean {
  switch (raw) {
    case '1':
    case 't':
    case 'T':
    case 'TRUE':
    case 'true':
    case 'True':
      return true;
    case '0':
    case 'f':
    case 'F':
    case 'FALSE':
    case 'false':
    case 'False':
      return false;
    default:
      throw invalidValue(varName, 'bool');
  }
}

function invalidValue(varName: string, typeName: string): YilyError {
  return new YilyError(
    YilyErrorCode.InvalidValue,
    `yily: variable value has an invalid format: variable "${varName}" is not a valid ${typeName}`,
  );
}

function invalidField(detail: string): YilyError {
  return new YilyError(
    YilyErrorCode.InvalidField,
    `yily: invalid yily field specification: ${detail}`,
  );
}

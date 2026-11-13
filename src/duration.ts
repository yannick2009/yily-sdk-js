const NANOSECONDS_PER_MILLISECOND = 1_000_000;

/** Largest positive int64 value, in nanoseconds. */
const MAX_INT64_NANOSECONDS = 9_223_372_036_854_775_807n;

/** 2^63, the magnitude allowed for negative durations. */
const MAX_UINT64_PLUS_ONE_NANOSECONDS = 9_223_372_036_854_775_808n;

const UNIT_TO_NANOSECONDS: Readonly<Record<string, number>> = {
  ns: 1,
  us: 1e3,
  'µs': 1e3, // U+00B5, micro sign
  'μs': 1e3, // U+03BC, Greek letter mu
  ms: 1e6,
  s: 1e9,
  m: 60 * 1e9,
  h: 3600 * 1e9,
};

const NUMBER_PATTERN = /^(\d+(?:\.\d*)?|\.\d+)/;

/**
 * Parses a duration such as `5s`, `250ms` or `1h30m` and returns it in
 * milliseconds.
 *
 * The grammar accepts an optional leading sign, the special value `0`,
 * fractional components, and the `ns`, `us`, `µs`, `μs`, `ms`, `s`, `m` and
 * `h` units. The input must be consumed entirely.
 *
 * @throws {Error} when the input is malformed or outside the int64 range.
 */
export function parseDurationToMilliseconds(raw: string): number {
  let value = raw;
  let negative = false;

  const first = value.charAt(0);
  if (first === '-' || first === '+') {
    negative = first === '-';
    value = value.slice(1);
  }

  // A bare "0" (and "+0" / "-0") is valid.
  if (value === '0') {
    return 0;
  }
  if (value === '') {
    throw new Error('invalid duration');
  }

  let totalNanoseconds = 0n;

  while (value !== '') {
    const match = NUMBER_PATTERN.exec(value);
    const numberText = match?.[1];
    if (numberText === undefined) {
      throw new Error('invalid duration');
    }
    value = value.slice(numberText.length);

    // The unit runs until the next digit or decimal point.
    let unitLength = 0;
    while (unitLength < value.length) {
      const char = value.charAt(unitLength);
      if (char === '.' || isDigit(char)) {
        break;
      }
      unitLength += 1;
    }
    if (unitLength === 0) {
      throw new Error('missing unit in duration');
    }

    const unitText = value.slice(0, unitLength);
    value = value.slice(unitLength);

    const unit = UNIT_TO_NANOSECONDS[unitText];
    if (unit === undefined) {
      throw new Error(`unknown unit "${unitText}" in duration`);
    }

    totalNanoseconds += parseComponent(numberText, unit);
    if (totalNanoseconds > MAX_UINT64_PLUS_ONE_NANOSECONDS) {
      throw new Error('invalid duration');
    }
  }

  if (negative) {
    return -Number(totalNanoseconds) / NANOSECONDS_PER_MILLISECOND;
  }

  if (totalNanoseconds > MAX_INT64_NANOSECONDS) {
    throw new Error('invalid duration');
  }
  return Number(totalNanoseconds) / NANOSECONDS_PER_MILLISECOND;
}

/**
 * Converts one `<number><unit>` component to nanoseconds, keeping the
 * integer/fraction split and overflow checks exact.
 *
 * BigInt keeps the int64 boundary checks exact; JavaScript numbers cannot
 * distinguish 2^63 - 1 from 2^63.
 */
function parseComponent(numberText: string, unit: number): bigint {
  const dotIndex = numberText.indexOf('.');
  const integerText = dotIndex === -1 ? numberText : numberText.slice(0, dotIndex);
  const fractionText = dotIndex === -1 ? '' : numberText.slice(dotIndex + 1);

  const unitNanoseconds = BigInt(unit);
  const integerPart = integerText === '' ? 0n : BigInt(integerText);
  if (integerPart > MAX_UINT64_PLUS_ONE_NANOSECONDS / unitNanoseconds) {
    throw new Error('invalid duration');
  }

  let component = integerPart * unitNanoseconds;

  if (fractionText !== '') {
    const fraction = Number(fractionText);
    const scale = 10 ** fractionText.length;
    const fractionNanoseconds = Math.trunc(fraction * (unit / scale));
    if (!Number.isFinite(fractionNanoseconds)) {
      throw new Error('invalid duration');
    }
    component += BigInt(fractionNanoseconds);
  }

  if (component > MAX_UINT64_PLUS_ONE_NANOSECONDS) {
    throw new Error('invalid duration');
  }

  return component;
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

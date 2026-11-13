import { describe, expect, it } from 'vitest';

import { parseDurationToMilliseconds } from '../src/duration.js';

describe('parseDurationToMilliseconds', () => {
  it.each([
    ['0', 0],
    ['+0', 0],
    ['-0', 0],
    ['5s', 5_000],
    ['250ms', 250],
    ['1h30m', 5_400_000],
    ['1.5h', 5_400_000],
    ['.5s', 500],
    ['5.s', 5_000],
    ['+5s', 5_000],
    ['-5s', -5_000],
    ['1m', 60_000],
    ['1h1m1s', 3_661_000],
    ['1us', 0.001],
    ['1µs', 0.001],
    ['1μs', 0.001],
    ['1ns', 0.000001],
    ['1h30m15.5s', 5_415_500],
  ])('parses %s', (raw, expected) => {
    expect(parseDurationToMilliseconds(raw)).toBe(expected);
  });

  it('accepts the smallest and largest int64 durations', () => {
    expect(parseDurationToMilliseconds('9223372036854775807ns')).toBe(
      9_223_372_036_854_775_807 / 1_000_000,
    );
    expect(parseDurationToMilliseconds('-9223372036854775808ns')).toBe(
      -9_223_372_036_854_775_808 / 1_000_000,
    );
  });

  it.each([
    '',
    '5',
    'abc',
    '1x',
    '1 s',
    '1S',
    '--1s',
    '1..5s',
    '1h30',
    '1e3s',
    '9223372036854775808ns',
    '3000000h',
  ])('rejects %s', (raw) => {
    expect(() => parseDurationToMilliseconds(raw)).toThrow();
  });
});

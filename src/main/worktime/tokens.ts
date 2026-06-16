/**
 * Token 結構與加總。
 * 忠實移植自 Python teamuq/worktime/tokens.py。
 */

import type { TokenStats } from './types';

function _num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return isNaN(n) ? 0 : n;
}

export function emptyTokenUsage(): TokenStats {
  return {
    input: 0,
    output: 0,
    cache_creation: 0,
    cache_creation_5m: 0,
    cache_creation_1h: 0,
    cache_read: 0,
    total: 0,
    message_count: 0,
    cost_usd: 0,
    priced_token_count: 0,
  };
}

export function addTokenUsage(left?: TokenStats | null, right?: TokenStats | null): TokenStats {
  const l = left ?? emptyTokenUsage();
  const r = right ?? emptyTokenUsage();
  return {
    input: _num(l.input) + _num(r.input),
    output: _num(l.output) + _num(r.output),
    cache_creation: _num(l.cache_creation) + _num(r.cache_creation),
    cache_creation_5m: _num(l.cache_creation_5m) + _num(r.cache_creation_5m),
    cache_creation_1h: _num(l.cache_creation_1h) + _num(r.cache_creation_1h),
    cache_read: _num(l.cache_read) + _num(r.cache_read),
    total: _num(l.total) + _num(r.total),
    message_count: _num(l.message_count) + _num(r.message_count),
    cost_usd: _num(l.cost_usd) + _num(r.cost_usd),
    priced_token_count: _num(l.priced_token_count) + _num(r.priced_token_count),
  };
}

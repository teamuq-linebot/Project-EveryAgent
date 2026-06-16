/**
 * parse/tokenCost.ts — token usage / 成本計算組。
 *
 * 行為保留（move-only）：自原 parse.ts 原樣搬出，數值常數/控制流/簽名一字未改。
 * 對外只 export usageToTokenStats；findPrice/estimateCostFromStats/MODEL_PRICES_PER_MTOK
 * 原本即為 parse.ts 模組私有，維持非 export。
 */

import { emptyTokenUsage } from '../../tokens';
import type { TokenStats } from '../../types';

// ---------------------------------------------------------------------------
// token stats（對應 Python usage_to_token_stats）
// ---------------------------------------------------------------------------

/**
 * 把 assistant message usage dict 轉成 TokenStats。
 * 對應 Python usage_to_token_stats()（parse.py 內含版本）。
 */
export function usageToTokenStats(usage: unknown, model = ''): TokenStats {
  const stats = emptyTokenUsage();
  if (!usage || typeof usage !== 'object') return stats;
  const u = usage as Record<string, unknown>;

  let cacheCreation = u['cache_creation'];
  if (!cacheCreation || typeof cacheCreation !== 'object') cacheCreation = {};
  const cc = cacheCreation as Record<string, unknown>;

  stats.input = Number(u['input_tokens'] ?? 0) || 0;
  stats.output = Number(u['output_tokens'] ?? 0) || 0;
  stats.cache_creation = Number(u['cache_creation_input_tokens'] ?? 0) || 0;
  stats.cache_creation_5m = Number(cc['ephemeral_5m_input_tokens'] ?? 0) || 0;
  stats.cache_creation_1h = Number(cc['ephemeral_1h_input_tokens'] ?? 0) || 0;
  // 對應 Python: if not stats["cache_creation_5m"] and not stats["cache_creation_1h"]:
  //                stats["cache_creation_5m"] = stats["cache_creation"]
  if (!stats.cache_creation_5m && !stats.cache_creation_1h) {
    stats.cache_creation_5m = stats.cache_creation;
  }
  stats.cache_read = Number(u['cache_read_input_tokens'] ?? 0) || 0;
  stats.total = stats.input + stats.output + stats.cache_creation + stats.cache_read;
  stats.message_count = stats.total ? 1 : 0;
  stats.cost_usd = estimateCostFromStats(stats, model);
  stats.priced_token_count = stats.cost_usd ? stats.total : 0;
  return stats;
}

// ---------------------------------------------------------------------------
// 成本估算（對應 Python cost.estimate_cost + pricing.find_price）
// ---------------------------------------------------------------------------

// 對應 Python pricing.py MODEL_PRICES_PER_MTOK（claude 來源定價，移植 regex 到 JS /i flag）
const MODEL_PRICES_PER_MTOK: Array<{
  pattern: RegExp;
  input: number;
  cache_write_5m: number;
  cache_write_1h: number;
  cache_read: number;
  output: number;
}> = [
  { pattern: /opus-4-8|opus 4\.8/i, input: 5, cache_write_5m: 6.25, cache_write_1h: 10, cache_read: 0.5, output: 25 },
  { pattern: /opus-4-7|opus 4\.7/i, input: 5, cache_write_5m: 6.25, cache_write_1h: 10, cache_read: 0.5, output: 25 },
  { pattern: /opus-4-6|opus 4\.6/i, input: 5, cache_write_5m: 6.25, cache_write_1h: 10, cache_read: 0.5, output: 25 },
  { pattern: /opus-4-5|opus 4\.5/i, input: 5, cache_write_5m: 6.25, cache_write_1h: 10, cache_read: 0.5, output: 25 },
  { pattern: /opus-4-1|opus 4\.1/i, input: 15, cache_write_5m: 18.75, cache_write_1h: 30, cache_read: 1.5, output: 75 },
  // Python: r"opus-4(?!-[5-8])|opus 4\b"  → JS: /opus-4(?!-[5-8])|opus 4\b/i
  { pattern: /opus-4(?!-[5-8])|opus 4\b/i, input: 15, cache_write_5m: 18.75, cache_write_1h: 30, cache_read: 1.5, output: 75 },
  { pattern: /sonnet-4-6|sonnet 4\.6/i, input: 3, cache_write_5m: 3.75, cache_write_1h: 6, cache_read: 0.3, output: 15 },
  { pattern: /sonnet-4-5|sonnet 4\.5/i, input: 3, cache_write_5m: 3.75, cache_write_1h: 6, cache_read: 0.3, output: 15 },
  // Python: r"sonnet-4(?!-[56])|sonnet 4\b"
  { pattern: /sonnet-4(?!-[56])|sonnet 4\b/i, input: 3, cache_write_5m: 3.75, cache_write_1h: 6, cache_read: 0.3, output: 15 },
  { pattern: /haiku-4-5|haiku 4\.5/i, input: 1, cache_write_5m: 1.25, cache_write_1h: 2, cache_read: 0.1, output: 5 },
];

function findPrice(model: string) {
  const normalized = (model || '').toLowerCase();
  for (const entry of MODEL_PRICES_PER_MTOK) {
    if (entry.pattern.test(normalized)) return entry;
  }
  return null;
}

function estimateCostFromStats(stats: TokenStats, model: string): number {
  const price = findPrice(model);
  if (!price) return 0;
  return (
    stats.input * price.input +
    stats.cache_creation_5m * price.cache_write_5m +
    stats.cache_creation_1h * price.cache_write_1h +
    stats.cache_read * price.cache_read +
    stats.output * price.output
  ) / 1_000_000;
}

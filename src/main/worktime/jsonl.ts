/**
 * JSONL / 時間解析通用 IO 工具。
 * 忠實移植自 Python teamuq/worktime/jsonl.py。
 * 純 Node.js stdlib，全程容錯：壞檔 / 壞行不丟例外。
 */

/**
 * epoch 毫秒整數 → ISO 字串（帶 Z），對應 Python to_iso_from_epoch_ms()。
 * 無法解析回 null。
 */
export function toIsoFromEpochMs(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  let ms: number;
  try {
    ms = Number(value);
  } catch {
    return null;
  }
  if (!isFinite(ms)) return null;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

import * as fs from 'fs';
import type { JsonlItem } from './types';

/**
 * 把 ISO 字串（或已是數字的 epoch ms）轉成 epoch 毫秒整數，失敗回 null。
 * 對應 Python to_epoch_ms()，等同 JS new Date(x).getTime()。
 */
export function toEpochMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  // 已是數字 → 視為 epoch ms
  if (typeof value === 'number') {
    if (!isFinite(value)) return null;
    return Math.trunc(value);
  }

  if (typeof value !== 'string') return null;

  const text = value.trim();
  if (!text) return null;

  // Python fromisoformat 對無時區字串補 UTC（視為 UTC）；
  // JS Date.parse 對無時區 ISO 字串視為本地時間，與 Python 語意不同。
  // 修正：偵測無時區標記（無 Z、無 +hh:mm / -hh:mm）時，補 'Z' 再 parse（強制 UTC）。
  // 已帶 Z 或 offset 的字串不重複加。
  const hasTimezone = /[Zz]$/.test(text) || /[+-]\d{2}:\d{2}$/.test(text);
  const textForParse = hasTimezone ? text : text + 'Z';
  const ms = Date.parse(textForParse);
  if (!isNaN(ms)) return ms;

  // 後備：截到秒再試（容忍奇怪格式）
  const truncated = text.split('+')[0].split('.')[0];
  const ms2 = Date.parse(truncated + 'Z');
  if (!isNaN(ms2)) return ms2;

  return null;
}

/**
 * 等同 JS `new Date(end) - new Date(start)`，任一不可解析回 null。
 * 對應 Python date_diff_ms()。
 */
export function dateDiffMs(startIso: unknown, endIso: unknown): number | null {
  const start = toEpochMs(startIso);
  const end = toEpochMs(endIso);
  if (start === null || end === null) return null;
  return end - start;
}

/**
 * 逐一 yield text 中的頂層 JSON 值。
 * 對應 Python iter_json_objects()：支援舊版 NDJSON 與新版多行縮排兩種格式。
 * 壞片段跳過，不丟例外。
 */
export function* iterJsonObjects(text: string): Generator<unknown> {
  let i = 0;
  const n = text.length;

  while (i < n) {
    // 跳過物件間空白
    while (i < n && (text[i] === ' ' || text[i] === '\t' || text[i] === '\r' || text[i] === '\n')) {
      i++;
    }
    if (i >= n) break;

    // 嘗試從位置 i 開始解析 JSON
    // 找出可能的 JSON 物件/陣列邊界，用 try/catch 逐步擴展
    let parsed: unknown = undefined;
    let endPos = -1;

    // 直接嘗試解析從 i 開始的子字串，逐步找到匹配的結束位置
    // 使用原生 JSON.parse + 二分法效率不佳，改用 JSON 標準解析器方式：
    // 利用 JSON.parse 的錯誤訊息找不到標準位置，改採暴力掃描法
    // 最簡單可靠：用 JSON.parse 加 reviver 追蹤，或直接 scan brackets
    const ch = text[i];
    if (ch !== '{' && ch !== '[' && ch !== '"' && ch !== 't' && ch !== 'f' && ch !== 'n' && !(ch >= '0' && ch <= '9') && ch !== '-') {
      i++;
      continue;
    }

    // 用 try/catch 搜尋有效 JSON 物件邊界
    // 從最小可能的物件往後擴展（掃括號深度）
    let depth = 0;
    let inStr = false;
    let escape = false;
    let j = i;

    for (; j < n; j++) {
      const c = text[j];
      if (escape) {
        escape = false;
        continue;
      }
      if (c === '\\' && inStr) {
        escape = true;
        continue;
      }
      if (c === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;

      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') {
        depth--;
        if (depth === 0) {
          endPos = j + 1;
          break;
        }
      }
    }

    // 若是純量（數字/字串/true/false/null），depth 永遠不歸零
    // 嘗試小片段 JSON.parse
    if (endPos === -1) {
      // 可能是純量，嘗試到下一個空白或換行
      let k = i;
      while (k < n && text[k] !== '\n' && text[k] !== '\r' && text[k] !== ' ' && text[k] !== '\t') {
        k++;
      }
      if (k > i) {
        try {
          parsed = JSON.parse(text.slice(i, k));
          endPos = k;
        } catch {
          i++;
          continue;
        }
      } else {
        i++;
        continue;
      }
    } else {
      try {
        parsed = JSON.parse(text.slice(i, endPos));
      } catch {
        i++;
        continue;
      }
    }

    yield parsed;
    i = endPos;
  }
}

/**
 * 增量消費：從 text 依序解析「完整的」JSON 物件，回 { objects, rest }。
 * rest = 尾端尚未閉合的殘段（claude 正在寫入中的 record），供呼叫端串接
 * 新讀到的資料後下次再試 —— 增量讀取（只讀檔案新增 bytes）用。
 * 只認 '{' 起始的物件（claude JSONL 每筆都是物件）；其餘字元視為雜訊消耗。
 * 與 iterJsonObjects 同一套括號深度掃描，支援多行縮排 record。
 */
export function consumeJsonObjects(text: string): { objects: unknown[]; rest: string } {
  const objects: unknown[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    if (text[i] !== '{') {
      i++;
      continue;
    }
    // 括號深度掃描找物件結束（字串/跳脫感知）
    let depth = 0;
    let inStr = false;
    let escape = false;
    let endPos = -1;
    for (let j = i; j < n; j++) {
      const c = text[j];
      if (escape) {
        escape = false;
        continue;
      }
      if (c === '\\' && inStr) {
        escape = true;
        continue;
      }
      if (c === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') {
        depth--;
        if (depth === 0) {
          endPos = j + 1;
          break;
        }
      }
    }
    if (endPos === -1) {
      // 未閉合（寫入中）→ 殘段留待下次
      return { objects, rest: text.slice(i) };
    }
    try {
      objects.push(JSON.parse(text.slice(i, endPos)));
      i = endPos;
    } catch {
      // 壞片段：跳過此 '{' 繼續（與 iterJsonObjects 容錯一致）
      i++;
    }
  }
  return { objects, rest: '' };
}

/**
 * 讀 JSONL，回 JsonlItem[]，對應 Python read_jsonl()。
 * 同時支援舊版 compact NDJSON 與新版多行縮排格式。
 * 讀不到檔回 []，不丟例外。
 */
export function readJsonl(filePath: string): JsonlItem[] {
  let text: string;
  try {
    text = fs.readFileSync(filePath, { encoding: 'utf-8' });
  } catch {
    return [];
  }

  const rows: JsonlItem[] = [];
  let index = 0;

  for (const obj of iterJsonObjects(text)) {
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) continue;
    rows.push({ index, record: obj as Record<string, unknown>, error: null });
    index++;
  }

  return rows;
}

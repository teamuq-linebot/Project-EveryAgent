/**
 * backend/ids.ts — session/uuid 產生與路徑比對純函式。
 *
 * 自 backend.ts module-scope helpers 機械抽離（行為保留 move-only）：
 *   _genSessionId / _samePath / _genUuid。
 * 全為零 `this` 純函式；backend.ts 改 import 使用，對外介面不變。
 */

import * as path from "node:path";

export function _genSessionId(): string {
  // crypto.randomUUID() 在 Node 16+ 可用；Electron 使用 Chromium Node，一般可用。
  // 若不支援退化用 Math.random hex。
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return (
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2) +
    Date.now().toString(36)
  );
}

/**
 * 兩個專案路徑是否指向同一目錄（用於偵測使用者是否換了路徑）。
 * 以 path.resolve 正規化（吃掉尾斜線 / `.` / 重複斜線等）後比對；任一為空 → 視為不同。
 * 大小寫敏感（macOS 預設 HFS+ 不分大小寫，但此處保守做字面比對，避免誤判為同路徑）。
 */
export function _samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  try {
    return path.resolve(a) === path.resolve(b)
  } catch {
    return a.trim() === b.trim()
  }
}

/** 標準 UUID（含連字號）——claude --session-id 需 UUID 格式，且即其 JSONL 檔名。 */
export function _genUuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  // 退化：組一個 v4 風格字串（非密碼學等級，僅作 fallback）。
  const h = (n: number): string =>
    Array.from({ length: n }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join("");
  return `${h(8)}-${h(4)}-4${h(3)}-${h(4)}-${h(12)}`;
}

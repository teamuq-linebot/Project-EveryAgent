/**
 * punchBuilder.ts — 打卡子任務描述 / 名稱組裝（純邏輯，零 Electron / Qt 依賴）。
 *
 * 1:1 移植自 Python:
 *   teamuq/util/punch_builder.py
 *
 * PunchBuilderMixin class → TS class（依 PunchService 注入介面使用）。
 */

export const PUNCH_NAME_MAX_LEN = 80;
export const PUNCH_DESC_FRAGMENT_MAX = 60;
export const MAIN_PUNCH_NAME = 'agent_manager';
export const PUNCH_CATEGORY_NAME = 'Agent_自動打卡';
export const MAIN_PUNCH_KEY = '__main__';

/**
 * 對齊 Python `round(h, 4)` 的 f-string 格式：保留 4 位小數，但整數值顯示為 "2.0"（非 "2"）。
 * Python f"{round(2.0, 4)}" → "2.0"；JS (2).toString() → "2"，需補一位小數。
 */
function _roundHours(h: number): string {
  const rounded = Math.round(h * 10000) / 10000;
  const s = rounded.toString();
  return s.includes('.') ? s : s + '.0';
}

/** 現在時間 UTC ISO（YYYY-MM-DDTHH:MM:SS.000Z），與 appsync client 對齊。 */
export function utcNowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z');
}

/** startTime 正規化：取前 19 字元（YYYY-MM-DDTHH:MM:SS）為主鍵；空值回空字串。 */
export function normStartTime(value: unknown): string {
  if (!value) return '';
  return String(value).trim().slice(0, 19);
}

/** 過長字串截斷 + 加省略號（… 算進長度內）。 */
export function truncate(text: string, limit: number): string {
  const t = (text || '').trim();
  if (t.length <= limit) return t;
  if (limit <= 1) return t.slice(0, limit);
  return t.slice(0, limit - 1).trimEnd() + '…';
}

/** PunchService 需要的 Model 層名稱/描述組裝介面。 */
export interface NameBuilder {
  _subagent_subtask_name(punch_name: string, description: string): string;
  _build_subagent_description(description: string, model: string, tokens: unknown, hours: unknown): string;
  _build_main_description(hours: unknown): string;
}

/** 打卡名稱 / description 欄組裝（純邏輯；讀 sessionId 屬性，不碰 Electron/Qt）。 */
export class PunchBuilderMixin implements NameBuilder {
  sessionId: string;

  constructor(sessionId = 'abcdef0123456789') {
    this.sessionId = sessionId;
  }

  _short_session_code(): string {
    const sid = String(this.sessionId || '').trim();
    return sid ? sid.slice(0, 8) : '';
  }

  _subagent_subtask_name(punch_name: string, description: string): string {
    const pn = (punch_name || '').trim();
    const desc = (description || '').trim();
    if (!desc) return truncate(pn, PUNCH_NAME_MAX_LEN);
    return truncate(`${pn}：${desc}`, PUNCH_NAME_MAX_LEN);
  }

  _build_subagent_description(description: string, model: string, tokens: unknown, hours: unknown): string {
    const parts: string[] = [];
    const desc = (description || '').trim();
    if (desc) parts.push(`任務: ${truncate(desc, PUNCH_DESC_FRAGMENT_MAX)}`);
    const mod = (model || '').trim();
    if (mod) parts.push(`模型: ${mod}`);
    let tok = 0;
    try { tok = parseInt(String(tokens || 0), 10) || 0; } catch { tok = 0; }
    if (tok > 0) parts.push(`token: ${tok}`);
    let h = 0.0;
    try { h = parseFloat(String(hours || 0.0)) || 0.0; } catch { h = 0.0; }
    if (h > 0) parts.push(`工時: ${_roundHours(h)}h`);
    const code = this._short_session_code();
    if (code) parts.push(`session: ${code}`);
    return parts.join(' | ');
  }

  _build_main_description(hours: unknown): string {
    const parts = ['主對話'];
    let h = 0.0;
    try { h = parseFloat(String(hours || 0.0)) || 0.0; } catch { h = 0.0; }
    if (h > 0) parts.push(`工時 ${_roundHours(h)}h`);
    const code = this._short_session_code();
    if (code) parts.push(`session ${code}`);
    return parts.join(' | ');
  }
}

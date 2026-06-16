/**
 * PunchTableBuilder.ts — 打卡表格列建構（純函式化，自 MonitorController.ts private methods 抽出）
 *
 * 原本讀 this._liveOverlay / this._punchService / this._mainEvents / this._mainState /
 * this._lastSubagentEvents 的欄位，全部改為函式參數傳入（傳 reference 非 copy，即時性不變）。
 */

import { makePunchRow } from './types';
import type { PunchEvents, PunchRow } from './types';
import { MAIN_PUNCH_NAME } from '../worktime/punchCore';
import type { PunchService } from '../services/punchService';

/** live overlay 形狀（uid → { hours, in_progress }）。 */
export type LiveOverlay = Map<string, { hours: number; in_progress: boolean }>;

/** 對應 Python _build_live_overlay（純函式）。 */
export function buildLiveOverlay(events: PunchEvents): LiveOverlay {
  const overlay = new Map<string, { hours: number; in_progress: boolean }>();
  const allEvs = [...(events.main_events || []), ...(events.subagent_events || [])];
  for (const ev of allEvs) {
    const uid = String(ev['punch_uid'] || '');
    if (!uid) continue;
    overlay.set(uid, {
      hours: parseFloat(String(ev['duration_hours'] || 0.0)) || 0.0,
      in_progress: !Boolean(ev['is_complete']),
    });
  }
  return overlay;
}

/** DB 驅動版（對應 Python build_punch_rows_from_db）。 */
export function buildPunchRowsFromDb(
  dbRows: Record<string, unknown>[],
  canPunch: boolean,
  overlay: LiveOverlay,
  punchService: PunchService,
): PunchRow[] {
  const rows: PunchRow[] = [];

  for (const row of dbRows || []) {
    const uid = String(row['punch_uid'] || '');
    const name = String(row['name'] || row['type'] || '—');
    const type = String(row['type'] || '');
    const description = String(row['description'] || '');
    const subtaskId = String(row['subtask_id'] || '');

    // F-Z3：stale 列比照 checkin 頁語意，顯示「已中斷」
    if (row['status'] === 'stale') {
      const hours = parseFloat(String(row['hours'] || 0)) || 0;
      rows.push(makePunchRow({
        name, started_at: row['started_at'], ended_at: row['ended_at'],
        hours, status: '已中斷', show_end: false, type, description, subtask_id: subtaskId, error: '',
      }));
      continue;
    }

    const inProgress = (row['status'] === 'open') || row['ended_at'] == null;

    if (inProgress) {
      const ov = overlay.get(uid) || { hours: 0, in_progress: true };
      const hours = ov.hours || parseFloat(String(row['hours'] || 0)) || 0;
      let status: string;
      let errText = '';
      const errVal = punchService.errors.get(uid);
      if (errVal) {
        status = '錯誤';
        errText = typeof errVal !== 'boolean' ? String(errVal) : '';
      } else if (punchService.token_defer.has(uid)) {
        status = '待登入(暫停打卡)';
      } else if (!canPunch) {
        status = '未登入/缺資料，僅顯示不打卡';
      } else {
        status = '執行中';
      }
      rows.push(makePunchRow({
        name, started_at: row['started_at'], ended_at: row['ended_at'],
        hours, status, show_end: false, type, description, subtask_id: subtaskId, error: errText,
      }));
    } else {
      const hours = parseFloat(String(row['hours'] || 0)) || 0;
      let status: string;
      let errText = '';
      if (row['ok'] === 0) {
        status = '錯誤';
        errText = String(row['error'] || '');
      } else {
        status = '已完成';
      }
      rows.push(makePunchRow({
        name, started_at: row['started_at'], ended_at: row['ended_at'],
        hours, status, show_end: true, type, description, subtask_id: subtaskId, error: errText,
      }));
    }
  }
  return rows;
}

/** event-based fallback（對應 Python _build_punch_rows_from_events）。 */
export function buildPunchRowsFromEvents(
  canPunch: boolean,
  mainEvents: Record<string, unknown>[],
  mainState: Record<string, unknown>,
  lastSubagentEvents: Record<string, unknown>[],
  punchService: PunchService,
): PunchRow[] {
  const rows: PunchRow[] = [];

  // main 列
  if (mainEvents.length > 0) {
    for (const ev of mainEvents) {
      const ekey = String(ev['punch_uid'] || '');
      const isComplete = Boolean(ev['is_complete']);
      let status: string;
      const errVal = punchService.errors.get(ekey);
      if (errVal) {
        status = '錯誤';
      } else if (punchService.token_defer.has(ekey)) {
        status = '待登入(暫停打卡)';
      } else if (!canPunch) {
        status = '未登入/缺資料，僅顯示不打卡';
      } else if (punchService.punched_keys.has(ekey)) {
        status = '已打卡';
      } else if (isComplete) {
        status = '執行中(待完成)';
      } else {
        status = '進行中(本輪未完成)';
      }
      rows.push(makePunchRow({
        name: String(ev['punch_name'] || '') || MAIN_PUNCH_NAME,
        started_at: ev['started_at'],
        ended_at: ev['ended_at'],
        hours: parseFloat(String(ev['duration_hours'] || 0)) || 0,
        status,
        show_end: isComplete,
      }));
    }
  } else {
    // fallback 單列 main（無 main_events）
    const m = mainState;
    let mainStatus: string;
    if (!canPunch) {
      mainStatus = '未登入/缺資料，僅顯示不打卡';
    } else {
      mainStatus = '進行中(停手才打卡)';
    }
    rows.push(makePunchRow({
      name: MAIN_PUNCH_NAME,
      started_at: m['started_at'],
      ended_at: m['ended_at'],
      hours: parseFloat(String(m['duration_hours'] || 0)) || 0,
      status: mainStatus,
      show_end: false,
    }));
  }

  // subagent 列
  for (const ev of lastSubagentEvents) {
    const name = String(ev['punch_name'] || '');
    const hours = parseFloat(String(ev['duration_hours'] || 0)) || 0;
    const complete = Boolean(ev['is_complete']);
    const ekey = String(ev['punch_uid'] || ev['event_key'] || '');
    let status: string;
    const errVal = punchService.errors.get(ekey);
    if (errVal) {
      status = '錯誤';
    } else if (punchService.token_defer.has(ekey)) {
      status = '待登入(暫停打卡)';
    } else if (!canPunch) {
      status = '未登入/缺資料，僅顯示不打卡';
    } else if (punchService.punched_keys.has(ekey)) {
      status = '已打卡';
    } else if (complete) {
      status = '執行中(待完成)';
    } else {
      status = '執行中';
    }
    rows.push(makePunchRow({
      name,
      started_at: ev['started_at'],
      ended_at: ev['ended_at'],
      hours,
      status,
      show_end: complete,
    }));
  }
  return rows;
}

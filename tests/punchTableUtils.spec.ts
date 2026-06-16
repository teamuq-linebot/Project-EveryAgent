/**
 * punchTableUtils.spec.ts — PunchTable 純函式單元測試
 *
 * 測 fmtElapsedMinutes（開始→結束時間戳 → 經過分鐘）+ statusColorClass（狀態→色 class）
 * 直接 import 自 renderer/views/Session/PunchTable.tsx（只用純 TS 邏輯部分）。
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { fmtElapsedMinutes, punchMinutesDisplay, statusColorClass } from '../src/renderer/views/Session/PunchTable';

describe('fmtElapsedMinutes', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('開始=結束 → 0.0 分', () => {
    expect(fmtElapsedMinutes(0, 0)).toBe('0.0');
  });

  it('相差 60000ms → 1.0 分（epoch ms）', () => {
    expect(fmtElapsedMinutes(0, 60_000)).toBe('1.0');
  });

  it('相差 90000ms → 1.5 分', () => {
    expect(fmtElapsedMinutes(0, 90_000)).toBe('1.5');
  });

  it('ISO 字串：相差 30 分 → 30.0 分', () => {
    expect(
      fmtElapsedMinutes('2026-06-10T09:00:00Z', '2026-06-10T09:30:00Z')
    ).toBe('30.0');
  });

  it('結束未填（執行中）→ 算到目前時間', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T09:05:00Z'));
    expect(fmtElapsedMinutes('2026-06-10T09:00:00Z', null)).toBe('5.0');
  });

  it('無開始時間 → —', () => {
    expect(fmtElapsedMinutes(null, 60_000)).toBe('—');
    expect(fmtElapsedMinutes('', 60_000)).toBe('—');
  });

  it('結束早於開始（時鐘異常）→ —', () => {
    expect(fmtElapsedMinutes(60_000, 0)).toBe('—');
  });

  it('開始時間無法解析 → —', () => {
    expect(fmtElapsedMinutes('not-a-date', 60_000)).toBe('—');
  });
});

describe('punchMinutesDisplay', () => {
  it('狀態=已中斷 → —（不算耗時）', () => {
    expect(punchMinutesDisplay('已中斷', 0, 60_000)).toBe('—');
    // 即使有合法時間戳，已中斷一律 —
    expect(punchMinutesDisplay('已中斷', '2026-06-10T09:00:00Z', '2026-06-10T09:30:00Z')).toBe('—');
  });

  it('其餘狀態 → 實際耗時', () => {
    expect(punchMinutesDisplay('已打卡', 0, 90_000)).toBe('1.5');
    expect(punchMinutesDisplay('執行中', null, 60_000)).toBe('—'); // 無開始時間
  });
});

describe('statusColorClass', () => {
  it('已打卡 → done class', () => {
    expect(statusColorClass('已打卡')).toBe('punch-table__status--done');
  });

  it('done → done class', () => {
    expect(statusColorClass('done')).toBe('punch-table__status--done');
  });

  it('ok → done class', () => {
    expect(statusColorClass('ok')).toBe('punch-table__status--done');
  });

  it('錯誤 → error class', () => {
    expect(statusColorClass('錯誤')).toBe('punch-table__status--error');
  });

  it('error → error class', () => {
    expect(statusColorClass('error')).toBe('punch-table__status--error');
  });

  it('fail → error class', () => {
    expect(statusColorClass('fail')).toBe('punch-table__status--error');
  });

  it('執行中 → running class', () => {
    expect(statusColorClass('執行中')).toBe('punch-table__status--running');
  });

  it('running → running class', () => {
    expect(statusColorClass('running')).toBe('punch-table__status--running');
  });

  it('in_progress → running class', () => {
    expect(statusColorClass('in_progress')).toBe('punch-table__status--running');
  });

  it('未知狀態 → 空字串', () => {
    expect(statusColorClass('pending')).toBe('');
  });

  it('空字串 → 空字串', () => {
    expect(statusColorClass('')).toBe('');
  });
});

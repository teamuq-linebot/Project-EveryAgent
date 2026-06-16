/**
 * sessionRunState.spec.ts — 監測卡片 run-state 偵測（sessions 心跳為主 + JSONL fallback）。
 *
 * 涵蓋 sessionLiveness.ts 新增的偵測函式：
 *   - mapSessionStatus：status 欄 → run-state 映射（對齊 session-monitor.html statusLabel）。
 *   - getSessionStatusRunState：掃 ~/.claude/sessions/*.json，sessionId 相符且新鮮 → 映射；
 *       同 sessionId 多檔取 updatedAt 最新；殘檔（updatedAt 過舊）不採信。
 *   - getJsonlFallbackRunState：無 status 時退回 JSONL（主對話 + subagent）——
 *       未回答的 AskUserQuestion → waiting；近期事件 → running；否則 idle。
 *
 * 隔離手法：
 *   - sessions 目錄：vi.spyOn(os, 'homedir') 指向 tmp 目錄（os.homedir 在 Windows 不吃 env）。
 *   - JSONL fallback 的專案資料夾：vi.mock discover.findProjectFolder 指向 tmp projects 資料夾。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// os.homedir 在此環境不可 spyOn（property 不可重定義）→ 整模組 mock：
//   保留真 os 全部函式，只讓 homedir 回可控變數 _mockHome。
let _mockHome = os.tmpdir();
vi.mock('os', async (importActual) => {
  const actual = await importActual<typeof import('os')>();
  return { ...actual, default: actual, homedir: () => _mockHome };
});

// findProjectFolder mock：getJsonlFallbackRunState 用它定位 ~/.claude/projects/<folder>。
let mockedProjectFolder: { match: string; folder_path: string } = {
  match: 'not-found',
  folder_path: '',
};
vi.mock('../src/main/worktime/claude/discover', () => ({
  findProjectFolder: () => mockedProjectFolder,
}));

import {
  mapSessionStatus,
  getSessionStatusRunState,
  getJsonlFallbackRunState,
} from '../src/main/monitor/sessionLiveness';

// ---------------------------------------------------------------------------
// tmp HOME 隔離
// ---------------------------------------------------------------------------

let tmpHome: string;
let sessionsDir: string;
let projectFolder: string;

const SID = '45042793-fa29-4aa4-96c1-19597cd5c203';

beforeEach(() => {
  // os.tmpdir 經 mock 後仍是真值（actual 展開）；用它建隔離 tmp HOME。
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tuq-runstate-test-'));
  _mockHome = tmpHome; // 讓被測模組的 os.homedir() 指向此 tmp HOME
  sessionsDir = path.join(tmpHome, '.claude', 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });

  projectFolder = path.join(tmpHome, '.claude', 'projects', 'proj');
  fs.mkdirSync(projectFolder, { recursive: true });

  mockedProjectFolder = { match: 'direct', folder_path: projectFolder };
});

afterEach(() => {
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

/** 寫一個 sessions 心跳檔（PID 命名）。 */
function writeSessionFile(pid: number, obj: Record<string, unknown>): void {
  fs.writeFileSync(path.join(sessionsDir, `${pid}.json`), JSON.stringify(obj), 'utf8');
}

/** 寫一個 JSONL（含主對話 / subagent；逐 record 一行）。 */
function writeJsonl(file: string, records: Record<string, unknown>[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// mapSessionStatus
// ---------------------------------------------------------------------------

describe('mapSessionStatus（對齊 session-monitor.html statusLabel）', () => {
  it('busy / running → running', () => {
    expect(mapSessionStatus('busy')).toBe('running');
    expect(mapSessionStatus('running')).toBe('running');
    expect(mapSessionStatus('BUSY')).toBe('running'); // 大小寫不敏感
  });

  it('waiting / paused → waiting', () => {
    expect(mapSessionStatus('waiting')).toBe('waiting');
    expect(mapSessionStatus('paused')).toBe('waiting');
  });

  it('idle / ready → completed（CLI 待命＝對話已完成，UI 綠色點）', () => {
    expect(mapSessionStatus('idle')).toBe('completed');
    expect(mapSessionStatus('ready')).toBe('completed');
  });

  it('缺欄 / 空字串 / 未知值 → null（交給 fallback）', () => {
    expect(mapSessionStatus(undefined)).toBeNull();
    expect(mapSessionStatus(null)).toBeNull();
    expect(mapSessionStatus('')).toBeNull();
    expect(mapSessionStatus('error')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getSessionStatusRunState（sessions 心跳為主）
// ---------------------------------------------------------------------------

describe('getSessionStatusRunState', () => {
  it('status=busy + 新鮮 updatedAt → running', () => {
    writeSessionFile(31228, {
      pid: 31228,
      sessionId: SID,
      status: 'busy',
      updatedAt: Date.now(),
    });
    expect(getSessionStatusRunState(SID)).toBe('running');
  });

  it('status=waiting → waiting（橘色）', () => {
    writeSessionFile(31228, {
      pid: 31228,
      sessionId: SID,
      status: 'waiting',
      updatedAt: Date.now(),
    });
    expect(getSessionStatusRunState(SID)).toBe('waiting');
  });

  it('無 status 欄（舊式 session 檔）→ null（交給 JSONL fallback）', () => {
    writeSessionFile(16068, {
      pid: 16068,
      sessionId: SID,
      startedAt: Date.now(),
      // 無 status / updatedAt
    });
    expect(getSessionStatusRunState(SID)).toBeNull();
  });

  it('無相符 sessionId 的檔 → null', () => {
    writeSessionFile(31228, {
      pid: 31228,
      sessionId: 'some-other-session',
      status: 'busy',
      updatedAt: Date.now(),
    });
    expect(getSessionStatusRunState(SID)).toBeNull();
  });

  it('同 sessionId 多檔（殘留舊 PID）→ 取 updatedAt 最新者', () => {
    // 舊 PID 殘檔：idle（updatedAt 早）；現役檔：busy（updatedAt 晚）→ 取 busy。
    writeSessionFile(11111, {
      pid: 11111,
      sessionId: SID,
      status: 'idle',
      updatedAt: Date.now() - 60_000,
    });
    writeSessionFile(22222, {
      pid: 22222,
      sessionId: SID,
      status: 'busy',
      updatedAt: Date.now(),
    });
    expect(getSessionStatusRunState(SID)).toBe('running');
  });

  it('殘檔守門：唯一相符檔的 updatedAt 過舊（>5min）→ null（不採信死進程殘狀態）', () => {
    writeSessionFile(31228, {
      pid: 31228,
      sessionId: SID,
      status: 'busy',
      updatedAt: Date.now() - 10 * 60 * 1000, // 10 分鐘前
    });
    expect(getSessionStatusRunState(SID)).toBeNull();
  });

  it('目錄不存在 → null（不 throw）', () => {
    fs.rmSync(sessionsDir, { recursive: true, force: true });
    expect(getSessionStatusRunState(SID)).toBeNull();
  });

  it('壞 JSON 檔 → 略過不 throw', () => {
    fs.writeFileSync(path.join(sessionsDir, 'bad.json'), '{ not valid json', 'utf8');
    writeSessionFile(31228, {
      pid: 31228,
      sessionId: SID,
      status: 'busy',
      updatedAt: Date.now(),
    });
    expect(getSessionStatusRunState(SID)).toBe('running');
  });
});

// ---------------------------------------------------------------------------
// getJsonlFallbackRunState（無 status → JSONL 推斷）
// ---------------------------------------------------------------------------

describe('getJsonlFallbackRunState', () => {
  it('尾端有未回答的 AskUserQuestion → waiting', () => {
    const mainFile = path.join(projectFolder, `${SID}.jsonl`);
    writeJsonl(mainFile, [
      { timestamp: new Date(Date.now() - 120_000).toISOString(), message: { content: [] } },
      {
        timestamp: new Date(Date.now() - 60_000).toISOString(),
        message: {
          content: [
            { type: 'tool_use', name: 'AskUserQuestion', id: 'ask-123', input: {} },
          ],
        },
      },
      // 之後沒有 tool_use_id=ask-123 的 tool_result → 視為未回答。
    ]);
    expect(getJsonlFallbackRunState('/any/proj', new Set([SID]))).toBe('waiting');
  });

  it('AskUserQuestion 已有對應 tool_result → 不算 waiting；近期事件 → running', () => {
    const mainFile = path.join(projectFolder, `${SID}.jsonl`);
    writeJsonl(mainFile, [
      {
        timestamp: new Date(Date.now() - 20_000).toISOString(),
        message: {
          content: [
            { type: 'tool_use', name: 'AskUserQuestion', id: 'ask-123', input: {} },
          ],
        },
      },
      {
        timestamp: new Date(Date.now() - 5_000).toISOString(),
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'ask-123', content: 'answered' }],
        },
      },
    ]);
    expect(getJsonlFallbackRunState('/any/proj', new Set([SID]))).toBe('running');
  });

  it('無未回答 ask 且最後事件超過 90s → completed（曾有活動、現已靜止＝對話完成）', () => {
    const mainFile = path.join(projectFolder, `${SID}.jsonl`);
    writeJsonl(mainFile, [
      {
        timestamp: new Date(Date.now() - 120_000).toISOString(),
        message: { content: [{ type: 'text', text: 'done' }] },
      },
    ]);
    expect(getJsonlFallbackRunState('/any/proj', new Set([SID]))).toBe('completed');
  });

  it('subagent 對話的未回答 ask 也算 waiting（主對話無 ask）', () => {
    // 主對話：早期普通事件；subagent：未回答 ask。
    writeJsonl(path.join(projectFolder, `${SID}.jsonl`), [
      {
        timestamp: new Date(Date.now() - 90_000).toISOString(),
        message: { content: [{ type: 'text', text: 'x' }] },
      },
    ]);
    writeJsonl(path.join(projectFolder, SID, 'subagents', 'agent-abc.jsonl'), [
      {
        timestamp: new Date(Date.now() - 30_000).toISOString(),
        message: {
          content: [
            { type: 'tool_use', name: 'AskUserQuestion', id: 'sub-ask', input: {} },
          ],
        },
      },
    ]);
    expect(getJsonlFallbackRunState('/any/proj', new Set([SID]))).toBe('waiting');
  });

  it('專案資料夾找不到（findProjectFolder not-found）→ null', () => {
    mockedProjectFolder = { match: 'not-found', folder_path: '' };
    expect(getJsonlFallbackRunState('/any/proj', new Set([SID]))).toBeNull();
  });

  it('無任何可讀 JSONL → null（caller 再退回事件式判斷）', () => {
    // projectFolder 存在但沒有對應 <SID>.jsonl。
    expect(getJsonlFallbackRunState('/any/proj', new Set([SID]))).toBeNull();
  });
});

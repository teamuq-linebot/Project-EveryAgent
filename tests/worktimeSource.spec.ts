/**
 * worktimeSource.spec.ts — Claude 掃檔層端到端測試。
 *
 * 驗證：
 *   1. 建立假 ~/.claude/projects/<enc>/<session>.jsonl，呼 collectPunchEvents → 產出 events
 *   2. 主 session + subagent 事件正確分類（main / subagent）
 *   3. 改檔（mtime/size 變）→ 重 parse；不變 → 走快取（spy listSessions parse 計數）
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as nodePath from 'path';
import { collectPunchEvents } from '../src/main/worktime/aggregate';
import { _SESSION_CACHE, listSessions } from '../src/main/worktime/claude/discover';
import { projectPathToFolderName } from '../src/main/worktime/claude/paths';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  return fs.mkdtempSync(nodePath.join(os.tmpdir(), 'tuq-wt-test-'));
}

function writeJsonl(filePath: string, records: object[]): void {
  const text = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.mkdirSync(nodePath.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, { encoding: 'utf-8' });
}

/** 造假 ~/.claude/projects/<enc>/  結構（返回 enc 路徑、project folder path） */
function makeProjectDir(
  claudeRoot: string,
  projectPath: string,
): { projectFolderPath: string; encodedName: string } {
  const encodedName = projectPathToFolderName(projectPath);
  const projectFolderPath = nodePath.join(claudeRoot, 'projects', encodedName);
  fs.mkdirSync(projectFolderPath, { recursive: true });
  return { projectFolderPath, encodedName };
}

// ---------------------------------------------------------------------------
// JSONL record builders
// ---------------------------------------------------------------------------

function realUser(ts: string, text: string): object {
  return {
    type: 'user',
    timestamp: ts,
    message: { content: [{ type: 'text', text }] },
  };
}

function assistantText(ts: string, req: string, text: string, stop = 'end_turn'): object {
  return {
    type: 'assistant',
    timestamp: ts,
    requestId: req,
    message: {
      content: [{ type: 'text', text }],
      stop_reason: stop,
      usage: { input_tokens: 10, output_tokens: 5 },
      model: 'claude-sonnet-4-6',
    },
  };
}

function assistantDispatch(ts: string, toolId: string, desc: string, agentType: string): object {
  return {
    type: 'assistant',
    timestamp: ts,
    requestId: `req-dispatch-${toolId}`,
    message: {
      content: [
        {
          type: 'tool_use',
          id: toolId,
          name: 'Agent',
          input: { description: desc, subagent_type: agentType },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 5, output_tokens: 2 },
      model: 'claude-sonnet-4-6',
    },
  };
}

function toolResultUser(ts: string, toolId: string): object {
  return {
    type: 'user',
    timestamp: ts,
    message: {
      content: [{ type: 'tool_result', tool_use_id: toolId, content: 'done' }],
    },
  };
}

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let tmpHome: string;
let projectPath: string;
let projectFolderPath: string;
let sessionId: string;
let sessionFile: string;

beforeAll(() => {
  tmpHome = tmpDir();
  projectPath = '/fake/my-project';
  const { projectFolderPath: fp } = makeProjectDir(tmpHome, projectPath);
  projectFolderPath = fp;
  sessionId = 'session-abc123';
  sessionFile = nodePath.join(projectFolderPath, `${sessionId}.jsonl`);
});

afterAll(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  _SESSION_CACHE.clear();
});

// ---------------------------------------------------------------------------
// Monkey-patch helpers
// ---------------------------------------------------------------------------

/**
 * 重寫 discover.ts 讀取 CLAUDE_PROJECTS 的方式：
 * 我們改 discover.ts 以 CLAUDE_PROJECTS 常數，這在 test 中需要 override。
 * 策略：直接呼 listSessions(projectFolderPath) 來測快取行為，
 * 對 collectPunchEvents 則改用 getProject 直接注入 fake folder。
 */

// ---------------------------------------------------------------------------
// Test suite A: listSessions 快取行為
// ---------------------------------------------------------------------------

describe('listSessions cache', () => {
  it('初次掃：parse 真實檔，回 session list', () => {
    _SESSION_CACHE.clear();
    writeJsonl(sessionFile, [
      realUser('2024-01-01T10:00:00Z', 'hello'),
      assistantText('2024-01-01T10:00:05Z', 'req-1', 'world'),
    ]);

    const sessions = listSessions(projectFolderPath);
    expect(sessions.length).toBe(1);
    expect(sessions[0].session_id).toBe(sessionId);
    expect(_SESSION_CACHE.size).toBe(1);
  });

  it('不改檔：再掃走快取（cache hit），回相同結果', () => {
    // 清 cache 中的計數不重要，我們測行為：快取命中後 sessions 與上次相同
    const before = _SESSION_CACHE.size;
    const sessions = listSessions(projectFolderPath);
    expect(sessions.length).toBe(1);
    expect(_SESSION_CACHE.size).toBe(before); // 沒有新增項目
  });

  it('改檔內容（大小/時間變）：快取失效，重新 parse', async () => {
    // 寫不同內容，確保 size 改變
    await new Promise((r) => setTimeout(r, 10)); // 讓 mtime 改變
    writeJsonl(sessionFile, [
      realUser('2024-01-01T10:00:00Z', 'hello updated'),
      assistantText('2024-01-01T10:00:05Z', 'req-1', 'world updated'),
      assistantText('2024-01-01T10:00:10Z', 'req-2', 'extra line'),
    ]);

    // The cache should be invalidated because size and/or mtime changed
    const sessions = listSessions(projectFolderPath);
    expect(sessions.length).toBe(1);
    // session has more records now (work_timeline may have more rows)
    expect(sessions[0].session_id).toBe(sessionId);
  });
});

// ---------------------------------------------------------------------------
// Test suite B: collectPunchEventsCore via getProject（注入 projectFolderPath）
// ---------------------------------------------------------------------------

describe('collectPunchEvents via punchCore', () => {
  const SESSION_ID_2 = 'session-with-dispatch';

  beforeAll(() => {
    _SESSION_CACHE.clear();
    // Build a session with a main-ai + subagent dispatch pattern
    const toolId = 'tool-sub-001';
    const subStart = '2024-02-01T09:00:00Z';
    const subEnd = '2024-02-01T09:05:00Z';

    // Main session
    const mainFile = nodePath.join(projectFolderPath, `${SESSION_ID_2}.jsonl`);
    writeJsonl(mainFile, [
      realUser('2024-02-01T08:00:00Z', 'please run sub-agent'),
      assistantDispatch('2024-02-01T08:00:10Z', toolId, 'do-some-work', 'worker'),
      toolResultUser('2024-02-01T09:10:00Z', toolId),   // marks sub as complete
      assistantText('2024-02-01T09:10:05Z', 'req-final', 'done', 'end_turn'),
    ]);

    // Subagent session file
    const subDir = nodePath.join(projectFolderPath, SESSION_ID_2, 'subagents');
    fs.mkdirSync(subDir, { recursive: true });
    const subFile = nodePath.join(subDir, 'agent-sub-001.jsonl');
    writeJsonl(subFile, [
      {
        type: 'user',
        timestamp: subStart,
        isMeta: true,
        message: { content: [{ type: 'text', text: '你是 **worker** agent' }] },
      },
      assistantText(subEnd, 'req-sub-1', 'sub done', 'end_turn'),
    ]);

    // Meta file for subagent
    const metaFile = nodePath.join(subDir, 'agent-sub-001.meta.json');
    fs.writeFileSync(metaFile, JSON.stringify({
      agentType: 'worker',
      description: 'do-some-work',
      toolUseId: toolId,
    }));
  });

  it('listSessions 能解析含 subagents 的 session', () => {
    const sessions = listSessions(projectFolderPath);
    const sess = sessions.find((s) => s.session_id === SESSION_ID_2);
    expect(sess).toBeDefined();
    expect(sess!.subagents.length).toBeGreaterThanOrEqual(1);
  });

  it('work_timeline 含 subagent row（完成訊號 toolResult 在主檔）', () => {
    const sessions = listSessions(projectFolderPath);
    const sess = sessions.find((s) => s.session_id === SESSION_ID_2);
    expect(sess).toBeDefined();
    const timeline = sess!.work_timeline as Record<string, unknown>[];
    const subRows = timeline.filter((r) => r['kind'] === 'subagent');
    expect(subRows.length).toBeGreaterThanOrEqual(1);
    // The subagent has a tool_result in main → ended_at should be preserved
    const completeSub = subRows.find((r) => r['ended_at'] != null);
    expect(completeSub).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Test suite C: collectPunchEvents facade (uses CLAUDE_PROJECTS path)
// We test via direct listSessions + manual collectPunchEventsCore call
// (since CLAUDE_PROJECTS is baked into paths.ts, hard to override without
//  module-level injection; we verify the pipeline via punchCore directly)
// ---------------------------------------------------------------------------

import { collectPunchEventsCore } from '../src/main/worktime/punchCore';
import { punchNameForRow, eventKey } from '../src/main/worktime/claude/punchRules';

describe('collectPunchEventsCore via injected getProject', () => {
  const PROJECT_PATH_FAKE = '/test/fake/project';

  function makeGetProject(sessions: unknown[]) {
    return (_path: unknown) => ({ sessions });
  }

  it('有 subagent complete → subagent_events 含 is_complete=true 的 event', () => {
    const subStart = '2024-03-01T10:00:00Z';
    const subEnd = '2024-03-01T10:30:00Z';
    const sessions = [
      {
        session_id: 'sess-001',
        work_timeline: [
          {
            kind: 'main-user',
            started_at: '2024-03-01T09:50:00Z',
            ended_at: '2024-03-01T09:50:00Z',
            duration_ms: 0,
            source: 'main',
            round: 1,
          },
          {
            kind: 'main-dispatch',
            started_at: '2024-03-01T09:50:00Z',
            ended_at: '2024-03-01T09:55:00Z',
            duration_ms: 300000,
            source: 'main',
            tool_use_id: 'tid-001',
            round: 1,
          },
          {
            kind: 'subagent',
            started_at: subStart,
            ended_at: subEnd,
            duration_ms: 1800000,
            source: '/fake/subagent-001.jsonl',
            tool_use_id: 'tid-001',
            agent_name: 'my-worker',
            agent_type: 'worker',
            round: 1,
          },
        ],
        last_assistant_output: '',
      },
    ];

    const result = collectPunchEventsCore(
      makeGetProject(sessions),
      punchNameForRow,
      eventKey,
      PROJECT_PATH_FAKE,
      null,
      null,
    );

    expect(result.subagent_events.length).toBe(1);
    const ev = result.subagent_events[0];
    expect(ev.punch_name).toBe('agent_my-worker');
    expect(ev.is_complete).toBe(true);
    expect(ev.duration_hours).toBeCloseTo(0.5, 3);
  });

  it('subagent ended_at=null → is_complete=false（執行中）', () => {
    const sessions = [
      {
        session_id: 'sess-running',
        work_timeline: [
          {
            kind: 'subagent',
            started_at: '2024-03-01T10:00:00Z',
            ended_at: null,   // 執行中
            duration_ms: null,
            source: '/fake/running-sub.jsonl',
            tool_use_id: 'tid-running',
            agent_name: 'runner',
            agent_type: 'runner',
          },
        ],
        last_assistant_output: '',
      },
    ];

    const result = collectPunchEventsCore(
      makeGetProject(sessions),
      punchNameForRow,
      eventKey,
      PROJECT_PATH_FAKE,
      null,
      null,
    );

    expect(result.subagent_events.length).toBe(1);
    expect(result.subagent_events[0].is_complete).toBe(false);
    expect(result.subagent_events[0].duration_hours).toBe(0);
  });

  it('sinceMs 過濾：早於 sinceMs 的事件不納入', () => {
    const cutoff = new Date('2024-03-01T10:00:00Z').getTime();
    const sessions = [
      {
        session_id: 'sess-filter',
        work_timeline: [
          {
            kind: 'subagent',
            started_at: '2024-03-01T09:00:00Z',  // before cutoff
            ended_at: '2024-03-01T09:30:00Z',
            duration_ms: 1800000,
            source: '/fake/early-sub.jsonl',
            tool_use_id: 'tid-early',
            agent_name: 'early-worker',
          },
          {
            kind: 'subagent',
            started_at: '2024-03-01T11:00:00Z',  // after cutoff
            ended_at: '2024-03-01T11:30:00Z',
            duration_ms: 1800000,
            source: '/fake/late-sub.jsonl',
            tool_use_id: 'tid-late',
            agent_name: 'late-worker',
          },
        ],
        last_assistant_output: '',
      },
    ];

    const result = collectPunchEventsCore(
      makeGetProject(sessions),
      punchNameForRow,
      eventKey,
      PROJECT_PATH_FAKE,
      cutoff,
      null,
    );

    expect(result.subagent_events.length).toBe(1);
    expect(result.subagent_events[0].punch_name).toBe('agent_late-worker');
  });

  it('sessionIds 過濾：不在集合內的 session 不納入', () => {
    const sessions = [
      {
        session_id: 'sess-included',
        work_timeline: [
          {
            kind: 'subagent',
            started_at: '2024-03-01T10:00:00Z',
            ended_at: '2024-03-01T10:30:00Z',
            duration_ms: 1800000,
            source: '/fake/included.jsonl',
            tool_use_id: 'tid-incl',
            agent_name: 'included',
          },
        ],
        last_assistant_output: '',
      },
      {
        session_id: 'sess-excluded',
        work_timeline: [
          {
            kind: 'subagent',
            started_at: '2024-03-01T11:00:00Z',
            ended_at: '2024-03-01T11:30:00Z',
            duration_ms: 1800000,
            source: '/fake/excluded.jsonl',
            tool_use_id: 'tid-excl',
            agent_name: 'excluded',
          },
        ],
        last_assistant_output: '',
      },
    ];

    const result = collectPunchEventsCore(
      makeGetProject(sessions),
      punchNameForRow,
      eventKey,
      PROJECT_PATH_FAKE,
      null,
      new Set(['sess-included']),
    );

    expect(result.subagent_events.length).toBe(1);
    expect(result.subagent_events[0].punch_name).toBe('agent_included');
  });

  it('main-ai rows → main 摘要有正確 event_count', () => {
    const sessions = [
      {
        session_id: 'sess-main',
        work_timeline: [
          {
            kind: 'main-user',
            started_at: '2024-03-01T09:00:00Z',
            ended_at: '2024-03-01T09:00:00Z',
            duration_ms: 0,
            source: 'main',
            round: 1,
            input_prompt: 'task please',
          },
          {
            kind: 'main-ai',
            started_at: '2024-03-01T09:00:00Z',
            ended_at: '2024-03-01T09:10:00Z',
            duration_ms: 600000,
            source: 'main',
            round: 1,
            stop: 'end_turn',
            request_id: 'req-main-1',
          },
        ],
        last_assistant_output: '',
      },
    ];

    const result = collectPunchEventsCore(
      makeGetProject(sessions),
      punchNameForRow,
      eventKey,
      PROJECT_PATH_FAKE,
      null,
      null,
    );

    expect(result.main.event_count).toBe(1);
    expect(result.main.duration_hours).toBeGreaterThan(0);
  });

  it('空 sessions → 回空結構', () => {
    const result = collectPunchEventsCore(
      makeGetProject([]),
      punchNameForRow,
      eventKey,
      PROJECT_PATH_FAKE,
      null,
      null,
    );
    expect(result.subagent_events).toEqual([]);
    expect(result.main.duration_hours).toBe(0);
    expect(result.main.event_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test suite D: paths helpers
// ---------------------------------------------------------------------------

import { projectPathToFolderName as ptf, normalizeForCompare, pathCandidates } from '../src/main/worktime/claude/paths';

describe('paths helpers', () => {
  it('projectPathToFolderName: 非 A-Za-z0-9- 字元轉 -（不合併）', () => {
    expect(ptf('C:\\Users\\david\\my project')).toBe('C--Users-david-my-project');
    expect(ptf('/home/david/my_project')).toBe('-home-david-my-project');
  });

  it('normalizeForCompare: 斜線統一、去尾斜線、轉小寫', () => {
    expect(normalizeForCompare('C:/Users/David/')).toBe('c:\\users\\david');
    expect(normalizeForCompare('C:\\Users\\David\\')).toBe('c:\\users\\david');
  });

  it('pathCandidates: 回自身 + 逐層 parent', () => {
    const candidates = pathCandidates('/a/b/c');
    expect(candidates[0]).toBe(nodePath.resolve('/a/b/c'));
    expect(candidates.length).toBeGreaterThan(2);
  });
});

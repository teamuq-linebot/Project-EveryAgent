/**
 * sessions.ts — 工具啟動指令組裝（忠實移植自 Python teamuq/tools/sessions.py）。
 *
 * 只負責「依 tool + session 決定要在終端機打什麼指令」這段純邏輯：
 *   - buildLaunchCommand：resume 既有 / 新開帶 id / 全新；無資料退回工具預設或 customCommand。
 * I/O（列 session / 掃磁碟）不在此，由 backend 用 worktime.getProject 取得後傳入。
 */

// 新對話啟動指令（每工具）。對應 Python LAUNCH_NEW。
export const LAUNCH_NEW: Record<string, string> = {
  claude: 'claude',
  codex: 'codex',
  antigravity: 'agy',
  vscode: 'code .',
}

// resume 指令樣板（每工具）。無項目者無 resume，退回全新啟動。對應 Python RESUME_TMPL。
export const RESUME_TMPL: Record<string, string> = {
  claude: 'claude --resume {id}',
  codex: 'codex resume {id}',
}

// 「用呼叫端指定的 id 開新對話」樣板。只有 claude 支援 --session-id
// （該 id 同時成為其 JSONL 檔名）。對應 Python NEW_WITH_ID_TMPL。
export const NEW_WITH_ID_TMPL: Record<string, string> = {
  claude: 'claude --session-id {id}',
}

export type LaunchMode = 'resume' | 'new_id'

export interface LaunchPlan {
  command: string | null
  cwd: string
}

/**
 * 組裝工具啟動指令與工作目錄。回 { command, cwd }（cwd 一律 projectPath）。
 *
 * mode：
 *  - 'resume'（預設）：有 sessionId → 用 RESUME_TMPL resume；無 / 工具不支援 → 全新。
 *  - 'new_id'：有 sessionId → 用 NEW_WITH_ID_TMPL 開新對話（目前僅 claude
 *    `claude --session-id {id}`）；工具不支援或無 id → 退回全新。
 *
 * sessionId 為 null → 全新對話（LAUNCH_NEW[tool]）；未知工具用 customCommand；皆無 → command=null。
 * 對應 Python build_launch_command()。
 */
export function buildLaunchCommand(
  tool: string,
  projectPath: string,
  sessionId: string | null = null,
  customCommand: string | null = null,
  mode: LaunchMode = 'resume',
): LaunchPlan {
  const normalized = (tool || '').trim().toLowerCase()

  if (sessionId && mode === 'new_id') {
    const tmpl = NEW_WITH_ID_TMPL[normalized]
    if (tmpl) return { command: tmpl.replace('{id}', sessionId), cwd: projectPath }
    // 工具無法用指定 id 開新對話 → 退回全新啟動。
  } else if (sessionId) {
    const tmpl = RESUME_TMPL[normalized]
    if (tmpl) return { command: tmpl.replace('{id}', sessionId), cwd: projectPath }
    // 此工具無 resume → 退回全新啟動。
  }

  let command: string | null = LAUNCH_NEW[normalized] ?? null
  if (command === null) command = customCommand ?? null
  return { command, cwd: projectPath }
}

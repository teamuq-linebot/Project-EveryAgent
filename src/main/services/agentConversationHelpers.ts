/**
 * AgentConversationService 的 module-level 純函式 leaf。
 *
 * 從 agentConversationService.ts 原樣搬出（零邏輯改動）：與 class state / PTY 無關，
 * 僅依賴 fs / process / 字串運算。抽出以讓主檔降到 max-lines:500 以下。
 */

import * as fs from 'fs';

/** JSONL 內容簽名（mtime+size）——未變則不重解析、不重推。 */
export interface FileSig {
  mtimeMs: number;
  size: number;
}

/**
 * initial prompt 送出後，等待換行（Enter）的延遲毫秒數。
 * claude TUI 啟用 bracketed paste mode，長文需要更長時間才能完整貼入，
 * 故依字長線性放大；claude 最小 800ms、其餘 CLI 最小 150ms。
 */
export function initialPromptEnterDelayMs(prompt: string, cliId?: string): number {
  const scaledDelay = Math.ceil(prompt.length / 80) * 50;
  const minDelay = cliId === 'claude' || !cliId ? 800 : 150;
  return Math.max(minDelay, scaledDelay);
}

export function defaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC ?? 'cmd.exe';
  }
  return process.env.SHELL ?? '/bin/bash';
}

export function statSig(filePath: string): FileSig | null {
  try {
    const st = fs.statSync(filePath);
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
}

export function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function defaultLabel(initialPrompt: string | null): string {
  if (!initialPrompt) return 'AI 對話';
  const text = initialPrompt.replace(/^[/$][^\s]+\s*/, '').trim();
  return text ? text.slice(0, 40) : 'AI 對話';
}

/**
 * Claude 來源的路徑正規化與 projects/cowork/local-agent 根路徑常數。
 * 忠實移植自 Python teamuq/worktime/sources/claude/paths.py（行為一字不改）。
 * 純 Node.js stdlib（os / path）。leaf 模組：不 import 本來源其他模組。
 */

import * as os from 'os';
import * as nodePath from 'path';

/** ~/.claude/projects */
export const CLAUDE_PROJECTS = nodePath.join(os.homedir(), '.claude', 'projects');

/** ~/AppData/Roaming/Claude/claude-code-sessions（cowork）*/
export const CLAUDE_COWORK_SESSIONS = nodePath.join(
  os.homedir(),
  'AppData',
  'Roaming',
  'Claude',
  'claude-code-sessions',
);

/** ~/AppData/Roaming/Claude/local-agent-mode-sessions */
export const CLAUDE_LOCAL_AGENT_SESSIONS = nodePath.join(
  os.homedir(),
  'AppData',
  'Roaming',
  'Claude',
  'local-agent-mode-sessions',
);

const _NON_FOLDER_CHAR_RE = /[^A-Za-z0-9-]/g;

/**
 * 對齊 projectPathToFolderName：非 A-Za-z0-9- 字元全轉 '-'，不合併。
 * 對應 Python project_path_to_folder_name()。
 */
export function projectPathToFolderName(projectPath: string): string {
  return projectPath.trim().replace(_NON_FOLDER_CHAR_RE, '-');
}

/**
 * 對齊 normalizeForCompare：斜線統一成 \、去尾斜線、轉小寫。
 * 對應 Python normalize_for_compare()。
 */
export function normalizeForCompare(value: string): string {
  let v = value.replace(/[\\/]+/g, '\\');
  v = v.replace(/\\+$/, '');
  return v.toLowerCase();
}

/**
 * 對齊 pathCandidates：自身 + 逐層 parent。
 * 對應 Python path_candidates()。
 */
export function pathCandidates(projectPath: string): string[] {
  const candidates: string[] = [];
  let current = nodePath.resolve(projectPath);
  while (true) {
    candidates.push(current);
    const parent = nodePath.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return candidates;
}

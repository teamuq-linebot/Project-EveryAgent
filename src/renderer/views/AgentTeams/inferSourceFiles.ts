/**
 * inferSourceFiles.ts — introduction 欄位 ↔ 原始檔對應（硬編碼）
 * 設計來源：docs/design/agentteams-edit-flow.md §4.6、§8.2
 *
 * fieldLabel：白話欄位名稱，可直接顯示於 UI（Persona Gate §5）。
 * fileHint：原始檔提示，**僅供技術摺疊區與 /tuq-agent context**，
 *           禁止出現在一般 UI 文案（檔名/欄位 key 不可穿透）。
 */

// ---------------------------------------------------------------------------
// 型別定義
// ---------------------------------------------------------------------------

/** 欄位受影響描述。 */
export interface SourceFileHint {
  /** 白話欄位名稱（如「能力描述」），可直接顯示於 UI。 */
  fieldLabel: string
  /** 對應原始檔提示（如「soul.md 的 Principles 段落」），僅供技術摺疊區用。 */
  fileHint: string
}

// ---------------------------------------------------------------------------
// 對應表（§4.6 / §8.2 硬編碼）
// ---------------------------------------------------------------------------

const FIELD_SOURCE_MAP: Record<string, SourceFileHint> = {
  summary: { fieldLabel: '一句話介紹', fileHint: 'soul.md 的 Identity 段落' },
  capabilities: { fieldLabel: '能力描述', fileHint: 'soul.md 的 Principles 段落' },
  when_to_use: { fieldLabel: '適用時機', fileHint: 'agent.yaml 的 dispatch.trigger' },
  not_for: { fieldLabel: '不適用情境', fileHint: 'agent.yaml 的 dispatch.not_for' },
  inputs: { fieldLabel: '接收的內容', fileHint: 'soul.md 的 Identity / Anti-patterns 段落' },
  outputs: { fieldLabel: '交付的成果', fileHint: 'soul.md 的 Identity / Anti-patterns 段落' },
  workflows: { fieldLabel: '工作流程', fileHint: 'workflow.yaml 的 steps' },
  manages: { fieldLabel: '帶領的成員', fileHint: 'agent.yaml 的團隊結構（reports_to 對應）' },
  callable_by: { fieldLabel: '可以找他的人', fileHint: 'agent.yaml 的團隊結構（reports_to 對應）' },
  flags: { fieldLabel: '特殊標記', fileHint: 'introduction.json 本身（無上游原始檔）' },
}

/** 未知欄位的 fallback（不拋錯，回傳泛用描述）。 */
const FALLBACK_HINT: SourceFileHint = {
  fieldLabel: '其他設定',
  fileHint: 'introduction.json 本身（無上游原始檔）',
}

// ---------------------------------------------------------------------------
// 主函式
// ---------------------------------------------------------------------------

/**
 * inferSourceFiles — 依 introduction.json 欄位名回傳白話受影響描述。
 * 對應表外的欄位回傳 FALLBACK_HINT。
 */
export function inferSourceFiles(fieldName: string): SourceFileHint {
  return FIELD_SOURCE_MAP[fieldName] ?? FALLBACK_HINT
}

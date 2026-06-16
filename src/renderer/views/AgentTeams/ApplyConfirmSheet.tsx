/**
 * ApplyConfirmSheet — 套用確認面板
 * Persona Gate M1：不顯示檔名/欄位key/指令名
 * Persona Gate M7：失敗安全保證說明（套用前自動備份）
 */
import React from 'react'
import type { FieldDiff } from './introDiff'
import { inferSourceFiles } from './inferSourceFiles'

interface Props {
  diffs: FieldDiff[]
  onConfirm: () => void
  onCancel: () => void
}

export function ApplyConfirmSheet({ diffs, onConfirm, onCancel }: Props): React.JSX.Element {
  return (
    <div className="at-apply-confirm">
      <div className="at-apply-confirm__header">
        <h4 className="at-apply-confirm__title">確認套用這些修改嗎？</h4>
        <p className="at-apply-confirm__subtitle">
          套用後，AI 會依照以下內容更新助手的設定。在開始之前，系統會自動備份，如果出問題可以復原。
        </p>
      </div>

      <ul className="at-apply-confirm__list">
        {diffs.map((diff, idx) => (
          <li key={idx} className="at-apply-confirm__item">
            {plainSummary(diff)}
          </li>
        ))}
      </ul>

      <p className="at-apply-confirm__safety-note">
        套用通常需要 10～30 秒。如果沒有成功，助手的設定不會改變，你可以再試一次。
      </p>

      <div className="at-apply-confirm__actions">
        <button type="button" className="at-apply-confirm__btn at-apply-confirm__btn--confirm" onClick={onConfirm}>
          確認套用
        </button>
        <button type="button" className="at-apply-confirm__btn at-apply-confirm__btn--cancel" onClick={onCancel}>
          取消，再看看
        </button>
      </div>
    </div>
  )
}

function plainSummary(diff: FieldDiff): string {
  const { fieldLabel } = inferSourceFiles(diff.field)
  const before = diff.before === undefined ? '' : (Array.isArray(diff.before) ? diff.before.join('、') : diff.before)
  const after = diff.after === undefined ? '' : (Array.isArray(diff.after) ? diff.after.join('、') : diff.after)

  switch (diff.kind) {
    case 'string_changed':
      return `「${fieldLabel}」從「${truncate(before)}」改為「${truncate(after)}」`
    case 'array_item_changed':
      return `「${fieldLabel}」中的「${truncate(before)}」改為「${truncate(after)}」`
    case 'array_item_added':
      return `「${fieldLabel}」新增：「${truncate(after)}」`
    case 'array_item_removed':
      return `「${fieldLabel}」移除：「${truncate(before)}」`
    case 'workflow_scenario_changed':
      if (!diff.before) return `「${fieldLabel}」新增工作情境：「${diff.scenario ?? ''}」`
      if (!diff.after) return `「${fieldLabel}」移除工作情境：「${diff.scenario ?? ''}」`
      return `「${fieldLabel}」情境「${diff.scenario ?? ''}」的步驟已修改`
  }
}

function truncate(s: string, max = 40): string {
  return s.length > max ? s.slice(0, max) + '…' : s
}

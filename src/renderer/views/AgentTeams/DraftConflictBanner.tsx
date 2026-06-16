/**
 * DraftConflictBanner — 草稿衝突警示條（M6：三選一附後果說明）
 * 觸發時機：_base_hash ≠ sha256(當前 introduction.json)
 * Persona Gate M6：每個選項附後果說明
 */
import React from 'react'

interface Props {
  onUseMine: () => void   // 使用我的草稿（覆蓋最新版本）
  onUseLatest: () => void // 使用最新版本（草稿丟失）
  onIgnore: () => void    // 先不動（保留草稿等決定）
}

export function DraftConflictBanner({ onUseMine, onUseLatest, onIgnore }: Props): React.JSX.Element {
  return (
    <div className="at-draft-conflict" role="alert">
      <div className="at-draft-conflict__header">
        <span className="at-draft-conflict__icon">⚠️</span>
        <span className="at-draft-conflict__title">這份草稿的基礎已過期</span>
      </div>
      <p className="at-draft-conflict__desc">
        這位助手的介紹在你編輯草稿後已被更新，請選擇如何處理：
      </p>
      <div className="at-draft-conflict__choices">
        <button type="button" className="at-draft-conflict__btn at-draft-conflict__btn--mine" onClick={onUseMine}>
          <span className="at-draft-conflict__btn-title">使用我的草稿</span>
          <span className="at-draft-conflict__btn-consequence">會覆蓋剛才更新的版本</span>
        </button>
        <button type="button" className="at-draft-conflict__btn at-draft-conflict__btn--latest" onClick={onUseLatest}>
          <span className="at-draft-conflict__btn-title">使用最新版本</span>
          <span className="at-draft-conflict__btn-consequence">我的草稿修改將遺失</span>
        </button>
        <button type="button" className="at-draft-conflict__btn at-draft-conflict__btn--ignore" onClick={onIgnore}>
          <span className="at-draft-conflict__btn-title">先不動</span>
          <span className="at-draft-conflict__btn-consequence">保留草稿，等我決定</span>
        </button>
      </div>
    </div>
  )
}

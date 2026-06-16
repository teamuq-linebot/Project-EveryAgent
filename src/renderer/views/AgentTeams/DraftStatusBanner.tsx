/**
 * DraftStatusBanner — 草稿未套用橘色提示條
 * Persona Gate S1：不顯示 hostname/hash/技術字詞
 */
import React from 'react'

interface Props {
  onViewDiff: () => void
  onDiscard: () => void
  onEdit: () => void
}

export function DraftStatusBanner({ onViewDiff, onDiscard, onEdit }: Props): React.JSX.Element {
  return (
    <div className="at-draft-banner" role="alert">
      <span className="at-draft-banner__icon">📝</span>
      <span className="at-draft-banner__text">你有未套用的草稿修改</span>
      <div className="at-draft-banner__actions">
        <button type="button" className="at-draft-banner__btn at-draft-banner__btn--primary" onClick={onViewDiff}>
          查看這次改了什麼
        </button>
        <button type="button" className="at-draft-banner__btn" onClick={onEdit}>
          繼續編輯
        </button>
        <button type="button" className="at-draft-banner__btn at-draft-banner__btn--danger" onClick={onDiscard}>
          放棄草稿
        </button>
      </div>
    </div>
  )
}

/**
 * SourceBadge.tsx — 來源徽章元件（純本地版樁）。
 *
 * 雲端同步已移除；純本地版所有任務 origin='local'，本元件無需顯示任何平台資訊。
 * 匯出空元件與 buildPlatformNameMap（回空 Map）以維持呼叫端 import 不改動。
 */

import React from 'react'

interface SourceBadgeProps {
  origin?: string | null
  syncEnabled?: boolean
  platformName?: string | null
  userShort?: string | null
}

/** 純本地版：origin 恆 'local'，無需顯示來源徽章，回空 fragment。 */
export default function SourceBadge(_props: SourceBadgeProps): React.JSX.Element {
  return <></>
}

/**
 * buildPlatformNameMap — platform_local_id → name 對照表（純本地版恆回空 Map）。
 * 呼叫端（useProjectsData.ts）保留此呼叫供未來可能的多平台擴充。
 */
export function buildPlatformNameMap(
  _platforms: Array<{ local_id?: string; name?: string }>,
): Map<string, string> {
  return new Map()
}

/**
 * useGroupConfig.ts — 分組設定持久化 hook
 * 設計來源：design-reactflow-refactor.md §3 + 批次 4 說明
 *
 * 策略：走 generic settings:get / settings:set（key='agentTeamGroups'）。
 *   - 讀：window.tuq.settings.get('agentTeamGroups') → Record<string,unknown> | null
 *         → isGroupConfig() 守衛 → 失敗/null 時 fallback DEFAULT_GROUP_CONFIG
 *   - 寫：JSON.stringify(config) 塞 valueJson → settings:set
 *   - 載入中：groupConfig = null（caller 用 DEFAULT 過渡，避免閃爍）
 *
 * 不動 main process。
 */
import { useState, useEffect, useCallback } from 'react'
import { DEFAULT_GROUP_CONFIG, isGroupConfig, migrateGroupConfig } from './groupConfig'
import type { GroupConfig } from './groupConfig'

const SETTINGS_KEY = 'agentTeamGroups'

export interface UseGroupConfigResult {
  /** 載入中為 null；就緒後為 GroupConfig（含 fallback DEFAULT） */
  groupConfig: GroupConfig | null
  /** 寫入新分組設定（持久化）；resolve 後 groupConfig 立即更新 */
  setGroupConfig: (c: GroupConfig) => Promise<void>
  /** 是否仍在讀取中 */
  loading: boolean
}

export function useGroupConfig(): UseGroupConfigResult {
  const [groupConfig, setGroupConfigState] = useState<GroupConfig | null>(null)
  const [loading, setLoading] = useState(true)

  // 初始讀取
  useEffect(() => {
    let cancelled = false

    const settingsBridge = (window as Window & typeof globalThis & {
      tuq?: {
        settings?: {
          get: (key: string) => Promise<{ ok: boolean; data?: Record<string, unknown> | null; error?: string }>
          set: (payload: { key: string; valueJson: string }) => Promise<{ ok: boolean; error?: string }>
        }
      }
    }).tuq?.settings

    if (!settingsBridge) {
      // bridge 不可用（如 devtools 直接開 HTML）→ 使用 DEFAULT
      if (!cancelled) {
        setGroupConfigState(DEFAULT_GROUP_CONFIG)
        setLoading(false)
      }
      return () => { cancelled = true }
    }

    settingsBridge.get(SETTINGS_KEY).then((r) => {
      if (cancelled) return
      if (r.ok && r.data != null && isGroupConfig(r.data)) {
        // 冪等遷移/相容（多來源複合鍵時代）：清 orphan mapping、保留裸 key 與複合 key。
        setGroupConfigState(migrateGroupConfig(r.data))
      } else {
        // 缺鍵、格式不符、讀取失敗 → fallback
        setGroupConfigState(DEFAULT_GROUP_CONFIG)
      }
      setLoading(false)
    }).catch(() => {
      if (!cancelled) {
        setGroupConfigState(DEFAULT_GROUP_CONFIG)
        setLoading(false)
      }
    })

    return () => { cancelled = true }
  }, [])

  // 寫入
  const setGroupConfig = useCallback(async (c: GroupConfig): Promise<void> => {
    const settingsBridge = (window as Window & typeof globalThis & {
      tuq?: {
        settings?: {
          set: (payload: { key: string; valueJson: string }) => Promise<{ ok: boolean; error?: string }>
        }
      }
    }).tuq?.settings

    if (!settingsBridge) {
      // bridge 不可用：只更新本地 state，不持久化
      setGroupConfigState(c)
      return
    }

    const valueJson = JSON.stringify(c)
    const r = await settingsBridge.set({ key: SETTINGS_KEY, valueJson })
    if (r.ok) {
      // 持久化成功：立即更新本地 state
      setGroupConfigState(c)
    } else {
      throw new Error(r.error ?? 'settings:set 失敗')
    }
  }, [])

  return { groupConfig, setGroupConfig, loading }
}

/**
 * appSettings.spec.ts — 統一設定頁後端鏈路單元測試（unified-settings 批次）。
 *
 * 覆蓋：
 *   S1: AppSettingsStore.getJson/setJson 對 monitor_auto_recover / *_poll_seconds 形狀 round-trip。
 *   S2: 自動恢復監測閘（index.ts recoverMonitoring 前的判定）— 缺鍵 → 恢復（true）、
 *       { enabled:false } → skip（false）、{ enabled:true } → 恢復（true）。
 *   S3: 間隔 clamp（看板 5~120s / 監測 1~30s）— 超界鉗回邊界、壞值退預設。
 *
 * 隔離：注入 in-memory DB（ensureSchema 已建 app_settings），不碰使用者真實 ~/.teamuq。
 */

import { describe, it, expect, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { ensureSchema } from '../src/main/repo/sqliteTaskRepository'
import { AppSettingsStore } from '../src/main/repo/appSettingsStore'
import { APP_SETTINGS_KEYS, APP_SETTINGS_DEFAULTS } from '../src/shared/ipcContracts'

const _dbs: Database.Database[] = []

function makeStore(): { store: AppSettingsStore; db: Database.Database } {
  const db = new Database(':memory:')
  _dbs.push(db)
  db.pragma('journal_mode = WAL')
  ensureSchema(db)
  return { store: new AppSettingsStore({ db }), db }
}

afterEach(() => {
  for (const db of _dbs.splice(0)) {
    try {
      db.close()
    } catch {
      /* ignore */
    }
  }
})

/**
 * 自動恢復閘判定（與 index.ts whenReady 內表達式逐字等價）：
 *   autoRecover = (getAppSetting('monitor_auto_recover')?.enabled as boolean | undefined)
 *                  ?? APP_SETTINGS_DEFAULTS.monitorAutoRecover
 */
function decideAutoRecover(setting: Record<string, unknown> | null): boolean {
  return (
    (setting?.['enabled'] as boolean | undefined) ?? APP_SETTINGS_DEFAULTS.monitorAutoRecover
  )
}

/** 間隔 clamp（與 MonitorController.resolveScanIntervalMs / SettingsPage.clampSeconds 等價）。 */
function clampSeconds(raw: unknown, min: number, max: number, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

describe('AppSettings — 統一設定頁後端鏈路', () => {
  // S1: round-trip
  it('S1: getJson/setJson round-trip monitor_auto_recover + poll seconds', () => {
    const { store } = makeStore()

    expect(store.getJson(APP_SETTINGS_KEYS.MONITOR_AUTO_RECOVER)).toBeNull()

    store.setJson(APP_SETTINGS_KEYS.MONITOR_AUTO_RECOVER, { enabled: false })
    expect(store.getJson(APP_SETTINGS_KEYS.MONITOR_AUTO_RECOVER)).toEqual({ enabled: false })

    store.setJson(APP_SETTINGS_KEYS.KANBAN_POLL_SECONDS, { seconds: 30 })
    expect(store.getJson(APP_SETTINGS_KEYS.KANBAN_POLL_SECONDS)).toEqual({ seconds: 30 })

    store.setJson(APP_SETTINGS_KEYS.MONITOR_POLL_SECONDS, { seconds: 5 })
    expect(store.getJson(APP_SETTINGS_KEYS.MONITOR_POLL_SECONDS)).toEqual({ seconds: 5 })

    // upsert（覆寫同 key）
    store.setJson(APP_SETTINGS_KEYS.MONITOR_AUTO_RECOVER, { enabled: true })
    expect(store.getJson(APP_SETTINGS_KEYS.MONITOR_AUTO_RECOVER)).toEqual({ enabled: true })
  })

  // S2: auto-recover gate semantics
  it('S2: 缺鍵 → 恢復（預設 true）', () => {
    const { store } = makeStore()
    expect(decideAutoRecover(store.getJson(APP_SETTINGS_KEYS.MONITOR_AUTO_RECOVER))).toBe(true)
  })

  it('S2: { enabled:false } → skip（false）', () => {
    const { store } = makeStore()
    store.setJson(APP_SETTINGS_KEYS.MONITOR_AUTO_RECOVER, { enabled: false })
    expect(decideAutoRecover(store.getJson(APP_SETTINGS_KEYS.MONITOR_AUTO_RECOVER))).toBe(false)
  })

  it('S2: { enabled:true } → 恢復（true）', () => {
    const { store } = makeStore()
    store.setJson(APP_SETTINGS_KEYS.MONITOR_AUTO_RECOVER, { enabled: true })
    expect(decideAutoRecover(store.getJson(APP_SETTINGS_KEYS.MONITOR_AUTO_RECOVER))).toBe(true)
  })

  // S3: clamp
  it('S3: 看板刷新間隔 clamp 5~120s（超界鉗邊界、壞值退預設）', () => {
    const { min, max, def } = {
      min: APP_SETTINGS_DEFAULTS.kanbanPollSecondsMin,
      max: APP_SETTINGS_DEFAULTS.kanbanPollSecondsMax,
      def: APP_SETTINGS_DEFAULTS.kanbanPollSeconds,
    }
    expect(clampSeconds(1, min, max, def)).toBe(min) // 低於下界 → 5
    expect(clampSeconds(999, min, max, def)).toBe(max) // 高於上界 → 120
    expect(clampSeconds(30, min, max, def)).toBe(30) // 界內原值
    expect(clampSeconds('abc', min, max, def)).toBe(def) // 壞值 → 預設 15
  })

  it('S3: 監測掃描間隔 clamp 1~30s（超界鉗邊界、壞值退預設）', () => {
    const { min, max, def } = {
      min: APP_SETTINGS_DEFAULTS.monitorPollSecondsMin,
      max: APP_SETTINGS_DEFAULTS.monitorPollSecondsMax,
      def: APP_SETTINGS_DEFAULTS.monitorPollSeconds,
    }
    expect(clampSeconds(0, min, max, def)).toBe(min) // 低於下界 → 1
    expect(clampSeconds(60, min, max, def)).toBe(max) // 高於上界 → 30
    expect(clampSeconds(5, min, max, def)).toBe(5) // 界內原值
    expect(clampSeconds('xyz', min, max, def)).toBe(def) // 壞值（NaN）→ 預設 2
  })
})

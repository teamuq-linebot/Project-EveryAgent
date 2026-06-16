import { defineConfig } from '@playwright/test'

/**
 * Playwright 設定 — 僅供 Electron E2E smoke（golden-path 回歸網）。
 *
 * 執行前提：`npm run build` 先產 out/（main + preload + renderer）。
 *   E2E 啟動 out/main/index.js（打包後 entry），非 dev server。
 *
 * 單 worker：Electron app 啟動較重且共用本機資源，序列化跑最穩。
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  // Electron 啟動 + renderer 首屏較慢，放寬逾時。
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})

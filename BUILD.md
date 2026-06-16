# TeamUQ Electron — Build / Sign / Notarize / Release Guide

## 快速開始（未簽章，煙霧測試）

```bash
# 安裝依賴（含 native module rebuild）
npm install

# 僅編譯 TypeScript（不打包）
npm run build

# 產出未簽章目錄包（electron-builder --dir）
# 產物在 dist/<platform>-unpacked/
npm run build:unpack
```

---

## 平台分別打包

| 指令 | 產物 |
|------|------|
| `npm run build:mac` | `dist/TeamUQ-*.dmg` + `dist/TeamUQ-*-mac.zip` |
| `npm run build:win` | `dist/TeamUQ-*-Setup.exe` (NSIS) |
| `npm run build:linux` | `dist/TeamUQ-*.AppImage` |
| `npm run build:dist` | 當前平台的正式包 |

> 跨平台交叉編譯（如在 macOS 上出 win32 包）需要 Docker / CI；本地只能出當前平台。

---

## 必要環境變數

### macOS 簽章 + 公證

| 變數 | 說明 |
|------|------|
| `CSC_LINK` | Developer ID Application .p12 憑證路徑或 Base64 |
| `CSC_KEY_PASSWORD` | .p12 憑證密碼 |
| `APPLE_ID` | Apple 帳號 email（公證用） |
| `APPLE_APP_SPECIFIC_PASSWORD` | App 專屬密碼（appleid.apple.com 產生） |
| `APPLE_TEAM_ID` | Apple 開發者 Team ID（10 碼英數） |

**無憑證時跳過簽章：**

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:mac
```

### Windows 簽章

| 變數 | 說明 |
|------|------|
| `CSC_LINK` | 程式碼簽章 .p12 / .pfx 憑證路徑或 Base64 |
| `CSC_KEY_PASSWORD` | 憑證密碼 |

**無憑證時跳過：** electron-builder 偵測不到憑證會自動略過，不需額外設定。

### GitHub Releases 發佈

| 變數 | 說明 |
|------|------|
| `GH_TOKEN` | GitHub Personal Access Token（repo write 權限） |

---

## macOS 公證流程（Notarize）

electron-builder v24 支援內建公證，在 `electron-builder.yml` 的 `mac` 區塊加上：

```yaml
mac:
  notarize:
    teamId: "${APPLE_TEAM_ID}"
```

或使用 `afterSign` hook 搭配 `@electron/notarize`：

```js
// build/afterSign.js
const { notarize } = require('@electron/notarize')
exports.default = async (context) => {
  if (process.platform !== 'darwin') return
  if (!process.env.APPLE_ID) return   // env gate
  await notarize({
    tool: 'notarytool',
    appBundleId: 'tw.tuq.teamuq',
    appPath: context.appOutDir + '/TeamUQ.app',
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  })
}
```

---

## 自動更新（electron-updater）

- `src/main/updater.ts` 封裝 `autoUpdater`，只在 `app.isPackaged === true` 且非 dev server 時啟動。
- publish 設定在 `electron-builder.yml`（`provider: github`）。
- 發佈新版本：`npm version patch && npm run build:dist`，electron-builder 會將 `latest.yml` 和安裝包推送到 GitHub Releases。

---

## CI/CD 建議（GitHub Actions）

```yaml
# .github/workflows/release.yml（範例）
on:
  push:
    tags: ['v*']
jobs:
  release:
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run build:dist
        env:
          GH_TOKEN: ${{ secrets.GH_TOKEN }}
          CSC_LINK: ${{ secrets.CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

---

## native module 說明（asarUnpack）

`better-sqlite3` 和 `node-pty` 包含 `.node` 二進位，不能封進 asar 壓縮包，
已在 `electron-builder.yml` 的 `asarUnpack` 設定解包路徑：

```yaml
asarUnpack:
  - "**/*.node"
  - "node_modules/better-sqlite3/**"
  - "node_modules/node-pty/**"
```

打包後路徑為 `resources/app.asar.unpacked/node_modules/{better-sqlite3,node-pty}/`，
Electron 的 `__non_webpack_require__` / `require` 會自動對應。

---

## ⚠️ native module 雙 ABI：測試 vs 打包（重要）

`better-sqlite3` / `node-pty` 是原生模組，需對「執行它的 runtime」的 ABI 編譯，而
**vitest（系統 Node）與 Electron 的 ABI 不同**，故兩種情境要用不同的 build：

| 情境 | 指令 | 結果 |
|------|------|------|
| **跑測試**（vitest 在系統 Node） | `npm rebuild better-sqlite3` | 重編成 Node ABI → `npx vitest run` 全綠（257） |
| **跑/打包 app**（Electron） | `npx electron-builder install-app-deps`（`npm install` 的 postinstall 已自動跑） | 重編成 Electron ABI → `npm run dev` / `build:unpack` 可載入 |

症狀：若 `npx vitest run` 出現 `NODE_MODULE_VERSION 127 vs 125`（或類似）→ better-sqlite3 目前是 Electron ABI，
跑 `npm rebuild better-sqlite3` 切回 Node ABI 即可。反之 `npm run dev` 載 better-sqlite3 失敗 → 跑 `npx electron-builder install-app-deps` 切回 Electron ABI。

> CI 建議：測試 job 與打包 job 分開（測試前 `npm rebuild better-sqlite3`；打包前 `electron-builder install-app-deps`，build:* 已含）。

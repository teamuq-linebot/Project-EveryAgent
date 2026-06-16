// ---------------------------------------------------------------------------
// CLI Registry — AI CLI 後端偵測共享資料層
// 本檔定義 3 個 CLI（claude / codex / antigravity）的描述子常數。
// 下游 service 批次補 loginVerify 欄位資料；本批各筆不填 loginVerify。
// ---------------------------------------------------------------------------

export type CliId = 'claude' | 'codex' | 'antigravity'
export type CliPlatform = 'win' | 'mac' | 'linux'

export interface CliLoginVerify {
  /** 段二深驗：跑這個指令（非互動、需 timeout）；輸出比對下列 pattern。 */
  args: string[]
  timeoutMs: number
  /** 輸出含任一 → 視為未登入/失敗。 */
  failurePatterns: string[]
  /** 輸出含任一 → 視為已登入（可選；無則「無 failurePattern 命中」即視為成功）。 */
  successPatterns?: string[]
}

export interface CliDescriptor {
  id: CliId
  name: string                                    // 顯示名
  bin: string                                     // claude | codex | agy
  versionArgs: string[]                           // ['--version']
  /** PATH 找不到時額外檢查的已知安裝路徑（用 placeholder：~ / %LOCALAPPDATA% / %APPDATA% / %USERPROFILE%）。 */
  knownPaths: Partial<Record<CliPlatform, string[]>>
  /** 段一 login 探測：credential 檔路徑（存在=曾登入）。keyring 型留空陣列。 */
  credentialFiles: Partial<Record<CliPlatform, string[]>>
  /** 段二深驗設定（本批先不填資料，留 undefined）。 */
  loginVerify?: CliLoginVerify
  /** 一鍵安裝指令（依平台；renderer 會丟進終端機跑）。 */
  install: Partial<Record<CliPlatform, string>> & { note?: string }
  /** 一鍵登入：終端機要跑的指令 + 說明。 */
  login: { command: string; note?: string }
}

export const CLI_DESCRIPTORS: CliDescriptor[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    bin: 'claude',
    versionArgs: ['--version'],
    knownPaths: {
      win: ['%USERPROFILE%/.local/bin/claude.exe', '%APPDATA%/npm/claude.cmd'],
      mac: ['/opt/homebrew/bin/claude', '/usr/local/bin/claude', '~/.local/bin/claude'],
      linux: ['~/.local/bin/claude', '/usr/local/bin/claude'],
    },
    credentialFiles: {
      win: ['~/.claude/.credentials.json'],
      linux: ['~/.claude/.credentials.json'],
      mac: [], // mac 走 Keychain，無檔
    },
    // loginVerify: 留 undefined，待後續 service 批次補
    install: {
      win: 'irm https://claude.ai/install.ps1 | iex',
      mac: 'curl -fsSL https://claude.ai/install.sh | bash',
      linux: 'curl -fsSL https://claude.ai/install.sh | bash',
      note: '官方原生安裝器，免 Node；安裝後會在背景自動更新',
    },
    login: {
      command: 'claude',
      note: '啟動後輸入 /login 完成瀏覽器 OAuth',
    },
  },
  {
    id: 'codex',
    name: 'Codex',
    bin: 'codex',
    versionArgs: ['--version'],
    knownPaths: {
      // TODO: codex 原生安裝在 Windows 的落點官方未明列，待本機實測確認後修正
      win: ['%USERPROFILE%/.codex/bin/codex.exe', '%APPDATA%/npm/codex.cmd'],
      mac: ['/opt/homebrew/bin/codex', '/usr/local/bin/codex'],
      linux: ['~/.local/bin/codex', '/usr/local/bin/codex'],
    },
    credentialFiles: {
      win: ['~/.codex/auth.json'],
      mac: ['~/.codex/auth.json'],
      linux: ['~/.codex/auth.json'],
    },
    // loginVerify: 留 undefined，待後續 service 批次補
    install: {
      win: 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"',
      mac: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
      linux: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
      note: 'Rust 原生安裝，免 Node（亦可 brew install --cask codex）',
    },
    login: {
      command: 'codex login',
      note: '瀏覽器 OAuth；亦可用 API key',
    },
  },
  {
    id: 'antigravity',
    name: 'Gemini',
    bin: 'agy',
    versionArgs: ['--version'],
    knownPaths: {
      win: ['%LOCALAPPDATA%/agy/bin/agy.exe', '%LOCALAPPDATA%/agy/bin/agy.cmd', '%LOCALAPPDATA%/Antigravity/agy.exe'],
      mac: ['~/.local/bin/agy'],
      linux: ['~/.local/bin/agy'],
    },
    // agy 是 Gemini 生態 CLI，OAuth 憑證寫在 ~/.gemini/oauth_creds.json（跨平台皆在 home 下，
    // 非系統 keyring）；存在即曾登入。搭配 ~/.gemini/google_accounts.json 的 active 為登入帳號。
    credentialFiles: {
      win: ['~/.gemini/oauth_creds.json'],
      mac: ['~/.gemini/oauth_creds.json'],
      linux: ['~/.gemini/oauth_creds.json'],
    },
    // loginVerify: 留 undefined，待後續 service 批次補
    install: {
      win: 'irm https://antigravity.google/cli/install.ps1 | iex',
      mac: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
      linux: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
      note: '官方腳本安裝，非 npm；裝到 ~/.local/bin 或 %LOCALAPPDATA%\\Antigravity',
    },
    login: {
      command: 'agy',
      note: '首次啟動自動觸發 Google OAuth；憑證存 ~/.gemini/oauth_creds.json',
    },
  },
]

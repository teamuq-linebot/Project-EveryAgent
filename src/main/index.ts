// 記錄設定必須最先載入：在任何其他 main 模組可能呼叫 console.* 之前接管全域 console，
// 並裝上 uncaughtException / unhandledRejection 捕捉（落檔到 userData/logs/main.log）。
import "./logger";
import { app, BrowserWindow, Menu, Notification, shell, session } from "electron";
import { join } from "path";
import { PtyManager } from "./pty/ptyManager";
import { Backend } from "./backend";
import { registerIpcHandlers } from "./ipc/router";
import { initAutoUpdater } from "./updater";
import { migrateToSingleDb } from "./db/migrateToSingleDb";
import { ensureAdminWorkspace } from "./services/adminWorkspace";
import { SqliteTaskRepository } from "./repo/sqliteTaskRepository";
import {
  APP_SETTINGS_KEYS,
  APP_SETTINGS_DEFAULTS,
} from "../shared/ipcContracts";

// 安全網：未處理的 Promise rejection 與 uncaughtException 由 ./logger 的
// errorHandler.startCatching() 統一捕捉並落檔（沿用「只記錄、不結束行程」容錯降級）。
// 啟動期任何非同步路徑（auth / sync / login server）若漏接 reject，仍會留下完整 stack 供診斷。

// ---------------------------------------------------------------------------
// Singletons：backend + global pty（保留既有 global ptyManager 供 pty IPC 用）
// backend 延遲到 app.whenReady() 內、遷移完成後再建立（safeStorage 需 app ready；
// 遷移須在 PunchLedger / SqliteTaskRepository 開 teamuq.db 之前完成，plan §2.13 / R32）。
// ---------------------------------------------------------------------------

function showPromptNotification(
  state: "waiting" | "error",
  reason?: string,
): void {
  try {
    if (!Notification.isSupported()) return;
    const title = state === "error" ? "⚠ CLI 錯誤" : "CLI 等待輸入";
    const body = `${reason || "互動提示"}（點擊開啟視窗）`;
    const notification = new Notification({ title, body });
    notification.on("click", () => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.show();
        win.focus();
      }
    });
    notification.show();
  } catch {
    // 通知失敗不可影響主流程
  }
}

// userData 錨定：productName 改為中文顯示名後，打包版 app.getName() 會跟著變，
// 預設 userData（%APPDATA%/<name>）將漂移成新目錄而丟失既有設定/快取。
// 顯示名歸顯示名、資料目錄永遠釘在 teamuq-electron。
app.setPath("userData", join(app.getPath("appData"), "teamuq-electron"));

const ptyManager = new PtyManager({
  onPromptStateChange: (id, state, reason, options, prompt) => {
    // backend 在 app.whenReady 後才建立；早期事件直接略過
    if (!backend) return;
    const hit = backend.monitor.onPtyPromptState(id, state, reason, options, prompt);
    if (hit && (state === "waiting" || state === "error")) {
      showPromptNotification(state, reason);
    }
  },
});
let backend: Backend;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 640,
    minHeight: 400,
    title: "快組隊-AI團隊",
    // dev 模式視窗/工作列 icon（快組隊齒輪標）；打包版由 exe 資源提供
    //（electron-builder 從 build/icon.ico 取，asar 不含 build/ 故只在未打包時設）
    ...(app.isPackaged
      ? {}
      : { icon: join(app.getAppPath(), "build/icon.ico") }),
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // 注入 IPC emit callback 到 backend（把 monitor 回呼推給 renderer）
  backend.setEmit((channel, payload) => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  });

  // Open external links in the OS browser, not in Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // --- 診斷：renderer 載入/崩潰訊號印到 main stdout（只在出錯時，低噪音） ---
  win.webContents.on(
    "console-message",
    (_e, level, message, line, sourceId) => {
      // level: 0=verbose 1=info 2=warning 3=error —— 只轉發 warning 以上，依等級分流
      // 落檔（console 已被 ./logger 接管），error/warning 在 main.log 帶正確等級標籤。
      if (level < 2) return;
      const text = `[renderer] ${message}  (${sourceId}:${line})`;
      if (level >= 3) console.error(text);
      else console.warn(text);
    },
  );
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.log(`[did-fail-load] code=${code} desc=${desc} url=${url}`);
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    console.log(`[render-process-gone] ${JSON.stringify(details)}`);
  });
  win.webContents.on("preload-error", (_e, path, err) => {
    console.log(`[preload-error] ${path} :: ${err}`);
  });
  if (process.env["TEAMUQ_DEVTOOLS"]) {
    win.webContents.openDevTools({ mode: "detach" });
    win.webContents.on("did-finish-load", () => {
      win.webContents
        .executeJavaScript(
          '({ tuq: !!window.tuq, shell: !!document.querySelector(".app-shell"), rootKids: document.getElementById("root")?.childElementCount })',
        )
        .then((r) => console.log("[mount-probe]", JSON.stringify(r)))
        .catch((e) => console.log("[mount-probe-error]", String(e)));
    });
  }

  // Kill all PTYs and stop all monitors when this window closes
  win.on("closed", () => {
    ptyManager.killAll();
    backend.destroyAll();
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    // Dev: electron-vite dev server
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    // Prod: built renderer
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return win;
}

/**
 * 依 dev / prod 注入 Content-Security-Policy 回應標頭。
 * - dev：electron-vite dev server（http://localhost）+ Vite HMR 需要 inline script 與 ws 連線，故放寬。
 * - prod：file:// 載入打包後 bundle，維持嚴格；renderer 只走 IPC（window.tuq），不需對外連線。
 */
function installCsp(): void {
  const isDev = !!process.env["ELECTRON_RENDERER_URL"];
  const csp = isDev
    ? [
        "default-src 'self' 'unsafe-inline' data:",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'self' ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*",
      ].join("; ")
    : [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'self'",
      ].join("; ");

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });
}

app.whenReady().then(() => {
  // Windows Toast 通知需要 AppUserModelId（打包後缺它通知會靜默消失）
  app.setAppUserModelId("tw.tuq.teamuq");

  // 移除原生選單列（File/Edit/View/Window/Help）。Windows/Linux 上預設選單會
  // 嵌進視窗變成可見工具列；macOS 會佔系統選單列。設 null 即整個拿掉。
  Menu.setApplicationMenu(null);

  // Phase 4.0（plan §2.13 / R32）：app ready 後（safeStorage 可用）、建任何 store 之前
  // 單點呼叫遷移。migrateToSingleDb 是同步冪等函式；失敗只記錄、不阻斷啟動。
  try {
    const report = migrateToSingleDb();
    if (!report.ok) {
      console.warn(
        "[migrate] migrateToSingleDb partial failure:",
        JSON.stringify(report),
      );
    }
  } catch (err) {
    console.error("[migrate] migrateToSingleDb fatal error:", err);
  }

  // store 遷移完成後才建立 Backend（PunchLedger / SqliteTaskRepository 開 teamuq.db）。
  // §6 批次 6d 接線：建立 SqliteTaskRepository 實例並以 subtaskRepo 注入 Backend，
  // 啟用打卡 local-first 路徑（createLocalSubtask / settleLocalSubtask / recordLocalOneshot）。
  // Backend 構造子內部也會 new SqliteTaskRepository 作為 _repo；此處單獨建實例讓 subtaskRepo
  // 參照同一個 DB 檔（teamuq.db），two connections 均為 WAL 模式，better-sqlite3 同步 API 安全。
  const subtaskRepo = new SqliteTaskRepository();
  backend = new Backend({
    subtaskRepo,
  });

  // plan §12 U6（Part B）：佈署 / 對齊 ~/.teamuq 管理工作區（scripts + CLAUDE.md）。
  // 在 migrate（上方）+ reconcilePlatformSeeds（Backend 建構子內）之後，managed 檔每次啟動覆寫；
  // 使用者自加 / 手改的檔不動。冪等容錯：失敗只記錄、不阻斷啟動。
  try {
    const ws = ensureAdminWorkspace();
    if (ws.ok) {
      console.log(
        `[adminWorkspace] ensured ${ws.dir} (written=${ws.written.length} unchanged=${ws.unchanged.length} skippedUser=${ws.skippedUser.length})`,
      );
    } else {
      console.warn("[adminWorkspace] ensure failed (non-fatal):", ws.error);
    }
  } catch (err) {
    console.error(
      "[adminWorkspace] ensureAdminWorkspace fatal error (non-fatal):",
      err,
    );
  }

  installCsp();
  registerIpcHandlers(ptyManager, backend);
  createWindow();

  // §2.14c D30：監測自動恢復 — 對 task_sessions 中 monitoring=1 的綁定，不需開 Tab 即
  // 重建 MonitorController + 重啟監測（配合 D29 水位從斷點續掃補卡）。在 createWindow 之後
  // 觸發，使恢復的監測能透過已注入的 emit 推送打卡表給 renderer。async 容錯：失敗只記、不阻斷啟動。
  //
  // 設定閘（統一設定頁「監測與工時 → 自動恢復監測」）：app_settings('monitor_auto_recover')
  //   = { enabled:false } 時 skip（log 一行），不重啟任何監測；缺鍵 / store 不可用 → 預設 true。
  const autoRecover =
    (backend.settings.getAppSetting(APP_SETTINGS_KEYS.MONITOR_AUTO_RECOVER)?.[
      "enabled"
    ] as boolean | undefined) ?? APP_SETTINGS_DEFAULTS.monitorAutoRecover;
  if (!autoRecover) {
    console.log(
      "[recover] auto-recover monitoring disabled by settings; skipped",
    );
  } else {
    backend.monitor
      .recoverMonitoring()
      .then((recovered) => {
        if (recovered.length > 0) {
          console.log(
            `[recover] auto-resumed monitoring for ${recovered.length} task(s): ${recovered.join(", ")}`,
          );
        }
      })
      .catch((err) => {
        console.error("[recover] recoverMonitoring failed (non-fatal):", err);
      });
  }

  // 自動更新（打包後生產環境才生效；dev / isPackaged=false 自動跳過）
  initAutoUpdater();

  app.on("activate", () => {
    // macOS: re-create window when clicking on dock icon with no windows open
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  ptyManager.killAll();
  backend?.destroyAll();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

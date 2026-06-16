// ipcContracts.ts — IPC 契約 barrel/facade。
// 實作已按功能域拆至 ./ipc/contracts/*.ts；本檔僅 re-export，維持既有 import path 不變。
// 拆分為行為保留（move-only），不得在此新增/修改任何契約定義。
export * from "./ipc/contracts/result";
export * from "./ipc/contracts/pty";
export * from "./ipc/contracts/task";
export * from "./ipc/contracts/session";
export * from "./ipc/contracts/monitor";
export * from "./ipc/contracts/punch";
export * from "./ipc/contracts/config";
export * from "./ipc/contracts/entities";
export * from "./ipc/contracts/misc";
export * from "./ipc/contracts/agentConv";
export * from "./ipc/contracts/cli";
export * from "./ipc/contracts/agentOrg";
export * from "./ipc/contracts/teamRegistry";
export * from "./ipc/contracts/agentRegistry";
export * from "./ipc/contracts/initProgress";

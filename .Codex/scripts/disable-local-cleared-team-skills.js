const fs = require("fs");

const files = [
  {
    path: "C:/Users/david/.codex/skills/tuq-goose/SKILL.md",
    name: "tuq-goose",
    team: "Goose",
  },
  {
    path: "C:/Users/david/.codex/skills/tuq-paperclip/SKILL.md",
    name: "tuq-paperclip",
    team: "Paperclip",
  },
  {
    path: "C:/Users/david/.agents/skills/tuq-goose/SKILL.md",
    name: "tuq-goose",
    team: "Goose",
  },
  {
    path: "C:/Users/david/.agents/skills/tuq-paperclip/SKILL.md",
    name: "tuq-paperclip",
    team: "Paperclip",
  },
];

for (const file of files) {
  const body = `---
name: ${file.name}
description: 已停用。${file.team} team 已在 clear-teams-20260608 中停用；此 skill 入口不再啟動 manager。
---

# ${file.name} — 已停用

此 team 已在 clear-teams-20260608 中停用，入口不再 dispatch manager。

若需要恢復，必須重新走 agent-ops HITL + Governance 審查。
`;

  fs.writeFileSync(file.path, body, "utf8");
  console.log(`disabled ${file.path}`);
}

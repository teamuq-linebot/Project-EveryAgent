import { describe, it, expect } from "vitest";
import {
  AgentTeamCreateSpecSchema,
  normalizeSkillName,
} from "../src/shared/ipc/contracts/agentOrg";
import {
  humanizeCreateError,
  describeZodIssueFields,
} from "../src/renderer/views/AgentTeams/createSpecHelpers";

describe("normalizeSkillName", () => {
  it("補上缺少的 tuq- 前綴", () => {
    expect(normalizeSkillName("sw-engineering")).toBe("tuq-sw-engineering");
  });
  it("已含 tuq- 前綴則原樣（不重複加）", () => {
    expect(normalizeSkillName("tuq-sw")).toBe("tuq-sw");
  });
  it("清理空白/大寫/非法字元", () => {
    expect(normalizeSkillName("  SW Engineering!! ")).toBe("tuq-sw-engineering");
  });
  it("空字串/非字串 → undefined（交給下游自動生成）", () => {
    expect(normalizeSkillName("   ")).toBeUndefined();
    expect(normalizeSkillName(undefined)).toBeUndefined();
    expect(normalizeSkillName(123)).toBeUndefined();
  });
});

describe("AgentTeamCreateSpecSchema skillName preprocess", () => {
  const base = {
    teamId: "sw",
    teamName: "工程團隊",
    members: [{ name: "developer", roleInTeam: "doer" }],
  };

  it("先前會失敗的 skillName 現在被正規化後通過", () => {
    const r = AgentTeamCreateSpecSchema.safeParse({
      ...base,
      skillName: "sw-engineering",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.skillName).toBe("tuq-sw-engineering");
  });

  it("省略 skillName 仍合法（optional）", () => {
    const r = AgentTeamCreateSpecSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.skillName).toBeUndefined();
  });

  it("多餘欄位（workgroup）被忽略、不致失敗", () => {
    const r = AgentTeamCreateSpecSchema.safeParse({
      ...base,
      skillName: "sw-engineering",
      workgroup: "工程群組",
    });
    expect(r.success).toBe(true);
  });
});

describe("humanizeCreateError / describeZodIssueFields", () => {
  it("從 zod issues 解析出出錯欄位標籤", () => {
    const issues = JSON.stringify([
      { code: "invalid_string", path: ["skillName"], message: "..." },
    ]);
    expect(describeZodIssueFields(issues)).toContain(
      "技能名稱（skillName，須為 tuq- 開頭）",
    );
    const msg = humanizeCreateError(issues);
    expect(msg).toContain("skillName");
    expect(msg).not.toBe(
      "團隊資料格式有點問題，請再試一次，或在對話裡微調團隊需求後重新建立。",
    );
  });

  it("成員路徑歸到 members 標籤（去重）", () => {
    const issues = JSON.stringify([
      { code: "invalid_string", path: ["members", 0, "name"], message: "..." },
      { code: "invalid_enum_value", path: ["members", 1, "roleInTeam"], message: "..." },
    ]);
    expect(describeZodIssueFields(issues)).toEqual(["成員設定（members）"]);
  });

  it("非 zod JSON 的一般訊息原樣顯示", () => {
    expect(humanizeCreateError("磁碟寫入失敗")).toBe("磁碟寫入失敗");
  });
});

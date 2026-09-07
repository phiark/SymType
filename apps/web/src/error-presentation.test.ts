import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import { presentUserError, userErrorText } from "./error-presentation";

describe("error presentation", () => {
  it.each([
    ["load", "已保存的数据仍保留在这台电脑"],
    ["save", "已保存的数据未受影响"],
    ["start", "当前任务没有进入练习界面"],
    ["backup", "现有数据未改变"],
    ["restore", "当前数据未被替换"],
    ["session", "已经保存的训练记录未受影响"],
    ["game", "已有游戏结果未受影响"]
  ] as const)("describes the data-safety outcome for %s failures", (context, safetyText) => {
    const result = presentUserError(new Error("database busy"), context);

    expect(`${result.title} ${result.message}`).toContain(safetyText);
    expect(result.message).toMatch(/重试|重新打开|返回/u);
  });

  it("maps structured API states while retaining the machine code for diagnostics", () => {
    const error = new ApiError(403, "CSRF_FAILED", "raw server detail");
    const result = presentUserError(error, "save");

    expect(result).toMatchObject({
      title: "页面凭据已失效",
      diagnosticCode: "CSRF_FAILED"
    });
    expect(result.message).toContain("已有数据未改变");
    expect(result.message).toContain("刷新页面后重试");
  });

  it("explains a rejected restore without implying that current data changed", () => {
    const result = presentUserError(
      new ApiError(400, "INVALID_BACKUP", "SQLite header mismatch"),
      "restore"
    );

    expect(result.title).toBe("所选备份无法通过安全检查");
    expect(result.message).toContain("当前数据未被替换");
    expect(result.message).toContain("请选择其他备份");
  });

  it.each([
    ["PRESET_READ_ONLY", "请先复制这份方案"],
    ["INCOMPLETE_MAPPING", "请检查每个按键的建议手指"],
    ["TEXT_COMPLETE", "选择其他内容"],
    ["RUN_NOT_FOUND", "返回游戏页"],
    ["SESSION_NOT_FOUND", "安全退出并重新打开训练"]
  ])("keeps the recovery action for structured state %s", (code, recoveryText) => {
    const result = presentUserError(new ApiError(409, code, "raw implementation detail"), "save");

    expect(result.diagnosticCode).toBe(code);
    expect(result.message).toContain(recoveryText);
    expect(`${result.title} ${result.message}`).not.toContain("raw implementation detail");
  });

  it("never passes unknown paths, content, tokens, or storage details into ordinary copy", () => {
    const raw =
      "SQLite failed at /Users/alice/private.sqlite; token=secret; typed=correct horse battery";
    const text = userErrorText(new Error(raw), "save");

    expect(text).not.toMatch(/SQLite|\/Users|private\.sqlite|token|secret|correct horse/iu);
    expect(text).toBe("本次更改尚未保存。已保存的数据未受影响。请保留当前页面并重试。");
  });
});

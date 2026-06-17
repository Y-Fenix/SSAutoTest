import { describe, expect, it } from "vitest";
import { coverageResultsToCsv } from "../exporter";
import type { CoverageResult } from "../types";

describe("coverageResultsToCsv", () => {
  it("exports user-facing coverage columns", () => {
    const rows: CoverageResult[] = [
      {
        eventTag: "关卡点位",
        eventName: "level_start",
        matchedEventNames: [],
        triggerDescription: "本局开始",
        expectedProperties: ["level_type", "level_id"],
        coveredProperties: ["level_type"],
        missingProperties: ["level_id"],
        propertyDetails: { level_type: "普通关", level_id: "数字关卡ID" },
        valueIssues: [],
        status: "属性缺失",
        triggerCount: 12,
        notes: "包含重玩",
      },
    ];

    const csv = coverageResultsToCsv(rows);

    expect(csv).toContain("事件名,覆盖状态,触发次数,预期属性,已覆盖属性,缺失属性,备注");
    expect(csv).toContain("level_start,属性缺失,12");
    expect(csv).toContain("level_type; level_id");
  });

  it("quotes cells containing commas and quotes", () => {
    const csv = coverageResultsToCsv([
      {
        eventTag: "广告,点位",
        eventName: "ad_event",
        matchedEventNames: [],
        triggerDescription: "包含 \"激励视频\"",
        expectedProperties: [],
        coveredProperties: [],
        missingProperties: [],
        propertyDetails: {},
        valueIssues: [],
        status: "已覆盖",
        triggerCount: null,
        notes: "",
      },
    ]);

    expect(csv).toContain("ad_event");
  });
});

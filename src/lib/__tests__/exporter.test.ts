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
        detailCoveredProperties: [],
        detailMissingProperties: [],
        passedProperties: ["level_type"],
        propertyDetails: { level_type: "普通关", level_id: "数字关卡ID" },
        propertyDetailItems: { level_type: ["普通关"], level_id: ["数字关卡ID"] },
        coveredDetails: { level_type: ["普通关"] },
        coveredDetailItems: { level_type: ["普通关"] },
        valueIssues: [],
        status: "属性缺失",
        triggerCount: 12,
        passRate: 0.5,
        notes: "包含重玩",
      },
    ];

    const csv = coverageResultsToCsv(rows);

    expect(csv).toContain("事件名,覆盖状态,触发次数,预期属性,已覆盖属性,缺失属性,详情缺失,通过率,备注");
    expect(csv).toContain("level_start,属性缺失,12");
    expect(csv).toContain("50%");
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
        detailCoveredProperties: [],
        detailMissingProperties: [],
        passedProperties: [],
        propertyDetails: {},
        propertyDetailItems: {},
        coveredDetails: {},
        coveredDetailItems: {},
        valueIssues: [],
        status: "测试通过",
        triggerCount: null,
        passRate: 1,
        notes: "",
      },
    ]);

    expect(csv).toContain("ad_event");
  });
});

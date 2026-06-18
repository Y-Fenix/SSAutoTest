import { describe, expect, it } from "vitest";
import { parseActualDataRows } from "../actualDataParser";
import { evaluateCoverage } from "../coverageEvaluator";
import type { ExpectedEvent } from "../types";

const expectedEvents: ExpectedEvent[] = [
  {
    eventTag: "关卡点位",
    eventName: "level_start",
    triggerDescription: "本局开始",
    properties: [
      { propertyName: "level_type", valueType: "字符串", description: "", propertyDetail: "", remark: "" },
      { propertyName: "level_id", valueType: "数值", description: "", propertyDetail: "", remark: "" },
    ],
    notes: "",
    testResult: "",
  },
  {
    eventTag: "广告点位",
    eventName: "common_ad_event",
    triggerDescription: "广告行为",
    properties: [
      { propertyName: "action", valueType: "字符串", description: "", propertyDetail: "", remark: "" },
      { propertyName: "revenue", valueType: "数值", description: "", propertyDetail: "", remark: "" },
    ],
    notes: "",
    testResult: "",
  },
  {
    eventTag: "sdk自采集事件",
    eventName: "ta_app_end",
    triggerDescription: "游戏登出",
    properties: [],
    notes: "",
    testResult: "",
  },
];

describe("evaluateCoverage", () => {
  it("reports covered, property-missing, and event-missing statuses", () => {
    const actualEvents = parseActualDataRows([
      { event_name: "level_start", level_type: "1", level_id: "8" },
      { event_name: "level_start", level_type: "2", level_id: "9" },
      { event_name: "common_ad_event", action: "impression", revenue: "" },
      { event_name: "extra_event", foo: "bar" },
    ]);

    const report = evaluateCoverage(expectedEvents, actualEvents);

    expect(report.results.map((result) => [result.eventName, result.status])).toEqual([
      ["level_start", "测试通过"],
      ["common_ad_event", "属性缺失"],
      ["ta_app_end", "事件缺失"],
    ]);
    expect(report.results[1].missingProperties).toEqual(["revenue"]);
    expect(report.results.map((result) => [result.eventName, result.triggerCount])).toEqual([
      ["level_start", 2],
      ["common_ad_event", 1],
      ["ta_app_end", null],
    ]);
    expect(report.summary.totalEvents).toBe(3);
    expect(report.summary.coveredEvents).toBe(1);
    expect(report.summary.propertyMissingEvents).toBe(1);
    expect(report.summary.missingEvents).toBe(1);
    expect(report.extraEvents).toEqual(["extra_event"]);
  });

  it("detects supported event-name aliases", () => {
    const actualEvents = parseActualDataRows([{ "事件": "level_start", level_type: "1" }]);

    expect(actualEvents.get("level_start")?.properties.has("level_type")).toBe(true);
  });

  it("covers a property only when at least one actual row has a non-empty value", () => {
    const actualEvents = parseActualDataRows([
      { event_name: "level_start", level_type: "", level_id: "8" },
      { event_name: "level_start", level_type: "Normal", level_id: "" },
    ]);

    const report = evaluateCoverage([expectedEvents[0]], actualEvents);

    expect(report.results[0].coveredProperties).toEqual(["level_type", "level_id"]);
    expect(report.results[0].missingProperties).toEqual([]);
    expect(report.results[0].status).toBe("测试通过");
  });

  it("marks a property missing when the export column exists but all values are empty for that event", () => {
    const actualEvents = parseActualDataRows([
      { event_name: "level_start", level_type: "Normal", level_id: "8", level_undo_times: "" },
      { event_name: "level_start", level_type: "Normal", level_id: "9", level_undo_times: "" },
    ]);
    const report = evaluateCoverage(
      [
        {
          ...expectedEvents[0],
          properties: [
            ...expectedEvents[0].properties,
            { propertyName: "level_undo_times", valueType: "数值", description: "", propertyDetail: "", remark: "" },
          ],
        },
      ],
      actualEvents,
    );

    expect(report.results[0].missingProperties).toContain("level_undo_times");
    expect(report.results[0].status).toBe("属性缺失");
  });

  it("checks common properties against every actual event and reports one line per missing property", () => {
    const actualEvents = parseActualDataRows([
      { event_name: "level_start", app_version: "2.1.0", level_id: "8" },
      { event_name: "common_ad_event", app_version: "", level_id: "" },
      { event_name: "login_monitor", app_version: "2.1.0", level_id: "" },
    ]);
    const report = evaluateCoverage(
      [
        {
          eventTag: "",
          eventName: "公共事件属性",
          triggerDescription: "",
          properties: [
            { propertyName: "app_version", valueType: "字符串", description: "", propertyDetail: "", remark: "" },
            { propertyName: "level_id", valueType: "数值", description: "", propertyDetail: "", remark: "" },
          ],
          notes: "",
          testResult: "",
          isCommonProperties: true,
        },
      ],
      actualEvents,
    );

    expect(report.results[0].status).toBe("属性缺失");
    expect(report.results[0].triggerCount).toBeNull();
    expect(report.results[0].missingProperties).toEqual([
      "app_version：common_ad_event",
      "level_id：common_ad_event、login_monitor",
    ]);
  });

  it("reports detail coverage when actual values match expected property details", () => {
    const actualEvents = parseActualDataRows([
      { event_name: "common_ad_event", action: "load", revenue: "0.01" },
    ]);
    const report = evaluateCoverage(
      [
        {
          eventTag: "广告点位",
          eventName: "common_ad_event",
          triggerDescription: "",
          properties: [
            {
              propertyName: "action",
              valueType: "字符串",
              description: "广告步骤",
              propertyDetail: "request,load,revenue",
              remark: "",
            },
            {
              propertyName: "revenue",
              valueType: "数值",
              description: "",
              propertyDetail: "",
              remark: "",
            },
          ],
          notes: "",
          testResult: "",
        },
      ],
      actualEvents,
    );

    expect(report.results[0].status).toBe("测试通过");
    expect(report.results[0].detailCoveredProperties).toEqual(["action"]);
    expect(report.results[0].detailMissingProperties).toEqual([]);
    expect(report.results[0].coveredDetails).toEqual({ action: ["load"] });
    expect(report.results[0].passRate).toBe(1);
    expect(report.summary.detailMissingEvents).toBe(0);
    expect(report.summary.detailCoverageRate).toBe(1);
  });

  it("reports detail missing when property exists but no value matches expected details", () => {
    const actualEvents = parseActualDataRows([
      { event_name: "common_ad_event", action: "loaded", revenue: "0.01" },
    ]);
    const report = evaluateCoverage(
      [
        {
          eventTag: "广告点位",
          eventName: "common_ad_event",
          triggerDescription: "",
          properties: [
            {
              propertyName: "action",
              valueType: "字符串",
              description: "广告步骤",
              propertyDetail: "request,load,revenue",
              remark: "",
            },
            {
              propertyName: "revenue",
              valueType: "数值",
              description: "",
              propertyDetail: "",
              remark: "",
            },
          ],
          notes: "",
          testResult: "",
        },
      ],
      actualEvents,
    );

    expect(report.results[0].status).toBe("详情缺失");
    expect(report.results[0].coveredProperties).toEqual(["action", "revenue"]);
    expect(report.results[0].detailMissingProperties).toEqual(["action"]);
    expect(report.results[0].coveredDetails).toEqual({ action: [] });
    expect(report.results[0].passedProperties).toEqual(["revenue"]);
    expect(report.results[0].passRate).toBe(0.5);
    expect(report.summary.detailMissingEvents).toBe(1);
    expect(report.summary.detailCoverageRate).toBe(0);
  });

  it("covers common_ad_event scene when reward_scene has any non-empty value", () => {
    const actualEvents = parseActualDataRows([
      { event_name: "common_ad_event", reward_scene: "daily_reward" },
    ]);
    const report = evaluateCoverage(
      [
        {
          eventTag: "广告点位",
          eventName: "common_ad_event",
          triggerDescription: "",
          properties: [
            { propertyName: "scene", valueType: "字符串", description: "", propertyDetail: "", remark: "" },
          ],
          notes: "",
          testResult: "",
        },
      ],
      actualEvents,
    );

    expect(report.results[0].coveredProperties).toEqual(["scene"]);
    expect(report.results[0].missingProperties).toEqual([]);
    expect(report.results[0].status).toBe("测试通过");
  });

  it("covers common_ad_event scene when scence has any non-empty value", () => {
    const actualEvents = parseActualDataRows([
      { event_name: "common_ad_event", scence: "interstitial" },
    ]);
    const report = evaluateCoverage(
      [
        {
          eventTag: "广告点位",
          eventName: "common_ad_event",
          triggerDescription: "",
          properties: [
            { propertyName: "scene", valueType: "字符串", description: "", propertyDetail: "", remark: "" },
          ],
          notes: "",
          testResult: "",
        },
      ],
      actualEvents,
    );

    expect(report.results[0].coveredProperties).toEqual(["scene"]);
    expect(report.results[0].missingProperties).toEqual([]);
    expect(report.results[0].status).toBe("测试通过");
  });

  it("does not use common_ad_event scene aliases for other events", () => {
    const actualEvents = parseActualDataRows([
      { event_name: "level_start", reward_scene: "daily_reward" },
    ]);
    const report = evaluateCoverage(
      [
        {
          eventTag: "关卡点位",
          eventName: "level_start",
          triggerDescription: "",
          properties: [
            { propertyName: "scene", valueType: "字符串", description: "", propertyDetail: "", remark: "" },
          ],
          notes: "",
          testResult: "",
        },
      ],
      actualEvents,
    );

    expect(report.results[0].coveredProperties).toEqual([]);
    expect(report.results[0].missingProperties).toEqual(["scene"]);
    expect(report.results[0].status).toBe("属性缺失");
  });
});

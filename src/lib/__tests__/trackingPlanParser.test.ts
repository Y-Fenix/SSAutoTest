import { describe, expect, it } from "vitest";
import { parseTrackingPlanRows } from "../trackingPlanParser";

describe("parseTrackingPlanRows", () => {
  it("groups event rows with continuation property rows", () => {
    const events = parseTrackingPlanRows([
      {
        "事件标签": "关卡点位",
        "事件名": "level_start",
        "点位触发说明": "本局开始",
        "属性名": "level_type",
        "属性值类型": "字符串",
        "属性说明": "关卡类型",
        "备注1": "0:无",
        "备注": "包含重玩",
        "测试结果1.0.5": "",
      },
      {
        "事件标签": "",
        "事件名": "",
        "点位触发说明": "",
        "属性名": "level_id",
        "属性值类型": "数值",
        "属性说明": "数字关卡ID",
        "备注1": "",
        "备注": "",
        "测试结果1.0.5": "",
      },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].eventName).toBe("level_start");
    expect(events[0].properties.map((property) => property.propertyName)).toEqual([
      "level_type",
      "level_id",
    ]);
  });

  it("keeps SDK events with no properties", () => {
    const events = parseTrackingPlanRows([
      {
        "事件标签": "sdk自采集事件",
        "事件名": "ta_app_start",
        "点位触发说明": "游戏启动",
        "属性名": "",
        "属性值类型": "",
        "属性说明": "",
        "备注1": "启动时触发",
        "备注": "",
        "测试结果1.0.5": "1",
      },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].properties).toEqual([]);
  });

  it("reads 属性详情 as property detail", () => {
    const events = parseTrackingPlanRows([
      {
        "事件标签": "广告事件SDK",
        "事件名": "common_ad_event",
        "点位触发说明": "",
        "属性名": "action",
        "属性值类型": "字符串",
        "属性说明": "广告步骤",
        "属性详情": "request,load,revenue",
        "备注": "",
        "测试结果1.0.5": "",
      },
    ]);

    expect(events[0].properties[0].propertyDetail).toBe("request,load,revenue");
  });

  it("merges repeated event-name rows into one event", () => {
    const events = parseTrackingPlanRows([
      {
        "事件名": "click",
        "属性名": "info",
        "属性详情": "A\nB",
      },
      {
        "事件名": "click",
        "属性名": "sub_info",
        "属性详情": "C\nD",
      },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].eventName).toBe("click");
    expect(events[0].properties.map((property) => property.propertyName)).toEqual(["info", "sub_info"]);
    expect(events[0].properties.map((property) => property.propertyDetail)).toEqual(["A\nB", "C\nD"]);
  });

  it("ignores blank rows and trailing exported columns", () => {
    const events = parseTrackingPlanRows([
      {
        "事件标签": "",
        "事件名": "",
        "点位触发说明": "",
        "属性名": "",
        "属性值类型": "",
        "属性说明": "",
        "备注1": "",
        "备注": "",
        "": "",
      },
      {
        "事件标签": "广告点位",
        "事件名": "common_ad_event",
        "点位触发说明": "广告行为",
        "属性名": "action",
        "属性值类型": "字符串",
        "属性说明": "广告动作",
        "备注1": "",
        "备注": "",
        "": "",
      },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].eventName).toBe("common_ad_event");
  });

  it("parses common event properties as a global rule", () => {
    const events = parseTrackingPlanRows([
      {
        "属性名（必填）": "app_version",
        "属性显示名": "字符串",
        "属性类型（必填）": "当前版本号",
        "属性说明": "",
        "上报调整": "",
      },
      {
        "属性名（必填）": "level_id",
        "属性显示名": "数值",
        "属性类型（必填）": "数字关卡ID",
        "属性说明": "",
        "上报调整": "",
      },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].eventName).toBe("公共事件属性");
    expect(events[0].isCommonProperties).toBe(true);
    expect(events[0].properties.map((property) => property.propertyName)).toEqual(["app_version", "level_id"]);
  });

  it("throws a clear error when expected table column names are unknown", () => {
    expect(() =>
      parseTrackingPlanRows([
        {
          "点位": "关卡点位",
          "名称": "level_start",
          "字段": "level_id",
        },
      ]),
    ).toThrow("无法识别预期埋点表列名");
  });
});

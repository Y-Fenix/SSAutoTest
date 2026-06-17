import { describe, expect, it } from "vitest";
import { detectEventNameColumn, parseActualDataRows } from "../actualDataParser";

describe("parseActualDataRows", () => {
  it("prefers the populated ThinkingData event column over an empty event_name column", () => {
    const rows = [
      { event_name: "", "#event_name": "ta_app_start", app_version: "2.1.0" },
      { event_name: "", "#event_name": "level_start", level_id: "8" },
    ];

    expect(detectEventNameColumn(rows)).toBe("#event_name");
    expect(parseActualDataRows(rows).has("ta_app_start")).toBe(true);
  });

  it("parses a manually selected event-name column that is not an alias", () => {
    const actualEvents = parseActualDataRows(
      [
        { "埋点名称": "level_start", level_id: "8" },
        { "埋点名称": "level_start", level_type: "normal" },
      ],
      "埋点名称",
    );

    expect(actualEvents.get("level_start")?.properties).toEqual(new Set(["level_id", "level_type"]));
  });

  it("does not infer event matches from Chinese descriptions", () => {
    const actualEvents = parseActualDataRows([{ "事件名称": "启动APP/切前台", app_version: "2.1.0" }]);

    expect(actualEvents.has("ta_app_start")).toBe(false);
    expect(actualEvents.has("启动APP/切前台")).toBe(true);
  });
});

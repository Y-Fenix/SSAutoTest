import { describe, expect, it } from "vitest";
import {
  createActualEventAccumulator,
  detectEventNameColumn,
  hydrateActualEventScanResult,
  parseActualDataRows,
  serializeActualEventScanResult,
} from "../actualDataParser";

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

  it("caps retained rows per expected event while preserving trigger counts", () => {
    const accumulator = createActualEventAccumulator({
      expectedEventNames: new Set(["level_start", "level_end"]),
      sampleLimitPerEvent: 2,
    });

    accumulator.addRow({ "#event_name": "level_start", level_id: "1" });
    accumulator.addRow({ "#event_name": "level_start", level_id: "2" });
    accumulator.addRow({ "#event_name": "level_start", level_id: "3" });
    accumulator.addRow({ "#event_name": "level_end", level_id: "4" });
    accumulator.addRow({ "#event_name": "level_end", level_id: "5" });

    const result = accumulator.getResult();
    expect(result.actualEvents.get("level_start")?.rows).toHaveLength(2);
    expect(result.actualEvents.get("level_start")?.rowCount).toBe(3);
    expect(result.actualEvents.get("level_end")?.rows).toHaveLength(2);
    expect(accumulator.isComplete()).toBe(true);
  });

  it("serializes backend scan summaries and hydrates them back to sets", () => {
    const accumulator = createActualEventAccumulator({
      expectedEventNames: new Set(["common_ad_event"]),
      expectedProperties: new Set(["revenue", "action"]),
    });

    accumulator.addRow({ "#event_name": "common_ad_event", revenue: "0.01", action: "revenue", ignored: "x" });
    accumulator.addRow({ "#event_name": "common_ad_event", revenue: "0.02", action: "loaded" });

    const serialized = serializeActualEventScanResult({
      ...accumulator.getResult(),
      rowCount: 2,
    });
    const roundTripped = JSON.parse(JSON.stringify(serialized));
    const hydrated = hydrateActualEventScanResult(roundTripped);
    const event = hydrated.actualEvents.get("common_ad_event");

    expect(hydrated.rowCount).toBe(2);
    expect(event?.displayNames).toEqual(new Set(["common_ad_event"]));
    expect(event?.properties).toEqual(new Set(["revenue", "action"]));
    expect(event?.rowCount).toBe(2);
    expect(event?.rows).toEqual([
      { revenue: "0.01", action: "revenue" },
      { revenue: "0.02", action: "loaded" },
    ]);
  });

  it("retains bounded distinct values per property for large scans", () => {
    const accumulator = createActualEventAccumulator({
      expectedEventNames: new Set(["common_ad_event"]),
      expectedProperties: new Set(["action", "revenue"]),
      distinctValueLimitPerProperty: 2,
    });

    accumulator.addRow({ "#event_name": "common_ad_event", action: "loaded", revenue: "0" });
    accumulator.addRow({ "#event_name": "common_ad_event", action: "request", revenue: "0.01" });
    accumulator.addRow({ "#event_name": "common_ad_event", action: "click", revenue: "0.02" });

    const event = accumulator.getResult().actualEvents.get("common_ad_event");

    expect(event?.rowCount).toBe(3);
    expect(event?.properties).toEqual(new Set(["action", "revenue"]));
    expect(event?.rows).toEqual([
      { action: "loaded" },
      { revenue: "0" },
      { action: "request" },
      { revenue: "0.01" },
    ]);
  });
});

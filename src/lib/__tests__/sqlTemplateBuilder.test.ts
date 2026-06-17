import { describe, expect, it } from "vitest";
import { buildSqlTemplate } from "../sqlTemplateBuilder";
import type { ExpectedEvent } from "../types";

const expectedEvents: ExpectedEvent[] = [
  {
    eventTag: "关卡点位",
    eventName: "level_start",
    triggerDescription: "本局开始",
    properties: [],
    notes: "",
    testResult: "",
  },
];

describe("buildSqlTemplate", () => {
  it("uses the configured event name column for the event filter", () => {
    const sql = buildSqlTemplate(expectedEvents, {
      tableName: "ta.v_event_33",
      userIdColumn: "#user_id",
      userIdValue: "tester",
      startTime: "2026-06-16 00:00:00",
      endTime: "2026-06-17 00:00:00",
      appVersionColumn: "app_version",
      eventNameColumn: "#event_name",
    });

    expect(sql).toContain("AND #event_name IN");
  });
});

import { describe, expect, it } from "vitest";
import {
  buildShushuSql,
  extractShushuTaskId,
  normalizeShushuPageRows,
  normalizeShushuQueryConfig,
  normalizeShushuTaskInfo,
  parseShushuResultPageText,
} from "../shushuQuery";

describe("buildShushuSql", () => {
  it("selects all columns from the default event table for the project", () => {
    const config = normalizeShushuQueryConfig({ projectId: "102" });

    expect(buildShushuSql(config)).toBe('SELECT * FROM v_event_102');
  });

  it("adds date and user filters", () => {
    const config = normalizeShushuQueryConfig({
      projectId: "102",
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      userId: "user-1",
      userIdColumn: "#user_id",
    });

    expect(buildShushuSql(config)).toBe(
      'SELECT * FROM v_event_102 WHERE "$part_date" >= \'2026-06-01\' AND "$part_date" <= \'2026-06-03\' AND "#user_id" = \'user-1\'',
    );
  });

  it("escapes user id values", () => {
    const config = normalizeShushuQueryConfig({
      projectId: "102",
      userId: "a'b",
    });

    expect(buildShushuSql(config)).toBe('SELECT * FROM v_event_102 WHERE "#account_id" = \'a\'\'b\'');
  });

  it("adds app version filter", () => {
    const config = normalizeShushuQueryConfig({
      projectId: "102",
      appVersion: "2.2.0",
    });

    expect(buildShushuSql(config)).toBe('SELECT * FROM v_event_102 WHERE "#app_version" = \'2.2.0\'');
  });

  it("rejects unsafe identifiers", () => {
    expect(() =>
      normalizeShushuQueryConfig({
        projectId: "102",
        eventTable: "v_event_102; drop table users",
      }),
    ).toThrow("事件表名只能包含");
  });

  it("allows schema qualified event tables", () => {
    const config = normalizeShushuQueryConfig({ projectId: "33", eventTable: "ta.v_event_33" });

    expect(buildShushuSql(config)).toBe("SELECT * FROM ta.v_event_33");
  });
});

describe("normalizeShushuPageRows", () => {
  it("maps array rows to header named objects", () => {
    const rows = normalizeShushuPageRows(["#event_name", "level_id"], ['["level_start","1"]']);

    expect(rows).toEqual([{ "#event_name": "level_start", level_id: "1" }]);
  });

  it("keeps json object rows as objects", () => {
    const rows = normalizeShushuPageRows([], ['{"#event_name":"level_start","level_id":"1"}']);

    expect(rows).toEqual([{ "#event_name": "level_start", level_id: "1" }]);
  });
});

describe("task metadata helpers", () => {
  it("extracts task id from submit response", () => {
    expect(extractShushuTaskId({ data: { taskId: "task-1" } })).toBe("task-1");
  });

  it("normalizes task progress and result statistics", () => {
    const task = normalizeShushuTaskInfo({
      data: {
        taskId: "task-1",
        status: "FINISHED",
        progress: 100,
        resultStat: {
          rowCount: 1200,
          pageCount: 2,
          headers: ["#event_name", "level_id"],
        },
      },
    });

    expect(task).toEqual({
      taskId: "task-1",
      status: "FINISHED",
      progress: 100,
      rowCount: 1200,
      pageCount: 2,
      columns: ["#event_name", "level_id"],
      errorMessage: "",
    });
  });
});

describe("parseShushuResultPageText", () => {
  it("parses line-delimited json result pages", () => {
    const rows = parseShushuResultPageText(
      ["#event_name", "level_id"],
      '{"return_code":0,"data":{"headers":["#event_name","level_id"]}}\n["level_start","1"]',
    );

    expect(rows).toEqual([{ "#event_name": "level_start", level_id: "1" }]);
  });

  it("keeps json object lines as data rows", () => {
    const rows = parseShushuResultPageText(
      [],
      '{"#event_name":"level_start","level_id":"1"}\n{"#event_name":"level_end","level_id":"2"}',
    );

    expect(rows).toEqual([
      { "#event_name": "level_start", level_id: "1" },
      { "#event_name": "level_end", level_id: "2" },
    ]);
  });
});

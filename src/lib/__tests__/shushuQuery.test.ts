import { describe, expect, it } from "vitest";
import {
  buildShushuSql,
  buildShushuEventNamesSql,
  buildShushuSqlPage,
  buildShushuSqlideBatchSql,
  buildShushuSqlideQuerySqls,
  buildShushuSqlideQuerySql,
  buildShushuSqlideMessage,
  extractShushuTaskId,
  formatShushuQueryCountdown,
  formatShushuQueryProgress,
  formatShushuRowsProgress,
  friendlyShushuErrorMessage,
  normalizeShushuPageRows,
  normalizeShushuQueryConfig,
  normalizeShushuExecuteSqlMetadata,
  normalizeShushuSqlideWebSocketUrl,
  normalizeShushuTaskInfo,
  normalizeShushuSqlideMessage,
  parseShushuResultPageText,
  shushuResultPageIdsToRead,
  validateShushuQueryScope,
} from "../shushuQuery";

describe("buildShushuSql", () => {
  it("selects all columns from the default event table for the project", () => {
    const config = normalizeShushuQueryConfig({ projectId: "102" });

    expect(buildShushuSql(config)).toBe('SELECT * FROM v_event_102 ORDER BY "#event_time" ASC');
  });

  it("adds a row limit when max rows is configured", () => {
    const config = normalizeShushuQueryConfig({ projectId: "102", maxRows: 1000 });

    expect(buildShushuSql(config)).toBe('SELECT * FROM v_event_102 ORDER BY "#event_time" ASC LIMIT 1000');
  });

  it("adds the row limit after filters", () => {
    const config = normalizeShushuQueryConfig({
      projectId: "102",
      userId: "TEST_ACCOUNT_001",
      userIdColumn: "#account_id",
      maxRows: 1000,
    });

    expect(buildShushuSql(config)).toBe('SELECT * FROM v_event_102 WHERE "#account_id" = \'TEST_ACCOUNT_001\' ORDER BY "#event_time" ASC LIMIT 1000');
  });

  it("keeps user id filters when date, event name, and limit are configured together", () => {
    const config = normalizeShushuQueryConfig({
      projectId: "33",
      startDate: "2026-06-25",
      endDate: "2026-06-25",
      userIdColumn: "#account_id",
      userId: "TEST_ACCOUNT_001",
      useEventNameFilter: true,
      eventNames: "level_start",
      maxRows: 1000,
    });

    expect(buildShushuSql(config)).toBe(
      'SELECT * FROM v_event_33 WHERE "$part_date" >= \'2026-06-25\' AND "$part_date" <= \'2026-06-25\' AND "#account_id" = \'TEST_ACCOUNT_001\' AND "#event_name" = \'level_start\' ORDER BY "#event_time" ASC LIMIT 1000',
    );
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
      'SELECT * FROM v_event_102 WHERE "$part_date" >= \'2026-06-01\' AND "$part_date" <= \'2026-06-03\' AND "#user_id" = \'user-1\' ORDER BY "#event_time" ASC',
    );
  });

  it("does not quote numeric user id values", () => {
    const config = normalizeShushuQueryConfig({
      projectId: "102",
      userId: "900000000000000001",
      userIdColumn: "#user_id",
    });

    expect(buildShushuSql(config)).toBe('SELECT * FROM v_event_102 WHERE "#user_id" = 900000000000000001 ORDER BY "#event_time" ASC');
  });

  it("quotes numeric account id values because account id is text", () => {
    const config = normalizeShushuQueryConfig({
      projectId: "102",
      userId: "TEST_ACCOUNT_001",
      userIdColumn: "#account_id",
    });

    expect(buildShushuSql(config)).toBe('SELECT * FROM v_event_102 WHERE "#account_id" = \'TEST_ACCOUNT_001\' ORDER BY "#event_time" ASC');
  });

  it("escapes user id values", () => {
    const config = normalizeShushuQueryConfig({
      projectId: "102",
      userId: "a'b",
    });

    expect(buildShushuSql(config)).toBe('SELECT * FROM v_event_102 WHERE "#account_id" = \'a\'\'b\' ORDER BY "#event_time" ASC');
  });

  it("adds app version filter", () => {
    const config = normalizeShushuQueryConfig({
      projectId: "102",
      appVersion: "2.2.0",
    });

    expect(buildShushuSql(config)).toBe('SELECT * FROM v_event_102 WHERE "#app_version" = \'2.2.0\' ORDER BY "#event_time" ASC');
  });

  it("ignores event names until the event filter is enabled", () => {
    const config = normalizeShushuQueryConfig({
      projectId: "102",
      userId: "TEST_ACCOUNT_001",
      eventNames: "level_start",
    });

    expect(buildShushuSql(config)).toBe('SELECT * FROM v_event_102 WHERE "#account_id" = \'TEST_ACCOUNT_001\' ORDER BY "#event_time" ASC');
  });

  it("adds event name filters when enabled", () => {
    const config = normalizeShushuQueryConfig({
      projectId: "102",
      useEventNameFilter: true,
      eventNames: "level_start\nlevel_end，ad_click",
    });

    expect(buildShushuSql(config)).toBe(
      'SELECT * FROM v_event_102 WHERE "#event_name" IN (\'level_start\', \'level_end\', \'ad_click\') ORDER BY "#event_time" ASC',
    );
  });

  it("expands item_get filters with events needed by test-case context", () => {
    const config = normalizeShushuQueryConfig({
      projectId: "102",
      useEventNameFilter: true,
      eventNames: "item_get",
    });

    expect(buildShushuSql(config)).toBe(
      'SELECT * FROM v_event_102 WHERE "#event_name" IN (\'item_get\', \'item_use\', \'common_ad_event\') ORDER BY "#event_time" ASC',
    );
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

    expect(buildShushuSql(config)).toBe('SELECT * FROM ta.v_event_33 ORDER BY "#event_time" ASC');
  });

  it("builds paged SQL using the SQLIDE-supported offset before limit syntax", () => {
    const config = normalizeShushuQueryConfig({
      projectId: "33",
      eventTable: "ta.v_event_33",
      startDate: "2026-06-25",
      endDate: "2026-06-25",
      appVersion: "2.2.0",
      maxRows: 3000,
    });

    expect(buildShushuSqlPage(config, 1000, 1000)).toBe(
      'SELECT * FROM ta.v_event_33 WHERE "$part_date" >= \'2026-06-25\' AND "$part_date" <= \'2026-06-25\' AND "#app_version" = \'2.2.0\' ORDER BY "#event_time" ASC OFFSET 1000 LIMIT 1000',
    );
  });

  it("caps single SQLIDE websocket query batches at 1000 rows without event sharding", () => {
    const config = normalizeShushuQueryConfig({
      projectId: "33",
      eventTable: "ta.v_event_33",
      startDate: "2026-06-25",
      endDate: "2026-06-25",
      appVersion: "2.2.0",
      maxRows: 100000,
    });

    expect(buildShushuSqlideQuerySql(config)).toBe(
      'SELECT * FROM ta.v_event_33 WHERE "$part_date" >= \'2026-06-25\' AND "$part_date" <= \'2026-06-25\' AND "#app_version" = \'2.2.0\' ORDER BY "#event_time" ASC LIMIT 1000',
    );
    expect(buildShushuSqlideQuerySql(config)).not.toContain("OFFSET");
  });

  it("splits multi-event SQLIDE websocket queries into single-event shards capped at 1000 rows", () => {
    const config = normalizeShushuQueryConfig({
      projectId: "33",
      eventTable: "ta.v_event_33",
      startDate: "2026-06-25",
      endDate: "2026-06-25",
      useEventNameFilter: true,
      eventNames: "level_start\nlevel_lose\nitem_get",
      maxRows: 9000,
    });

    expect(buildShushuSqlideQuerySqls(config)).toEqual([
      'SELECT * FROM ta.v_event_33 WHERE "$part_date" >= \'2026-06-25\' AND "$part_date" <= \'2026-06-25\' AND "#event_name" = \'level_start\' ORDER BY "#event_time" ASC LIMIT 1000',
      'SELECT * FROM ta.v_event_33 WHERE "$part_date" >= \'2026-06-25\' AND "$part_date" <= \'2026-06-25\' AND "#event_name" = \'level_lose\' ORDER BY "#event_time" ASC LIMIT 1000',
      'SELECT * FROM ta.v_event_33 WHERE "$part_date" >= \'2026-06-25\' AND "$part_date" <= \'2026-06-25\' AND "#event_name" = \'item_get\' ORDER BY "#event_time" ASC LIMIT 1000',
      'SELECT * FROM ta.v_event_33 WHERE "$part_date" >= \'2026-06-25\' AND "$part_date" <= \'2026-06-25\' AND "#event_name" = \'item_use\' ORDER BY "#event_time" ASC LIMIT 1000',
      'SELECT * FROM ta.v_event_33 WHERE "$part_date" >= \'2026-06-25\' AND "$part_date" <= \'2026-06-25\' AND "#event_name" = \'common_ad_event\' ORDER BY "#event_time" ASC LIMIT 1000',
    ]);
  });

  it("keeps max 1000 multi-event SQLIDE queries as one websocket request", () => {
    const config = normalizeShushuQueryConfig({
      projectId: "33",
      eventTable: "ta.v_event_33",
      startDate: "2026-06-25",
      endDate: "2026-06-25",
      useEventNameFilter: true,
      eventNames: "click\nlevel_start\nitem_get",
      maxRows: 1000,
    });

    expect(buildShushuSqlideQuerySqls(config)).toEqual([
      'SELECT * FROM ta.v_event_33 WHERE "$part_date" >= \'2026-06-25\' AND "$part_date" <= \'2026-06-25\' AND "#event_name" IN (\'click\', \'level_start\', \'item_get\', \'item_use\', \'common_ad_event\') ORDER BY "#event_time" ASC LIMIT 1000',
    ]);
  });

  it("builds a lightweight SQL for listing current event names from Shushu", () => {
    const config = normalizeShushuQueryConfig({
      projectId: "33",
      eventTable: "ta.v_event_33",
      startDate: "2026-06-25",
      endDate: "2026-06-25",
      useEventNameFilter: true,
      eventNames: "click\nlevel_start",
      maxRows: 1000,
    });

    expect(buildShushuEventNamesSql(config)).toBe(
      'SELECT DISTINCT "#event_name" AS "#event_name" FROM ta.v_event_33 WHERE "$part_date" >= \'2026-06-25\' AND "$part_date" <= \'2026-06-25\' ORDER BY "#event_name" ASC LIMIT 1000',
    );
  });

  it("builds offset SQLIDE websocket batches for a selected event", () => {
    const config = normalizeShushuQueryConfig({
      projectId: "33",
      eventTable: "ta.v_event_33",
      startDate: "2026-06-25",
      endDate: "2026-06-25",
      maxRows: 100000,
    });

    expect(buildShushuSqlideBatchSql({
      config,
      eventName: "level_start",
      offset: 1000,
      limit: 5000,
    })).toBe(
      'SELECT * FROM ta.v_event_33 WHERE "$part_date" >= \'2026-06-25\' AND "$part_date" <= \'2026-06-25\' AND "#event_name" = \'level_start\' ORDER BY "#event_time" ASC OFFSET 1000 LIMIT 1000',
    );
  });

  it("builds offset SQLIDE websocket batches without event filter for all-event queries", () => {
    const config = normalizeShushuQueryConfig({
      projectId: "33",
      eventTable: "ta.v_event_33",
      startDate: "2026-06-25",
      endDate: "2026-06-25",
      maxRows: 4000,
    });

    expect(buildShushuSqlideBatchSql({
      config,
      offset: 1000,
      limit: 1000,
    })).toBe(
      'SELECT * FROM ta.v_event_33 WHERE "$part_date" >= \'2026-06-25\' AND "$part_date" <= \'2026-06-25\' ORDER BY "#event_time" ASC OFFSET 1000 LIMIT 1000',
    );
  });
});

describe("formatShushuQueryCountdown", () => {
  it("formats the 30 minute query timeout countdown", () => {
    expect(formatShushuQueryCountdown(30 * 60 * 1000)).toBe("30:00");
    expect(formatShushuQueryCountdown(29 * 60 * 1000 + 1000)).toBe("29:01");
    expect(formatShushuQueryCountdown(0)).toBe("0:00");
  });
});

describe("formatShushuQueryProgress", () => {
  it("includes progress, status, elapsed time, and remaining time", () => {
    expect(
      formatShushuQueryProgress({
        progress: 0,
        status: "RUNNING",
        elapsedMs: 12 * 1000,
        remainingMs: 29 * 60 * 1000 + 48 * 1000,
      }),
    ).toBe("数数计算中：0% ｜ 状态：RUNNING ｜ 已等待 0:12 ｜ 剩余 29:48");
  });

  it("adds a narrowing hint when progress stays at zero for a while", () => {
    expect(
      formatShushuQueryProgress({
        progress: 0,
        status: "RUNNING",
        elapsedMs: 61 * 1000,
        remainingMs: 29 * 60 * 1000,
      }),
    ).toContain("建议缩小日期、用户或事件范围");
  });
});

describe("formatShushuRowsProgress", () => {
  it("keeps the requested row target when the query returns fewer rows", () => {
    expect(formatShushuRowsProgress({ loadedRows: 2000, rowCount: 2000, requestedRows: 100000 })).toBe(
      "已读取 2,000 / 100,000 行",
    );
  });

  it("uses the platform row count when it is smaller than the requested limit", () => {
    expect(formatShushuRowsProgress({ loadedRows: 1200, rowCount: 1200, requestedRows: 100000 })).toBe(
      "已读取 1,200 / 1,200 行",
    );
  });
});

describe("validateShushuQueryScope", () => {
  it("requires a complete date range", () => {
    expect(validateShushuQueryScope({
      startDate: "",
      endDate: "",
      userId: "",
      appVersion: "",
      useEventNameFilter: false,
      eventNames: "",
    })).toContain("开始日期和结束日期");
  });

  it("requires at least one narrowing filter besides date", () => {
    expect(validateShushuQueryScope({
      startDate: "2026-06-25",
      endDate: "2026-06-25",
      userId: "",
      appVersion: "",
      useEventNameFilter: false,
      eventNames: "",
    })).toContain("用户 ID、事件名筛选或 app_version");
  });

  it("allows date range plus user id", () => {
    expect(validateShushuQueryScope({
      startDate: "2026-06-25",
      endDate: "2026-06-25",
      userId: "TEST_ACCOUNT_001",
      appVersion: "",
      useEventNameFilter: false,
      eventNames: "",
    })).toBeNull();
  });

  it("allows date range plus enabled event filter", () => {
    expect(validateShushuQueryScope({
      startDate: "2026-06-25",
      endDate: "2026-06-25",
      userId: "",
      appVersion: "",
      useEventNameFilter: true,
      eventNames: "level_start",
    })).toBeNull();
  });
});

describe("friendlyShushuErrorMessage", () => {
  it("explains operator type mismatch errors", () => {
    expect(
      friendlyShushuErrorMessage("Query failed (#1): line 1:109: Cannot apply operator: bigint = varchar(19)"),
    ).toContain("字段类型不匹配");
  });

  it("explains reversed operator type mismatch errors", () => {
    expect(
      friendlyShushuErrorMessage("Query failed (#1): line 1:112: Cannot apply operator: varchar = bigint"),
    ).toContain("字段类型不匹配");
  });

  it("explains OpenAPI SQL timeout errors", () => {
    expect(
      friendlyShushuErrorMessage(
        "java.util.concurrent.TimeoutException: Waited 35 seconds for SettableFuture",
        -1004,
      ),
    ).toContain("数数 OpenAPI 查询超时");
  });

  it("keeps long-running query countdown formatting stable", () => {
    expect(formatShushuQueryCountdown(90 * 1000)).toBe("1:30");
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

describe("SQLIDE websocket helpers", () => {
  it("normalizes SQLIDE websocket URLs", () => {
    expect(normalizeShushuSqlideWebSocketUrl(" wss://shu.deltafun.pro/v1/ta-websocket/query/abc ")).toBe(
      "wss://shu.deltafun.pro/v1/ta-websocket/query/abc",
    );
  });

  it("rejects non websocket SQLIDE URLs", () => {
    expect(() => normalizeShushuSqlideWebSocketUrl("https://shu.deltafun.pro/v1/ta-websocket/query/abc")).toThrow(
      "WebSocket 地址必须以 ws:// 或 wss:// 开头",
    );
  });

  it("builds the same message envelope as the web SQL editor", () => {
    const message = buildShushuSqlideMessage({
      requestId: "WS_SQLIDE@@test",
      projectId: "33",
      sql: "SELECT 1",
    });

    expect(message[0]).toBe("data");
    expect(message[1]).toMatchObject({
      requestId: "WS_SQLIDE@@test",
      projectId: 33,
      eventModel: 10,
      querySource: "module",
      searchSource: "model_search",
      isVisualInitialQuery: true,
      useCache: true,
      contentTranslate: "",
    });
    expect(JSON.parse(message[1].qp)).toEqual({
      events: { sql: "SELECT 1", sqlVoParams: [] },
      eventView: { sqlViewParams: [] },
      visualView: {
        groupBys: [],
        aggregates: [],
        filters: [],
        aggregateFilters: [],
        orderBys: [],
      },
    });
    expect(message[2]).toEqual({ channel: "ta" });
  });

  it("normalizes SQLIDE websocket result values into rows", () => {
    const normalized = normalizeShushuSqlideMessage([
      "data",
      {
        progress: 100,
        requestId: "WS_SQLIDE@@test",
        result: {
          data: {
            headers: ["#event_name", "level_id"],
            values: [["level_start", "1"], ["level_end", "2"]],
          },
          return_code: 0,
          return_message: "success",
        },
        status: "success",
      },
      { channel: "ta" },
    ]);

    expect(normalized).toEqual({
      requestId: "WS_SQLIDE@@test",
      progress: 100,
      status: "success",
      done: true,
      columns: ["#event_name", "level_id"],
      rows: [
        { "#event_name": "level_start", level_id: "1" },
        { "#event_name": "level_end", level_id: "2" },
      ],
      rowCount: 2,
      errorMessage: "",
    });
  });

  it("surfaces SQLIDE websocket result errors", () => {
    expect(() =>
      normalizeShushuSqlideMessage([
        "data",
        {
          progress: 100,
          requestId: "WS_SQLIDE@@test",
          result: {
            return_code: -1008,
            return_message: "bad sql",
          },
          status: "fail",
        },
      ]),
    ).toThrow("参数错误");
  });
});

describe("task metadata helpers", () => {
  it("extracts task id from submit response", () => {
    expect(extractShushuTaskId({ data: { taskId: "task-1" } })).toBe("task-1");
  });

  it("normalizes execute-sql metadata when the API returns a task instead of rows", () => {
    expect(
      normalizeShushuExecuteSqlMetadata({
        return_code: 0,
        return_message: "success",
        data: {
          taskId: "task-1",
          rowCount: 1200,
          pageCount: 2,
          headers: ["#event_name", "level_id"],
        },
      }),
    ).toEqual({
      taskId: "task-1",
      rowCount: 1200,
      pageCount: 2,
      columns: ["#event_name", "level_id"],
    });
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

describe("shushuResultPageIdsToRead", () => {
  it("reads enough OpenAPI result pages to satisfy the requested row limit", () => {
    expect(shushuResultPageIdsToRead({ pageCount: 100, pageSize: 1000, maxRows: 100000 })).toHaveLength(100);
  });

  it("does not read pages beyond the requested row limit", () => {
    expect(shushuResultPageIdsToRead({ pageCount: 100, pageSize: 1000, maxRows: 2500 })).toEqual([0, 1, 2]);
  });
});

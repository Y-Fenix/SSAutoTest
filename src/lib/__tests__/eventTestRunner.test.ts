import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { runEventTestCases } from "../eventTestRunner";
import type { RawRow } from "../types";

type ExternalEventTestCases = {
  runEventTestCases: (rows: RawRow[]) => ReturnType<typeof runEventTestCases>;
};

function loadExternalEventTestCases(): ExternalEventTestCases {
  const filePath = path.resolve(process.cwd(), "public/event-test-cases.js");
  const code = readFileSync(filePath, "utf8");
  const context = vm.createContext({}) as Record<string, unknown>;
  vm.runInContext(code, context, { filename: filePath });
  const runner = context.SSAutoTestEventTestCases as ExternalEventTestCases | undefined;
  if (typeof runner?.runEventTestCases !== "function") {
    throw new Error("public/event-test-cases.js 未暴露 runEventTestCases。");
  }
  return runner;
}

describe("event test case loader", () => {
  it("does not keep hard-coded test rules in the app bundle", () => {
    const report = runEventTestCases([{ "#event_name": "item_get" }]);

    expect(report.totalRules).toBe(0);
    expect(report.loadStatus).toBe("missing");
    expect(report.loadMessage).toContain("public/event-test-cases.js");
  });
});

describe("public/event-test-cases.js", () => {
  const externalCases = loadExternalEventTestCases();

  it("reports item_get magic count when no item_use appears between gets", () => {
    const rows: RawRow[] = [
      { "#event_name": "item_get", "#event_time": "2026-06-25 10:00:00", "#account_id": "1001", is_gm: "1", item_info: "magic", item_count_now: "5" },
      { "#event_name": "level_start", "#event_time": "2026-06-25 10:00:01" },
      { "#event_name": "item_get", "#event_time": "2026-06-25 10:00:02", "#account_id": "1001", is_gm: "1", item_info: "magic", item_count_now: "5" },
    ];

    const report = externalCases.runEventTestCases(rows);

    expect(report.results).toContainEqual(
      expect.objectContaining({
        ruleId: "TC-ITEM-GET-MAGIC-COUNT",
        status: "测试不通过",
        issueCount: 1,
      }),
    );
    expect(report.issues).toEqual([
      expect.objectContaining({
        ruleId: "TC-ITEM-GET-MAGIC-COUNT",
        eventName: "item_get",
        displayLines: [
          "account_id=1001，is_gm=1 -->2026/06/25/10:00:02：item_info=magic，item_count_now = 5；",
          "account_id=1001，is_gm=1 -->2026/06/25/10:00:00：item_info=magic，item_count_now = 5；",
        ],
      }),
    ]);
  });

  it("does not compare event logic across different account_id values", () => {
    const rows: RawRow[] = [
      { "#event_name": "item_get", "#event_time": "2026-06-25 10:00:00", "#account_id": "1001", is_gm: "0", item_info: "magic", item_count_now: "5" },
      { "#event_name": "item_get", "#event_time": "2026-06-25 10:00:01", "#account_id": "1002", is_gm: "0", item_info: "magic", item_count_now: "1" },
      { "#event_name": "item_get", "#event_time": "2026-06-25 10:00:02", "#account_id": "1001", is_gm: "0", item_info: "magic", item_count_now: "6" },
      { "#event_name": "item_get", "#event_time": "2026-06-25 10:00:03", "#account_id": "1002", is_gm: "0", item_info: "magic", item_count_now: "2" },
    ];

    const result = externalCases.runEventTestCases(rows).results.find((item) => item.ruleId === "TC-ITEM-GET-MAGIC-COUNT");

    expect(result).toEqual(expect.objectContaining({
      status: "测试通过",
      issueCount: 0,
      checkedCount: 4,
    }));
  });

  it("does not report item_get magic count when item_use appears between gets for the same account", () => {
    const rows: RawRow[] = [
      { "#event_name": "item_get", "#event_time": "2026/06/25/10:00:00", "#account_id": "1001", is_gm: "0", item_info: "magic", item_count_now: "5" },
      { "#event_name": "item_use", "#event_time": "2026/06/25/10:00:01", "#account_id": "1001", is_gm: "0", item_type: "magic", item_count_now: "4" },
      { "#event_name": "item_get", "#event_time": "2026/06/25/10:00:02", "#account_id": "1001", is_gm: "0", item_info: "magic", item_count_now: "5" },
    ];

    const result = externalCases.runEventTestCases(rows).results.find((item) => item.ruleId === "TC-ITEM-GET-MAGIC-COUNT");

    expect(result).toEqual(expect.objectContaining({
      status: "测试通过",
      issueCount: 0,
      checkedCount: 2,
    }));
  });

  it("labels fallback user id values as user id instead of account id", () => {
    const rows: RawRow[] = [
      { "#event_name": "item_get", "#event_time": "2026-06-25 10:00:00", "#user_id": "900000000000000002", is_gm: "1", item_info: "magic", item_count_now: "5" },
      { "#event_name": "item_get", "#event_time": "2026-06-25 10:00:02", "#user_id": "900000000000000002", is_gm: "1", item_info: "magic", item_count_now: "5" },
    ];

    const issue = externalCases.runEventTestCases(rows).issues[0];

    expect(issue.displayLines?.[0]).toContain("#user_id=900000000000000002");
    expect(issue.displayLines?.[0]).not.toContain("account_id=900000000000000002");
  });

  it("passes item_get ad source when a valid common_ad_event appears in previous five events", () => {
    const rows: RawRow[] = [
      { "#event_name": "common_ad_event", account_id: "2001", type: "video", action: "revenue", scene: "商城magic" },
      { "#event_name": "level_start", account_id: "2001" },
      { "#event_name": "item_get", account_id: "2001", item_source: "激励广告获取" },
    ];

    const report = externalCases.runEventTestCases(rows);

    expect(report.results).toContainEqual(
      expect.objectContaining({
        ruleId: "TC-ITEM-GET-AD-SOURCE",
        status: "测试通过",
        checkedCount: 1,
        issueCount: 0,
      }),
    );
  });

  it("reports item_get ad source when no valid common_ad_event appears in previous five events", () => {
    const rows: RawRow[] = [
      { "#event_name": "common_ad_event", type: "video", action: "click", scene: "商城magic" },
      { "#event_name": "item_get", "#event_time": "2026-06-25 00:09:33", account_id: "2002", is_gm: "0", item_source: "激励广告获取" },
    ];

    expect(externalCases.runEventTestCases(rows).issues[0]).toEqual(
      expect.objectContaining({
        ruleId: "TC-ITEM-GET-AD-SOURCE",
        eventName: "item_get",
        displayLines: [
          "account_id=2002，is_gm=0 -->2026/06/25/00:09:33：item_source=激励广告获取；未找到符合条件的 common_ad_event",
        ],
      }),
    );
  });

  it("ignores item_get ad source issues in the first 10 seconds of a day", () => {
    const rows: RawRow[] = [
      { "#event_name": "item_get", "#event_time": "2026-06-25 00:00:00", account_id: "2001", is_gm: "0", item_source: "激励广告获取" },
      { "#event_name": "item_get", "#event_time": "2026-06-25 00:00:10", account_id: "2002", is_gm: "0", item_source: "激励广告获取" },
      { "#event_name": "item_get", "#event_time": "2026-06-25 00:00:11", account_id: "2003", is_gm: "0", item_source: "激励广告获取" },
    ];

    const result = externalCases.runEventTestCases(rows).results.find((item) => item.ruleId === "TC-ITEM-GET-AD-SOURCE");

    expect(result).toEqual(expect.objectContaining({
      status: "测试不通过",
      checkedCount: 3,
      issueCount: 1,
    }));
    expect(result?.issues[0].displayLines?.[0]).toContain("2026/06/25/00:00:11");
  });

  it("reports item_use magic count when an item_get appears between uses", () => {
    const rows: RawRow[] = [
      { "#event_name": "item_use", account_id: "4004", item_type: "magic", item_count_now: "4" },
      { "#event_name": "item_get", account_id: "4004", item_info: "magic", item_count_now: "5" },
      { "#event_name": "item_use", account_id: "4004", item_type: "magic", item_count_now: "4" },
    ];

    expect(externalCases.runEventTestCases(rows).issues[0]).toEqual(
      expect.objectContaining({
        ruleId: "TC-ITEM-USE-MAGIC-COUNT",
        eventName: "item_use",
      }),
    );
  });

  it("reports level mode sequence issues for configured level events", () => {
    const rows: RawRow[] = [
      { "#event_name": "level_start", "#event_time": "2026-06-25 10:47:12", "#account_id": "3003", is_gm: "0", level_type: "Easy", level_mode_id: "2" },
      { "#event_name": "level_start", "#event_time": "2026-06-25 11:06:31", "#account_id": "3003", is_gm: "0", level_type: "Easy", level_mode_id: "5" },
      { "#event_name": "level_start", "#event_time": "2026-06-25 11:06:44", "#account_id": "3003", is_gm: "0", level_type: "Easy", level_mode_id: "6" },
      { "#event_name": "level_start", "#event_time": "2026-06-25 16:05:28", "#account_id": "3003", is_gm: "0", level_type: "Easy", level_mode_id: "16" },
      { "#event_name": "level_end", level_type: "Hard", level_mode_id: "20" },
      { "#event_name": "level_end", level_type: "Hard", level_mode_id: "21" },
    ];

    const report = externalCases.runEventTestCases(rows);

    expect(report.issues).toEqual([
      expect.objectContaining({
        ruleId: "TC-LEVEL-START-MODE-SEQUENCE",
        eventName: "level_start",
        displayLines: [
          "account_id=3003，is_gm=0 -->2026/06/25/11:06:31：type=Easy，level_mode_id = 5；",
          "account_id=3003，is_gm=0 -->2026/06/25/10:47:12：type=Easy，level_mode_id = 2；",
        ],
      }),
      expect.objectContaining({
        ruleId: "TC-LEVEL-START-MODE-SEQUENCE",
        eventName: "level_start",
        displayLines: [
          "account_id=3003，is_gm=0 -->2026/06/25/16:05:28：type=Easy，level_mode_id = 16；",
          "account_id=3003，is_gm=0 -->2026/06/25/11:06:44：type=Easy，level_mode_id = 6；",
        ],
      }),
    ]);
    expect(report.results).toContainEqual(
      expect.objectContaining({
        ruleId: "TC-LEVEL-END-MODE-SEQUENCE",
        status: "测试通过",
        checkedCount: 2,
      }),
    );
  });

  it("allows level_lose level_mode_id to stay the same and reports only decreases", () => {
    const rows: RawRow[] = [
      { "#event_name": "level_lose", "#event_time": "2026-06-25 10:00:00", "#account_id": "5005", is_gm: "0", level_type: "Jigsaw", level_mode_id: "10" },
      { "#event_name": "level_lose", "#event_time": "2026-06-25 10:00:01", "#account_id": "5005", is_gm: "0", level_type: "Jigsaw", level_mode_id: "10" },
      { "#event_name": "level_lose", "#event_time": "2026-06-25 10:00:02", "#account_id": "5005", is_gm: "0", level_type: "Jigsaw", level_mode_id: "9" },
    ];

    const result = externalCases.runEventTestCases(rows).results.find((item) => item.ruleId === "TC-LEVEL-LOSE-MODE-SEQUENCE");

    expect(result).toEqual(expect.objectContaining({
      status: "测试不通过",
      checkedCount: 3,
      issueCount: 1,
    }));
    expect(result?.issues[0]).toEqual(expect.objectContaining({
      expected: "level_mode_id >= 10",
      actual: "level_mode_id = 9",
    }));
  });

  it("returns one display row for every configured test case", () => {
    const report = externalCases.runEventTestCases([]);

    expect(report.totalRules).toBe(7);
    expect(report.results.map((result) => result.ruleId)).toEqual([
      "TC-ITEM-GET-MAGIC-COUNT",
      "TC-ITEM-GET-AD-SOURCE",
      "TC-ITEM-USE-MAGIC-COUNT",
      "TC-LEVEL-START-MODE-SEQUENCE",
      "TC-LEVEL-LOSE-MODE-SEQUENCE",
      "TC-LEVEL-END-MODE-SEQUENCE",
      "TC-LEVEL-END-EXTRA-MODE-SEQUENCE",
    ]);
    expect(report.results.every((result) => result.status === "测试通过")).toBe(true);
  });
});

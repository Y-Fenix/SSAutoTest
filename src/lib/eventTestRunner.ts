import type { RawRow } from "./types";

export interface EventTestIssue {
  ruleId: string;
  ruleName: string;
  eventName: string;
  rowIndex: number;
  expected: string;
  actual: string;
  detail: string;
  displayLines?: string[];
}

export interface EventTestCaseResult {
  ruleId: string;
  ruleName: string;
  status: "测试通过" | "测试不通过";
  checkedCount: number;
  issueCount: number;
  issues: EventTestIssue[];
}

export interface EventTestReport {
  totalRules: number;
  checkedRows: number;
  issueCount: number;
  issues: EventTestIssue[];
  results: EventTestCaseResult[];
}

type ExternalEventTestCases = {
  runEventTestCases?: (rows: RawRow[]) => EventTestReport;
};

declare global {
  interface Window {
    SSAutoTestEventTestCases?: ExternalEventTestCases;
  }
}

const levelTypes = new Set(["Easy", "Normal", "Hard", "Daily", "Jigsaw", "LimitActivity", "Learning"]);
const levelSequenceEvents = new Map([
  ["level_start", "TC-LEVEL-START-MODE-SEQUENCE"],
  ["level_lose", "TC-LEVEL-LOSE-MODE-SEQUENCE"],
  ["level_end", "TC-LEVEL-END-MODE-SEQUENCE"],
  ["level_end_extra", "TC-LEVEL-END-EXTRA-MODE-SEQUENCE"],
]);

function text(row: RawRow, key: string): string {
  const value = row[key];
  return value === undefined || value === null ? "" : String(value).trim();
}

function numberValue(row: RawRow, key: string): number | null {
  const parsed = Number(text(row, key));
  return Number.isFinite(parsed) ? parsed : null;
}

function eventName(row: RawRow): string {
  return text(row, "#event_name") || text(row, "event_name") || text(row, "事件名") || text(row, "event");
}

function parseEventTimestamp(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return Number.POSITIVE_INFINITY;

  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) return Number.POSITIVE_INFINITY;
    return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  }

  const normalized = trimmed
    .replace(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\/(\d{1,2}:\d{1,2}:\d{1,2})/, "$1/$2/$3 $4")
    .replace(" ", "T");
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function eventTime(row: RawRow): number {
  const raw = text(row, "#event_time") || text(row, "event_time") || text(row, "事件时间");
  return parseEventTimestamp(raw);
}

function eventSecondOfDay(row: RawRow): number | null {
  const raw = text(row, "#event_time") || text(row, "event_time") || text(row, "事件时间");
  const matched = raw.match(/(?:^|\D)(\d{1,2}):(\d{1,2}):(\d{1,2})(?:\D|$)/);
  if (matched) {
    return Number(matched[1]) * 3600 + Number(matched[2]) * 60 + Number(matched[3]);
  }
  const parsed = eventTime(row);
  if (!Number.isFinite(parsed)) return null;
  const date = new Date(parsed);
  return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
}

function isInDayStartTruncationWindow(row: RawRow): boolean {
  const secondOfDay = eventSecondOfDay(row);
  return secondOfDay !== null && secondOfDay >= 0 && secondOfDay <= 10;
}

function formatEventTime(row: RawRow): string {
  const raw = text(row, "#event_time") || text(row, "event_time") || text(row, "事件时间");
  const matched = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{1,2}):(\d{1,2})/);
  if (matched) {
    return `${matched[1]}/${matched[2].padStart(2, "0")}/${matched[3].padStart(2, "0")}/${matched[4].padStart(2, "0")}:${matched[5].padStart(2, "0")}:${matched[6].padStart(2, "0")}`;
  }
  const parsed = parseEventTimestamp(raw);
  if (!Number.isFinite(parsed)) return "时间缺失";
  const date = new Date(parsed);
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}/${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}

function accountIdentity(row: RawRow): { label: string; value: string } {
  const accountValue = text(row, "#account_id") || text(row, "account_id");
  if (accountValue) return { label: "account_id", value: accountValue };

  const hashUserId = text(row, "#user_id");
  if (hashUserId) return { label: "#user_id", value: hashUserId };

  const userId = text(row, "user_id");
  if (userId) return { label: "user_id", value: userId };

  return { label: "account_id", value: "-" };
}

function accountId(row: RawRow): string {
  return accountIdentity(row).value;
}

function accountDisplay(row: RawRow): string {
  const identity = accountIdentity(row);
  return `${identity.label}=${identity.value}`;
}

function isGm(row: RawRow): string {
  return text(row, "is_gm") || text(row, "#is_gm") || "-";
}

function buildComparisonLine(
  row: RawRow,
  keyProperty: string,
  valueProperty: string,
  value: number | string,
): string {
  const keyValue = text(row, keyProperty);
  const keyPart = keyValue ? `${keyProperty.replace(/^level_/, "")}=${keyValue}，` : "";
  return `${accountDisplay(row)}，is_gm=${isGm(row)} -->${formatEventTime(row)}：${keyPart}${valueProperty} = ${value}；`;
}

function buildSingleEventLine(row: RawRow, properties: string[], detail: string): string {
  const propertyText = properties
    .map((property) => {
      const value = text(row, property);
      return value ? `${property}=${value}` : "";
    })
    .filter(Boolean)
    .join("，");
  const suffix = propertyText ? `${propertyText}；${detail}` : detail;
  return `${accountDisplay(row)}，is_gm=${isGm(row)} -->${formatEventTime(row)}：${suffix}`;
}

function sortRows(rows: RawRow[]) {
  return rows
    .map((row, index) => ({ row, originalIndex: index }))
    .sort((a, b) => eventTime(a.row) - eventTime(b.row) || a.originalIndex - b.originalIndex);
}

function makeIssue(params: Omit<EventTestIssue, "actual"> & { actual?: string }): EventTestIssue {
  return {
    ...params,
    actual: params.actual ?? "-",
  };
}

function hasItemUseBetween(rows: Array<{ row: RawRow }>, startExclusive: number, endExclusive: number): boolean {
  return rows.slice(startExclusive + 1, endExclusive).some(({ row }) => eventName(row) === "item_use");
}

function hasItemGetBetween(rows: Array<{ row: RawRow }>, startExclusive: number, endExclusive: number): boolean {
  return rows.slice(startExclusive + 1, endExclusive).some(({ row }) => eventName(row) === "item_get");
}

function hasValidAdEventInPreviousFive(rows: Array<{ row: RawRow }>, index: number): boolean {
  return rows.slice(Math.max(0, index - 5), index).some(({ row }) => {
    if (eventName(row) !== "common_ad_event") return false;
    const action = text(row, "action");
    const scene = text(row, "scene") || text(row, "scence") || text(row, "reward_scene");
    return (
      text(row, "type") === "video" &&
      (action === "revenue" || action === "impression") &&
      (scene === "商城magic" || scene === "关内hint")
    );
  });
}

function checkItemGetMagicCount(rows: Array<{ row: RawRow; originalIndex: number }>) {
  const issues: EventTestIssue[] = [];
  let checkedCount = 0;
  let previousMagicGet: { index: number; count: number; originalIndex: number; row: RawRow } | null = null;

  rows.forEach(({ row, originalIndex }, index) => {
    if (eventName(row) !== "item_get" || text(row, "item_info") !== "magic") return;
    checkedCount += 1;
    const currentCount = numberValue(row, "item_count_now");
    if (
      previousMagicGet &&
      !hasItemUseBetween(rows, previousMagicGet.index, index) &&
      currentCount !== null &&
      currentCount <= previousMagicGet.count
    ) {
      issues.push(makeIssue({
        ruleId: "TC-ITEM-GET-MAGIC-COUNT",
        ruleName: "item_get magic 数量递增",
        eventName: "item_get",
        rowIndex: originalIndex + 1,
        expected: "当前 item_count_now 必须大于上次 item_get 的 item_count_now",
        actual: `${currentCount} <= ${previousMagicGet.count}`,
        detail: `上次 item_get 行：${previousMagicGet.originalIndex + 1}`,
        displayLines: [
          buildComparisonLine(row, "item_info", "item_count_now", currentCount),
          buildComparisonLine(previousMagicGet.row, "item_info", "item_count_now", previousMagicGet.count),
        ],
      }));
    }
    if (currentCount !== null) previousMagicGet = { index, count: currentCount, originalIndex, row };
  });

  return makeCaseResult("TC-ITEM-GET-MAGIC-COUNT", "item_get magic 数量递增", checkedCount, issues);
}

function checkItemGetAdSource(rows: Array<{ row: RawRow; originalIndex: number }>) {
  let checkedCount = 0;
  const issues = rows.flatMap(({ row, originalIndex }, index) => {
    if (eventName(row) !== "item_get" || text(row, "item_source") !== "激励广告获取") return [];
    checkedCount += 1;
    if (isInDayStartTruncationWindow(row)) return [];
    if (hasValidAdEventInPreviousFive(rows, index)) return [];
    return [
      makeIssue({
        ruleId: "TC-ITEM-GET-AD-SOURCE",
        ruleName: "激励广告获取前置广告事件",
        eventName: "item_get",
        rowIndex: originalIndex + 1,
        expected: "前 5 条事件内出现 common_ad_event，type=video，action=revenue/impression，scene=商城magic/关内hint",
        actual: "未找到符合条件的 common_ad_event",
        detail: "请检查广告事件是否漏报或顺序异常。",
        displayLines: [
          buildSingleEventLine(row, ["item_source"], "未找到符合条件的 common_ad_event"),
        ],
      }),
    ];
  });
  return makeCaseResult("TC-ITEM-GET-AD-SOURCE", "激励广告获取前置广告事件", checkedCount, issues);
}

function checkItemUseMagicCount(rows: Array<{ row: RawRow; originalIndex: number }>) {
  const issues: EventTestIssue[] = [];
  let checkedCount = 0;
  let previousMagicUse: { index: number; count: number; originalIndex: number; row: RawRow } | null = null;

  rows.forEach(({ row, originalIndex }, index) => {
    if (eventName(row) !== "item_use" || text(row, "item_type") !== "magic") return;
    checkedCount += 1;
    const currentCount = numberValue(row, "item_count_now");
    if (
      previousMagicUse &&
      hasItemGetBetween(rows, previousMagicUse.index, index) &&
      currentCount !== null &&
      currentCount >= previousMagicUse.count
    ) {
      issues.push(makeIssue({
        ruleId: "TC-ITEM-USE-MAGIC-COUNT",
        ruleName: "item_use magic 数量递减",
        eventName: "item_use",
        rowIndex: originalIndex + 1,
        expected: "当前 item_count_now 必须小于上次 item_use 的 item_count_now",
        actual: `${currentCount} >= ${previousMagicUse.count}`,
        detail: `上次 item_use 行：${previousMagicUse.originalIndex + 1}`,
        displayLines: [
          buildComparisonLine(row, "item_type", "item_count_now", currentCount),
          buildComparisonLine(previousMagicUse.row, "item_type", "item_count_now", previousMagicUse.count),
        ],
      }));
    }
    if (currentCount !== null) previousMagicUse = { index, count: currentCount, originalIndex, row };
  });

  return makeCaseResult("TC-ITEM-USE-MAGIC-COUNT", "item_use magic 数量递减", checkedCount, issues);
}

function checkLevelModeSequences(rows: Array<{ row: RawRow; originalIndex: number }>) {
  const issues: EventTestIssue[] = [];
  const checkedCounts = new Map<string, number>();
  const previousByEvent = new Map<string, { modeId: number; originalIndex: number; row: RawRow }>();

  rows.forEach(({ row, originalIndex }) => {
    const name = eventName(row);
    const ruleId = levelSequenceEvents.get(name);
    if (!ruleId || !levelTypes.has(text(row, "level_type"))) return;
    checkedCounts.set(name, (checkedCounts.get(name) ?? 0) + 1);
    const modeId = numberValue(row, "level_mode_id");
    if (modeId === null) return;
    const previous = previousByEvent.get(name);
    const expectsNonDecreasing = name === "level_lose";
    const isInvalid = previous && (expectsNonDecreasing ? modeId < previous.modeId : modeId !== previous.modeId + 1);
    if (previous && isInvalid) {
      issues.push(makeIssue({
        ruleId,
        ruleName: expectsNonDecreasing ? `${name} level_mode_id 不递减` : `${name} level_mode_id 连续递增`,
        eventName: name,
        rowIndex: originalIndex + 1,
        expected: expectsNonDecreasing ? `level_mode_id >= ${previous.modeId}` : `level_mode_id = ${previous.modeId + 1}`,
        actual: `level_mode_id = ${modeId}`,
        detail: `上次 ${name} 行：${previous.originalIndex + 1}`,
        displayLines: [
          buildComparisonLine(row, "level_type", "level_mode_id", modeId),
          buildComparisonLine(previous.row, "level_type", "level_mode_id", previous.modeId),
        ],
      }));
    }
    previousByEvent.set(name, { modeId, originalIndex, row });
  });

  return [...levelSequenceEvents.entries()].map(([name, ruleId]) =>
    makeCaseResult(
      ruleId,
      name === "level_lose" ? `${name} level_mode_id 不递减` : `${name} level_mode_id 连续递增`,
      checkedCounts.get(name) ?? 0,
      issues.filter((issue) => issue.ruleId === ruleId),
    ),
  );
}

function makeCaseResult(
  ruleId: string,
  ruleName: string,
  checkedCount: number,
  issues: EventTestIssue[],
): EventTestCaseResult {
  return {
    ruleId,
    ruleName,
    status: issues.length > 0 ? "测试不通过" : "测试通过",
    checkedCount,
    issueCount: issues.length,
    issues,
  };
}

function sortIndexedRows(rows: Array<{ row: RawRow; originalIndex: number }>) {
  return [...rows].sort((a, b) => eventTime(a.row) - eventTime(b.row) || a.originalIndex - b.originalIndex);
}

function runEventTestCasesForRows(rows: Array<{ row: RawRow; originalIndex: number }>): EventTestCaseResult[] {
  const sortedRows = sortIndexedRows(rows);
  return [
    checkItemGetMagicCount(sortedRows),
    checkItemGetAdSource(sortedRows),
    checkItemUseMagicCount(sortedRows),
    ...checkLevelModeSequences(sortedRows),
  ];
}

function mergeCaseResults(resultGroups: EventTestCaseResult[][]): EventTestCaseResult[] {
  const merged = new Map<string, EventTestCaseResult>();

  resultGroups.flat().forEach((result) => {
    const current = merged.get(result.ruleId);
    if (!current) {
      merged.set(result.ruleId, { ...result, issues: [...result.issues] });
      return;
    }
    current.checkedCount += result.checkedCount;
    current.issues.push(...result.issues);
    current.issueCount = current.issues.length;
    current.status = current.issueCount > 0 ? "测试不通过" : "测试通过";
  });

  return runEventTestCasesForRows([]).map((emptyResult) => {
    const result = merged.get(emptyResult.ruleId);
    if (!result) return emptyResult;
    return {
      ...result,
      issues: result.issues.sort((a, b) => a.rowIndex - b.rowIndex || a.ruleId.localeCompare(b.ruleId)),
    };
  });
}

function groupRowsByAccount(rows: RawRow[]) {
  const groups = new Map<string, Array<{ row: RawRow; originalIndex: number }>>();
  rows.forEach((row, originalIndex) => {
    const identity = accountIdentity(row);
    const key = identity.value === "-" ? `__missing_account__:${groups.size}` : `${identity.label}:${identity.value}`;
    groups.set(key, [...(groups.get(key) ?? []), { row, originalIndex }]);
  });
  return [...groups.values()];
}

function runBuiltInEventTestCases(rows: RawRow[]): EventTestReport {
  const results = mergeCaseResults(
    groupRowsByAccount(rows).map((groupRows) => runEventTestCasesForRows(groupRows)),
  );
  const issues = results
    .flatMap((result) => result.issues)
    .sort((a, b) => a.rowIndex - b.rowIndex || a.ruleId.localeCompare(b.ruleId));

  return {
    totalRules: results.length,
    checkedRows: rows.length,
    issueCount: issues.length,
    issues,
    results,
  };
}

export function runEventTestCases(rows: RawRow[]): EventTestReport {
  const externalRunner = typeof window === "undefined" ? undefined : window.SSAutoTestEventTestCases?.runEventTestCases;
  if (typeof externalRunner === "function") {
    try {
      return externalRunner(rows);
    } catch (error) {
      console.warn("外部测试用例文件执行失败，已回退到内置测试用例。", error);
    }
  }
  return runBuiltInEventTestCases(rows);
}

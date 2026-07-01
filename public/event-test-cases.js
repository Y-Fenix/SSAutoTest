// 埋点测试用例规则文件。部署后如需更新测试用例，只替换本文件并刷新页面即可。
// 必须暴露 window.SSAutoTestEventTestCases.runEventTestCases(rows)。
var SSAutoTestEventTestCases = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  var eventTestRunner_external_exports = {};
  __export(eventTestRunner_external_exports, {
    runEventTestCases: () => runEventTestCases
  });
  var levelTypes = /* @__PURE__ */ new Set(["Easy", "Normal", "Hard", "Daily", "Jigsaw", "LimitActivity", "Learning"]);
  var levelSequenceEvents = /* @__PURE__ */ new Map([
    ["level_start", "TC-LEVEL-START-MODE-SEQUENCE"],
    ["level_lose", "TC-LEVEL-LOSE-MODE-SEQUENCE"],
    ["level_end", "TC-LEVEL-END-MODE-SEQUENCE"],
    ["level_end_extra", "TC-LEVEL-END-EXTRA-MODE-SEQUENCE"]
  ]);
  function text(row, key) {
    const value = row[key];
    return value === void 0 || value === null ? "" : String(value).trim();
  }
  function numberValue(row, key) {
    const parsed = Number(text(row, key));
    return Number.isFinite(parsed) ? parsed : null;
  }
  function eventName(row) {
    return text(row, "#event_name") || text(row, "event_name") || text(row, "\u4E8B\u4EF6\u540D") || text(row, "event");
  }
  function parseEventTimestamp(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return Number.POSITIVE_INFINITY;
    if (/^\d+$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (!Number.isFinite(numeric)) return Number.POSITIVE_INFINITY;
      return numeric > 1e12 ? numeric : numeric * 1e3;
    }
    const normalized = trimmed.replace(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\/(\d{1,2}:\d{1,2}:\d{1,2})/, "$1/$2/$3 $4").replace(" ", "T");
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
  }
  function eventTime(row) {
    const raw = text(row, "#event_time") || text(row, "event_time") || text(row, "\u4E8B\u4EF6\u65F6\u95F4");
    return parseEventTimestamp(raw);
  }
  function eventSecondOfDay(row) {
    const raw = text(row, "#event_time") || text(row, "event_time") || text(row, "\u4E8B\u4EF6\u65F6\u95F4");
    const matched = raw.match(/(?:^|\D)(\d{1,2}):(\d{1,2}):(\d{1,2})(?:\D|$)/);
    if (matched) {
      return Number(matched[1]) * 3600 + Number(matched[2]) * 60 + Number(matched[3]);
    }
    const parsed = eventTime(row);
    if (!Number.isFinite(parsed)) return null;
    const date = new Date(parsed);
    return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
  }
  function isInDayStartTruncationWindow(row) {
    const secondOfDay = eventSecondOfDay(row);
    return secondOfDay !== null && secondOfDay >= 0 && secondOfDay <= 10;
  }
  function formatEventTime(row) {
    const raw = text(row, "#event_time") || text(row, "event_time") || text(row, "\u4E8B\u4EF6\u65F6\u95F4");
    const matched = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{1,2}):(\d{1,2})/);
    if (matched) {
      return `${matched[1]}/${matched[2].padStart(2, "0")}/${matched[3].padStart(2, "0")}/${matched[4].padStart(2, "0")}:${matched[5].padStart(2, "0")}:${matched[6].padStart(2, "0")}`;
    }
    const parsed = parseEventTimestamp(raw);
    if (!Number.isFinite(parsed)) return "\u65F6\u95F4\u7F3A\u5931";
    const date = new Date(parsed);
    return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}/${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
  }
  function accountIdentity(row) {
    const accountValue = text(row, "#account_id") || text(row, "account_id");
    if (accountValue) return { label: "account_id", value: accountValue };
    const hashUserId = text(row, "#user_id");
    if (hashUserId) return { label: "#user_id", value: hashUserId };
    const userId = text(row, "user_id");
    if (userId) return { label: "user_id", value: userId };
    return { label: "account_id", value: "-" };
  }
  function accountDisplay(row) {
    const identity = accountIdentity(row);
    return `${identity.label}=${identity.value}`;
  }
  function isGm(row) {
    return text(row, "is_gm") || text(row, "#is_gm") || "-";
  }
  function buildComparisonLine(row, keyProperty, valueProperty, value) {
    const keyValue = text(row, keyProperty);
    const keyPart = keyValue ? `${keyProperty.replace(/^level_/, "")}=${keyValue}\uFF0C` : "";
    return `${accountDisplay(row)}\uFF0Cis_gm=${isGm(row)} -->${formatEventTime(row)}\uFF1A${keyPart}${valueProperty} = ${value}\uFF1B`;
  }
  function buildSingleEventLine(row, properties, detail) {
    const propertyText = properties.map((property) => {
      const value = text(row, property);
      return value ? `${property}=${value}` : "";
    }).filter(Boolean).join("\uFF0C");
    const suffix = propertyText ? `${propertyText}\uFF1B${detail}` : detail;
    return `${accountDisplay(row)}\uFF0Cis_gm=${isGm(row)} -->${formatEventTime(row)}\uFF1A${suffix}`;
  }
  function makeIssue(params) {
    return {
      ...params,
      actual: params.actual ?? "-"
    };
  }
  function hasItemUseBetween(rows, startExclusive, endExclusive) {
    return rows.slice(startExclusive + 1, endExclusive).some(({ row }) => eventName(row) === "item_use");
  }
  function hasItemGetBetween(rows, startExclusive, endExclusive) {
    return rows.slice(startExclusive + 1, endExclusive).some(({ row }) => eventName(row) === "item_get");
  }
  function hasValidAdEventInPreviousFive(rows, index) {
    return rows.slice(Math.max(0, index - 5), index).some(({ row }) => {
      if (eventName(row) !== "common_ad_event") return false;
      const action = text(row, "action");
      const scene = text(row, "scene") || text(row, "scence") || text(row, "reward_scene");
      return text(row, "type") === "video" && (action === "revenue" || action === "impression") && (scene === "\u5546\u57CEmagic" || scene === "\u5173\u5185hint");
    });
  }
  function checkItemGetMagicCount(rows) {
    const issues = [];
    let checkedCount = 0;
    let previousMagicGet = null;
    rows.forEach(({ row, originalIndex }, index) => {
      if (eventName(row) !== "item_get" || text(row, "item_info") !== "magic") return;
      checkedCount += 1;
      const currentCount = numberValue(row, "item_count_now");
      if (previousMagicGet && !hasItemUseBetween(rows, previousMagicGet.index, index) && currentCount !== null && currentCount <= previousMagicGet.count) {
        issues.push(makeIssue({
          ruleId: "TC-ITEM-GET-MAGIC-COUNT",
          ruleName: "item_get magic \u6570\u91CF\u9012\u589E",
          eventName: "item_get",
          rowIndex: originalIndex + 1,
          expected: "\u5F53\u524D item_count_now \u5FC5\u987B\u5927\u4E8E\u4E0A\u6B21 item_get \u7684 item_count_now",
          actual: `${currentCount} <= ${previousMagicGet.count}`,
          detail: `\u4E0A\u6B21 item_get \u884C\uFF1A${previousMagicGet.originalIndex + 1}`,
          displayLines: [
            buildComparisonLine(row, "item_info", "item_count_now", currentCount),
            buildComparisonLine(previousMagicGet.row, "item_info", "item_count_now", previousMagicGet.count)
          ]
        }));
      }
      if (currentCount !== null) previousMagicGet = { index, count: currentCount, originalIndex, row };
    });
    return makeCaseResult("TC-ITEM-GET-MAGIC-COUNT", "item_get magic \u6570\u91CF\u9012\u589E", checkedCount, issues);
  }
  function checkItemGetAdSource(rows) {
    let checkedCount = 0;
    const issues = rows.flatMap(({ row, originalIndex }, index) => {
      if (eventName(row) !== "item_get" || text(row, "item_source") !== "\u6FC0\u52B1\u5E7F\u544A\u83B7\u53D6") return [];
      checkedCount += 1;
      if (isInDayStartTruncationWindow(row)) return [];
      if (hasValidAdEventInPreviousFive(rows, index)) return [];
      return [
        makeIssue({
          ruleId: "TC-ITEM-GET-AD-SOURCE",
          ruleName: "\u6FC0\u52B1\u5E7F\u544A\u83B7\u53D6\u524D\u7F6E\u5E7F\u544A\u4E8B\u4EF6",
          eventName: "item_get",
          rowIndex: originalIndex + 1,
          expected: "\u524D 5 \u6761\u4E8B\u4EF6\u5185\u51FA\u73B0 common_ad_event\uFF0Ctype=video\uFF0Caction=revenue/impression\uFF0Cscene=\u5546\u57CEmagic/\u5173\u5185hint",
          actual: "\u672A\u627E\u5230\u7B26\u5408\u6761\u4EF6\u7684 common_ad_event",
          detail: "\u8BF7\u68C0\u67E5\u5E7F\u544A\u4E8B\u4EF6\u662F\u5426\u6F0F\u62A5\u6216\u987A\u5E8F\u5F02\u5E38\u3002",
          displayLines: [
            buildSingleEventLine(row, ["item_source"], "\u672A\u627E\u5230\u7B26\u5408\u6761\u4EF6\u7684 common_ad_event")
          ]
        })
      ];
    });
    return makeCaseResult("TC-ITEM-GET-AD-SOURCE", "\u6FC0\u52B1\u5E7F\u544A\u83B7\u53D6\u524D\u7F6E\u5E7F\u544A\u4E8B\u4EF6", checkedCount, issues);
  }
  function checkItemUseMagicCount(rows) {
    const issues = [];
    let checkedCount = 0;
    let previousMagicUse = null;
    rows.forEach(({ row, originalIndex }, index) => {
      if (eventName(row) !== "item_use" || text(row, "item_type") !== "magic") return;
      checkedCount += 1;
      const currentCount = numberValue(row, "item_count_now");
      if (previousMagicUse && hasItemGetBetween(rows, previousMagicUse.index, index) && currentCount !== null && currentCount >= previousMagicUse.count) {
        issues.push(makeIssue({
          ruleId: "TC-ITEM-USE-MAGIC-COUNT",
          ruleName: "item_use magic \u6570\u91CF\u9012\u51CF",
          eventName: "item_use",
          rowIndex: originalIndex + 1,
          expected: "\u5F53\u524D item_count_now \u5FC5\u987B\u5C0F\u4E8E\u4E0A\u6B21 item_use \u7684 item_count_now",
          actual: `${currentCount} >= ${previousMagicUse.count}`,
          detail: `\u4E0A\u6B21 item_use \u884C\uFF1A${previousMagicUse.originalIndex + 1}`,
          displayLines: [
            buildComparisonLine(row, "item_type", "item_count_now", currentCount),
            buildComparisonLine(previousMagicUse.row, "item_type", "item_count_now", previousMagicUse.count)
          ]
        }));
      }
      if (currentCount !== null) previousMagicUse = { index, count: currentCount, originalIndex, row };
    });
    return makeCaseResult("TC-ITEM-USE-MAGIC-COUNT", "item_use magic \u6570\u91CF\u9012\u51CF", checkedCount, issues);
  }
  function checkLevelModeSequences(rows) {
    const issues = [];
    const checkedCounts = /* @__PURE__ */ new Map();
    const previousByEvent = /* @__PURE__ */ new Map();
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
          ruleName: expectsNonDecreasing ? `${name} level_mode_id \u4E0D\u9012\u51CF` : `${name} level_mode_id \u8FDE\u7EED\u9012\u589E`,
          eventName: name,
          rowIndex: originalIndex + 1,
          expected: expectsNonDecreasing ? `level_mode_id >= ${previous.modeId}` : `level_mode_id = ${previous.modeId + 1}`,
          actual: `level_mode_id = ${modeId}`,
          detail: `\u4E0A\u6B21 ${name} \u884C\uFF1A${previous.originalIndex + 1}`,
          displayLines: [
            buildComparisonLine(row, "level_type", "level_mode_id", modeId),
            buildComparisonLine(previous.row, "level_type", "level_mode_id", previous.modeId)
          ]
        }));
      }
      previousByEvent.set(name, { modeId, originalIndex, row });
    });
    return [...levelSequenceEvents.entries()].map(
      ([name, ruleId]) => makeCaseResult(
        ruleId,
        name === "level_lose" ? `${name} level_mode_id \u4E0D\u9012\u51CF` : `${name} level_mode_id \u8FDE\u7EED\u9012\u589E`,
        checkedCounts.get(name) ?? 0,
        issues.filter((issue) => issue.ruleId === ruleId)
      )
    );
  }
  function makeCaseResult(ruleId, ruleName, checkedCount, issues) {
    return {
      ruleId,
      ruleName,
      status: issues.length > 0 ? "\u6D4B\u8BD5\u4E0D\u901A\u8FC7" : "\u6D4B\u8BD5\u901A\u8FC7",
      checkedCount,
      issueCount: issues.length,
      issues
    };
  }
  function sortIndexedRows(rows) {
    return [...rows].sort((a, b) => eventTime(a.row) - eventTime(b.row) || a.originalIndex - b.originalIndex);
  }
  function runEventTestCasesForRows(rows) {
    const sortedRows = sortIndexedRows(rows);
    return [
      checkItemGetMagicCount(sortedRows),
      checkItemGetAdSource(sortedRows),
      checkItemUseMagicCount(sortedRows),
      ...checkLevelModeSequences(sortedRows)
    ];
  }
  function mergeCaseResults(resultGroups) {
    const merged = /* @__PURE__ */ new Map();
    resultGroups.flat().forEach((result) => {
      const current = merged.get(result.ruleId);
      if (!current) {
        merged.set(result.ruleId, { ...result, issues: [...result.issues] });
        return;
      }
      current.checkedCount += result.checkedCount;
      current.issues.push(...result.issues);
      current.issueCount = current.issues.length;
      current.status = current.issueCount > 0 ? "\u6D4B\u8BD5\u4E0D\u901A\u8FC7" : "\u6D4B\u8BD5\u901A\u8FC7";
    });
    return runEventTestCasesForRows([]).map((emptyResult) => {
      const result = merged.get(emptyResult.ruleId);
      if (!result) return emptyResult;
      return {
        ...result,
        issues: result.issues.sort((a, b) => a.rowIndex - b.rowIndex || a.ruleId.localeCompare(b.ruleId))
      };
    });
  }
  function groupRowsByAccount(rows) {
    const groups = /* @__PURE__ */ new Map();
    rows.forEach((row, originalIndex) => {
      const identity = accountIdentity(row);
      const key = identity.value === "-" ? `__missing_account__:${groups.size}` : `${identity.label}:${identity.value}`;
      groups.set(key, [...groups.get(key) ?? [], { row, originalIndex }]);
    });
    return [...groups.values()];
  }
  function runEventTestCases(rows) {
    const results = mergeCaseResults(
      groupRowsByAccount(rows).map((groupRows) => runEventTestCasesForRows(groupRows))
    );
    const issues = results.flatMap((result) => result.issues).sort((a, b) => a.rowIndex - b.rowIndex || a.ruleId.localeCompare(b.ruleId));
    return {
      totalRules: results.length,
      checkedRows: rows.length,
      issueCount: issues.length,
      issues,
      results
    };
  }
  return __toCommonJS(eventTestRunner_external_exports);
})();

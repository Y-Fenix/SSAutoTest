import { useEffect, useMemo, useRef, useState } from "react";
import {
  createActualEventAccumulator,
  detectEventNameColumn,
  expectedPropertyNames,
  hydrateActualEventScanResult,
  parseActualDataRows,
} from "./lib/actualDataParser";
import {
  createActualFileUploadScan,
  getActualFileScanStatus,
  uploadActualFileScanWithId,
  type ActualFileScanStatus,
} from "./lib/actualFileScanClient";
import { evaluateCoverage } from "./lib/coverageEvaluator";
import { runEventTestCases, type EventTestCaseResult } from "./lib/eventTestRunner";
import { coverageResultsToCsv, downloadCsv } from "./lib/exporter";
import { listWorkbookSheets, readCsvFileByRows, readTabularFile, readWorkbookSheets } from "./lib/fileReaders";
import { listLarkSheetTabs, readLarkSheetRows, type LarkSheetTab } from "./lib/larkSheetClient";
import {
  cancelShushuQueuedQuery,
  enqueueShushuQuery,
  getShushuQueuedQuery,
  listShushuQueryQueue,
  listShushuProjects,
  listShushuEventNames,
  refreshShushuSqlideWebSocketUrl,
  saveShushuSqlideWebSocketUrl,
} from "./lib/shushuQueryClient";
import {
  buildShushuSql,
  formatShushuQueryCountdown,
  formatShushuRowsProgress,
  normalizeShushuQueryConfig,
  SHUSHU_QUERY_TIMEOUT_MS,
  SHUSHU_SQLIDE_WEBSOCKET_TIMEOUT_MS,
  validateShushuQueryScope,
  type ShushuQueueTaskInfo,
  type ShushuQueryResponse,
  type ShushuProjectOption,
} from "./lib/shushuQuery";
import { parseTrackingPlanRows } from "./lib/trackingPlanParser";
import type { ActualEventSummary, CoverageReport, CoverageResult, CoverageStatus, ExpectedEvent, RawRow } from "./lib/types";

type DisplayStatus = CoverageStatus | "公共事件缺失";
type ActualInputMode = "file" | "shushu";
type ExpectedInputMode = "lark" | "local";
type ShushuPanelTab = "query" | "queue" | "advanced";

const statusOptions = ["全部", "测试通过", "事件缺失", "属性缺失", "详情缺失", "公共事件缺失", "测试用例"] as const;
const actualColumnPrompt = "实际数据未自动识别事件名列，请在上传区域选择事件名列后继续分析。";
type ShushuFormState = {
  apiBaseUrl: string;
  token: string;
  loginName: string;
  projectId: string;
  eventTable: string;
  startDate: string;
  endDate: string;
  userId: string;
  appVersion: string;
  dateColumn: string;
  userIdColumn: string;
  useEventNameFilter: boolean;
  eventNameColumn: string;
  eventNames: string;
  pageSize: string;
  maxRows: string;
  sqlideWebSocketUrl: string;
};

const defaultShushuForm: ShushuFormState = {
  apiBaseUrl: "",
  token: "",
  loginName: "",
  projectId: "",
  eventTable: "",
  startDate: "",
  endDate: "",
  userId: "",
  appVersion: "",
  dateColumn: "$part_date",
  userIdColumn: "#account_id",
  useEventNameFilter: false,
  eventNameColumn: "#event_name",
  eventNames: "",
  pageSize: "1000",
  maxRows: "1000",
  sqlideWebSocketUrl: "",
};

function buildClientShushuSqlPreview(form: ShushuFormState): string {
  try {
    return buildShushuSql(normalizeShushuQueryConfig({
      ...form,
      eventTable: form.eventTable.trim() || undefined,
      pageSize: Number(form.pageSize) || 1000,
      maxRows: Number(form.maxRows) || 1000,
    }));
  } catch {
    return "";
  }
}

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function renderPropertyLines(items: string[], className = "") {
  if (items.length === 0) return "-";
  return (
    <span className="property-lines">
      {items.map((item) => (
        <span className={className} key={item}>{item}</span>
      ))}
    </span>
  );
}

function renderCoveredPropertyLines(result: DetailRow) {
  if (result.status === "公共事件缺失") {
    return renderPropertyLines(getCommonMissingEvents(result), "property-fail");
  }

  if (result.expectedProperties.length === 0) return "-";
  return (
    <span className="property-lines">
      {result.expectedProperties.map((propertyName) => {
        const isPassed = result.passedProperties.includes(propertyName);
        return (
          <span className={isPassed ? "property-pass" : "property-fail"} key={propertyName}>
            {propertyName}
          </span>
        );
      })}
    </span>
  );
}

function parseCommonMissingProperty(value: string) {
  const separatorIndex = value.indexOf("：");
  if (separatorIndex === -1) return { propertyName: value, eventNames: [] };
  return {
    propertyName: value.slice(0, separatorIndex),
    eventNames: value
      .slice(separatorIndex + 1)
      .split("、")
      .map((eventName) => eventName.trim())
      .filter(Boolean),
  };
}

function getCommonMissingProperty(result: DetailRow) {
  return parseCommonMissingProperty(result.missingProperties[0] ?? result.expectedProperties[0] ?? "");
}

function getCommonMissingEvents(result: DetailRow) {
  return getCommonMissingProperty(result).eventNames;
}

function renderMissingDetails(result: DetailRow) {
  return renderPropertyLines(result.missingProperties);
}

function renderMissingListContent(result: DetailRow) {
  if (result.status === "事件缺失") return "实际数据中没有该事件";

  if (result.status === "公共事件缺失") {
    const { propertyName, eventNames } = getCommonMissingProperty(result);
    return (
      <span className="missing-detail-block">
        <span>公共属性：{propertyName || "-"}</span>
        <span>缺失事件：</span>
        <span>{eventNames.join("、") || "-"}</span>
      </span>
    );
  }

  return (
    <>
      {result.status === "详情缺失" ? "详情缺失：" : "缺失属性："}
      {result.status === "详情缺失" ? renderPropertyLines(result.detailMissingProperties) : renderMissingDetails(result)}
    </>
  );
}

function renderPropertyDetail(detail: string) {
  if (!detail.trim()) return "-";
  return (
    <span className="detail-value-lines">
      {detail.split(/\r?\n/).map((line, index) => (
        <span key={`${index}:${line}`}>{line || " "}</span>
      ))}
    </span>
  );
}

function renderDetailCoverage(items: string[], coveredItems: string[]) {
  if (items.length === 0) return "-";
  const coveredSet = new Set(coveredItems);
  return (
    <span className="detail-value-lines">
      {items.map((item) => (
        <span className={coveredSet.has(item) ? "property-pass" : "property-fail"} key={item}>
          {item}
        </span>
      ))}
    </span>
  );
}

function renderQueryTimer(isQuerying: boolean, remainingMs: number) {
  if (!isQuerying) return null;
  return (
    <span className="query-countdown">
      剩余 {formatShushuQueryCountdown(remainingMs)}
    </span>
  );
}

function eventTestLineTime(line: string): number {
  const matched = line.match(/(\d{4})\/(\d{2})\/(\d{2})\/(\d{2}):(\d{2}):(\d{2})/);
  if (!matched) return Number.POSITIVE_INFINITY;
  return Date.parse(`${matched[1]}-${matched[2]}-${matched[3]}T${matched[4]}:${matched[5]}:${matched[6]}`);
}

function eventTestResultLines(result: EventTestCaseResult) {
  return result.issues
    .slice(0, 6)
    .flatMap((issue) =>
      issue.displayLines?.length
        ? issue.displayLines.map((line) => ({ key: `${issue.ruleId}:${issue.rowIndex}:${line}`, line }))
        : [{ key: `${issue.ruleId}:${issue.rowIndex}:${issue.detail}`, line: `第 ${issue.rowIndex} 行：${issue.actual}；${issue.detail}` }],
    )
    .sort((a, b) => eventTestLineTime(a.line) - eventTestLineTime(b.line) || a.line.localeCompare(b.line));
}

function renderEventTestResult(result: EventTestCaseResult) {
  return (
    <tr key={result.ruleId}>
      <td>
        <span className={`status event-test-status-${result.status}`}>{result.status}</span>
      </td>
      <td><code title={result.ruleId}>{result.ruleId}</code></td>
      <td>{result.ruleName}</td>
      <td className="count-cell">{result.checkedCount}</td>
      <td className={result.status === "测试通过" ? "property-pass" : "property-fail"}>{result.issueCount}</td>
      <td>
        {result.issues.length === 0 ? (
          <span className="property-pass">符合预期</span>
        ) : (
          <span className="event-test-issue-lines">
            {eventTestResultLines(result).map(({ key, line }) => <span key={key}>{line}</span>)}
            {result.issues.length > 6 && <span>还有 {result.issues.length - 6} 个异常未展示</span>}
          </span>
        )}
      </td>
    </tr>
  );
}

type DetailRow = Omit<CoverageResult, "status"> & {
  rowKey: string;
  sourceEventName: string;
  status: DisplayStatus;
};

function buildDetailRows(results: CoverageResult[]): DetailRow[] {
  return results.flatMap<DetailRow>((result, resultIndex) => {
    if (result.eventName !== "公共事件属性") {
      return [{ ...result, rowKey: `${resultIndex}:${result.eventName}`, sourceEventName: result.eventName }];
    }

    if (result.missingProperties.length === 0) {
      return [{
        ...result,
        rowKey: `${resultIndex}:${result.eventName}`,
        sourceEventName: result.eventName,
        status: result.status,
      }];
    }

    return result.missingProperties.map((missingProperty, missingIndex) => ({
      ...result,
      rowKey: `${resultIndex}:${result.eventName}:${missingIndex}:${missingProperty}`,
      sourceEventName: result.eventName,
      expectedProperties: [missingProperty.split("：")[0]],
      coveredProperties: [],
      missingProperties: [missingProperty],
      detailCoveredProperties: [],
      detailMissingProperties: [],
      passedProperties: [],
      passRate: 0,
      status: "公共事件缺失",
    }));
  });
}

export default function App() {
  const configPanelRef = useRef<HTMLElement | null>(null);
  const detailPanelRef = useRef<HTMLElement | null>(null);
  const eventFilterDropdownRef = useRef<HTMLDetailsElement | null>(null);
  const shushuQueryAbortRef = useRef<AbortController | null>(null);
  const shushuWebSocketRefreshAbortRef = useRef<AbortController | null>(null);
  const [expectedEvents, setExpectedEvents] = useState<ExpectedEvent[]>([]);
  const [actualRows, setActualRows] = useState<RawRow[]>([]);
  const [actualRowCount, setActualRowCount] = useState(0);
  const [actualEventSummaries, setActualEventSummaries] = useState<Map<string, ActualEventSummary> | null>(null);
  const [actualColumns, setActualColumns] = useState<string[]>([]);
  const [actualEventNameColumn, setActualEventNameColumn] = useState("");
  const [isReadingActualFile, setIsReadingActualFile] = useState(false);
  const [actualFileProgress, setActualFileProgress] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [larkUrl, setLarkUrl] = useState("");
  const [larkTabs, setLarkTabs] = useState<LarkSheetTab[]>([]);
  const [selectedLarkSheetIds, setSelectedLarkSheetIds] = useState<string[]>([]);
  const [expectedInputMode, setExpectedInputMode] = useState<ExpectedInputMode>("lark");
  const [localExpectedFile, setLocalExpectedFile] = useState<File | null>(null);
  const [localExpectedSheets, setLocalExpectedSheets] = useState<LarkSheetTab[]>([]);
  const [selectedLocalSheetIds, setSelectedLocalSheetIds] = useState<string[]>([]);
  const [isReadingLark, setIsReadingLark] = useState(false);
  const [isLarkTabsExpanded, setIsLarkTabsExpanded] = useState(true);
  const [isLocalSheetsExpanded, setIsLocalSheetsExpanded] = useState(true);
  const [isActualColumnExpanded, setIsActualColumnExpanded] = useState(false);
  const [isConfigPanelCollapsed, setIsConfigPanelCollapsed] = useState(false);
  const [isDetailPanelDocked, setIsDetailPanelDocked] = useState(false);
  const [actualInputMode, setActualInputMode] = useState<ActualInputMode>("shushu");
  const [shushuProjects, setShushuProjects] = useState<ShushuProjectOption[]>([]);
  const [shushuForm, setShushuForm] = useState(defaultShushuForm);
  const [isQueryingShushu, setIsQueryingShushu] = useState(false);
  const [shushuQueryProgress, setShushuQueryProgress] = useState("");
  const [shushuQueryRemainingMs, setShushuQueryRemainingMs] = useState(SHUSHU_QUERY_TIMEOUT_MS);
  const [shushuQueryTimeoutMs, setShushuQueryTimeoutMs] = useState(SHUSHU_QUERY_TIMEOUT_MS);
  const [activeShushuPanelTab, setActiveShushuPanelTab] = useState<ShushuPanelTab>("query");
  const [isSavingShushuConfig, setIsSavingShushuConfig] = useState(false);
  const [isRefreshingShushuWebSocket, setIsRefreshingShushuWebSocket] = useState(false);
  const [shushuWebSocketRefreshElapsed, setShushuWebSocketRefreshElapsed] = useState(0);
  const [shushuQueryElapsedMs, setShushuQueryElapsedMs] = useState(0);
  const [lastShushuSql, setLastShushuSql] = useState("");
  const [shushuQueryChannelName, setShushuQueryChannelName] = useState("自动选择中");
  const [shushuQueryMeta, setShushuQueryMeta] = useState("");
  const [shushuQueueTasks, setShushuQueueTasks] = useState<ShushuQueueTaskInfo[]>([]);
  const [currentShushuQueueTaskId, setCurrentShushuQueueTaskId] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof statusOptions)[number]>("全部");
  const [query, setQuery] = useState("");
  const [eventFilterSearch, setEventFilterSearch] = useState("");
  const [shushuEventNameOptions, setShushuEventNameOptions] = useState<string[]>([]);
  const [isLoadingShushuEventNames, setIsLoadingShushuEventNames] = useState(false);

  useEffect(() => {
    let isMounted = true;
    async function loadShushuConfigAndProjects() {
      try {
        const response = await fetch("/api/shushu-config");
        const config = await response.json() as {
          apiBaseUrl?: string;
          loginName?: string;
          hasToken?: boolean;
          sqlideWebSocketUrl?: string;
        };
        if (!response.ok) throw new Error("数数本地配置读取失败。");
        if (!isMounted) return;
        setShushuForm((current) => ({
          ...current,
          apiBaseUrl: config.apiBaseUrl ?? "",
          loginName: config.loginName ?? "",
          token: "",
          sqlideWebSocketUrl: config.sqlideWebSocketUrl ?? "",
        }));
        const projects = await listShushuProjects("", "", "");
        if (!isMounted) return;
        setShushuProjects(projects);
        const firstProject = projects[0];
        if (firstProject) {
          setShushuForm((current) => ({
            ...current,
            projectId: current.projectId || firstProject.id,
            eventTable: current.eventTable || `v_event_${firstProject.id}`,
          }));
      }
      clearErrorPrefix("数数查询");
    } catch (error) {
      console.warn("数数项目列表自动读取失败", error);
    }
  }
    loadShushuConfigAndProjects();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    function handleOutsidePointerDown(event: PointerEvent) {
      const dropdown = eventFilterDropdownRef.current;
      if (!dropdown?.open) return;
      if (event.target instanceof Node && dropdown.contains(event.target)) return;
      dropdown.removeAttribute("open");
    }

    document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointerDown);
    };
  }, []);

  useEffect(() => {
    function handleScroll() {
      const detailRect = detailPanelRef.current?.getBoundingClientRect();
      setIsDetailPanelDocked(Boolean(
        isConfigPanelCollapsed
        && detailRect
        && detailRect.top <= 161
        && detailRect.bottom > 161,
      ));
    }

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [isConfigPanelCollapsed]);

  useEffect(() => {
    if (!isQueryingShushu) return undefined;
    const startTime = Date.now();
    setShushuQueryRemainingMs(shushuQueryTimeoutMs);
    setShushuQueryElapsedMs(0);
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startTime;
      setShushuQueryElapsedMs(elapsed);
      setShushuQueryRemainingMs(Math.max(0, shushuQueryTimeoutMs - elapsed));
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [isQueryingShushu, shushuQueryTimeoutMs]);

  useEffect(() => {
    if (!isRefreshingShushuWebSocket) return undefined;
    const startTime = Date.now();
    setShushuWebSocketRefreshElapsed(0);
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setShushuWebSocketRefreshElapsed(elapsed);
      if (elapsed >= 90) {
        shushuWebSocketRefreshAbortRef.current?.abort();
      }
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [isRefreshingShushuWebSocket]);

  useEffect(() => {
    void refreshShushuQueue().catch(() => undefined);
    const timer = window.setInterval(() => {
      void refreshShushuQueue().catch(() => undefined);
    }, isQueryingShushu ? 1000 : 5000);
    return () => {
      window.clearInterval(timer);
    };
  }, [isQueryingShushu]);

  useEffect(() => {
    if (!isQueryingShushu) return;
    setShushuQueryMeta(`查询通道：${shushuQueryChannelName} ｜ 耗时：${(shushuQueryElapsedMs / 1000).toFixed(1)} 秒`);
  }, [isQueryingShushu, shushuQueryChannelName, shushuQueryElapsedMs]);

  useEffect(() => {
    if (actualInputMode !== "shushu" || !shushuForm.projectId || !shushuForm.startDate || !shushuForm.endDate) return;
    void handleLoadShushuEventNames();
  }, [actualInputMode, shushuForm.projectId, shushuForm.startDate, shushuForm.endDate]);

  const report: CoverageReport | null = useMemo(() => {
    if (expectedEvents.length === 0 || actualRowCount === 0 || !actualEventNameColumn) return null;
    return evaluateCoverage(
      expectedEvents,
      actualEventSummaries ?? parseActualDataRows(actualRows, actualEventNameColumn),
    );
  }, [expectedEvents, actualEventSummaries, actualRows, actualRowCount, actualEventNameColumn]);

  const expectedPropertyCount = useMemo(
    () => expectedEvents.reduce((sum, event) => sum + event.properties.length, 0),
    [expectedEvents],
  );

  const detailRows = useMemo(() => buildDetailRows(report?.results ?? []), [report]);
  const propertyDetailRows = useMemo(() => {
    return detailRows.filter((result) => result.eventName !== "公共事件属性").flatMap((result) =>
      result.expectedProperties
        .filter((propertyName) => result.propertyDetails[propertyName]?.trim())
        .map((propertyName) => ({
          rowKey: `${result.rowKey}:detail:${propertyName}`,
          eventName: result.eventName,
          propertyName,
          expectedDetail: result.propertyDetails[propertyName] ?? "",
          expectedDetailItems: result.propertyDetailItems[propertyName] ?? [],
          coveredDetailItems: result.coveredDetailItems[propertyName] ?? [],
          isPassed: result.passedProperties.includes(propertyName),
          passRate:
            (result.propertyDetailItems[propertyName]?.length ?? 0) === 0
              ? 1
              : (result.coveredDetailItems[propertyName]?.length ?? 0) /
                (result.propertyDetailItems[propertyName]?.length ?? 1),
        })),
    );
  }, [detailRows]);

  const filteredResults = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return detailRows.filter((result) => {
      const statusMatches = statusFilter === "全部" || result.status === statusFilter;
      const text = [
        result.eventName,
        result.expectedProperties.join(" "),
        result.coveredProperties.join(" "),
        result.missingProperties.join(" "),
        result.detailMissingProperties.join(" "),
        result.notes,
      ]
        .join(" ")
        .toLowerCase();
      return statusMatches && text.includes(needle);
    });
  }, [detailRows, query, statusFilter]);

  const filteredPropertyDetailRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return propertyDetailRows.filter((row) => {
      const text = [
        row.eventName,
        row.propertyName,
        row.expectedDetail,
        row.coveredDetailItems.join(" "),
      ].join(" ").toLowerCase();
      return text.includes(needle);
    });
  }, [propertyDetailRows, query]);

  const eventTestReport = useMemo(() => runEventTestCases(actualRows), [actualRows]);
  const filteredEventTestResults = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return eventTestReport.results.filter((result) => {
      const text = [
        result.status,
        result.ruleId,
        result.ruleName,
        ...result.issues.flatMap((issue) => [issue.eventName, issue.expected, issue.actual, issue.detail]),
      ].join(" ").toLowerCase();
      return text.includes(needle);
    });
  }, [eventTestReport, query]);

  const statusCounts = useMemo(() => {
    const counts = Object.fromEntries(statusOptions.map((option) => [option, 0])) as Record<
      (typeof statusOptions)[number],
      number
    >;
    counts["全部"] = detailRows.length;
    detailRows.forEach((result) => {
      counts[result.status] += 1;
    });
    counts["测试用例"] = eventTestReport.totalRules;
    return counts;
  }, [detailRows, eventTestReport.totalRules]);

  const selectedEventNames = useMemo(() => {
    if (!shushuForm.useEventNameFilter) return new Set<string>();
    return new Set(
      shushuForm.eventNames
        .split(/[\s,，、;；]+/)
        .map((eventName) => eventName.trim())
        .filter(Boolean),
    );
  }, [shushuForm.eventNames, shushuForm.useEventNameFilter]);

  const selectedEventNameList = useMemo(() => [...selectedEventNames], [selectedEventNames]);

  const eventNameFilterCount = selectedEventNameList.length;

  const expectedEventNameOptions = useMemo(() => shushuEventNameOptions, [shushuEventNameOptions]);
  const allExpectedEventsSelected =
    expectedEventNameOptions.length > 0 && eventNameFilterCount === expectedEventNameOptions.length;
  const someExpectedEventsSelected = eventNameFilterCount > 0 && !allExpectedEventsSelected;

  const filteredExpectedEventNameOptions = useMemo(() => {
    const needle = eventFilterSearch.trim().toLowerCase();
    if (!needle) return expectedEventNameOptions;
    return expectedEventNameOptions.filter((eventName) => eventName.toLowerCase().includes(needle));
  }, [eventFilterSearch, expectedEventNameOptions]);
  const selectedFilteredEventNameCount = filteredExpectedEventNameOptions.filter((eventName) =>
    selectedEventNames.has(eventName),
  ).length;
  const allFilteredEventsSelected =
    filteredExpectedEventNameOptions.length > 0 &&
    selectedFilteredEventNameCount === filteredExpectedEventNameOptions.length;
  const someFilteredEventsSelected = selectedFilteredEventNameCount > 0 && !allFilteredEventsSelected;

  const eventFilterSummary = useMemo(() => {
    if (selectedEventNameList.length === 0) return "未选择事件";
    if (expectedEventNameOptions.length > 0 && selectedEventNameList.length === expectedEventNameOptions.length) {
      return "全部事件";
    }
    if (selectedEventNameList.length <= 2) return selectedEventNameList.join("、");
    return `${selectedEventNameList.slice(0, 2).join("、")} 等 ${selectedEventNameList.length} 个事件`;
  }, [expectedEventNameOptions.length, selectedEventNameList]);

  const shushuQueryScopeError = useMemo(() => {
    try {
      return validateShushuQueryScope(normalizeShushuQueryConfig({
        ...shushuForm,
        eventTable: shushuForm.eventTable.trim() || undefined,
        pageSize: Number(shushuForm.pageSize) || 1000,
        maxRows: Number(shushuForm.maxRows) || 1000,
      }));
    } catch (error) {
      return String((error as Error).message);
    }
  }, [shushuForm]);

  const canStartShushuQuery = actualInputMode === "shushu" && Boolean(shushuForm.projectId) && !shushuQueryScopeError;

  function handleExpectedRows(rows: RawRow[]) {
    const events = parseTrackingPlanRows(rows);
    if (events.length === 0) throw new Error("预期埋点表中没有检测到事件。");
    setExpectedEvents(events);
    updateSelectedEventNames([]);
    const nextScopeError = validateShushuQueryScope(normalizeShushuQueryConfig({
      ...shushuForm,
      eventTable: shushuForm.eventTable.trim() || undefined,
      pageSize: Number(shushuForm.pageSize) || 1000,
      maxRows: Number(shushuForm.maxRows) || 1000,
    }));
    setShushuQueryProgress(
      nextScopeError
        ? `预期表已更新：${events.filter((event) => !event.isCommonProperties).length} 个事件 ｜ ${nextScopeError}`
        : `预期表已更新：${events.filter((event) => !event.isCommonProperties).length} 个事件，可查询实际数据。`,
    );
    setActualFileProgress(
      `预期表已更新：${events.filter((event) => !event.isCommonProperties).length} 个事件 / ${expectedPropertyNames(events).size} 个属性。请选择实际 SQL 导出 CSV/Excel。`,
    );
    clearErrorPrefix("预期表");
  }

  function formatActualScanProgress(status: ActualFileScanStatus) {
    const receivedSize = formatFileSize(status.progress.bytesRead);
    const totalSize = status.progress.fileSize > 0 ? formatFileSize(status.progress.fileSize) : "未知大小";
    if (status.status === "queued") {
      return `服务器扫描排队中：当前第 ${status.progress.position || 1} 位 ｜ ${status.summary || "等待扫描"}`;
    }
    if (status.status === "waiting_upload") {
      return `已轮到本次任务：正在开始上传文件到服务器...`;
    }
    return `服务器流式扫描中：${status.progress.percent}% ｜ 已接收 ${receivedSize} / ${totalSize} ｜ 已扫描 ${status.progress.scannedRows.toLocaleString()} 行 ｜ 已命中 ${status.progress.matchedEvents} 个预期事件`;
  }

  async function waitForActualScanResult(
    initialStatus: ActualFileScanStatus,
    startUpload?: () => Promise<ActualFileScanStatus>,
  ) {
    let scanId = initialStatus.scanId;
    let status = initialStatus;
    let uploadPromise: Promise<ActualFileScanStatus> | undefined;
    setActualFileProgress(formatActualScanProgress(status));

    while (status.status === "queued" || status.status === "waiting_upload" || status.status === "running") {
      if (status.status === "waiting_upload" && startUpload && !uploadPromise) {
        setActualFileProgress("排队完成：正在上传并由服务器流式扫描...");
        uploadPromise = startUpload();
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      try {
        status = await getActualFileScanStatus(scanId);
      } catch (error) {
        if (!uploadPromise) throw error;
        status = await uploadPromise;
      }
      scanId = status.scanId;
      setActualFileProgress(formatActualScanProgress(status));
    }

    if (uploadPromise) {
      const uploadedStatus = await uploadPromise;
      if (uploadedStatus.status === "error") throw new Error(uploadedStatus.error ?? "大 CSV 后端扫描失败。");
      if (uploadedStatus.result) status = uploadedStatus;
    }

    if (!status.result) throw new Error("后端扫描完成，但没有返回扫描结果。");
    const result = hydrateActualEventScanResult(status.result);
    if (result.rowCount === 0) throw new Error("实际事件数据为空。");
    applyActualSummary(result.actualEvents, result.columns, result.eventNameColumn, result.rowCount);
    setActualFileProgress(`服务器流式扫描完成：已扫描 ${result.rowCount.toLocaleString()} 行`);
  }

  async function handleListLarkTabs() {
    try {
      setIsReadingLark(true);
      const tabs = await listLarkSheetTabs(larkUrl);
      setLarkTabs(tabs);
      setSelectedLarkSheetIds(tabs.slice(0, 2).map((tab) => tab.id));
      setIsLarkTabsExpanded(true);
      clearErrorPrefix("预期表");
    } catch (error) {
      setLarkTabs([]);
      setSelectedLarkSheetIds([]);
      pushError("预期表", error);
    } finally {
      setIsReadingLark(false);
    }
  }

  async function handleReadSelectedLarkSheets() {
    try {
      setIsReadingLark(true);
      if (selectedLarkSheetIds.length === 0) throw new Error("请至少选择一个页签。");
      handleExpectedRows(await readLarkSheetRows(larkUrl, selectedLarkSheetIds));
    } catch (error) {
      pushError("预期表", error);
    } finally {
      setIsReadingLark(false);
    }
  }

  async function handleLocalExpectedFile(file: File | null) {
    if (!file) return;
    try {
      setLocalExpectedFile(file);
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (extension === "csv" || extension === "txt") {
        const rows = await readTabularFile(file);
        handleExpectedRows(rows);
        setLocalExpectedSheets([]);
        setSelectedLocalSheetIds([]);
        return;
      }
      const sheets = await listWorkbookSheets(file);
      setLocalExpectedSheets(sheets);
      setSelectedLocalSheetIds(sheets.slice(0, 2).map((sheet) => sheet.id));
      setIsLocalSheetsExpanded(true);
      clearErrorPrefix("预期表");
    } catch (error) {
      pushError("预期表", error);
    }
  }

  async function handleReadSelectedLocalSheets() {
    try {
      if (!localExpectedFile) throw new Error("请先上传本地预期埋点表。");
      if (selectedLocalSheetIds.length === 0) throw new Error("请至少选择一个页签。");
      handleExpectedRows(await readWorkbookSheets(localExpectedFile, selectedLocalSheetIds));
    } catch (error) {
      pushError("预期表", error);
    }
  }

  async function handleActualFile(file: File | null) {
    if (!file) return;
    try {
      clearErrorPrefix("实际数据");
      setIsReadingActualFile(true);
      setActualFileProgress(`准备读取 ${file.name}...`);
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (extension === "csv" || extension === "txt") {
        if (expectedEvents.length === 0) throw new Error("请先读取预期埋点表，再扫描实际数据。");
        setActualFileProgress(`正在加入服务器扫描队列：${file.name}...`);
        const started = await createActualFileUploadScan(expectedEvents);
        await waitForActualScanResult(started, () => uploadActualFileScanWithId(file, started.scanId));
        return;
      }

      const rows = await readTabularFile(file);
      if (rows.length === 0) throw new Error("实际事件数据为空。");
      applyActualRows(rows);
      setActualFileProgress(`解析完成：已读取 ${rows.length.toLocaleString()} 行`);
    } catch (error) {
      pushError("实际数据", error);
    } finally {
      setIsReadingActualFile(false);
    }
  }

  function applyActualSummary(
    summaries: Map<string, ActualEventSummary>,
    columns: string[],
    eventNameColumn: string,
    rowCount: number,
  ) {
    setActualRows([]);
    setActualRowCount(rowCount);
    setActualEventSummaries(summaries);
    setActualColumns(columns);
    setActualEventNameColumn(eventNameColumn);
    setIsActualColumnExpanded(false);
    clearErrorPrefix("实际数据");
    setErrors((current) => {
      const withoutPrompt = current.filter((item) => item !== actualColumnPrompt);
      return eventNameColumn ? withoutPrompt : [...withoutPrompt, actualColumnPrompt];
    });
  }

  function applyActualRows(rows: RawRow[], preferredColumns?: string[]) {
    const columns = preferredColumns?.length
      ? preferredColumns
      : [...new Set(rows.flatMap((row) => Object.keys(row).map((key) => key.trim()).filter(Boolean)))];
    const detectedColumn = columns.includes("#event_name") ? "#event_name" : detectEventNameColumn(rows);
    setActualRows(rows);
    setActualRowCount(rows.length);
    setActualEventSummaries(null);
    setActualColumns(columns);
    setActualEventNameColumn(detectedColumn ?? "");
    setIsActualColumnExpanded(false);
    clearErrorPrefix("实际数据");
    setErrors((current) => {
      const withoutPrompt = current.filter((item) => item !== actualColumnPrompt);
      return detectedColumn ? withoutPrompt : [...withoutPrompt, actualColumnPrompt];
    });
  }

  function updateShushuForm(field: keyof ShushuFormState, value: string | boolean) {
    setShushuForm((current) => {
      if (field === "projectId") {
        return {
          ...current,
          projectId: String(value),
          eventTable: current.eventTable && current.eventTable !== `v_event_${current.projectId}` ? current.eventTable : "",
        };
      }
      if (field === "maxRows" && typeof value === "string") {
        const numericValue = Number(value);
        return { ...current, maxRows: Number.isFinite(numericValue) && numericValue > 5000 ? "5000" : value };
      }
      return { ...current, [field]: value };
    });
  }

  function updateSelectedEventNames(nextEventNames: string[]) {
    const uniqueNames = [...new Set(nextEventNames.map((eventName) => eventName.trim()).filter(Boolean))];
    updateShushuForm("eventNames", uniqueNames.join("\n"));
    updateShushuForm("useEventNameFilter", uniqueNames.length > 0);
  }

  async function refreshShushuQueue() {
    const tasks = await listShushuQueryQueue();
    setShushuQueueTasks(tasks);
    return tasks;
  }

  async function handleCancelShushuQueueTask(taskId: string) {
    try {
      const task = await cancelShushuQueuedQuery(taskId);
      setShushuQueueTasks((current) => current.map((item) => item.id === task.id ? task : item));
      if (taskId === currentShushuQueueTaskId) {
        shushuQueryAbortRef.current?.abort();
        setShushuQueryProgress("正在终止本次查询...");
      }
      await refreshShushuQueue();
      clearErrorPrefix("数数查询");
    } catch (error) {
      pushError("数数查询", error);
    }
  }

  function formatShushuQueueStatus(status: ShushuQueueTaskInfo["status"]) {
    if (status === "queued") return "排队中";
    if (status === "running") return "运行中";
    if (status === "done") return "完成";
    if (status === "error") return "失败";
    return "已取消";
  }

  function formatShushuQueryChannel(channel?: ShushuQueueTaskInfo["queryChannel"]) {
    if (channel === "openapi") return "API 查询";
    if (channel === "sqlide-websocket") return "WebSocket 查询";
    return "自动选择中";
  }

  async function handleLoadShushuEventNames() {
    try {
      setIsLoadingShushuEventNames(true);
      const eventNames = await listShushuEventNames({
        ...shushuForm,
        eventTable: shushuForm.eventTable.trim() || undefined,
        pageSize: Number(shushuForm.pageSize) || 1000,
        maxRows: Number(shushuForm.maxRows) || 1000,
      });
      setShushuEventNameOptions(eventNames);
      const validNames = new Set(eventNames);
      updateSelectedEventNames(selectedEventNameList.filter((eventName) => validNames.has(eventName)));
      setShushuQueryProgress(`已读取数数当前事件列表：${eventNames.length} 个事件`);
      clearErrorPrefix("数数查询");
    } catch (error) {
      pushError("数数查询", error);
    } finally {
      setIsLoadingShushuEventNames(false);
    }
  }

  async function handleShushuQuery() {
    if (isQueryingShushu) {
      if (currentShushuQueueTaskId) {
        void cancelShushuQueuedQuery(currentShushuQueueTaskId)
          .then((task) => {
            setShushuQueueTasks((current) => current.map((item) => item.id === task.id ? task : item));
          })
          .catch((error) => pushError("数数查询", error));
      }
      shushuQueryAbortRef.current?.abort();
      setShushuQueryProgress("正在终止本次查询...");
      return;
    }

    try {
      shushuQueryAbortRef.current = new AbortController();
      const scopeError = validateShushuQueryScope(normalizeShushuQueryConfig({
        ...shushuForm,
        eventTable: shushuForm.eventTable.trim() || undefined,
        pageSize: Number(shushuForm.pageSize) || 1000,
        maxRows: Number(shushuForm.maxRows) || 1000,
      }));
      if (scopeError) throw new Error(scopeError);

      const queryConfig = {
        ...shushuForm,
        eventTable: shushuForm.eventTable.trim() || undefined,
        pageSize: Number(shushuForm.pageSize) || 1000,
        maxRows: Number(shushuForm.maxRows) || 1000,
      };
      const queryTimeoutMs = SHUSHU_QUERY_TIMEOUT_MS;
      setShushuQueryTimeoutMs(queryTimeoutMs);
      setShushuQueryChannelName("自动选择中");
      setShushuQueryElapsedMs(0);
      setIsQueryingShushu(true);
      setShushuQueryRemainingMs(queryTimeoutMs);
      const queryStartTime = Date.now();
      setShushuQueryMeta("查询通道：自动选择中 ｜ 耗时：0.0 秒");
      setShushuQueryProgress(`正在优先使用 WebSocket 按事件分片查询；整体超过 ${Math.round(SHUSHU_SQLIDE_WEBSOCKET_TIMEOUT_MS / 1000)} 秒或 WebSocket 失败时才会切换 API...`);
      const sqlPreview = buildClientShushuSqlPreview(shushuForm);
      if (sqlPreview) setLastShushuSql(sqlPreview);
      const queuedTask = await enqueueShushuQuery(queryConfig);
      setCurrentShushuQueueTaskId(queuedTask.id);
      setShushuQueueTasks(await refreshShushuQueue());
      setShushuQueryProgress(
        queuedTask.status === "running"
          ? "查询任务已开始运行。"
          : `查询任务已进入队列，当前位置：${queuedTask.position || 1}。`,
      );
      const applyShushuQueryResult = (result: ShushuQueryResponse, progressPrefix: string) => {
        setLastShushuSql(result.sql);
        const maxRows = Number(shushuForm.maxRows) > 0 ? Number(shushuForm.maxRows) : Number.POSITIVE_INFINITY;
        const limitedRows = Number.isFinite(maxRows) ? result.rows.slice(0, maxRows) : result.rows;
        if (limitedRows.length === 0) throw new Error("数数查询返回 0 行数据。");
        const channelName = result.queryChannel === "openapi" ? "API 查询" : "WebSocket 查询";
        const elapsedSeconds = ((Date.now() - queryStartTime) / 1000).toFixed(1);
        setShushuQueryChannelName(channelName);
        setShushuQueryElapsedMs(Date.now() - queryStartTime);
        const channelText = result.queryChannel === "openapi"
          ? `，WebSocket 未返回有效结果，已自动切换 API${result.fallbackReason ? `（原因：${result.fallbackReason}）` : ""}`
          : "";
        setShushuQueryMeta(`查询通道：${channelName} ｜ 耗时：${elapsedSeconds} 秒`);
        const rowsProgress = formatShushuRowsProgress({
          loadedRows: result.loadedRows ?? limitedRows.length,
          rowCount: result.rowCount || limitedRows.length,
          requestedRows: result.requestedRows ?? (Number.isFinite(maxRows) ? maxRows : limitedRows.length),
          stopReason: result.stopReason,
        });
        setShushuQueryProgress(`${progressPrefix}${channelText}：${rowsProgress}${result.stopReason ? ` ｜ ${result.stopReason}` : ""}`);
        applyActualRows(limitedRows, result.columns);
        setIsConfigPanelCollapsed(true);
        clearErrorPrefix("数数查询");
      };

      let finalTask = queuedTask;
      while (!["done", "error", "cancelled"].includes(finalTask.status)) {
        if (shushuQueryAbortRef.current.signal.aborted) {
          await cancelShushuQueuedQuery(queuedTask.id);
          throw new Error("已终止本次数数查询。");
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        finalTask = await getShushuQueuedQuery(queuedTask.id);
        void refreshShushuQueue().catch(() => undefined);
        const taskChannelName = formatShushuQueryChannel(finalTask.queryChannel);
        if (finalTask.status === "queued") {
          setShushuQueryChannelName(taskChannelName);
          setShushuQueryProgress(`查询任务排队中，当前位置：${finalTask.position || "-"}。`);
        } else if (finalTask.status === "running") {
          setShushuQueryChannelName(taskChannelName);
          setShushuQueryProgress(`查询任务运行中：${finalTask.summary}`);
        }
      }

      setShushuQueueTasks(await refreshShushuQueue());
      if (finalTask.status === "cancelled") throw new Error("已终止本次数数查询。");
      if (finalTask.status === "error") throw new Error(finalTask.error ?? "数数队列任务执行失败。");
      if (!finalTask.result) throw new Error("数数队列任务完成，但没有返回查询结果。");
      applyShushuQueryResult(finalTask.result, "查询完成");
    } catch (error) {
      const message = String((error as Error).message);
      if (message.includes("已终止本次数数查询") || (error as Error).name === "AbortError") {
        clearErrorPrefix("数数查询");
        setShushuQueryProgress("已终止本次数数查询。");
        setShushuQueryMeta("");
        setShushuQueryChannelName("自动选择中");
      } else {
        pushError("数数查询", error);
      }
    } finally {
      setIsQueryingShushu(false);
      shushuQueryAbortRef.current = null;
      setCurrentShushuQueueTaskId("");
    }
  }

  async function handleSaveShushuAdvancedConfig() {
    try {
      setIsSavingShushuConfig(true);
      const saved = await saveShushuSqlideWebSocketUrl(shushuForm.sqlideWebSocketUrl);
      setShushuForm((current) => ({
        ...current,
        sqlideWebSocketUrl: saved.sqlideWebSocketUrl,
      }));
      setShushuQueryProgress("数数 WebSocket 地址已保存，下次查询会自动使用。");
      clearErrorPrefix("数数查询");
    } catch (error) {
      pushError("数数查询", error);
    } finally {
      setIsSavingShushuConfig(false);
    }
  }

  async function handleRefreshShushuWebSocket() {
    const refreshStartTime = Date.now();
    try {
      shushuWebSocketRefreshAbortRef.current = new AbortController();
      setIsRefreshingShushuWebSocket(true);
      setShushuWebSocketRefreshElapsed(0);
      setShushuQueryMeta("WebSocket 刷新：准备打开数数页面 ｜ 已等待 0 秒 / 90 秒");
      setShushuQueryProgress("正在打开数数页面并监听 WebSocket；如弹出登录页，请先完成登录。");
      const saved = await refreshShushuSqlideWebSocketUrl(shushuForm.projectId, shushuWebSocketRefreshAbortRef.current.signal);
      setShushuForm((current) => ({
        ...current,
        sqlideWebSocketUrl: saved.sqlideWebSocketUrl,
      }));
      setShushuQueryMeta(`WebSocket 刷新完成 ｜ 耗时：${Math.round((Date.now() - refreshStartTime) / 1000)} 秒`);
      setShushuQueryProgress("已自动刷新并保存数数 WebSocket 地址。");
      clearErrorPrefix("数数查询");
    } catch (error) {
      const elapsedSeconds = Math.round((Date.now() - refreshStartTime) / 1000);
      const message = String((error as Error).message);
      if ((error as Error).name === "AbortError" || message.includes("WebSocket 刷新已终止")) {
        setShushuQueryMeta(`WebSocket 刷新已自动中断 ｜ 已等待：${elapsedSeconds} 秒`);
        setShushuQueryProgress("90 秒内没有捕获到新的 WebSocket，请确认弹出的数数页面已登录并手动点一次查询后重试。");
      } else {
        setShushuQueryMeta(`WebSocket 刷新失败 ｜ 已等待：${elapsedSeconds} 秒`);
        pushError("数数查询", error);
      }
    } finally {
      setIsRefreshingShushuWebSocket(false);
      shushuWebSocketRefreshAbortRef.current = null;
    }
  }

  function clearErrorPrefix(prefix: string) {
    setErrors((current) => current.filter((item) => !item.startsWith(`${prefix}解析失败`)));
  }

  function pushError(prefix: string, error: unknown) {
    setErrors((current) => [
      ...current.filter((item) => !item.startsWith(`${prefix}解析失败`)),
      `${prefix}解析失败：${String((error as Error).message)}`,
    ]);
  }

  function toggleLarkSheet(sheetId: string) {
    setSelectedLarkSheetIds((current) =>
      current.includes(sheetId) ? current.filter((id) => id !== sheetId) : [...current, sheetId],
    );
  }

  function toggleLocalSheet(sheetId: string) {
    setSelectedLocalSheetIds((current) =>
      current.includes(sheetId) ? current.filter((id) => id !== sheetId) : [...current, sheetId],
    );
  }

  function handleStatusFilterChange(nextStatus: (typeof statusOptions)[number]) {
    setStatusFilter(nextStatus);
    window.requestAnimationFrame(() => {
      detailPanelRef.current?.scrollIntoView({ block: "start" });
    });
  }

  function scrollConfigPanelToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleConfigPanelCollapseToggle() {
    if (isConfigPanelCollapsed) {
      setIsConfigPanelCollapsed(false);
      window.requestAnimationFrame(() => {
        scrollConfigPanelToTop();
        window.requestAnimationFrame(scrollConfigPanelToTop);
      });
      return;
    }
    setIsConfigPanelCollapsed(true);
  }

  return (
    <main className={`${isConfigPanelCollapsed ? "app-shell config-panel-sticky-active" : "app-shell"} ${
      isDetailPanelDocked ? "detail-panel-docked" : ""
    }`}>
      <header className="app-header">
        <div>
          <p className="eyebrow">ShuShu SQL Export</p>
          <h1>埋点覆盖核对工具</h1>
          <p className="subtitle">上传预期埋点表和实际事件导出，检查事件与必传属性覆盖情况。</p>
        </div>
      </header>

      {errors.length > 0 && (
        <section className="alert-panel dismissible-alert" aria-live="polite">
          <div>
            {errors.map((error) => (
              <p key={error}>{error}</p>
            ))}
          </div>
          <button
            aria-label="关闭错误提示"
            className="alert-close-button"
            onClick={() => setErrors([])}
            type="button"
          >
            ×
          </button>
        </section>
      )}

      <section
        className={`panel upload-panel ${isConfigPanelCollapsed ? "upload-panel-collapsed" : ""}`}
        ref={configPanelRef}
      >
        <div className="panel-title-row config-panel-title-row">
          <div>
            <h2>数据源配置</h2>
            <p className="section-caption">左侧读取预期埋点表，右侧获取实际事件数据。</p>
          </div>
          <button
            className="secondary-button config-collapse-button"
            onClick={handleConfigPanelCollapseToggle}
            type="button"
          >
            {isConfigPanelCollapsed ? "展开" : "收起"}
          </button>
        </div>
        <div
          aria-hidden={isConfigPanelCollapsed}
          className="upload-list horizontal-upload-list upload-panel-body"
        >
          <div className="upload-box">
            <div className="source-card-heading">
              <div>
                <span>预期数据源</span>
                <strong>{expectedEvents.length} 个事件 / {expectedPropertyCount} 个属性</strong>
              </div>
            </div>
            <div className="source-tabs source-tabs-left" role="tablist" aria-label="预期数据来源">
              <button
                className={expectedInputMode === "lark" ? "active" : ""}
                onClick={() => setExpectedInputMode("lark")}
                type="button"
              >
                飞书预期埋点表链接
              </button>
              <button
                className={expectedInputMode === "local" ? "active" : ""}
                onClick={() => setExpectedInputMode("local")}
                type="button"
              >
                本地埋点预期表
              </button>
            </div>
            {expectedInputMode === "lark" ? (
              <>
            <div className="inline-form">
              <input
                value={larkUrl}
                onChange={(event) => {
                  setLarkUrl(event.target.value);
                  setLarkTabs([]);
                  setSelectedLarkSheetIds([]);
                  setIsLarkTabsExpanded(true);
                }}
                placeholder="https://.../sheets/..."
                aria-label="飞书表格链接"
              />
              <button
                className="secondary-button"
                disabled={isReadingLark || !larkUrl.trim()}
                onClick={handleListLarkTabs}
                type="button"
              >
                {isReadingLark ? "读取中" : "读取页签"}
              </button>
            </div>
            {larkTabs.length > 0 && (
              <>
                <div className="selection-summary">
                  <span>
                    已选 {selectedLarkSheetIds.length} 个页签：
                    {larkTabs
                      .filter((tab) => selectedLarkSheetIds.includes(tab.id))
                      .map((tab) => tab.title)
                      .join("、") || "-"}
                  </span>
                  <button
                    className="link-button"
                    onClick={() => setIsLarkTabsExpanded((current) => !current)}
                    type="button"
                  >
                    {isLarkTabsExpanded ? "收起" : "展开"}
                  </button>
                </div>
                {isLarkTabsExpanded && (
                  <div className="sheet-picker" aria-label="飞书页签选择">
                    {larkTabs.map((tab) => (
                      <label className="checkbox-row" key={tab.id}>
                        <input
                          type="checkbox"
                          checked={selectedLarkSheetIds.includes(tab.id)}
                          onChange={() => toggleLarkSheet(tab.id)}
                        />
                        <span>{tab.title}</span>
                        <code>{tab.id}</code>
                      </label>
                    ))}
                  </div>
                )}
                <button className="primary-button inline-button" disabled={isReadingLark || selectedLarkSheetIds.length === 0} onClick={handleReadSelectedLarkSheets} type="button">
                  读取选中页签
                </button>
              </>
            )}
              </>
            ) : (
              <>
                <label className="file-field">
                  <span>本地埋点预期表</span>
                  <input
                    type="file"
                    accept=".csv,.xls,.xlsx"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      void handleLocalExpectedFile(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                {localExpectedSheets.length > 0 && (
                  <>
                    <div className="selection-summary">
                      <span>
                        已选 {selectedLocalSheetIds.length} 个页签：
                        {localExpectedSheets
                          .filter((tab) => selectedLocalSheetIds.includes(tab.id))
                          .map((tab) => tab.title)
                          .join("、") || "-"}
                      </span>
                      <button
                        className="link-button"
                        onClick={() => setIsLocalSheetsExpanded((current) => !current)}
                        type="button"
                      >
                        {isLocalSheetsExpanded ? "收起" : "展开"}
                      </button>
                    </div>
                    {isLocalSheetsExpanded && (
                      <div className="sheet-picker" aria-label="本地页签选择">
                        {localExpectedSheets.map((tab) => (
                          <label className="checkbox-row" key={tab.id}>
                            <input
                              type="checkbox"
                              checked={selectedLocalSheetIds.includes(tab.id)}
                              onChange={() => toggleLocalSheet(tab.id)}
                            />
                            <span>{tab.title}</span>
                            <code>{tab.id}</code>
                          </label>
                        ))}
                      </div>
                    )}
                    <button
                      className="primary-button inline-button"
                      disabled={selectedLocalSheetIds.length === 0}
                      onClick={handleReadSelectedLocalSheets}
                      type="button"
                    >
                      读取选中页签
                    </button>
                  </>
                )}
              </>
            )}
          </div>
          <div className="upload-box">
            <div className="source-card-heading">
              <div>
                <span>实际数据源</span>
                <strong>{actualRowCount} 行记录</strong>
              </div>
              {renderQueryTimer(isQueryingShushu, shushuQueryRemainingMs)}
            </div>
            <div className="source-tabs source-tabs-right" role="tablist" aria-label="实际数据来源">
              <button
                className={actualInputMode === "shushu" ? "active" : ""}
                onClick={() => setActualInputMode("shushu")}
                type="button"
              >
                数数自定义查询
              </button>
              <button
                className={actualInputMode === "file" ? "active" : ""}
                onClick={() => setActualInputMode("file")}
                type="button"
              >
                实际 SQL 导出 CSV/Excel
              </button>
            </div>
            {actualInputMode === "shushu" ? (
              <div className="shushu-query-form">
                <div className="form-grid form-grid-3">
                  <label className="field-row">
                    <span>项目</span>
                    {shushuProjects.length > 0 ? (
                      <select
                        value={shushuForm.projectId}
                        onChange={(event) => updateShushuForm("projectId", event.target.value)}
                      >
                        {shushuProjects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name} ({project.id})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={shushuForm.projectId}
                        onChange={(event) => updateShushuForm("projectId", event.target.value)}
                        placeholder="项目 ID"
                      />
                    )}
                  </label>
                  <label className="field-row">
                    <span>分页行数</span>
                    <input
                      min="1"
                      max="10000"
                      type="number"
                      value={shushuForm.pageSize}
                      onChange={(event) => updateShushuForm("pageSize", event.target.value)}
                    />
                  </label>
                  <label className="field-row">
                    <span>最多读取行数 <em className="field-hint">（上限 5000）</em></span>
                    <input min="1" max="5000" type="number" value={shushuForm.maxRows} onChange={(event) => updateShushuForm("maxRows", event.target.value)} />
                  </label>
                </div>
                <div className="form-grid form-grid-3">
                  <label className="field-row">
                    <span>开始日期</span>
                    <input type="date" value={shushuForm.startDate} onChange={(event) => updateShushuForm("startDate", event.target.value)} />
                  </label>
                  <label className="field-row">
                    <span>结束日期</span>
                    <input type="date" value={shushuForm.endDate} onChange={(event) => updateShushuForm("endDate", event.target.value)} />
                  </label>
                  <label className="field-row">
                    <span>app_version</span>
                    <input value={shushuForm.appVersion} onChange={(event) => updateShushuForm("appVersion", event.target.value)} placeholder="可为空" />
                  </label>
                </div>
                <div className="form-grid form-grid-query">
                  <label className="field-row">
                    <span>用户 ID 字段</span>
                    <select value={shushuForm.userIdColumn} onChange={(event) => updateShushuForm("userIdColumn", event.target.value)}>
                      <option value="#account_id">#account_id</option>
                      <option value="#user_id">#user_id</option>
                      <option value="#distinct_id">#distinct_id</option>
                    </select>
                  </label>
                  <label className="field-row">
                    <span>用户 ID <em className="field-hint">（尽量单号查询）</em></span>
                    <input value={shushuForm.userId} onChange={(event) => updateShushuForm("userId", event.target.value)} placeholder="可为空" />
                  </label>
                  <div className="field-row event-filter-row compact-event-filter-row">
                    <span>事件名筛选</span>
                    <details className="event-filter-dropdown" ref={eventFilterDropdownRef}>
                      <summary>
                        <span className="event-filter-summary">{eventFilterSummary}</span>
                        <span className="event-filter-count">
                          {eventNameFilterCount > 0 ? `已选 ${eventNameFilterCount}` : "未选择"}
                        </span>
                      </summary>
                      <div className="event-filter-menu">
                        <div className="event-filter-actions">
                          <input
                            value={eventFilterSearch}
                            onChange={(event) => setEventFilterSearch(event.target.value)}
                            placeholder="搜索事件名"
                          />
                          <button
                            className="event-filter-select-all"
                            disabled={filteredExpectedEventNameOptions.length === 0}
                            onClick={() => {
                              const filteredNames = new Set(filteredExpectedEventNameOptions);
                              const nextNames = allFilteredEventsSelected
                                ? selectedEventNameList.filter((eventName) => !filteredNames.has(eventName))
                                : [...selectedEventNameList, ...filteredExpectedEventNameOptions];
                              updateSelectedEventNames(nextNames);
                            }}
                            type="button"
                          >
                            <span
                              aria-hidden="true"
                              className={`event-filter-check ${
                                allFilteredEventsSelected
                                  ? "checked"
                                  : someFilteredEventsSelected
                                    ? "mixed"
                                    : ""
                              }`}
                            />
                            <span>局选</span>
                          </button>
                          <button
                            className="event-filter-select-all"
                            disabled={expectedEventNameOptions.length === 0}
                            onClick={() => {
                              updateSelectedEventNames(allExpectedEventsSelected ? [] : expectedEventNameOptions);
                            }}
                            type="button"
                          >
                            <span
                              aria-hidden="true"
                              className={`event-filter-check ${
                                allExpectedEventsSelected
                                  ? "checked"
                                  : someExpectedEventsSelected
                                    ? "mixed"
                                    : ""
                              }`}
                            />
                            <span>全选</span>
                          </button>
                        </div>
                        <div className="event-filter-options">
                          {filteredExpectedEventNameOptions.length > 0 ? (
                            filteredExpectedEventNameOptions.map((eventName) => (
                              <label className="event-filter-option" key={eventName}>
                                <input
                                  checked={selectedEventNames.has(eventName)}
                                  onChange={(event) => {
                                    const nextNames = event.target.checked
                                      ? [...selectedEventNameList, eventName]
                                      : selectedEventNameList.filter((selectedName) => selectedName !== eventName);
                                    updateSelectedEventNames(nextNames);
                                  }}
                                  type="checkbox"
                                />
                                <span>{eventName}</span>
                              </label>
                            ))
                          ) : (
                            <div className="event-filter-empty">没有匹配的事件名</div>
                          )}
                        </div>
                      </div>
                    </details>
                  </div>
                </div>
                {shushuQueryScopeError && <div className="query-warning">{shushuQueryScopeError}</div>}
                <div className="shushu-panel-tabs">
                  <div className="shushu-panel-toolbar">
                    <div className="source-tabs shushu-sub-tabs" role="tablist" aria-label="数数查询辅助面板">
                      <button
                        aria-selected={activeShushuPanelTab === "query"}
                        className={activeShushuPanelTab === "query" ? "active" : ""}
                        onClick={() => setActiveShushuPanelTab("query")}
                        type="button"
                      >
                        查询任务
                      </button>
                      <button
                        aria-selected={activeShushuPanelTab === "queue"}
                        className={activeShushuPanelTab === "queue" ? "active" : ""}
                        onClick={() => setActiveShushuPanelTab("queue")}
                        type="button"
                      >
                        任务队列
                      </button>
                      <button
                        aria-selected={activeShushuPanelTab === "advanced"}
                        className={activeShushuPanelTab === "advanced" ? "active" : ""}
                        onClick={() => setActiveShushuPanelTab("advanced")}
                        type="button"
                      >
                        高级配置
                      </button>
                    </div>
                    <button
                      className={`primary-button query-button${isQueryingShushu ? " danger-button" : ""}`}
                      disabled={!isQueryingShushu && !canStartShushuQuery}
                      onClick={handleShushuQuery}
                      type="button"
                      title={!canStartShushuQuery ? shushuQueryScopeError ?? "请先补充数数查询条件" : undefined}
                    >
                      {isQueryingShushu
                        ? `终止（${formatShushuQueryCountdown(shushuQueryRemainingMs)}）`
                        : "查询实际数据"}
                    </button>
                  </div>
                  <div className="query-task-panel">
                    {activeShushuPanelTab === "query" && (
                      <div className="shushu-tab-pane">
                        <div className="query-task-header">
                          <span>查询任务</span>
                          {renderQueryTimer(isQueryingShushu, shushuQueryRemainingMs)}
                        </div>
                        {shushuQueryProgress ? (
                          <div className="query-progress">
                            {(isRefreshingShushuWebSocket || shushuQueryMeta) && (
                              <span className="query-meta-line">
                                {isRefreshingShushuWebSocket
                                  ? `WebSocket 刷新中 ｜ 已等待 ${shushuWebSocketRefreshElapsed} 秒 / 90 秒`
                                  : shushuQueryMeta}
                              </span>
                            )}
                            <span>{shushuQueryProgress}</span>
                          </div>
                        ) : (
                          <div className="query-progress query-progress-muted">等待查询实际数据</div>
                        )}
                        {lastShushuSql && <code className="sql-preview">{lastShushuSql}</code>}
                        <strong>{actualRowCount} 行记录</strong>
                      </div>
                    )}
                    {activeShushuPanelTab === "queue" && (
                      <div className="shushu-tab-pane">
                        <div className="queue-list">
                          <div className="queue-list-title">
                            <span>当前任务队列</span>
                            <button className="link-button" onClick={() => void refreshShushuQueue()} type="button">
                              刷新
                            </button>
                          </div>
                          {shushuQueueTasks.length > 0 ? (
                            shushuQueueTasks.slice(0, 8).map((task) => (
                              <div className={`queue-item queue-item-${task.status}`} key={task.id}>
                                <div>
                                  <strong>{formatShushuQueueStatus(task.status)}{task.position ? ` #${task.position}` : ""}</strong>
                                  <span>{task.summary}</span>
                                  {task.queryChannel && <em>{task.queryChannel === "openapi" ? "API 查询" : "WebSocket 查询"}</em>}
                                  {task.error && <em>{task.error}</em>}
                                </div>
                                {(task.status === "queued" || task.status === "running") && (
                                  <button className="secondary-button queue-cancel-button" onClick={() => void handleCancelShushuQueueTask(task.id)} type="button">
                                    取消
                                  </button>
                                )}
                              </div>
                            ))
                          ) : (
                            <div className="queue-empty">暂无排队任务</div>
                          )}
                        </div>
                      </div>
                    )}
                    {activeShushuPanelTab === "advanced" && (
                      <div className="advanced-config-body">
                        <label className="field-row">
                          <span>WebSocket 查询地址</span>
                          <input
                            value={shushuForm.sqlideWebSocketUrl}
                            onChange={(event) => updateShushuForm("sqlideWebSocketUrl", event.target.value)}
                            placeholder="wss://shu.deltafun.pro/v1/ta-websocket/query/..."
                          />
                        </label>
                        <div className="advanced-config-actions">
                          <button
                            className="secondary-button"
                            disabled={isSavingShushuConfig || isQueryingShushu || isRefreshingShushuWebSocket}
                            onClick={handleSaveShushuAdvancedConfig}
                            type="button"
                          >
                            {isSavingShushuConfig ? "保存中" : "保存地址"}
                          </button>
                          <button
                            className="secondary-button"
                            disabled={isSavingShushuConfig || isQueryingShushu || isRefreshingShushuWebSocket}
                            onClick={handleRefreshShushuWebSocket}
                            type="button"
                          >
                            {isRefreshingShushuWebSocket ? `刷新中 ${shushuWebSocketRefreshElapsed}s` : "刷新 WebSocket"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="file-upload-panel">
                <label className="file-field">
                  <span>选择文件（CSV 大文件走后端扫描，Excel 走页面读取）</span>
                  <input
                    type="file"
                    accept=".csv,.xls,.xlsx"
                    disabled={isReadingActualFile}
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      void handleActualFile(file);
                      event.currentTarget.value = "";
                    }}
                  />
                  <strong>{actualRowCount} 行记录</strong>
                </label>
                {actualFileProgress && (
                  <div className={isReadingActualFile ? "query-progress" : "query-progress query-progress-muted"}>
                    {actualFileProgress}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-title-row">
          <div>
            <h2>覆盖总览</h2>
            <p className="section-caption">优先看覆盖率，再进入明细定位异常。</p>
          </div>
          <button
            className="primary-button inline-button"
            disabled={!report}
            onClick={() => report && downloadCsv("event-coverage-report.csv", coverageResultsToCsv(report.results))}
          >
            导出结果 CSV
          </button>
        </div>

        <div className="metric-grid">
          <Metric label="事件覆盖率" value={report ? formatPercent(report.summary.eventCoverageRate) : "-"} />
          <Metric label="属性覆盖率" value={report ? formatPercent(report.summary.propertyCoverageRate) : "-"} />
          <Metric label="详情覆盖率" value={report ? formatPercent(report.summary.detailCoverageRate) : "-"} />
        </div>
      </section>

      <section className="panel detail-panel" ref={detailPanelRef}>
        <div className="panel-title-row">
          <h2>数据明细</h2>
          <div className="toolbar">
            <div className="status-filter" aria-label="状态筛选">
              {statusOptions.map((option) => (
                <button
                  key={option}
                  className={statusFilter === option ? "active" : ""}
                  onClick={() => handleStatusFilterChange(option)}
                  type="button"
                >
                  <span>{option}</span>
                  <strong>{statusCounts[option]}</strong>
                </button>
              ))}
            </div>
            <input
              className="search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索事件或属性"
            />
          </div>
        </div>
        <p className="filter-summary">
          {statusFilter === "测试用例"
            ? `当前显示 ${filteredEventTestResults.length} / ${eventTestReport.totalRules} 条测试用例，已检查 ${eventTestReport.checkedRows.toLocaleString()} 行事件，${eventTestReport.issueCount === 0 ? "全部通过" : `${eventTestReport.issueCount} 个异常`}`
            : statusFilter === "详情缺失"
            ? `当前显示 ${filteredPropertyDetailRows.length} / ${propertyDetailRows.length} 条属性详情`
            : `当前显示 ${filteredResults.length} / ${detailRows.length} 条明细`}
        </p>
        <div className="table-wrap">
          {statusFilter === "测试用例" ? (
            <table className="event-test-table">
              <thead>
                <tr>
                  <th>状态</th>
                  <th>用例 ID</th>
                  <th>用例名称</th>
                  <th>检查次数</th>
                  <th>异常数</th>
                  <th>结果说明</th>
                </tr>
              </thead>
              <tbody key={`test-case:${query}:${filteredEventTestResults.length}`}>
                {actualRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty-cell">
                      暂无可执行的原始事件行。请先通过数数查询或页面上传实际数据；大 CSV 扫描当前只保留覆盖摘要，无法执行顺序类测试用例。
                    </td>
                  </tr>
                ) : filteredEventTestResults.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty-cell">
                      没有匹配的测试用例
                    </td>
                  </tr>
                ) : (
                  filteredEventTestResults.map(renderEventTestResult)
                )}
              </tbody>
            </table>
          ) : statusFilter === "详情缺失" ? (
            <table className="property-detail-table">
              <thead>
                <tr>
                  <th>事件名</th>
                  <th>属性名</th>
                  <th>预期详情</th>
                  <th>已覆盖详情</th>
                  <th>通过率</th>
                </tr>
              </thead>
              <tbody key={`detail:${query}:${filteredPropertyDetailRows.length}`}>
                {filteredPropertyDetailRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty-cell">
                      没有可展示的属性详情
                    </td>
                  </tr>
                ) : (
                  filteredPropertyDetailRows.map((row) => (
                    <tr className={row.isPassed ? "detail-row-pass" : "detail-row-fail"} key={row.rowKey}>
                      <td>
                        <code>{row.eventName}</code>
                      </td>
                      <td>{row.propertyName}</td>
                      <td>{renderPropertyDetail(row.expectedDetail)}</td>
                      <td>{renderDetailCoverage(row.expectedDetailItems, row.coveredDetailItems)}</td>
                      <td className="rate-cell">
                        <strong>{formatPercent(row.passRate)}</strong>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>状态</th>
                  <th>事件名</th>
                  <th>触发次数</th>
                  <th>预期属性</th>
                  <th>{statusFilter === "公共事件缺失" ? "问题事件" : "已覆盖属性"}</th>
                  <th>通过率</th>
                </tr>
              </thead>
              <tbody key={`${statusFilter}:${query}:${filteredResults.length}`}>
                {filteredResults.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty-cell">
                      上传两份数据后显示覆盖明细
                    </td>
                  </tr>
                ) : (
                  filteredResults.map((result) => (
                    <tr key={result.rowKey}>
                      <td>
                        <span className={`status status-${result.status}`}>{result.status}</span>
                      </td>
                      <td>
                        <code>{result.eventName}</code>
                      </td>
                      <td className="count-cell">{result.triggerCount ?? "-"}</td>
                      <td>{renderPropertyLines(result.expectedProperties)}</td>
                      <td>{renderCoveredPropertyLines(result)}</td>
                      <td className="rate-cell">
                        <strong>{formatPercent(result.passRate)}</strong>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {report && (
        <section className="panel missing-panel">
          <div className="panel-title-row">
            <div>
              <h2>缺失清单</h2>
              <p className="section-caption">异常项按状态颜色展示，便于快速分派处理。</p>
            </div>
          </div>
          <div className="missing-list">
            {detailRows
              .filter((result) => result.status !== "测试通过")
              .map((result) => (
                <div className={`missing-item missing-item-${result.status}`} key={result.rowKey}>
                  <strong>{result.status === "公共事件缺失" ? `${result.status}:` : `${result.status}: ${result.eventName}`}</strong>
                  <span>{renderMissingListContent(result)}</span>
                </div>
              ))}
            {report.results.every((result) => result.status === "测试通过") && (
              <p className="hint">当前结果没有缺失项。</p>
            )}
          </div>
          {report.extraEvents.length > 0 && (
            <p className="hint">
              实际数据中存在 {report.extraEvents.length} 个预期表外事件：
              {report.extraEvents.slice(0, 8).join(", ")}
            </p>
          )}
        </section>
      )}

      <button
        aria-label="返回顶部"
        className="back-to-top-button"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        title="返回顶部"
        type="button"
      >
        ↑
      </button>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

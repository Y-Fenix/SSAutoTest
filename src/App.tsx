import { useMemo, useRef, useState } from "react";
import { detectEventNameColumn, parseActualDataRows } from "./lib/actualDataParser";
import { evaluateCoverage } from "./lib/coverageEvaluator";
import { coverageResultsToCsv, downloadCsv } from "./lib/exporter";
import { readTabularFile } from "./lib/fileReaders";
import { listLarkSheetTabs, readLarkSheetRows, type LarkSheetTab } from "./lib/larkSheetClient";
import { sampleActualRows } from "./lib/sampleData";
import { listShushuProjects, queryShushuRows } from "./lib/shushuQueryClient";
import type { ShushuProjectOption } from "./lib/shushuQuery";
import { parseTrackingPlanRows } from "./lib/trackingPlanParser";
import type { CoverageReport, CoverageResult, CoverageStatus, ExpectedEvent, RawRow } from "./lib/types";

type DisplayStatus = CoverageStatus | "公共事件缺失";
type ActualInputMode = "file" | "shushu";

const statusOptions = ["全部", "测试通过", "事件缺失", "属性缺失", "详情缺失", "公共事件缺失"] as const;
const actualColumnPrompt = "实际数据未自动识别事件名列，请在上传区域选择事件名列后继续分析。";
const defaultShushuForm = {
  apiBaseUrl: "",
  token: "",
  loginName: "",
  projectId: "",
  eventTable: "",
  startDate: "",
  endDate: "",
  userId: "",
  dateColumn: "$part_date",
  userIdColumn: "#account_id",
  pageSize: "1000",
};

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
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
  const detailPanelRef = useRef<HTMLElement | null>(null);
  const [expectedEvents, setExpectedEvents] = useState<ExpectedEvent[]>([]);
  const [actualRows, setActualRows] = useState<RawRow[]>([]);
  const [actualColumns, setActualColumns] = useState<string[]>([]);
  const [actualEventNameColumn, setActualEventNameColumn] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [larkUrl, setLarkUrl] = useState("");
  const [larkTabs, setLarkTabs] = useState<LarkSheetTab[]>([]);
  const [selectedLarkSheetIds, setSelectedLarkSheetIds] = useState<string[]>([]);
  const [isReadingLark, setIsReadingLark] = useState(false);
  const [isLarkTabsExpanded, setIsLarkTabsExpanded] = useState(false);
  const [isActualColumnExpanded, setIsActualColumnExpanded] = useState(false);
  const [actualInputMode, setActualInputMode] = useState<ActualInputMode>("file");
  const [shushuProjects, setShushuProjects] = useState<ShushuProjectOption[]>([]);
  const [shushuForm, setShushuForm] = useState(defaultShushuForm);
  const [isReadingShushuProjects, setIsReadingShushuProjects] = useState(false);
  const [isQueryingShushu, setIsQueryingShushu] = useState(false);
  const [lastShushuSql, setLastShushuSql] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof statusOptions)[number]>("全部");
  const [query, setQuery] = useState("");

  const report: CoverageReport | null = useMemo(() => {
    if (expectedEvents.length === 0 || actualRows.length === 0 || !actualEventNameColumn) return null;
    return evaluateCoverage(
      expectedEvents,
      parseActualDataRows(actualRows, actualEventNameColumn),
    );
  }, [expectedEvents, actualRows, actualEventNameColumn]);

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

  const statusCounts = useMemo(() => {
    const counts = Object.fromEntries(statusOptions.map((option) => [option, 0])) as Record<
      (typeof statusOptions)[number],
      number
    >;
    counts["全部"] = detailRows.length;
    detailRows.forEach((result) => {
      counts[result.status] += 1;
    });
    counts["详情缺失"] = report?.summary.detailMissingEvents ?? counts["详情缺失"];
    return counts;
  }, [detailRows, report]);

  function handleExpectedRows(rows: RawRow[]) {
    const events = parseTrackingPlanRows(rows);
    if (events.length === 0) throw new Error("预期埋点表中没有检测到事件。");
    setExpectedEvents(events);
    clearErrorPrefix("预期表");
  }

  async function handleListLarkTabs() {
    try {
      setIsReadingLark(true);
      const tabs = await listLarkSheetTabs(larkUrl);
      setLarkTabs(tabs);
      setSelectedLarkSheetIds(tabs.slice(0, 3).map((tab) => tab.id));
      setIsLarkTabsExpanded(false);
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

  async function handleActualFile(file: File | null) {
    if (!file) return;
    try {
      const rows = await readTabularFile(file);
      if (rows.length === 0) throw new Error("实际事件数据为空。");
      applyActualRows(rows);
    } catch (error) {
      pushError("实际数据", error);
    }
  }

  function applyActualRows(rows: RawRow[], preferredColumns?: string[]) {
    const columns = preferredColumns?.length
      ? preferredColumns
      : [...new Set(rows.flatMap((row) => Object.keys(row).map((key) => key.trim()).filter(Boolean)))];
    const detectedColumn = columns.includes("#event_name") ? "#event_name" : detectEventNameColumn(rows);
    setActualRows(rows);
    setActualColumns(columns);
    setActualEventNameColumn(detectedColumn ?? "");
    setIsActualColumnExpanded(false);
    clearErrorPrefix("实际数据");
    setErrors((current) => {
      const withoutPrompt = current.filter((item) => item !== actualColumnPrompt);
      return detectedColumn ? withoutPrompt : [...withoutPrompt, actualColumnPrompt];
    });
  }

  function updateShushuForm(field: keyof typeof defaultShushuForm, value: string) {
    setShushuForm((current) => {
      if (field === "projectId") {
        return {
          ...current,
          projectId: value,
          eventTable: current.eventTable && current.eventTable !== `v_event_${current.projectId}` ? current.eventTable : "",
        };
      }
      return { ...current, [field]: value };
    });
  }

  async function handleListShushuProjects() {
    try {
      setIsReadingShushuProjects(true);
      const projects = await listShushuProjects(shushuForm.apiBaseUrl, shushuForm.token, shushuForm.loginName);
      setShushuProjects(projects);
      if (!shushuForm.projectId && projects[0]) {
        updateShushuForm("projectId", projects[0].id);
      }
      clearErrorPrefix("数数查询");
    } catch (error) {
      setShushuProjects([]);
      pushError("数数查询", error);
    } finally {
      setIsReadingShushuProjects(false);
    }
  }

  async function handleShushuQuery() {
    try {
      setIsQueryingShushu(true);
      const result = await queryShushuRows({
        ...shushuForm,
        eventTable: shushuForm.eventTable.trim() || undefined,
        pageSize: Number(shushuForm.pageSize) || 1000,
      });
      if (result.rows.length === 0) throw new Error("数数查询返回 0 行数据。");
      applyActualRows(result.rows, result.columns);
      setLastShushuSql(result.sql);
      clearErrorPrefix("数数查询");
    } catch (error) {
      pushError("数数查询", error);
    } finally {
      setIsQueryingShushu(false);
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

  function handleStatusFilterChange(nextStatus: (typeof statusOptions)[number]) {
    setStatusFilter(nextStatus);
    window.requestAnimationFrame(() => {
      detailPanelRef.current?.scrollIntoView({ block: "start" });
    });
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">ShuShu SQL Export</p>
          <h1>埋点覆盖核对工具</h1>
          <p className="subtitle">上传预期埋点表和实际事件导出，检查事件与必传属性覆盖情况。</p>
        </div>
        <button
          className="secondary-button"
          onClick={() => {
            setActualRows(sampleActualRows);
            setActualColumns([...new Set(sampleActualRows.flatMap((row) => Object.keys(row)))]);
            setActualEventNameColumn(detectEventNameColumn(sampleActualRows) ?? "");
            clearErrorPrefix("实际数据");
            setErrors((current) => current.filter((item) => item !== actualColumnPrompt));
          }}
        >
          加载示例实际数据
        </button>
      </header>

      {errors.length > 0 && (
        <section className="alert-panel" aria-live="polite">
          {errors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </section>
      )}

      <section className="panel upload-panel">
        <div className="panel-title-row">
          <h2>数据上传</h2>
        </div>
        <div className="upload-list horizontal-upload-list">
          <label className="upload-box">
            <span>飞书预期埋点表链接</span>
            <div className="inline-form">
              <input
                value={larkUrl}
                onChange={(event) => {
                    setLarkUrl(event.target.value);
                    setLarkTabs([]);
                    setSelectedLarkSheetIds([]);
                    setIsLarkTabsExpanded(false);
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
                <button
                  className="primary-button inline-button"
                  disabled={isReadingLark || selectedLarkSheetIds.length === 0}
                  onClick={handleReadSelectedLarkSheets}
                  type="button"
                >
                  读取选中页签
                </button>
              </>
            )}
            <strong>
              {expectedEvents.length} 个事件 / {expectedPropertyCount} 个属性
            </strong>
          </label>
          <div className="upload-box">
            <div className="source-tabs" role="tablist" aria-label="实际数据来源">
              <button
                className={actualInputMode === "file" ? "active" : ""}
                onClick={() => setActualInputMode("file")}
                type="button"
              >
                实际 SQL 导出 CSV/Excel
              </button>
              <button
                className={actualInputMode === "shushu" ? "active" : ""}
                onClick={() => setActualInputMode("shushu")}
                type="button"
              >
                数数自定义查询
              </button>
            </div>
            {actualInputMode === "file" ? (
              <label className="file-field">
                <span>实际 SQL 导出 CSV/Excel</span>
                <input
                  type="file"
                  accept=".csv,.xls,.xlsx"
                  onChange={(event) => handleActualFile(event.target.files?.[0] ?? null)}
                />
                <strong>{actualRows.length} 行记录</strong>
              </label>
            ) : (
              <div className="shushu-query-form">
                <div className="form-grid form-grid-3">
                  <label className="field-row">
                    <span>API 地址</span>
                    <input
                      value={shushuForm.apiBaseUrl}
                      onChange={(event) => updateShushuForm("apiBaseUrl", event.target.value)}
                      placeholder="https://ta.example.com"
                    />
                  </label>
                  <label className="field-row">
                    <span>OpenAPI Token</span>
                    <input
                      value={shushuForm.token}
                      onChange={(event) => updateShushuForm("token", event.target.value)}
                      placeholder="token"
                      type="password"
                    />
                  </label>
                  <label className="field-row">
                    <span>登录名</span>
                    <div className="inline-form compact-inline-form">
                      <input
                        value={shushuForm.loginName}
                        onChange={(event) => updateShushuForm("loginName", event.target.value)}
                        placeholder="name@example.com"
                      />
                      <button
                        className="secondary-button"
                        disabled={isReadingShushuProjects || !shushuForm.apiBaseUrl || !shushuForm.token || !shushuForm.loginName}
                        onClick={handleListShushuProjects}
                        type="button"
                      >
                        {isReadingShushuProjects ? "读取中" : "拉取项目"}
                      </button>
                    </div>
                  </label>
                </div>
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
                    <span>事件表</span>
                    <input
                      value={shushuForm.eventTable}
                      onChange={(event) => updateShushuForm("eventTable", event.target.value)}
                      placeholder={shushuForm.projectId ? `v_event_${shushuForm.projectId}` : "v_event_项目ID"}
                    />
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
                </div>
                <div className="form-grid form-grid-4">
                  <label className="field-row">
                    <span>开始日期</span>
                    <input
                      type="date"
                      value={shushuForm.startDate}
                      onChange={(event) => updateShushuForm("startDate", event.target.value)}
                    />
                  </label>
                  <label className="field-row">
                    <span>结束日期</span>
                    <input
                      type="date"
                      value={shushuForm.endDate}
                      onChange={(event) => updateShushuForm("endDate", event.target.value)}
                    />
                  </label>
                  <label className="field-row">
                    <span>日期字段</span>
                    <select
                      value={shushuForm.dateColumn}
                      onChange={(event) => updateShushuForm("dateColumn", event.target.value)}
                    >
                      <option value="$part_date">$part_date</option>
                      <option value="#event_time">#event_time</option>
                    </select>
                  </label>
                  <label className="field-row">
                    <span>用户 ID</span>
                    <input
                      value={shushuForm.userId}
                      onChange={(event) => updateShushuForm("userId", event.target.value)}
                      placeholder="可为空"
                    />
                  </label>
                </div>
                <div className="form-grid form-grid-2">
                  <label className="field-row">
                    <span>用户 ID 字段</span>
                    <select
                      value={shushuForm.userIdColumn}
                      onChange={(event) => updateShushuForm("userIdColumn", event.target.value)}
                    >
                      <option value="#account_id">#account_id</option>
                      <option value="#distinct_id">#distinct_id</option>
                      <option value="user_id">user_id</option>
                    </select>
                  </label>
                  <button
                    className="primary-button query-button"
                    disabled={isQueryingShushu || !shushuForm.apiBaseUrl || !shushuForm.token || !shushuForm.projectId}
                    onClick={handleShushuQuery}
                    type="button"
                  >
                    {isQueryingShushu ? "查询中" : "查询实际数据"}
                  </button>
                </div>
                {lastShushuSql && <code className="sql-preview">{lastShushuSql}</code>}
                <strong>{actualRows.length} 行记录</strong>
              </div>
            )}
            {actualRows.length > 0 && actualColumns.length > 0 && (
              <>
                <div className="selection-summary">
                  <span>事件名列：{actualEventNameColumn || "未识别"}</span>
                  <button
                    className="link-button"
                    onClick={() => setIsActualColumnExpanded((current) => !current)}
                    type="button"
                  >
                    {isActualColumnExpanded ? "收起" : "展开"}
                  </button>
                </div>
                {isActualColumnExpanded && (
                  <label className="field-row">
                    <span>事件名列</span>
                    <select
                      value={actualEventNameColumn}
                      onChange={(event) => {
                        setActualEventNameColumn(event.target.value);
                        setErrors((current) => current.filter((item) => item !== actualColumnPrompt));
                      }}
                    >
                      <option value="">请选择事件名列</option>
                      {actualColumns.map((column) => (
                        <option key={column} value={column}>
                          {column}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-title-row">
          <h2>覆盖总览</h2>
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
          {statusFilter === "详情缺失"
            ? `当前显示 ${filteredPropertyDetailRows.length} / ${propertyDetailRows.length} 条属性详情`
            : `当前显示 ${filteredResults.length} / ${detailRows.length} 条明细`}
        </p>
        <div className="table-wrap">
          {statusFilter === "详情缺失" ? (
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
        <section className="panel">
          <h2>缺失清单</h2>
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

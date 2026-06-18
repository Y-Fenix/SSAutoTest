import { useMemo, useState } from "react";
import { detectEventNameColumn, parseActualDataRows } from "./lib/actualDataParser";
import { evaluateCoverage } from "./lib/coverageEvaluator";
import { coverageResultsToCsv, downloadCsv } from "./lib/exporter";
import { readTabularFile } from "./lib/fileReaders";
import { listLarkSheetTabs, readLarkSheetRows, type LarkSheetTab } from "./lib/larkSheetClient";
import { sampleActualRows } from "./lib/sampleData";
import { parseTrackingPlanRows } from "./lib/trackingPlanParser";
import type { CoverageReport, CoverageResult, CoverageStatus, ExpectedEvent, RawRow } from "./lib/types";

type DisplayStatus = CoverageStatus | "公共事件缺失";

const statusOptions = ["全部", "测试通过", "事件缺失", "属性缺失", "详情缺失", "公共事件缺失"] as const;
const actualColumnPrompt = "实际数据未自动识别事件名列，请在上传区域选择事件名列后继续分析。";

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

function renderMissingDetails(result: DetailRow) {
  if (result.status !== "公共事件缺失") return renderPropertyLines(result.missingProperties);
  const eventNames = result.missingProperties.map((item) => item.split("：").slice(1).join("：") || item);
  return renderPropertyLines(eventNames);
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
    return detailRows.flatMap((result) =>
      result.expectedProperties
        .filter((propertyName) => result.propertyDetails[propertyName]?.trim())
        .map((propertyName) => ({
          rowKey: `${result.rowKey}:detail:${propertyName}`,
          eventName: result.eventName,
          propertyName,
          propertyDetail: result.propertyDetails[propertyName] ?? "",
          isPassed: result.passedProperties.includes(propertyName),
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
      const text = [row.eventName, row.propertyName, row.propertyDetail].join(" ").toLowerCase();
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
    return counts;
  }, [detailRows]);

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
      const columns = [...new Set(rows.flatMap((row) => Object.keys(row).map((key) => key.trim()).filter(Boolean)))];
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
    } catch (error) {
      pushError("实际数据", error);
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
            <label className="file-field">
              <span>实际 SQL 导出 CSV/Excel</span>
              <input
                type="file"
                accept=".csv,.xls,.xlsx"
                onChange={(event) => handleActualFile(event.target.files?.[0] ?? null)}
              />
              <strong>{actualRows.length} 行记录</strong>
            </label>
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
          <Metric label="事件缺失" value={report?.summary.missingEvents ?? "-"} />
          <Metric label="属性覆盖率" value={report ? formatPercent(report.summary.propertyCoverageRate) : "-"} />
          <Metric label="属性缺失" value={report?.summary.propertyMissingEvents ?? "-"} />
          <Metric label="详情覆盖率" value={report ? formatPercent(report.summary.detailCoverageRate) : "-"} />
          <Metric label="详情缺失" value={report?.summary.detailMissingEvents ?? "-"} />
        </div>
      </section>

      <section className="panel detail-panel">
        <div className="panel-title-row">
          <h2>数据明细</h2>
          <div className="toolbar">
            <div className="status-filter" aria-label="状态筛选">
              {statusOptions.map((option) => (
                <button
                  key={option}
                  className={statusFilter === option ? "active" : ""}
                  onClick={() => setStatusFilter(option)}
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
                  <th>属性详情</th>
                </tr>
              </thead>
              <tbody key={`detail:${query}:${filteredPropertyDetailRows.length}`}>
                {filteredPropertyDetailRows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="empty-cell">
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
                      <td>{renderPropertyDetail(row.propertyDetail)}</td>
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
                  <th>已覆盖属性</th>
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
                  <strong>
                    {result.status}: {result.eventName}
                  </strong>
                  <span>
                    {result.status === "事件缺失"
                      ? "实际数据中没有该事件"
                      : (
                          <>
                            {result.status === "公共事件缺失"
                              ? "缺失事件："
                              : result.status === "详情缺失"
                                ? "详情缺失："
                                : "缺失属性："}
                            {result.status === "详情缺失"
                              ? renderPropertyLines(result.detailMissingProperties)
                              : renderMissingDetails(result)}
                          </>
                        )}
                  </span>
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

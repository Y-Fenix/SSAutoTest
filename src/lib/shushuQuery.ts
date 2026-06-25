import type { RawRow } from "./types";

export interface ShushuProjectOption {
  id: string;
  name: string;
}

export interface ShushuQueryConfig {
  apiBaseUrl: string;
  token: string;
  projectId: string;
  eventTable: string;
  dateColumn: string;
  userIdColumn: string;
  startDate: string;
  endDate: string;
  userId: string;
  appVersion: string;
  pageSize: number;
}

export type ShushuQueryInput = Partial<ShushuQueryConfig> & {
  projectId?: string;
};

export interface ShushuQueryResponse {
  rows: RawRow[];
  columns: string[];
  sql: string;
  rowCount: number;
}

export interface ShushuQueryStartResponse {
  taskId: string;
  sql: string;
}

export interface ShushuTaskInfo {
  taskId: string;
  status: string;
  progress: number;
  rowCount: number;
  pageCount: number;
  columns: string[];
  errorMessage: string;
}

export interface ShushuResultPageResponse {
  rows: RawRow[];
  columns: string[];
  pageId: number;
}

const identifierPattern = /^[#A-Za-z_$][#A-Za-z0-9_$]*$/;
const tablePattern = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

function requireSafeIdentifier(value: string, label: string): string {
  const trimmed = value.trim();
  if (!identifierPattern.test(trimmed)) {
    throw new Error(`${label}只能包含字母、数字、下划线、#、$，且不能包含空格或 SQL 片段。`);
  }
  return trimmed;
}

function requireSafeTable(value: string): string {
  const trimmed = value.trim();
  if (!tablePattern.test(trimmed)) {
    throw new Error("事件表名只能包含字母、数字、下划线和一个库名前缀点号，且不能包含空格或 SQL 片段。");
  }
  return trimmed;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteValue(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function plusOneDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function defaultEventTable(projectId: string): string {
  return `v_event_${projectId.trim()}`;
}

export function normalizeShushuQueryConfig(input: ShushuQueryInput): ShushuQueryConfig {
  const projectId = String(input.projectId ?? "").trim();
  if (!projectId) throw new Error("请选择或填写数数项目 ID。");
  if (!/^[A-Za-z0-9_]+$/.test(projectId)) {
    throw new Error("项目 ID 只能包含字母、数字、下划线。");
  }

  const eventTable = requireSafeTable(input.eventTable?.trim() || defaultEventTable(projectId));
  const dateColumn = requireSafeIdentifier(input.dateColumn?.trim() || "$part_date", "日期字段");
  const userIdColumn = requireSafeIdentifier(input.userIdColumn?.trim() || "#account_id", "用户 ID 字段");

  return {
    apiBaseUrl: String(input.apiBaseUrl ?? "").trim().replace(/\/+$/, ""),
    token: String(input.token ?? "").trim(),
    projectId,
    eventTable,
    dateColumn,
    userIdColumn,
    startDate: String(input.startDate ?? "").trim(),
    endDate: String(input.endDate ?? "").trim(),
    userId: String(input.userId ?? "").trim(),
    appVersion: String(input.appVersion ?? "").trim(),
    pageSize: Number(input.pageSize) > 0 ? Math.min(Number(input.pageSize), 10000) : 1000,
  };
}

export function buildShushuSql(config: ShushuQueryConfig): string {
  const conditions: string[] = [];
  if (config.startDate) {
    conditions.push(`${quoteIdentifier(config.dateColumn)} >= ${quoteValue(config.startDate)}`);
  }
  if (config.endDate) {
    const upperBound = config.dateColumn === "#event_time" ? `${plusOneDay(config.endDate)} 00:00:00` : config.endDate;
    const operator = config.dateColumn === "#event_time" ? "<" : "<=";
    conditions.push(`${quoteIdentifier(config.dateColumn)} ${operator} ${quoteValue(upperBound)}`);
  }
  if (config.userId) {
    conditions.push(`${quoteIdentifier(config.userIdColumn)} = ${quoteValue(config.userId)}`);
  }
  if (config.appVersion) {
    conditions.push(`${quoteIdentifier("#app_version")} = ${quoteValue(config.appVersion)}`);
  }

  return [`SELECT * FROM ${config.eventTable}`, conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""]
    .filter(Boolean)
    .join(" ");
}

function parseResultRow(row: unknown): unknown {
  if (typeof row !== "string") return row;
  const trimmed = row.trim();
  if (!trimmed) return [];
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed.split("\t");
  }
}

export function normalizeShushuPageRows(headers: string[], rawRows: unknown[]): RawRow[] {
  return rawRows.map((rawRow) => {
    const row = parseResultRow(rawRow);
    if (row && typeof row === "object" && !Array.isArray(row)) {
      return row as RawRow;
    }
    const values = Array.isArray(row) ? row : [row];
    return headers.reduce<RawRow>((normalized, header, index) => {
      normalized[header] = values[index] as RawRow[string];
      return normalized;
    }, {});
  });
}

function headersFromPayload(payload: Record<string, unknown>): string[] {
  const columns = payload.columns ?? payload.columnNames ?? payload.header ?? payload.headers;
  if (!Array.isArray(columns) && payload.data && typeof payload.data === "object") {
    return headersFromPayload(payload.data as Record<string, unknown>);
  }
  if (!Array.isArray(columns)) return [];
  return columns.map((column) => {
    if (typeof column === "string") return column;
    if (column && typeof column === "object") {
      const item = column as Record<string, unknown>;
      return String(item.name ?? item.columnName ?? item.key ?? "");
    }
    return String(column);
  }).filter(Boolean);
}

function rowsFromPayload(payload: Record<string, unknown>): unknown[] {
  const data = payload.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const dataObject = data as Record<string, unknown>;
    if (Array.isArray(dataObject.rows)) return dataObject.rows;
    if (Array.isArray(dataObject.result)) return dataObject.result;
    if (Array.isArray(dataObject.list)) return dataObject.list;
  }
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.result)) return payload.result;
  return [];
}

function objectFromPayload(payload: Record<string, unknown>): Record<string, unknown> {
  if (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
    return payload.data as Record<string, unknown>;
  }
  return payload;
}

export function extractShushuTaskId(payload: Record<string, unknown>): string {
  const data = objectFromPayload(payload);
  return String(
    payload.taskId ??
      payload.task_id ??
      data.taskId ??
      data.task_id ??
      data.id ??
      "",
  ).trim();
}

function normalizeProgress(value: unknown): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return 0;
  return raw > 1 ? Math.min(Math.round(raw), 100) : Math.min(Math.round(raw * 100), 100);
}

export function normalizeShushuTaskInfo(payload: Record<string, unknown>): ShushuTaskInfo {
  const data = objectFromPayload(payload);
  const resultStat =
    data.resultStat && typeof data.resultStat === "object"
      ? data.resultStat as Record<string, unknown>
      : data.result_stat && typeof data.result_stat === "object"
        ? data.result_stat as Record<string, unknown>
        : {};
  const columns = headersFromPayload(resultStat).length > 0
    ? headersFromPayload(resultStat)
    : headersFromPayload(data);
  return {
    taskId: extractShushuTaskId(payload),
    status: String(data.status ?? data.taskStatus ?? data.state ?? payload.status ?? ""),
    progress: normalizeProgress(data.progress ?? data.process ?? payload.progress),
    rowCount: Number(resultStat.rowCount ?? resultStat.row_count ?? data.rowCount ?? data.row_count ?? 0) || 0,
    pageCount: Number(resultStat.pageCount ?? resultStat.page_count ?? data.pageCount ?? data.page_count ?? 0) || 0,
    columns,
    errorMessage: String(data.errorMessage ?? data.error_message ?? data.message ?? payload.message ?? ""),
  };
}

export function normalizeShushuPayload(payload: Record<string, unknown>, fallbackHeaders: string[] = []): {
  columns: string[];
  rows: RawRow[];
  hasMore: boolean;
} {
  const columns = headersFromPayload(payload);
  const headers = columns.length > 0 ? columns : fallbackHeaders;
  const rows = normalizeShushuPageRows(headers, rowsFromPayload(payload));
  const hasMore = Boolean(payload.hasMore ?? (payload.data as Record<string, unknown> | undefined)?.hasMore);
  return {
    columns: headers.length > 0 ? headers : [...new Set(rows.flatMap((row) => Object.keys(row)))],
    rows,
    hasMore,
  };
}

export function parseShushuResultPageText(fallbackHeaders: string[], text: string): RawRow[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  let headers = fallbackHeaders;
  const dataLines: unknown[] = [];
  for (const line of lines) {
    const parsed = parseResultRow(line);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const payload = parsed as Record<string, unknown>;
      const looksLikeEnvelope = [
        "return_code",
        "return_message",
        "code",
        "message",
        "msg",
        "data",
        "headers",
        "columns",
      ].some((key) => Object.prototype.hasOwnProperty.call(payload, key));
      if (looksLikeEnvelope) {
        const payloadHeaders = headersFromPayload(payload);
        if (payloadHeaders.length > 0) headers = payloadHeaders;
        const payloadRows = rowsFromPayload(payload);
        if (payloadRows.length > 0) dataLines.push(...payloadRows);
        continue;
      }
      dataLines.push(payload);
      continue;
    }
    dataLines.push(parsed);
  }

  return normalizeShushuPageRows(headers, dataLines);
}

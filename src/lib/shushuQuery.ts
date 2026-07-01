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
  useEventNameFilter: boolean;
  eventNameColumn: string;
  eventNames: string;
  pageSize: number;
  maxRows: number;
  sqlideWebSocketUrl: string;
}

export type ShushuQueryInput = Partial<ShushuQueryConfig> & {
  projectId?: string;
};

export interface ShushuQueryResponse {
  rows: RawRow[];
  columns: string[];
  sql: string;
  rowCount: number;
  requestedRows?: number;
  loadedRows?: number;
  queryChannel?: "sqlide-websocket" | "openapi";
  fallbackReason?: string;
  stopReason?: string;
}

export type ShushuQueueTaskStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface ShushuQueueTaskInfo {
  id: string;
  status: ShushuQueueTaskStatus;
  position: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  projectId: string;
  summary: string;
  queryChannel?: "sqlide-websocket" | "openapi";
  error?: string;
  result?: ShushuQueryResponse;
}

export interface ShushuQueryStartResponse {
  taskId: string;
  sql: string;
}

export interface ShushuExecuteSqlMetadata {
  taskId: string;
  rowCount: number;
  pageCount: number;
  columns: string[];
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

export type ShushuSqlideMessage = [
  "data",
  {
    requestId: string;
    projectId: number | string;
    qp: string;
    eventModel: 10;
    querySource: "module";
    searchSource: "model_search";
    isVisualInitialQuery: true;
    useCache: true;
    contentTranslate: "";
  },
  { channel: "ta" },
];

export interface ShushuSqlideNormalizedMessage {
  requestId: string;
  progress: number;
  status: string;
  done: boolean;
  columns: string[];
  rows: RawRow[];
  rowCount: number;
  errorMessage: string;
}

export const SHUSHU_QUERY_TIMEOUT_MS = 30 * 60 * 1000;
export const SHUSHU_SQLIDE_WEBSOCKET_TIMEOUT_MS = 5 * 60 * 1000;
export const SHUSHU_SQLIDE_WEBSOCKET_BATCH_LIMIT = 1000;

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

const numericUserIdColumns = new Set(["#user_id"]);

function quoteUserValue(column: string, value: string): string {
  return numericUserIdColumns.has(column) && /^(0|[1-9]\d*)$/.test(value) ? value : quoteValue(value);
}

function parseEventNames(value: string): string[] {
  return [...new Set(
    value
      .split(/[\s,，、;；]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

export function parseShushuEventNames(value: string): string[] {
  return parseEventNames(value);
}

const eventContextDependencies = new Map<string, string[]>([
  ["item_get", ["item_use", "common_ad_event"]],
  ["item_use", ["item_get"]],
]);

export function expandEventNamesForTestContext(value: string): string[] {
  const eventNames = parseEventNames(value);
  const expanded = new Set(eventNames);
  eventNames.forEach((eventName) => {
    eventContextDependencies.get(eventName)?.forEach((dependency) => expanded.add(dependency));
  });
  return [...expanded];
}

function plusOneDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function defaultEventTable(projectId: string): string {
  return `v_event_${projectId.trim()}`;
}

function normalizePositiveInteger(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

export function formatShushuQueryCountdown(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatShushuQueryProgress(params: {
  progress: number;
  status: string;
  elapsedMs: number;
  remainingMs: number;
}): string {
  const parts = [
    `数数计算中：${params.progress || 0}%`,
    `状态：${params.status || "-"}`,
    `已等待 ${formatShushuQueryCountdown(params.elapsedMs)}`,
    `剩余 ${formatShushuQueryCountdown(params.remainingMs)}`,
  ];
  if ((params.progress || 0) === 0 && params.elapsedMs >= 60 * 1000) {
    parts.push("数数仍未返回进度，建议缩小日期、用户或事件范围");
  }
  return parts.join(" ｜ ");
}

function formatRowsCount(value: number): string {
  return Math.max(0, Math.floor(value)).toLocaleString("en-US");
}

export function formatShushuRowsProgress(params: {
  loadedRows: number;
  rowCount: number;
  requestedRows: number;
  stopReason?: string;
}): string {
  const loadedRows = Math.max(0, Math.floor(params.loadedRows));
  const rowCount = Math.max(0, Math.floor(params.rowCount));
  const requestedRows = Math.max(0, Math.floor(params.requestedRows));
  const shouldUseRequestedTarget =
    Boolean(params.stopReason) ||
    (requestedRows > rowCount && loadedRows >= 2000 && rowCount <= loadedRows);
  const targetRows = shouldUseRequestedTarget ? requestedRows : Math.min(requestedRows || rowCount || loadedRows, rowCount || requestedRows || loadedRows);
  return `已读取 ${formatRowsCount(loadedRows)} / ${formatRowsCount(targetRows || loadedRows)} 行`;
}

export function shushuResultPageIdsToRead(params: {
  pageCount: number;
  pageSize: number;
  maxRows: number;
}): number[] {
  const pageSize = Math.max(1, Math.floor(params.pageSize));
  const maxRows = Math.max(0, Math.floor(params.maxRows));
  const pageCount = Math.max(0, Math.floor(params.pageCount));
  const pagesNeededByRows = maxRows > 0 ? Math.ceil(maxRows / pageSize) : pageCount;
  const pagesToRead = pageCount > 0 ? Math.min(pageCount, pagesNeededByRows || pageCount) : pagesNeededByRows;
  return Array.from({ length: pagesToRead }, (_, index) => index);
}

export function validateShushuQueryScope(config: Pick<
  ShushuQueryConfig,
  "startDate" | "endDate" | "userId" | "appVersion" | "useEventNameFilter" | "eventNames"
>): string | null {
  if (!config.startDate || !config.endDate) {
    return "请先填写开始日期和结束日期，避免误触发全表查询。";
  }

  const hasEventNames = config.useEventNameFilter && parseEventNames(config.eventNames).length > 0;
  if (!config.userId.trim() && !config.appVersion.trim() && !hasEventNames) {
    return "请至少填写用户 ID、事件名筛选或 app_version 之一，避免误触发全服查询。";
  }

  return null;
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
  const eventNameColumn = requireSafeIdentifier(input.eventNameColumn?.trim() || "#event_name", "事件名字段");

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
    useEventNameFilter: Boolean(input.useEventNameFilter),
    eventNameColumn,
    eventNames: expandEventNamesForTestContext(String(input.eventNames ?? "")).join("\n"),
    pageSize: normalizePositiveInteger(input.pageSize, 1000, 10000),
    maxRows: normalizePositiveInteger(input.maxRows, 0, 5000),
    sqlideWebSocketUrl: String(input.sqlideWebSocketUrl ?? "").trim(),
  };
}

export function buildShushuSql(config: ShushuQueryConfig): string {
  return buildShushuSqlPage(config, config.maxRows > 0 ? config.maxRows : 0, 0);
}

export function buildShushuEventNamesSql(config: ShushuQueryConfig): string {
  return buildShushuSelectSql({
    config: {
      ...config,
      useEventNameFilter: false,
      eventNames: "",
    },
    selectExpression: `DISTINCT ${quoteIdentifier(config.eventNameColumn)} AS ${quoteIdentifier(config.eventNameColumn)}`,
    limit: 1000,
    offset: 0,
    orderBy: quoteIdentifier(config.eventNameColumn),
  });
}

export function buildShushuSqlideQuerySql(config: ShushuQueryConfig): string {
  return buildShushuSqlPage(config, SHUSHU_SQLIDE_WEBSOCKET_BATCH_LIMIT, 0);
}

export function buildShushuSqlideQuerySqls(config: ShushuQueryConfig): string[] {
  const maxRows = config.maxRows > 0 ? config.maxRows : config.pageSize;
  if (maxRows <= SHUSHU_SQLIDE_WEBSOCKET_BATCH_LIMIT) return [buildShushuSqlideQuerySql(config)];
  if (!config.useEventNameFilter) return [buildShushuSqlideQuerySql(config)];

  const eventNames = parseEventNames(config.eventNames);
  if (eventNames.length <= 1) return [buildShushuSqlideQuerySql(config)];

  const shardLimit = Math.min(SHUSHU_SQLIDE_WEBSOCKET_BATCH_LIMIT, Math.max(1, Math.ceil(maxRows / eventNames.length)));
  return eventNames.map((eventName) =>
    buildShushuSqlPage({
      ...config,
      eventNames: eventName,
    }, shardLimit, 0),
  );
}

export function buildShushuSqlPage(config: ShushuQueryConfig, limit: number, offset: number): string {
  return buildShushuSelectSql({
    config,
    limit,
    offset,
  });
}

export function buildShushuSqlideCursorSql(params: {
  config: ShushuQueryConfig;
  eventName?: string;
  afterEventTime?: string;
  limit?: number;
}): string {
  return buildShushuSelectSql({
    config: params.eventName
      ? {
        ...params.config,
        useEventNameFilter: true,
        eventNames: params.eventName,
      }
      : params.config,
    limit: Math.min(SHUSHU_SQLIDE_WEBSOCKET_BATCH_LIMIT, Math.max(1, Math.floor(params.limit ?? SHUSHU_SQLIDE_WEBSOCKET_BATCH_LIMIT))),
    offset: 0,
    afterEventTime: params.afterEventTime,
  });
}

export function buildShushuSqlideBatchSql(params: {
  config: ShushuQueryConfig;
  eventName?: string;
  offset: number;
  limit?: number;
}): string {
  return buildShushuSqlPage(
    params.eventName
      ? {
        ...params.config,
        useEventNameFilter: true,
        eventNames: params.eventName,
      }
      : params.config,
    Math.min(SHUSHU_SQLIDE_WEBSOCKET_BATCH_LIMIT, Math.max(1, Math.floor(params.limit ?? SHUSHU_SQLIDE_WEBSOCKET_BATCH_LIMIT))),
    Math.max(0, Math.floor(params.offset)),
  );
}

function buildShushuSelectSql(params: {
  config: ShushuQueryConfig;
  limit: number;
  offset: number;
  afterEventTime?: string;
  selectExpression?: string;
  orderBy?: string;
}): string {
  const { config, limit, offset } = params;
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
    conditions.push(`${quoteIdentifier(config.userIdColumn)} = ${quoteUserValue(config.userIdColumn, config.userId)}`);
  }
  if (config.appVersion) {
    conditions.push(`${quoteIdentifier("#app_version")} = ${quoteValue(config.appVersion)}`);
  }
  if (config.useEventNameFilter) {
    const eventNames = parseEventNames(config.eventNames);
    if (eventNames.length === 1) {
      conditions.push(`${quoteIdentifier(config.eventNameColumn)} = ${quoteValue(eventNames[0])}`);
    } else if (eventNames.length > 1) {
      conditions.push(`${quoteIdentifier(config.eventNameColumn)} IN (${eventNames.map(quoteValue).join(", ")})`);
    }
  }
  if (params.afterEventTime) {
    conditions.push(`${quoteIdentifier("#event_time")} > ${quoteValue(params.afterEventTime)}`);
  }

  return [
    `SELECT ${params.selectExpression ?? "*"} FROM ${config.eventTable}`,
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    `ORDER BY ${params.orderBy ?? quoteIdentifier("#event_time")} ASC`,
    offset > 0 ? `OFFSET ${Math.max(0, Math.floor(offset))}` : "",
    limit > 0 ? `LIMIT ${Math.max(1, Math.floor(limit))}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildShushuSqlideMessage(params: {
  requestId: string;
  projectId: string | number;
  sql: string;
}): ShushuSqlideMessage {
  const qp = JSON.stringify({
    events: { sql: params.sql, sqlVoParams: [] },
    eventView: { sqlViewParams: [] },
    visualView: {
      groupBys: [],
      aggregates: [],
      filters: [],
      aggregateFilters: [],
      orderBys: [],
    },
  });

  return [
    "data",
    {
      requestId: params.requestId,
      projectId: Number(params.projectId) || params.projectId,
      qp,
      eventModel: 10,
      querySource: "module",
      searchSource: "model_search",
      isVisualInitialQuery: true,
      useCache: true,
      contentTranslate: "",
    },
    { channel: "ta" },
  ];
}

export function normalizeShushuSqlideWebSocketUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("请填写数数 WebSocket 查询地址。");
  if (!/^wss?:\/\//i.test(trimmed)) {
    throw new Error("WebSocket 地址必须以 ws:// 或 wss:// 开头。");
  }
  if (!/\/ta-websocket\/query\//i.test(trimmed)) {
    throw new Error("WebSocket 地址格式异常，需要包含 /ta-websocket/query/。");
  }
  return trimmed;
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
    if (Array.isArray(dataObject.values)) return dataObject.values;
    if (Array.isArray(dataObject.result)) return dataObject.result;
    if (Array.isArray(dataObject.list)) return dataObject.list;
  }
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.values)) return payload.values;
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

export function normalizeShushuExecuteSqlMetadata(payload: Record<string, unknown>): ShushuExecuteSqlMetadata {
  const data = objectFromPayload(payload);
  return {
    taskId: extractShushuTaskId(payload),
    rowCount: Number(data.rowCount ?? data.row_count ?? payload.rowCount ?? payload.row_count ?? 0) || 0,
    pageCount: Number(data.pageCount ?? data.page_count ?? payload.pageCount ?? payload.page_count ?? 0) || 0,
    columns: headersFromPayload(data).length > 0 ? headersFromPayload(data) : headersFromPayload(payload),
  };
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

export function normalizeShushuSqlideMessage(message: unknown): ShushuSqlideNormalizedMessage | null {
  if (!Array.isArray(message) || message[0] !== "data" || !message[1] || typeof message[1] !== "object") {
    return null;
  }

  const body = message[1] as Record<string, unknown>;
  const requestId = String(body.requestId ?? "");
  const progress = normalizeProgress(body.progress);
  const status = String(body.status ?? "");
  const result = body.result && typeof body.result === "object" ? body.result as Record<string, unknown> : {};
  const returnCode = result.return_code ?? result.code;
  const returnMessage = String(result.return_message ?? result.message ?? body.errorMessage ?? "");
  if (!isShushuSuccessCode(returnCode)) {
    throw new Error(friendlyShushuErrorMessage(returnMessage, returnCode as string | number | undefined));
  }

  const data = result.data && typeof result.data === "object" ? result.data as Record<string, unknown> : result;
  const dataReturnCode = data.return_code ?? data.code;
  if (!isShushuSuccessCode(dataReturnCode)) {
    throw new Error(friendlyShushuErrorMessage(String(data.return_message ?? data.message ?? returnMessage), dataReturnCode as string | number | undefined));
  }

  const columns = headersFromPayload(data);
  const rows = normalizeShushuPageRows(columns, rowsFromPayload(data));
  const done = progress >= 100 || status === "success" || rows.length > 0 || Object.keys(result).length > 0;
  return {
    requestId,
    progress,
    status,
    done,
    columns: columns.length > 0 ? columns : [...new Set(rows.flatMap((row) => Object.keys(row)))],
    rows,
    rowCount: Number(data.lineNumber ?? data.rowCount ?? data.row_count ?? rows.length) || rows.length,
    errorMessage: returnMessage === "success" ? "" : returnMessage,
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

const shushuReturnCodeMessages: Record<string, string> = {
  "0": "执行成功",
  "-1": "执行失败，请检查数数返回信息或稍后重试。",
  "-1001": "未登录，请检查 OpenAPI token 是否有效。",
  "-10012": "登录失败，请检查登录名或认证配置。",
  "-1002": "账号已被锁定，请联系管理员处理。",
  "-1003": "用户名或密码错误，请确认账号后重试。",
  "-1004": "系统异常，请稍后重试或联系数数管理员。",
  "-1005": "请求频率过快，请稍后再试。",
  "-1006": "您无权限操作，请检查 token 是否有该项目或接口权限。",
  "-1008": "参数错误，请检查项目、事件表、日期字段和筛选条件。",
  "-1009": "用户名不存在，请检查登录名。",
  "-1010": "非法操作，请检查接口权限和参数。",
  "-1011": "数据尚未准备好，请稍后再试。",
  "-1012": "当前查询无数据，请检查日期、用户 ID、app_version 或事件表。",
  "-1013": "数据正在准备，请稍后重试。",
  "-1014": "无效访问，请检查 API 地址和 token。",
  "-1022": "请求已取消，请重新发起查询。",
  "-1023": "目标对象不存在，请检查项目或任务 ID。",
  "-1999": "无效用户，请检查登录名或项目成员权限。",
  "-3000": "许可证认证失败，请联系数数管理员。",
  "-3004": "无效项目，请检查项目 ID。",
};

function isShushuSuccessCode(code: unknown): boolean {
  return code === undefined || code === null || code === 0 || code === "0" || code === "success";
}

export function friendlyShushuErrorMessage(message: string, returnCode?: string | number): string {
  const raw = String(message || "").trim();
  const codeText = returnCode === undefined || returnCode === null ? "" : String(returnCode);
  const mapped = codeText ? shushuReturnCodeMessages[codeText] : "";
  if (/Cannot apply operator/i.test(raw) && /(?:bigint\s*=\s*varchar|varchar\s*=\s*bigint)/i.test(raw)) {
    return "字段类型不匹配：用户 ID 字段类型和输入值类型不一致。#account_id 会按文本查询，#user_id 会按数字查询，请重新查询。";
  }
  if (/Method Not Allowed/i.test(raw) || /status[\"']?\s*:\s*405/.test(raw)) {
    return "接口方法不匹配：当前数数环境不接受该请求方法，请刷新页面后重试。";
  }
  if (/Gateway Time-?out|504/i.test(raw)) {
    return "数数 SQL 查询超时：当前查询数据量太大或执行太久。建议缩小日期范围、指定用户 ID 或降低读取行数。";
  }
  if (codeText === "-1004" && /TimeoutException|Waited \d+ seconds/i.test(raw)) {
    return "数数 OpenAPI 查询超时：同样条件在网页端可能更快，但 OpenAPI 通道没有及时返回。建议先用实际 SQL 导出 CSV/Excel，或联系数数管理员确认 OpenAPI 查询性能。";
  }
  if (mapped && raw && raw !== mapped) return `${mapped} 原始信息：${raw}`;
  return mapped || raw || "数数接口返回失败。";
}

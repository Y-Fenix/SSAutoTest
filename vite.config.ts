import react from "@vitejs/plugin-react";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import vm from "node:vm";
import Papa from "papaparse";
import { defineConfig, type Plugin } from "vite";
import {
  createActualEventAccumulator,
  expectedPropertyNames,
  serializeActualEventScanResult,
} from "./src/lib/actualDataParser";
import { extractSheets, extractValues, rowsFromValues, toSheetTabs } from "./src/lib/larkSheetServerUtils";
import {
  buildShushuSqlideMessage,
  buildShushuEventNamesSql,
  buildShushuSql,
  buildShushuSqlideBatchSql,
  buildShushuSqlideQuerySqls,
  extractShushuTaskId,
  friendlyShushuErrorMessage,
  normalizeShushuPayload,
  normalizeShushuQueryConfig,
  normalizeShushuExecuteSqlMetadata,
  shushuResultPageIdsToRead,
  normalizeShushuSqlideMessage,
  normalizeShushuSqlideWebSocketUrl,
  normalizeShushuTaskInfo,
  parseShushuResultPageText,
  SHUSHU_SQLIDE_WEBSOCKET_BATCH_LIMIT,
  SHUSHU_SQLIDE_WEBSOCKET_TIMEOUT_MS,
  type ShushuQueueTaskInfo,
  type ShushuQueueTaskStatus,
  type ShushuProjectOption,
  type ShushuQueryResponse,
} from "./src/lib/shushuQuery";
import type { ExpectedEvent, RawRow, SerializableActualEventScanResult } from "./src/lib/types";

const execFileAsync = promisify(execFile);
let larkCliPathCache: string | null = null;
const shushuLocalConfigPath = path.resolve(process.cwd(), "config/shushu.local.json");
const shushuBrowserProfilePath = path.join(homedir(), ".ssautotest-lan", "shushu-browser-profile");
const localChromiumCandidates = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];
const defaultShushuSqlideWebSocketUrl = "wss://example.invalid/v1/ta-websocket/query/replace-with-your-websocket-id";
const sqlideWebSocketFallbackMs = SHUSHU_SQLIDE_WEBSOCKET_TIMEOUT_MS;
const actualUploadReadyTimeoutMs = 10 * 60 * 1000;
const eventTestCaseFilePath = path.resolve(process.cwd(), "public/event-test-cases.js");
const eventTestRowColumns = new Set([
  "#event_name",
  "event_name",
  "事件名",
  "event",
  "#event_time",
  "event_time",
  "事件时间",
  "#account_id",
  "account_id",
  "#user_id",
  "user_id",
  "is_gm",
  "#is_gm",
  "item_info",
  "item_type",
  "item_source",
  "item_count_now",
  "type",
  "action",
  "scene",
  "scence",
  "reward_scene",
  "level_type",
  "level_mode_id",
]);
const actualScanJobs = new Map<string, ActualFileScanJob>();
let activeActualScanJobId = "";
const shushuQueryQueue = new Map<string, ShushuQueueTask>();
let activeShushuQueueTaskId = "";

type ActualFileScanJob = {
  id: string;
  status: "queued" | "waiting_upload" | "running" | "done" | "error" | "cancelled";
  mode: "path" | "upload";
  filePath?: string;
  fileName?: string;
  progress: {
    percent: number;
    scannedRows: number;
    matchedEvents: number;
    fileSize: number;
    bytesRead: number;
    position: number;
  };
  result?: SerializableActualEventScanResult;
  error?: string;
  expectedEvents?: ExpectedEvent[];
  startedAt: number;
  requestedAt?: number;
  completedAt?: number;
};

type ShushuQueueTask = {
  id: string;
  status: ShushuQueueTaskStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  params: Record<string, unknown>;
  projectId: string;
  summary: string;
  abortController: AbortController;
  result?: ShushuQueryResponse;
  error?: string;
  queryChannel?: "sqlide-websocket" | "openapi";
};

type ShushuLocalConfig = {
  apiBaseUrl: string;
  token: string;
  loginName: string;
  sqlideWebSocketUrl: string;
};

async function readShushuLocalConfig(): Promise<ShushuLocalConfig> {
  try {
    const raw = await readFile(shushuLocalConfigPath, "utf8");
    const config = JSON.parse(raw) as {
      apiBaseUrl?: string;
      token?: string;
      loginName?: string;
      sqlideWebSocketUrl?: string;
      webSocketUrl?: string;
    };
    return {
      apiBaseUrl: String(config.apiBaseUrl ?? "").trim(),
      token: String(config.token ?? "").trim(),
      loginName: String(config.loginName ?? "").trim(),
      sqlideWebSocketUrl: String(config.sqlideWebSocketUrl ?? config.webSocketUrl ?? defaultShushuSqlideWebSocketUrl).trim(),
    };
  } catch {
    return { apiBaseUrl: "", token: "", loginName: "", sqlideWebSocketUrl: defaultShushuSqlideWebSocketUrl };
  }
}

async function writeShushuLocalConfig(updates: Partial<ShushuLocalConfig>) {
  const current = await readShushuLocalConfig();
  const next: ShushuLocalConfig = {
    ...current,
    ...updates,
    sqlideWebSocketUrl: normalizeShushuSqlideWebSocketUrl(updates.sqlideWebSocketUrl ?? current.sqlideWebSocketUrl),
  };
  await mkdir(path.dirname(shushuLocalConfigPath), { recursive: true });
  await writeFile(`${shushuLocalConfigPath}.tmp`, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await writeFile(shushuLocalConfigPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

async function withShushuLocalConfig(params: Record<string, unknown>) {
  const localConfig = await readShushuLocalConfig();
  return {
    ...params,
    apiBaseUrl: String(params.apiBaseUrl ?? "").trim() || localConfig.apiBaseUrl,
    token: String(params.token ?? "").trim() || localConfig.token,
    loginName: String(params.loginName ?? "").trim() || localConfig.loginName,
    sqlideWebSocketUrl: String(params.sqlideWebSocketUrl ?? "").trim() || localConfig.sqlideWebSocketUrl,
  };
}

async function canAccess(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveLarkCliPath(): Promise<string> {
  if (larkCliPathCache) return larkCliPathCache;

  const pathDirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const candidates = [
    process.env.LARK_CLI_PATH,
    ...pathDirs.map((dir) => path.join(dir, "lark-cli")),
    path.join(homedir(), ".local/bin/lark-cli"),
    path.join(homedir(), ".npm-global/bin/lark-cli"),
    "/opt/homebrew/bin/lark-cli",
    "/usr/local/bin/lark-cli",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (await canAccess(candidate)) {
      larkCliPathCache = candidate;
      return candidate;
    }
  }

  throw new Error("未检测到 lark-cli。请先安装并登录飞书 CLI，或把 lark-cli 加入 PATH 后重启局域网常驻服务。");
}

async function execLarkCli(args: string[], options: { maxBuffer: number }) {
  const larkCliPath = await resolveLarkCliPath();
  return execFileAsync(larkCliPath, args, {
    ...options,
    env: {
      ...process.env,
      PATH: [
        path.join(homedir(), ".local/bin"),
        path.join(homedir(), ".npm-global/bin"),
        "/opt/homebrew/bin",
        "/usr/local/bin",
        process.env.PATH ?? "",
      ].join(path.delimiter),
    },
  });
}

async function refreshShushuSqlideWebSocket(params: Record<string, unknown>) {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error("未安装浏览器自动化依赖。请在工具目录执行 npm install 后重启服务。");
  }

  const projectId = String(params.projectId ?? "").trim() || "33";
  const targetUrl = String(params.url ?? "").trim() || `https://shu.deltafun.pro/#/data/eventm?currentProjectId=${projectId}`;
  const signal = params.signal instanceof AbortSignal ? params.signal : undefined;
  if (signal?.aborted) throw new Error("WebSocket 刷新已终止。");
  await mkdir(shushuBrowserProfilePath, { recursive: true });
  const executablePath = (await Promise.all(localChromiumCandidates.map(async (candidate) => (
    await canAccess(candidate) ? candidate : ""
  )))).find(Boolean);

  const context = await chromium.launchPersistentContext(shushuBrowserProfilePath, {
    headless: false,
    ...(executablePath ? { executablePath } : {}),
    viewport: { width: 1440, height: 960 },
  });

  try {
    const abortListener = () => {
      void context.close().catch(() => undefined);
    };
    signal?.addEventListener("abort", abortListener, { once: true });
    const page = context.pages()[0] ?? await context.newPage();
    let capturedUrl = "";
    const waitForWebSocket = new Promise<string>((resolve) => {
      const handler = (webSocket: { url(): string }) => {
        const url = webSocket.url();
        if (url.includes("/ta-websocket/query/")) {
          capturedUrl = url;
          resolve(url);
        }
      };
      page.on("websocket", handler);
      context.on("page", (newPage) => {
        newPage.on("websocket", handler);
      });
    });

    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    const websocketUrl = capturedUrl || await Promise.race([
      waitForWebSocket,
      new Promise<string>((_, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("WebSocket 刷新已终止。")), { once: true });
      }),
      new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error("90 秒内没有捕获到数数 WebSocket。请在弹出的数数浏览器里确认已登录，并手动进入 SQL/事件查询页点击一次查询后重试。")), 90000);
      }),
    ]);
    signal?.removeEventListener("abort", abortListener);
    const saved = await writeShushuLocalConfig({ sqlideWebSocketUrl: websocketUrl });
    return { sqlideWebSocketUrl: saved.sqlideWebSocketUrl };
  } finally {
    await context.close();
  }
}

function friendlyLarkError(error: unknown): string {
  const raw =
    error instanceof Error
      ? `${error.message}${"stderr" in error ? ` ${(error as { stderr?: string }).stderr ?? ""}` : ""}`
      : String(error);
  if (raw.includes("wiki:node:read")) {
    return '飞书 wiki 链接需要授权 wiki 读取权限，请在终端运行：lark-cli auth login --scope "wiki:node:read"';
  }
  if (raw.includes("sheets:spreadsheet:read")) {
    return '飞书表格需要授权电子表格读取权限，请在终端运行：lark-cli auth login --scope "sheets:spreadsheet:read"';
  }
  if (raw.includes("need_user_authorization") || raw.includes("missing_scope")) {
    return `飞书 CLI 授权不足，请按 lark-cli 提示补充 scope 后重试。原始错误：${raw}`;
  }
  if (raw.includes("未检测到 lark-cli") || raw.includes("ENOENT")) {
    return "未检测到 lark-cli。请先安装并登录飞书 CLI；如果已经安装，请重启局域网常驻服务。";
  }
  return raw;
}

function wikiTokenFromUrl(url: string): string | null {
  return url.match(/\/wiki\/([^/?#]+)/)?.[1] ?? null;
}

async function resolveSheetUrlOrToken(url: string): Promise<{ url?: string; spreadsheetToken?: string }> {
  const wikiToken = wikiTokenFromUrl(url);
  if (!wikiToken) return { url };

  const node = await execLarkCli(
    ["wiki", "spaces", "get_node", "--params", JSON.stringify({ token: wikiToken }), "--as", "user"],
    { maxBuffer: 1024 * 1024 * 8 },
  );
  const payload = JSON.parse(node.stdout) as {
    node?: { obj_type?: string; obj_token?: string };
    data?: { node?: { obj_type?: string; obj_token?: string } };
  };
  const resolvedNode = payload.node ?? payload.data?.node;
  if (resolvedNode?.obj_type !== "sheet" || !resolvedNode.obj_token) {
    throw new Error("该 wiki 链接不是飞书电子表格。");
  }
  return { spreadsheetToken: resolvedNode.obj_token };
}

function registerLarkSheetApi(middlewares: {
  use: (route: string, handler: (req: any, res: any) => void) => void;
}) {
  middlewares.use("/api/lark-sheet", async (req, res) => {
    try {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const { action = "read", url, sheetIds } = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        action?: "list" | "read";
        url?: string;
        sheetIds?: string[];
      };
      if (!url?.trim()) throw new Error("请填写飞书表格链接。");

      const target = await resolveSheetUrlOrToken(url.trim());
      const targetArgs = target.spreadsheetToken
        ? ["--spreadsheet-token", target.spreadsheetToken]
        : ["--url", target.url ?? url.trim()];
      const info = await execLarkCli(["sheets", "+info", ...targetArgs, "--as", "user"], {
        maxBuffer: 1024 * 1024 * 8,
      });
      const infoJson = JSON.parse(info.stdout);
      const tabs = toSheetTabs(extractSheets(infoJson));
      if (tabs.length === 0) throw new Error("未读取到飞书表格页签。");

      if (action === "list") {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ tabs }));
        return;
      }

      const selectedSheetIds = Array.isArray(sheetIds) && sheetIds.length > 0 ? sheetIds : tabs.slice(0, 2).map((tab) => tab.id);
      const selectedTabs = tabs.filter((tab) => selectedSheetIds.includes(tab.id));
      if (selectedTabs.length === 0) throw new Error("请至少选择一个有效页签。");

      const rows: Record<string, string | number | boolean | null | undefined>[] = [];
      for (const sheet of selectedTabs) {
        const read = await execLarkCli(
          [
            "sheets",
            "+read",
            ...targetArgs,
            "--sheet-id",
            sheet.id,
            "--range",
            "A1:Z1000",
            "--value-render-option",
            "ToString",
            "--as",
            "user",
          ],
          { maxBuffer: 1024 * 1024 * 16 },
        );
        rows.push(...rowsFromValues(extractValues(JSON.parse(read.stdout))));
      }

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ rows, sheetCount: selectedTabs.length }));
    } catch (error) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: friendlyLarkError(error) }));
    }
  });
}

async function readJsonBody<T>(req: AsyncIterable<Buffer>): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function jsonResponse(res: any, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function friendlyShushuHttpError(status: number, text: string) {
  if (status === 504 || status === 405) return friendlyShushuErrorMessage(text);
  return text.includes("<html")
    ? `数数接口请求失败(${status})：接口返回了 HTML 页面，请检查 API 地址和接口网关。`
    : `数数接口请求失败(${status})：${friendlyShushuErrorMessage(text.slice(0, 500))}`;
}

function normalizeServerCsvRow(row: RawRow): RawRow {
  const normalized: RawRow = {};
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = String(key).replace(/^\uFEFF/, "").trim();
    const normalizedValue = typeof value === "string" ? value.trim() : value;
    if (!normalizedKey) continue;
    if (normalizedValue === "" || normalizedValue === undefined || normalizedValue === null) continue;
    normalized[normalizedKey] = normalizedValue;
  }
  return normalized;
}

function isIgnorableCsvError(error: Papa.ParseError): boolean {
  return error.code === "UndetectableDelimiter";
}

function compactEventTestRow(row: RawRow): RawRow {
  const compact: RawRow = {};
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = key.trim();
    if (!eventTestRowColumns.has(normalizedKey)) continue;
    compact[normalizedKey] = value;
  }
  return compact;
}

async function runServerEventTestCases(rows: RawRow[]): Promise<SerializableActualEventScanResult["eventTestReport"]> {
  if (rows.length === 0) return undefined;
  const code = await readFile(eventTestCaseFilePath, "utf8");
  const context = vm.createContext({});
  vm.runInContext(code, context, { filename: eventTestCaseFilePath });
  const runner = (context as {
    SSAutoTestEventTestCases?: {
      runEventTestCases?: (rows: RawRow[]) => SerializableActualEventScanResult["eventTestReport"];
    };
  }).SSAutoTestEventTestCases;
  if (typeof runner?.runEventTestCases !== "function") {
    throw new Error("测试用例文件没有暴露 runEventTestCases(rows)。");
  }
  return runner.runEventTestCases(rows);
}

function buildActualScanJobId() {
  return `actual_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildShushuQueueTaskId() {
  return `shushu_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function cleanupActualScanJobs() {
  const now = Date.now();
  const activeJob = activeActualScanJobId ? actualScanJobs.get(activeActualScanJobId) : undefined;
  if (
    activeJob?.status === "waiting_upload" &&
    now - (activeJob.requestedAt ?? activeJob.startedAt) > actualUploadReadyTimeoutMs
  ) {
    activeJob.status = "error";
    activeJob.error = "等待上传超时，请重新选择文件加入队列。";
    activeJob.completedAt = now;
    activeActualScanJobId = "";
  }
  for (const [jobId, job] of actualScanJobs) {
    if (
      job.status !== "queued" &&
      job.status !== "waiting_upload" &&
      job.status !== "running" &&
      now - (job.completedAt ?? job.startedAt) > 30 * 60 * 1000
    ) {
      actualScanJobs.delete(jobId);
    }
  }
}

function queuedActualScanJobs() {
  return [...actualScanJobs.values()].sort((left, right) => left.startedAt - right.startedAt);
}

function actualScanQueuedPosition(job: ActualFileScanJob) {
  if (job.status !== "queued") return 0;
  const queuedIds = queuedActualScanJobs()
    .filter((item) => item.status === "queued")
    .map((item) => item.id);
  return queuedIds.indexOf(job.id) + 1;
}

function serializeActualScanJob(job: ActualFileScanJob, options: { includeResult?: boolean } = {}) {
  return {
    scanId: job.id,
    status: job.status,
    progress: {
      ...job.progress,
      position: actualScanQueuedPosition(job),
    },
    result: options.includeResult ? job.result : undefined,
    error: job.error,
    summary: job.fileName ?? job.filePath ?? "",
  };
}

function processNextActualScanJob() {
  if (activeActualScanJobId) return;
  const nextJob = queuedActualScanJobs().find((job) => job.status === "queued");
  if (!nextJob) return;

  activeActualScanJobId = nextJob.id;
  nextJob.requestedAt = Date.now();
  if (nextJob.mode === "upload") {
    nextJob.status = "waiting_upload";
    return;
  }

  nextJob.status = "running";
  void runActualFileScan(nextJob, {
    filePath: nextJob.filePath ?? "",
    expectedEvents: nextJob.expectedEvents ?? [],
  }).finally(() => {
    if (activeActualScanJobId === nextJob.id) activeActualScanJobId = "";
    cleanupActualScanJobs();
    processNextActualScanJob();
  });
}

function finishActiveActualScanJob(job: ActualFileScanJob) {
  if (activeActualScanJobId === job.id) activeActualScanJobId = "";
  cleanupActualScanJobs();
  processNextActualScanJob();
}

function cleanupShushuQueueTasks() {
  const now = Date.now();
  for (const [taskId, task] of shushuQueryQueue) {
    if (
      task.status !== "queued" &&
      task.status !== "running" &&
      now - (task.completedAt ?? task.createdAt) > 60 * 60 * 1000
    ) {
      shushuQueryQueue.delete(taskId);
    }
  }
}

function queuedShushuTasks() {
  return [...shushuQueryQueue.values()].sort((left, right) => left.createdAt - right.createdAt);
}

function serializeShushuQueueTask(task: ShushuQueueTask, options: { includeResult?: boolean } = {}): ShushuQueueTaskInfo {
  const queuedIds = queuedShushuTasks()
    .filter((item) => item.status === "queued")
    .map((item) => item.id);
  return {
    id: task.id,
    status: task.status,
    position: task.status === "queued" ? queuedIds.indexOf(task.id) + 1 : 0,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    projectId: task.projectId,
    summary: task.summary,
    queryChannel: task.queryChannel,
    error: task.error,
    result: options.includeResult ? task.result : undefined,
  };
}

function shushuQueueSummary(config: ReturnType<typeof normalizeShushuQueryConfig>) {
  const filters = [
    `${config.startDate || "-"}~${config.endDate || "-"}`,
    config.appVersion ? `app=${config.appVersion}` : "",
    config.userId ? `${config.userIdColumn}=${config.userId}` : "",
    config.useEventNameFilter && config.eventNames ? `事件筛选` : "",
    `最多 ${config.maxRows || config.pageSize} 行`,
  ].filter(Boolean);
  return `项目 ${config.projectId} ｜ ${filters.join(" ｜ ")}`;
}

function processNextShushuQueueTask() {
  if (activeShushuQueueTaskId) return;
  const nextTask = queuedShushuTasks().find((task) => task.status === "queued");
  if (!nextTask) return;

  activeShushuQueueTaskId = nextTask.id;
  nextTask.status = "running";
  nextTask.startedAt = Date.now();
  nextTask.params.signal = nextTask.abortController.signal;
  nextTask.queryChannel = "sqlide-websocket";

  void queryShushuRows(nextTask.params)
    .then((result) => {
      if (nextTask.status === "cancelled") return;
      nextTask.status = "done";
      nextTask.result = result;
      nextTask.queryChannel = result.queryChannel;
      nextTask.completedAt = Date.now();
    })
    .catch((error) => {
      if (nextTask.status === "cancelled" || nextTask.abortController.signal.aborted) {
        nextTask.status = "cancelled";
        nextTask.error = "已取消查询任务。";
      } else {
        nextTask.status = "error";
        nextTask.error = String((error as Error).message);
      }
      nextTask.completedAt = Date.now();
    })
    .finally(() => {
      activeShushuQueueTaskId = "";
      cleanupShushuQueueTasks();
      processNextShushuQueueTask();
    });
}

async function runActualFileScan(job: ActualFileScanJob, params: {
  filePath: string;
  expectedEvents: ExpectedEvent[];
}) {
  try {
    const filePath = params.filePath.trim();
    if (!filePath) throw new Error("请填写本机 CSV 文件路径。");
    const extension = path.extname(filePath).toLowerCase();
    if (extension !== ".csv" && extension !== ".txt") {
      throw new Error("后端扫描仅支持 CSV/TXT 文件；Excel 请继续使用页面上传。");
    }

    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("填写的路径不是文件。");
    job.progress.fileSize = fileStat.size;

    const expectedEventNames = new Set(
      params.expectedEvents.filter((event) => !event.isCommonProperties).map((event) => event.eventName),
    );
    const accumulator = createActualEventAccumulator({
      expectedProperties: expectedPropertyNames(params.expectedEvents),
      expectedEventNames,
      distinctValueLimitPerProperty: 500,
    });
    const eventTestRows: RawRow[] = [];
    const fileStream = createReadStream(filePath, { encoding: "utf8" });
    fileStream.on("data", (chunk) => {
      job.progress.bytesRead += Buffer.byteLength(chunk, "utf8");
      job.progress.percent = fileStat.size > 0
        ? Math.min(99, Math.floor((job.progress.bytesRead / fileStat.size) * 100))
        : 0;
    });

    await new Promise<void>((resolve, reject) => {
      const csvStream = Papa.parse(Papa.NODE_STREAM_INPUT, {
        header: true,
        delimiter: ",",
        skipEmptyLines: "greedy",
        transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
      });
      const errors: Papa.ParseError[] = [];

      csvStream.on("data", (row: RawRow) => {
        const normalized = normalizeServerCsvRow(row);
        if (Object.keys(normalized).length === 0) return;
        job.progress.scannedRows += 1;
        accumulator.addRow(normalized);
        const eventTestRow = compactEventTestRow(normalized);
        if (Object.keys(eventTestRow).length > 0) eventTestRows.push(eventTestRow);
        if (job.progress.scannedRows % 1000 === 0) {
          job.progress.matchedEvents = accumulator.getResult().actualEvents.size;
        }
      });
      csvStream.on("error", reject);
      csvStream.on("finish", () => {
        if (errors.length > 0) {
          reject(new Error(errors.slice(0, 5).map((error) => error.message).join("; ")));
          return;
        }
        resolve();
      });
      csvStream.on("data-invalid", (error: Papa.ParseError) => {
        if (!isIgnorableCsvError(error)) errors.push(error);
      });
      fileStream.on("error", reject);
      fileStream.pipe(csvStream);
    });

    const result = accumulator.getResult();
    job.progress.percent = 100;
    job.progress.bytesRead = fileStat.size;
    job.progress.matchedEvents = result.actualEvents.size;
    job.status = "done";
    job.completedAt = Date.now();
    job.result = serializeActualEventScanResult({
      ...result,
      rowCount: job.progress.scannedRows,
      eventTestReport: await runServerEventTestCases(eventTestRows),
    });
  } catch (error) {
    job.status = "error";
    job.completedAt = Date.now();
    job.error = String((error as Error).message);
  }
}

async function runActualCsvStreamScan(job: ActualFileScanJob, params: {
  stream: NodeJS.ReadableStream;
  expectedEvents: ExpectedEvent[];
  fileSize: number;
}) {
  try {
    job.progress.fileSize = params.fileSize;
    const expectedEventNames = new Set(
      params.expectedEvents.filter((event) => !event.isCommonProperties).map((event) => event.eventName),
    );
    const accumulator = createActualEventAccumulator({
      expectedProperties: expectedPropertyNames(params.expectedEvents),
      expectedEventNames,
      distinctValueLimitPerProperty: 500,
    });
    const eventTestRows: RawRow[] = [];

    params.stream.on("data", (chunk: Buffer | string) => {
      job.progress.bytesRead += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk, "utf8");
      job.progress.percent = params.fileSize > 0
        ? Math.min(99, Math.floor((job.progress.bytesRead / params.fileSize) * 100))
        : 0;
    });

    await new Promise<void>((resolve, reject) => {
      const csvStream = Papa.parse(Papa.NODE_STREAM_INPUT, {
        header: true,
        delimiter: ",",
        skipEmptyLines: "greedy",
        transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
      });
      const errors: Papa.ParseError[] = [];

      csvStream.on("data", (row: RawRow) => {
        const normalized = normalizeServerCsvRow(row);
        if (Object.keys(normalized).length === 0) return;
        job.progress.scannedRows += 1;
        accumulator.addRow(normalized);
        const eventTestRow = compactEventTestRow(normalized);
        if (Object.keys(eventTestRow).length > 0) eventTestRows.push(eventTestRow);
        if (job.progress.scannedRows % 1000 === 0) {
          job.progress.matchedEvents = accumulator.getResult().actualEvents.size;
        }
      });
      csvStream.on("error", reject);
      csvStream.on("finish", () => {
        if (errors.length > 0) {
          reject(new Error(errors.slice(0, 5).map((error) => error.message).join("; ")));
          return;
        }
        resolve();
      });
      csvStream.on("data-invalid", (error: Papa.ParseError) => {
        if (!isIgnorableCsvError(error)) errors.push(error);
      });
      params.stream.on("error", reject);
      params.stream.pipe(csvStream);
    });

    const result = accumulator.getResult();
    job.progress.percent = 100;
    job.progress.bytesRead = params.fileSize || job.progress.bytesRead;
    job.progress.matchedEvents = result.actualEvents.size;
    job.status = "done";
    job.completedAt = Date.now();
    job.result = serializeActualEventScanResult({
      ...result,
      rowCount: job.progress.scannedRows,
      eventTestReport: await runServerEventTestCases(eventTestRows),
    });
  } catch (error) {
    job.status = "error";
    job.completedAt = Date.now();
    job.error = String((error as Error).message);
  }
}

function registerActualFileScanApi(middlewares: {
  use: (route: string, handler: (req: any, res: any) => void) => void;
}) {
  middlewares.use("/api/actual-file-scan", async (req, res) => {
    try {
      if (req.method !== "POST") {
        jsonResponse(res, 405, { error: "Method not allowed" });
        return;
      }
      cleanupActualScanJobs();
      const params = await readJsonBody<{
        action?: "start" | "status";
        scanId?: string;
        filePath?: string;
        expectedEvents?: ExpectedEvent[];
      }>(req);
      const action = params.action ?? "start";

      if (action === "status") {
        const scanId = String(params.scanId ?? "").trim();
        const job = actualScanJobs.get(scanId);
        if (!job) throw new Error("未找到本地扫描任务，请重新开始扫描。");
        jsonResponse(res, 200, serializeActualScanJob(job, { includeResult: true }));
        return;
      }

      const expectedEvents = Array.isArray(params.expectedEvents) ? params.expectedEvents : [];
      if (expectedEvents.length === 0) throw new Error("请先读取预期埋点表，再扫描本地实际数据。");
      const job: ActualFileScanJob = {
        id: buildActualScanJobId(),
        status: "queued",
        mode: action === "create-upload" ? "upload" : "path",
        filePath: String(params.filePath ?? ""),
        progress: {
          percent: 0,
          scannedRows: 0,
          matchedEvents: 0,
          fileSize: 0,
          bytesRead: 0,
          position: 0,
        },
        expectedEvents,
        startedAt: Date.now(),
      };
      actualScanJobs.set(job.id, job);
      if (action === "create-upload") {
        jsonResponse(res, 200, serializeActualScanJob(job));
        processNextActualScanJob();
        return;
      }
      jsonResponse(res, 200, serializeActualScanJob(job));
      processNextActualScanJob();
    } catch (error) {
      jsonResponse(res, 500, { error: String((error as Error).message) });
    }
  });

  middlewares.use("/api/actual-file-scan-upload", async (req, res) => {
    try {
      if (req.method !== "POST") {
        jsonResponse(res, 405, { error: "Method not allowed" });
        return;
      }
      cleanupActualScanJobs();
      const scanId = String(req.headers["x-scan-id"] ?? "").trim();
      const job = actualScanJobs.get(scanId);
      if (!job) throw new Error("未找到上传扫描任务，请重新选择文件。");
      if (job.mode !== "upload") throw new Error("该任务不是上传扫描任务。");
      if (job.status === "queued") {
        throw new Error(`扫描任务仍在排队中，当前第 ${actualScanQueuedPosition(job)} 位，请稍后上传。`);
      }
      if (job.status !== "waiting_upload" && job.status !== "running") {
        throw new Error(job.error || "扫描任务状态已结束，请重新选择文件。");
      }
      const fileName = decodeURIComponent(String(req.headers["x-file-name"] ?? ""));
      const extension = path.extname(fileName).toLowerCase();
      if (extension !== ".csv" && extension !== ".txt") {
        throw new Error("大文件后端上传扫描仅支持 CSV/TXT；Excel 请继续使用小文件上传。");
      }
      const expectedEvents = job.expectedEvents ?? [];
      if (expectedEvents.length === 0) {
        throw new Error("请先读取预期埋点表，再扫描实际数据。");
      }
      job.status = "running";
      job.fileName = fileName;
      job.progress = {
        percent: 0,
        scannedRows: 0,
        matchedEvents: 0,
        fileSize: Number(req.headers["x-file-size"] ?? 0) || 0,
        bytesRead: 0,
        position: 0,
      };
      await runActualCsvStreamScan(job, {
        stream: req,
        expectedEvents,
        fileSize: job.progress.fileSize,
      });
      jsonResponse(res, job.status === "error" ? 500 : 200, serializeActualScanJob(job, { includeResult: true }));
      finishActiveActualScanJob(job);
    } catch (error) {
      const scanId = String(req.headers["x-scan-id"] ?? "").trim();
      const job = actualScanJobs.get(scanId);
      if (job && job.status !== "queued" && job.status !== "done" && job.status !== "cancelled") {
        job.status = "error";
        job.completedAt = Date.now();
        job.error = String((error as Error).message);
        finishActiveActualScanJob(job);
      }
      jsonResponse(res, 500, { error: String((error as Error).message) });
    }
  });
}

async function postShushuJson(apiBaseUrl: string, pathName: string, params: Record<string, unknown>) {
  const url = new URL(`${apiBaseUrl}${pathName}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      url.searchParams.set(key, String(value));
    }
  });
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const text = await response.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    payload = { rawText: text };
  }
  if (!response.ok) {
    throw new Error(friendlyShushuHttpError(response.status, text));
  }
  return payload;
}

async function getShushuJson(apiBaseUrl: string, pathName: string, params: Record<string, unknown>) {
  const url = new URL(`${apiBaseUrl}${pathName}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      url.searchParams.set(key, String(value));
    }
  });
  const response = await fetch(url, { method: "GET" });
  const text = await response.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    payload = { rawText: text };
  }
  if (!response.ok) {
    throw new Error(friendlyShushuHttpError(response.status, text));
  }
  return payload;
}


function buildSqlRequestBody(params: { sql: string; pageSize: number; timeoutSeconds?: number }) {
  const body = new URLSearchParams();
  body.set("sql", params.sql);
  body.set("pageSize", String(params.pageSize));
  body.set("format", "json_object");
  body.set("timeoutSeconds", String(params.timeoutSeconds ?? 1800));
  return body;
}

async function submitShushuSql(apiBaseUrl: string, params: {
  token: string;
  sql: string;
  pageSize: number;
}) {
  const url = new URL(`${apiBaseUrl}/open/submit-sql`);
  url.searchParams.set("token", params.token);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: buildSqlRequestBody(params),
  });
  const text = await response.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    payload = { rawText: text };
  }
  if (!response.ok) {
    throw new Error(friendlyShushuHttpError(response.status, text));
  }
  return payload;
}

async function executeShushuSql(apiBaseUrl: string, params: {
  token: string;
  sql: string;
  pageSize: number;
  timeoutSeconds?: number;
  signal?: AbortSignal;
}) {
  const url = new URL(`${apiBaseUrl}/open/execute-sql`);
  url.searchParams.set("token", params.token);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: buildSqlRequestBody(params),
    signal: params.signal,
  });
  const text = await response.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    payload = { rawText: text };
  }
  if (!response.ok) {
    throw new Error(friendlyShushuHttpError(response.status, text));
  }
  return payload;
}

async function queryShushuRowsByOpenApi(params: {
  config: ReturnType<typeof normalizeShushuQueryConfig>;
  maxRows: number;
  signal?: AbortSignal;
}) {
  if (!params.config.apiBaseUrl) throw new Error("请填写数数 API 地址。");
  if (!params.config.token) throw new Error("请填写数数 OpenAPI Token。");
  const sql = buildShushuSql(params.config);
  const payload = await executeShushuSql(params.config.apiBaseUrl, {
    token: params.config.token,
    sql,
    pageSize: Math.min(params.config.pageSize || 1000, params.maxRows || params.config.pageSize || 1000),
    timeoutSeconds: 1800,
    signal: params.signal,
  });
  if (!isSuccessPayload(payload)) throw new Error(shushuErrorMessage(payload));
  const normalized = normalizeShushuPayload(payload);
  const metadata = normalizeShushuExecuteSqlMetadata(payload);
  const resultRows = metadata.taskId ? [] : [...normalized.rows];
  if (metadata.taskId) {
    const pageSize = Math.min(params.config.pageSize || 1000, params.maxRows || params.config.pageSize || 1000);
    for (const pageId of shushuResultPageIdsToRead({
      pageCount: metadata.pageCount,
      pageSize,
      maxRows: params.maxRows,
    })) {
      const pageRows = await fetchShushuResultPage(params.config.apiBaseUrl, {
        token: params.config.token,
        taskId: metadata.taskId,
        pageId,
        headers: metadata.columns,
        signal: params.signal,
      });
      resultRows.push(...pageRows);
      if (params.maxRows > 0 && resultRows.length >= params.maxRows) break;
      if (pageRows.length === 0) break;
    }
  }
  const rows = params.maxRows > 0 ? resultRows.slice(0, params.maxRows) : resultRows;
  return {
    rows,
    columns: normalized.columns.length > 0
      ? normalized.columns
      : metadata.columns.length > 0
        ? metadata.columns
        : [...new Set(rows.flatMap((row) => Object.keys(row)))],
    rowCount: metadata.rowCount || rows.length,
    requestedRows: params.maxRows,
    loadedRows: rows.length,
    sql,
  };
}

async function fetchShushuResultPage(apiBaseUrl: string, params: {
  token: string;
  taskId: string;
  pageId: number;
  headers: string[];
  signal?: AbortSignal;
}) {
  const url = new URL(`${apiBaseUrl}/open/sql-result-page`);
  url.searchParams.set("token", params.token);
  url.searchParams.set("taskId", params.taskId);
  url.searchParams.set("pageId", String(params.pageId));

  const response = await fetch(url, { method: "GET", signal: params.signal });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(friendlyShushuHttpError(response.status, text));
  }
  try {
    const payload = JSON.parse(text) as Record<string, unknown>;
    if (!isSuccessPayload(payload)) {
      throw new Error(shushuErrorMessage(payload));
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      return parseShushuResultPageText(params.headers, text);
    }
    throw error;
  }
  return parseShushuResultPageText(params.headers, text);
}

function isSuccessPayload(payload: Record<string, unknown>) {
  const code = payload.return_code ?? payload.code ?? payload.status;
  return code === undefined || code === 0 || code === "0" || code === "success";
}

function shushuErrorMessage(payload: Record<string, unknown>) {
  return friendlyShushuErrorMessage(
    String(payload.return_message ?? payload.message ?? payload.msg ?? payload.error ?? "数数接口返回失败。"),
    payload.return_code ?? payload.code,
  );
}

function buildShushuSqlideRequestId() {
  return `WS_SQLIDE@@tool${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function parseWebSocketMessage(data: unknown) {
  const text = typeof data === "string"
    ? data
    : data instanceof Buffer
      ? data.toString("utf8")
      : String(data);
  return JSON.parse(text) as unknown;
}

async function queryShushuRowsBySqlideWebSocket(params: {
  socketUrl: string;
  projectId: string;
  sql: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}) {
  const requestId = buildShushuSqlideRequestId();
  const startedAt = Date.now();

  return new Promise<{
    rows: ReturnType<typeof normalizeShushuPayload>["rows"];
    columns: string[];
    rowCount: number;
  }>((resolve, reject) => {
    let settled = false;
    let socket: WebSocket | null = null;
    const timeout = setTimeout(() => {
      closeSocket();
      rejectOnce(new Error("数数 WebSocket 查询 300 秒内未返回结果，已尝试切换 OpenAPI。"));
    }, Math.max(1, params.timeoutMs ?? sqlideWebSocketFallbackMs));

    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      params.signal?.removeEventListener("abort", handleAbort);
      reject(error);
    };

    const resolveOnce = (result: { rows: ReturnType<typeof normalizeShushuPayload>["rows"]; columns: string[]; rowCount: number }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      params.signal?.removeEventListener("abort", handleAbort);
      resolve(result);
    };

    const closeSocket = () => {
      try {
        socket?.close();
      } catch {
        // ignore close errors during cancellation
      }
    };

    const handleAbort = () => {
      closeSocket();
      rejectOnce(new Error("已终止本次数数查询。"));
    };

    if (params.signal?.aborted) {
      rejectOnce(new Error("已终止本次数数查询。"));
      return;
    }
    params.signal?.addEventListener("abort", handleAbort);

    socket = new WebSocket(normalizeShushuSqlideWebSocketUrl(params.socketUrl));
    socket.addEventListener("open", () => {
      socket?.send(JSON.stringify(buildShushuSqlideMessage({
        requestId,
        projectId: params.projectId,
        sql: params.sql,
      })));
    });
    socket.addEventListener("message", (event) => {
      try {
        const normalized = normalizeShushuSqlideMessage(parseWebSocketMessage(event.data));
        if (!normalized || normalized.requestId !== requestId || !normalized.done) return;
        closeSocket();
        resolveOnce({
          rows: normalized.rows,
          columns: normalized.columns,
          rowCount: normalized.rowCount,
        });
      } catch (error) {
        closeSocket();
        rejectOnce(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.addEventListener("error", () => {
      rejectOnce(new Error("数数 WebSocket 查询连接失败，请确认数数网页端当前可访问。"));
    });
    socket.addEventListener("close", () => {
      if (!settled && Date.now() - startedAt > 1000) {
        rejectOnce(new Error("数数 WebSocket 查询连接已断开，未收到查询结果。"));
      }
    });
  });
}

function normalizeProjectOptions(payload: Record<string, unknown>): ShushuProjectOption[] {
  const data = payload.data;
  const items = Array.isArray(data)
    ? data
    : data && typeof data === "object"
      ? ((data as Record<string, unknown>).projects ??
        (data as Record<string, unknown>).projectList ??
        (data as Record<string, unknown>).list)
      : payload.projects;
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const project = item as Record<string, unknown>;
      const id = String(project.projectId ?? project.project_id ?? project.id ?? project.appId ?? "").trim();
      const name = String(project.projectName ?? project.project_name ?? project.name ?? id).trim();
      return id ? { id, name: name || id } : null;
    })
    .filter(Boolean) as ShushuProjectOption[];
}

function rowTimeValue(row: RawRow): number {
  const value = row["#event_time"];
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function queryShushuRows(params: Record<string, unknown>) {
  const config = normalizeShushuQueryConfig(await withShushuLocalConfig(params));
  const resolved = await withShushuLocalConfig(params);
  const maxRows = config.maxRows > 0 ? config.maxRows : config.pageSize;
  let websocketRows: ReturnType<typeof normalizeShushuPayload>["rows"] = [];
  let websocketColumns: string[] = [];
  let websocketShardCount = 1;
  let websocketError: unknown = null;
  let stopReason = "";
  const signal = params.signal instanceof AbortSignal ? params.signal : undefined;
  const websocketStartedAt = Date.now();

  try {
    if (String(resolved.sqlideWebSocketUrl ?? "") === defaultShushuSqlideWebSocketUrl) {
      throw new Error("当前 WebSocket 地址是默认旧地址，已直接切换 OpenAPI。");
    }
    const sqlideSqls = buildShushuSqlideQuerySqls(config);
    websocketShardCount = sqlideSqls.length;
    for (const firstSql of sqlideSqls) {
      if (websocketRows.length >= maxRows) break;
      const isSingleEventShard = websocketShardCount > 1;
      const shardLimit = isSingleEventShard
        ? SHUSHU_SQLIDE_WEBSOCKET_BATCH_LIMIT
        : maxRows;
      for (let shardOffset = 0; shardOffset < shardLimit && websocketRows.length < maxRows; shardOffset += SHUSHU_SQLIDE_WEBSOCKET_BATCH_LIMIT) {
        const remainingMs = sqlideWebSocketFallbackMs - (Date.now() - websocketStartedAt);
        if (remainingMs <= 0) {
          throw new Error("数数 WebSocket 查询整体超过 300 秒，已尝试切换 OpenAPI。");
        }
        const eventName = isSingleEventShard
          ? String(websocketRows.at(-1)?.[config.eventNameColumn] ?? "").trim()
          : "";
        const sql = shardOffset === 0
          ? firstSql
          : buildShushuSqlideBatchSql({
            config,
            eventName: eventName || undefined,
            offset: shardOffset,
            limit: SHUSHU_SQLIDE_WEBSOCKET_BATCH_LIMIT,
          });
        const page = await queryShushuRowsBySqlideWebSocket({
          socketUrl: String(resolved.sqlideWebSocketUrl ?? ""),
          projectId: config.projectId,
          sql,
          timeoutMs: remainingMs,
          signal,
        });
        websocketColumns = websocketColumns.length > 0 ? websocketColumns : page.columns;
        websocketRows.push(...page.rows);
        if (page.rows.length === 0) break;
      }
    }
    websocketRows = websocketRows
      .sort((left, right) => rowTimeValue(left) - rowTimeValue(right))
      .slice(0, maxRows);
    if (websocketRows.length < maxRows) {
      stopReason = `WebSocket 返回 ${websocketRows.length} 行；如预期更多，可能是数数 SQLIDE 本次结果集上限或查询条件实际命中较少。`;
    }
  } catch (error) {
    websocketError = error;
  }

  if (!websocketError && websocketRows.length > 0) {
    return {
      rows: websocketRows,
      columns: websocketColumns.length > 0 ? websocketColumns : [...new Set(websocketRows.flatMap((row) => Object.keys(row)))],
      rowCount: websocketRows.length,
      requestedRows: maxRows,
      loadedRows: websocketRows.length,
      sql: buildShushuSql(config),
      queryChannel: "sqlide-websocket",
      stopReason: websocketShardCount > 1
        ? `${stopReason ? `${stopReason} ` : ""}已按事件拆分 ${websocketShardCount} 组，并按 1000 行批次使用 WebSocket 查询，整体 300 秒内优先不切 API。`
        : stopReason,
    };
  }

  if (!websocketError) {
    websocketError = new Error("数数 WebSocket 查询返回 0 行数据，已尝试切换 OpenAPI。");
  }

  if (config.apiBaseUrl && config.token) {
    const openApiResult = await queryShushuRowsByOpenApi({ config, maxRows, signal });
    return {
      ...openApiResult,
      queryChannel: "openapi",
      fallbackReason: String((websocketError as Error).message),
    };
  }

  throw websocketError instanceof Error ? websocketError : new Error(String(websocketError));
}

async function listShushuEventNames(params: Record<string, unknown>) {
  const config = normalizeShushuQueryConfig(await withShushuLocalConfig(params));
  const resolved = await withShushuLocalConfig(params);
  const signal = params.signal instanceof AbortSignal ? params.signal : undefined;
  const sql = buildShushuEventNamesSql(config);

  try {
    if (String(resolved.sqlideWebSocketUrl ?? "") === defaultShushuSqlideWebSocketUrl) {
      throw new Error("当前 WebSocket 地址是默认旧地址。");
    }
    const page = await queryShushuRowsBySqlideWebSocket({
      socketUrl: String(resolved.sqlideWebSocketUrl ?? ""),
      projectId: config.projectId,
      sql,
      timeoutMs: sqlideWebSocketFallbackMs,
      signal,
    });
    return {
      eventNames: [...new Set(page.rows.map((row) => String(row[config.eventNameColumn] ?? "").trim()).filter(Boolean))],
      sql,
      queryChannel: "sqlide-websocket",
    };
  } catch (websocketError) {
    if (!config.apiBaseUrl || !config.token) throw websocketError;
    const payload = await executeShushuSql(config.apiBaseUrl, {
      token: config.token,
      sql,
      pageSize: 1000,
      timeoutSeconds: 1800,
      signal,
    });
    if (!isSuccessPayload(payload)) throw new Error(shushuErrorMessage(payload));
    const normalized = normalizeShushuPayload(payload);
    return {
      eventNames: [...new Set(normalized.rows.map((row) => String(row[config.eventNameColumn] ?? "").trim()).filter(Boolean))],
      sql,
      queryChannel: "openapi",
      fallbackReason: String((websocketError as Error).message),
    };
  }
}

async function startShushuQuery(params: Record<string, unknown>) {
  const config = normalizeShushuQueryConfig(await withShushuLocalConfig(params));
  if (!config.apiBaseUrl) throw new Error("请填写数数 API 地址。");
  if (!config.token) throw new Error("请填写数数 OpenAPI Token。");
  const sql = buildShushuSql(config);
  const submitPayload = await submitShushuSql(config.apiBaseUrl, {
    token: config.token,
    sql,
    pageSize: config.pageSize,
  });
  if (!isSuccessPayload(submitPayload)) throw new Error(shushuErrorMessage(submitPayload));
  const taskId = extractShushuTaskId(submitPayload);
  if (!taskId) {
    throw new Error(`数数查询已提交，但未返回 taskId。原始返回：${JSON.stringify(submitPayload).slice(0, 500)}`);
  }
  return { taskId, sql };
}

async function getShushuTaskStatus(params: Record<string, unknown>) {
  const config = normalizeShushuQueryConfig(await withShushuLocalConfig(params));
  const taskId = String(params.taskId ?? "").trim();
  if (!taskId) throw new Error("缺少数数查询 taskId。");
  const payload = await getShushuJson(config.apiBaseUrl, "/open/sql-task-info", {
    token: config.token,
    taskId,
  });
  if (!isSuccessPayload(payload)) throw new Error(shushuErrorMessage(payload));
  return normalizeShushuTaskInfo(payload);
}

async function getShushuResultPage(params: Record<string, unknown>) {
  const config = normalizeShushuQueryConfig(await withShushuLocalConfig(params));
  const taskId = String(params.taskId ?? "").trim();
  const pageId = Number(params.pageId) || 0;
  const columns = Array.isArray(params.columns) ? params.columns.map(String) : [];
  if (!taskId) throw new Error("缺少数数查询 taskId。");
  const rows = await fetchShushuResultPage(config.apiBaseUrl, {
    token: config.token,
    taskId,
    pageId,
    headers: columns,
    signal: params.signal instanceof AbortSignal ? params.signal : undefined,
  });
  return {
    rows,
    columns: columns.length > 0 ? columns : [...new Set(rows.flatMap((row) => Object.keys(row)))],
    pageId,
  };
}

function registerShushuApi(middlewares: {
  use: (route: string, handler: (req: any, res: any) => void) => void;
}) {
  middlewares.use("/api/shushu-config", async (req, res) => {
    try {
      if (req.method !== "GET") {
        jsonResponse(res, 405, { error: "Method not allowed" });
        return;
      }
      const config = await readShushuLocalConfig();
      jsonResponse(res, 200, {
        apiBaseUrl: config.apiBaseUrl,
        loginName: config.loginName,
        hasToken: Boolean(config.token),
        sqlideWebSocketUrl: config.sqlideWebSocketUrl,
      });
    } catch (error) {
      jsonResponse(res, 500, { error: String((error as Error).message) });
    }
  });

  middlewares.use("/api/shushu-projects", async (req, res) => {
    try {
      if (req.method !== "POST") {
        jsonResponse(res, 405, { error: "Method not allowed" });
        return;
      }
      const { apiBaseUrl = "", token = "", loginName = "" } = await readJsonBody<{
        apiBaseUrl?: string;
        token?: string;
        loginName?: string;
      }>(req);
      const resolved = await withShushuLocalConfig({ apiBaseUrl, token, loginName });
      const baseUrl = String(resolved.apiBaseUrl ?? "").trim().replace(/\/+$/, "");
      const resolvedToken = String(resolved.token ?? "").trim();
      const resolvedLoginName = String(resolved.loginName ?? "").trim();
      if (!baseUrl) throw new Error("请填写数数 API 地址。");
      if (!resolvedToken) throw new Error("请填写数数 OpenAPI Token。");
      if (!resolvedLoginName) throw new Error("请填写数数登录名。");
      const payload = await postShushuJson(baseUrl, "/open/project-list", {
        token: resolvedToken,
        loginName: resolvedLoginName,
        login_name: resolvedLoginName,
      });
      if (!isSuccessPayload(payload)) throw new Error(shushuErrorMessage(payload));
      jsonResponse(res, 200, { projects: normalizeProjectOptions(payload) });
    } catch (error) {
      jsonResponse(res, 500, { error: String((error as Error).message) });
    }
  });

  middlewares.use("/api/shushu-query", async (req, res) => {
    try {
      if (req.method !== "POST") {
        jsonResponse(res, 405, { error: "Method not allowed" });
        return;
      }
      const params = await readJsonBody<Record<string, unknown>>(req);
      const abortController = new AbortController();
      req.on?.("close", () => abortController.abort());
      params.signal = abortController.signal;
      const action = String(params.action ?? "query");
      cleanupShushuQueueTasks();
      if (action === "enqueue") {
        const resolvedParams = await withShushuLocalConfig(params);
        const config = normalizeShushuQueryConfig(resolvedParams);
        const task: ShushuQueueTask = {
          id: buildShushuQueueTaskId(),
          status: "queued",
          createdAt: Date.now(),
          params: resolvedParams,
          projectId: config.projectId,
          summary: shushuQueueSummary(config),
          abortController: new AbortController(),
        };
        shushuQueryQueue.set(task.id, task);
        processNextShushuQueueTask();
        jsonResponse(res, 200, { task: serializeShushuQueueTask(task) });
        return;
      }
      if (action === "queue") {
        jsonResponse(res, 200, { tasks: queuedShushuTasks().map(serializeShushuQueueTask) });
        return;
      }
      if (action === "queue-task") {
        const taskId = String(params.taskId ?? params.id ?? "").trim();
        const task = shushuQueryQueue.get(taskId);
        if (!task) throw new Error("未找到数数查询队列任务。");
        jsonResponse(res, 200, { task: serializeShushuQueueTask(task, { includeResult: true }) });
        return;
      }
      if (action === "cancel-queue") {
        const taskId = String(params.taskId ?? params.id ?? "").trim();
        const task = shushuQueryQueue.get(taskId);
        if (!task) throw new Error("未找到数数查询队列任务。");
        if (task.status === "queued" || task.status === "running") {
          task.status = "cancelled";
          task.error = "已取消查询任务。";
          task.completedAt = Date.now();
          task.abortController.abort();
        }
        jsonResponse(res, 200, { task: serializeShushuQueueTask(task) });
        processNextShushuQueueTask();
        return;
      }
      if (action === "save-config") {
        const saved = await writeShushuLocalConfig({
          sqlideWebSocketUrl: String(params.sqlideWebSocketUrl ?? ""),
        });
        jsonResponse(res, 200, {
          sqlideWebSocketUrl: saved.sqlideWebSocketUrl,
          apiBaseUrl: saved.apiBaseUrl,
          loginName: saved.loginName,
          hasToken: Boolean(saved.token),
        });
        return;
      }
      if (action === "refresh-websocket") {
        jsonResponse(res, 200, await refreshShushuSqlideWebSocket(params));
        return;
      }
      if (action === "start") {
        jsonResponse(res, 200, await startShushuQuery(params));
        return;
      }
      if (action === "status") {
        jsonResponse(res, 200, await getShushuTaskStatus(params));
        return;
      }
      if (action === "page") {
        jsonResponse(res, 200, await getShushuResultPage(params));
        return;
      }
      if (action === "event-names") {
        jsonResponse(res, 200, await listShushuEventNames(params));
        return;
      }
      jsonResponse(res, 200, await queryShushuRows(params));
    } catch (error) {
      jsonResponse(res, 500, { error: String((error as Error).message) });
    }
  });
}

function larkSheetPlugin(): Plugin {
  return {
    name: "local-data-api",
    configureServer(server) {
      registerLarkSheetApi(server.middlewares);
      registerActualFileScanApi(server.middlewares);
      registerShushuApi(server.middlewares);
    },
    configurePreviewServer(server) {
      registerLarkSheetApi(server.middlewares);
      registerActualFileScanApi(server.middlewares);
      registerShushuApi(server.middlewares);
    },
  };
}

export default defineConfig({
  plugins: [react(), larkSheetPlugin()],
});

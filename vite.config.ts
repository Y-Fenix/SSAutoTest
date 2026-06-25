import react from "@vitejs/plugin-react";
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { defineConfig, type Plugin } from "vite";
import { extractSheets, extractValues, rowsFromValues, toSheetTabs } from "./src/lib/larkSheetServerUtils";
import {
  buildShushuSql,
  extractShushuTaskId,
  normalizeShushuPayload,
  normalizeShushuQueryConfig,
  normalizeShushuTaskInfo,
  parseShushuResultPageText,
  type ShushuProjectOption,
} from "./src/lib/shushuQuery";

const execFileAsync = promisify(execFile);
let larkCliPathCache: string | null = null;

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
  if (status === 504) {
    return "数数 SQL 查询超时：当前查询数据量太大或执行太久。建议先缩小日期范围、指定用户 ID，或把分页行数调小后重试。";
  }
  return text.includes("<html")
    ? `数数接口请求失败(${status})：接口返回了 HTML 页面，请检查 API 地址和接口网关。`
    : `数数接口请求失败(${status})：${text.slice(0, 500)}`;
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


function buildSqlRequestBody(params: { sql: string; pageSize: number }) {
  const body = new URLSearchParams();
  body.set("sql", params.sql);
  body.set("pageSize", String(params.pageSize));
  body.set("format", "json_object");
  body.set("timeoutSeconds", "60");
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
}) {
  const url = new URL(`${apiBaseUrl}/open/execute-sql`);
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

async function fetchShushuResultPage(apiBaseUrl: string, params: {
  token: string;
  taskId: string;
  pageId: number;
  headers: string[];
}) {
  const url = new URL(`${apiBaseUrl}/open/sql-result-page`);
  url.searchParams.set("token", params.token);
  url.searchParams.set("taskId", params.taskId);
  url.searchParams.set("pageId", String(params.pageId));

  const response = await fetch(url, { method: "GET" });
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
  return String(payload.return_message ?? payload.message ?? payload.msg ?? payload.error ?? "数数接口返回失败。");
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

async function queryShushuRows(params: Record<string, unknown>) {
  const config = normalizeShushuQueryConfig(params);
  if (!config.apiBaseUrl) throw new Error("请填写数数 API 地址。");
  if (!config.token) throw new Error("请填写数数 OpenAPI Token。");
  const sql = buildShushuSql(config);
  const submitPayload = await executeShushuSql(config.apiBaseUrl, {
    token: config.token,
    sql,
    pageSize: config.pageSize,
  });
  if (!isSuccessPayload(submitPayload)) throw new Error(shushuErrorMessage(submitPayload));

  const normalizedSubmit = normalizeShushuPayload(submitPayload);
  if (normalizedSubmit.rows.length > 0) {
    return {
      rows: normalizedSubmit.rows,
      columns: normalizedSubmit.columns,
      sql,
      rowCount: normalizedSubmit.rows.length,
    };
  }

  const data = submitPayload.data && typeof submitPayload.data === "object" ? submitPayload.data as Record<string, unknown> : {};
  const taskId = String(
    submitPayload.taskId ??
      submitPayload.task_id ??
      data.taskId ??
      data.task_id ??
      "",
  ).trim();
  if (!taskId) {
    throw new Error(`数数查询已提交，但未返回 taskId，无法读取分页结果。原始返回：${JSON.stringify(submitPayload).slice(0, 500)}`);
  }

  const pageCount = Number(data.pageCount ?? submitPayload.pageCount ?? 1) || 1;
  const pages = await Promise.all(
    Array.from({ length: pageCount }, (_, pageId) =>
      fetchShushuResultPage(config.apiBaseUrl, {
        token: config.token,
        taskId,
        pageId,
        headers: normalizedSubmit.columns,
      }),
    ),
  );
  const rows = pages.flat();
  const columns = normalizedSubmit.columns.length > 0
    ? normalizedSubmit.columns
    : [...new Set(rows.flatMap((row) => Object.keys(row)))];

  return { rows, columns, sql, rowCount: Number(data.rowCount ?? rows.length) || rows.length };
}

async function startShushuQuery(params: Record<string, unknown>) {
  const config = normalizeShushuQueryConfig(params);
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
  const config = normalizeShushuQueryConfig(params);
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
  const config = normalizeShushuQueryConfig(params);
  const taskId = String(params.taskId ?? "").trim();
  const pageId = Number(params.pageId) || 0;
  const columns = Array.isArray(params.columns) ? params.columns.map(String) : [];
  if (!taskId) throw new Error("缺少数数查询 taskId。");
  const rows = await fetchShushuResultPage(config.apiBaseUrl, {
    token: config.token,
    taskId,
    pageId,
    headers: columns,
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
      const baseUrl = apiBaseUrl.trim().replace(/\/+$/, "");
      if (!baseUrl) throw new Error("请填写数数 API 地址。");
      if (!token.trim()) throw new Error("请填写数数 OpenAPI Token。");
      if (!loginName.trim()) throw new Error("请填写数数登录名。");
      const payload = await postShushuJson(baseUrl, "/open/project-list", {
        token: token.trim(),
        loginName: loginName.trim(),
        login_name: loginName.trim(),
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
      const action = String(params.action ?? "query");
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
      registerShushuApi(server.middlewares);
    },
    configurePreviewServer(server) {
      registerLarkSheetApi(server.middlewares);
      registerShushuApi(server.middlewares);
    },
  };
}

export default defineConfig({
  plugins: [react(), larkSheetPlugin()],
});

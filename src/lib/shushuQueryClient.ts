import type { RawRow } from "./types";
import type {
  ShushuProjectOption,
  ShushuQueryInput,
  ShushuQueryResponse,
  ShushuQueryStartResponse,
  ShushuResultPageResponse,
  ShushuTaskInfo,
} from "./shushuQuery";

export async function listShushuProjects(
  apiBaseUrl: string,
  token: string,
  loginName: string,
): Promise<ShushuProjectOption[]> {
  const response = await fetch("/api/shushu-projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiBaseUrl, token, loginName }),
  });
  const payload = (await response.json()) as { projects?: ShushuProjectOption[]; error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "数数项目列表读取失败。");
  }
  return payload.projects ?? [];
}

export async function queryShushuRows(config: ShushuQueryInput): Promise<ShushuQueryResponse> {
  const response = await fetch("/api/shushu-query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  const payload = (await response.json()) as ShushuQueryResponse & { error?: string; rows?: RawRow[] };
  if (!response.ok) {
    throw new Error(payload.error ?? "数数自定义查询失败。");
  }
  return {
    rows: payload.rows ?? [],
    columns: payload.columns ?? [],
    sql: payload.sql ?? "",
    rowCount: payload.rowCount ?? payload.rows?.length ?? 0,
  };
}

export async function startShushuQuery(config: ShushuQueryInput): Promise<ShushuQueryStartResponse> {
  const response = await fetch("/api/shushu-query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "start", ...config }),
  });
  const payload = (await response.json()) as ShushuQueryStartResponse & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "数数 SQL 提交失败。");
  }
  return payload;
}

export async function getShushuQueryStatus(config: ShushuQueryInput & { taskId: string }): Promise<ShushuTaskInfo> {
  const response = await fetch("/api/shushu-query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "status", ...config }),
  });
  const payload = (await response.json()) as ShushuTaskInfo & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "数数 SQL 状态读取失败。");
  }
  return payload;
}

export async function readShushuResultPage(
  config: ShushuQueryInput & { taskId: string; pageId: number; columns: string[] },
): Promise<ShushuResultPageResponse> {
  const response = await fetch("/api/shushu-query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "page", ...config }),
  });
  const payload = (await response.json()) as ShushuResultPageResponse & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "数数 SQL 结果页读取失败。");
  }
  return payload;
}

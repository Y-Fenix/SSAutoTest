import type { RawRow } from "./types";
import type { ShushuProjectOption, ShushuQueryInput, ShushuQueryResponse } from "./shushuQuery";

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

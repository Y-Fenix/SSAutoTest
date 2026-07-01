import type { RawRow } from "./types";
import type {
  ShushuProjectOption,
  ShushuQueueTaskInfo,
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

export async function queryShushuRows(config: ShushuQueryInput, signal?: AbortSignal): Promise<ShushuQueryResponse> {
  const response = await fetch("/api/shushu-query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
    signal,
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
    requestedRows: payload.requestedRows,
    loadedRows: payload.loadedRows,
    queryChannel: payload.queryChannel,
    fallbackReason: payload.fallbackReason,
    stopReason: payload.stopReason,
  };
}

export async function enqueueShushuQuery(config: ShushuQueryInput): Promise<ShushuQueueTaskInfo> {
  const response = await fetch("/api/shushu-query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "enqueue", ...config }),
  });
  const payload = (await response.json()) as { task?: ShushuQueueTaskInfo; error?: string };
  if (!response.ok || !payload.task) {
    throw new Error(payload.error ?? "数数查询入队失败。");
  }
  return payload.task;
}

export async function listShushuQueryQueue(): Promise<ShushuQueueTaskInfo[]> {
  const response = await fetch("/api/shushu-query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "queue" }),
  });
  const payload = (await response.json()) as { tasks?: ShushuQueueTaskInfo[]; error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "数数查询队列读取失败。");
  }
  return payload.tasks ?? [];
}

export async function getShushuQueuedQuery(taskId: string): Promise<ShushuQueueTaskInfo> {
  const response = await fetch("/api/shushu-query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "queue-task", taskId }),
  });
  const payload = (await response.json()) as { task?: ShushuQueueTaskInfo; error?: string };
  if (!response.ok || !payload.task) {
    throw new Error(payload.error ?? "数数查询任务状态读取失败。");
  }
  return payload.task;
}

export async function cancelShushuQueuedQuery(taskId: string): Promise<ShushuQueueTaskInfo> {
  const response = await fetch("/api/shushu-query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "cancel-queue", taskId }),
  });
  const payload = (await response.json()) as { task?: ShushuQueueTaskInfo; error?: string };
  if (!response.ok || !payload.task) {
    throw new Error(payload.error ?? "数数查询任务取消失败。");
  }
  return payload.task;
}

export async function listShushuEventNames(config: ShushuQueryInput, signal?: AbortSignal): Promise<string[]> {
  const response = await fetch("/api/shushu-query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "event-names", ...config }),
    signal,
  });
  const payload = (await response.json()) as { eventNames?: string[]; error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "数数事件名列表读取失败。");
  }
  return payload.eventNames ?? [];
}

export async function saveShushuSqlideWebSocketUrl(sqlideWebSocketUrl: string): Promise<{
  sqlideWebSocketUrl: string;
}> {
  const response = await fetch("/api/shushu-query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "save-config", sqlideWebSocketUrl }),
  });
  const payload = (await response.json()) as { sqlideWebSocketUrl?: string; error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "数数 WebSocket 地址保存失败。");
  }
  return { sqlideWebSocketUrl: payload.sqlideWebSocketUrl ?? "" };
}

export async function refreshShushuSqlideWebSocketUrl(projectId: string, signal?: AbortSignal): Promise<{
  sqlideWebSocketUrl: string;
}> {
  const response = await fetch("/api/shushu-query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "refresh-websocket", projectId }),
    signal,
  });
  const payload = (await response.json()) as { sqlideWebSocketUrl?: string; error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "数数 WebSocket 自动刷新失败。");
  }
  return { sqlideWebSocketUrl: payload.sqlideWebSocketUrl ?? "" };
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

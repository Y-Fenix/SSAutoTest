import type { ExpectedEvent, SerializableActualEventScanResult } from "./types";

export interface ActualFileScanProgress {
  percent: number;
  scannedRows: number;
  matchedEvents: number;
  fileSize: number;
  bytesRead: number;
  position: number;
}

export interface ActualFileScanStatus {
  scanId: string;
  status: "queued" | "waiting_upload" | "running" | "done" | "error" | "cancelled";
  progress: ActualFileScanProgress;
  result?: SerializableActualEventScanResult;
  error?: string;
  summary?: string;
}

async function readActualScanPayload(response: Response, fallbackMessage: string): Promise<ActualFileScanStatus & { error?: string }> {
  const text = await response.text();
  if (!text.trim()) {
    return {
      scanId: "",
      status: "error",
      progress: { percent: 0, scannedRows: 0, matchedEvents: 0, fileSize: 0, bytesRead: 0, position: 0 },
      error: fallbackMessage,
    };
  }
  try {
    return JSON.parse(text) as ActualFileScanStatus & { error?: string };
  } catch {
    return {
      scanId: "",
      status: "error",
      progress: { percent: 0, scannedRows: 0, matchedEvents: 0, fileSize: 0, bytesRead: 0, position: 0 },
      error: text.length > 240 ? `${text.slice(0, 240)}...` : text,
    };
  }
}

export async function startActualFileScan(filePath: string, expectedEvents: ExpectedEvent[]): Promise<ActualFileScanStatus> {
  const response = await fetch("/api/actual-file-scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "start", filePath, expectedEvents }),
  });
  const payload = await readActualScanPayload(response, "本地文件后端扫描启动失败。");
  if (!response.ok) {
    throw new Error(payload.error ?? "本地文件后端扫描启动失败。");
  }
  return payload;
}

export async function createActualFileUploadScan(expectedEvents: ExpectedEvent[]): Promise<ActualFileScanStatus> {
  const startResponse = await fetch("/api/actual-file-scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create-upload", expectedEvents }),
  });
  const started = await readActualScanPayload(startResponse, "大 CSV 后端上传扫描任务创建失败。");
  if (!startResponse.ok) {
    throw new Error(started.error ?? "大 CSV 后端上传扫描任务创建失败。");
  }
  return started;
}

export async function uploadActualFileScanWithId(file: File, scanId: string): Promise<ActualFileScanStatus> {
  const response = await fetch("/api/actual-file-scan-upload", {
    method: "POST",
    headers: {
      "Content-Type": "text/csv",
      "X-Scan-Id": scanId,
      "X-File-Name": encodeURIComponent(file.name),
      "X-File-Size": String(file.size),
    },
    body: file,
  });
  const payload = await readActualScanPayload(response, "大 CSV 后端上传扫描启动失败。");
  if (!response.ok) {
    throw new Error(payload.error ?? "大 CSV 后端上传扫描启动失败。");
  }
  return payload;
}

export async function uploadActualFileScan(file: File, expectedEvents: ExpectedEvent[]): Promise<ActualFileScanStatus> {
  const started = await createActualFileUploadScan(expectedEvents);
  return uploadActualFileScanWithId(file, started.scanId);
}

export async function getActualFileScanStatus(scanId: string): Promise<ActualFileScanStatus> {
  const response = await fetch("/api/actual-file-scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "status", scanId }),
  });
  const payload = await readActualScanPayload(response, "本地文件后端扫描进度读取失败。");
  if (!response.ok) {
    throw new Error(payload.error ?? "本地文件后端扫描进度读取失败。");
  }
  if (payload.status === "error") {
    throw new Error(payload.error ?? "本地文件后端扫描失败。");
  }
  return payload;
}

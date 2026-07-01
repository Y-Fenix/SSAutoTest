import type { RawRow } from "./types";

export interface EventTestIssue {
  ruleId: string;
  ruleName: string;
  eventName: string;
  rowIndex: number;
  expected: string;
  actual: string;
  detail: string;
  displayLines?: string[];
}

export interface EventTestCaseResult {
  ruleId: string;
  ruleName: string;
  status: "测试通过" | "测试不通过";
  checkedCount: number;
  issueCount: number;
  issues: EventTestIssue[];
}

export interface EventTestReport {
  totalRules: number;
  checkedRows: number;
  issueCount: number;
  issues: EventTestIssue[];
  results: EventTestCaseResult[];
  loadStatus?: "loading" | "ready" | "missing" | "error";
  loadMessage?: string;
}

type ExternalEventTestCases = {
  runEventTestCases?: (rows: RawRow[]) => EventTestReport;
};

declare global {
  interface Window {
    SSAutoTestEventTestCases?: ExternalEventTestCases;
    SSAutoTestEventTestCasesLoadedAt?: number;
  }
}

let eventTestCasesLoadPromise: Promise<void> | null = null;
let eventTestCasesLoadError = "";

function emptyReport(rows: RawRow[], loadStatus: EventTestReport["loadStatus"], loadMessage: string): EventTestReport {
  return {
    totalRules: 0,
    checkedRows: rows.length,
    issueCount: 0,
    issues: [],
    results: [],
    loadStatus,
    loadMessage,
  };
}

export function getEventTestCasesLoadError() {
  return eventTestCasesLoadError;
}

export function isEventTestCasesReady() {
  return typeof window !== "undefined" && typeof window.SSAutoTestEventTestCases?.runEventTestCases === "function";
}

export function loadEventTestCasesFile() {
  if (typeof window === "undefined") return Promise.resolve();
  if (isEventTestCasesReady()) return Promise.resolve();
  if (eventTestCasesLoadPromise) return eventTestCasesLoadPromise;

  eventTestCasesLoadError = "";
  eventTestCasesLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `/event-test-cases.js?v=${Date.now()}`;
    script.async = true;
    script.onload = () => {
      if (isEventTestCasesReady()) {
        window.SSAutoTestEventTestCasesLoadedAt = Date.now();
        resolve();
        return;
      }
      eventTestCasesLoadError = "测试用例文件已加载，但没有暴露 runEventTestCases(rows)。";
      reject(new Error(eventTestCasesLoadError));
    };
    script.onerror = () => {
      eventTestCasesLoadError = "测试用例文件 /event-test-cases.js 加载失败，请确认服务器 public/event-test-cases.js 存在。";
      reject(new Error(eventTestCasesLoadError));
    };
    document.head.appendChild(script);
  }).catch((error) => {
    eventTestCasesLoadPromise = null;
    eventTestCasesLoadError = String((error as Error).message);
    throw error;
  });

  return eventTestCasesLoadPromise;
}

export function runEventTestCases(rows: RawRow[]): EventTestReport {
  if (typeof window === "undefined") {
    return emptyReport(rows, "missing", "测试用例规则只从 public/event-test-cases.js 加载，Node 环境不会内置规则。");
  }

  const externalRunner = window.SSAutoTestEventTestCases?.runEventTestCases;
  if (typeof externalRunner !== "function") {
    return emptyReport(
      rows,
      eventTestCasesLoadError ? "error" : "loading",
      eventTestCasesLoadError || "正在加载测试用例文件 /event-test-cases.js...",
    );
  }

  try {
    const report = externalRunner(rows);
    return {
      ...report,
      loadStatus: "ready",
      loadMessage: "测试用例文件已加载。",
    };
  } catch (error) {
    return emptyReport(rows, "error", `测试用例文件执行失败：${String((error as Error).message)}`);
  }
}

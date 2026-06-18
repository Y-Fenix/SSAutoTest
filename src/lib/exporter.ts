import Papa from "papaparse";
import type { CoverageResult } from "./types";

function missingDetailItems(result: CoverageResult): string[] {
  return Object.entries(result.propertyDetailItems).flatMap(([propertyName, expectedItems]) => {
    const coveredItems = new Set(result.coveredDetailItems[propertyName] ?? []);
    return expectedItems
      .filter((item) => !coveredItems.has(item))
      .map((item) => `${propertyName}：${item}`);
  });
}

export function coverageResultsToCsv(results: CoverageResult[]): string {
  return Papa.unparse(
    results.map((result) => ({
      "事件名": result.eventName,
      "覆盖状态": result.status,
      "触发次数": result.triggerCount ?? "",
      "预期属性": result.expectedProperties.join("; "),
      "缺失属性": result.missingProperties.join("; "),
      "详情缺失": missingDetailItems(result).join("; "),
      "通过率": `${Math.round(result.passRate * 100)}%`,
    })),
  );
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

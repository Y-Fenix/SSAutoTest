import type { RawRow } from "./types";

export interface LarkSheetTab {
  id: string;
  title: string;
  index: number;
}

export async function listLarkSheetTabs(url: string): Promise<LarkSheetTab[]> {
  const response = await fetch("/api/lark-sheet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "list", url }),
  });
  const payload = (await response.json()) as { tabs?: LarkSheetTab[]; error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "飞书表格读取失败。");
  }
  return payload.tabs ?? [];
}

export async function readLarkSheetRows(url: string, sheetIds: string[]): Promise<RawRow[]> {
  const response = await fetch("/api/lark-sheet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "read", url, sheetIds }),
  });
  const payload = (await response.json()) as { rows?: RawRow[]; error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "飞书表格读取失败。");
  }
  return payload.rows ?? [];
}

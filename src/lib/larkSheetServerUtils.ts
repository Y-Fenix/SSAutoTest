import type { RawRow } from "./types";

export interface LarkSheetMeta {
  sheet_id?: string;
  sheetId?: string;
  title?: string;
  index?: number;
}

export interface LarkSheetTab {
  id: string;
  title: string;
  index: number;
}

export function extractSheets(payload: unknown): LarkSheetMeta[] {
  const candidates = [
    (payload as { sheets?: unknown }).sheets,
    (payload as { data?: { sheets?: unknown } }).data?.sheets,
    (payload as { data?: { sheets?: { sheets?: unknown } } }).data?.sheets?.sheets,
    (payload as { spreadsheet?: { sheets?: unknown } }).spreadsheet?.sheets,
    (payload as { data?: { spreadsheet?: { sheets?: unknown } } }).data?.spreadsheet?.sheets,
  ];
  const sheets = candidates.find(Array.isArray);
  return Array.isArray(sheets) ? (sheets as LarkSheetMeta[]) : [];
}

export function toSheetTabs(sheets: LarkSheetMeta[]): LarkSheetTab[] {
  return sheets
    .map((sheet, fallbackIndex) => ({
      id: sheet.sheet_id ?? sheet.sheetId ?? "",
      title: sheet.title?.trim() || `页签 ${fallbackIndex + 1}`,
      index: typeof sheet.index === "number" ? sheet.index : fallbackIndex,
    }))
    .filter((sheet) => sheet.id);
}

export function cellText(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "object") {
    const value = cell as { text?: unknown; value?: unknown; values?: unknown };
    if (value.text !== undefined) return String(value.text);
    if (value.value !== undefined) return String(value.value);
    if (Array.isArray(value.values)) return value.values.map(cellText).join(",");
  }
  return String(cell);
}

export function rowsFromValues(values: unknown): RawRow[] {
  if (!Array.isArray(values) || values.length === 0) return [];
  const matrix = values as unknown[][];
  const headers = matrix[0].map((cell, index) => cellText(cell).trim() || `列${index + 1}`);
  return matrix.slice(1).map((row) => {
    const record: RawRow = {};
    headers.forEach((header, index) => {
      record[header] = cellText(row[index]).trim();
    });
    return record;
  });
}

export function extractValues(payload: unknown): unknown {
  return (
    (payload as { values?: unknown }).values ??
    (payload as { data?: { values?: unknown } }).data?.values ??
    (payload as { valueRange?: { values?: unknown } }).valueRange?.values ??
    (payload as { data?: { valueRange?: { values?: unknown } } }).data?.valueRange?.values
  );
}

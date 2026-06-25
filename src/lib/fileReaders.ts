import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { RawRow } from "./types";

export interface WorkbookSheet {
  id: string;
  title: string;
  index: number;
}

function normalizeRows(rows: RawRow[]): RawRow[] {
  return rows.map((row) => {
    const normalized: RawRow = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[String(key).trim()] = typeof value === "string" ? value.trim() : value;
    }
    return normalized;
  });
}

export async function readTabularFile(file: File): Promise<RawRow[]> {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "csv" || extension === "txt") {
    const text = await file.text();
    const parsed = Papa.parse<RawRow>(text, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
    });
    if (parsed.errors.length > 0) {
      throw new Error(parsed.errors.map((error) => error.message).join("; "));
    }
    return normalizeRows(parsed.data);
  }

  if (extension === "xlsx" || extension === "xls") {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetNames = workbook.SheetNames.slice(0, 2);
    if (sheetNames.length === 0) throw new Error("Excel 文件没有可读取的工作表。");
    return normalizeRows(
      sheetNames.flatMap((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        return XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: "" });
      }),
    );
  }

  throw new Error("仅支持 CSV、XLS、XLSX 文件。");
}

async function readWorkbook(file: File): Promise<XLSX.WorkBook> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension !== "xlsx" && extension !== "xls") {
    throw new Error("仅 Excel 文件支持页签选择。");
  }
  const buffer = await file.arrayBuffer();
  return XLSX.read(buffer, { type: "array" });
}

export async function listWorkbookSheets(file: File): Promise<WorkbookSheet[]> {
  const workbook = await readWorkbook(file);
  return workbook.SheetNames.map((sheetName, index) => ({
    id: sheetName,
    title: sheetName,
    index,
  }));
}

export async function readWorkbookSheets(file: File, sheetIds: string[]): Promise<RawRow[]> {
  const workbook = await readWorkbook(file);
  const selectedSheetNames = sheetIds.length > 0 ? sheetIds : workbook.SheetNames.slice(0, 2);
  return normalizeRows(
    selectedSheetNames.flatMap((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) return [];
      return XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: "" });
    }),
  );
}

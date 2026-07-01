import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { RawRow } from "./types";

export interface WorkbookSheet {
  id: string;
  title: string;
  index: number;
}

export interface CsvReadProgress {
  rowCount: number;
  percent: number;
}

function normalizeRow(row: RawRow): RawRow {
  const normalized: RawRow = {};
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = String(key).replace(/^\uFEFF/, "").trim();
    const normalizedValue = typeof value === "string" ? value.trim() : value;
    if (!normalizedKey) continue;
    if (normalizedValue === "" || normalizedValue === undefined || normalizedValue === null) continue;
    normalized[normalizedKey] = normalizedValue;
  }
  return normalized;
}

function normalizeRows(rows: RawRow[]): RawRow[] {
  return rows.map(normalizeRow);
}

function isIgnorableCsvError(error: Papa.ParseError): boolean {
  return error.code === "UndetectableDelimiter";
}

async function readCsvFile(file: File): Promise<RawRow[]> {
  if (typeof FileReader === "undefined") {
    const text = await file.text();
    const parsed = Papa.parse<RawRow>(text, {
      header: true,
      delimiter: ",",
      skipEmptyLines: "greedy",
      transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
    });
    const errors = parsed.errors.filter((error) => !isIgnorableCsvError(error));
    if (errors.length > 0) throw new Error(errors.slice(0, 5).map((error) => error.message).join("; "));
    return normalizeRows(parsed.data);
  }

  return new Promise((resolve, reject) => {
    const rows: RawRow[] = [];
    const errors: Papa.ParseError[] = [];
    Papa.parse<RawRow>(file, {
      header: true,
      delimiter: ",",
      skipEmptyLines: "greedy",
      transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
      step: (result) => {
        if (result.errors.length > 0) errors.push(...result.errors.filter((error) => !isIgnorableCsvError(error)));
        if (result.data && Object.keys(result.data).length > 0) rows.push(normalizeRow(result.data));
      },
      complete: () => {
        if (errors.length > 0) {
          reject(new Error(errors.slice(0, 5).map((error) => error.message).join("; ")));
          return;
        }
        resolve(rows);
      },
      error: (error) => {
        reject(error);
      },
    });
  });
}

export async function readCsvFileByRows(
  file: File,
  onRow: (row: RawRow) => void,
  onProgress?: (progress: CsvReadProgress) => void,
  shouldStop?: () => boolean,
): Promise<number> {
  let rowCount = 0;
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension !== "csv" && extension !== "txt") {
    throw new Error("仅 CSV/TXT 文件支持分块读取。");
  }

  return new Promise((resolve, reject) => {
    const errors: Papa.ParseError[] = [];
    Papa.parse<RawRow>(file, {
      header: true,
      delimiter: ",",
      skipEmptyLines: "greedy",
      transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
      chunkSize: 1024 * 512,
      chunk: (result, parser) => {
        if (result.errors.length > 0) errors.push(...result.errors.filter((error) => !isIgnorableCsvError(error)));
        result.data.forEach((row) => {
          if (shouldStop?.()) return;
          const normalized = normalizeRow(row);
          if (Object.keys(normalized).length === 0) return;
          rowCount += 1;
          onRow(normalized);
        });
        const cursor = result.meta.cursor ?? 0;
        onProgress?.({
          rowCount,
          percent: file.size > 0 ? Math.min(99, Math.round((cursor / file.size) * 100)) : 0,
        });
        if (shouldStop?.()) parser.abort();
      },
      complete: () => {
        if (errors.length > 0) {
          reject(new Error(errors.slice(0, 5).map((error) => error.message).join("; ")));
          return;
        }
        onProgress?.({ rowCount, percent: 100 });
        resolve(rowCount);
      },
      error: (error) => {
        reject(error);
      },
    });
  });
}

export async function readTabularFile(file: File): Promise<RawRow[]> {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "csv" || extension === "txt") {
    return readCsvFile(file);
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

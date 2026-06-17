import type { ActualEventSummary, RawRow } from "./types";

export const EVENT_NAME_ALIASES = ["#event_name", "$part_event", "event_name", "事件名", "事件名称", "event", "事件"];

function columnScore(rows: RawRow[], column: string): number {
  return rows.reduce((score, row) => (isPresent(row[column]) ? score + 1 : score), 0);
}

export function detectEventNameColumn(rows: RawRow[]): string | null {
  const headers = new Set(rows.flatMap((row) => Object.keys(row)));
  const candidates = EVENT_NAME_ALIASES.filter((alias) => headers.has(alias))
    .map((alias) => ({ alias, score: columnScore(rows, alias) }))
    .filter((candidate) => candidate.score > 0);
  candidates.sort((a, b) => b.score - a.score || EVENT_NAME_ALIASES.indexOf(a.alias) - EVENT_NAME_ALIASES.indexOf(b.alias));
  return candidates[0]?.alias ?? null;
}

function isPresent(value: RawRow[keyof RawRow]): boolean {
  if (value === undefined || value === null) return false;
  return String(value).trim().length > 0;
}

export function parseActualDataRows(
  rows: RawRow[],
  eventNameColumn?: string,
): Map<string, ActualEventSummary> {
  const detectedColumn = eventNameColumn ?? detectEventNameColumn(rows);
  if (!detectedColumn) {
    throw new Error("未检测到事件名列，请选择 event_name / 事件名 / #event_name / event / 事件 等列。");
  }

  const summaries = new Map<string, ActualEventSummary>();

  for (const row of rows) {
    const rawEventName = row[detectedColumn];
    if (!isPresent(rawEventName)) continue;
    const displayName = String(rawEventName).trim();
    const eventName = displayName;

    const summary =
      summaries.get(eventName) ??
      {
        eventName,
        displayNames: new Set<string>(),
        properties: new Set<string>(),
        rows: [],
      };
    summary.displayNames.add(displayName);

    for (const [key, value] of Object.entries(row)) {
      const propertyName = key.trim();
      if (!propertyName || propertyName === detectedColumn) continue;
      if (isPresent(value)) summary.properties.add(propertyName);
    }

    summary.rows.push(row);
    summaries.set(eventName, summary);
  }

  return summaries;
}

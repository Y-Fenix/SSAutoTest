import type { ActualEventSummary, ExpectedEvent, RawRow, SerializableActualEventScanResult } from "./types";

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

export function expectedPropertyNames(expectedEvents: ExpectedEvent[]): Set<string> {
  return new Set(expectedEvents.flatMap((event) => event.properties.map((property) => property.propertyName)));
}

export function createActualEventAccumulator(params: {
  eventNameColumn?: string;
  expectedProperties?: Set<string>;
  expectedEventNames?: Set<string>;
  sampleLimitPerEvent?: number;
  distinctValueLimitPerProperty?: number;
}) {
  const summaries = new Map<string, ActualEventSummary>();
  const distinctValuesByEvent = new Map<string, Map<string, Set<string>>>();
  let detectedEventNameColumn = params.eventNameColumn ?? "";
  const observedColumns = new Set<string>();
  const expectedProperties = params.expectedProperties ?? new Set<string>();
  const keepAllProperties = expectedProperties.size === 0;
  const expectedEventNames = params.expectedEventNames ?? new Set<string>();
  const sampleLimitPerEvent = Math.max(1, Math.floor(params.sampleLimitPerEvent ?? Number.POSITIVE_INFINITY));
  const distinctValueLimitPerProperty =
    params.distinctValueLimitPerProperty === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(1, Math.floor(params.distinctValueLimitPerProperty));

  function addRow(row: RawRow) {
    const columns = Object.keys(row).map((key) => key.trim()).filter(Boolean);
    columns.forEach((column) => observedColumns.add(column));
    if (!detectedEventNameColumn) {
      detectedEventNameColumn = EVENT_NAME_ALIASES.find((alias) => columns.includes(alias)) ?? "";
    }
    if (!detectedEventNameColumn) return;

    const rawEventName = row[detectedEventNameColumn];
    if (!isPresent(rawEventName)) return;
    const displayName = String(rawEventName).trim();
    const eventName = displayName;
    if (expectedEventNames.size > 0 && !expectedEventNames.has(eventName)) return;
    const summary =
      summaries.get(eventName) ??
      {
        eventName,
        displayNames: new Set<string>(),
        properties: new Set<string>(),
        rows: [],
        rowCount: 0,
      };

    summary.displayNames.add(displayName);
    summary.rowCount = (summary.rowCount ?? 0) + 1;
    const shouldKeepRow = Number.isFinite(distinctValueLimitPerProperty)
      ? false
      : summary.rows.length < sampleLimitPerEvent;
    const eventDistinctValues =
      distinctValuesByEvent.get(eventName) ?? new Map<string, Set<string>>();

    const compactRow: RawRow = {};
    for (const [key, value] of Object.entries(row)) {
      const propertyName = key.trim();
      if (!propertyName || propertyName === detectedEventNameColumn || !isPresent(value)) continue;
      if (!keepAllProperties && !expectedProperties.has(propertyName)) continue;
      summary.properties.add(propertyName);
      if (shouldKeepRow) compactRow[propertyName] = value;
      if (Number.isFinite(distinctValueLimitPerProperty)) {
        const normalizedValue = String(value).trim();
        const propertyValues = eventDistinctValues.get(propertyName) ?? new Set<string>();
        if (!propertyValues.has(normalizedValue) && propertyValues.size < distinctValueLimitPerProperty) {
          propertyValues.add(normalizedValue);
          summary.rows.push({ [propertyName]: value });
        }
        eventDistinctValues.set(propertyName, propertyValues);
      }
    }
    distinctValuesByEvent.set(eventName, eventDistinctValues);
    if (shouldKeepRow && Object.keys(compactRow).length > 0) summary.rows.push(compactRow);
    summaries.set(eventName, summary);
  }

  return {
    addRow,
    isComplete() {
      if (expectedEventNames.size === 0) return false;
      return [...expectedEventNames].every((eventName) => (summaries.get(eventName)?.rows.length ?? 0) >= sampleLimitPerEvent);
    },
    getResult() {
      return {
        actualEvents: summaries,
        columns: [...observedColumns],
        eventNameColumn: detectedEventNameColumn,
      };
    },
  };
}

export function serializeActualEventScanResult(params: {
  actualEvents: Map<string, ActualEventSummary>;
  columns: string[];
  eventNameColumn: string;
  rowCount: number;
  eventTestReport?: SerializableActualEventScanResult["eventTestReport"];
}): SerializableActualEventScanResult {
  return {
    columns: params.columns,
    eventNameColumn: params.eventNameColumn,
    rowCount: params.rowCount,
    eventTestReport: params.eventTestReport,
    events: [...params.actualEvents.values()].map((event) => ({
      eventName: event.eventName,
      displayNames: [...event.displayNames],
      properties: [...event.properties],
      rows: event.rows,
      rowCount: event.rowCount,
    })),
  };
}

export function hydrateActualEventScanResult(result: SerializableActualEventScanResult) {
  return {
    columns: result.columns,
    eventNameColumn: result.eventNameColumn,
    rowCount: result.rowCount,
    eventTestReport: result.eventTestReport,
    actualEvents: new Map(
      result.events.map((event) => [
        event.eventName,
        {
          eventName: event.eventName,
          displayNames: new Set(event.displayNames),
          properties: new Set(event.properties),
          rows: event.rows,
          rowCount: event.rowCount,
        },
      ]),
    ) as Map<string, ActualEventSummary>,
  };
}

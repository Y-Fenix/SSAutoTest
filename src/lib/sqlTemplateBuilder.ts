import type { ExpectedEvent } from "./types";

export interface SqlTemplateParams {
  tableName: string;
  userIdColumn: string;
  userIdValue: string;
  startTime: string;
  endTime: string;
  appVersion?: string;
  appVersionColumn: string;
  eventNameColumn: string;
}

function quoteSql(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildSqlTemplate(events: ExpectedEvent[], params: SqlTemplateParams): string {
  const eventNames = [...new Set(events.map((event) => event.eventName).filter(Boolean))];
  const eventList = eventNames.map((eventName) => `    ${quoteSql(eventName)}`).join(",\n");
  const version = params.appVersion?.trim() ?? "";
  const versionFilter = version
    ? `\n  AND ${params.appVersionColumn} = ${quoteSql(version)}`
    : "";

  return `SELECT *
FROM ${params.tableName}
WHERE ${params.userIdColumn} = ${quoteSql(params.userIdValue.trim())}
  AND #event_time >= ${quoteSql(params.startTime)}
  AND #event_time < ${quoteSql(params.endTime)}${versionFilter}
  AND ${params.eventNameColumn} IN (
${eventList}
  )
ORDER BY #event_time ASC;`;
}

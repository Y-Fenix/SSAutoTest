import type { ExpectedEvent, ExpectedProperty, RawRow } from "./types";

const HEADER_ALIASES = {
  eventTag: ["事件标签", "event_tag"],
  eventName: ["事件名", "event_name", "#event_name", "event"],
  triggerDescription: ["点位触发说明", "触发说明", "trigger"],
  propertyName: ["属性名", "property", "property_name"],
  valueType: ["属性值类型", "值类型", "type"],
  propertyDescription: ["属性说明", "property_description"],
  remark1: ["备注1", "规则", "预期规则"],
  remark: ["备注", "notes"],
  testResult: ["测试结果1.0.5", "测试结果", "test_result"],
};

const commonPropertyNameAliases = ["属性名（必填）", "属性名", ""];

function stringValue(row: RawRow, aliases: string[]): string {
  for (const alias of aliases) {
    const value = row[alias];
    if (value !== undefined && value !== null) {
      return String(value).trim();
    }
  }
  return "";
}

function hasAnyUsefulValue(row: RawRow): boolean {
  return Object.entries(row).some(([key, value]) => {
    if (!key.trim()) return false;
    if (value === undefined || value === null) return false;
    return String(value).trim().length > 0;
  });
}

function getHeaders(rows: RawRow[]): string[] {
  return [...new Set(rows.flatMap((row) => Object.keys(row).map((key) => key.trim()).filter(Boolean)))];
}

function hasRecognizedHeader(headers: string[], aliases: string[]): boolean {
  const headerSet = new Set(headers);
  return aliases.some((alias) => headerSet.has(alias));
}

function validateHeaders(rows: RawRow[]) {
  const headers = getHeaders(rows);
  if (headers.length === 0) return;

  const hasEventName = hasRecognizedHeader(headers, HEADER_ALIASES.eventName);
  const hasCommonPropertyName = hasRecognizedHeader(headers, commonPropertyNameAliases);
  if (!hasEventName && !hasCommonPropertyName) {
    throw new Error("无法识别预期埋点表列名：至少需要事件名列。");
  }
}

function makeProperty(row: RawRow): ExpectedProperty | null {
  const propertyName = stringValue(row, HEADER_ALIASES.propertyName);
  if (!propertyName) return null;

  return {
    propertyName,
    valueType: stringValue(row, HEADER_ALIASES.valueType),
    description: stringValue(row, HEADER_ALIASES.propertyDescription),
    propertyDetail: stringValue(row, HEADER_ALIASES.remark1),
    remark: stringValue(row, HEADER_ALIASES.remark),
  };
}

function makeCommonProperty(row: RawRow): ExpectedProperty | null {
  const propertyName = stringValue(row, commonPropertyNameAliases);
  if (!propertyName) return null;

  return {
    propertyName,
    valueType: stringValue(row, ["属性类型（必填）", "属性类型", "属性显示名", "值类型", "type"]),
    description: stringValue(row, ["属性说明", "property_description"]),
    propertyDetail: "",
    remark: stringValue(row, ["上报调整", "备注", "notes"]),
  };
}

export function parseTrackingPlanRows(rows: RawRow[]): ExpectedEvent[] {
  validateHeaders(rows);

  const events: ExpectedEvent[] = [];
  const commonProperties: ExpectedProperty[] = [];
  let currentEvent: ExpectedEvent | null = null;

  for (const row of rows) {
    if (!hasAnyUsefulValue(row)) continue;

    if (stringValue(row, ["属性名（必填）"])) {
      const commonProperty = makeCommonProperty(row);
      if (commonProperty) commonProperties.push(commonProperty);
      continue;
    }

    const eventName = stringValue(row, HEADER_ALIASES.eventName);
    if (eventName) {
      currentEvent = {
        eventTag: stringValue(row, HEADER_ALIASES.eventTag),
        eventName,
        triggerDescription: stringValue(row, HEADER_ALIASES.triggerDescription),
        properties: [],
        notes: [stringValue(row, HEADER_ALIASES.remark1), stringValue(row, HEADER_ALIASES.remark)]
          .filter(Boolean)
          .join(" / "),
        testResult: stringValue(row, HEADER_ALIASES.testResult),
      };
      events.push(currentEvent);
    }

    if (!eventName && !currentEvent) {
      const commonProperty = makeCommonProperty(row);
      if (commonProperty) commonProperties.push(commonProperty);
      continue;
    }

    const property = makeProperty(row);
    if (property && currentEvent) {
      currentEvent.properties.push(property);
    }
  }

  if (commonProperties.length > 0) {
    events.push({
      eventTag: "",
      eventName: "公共事件属性",
      triggerDescription: "",
      properties: commonProperties,
      notes: "",
      testResult: "",
      isCommonProperties: true,
    });
  }

  return events;
}

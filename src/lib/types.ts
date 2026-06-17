export type RawRow = Record<string, string | number | boolean | null | undefined>;

export interface ExpectedProperty {
  propertyName: string;
  valueType: string;
  description: string;
  propertyDetail: string;
  remark: string;
}

export interface ExpectedEvent {
  eventTag: string;
  eventName: string;
  triggerDescription: string;
  properties: ExpectedProperty[];
  notes: string;
  testResult: string;
  isCommonProperties?: boolean;
}

export interface ActualEventSummary {
  eventName: string;
  displayNames: Set<string>;
  properties: Set<string>;
  rows: RawRow[];
}

export type CoverageStatus = "已覆盖" | "属性缺失" | "事件缺失" | "属性值异常";

export interface ValueIssue {
  propertyName: string;
  expectedValues: string[];
  actualValues: string[];
}

export interface CoverageResult {
  eventTag: string;
  eventName: string;
  matchedEventNames: string[];
  triggerDescription: string;
  expectedProperties: string[];
  coveredProperties: string[];
  missingProperties: string[];
  propertyDetails: Record<string, string>;
  valueIssues: ValueIssue[];
  status: CoverageStatus;
  triggerCount: number | null;
  notes: string;
}

export interface CoverageSummary {
  totalEvents: number;
  coveredEvents: number;
  missingEvents: number;
  propertyMissingEvents: number;
  valueIssueEvents: number;
  totalProperties: number;
  coveredProperties: number;
  missingProperties: number;
  eventCoverageRate: number;
  propertyCoverageRate: number;
}

export interface CoverageReport {
  results: CoverageResult[];
  summary: CoverageSummary;
  extraEvents: string[];
}

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

export type CoverageStatus = "测试通过" | "属性缺失" | "详情缺失" | "事件缺失";

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
  detailCoveredProperties: string[];
  detailMissingProperties: string[];
  passedProperties: string[];
  propertyDetails: Record<string, string>;
  valueIssues: ValueIssue[];
  status: CoverageStatus;
  triggerCount: number | null;
  passRate: number;
  notes: string;
}

export interface CoverageSummary {
  totalEvents: number;
  coveredEvents: number;
  missingEvents: number;
  propertyMissingEvents: number;
  detailMissingEvents: number;
  totalProperties: number;
  coveredProperties: number;
  missingProperties: number;
  totalDetailProperties: number;
  coveredDetailProperties: number;
  missingDetailProperties: number;
  eventCoverageRate: number;
  propertyCoverageRate: number;
  detailCoverageRate: number;
}

export interface CoverageReport {
  results: CoverageResult[];
  summary: CoverageSummary;
  extraEvents: string[];
}

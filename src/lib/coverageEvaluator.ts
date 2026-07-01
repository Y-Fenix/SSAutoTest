import type { ActualEventSummary, CoverageReport, CoverageResult, ExpectedEvent } from "./types";

function getActualPropertyCandidates(eventName: string, propertyName: string): string[] {
  if (eventName === "common_ad_event" && propertyName === "scene") {
    return ["scene", "scence", "reward_scene"];
  }
  return [propertyName];
}

function hasAnyNonEmptyValue(actual: ActualEventSummary, propertyName: string): boolean {
  const candidates = getActualPropertyCandidates(actual.eventName, propertyName);
  return actual.rows.some((row) => {
    return candidates.some((candidate) => {
      const value = row[candidate];
      return value !== undefined && value !== null && String(value).trim().length > 0;
    });
  });
}

function normalizeDetailValue(value: string): string {
  return value.trim().toLowerCase();
}

function splitExpectedDetails(detail: string): string[] {
  return detail
    .split(/[\n\r,，;；、]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function matchesRule(value: string, rule: string): boolean {
  const normalizedValue = value.trim();
  const normalizedRule = rule.trim().toLowerCase();
  if (!normalizedRule) return true;
  if (normalizedRule === "string") return normalizedValue.length > 0;
  if (normalizedRule === "string_or_empty") return true;
  if (normalizedRule === "url_string") return /^https?:\/\//i.test(normalizedValue) || normalizedValue.includes(".");
  if (normalizedRule === "number>=0") {
    const numberValue = Number(normalizedValue);
    return Number.isFinite(numberValue) && numberValue >= 0;
  }
  if (normalizedRule === "int>=0") {
    const numberValue = Number(normalizedValue);
    return Number.isInteger(numberValue) && numberValue >= 0;
  }
  if (normalizedRule === "int") return Number.isInteger(Number(normalizedValue));
  if (normalizedRule === "float" || normalizedRule === "number") return Number.isFinite(Number(normalizedValue));
  if (normalizedRule.includes("<int>")) return normalizedValue.length > 0;
  if (normalizedRule.includes("<tag>") || normalizedRule.includes("<eventname>")) return normalizedValue.length > 0;
  return false;
}

function hasExpectedDetailValue(actual: ActualEventSummary, propertyName: string, expectedDetail: string): boolean {
  return getCoveredDetailItems(actual, propertyName, expectedDetail).length > 0;
}

function isGenericDetailRule(rule: string): boolean {
  const normalizedRule = rule.trim().toLowerCase();
  return [
    "string",
    "string_or_empty",
    "url_string",
    "number>=0",
    "int>=0",
    "int",
    "float",
    "number",
  ].includes(normalizedRule) || normalizedRule.includes("<int>") || normalizedRule.includes("<tag>") || normalizedRule.includes("<eventname>");
}

function getCoveredDetailValues(actual: ActualEventSummary, propertyName: string, expectedDetail: string): string[] {
  const expectedItems = splitExpectedDetails(expectedDetail);
  if (expectedItems.length === 0) return [];

  const candidates = getActualPropertyCandidates(actual.eventName, propertyName);
  const values = new Set<string>();
  actual.rows.forEach((row) => {
    candidates.forEach((candidate) => {
      const rawValue = row[candidate];
      if (rawValue === undefined || rawValue === null) return;
      const actualValue = String(rawValue).trim();
      if (!actualValue) return;
      const normalizedActual = normalizeDetailValue(actualValue);
      const isMatched = expectedItems.some((expectedItem) => {
        if (matchesRule(actualValue, expectedItem)) return true;
        return normalizeDetailValue(expectedItem) === normalizedActual;
      });
      if (isMatched) values.add(actualValue);
    });
  });
  return [...values].sort((a, b) => a.localeCompare(b));
}

function getCoveredDetailItems(actual: ActualEventSummary, propertyName: string, expectedDetail: string): string[] {
  const expectedItems = splitExpectedDetails(expectedDetail);
  if (expectedItems.length === 0) return [];

  const candidates = getActualPropertyCandidates(actual.eventName, propertyName);
  return expectedItems.filter((expectedItem) =>
    actual.rows.some((row) =>
      candidates.some((candidate) => {
        const rawValue = row[candidate];
        if (rawValue === undefined || rawValue === null) return false;
        const actualValue = String(rawValue).trim();
        if (!actualValue) return false;
        if (matchesRule(actualValue, expectedItem)) return true;
        return normalizeDetailValue(expectedItem) === normalizeDetailValue(actualValue);
      }),
    ),
  );
}

function makePassRate(passedProperties: string[], expectedProperties: string[]): number {
  if (expectedProperties.length === 0) return 1;
  return passedProperties.length / expectedProperties.length;
}

export function evaluateCoverage(
  expectedEvents: ExpectedEvent[],
  actualEvents: Map<string, ActualEventSummary>,
): CoverageReport {
  const results: CoverageResult[] = expectedEvents.map((event) => {
    if (event.isCommonProperties) {
      const expectedProperties = event.properties.map((property) => property.propertyName);
      const missingCommonProperties = expectedProperties
        .map((propertyName) => ({
          propertyName,
          eventNames: [...actualEvents.values()]
            .filter((actual) => !hasAnyNonEmptyValue(actual, propertyName))
            .map((actual) => actual.eventName)
            .sort((a, b) => a.localeCompare(b)),
        }))
        .filter((item) => item.eventNames.length > 0);
      const missingProperties = missingCommonProperties.map(
        (item) => `${item.propertyName}：${item.eventNames.join("、")}`,
      );
      const uncoveredCommonProperties = new Set(
        missingCommonProperties.map((item) => item.propertyName),
      );
      const coveredProperties = expectedProperties.filter(
        (propertyName) => !uncoveredCommonProperties.has(propertyName),
      );
      const passRate = makePassRate(coveredProperties, expectedProperties);

      return {
        eventTag: event.eventTag,
        eventName: event.eventName,
        matchedEventNames: [],
        triggerDescription: event.triggerDescription,
        expectedProperties,
        coveredProperties,
        missingProperties,
        detailCoveredProperties: [],
        detailMissingProperties: [],
        passedProperties: coveredProperties,
        propertyDetails: {},
        propertyDetailItems: {},
        coveredDetails: {},
        coveredDetailItems: {},
        valueIssues: [],
        status: missingProperties.length > 0 ? "属性缺失" : "测试通过",
        triggerCount: null,
        passRate,
        notes: event.notes,
      };
    }

    const actual = actualEvents.get(event.eventName);
    const expectedProperties = event.properties.map((property) => property.propertyName);
    const propertyDetails = Object.fromEntries(
      event.properties.map((property) => [property.propertyName, property.propertyDetail]),
    );
    const propertyDetailItems = Object.fromEntries(
      event.properties.map((property) => [property.propertyName, splitExpectedDetails(property.propertyDetail)]),
    );

    if (!actual) {
      return {
        eventTag: event.eventTag,
        eventName: event.eventName,
        matchedEventNames: [],
        triggerDescription: event.triggerDescription,
        expectedProperties,
        coveredProperties: [],
        missingProperties: expectedProperties,
        detailCoveredProperties: [],
        detailMissingProperties: [],
        passedProperties: [],
        propertyDetails,
        propertyDetailItems,
        coveredDetails: {},
        coveredDetailItems: {},
        valueIssues: [],
        status: "事件缺失",
        triggerCount: null,
        passRate: 0,
        notes: event.notes,
      };
    }

    const coveredProperties = expectedProperties.filter((propertyName) => hasAnyNonEmptyValue(actual, propertyName));
    const missingProperties = expectedProperties.filter((propertyName) => !hasAnyNonEmptyValue(actual, propertyName));
    const propertiesWithDetails = event.properties.filter((property) => property.propertyDetail.trim());
    const detailCoveredProperties = propertiesWithDetails
      .filter((property) => hasExpectedDetailValue(actual, property.propertyName, property.propertyDetail))
      .map((property) => property.propertyName);
    const detailMissingProperties = propertiesWithDetails
      .filter((property) => !hasExpectedDetailValue(actual, property.propertyName, property.propertyDetail))
      .map((property) => property.propertyName);
    const coveredDetails = Object.fromEntries(
      propertiesWithDetails.map((property) => [
        property.propertyName,
        getCoveredDetailValues(actual, property.propertyName, property.propertyDetail),
      ]),
    );
    const coveredDetailItems = Object.fromEntries(
      propertiesWithDetails.map((property) => [
        property.propertyName,
        getCoveredDetailItems(actual, property.propertyName, property.propertyDetail),
      ]),
    );
    const passedProperties = expectedProperties.filter(
      (propertyName) => coveredProperties.includes(propertyName) && !detailMissingProperties.includes(propertyName),
    );
    const status =
      missingProperties.length > 0 ? "属性缺失" : detailMissingProperties.length > 0 ? "详情缺失" : "测试通过";

    return {
      eventTag: event.eventTag,
      eventName: event.eventName,
      matchedEventNames: [...actual.displayNames].filter((name) => name !== event.eventName),
      triggerDescription: event.triggerDescription,
      expectedProperties,
      coveredProperties,
      missingProperties,
      detailCoveredProperties,
      detailMissingProperties,
      passedProperties,
      propertyDetails,
      propertyDetailItems,
      coveredDetails,
      coveredDetailItems,
      valueIssues: [],
      status,
      triggerCount: actual.rowCount ?? actual.rows.length,
      passRate: makePassRate(passedProperties, expectedProperties),
      notes: event.notes,
    };
  });

  const totalProperties = results.reduce(
    (sum, result) => sum + result.expectedProperties.length,
    0,
  );
  const coveredProperties = results.reduce(
    (sum, result) => sum + result.coveredProperties.length,
    0,
  );
  const expectedEventNames = new Set(expectedEvents.map((event) => event.eventName));
  const missingEventCount = results.filter((result) => result.status === "事件缺失").length;
  const coveredEventCount = results.length - missingEventCount;
  const totalDetailProperties = results.reduce(
    (sum, result) => sum + Object.values(result.propertyDetailItems).reduce(
      (itemSum, items) => itemSum + items.length,
      0,
    ),
    0,
  );
  const coveredDetailProperties = results.reduce(
    (sum, result) => sum + Object.values(result.coveredDetailItems).reduce(
      (itemSum, items) => itemSum + items.length,
      0,
    ),
    0,
  );
  const missingDetailProperties = totalDetailProperties - coveredDetailProperties;

  return {
    results,
    summary: {
      totalEvents: results.length,
      coveredEvents: coveredEventCount,
      missingEvents: missingEventCount,
      propertyMissingEvents: results.filter((result) => result.status === "属性缺失").length,
      detailMissingEvents: missingDetailProperties,
      totalProperties,
      coveredProperties,
      missingProperties: totalProperties - coveredProperties,
      totalDetailProperties,
      coveredDetailProperties,
      missingDetailProperties,
      eventCoverageRate: results.length === 0 ? 0 : coveredEventCount / results.length,
      propertyCoverageRate: totalProperties === 0 ? 1 : coveredProperties / totalProperties,
      detailCoverageRate: totalDetailProperties === 0 ? 1 : coveredDetailProperties / totalDetailProperties,
    },
    extraEvents: [...actualEvents.keys()]
      .filter((eventName) => !expectedEventNames.has(eventName))
      .sort((a, b) => a.localeCompare(b)),
  };
}

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

      return {
        eventTag: event.eventTag,
        eventName: event.eventName,
        matchedEventNames: [],
        triggerDescription: event.triggerDescription,
        expectedProperties,
        coveredProperties,
        missingProperties,
        propertyDetails: {},
        valueIssues: [],
        status: missingProperties.length > 0 ? "属性缺失" : "已覆盖",
        triggerCount: null,
        notes: event.notes,
      };
    }

    const actual = actualEvents.get(event.eventName);
    const expectedProperties = event.properties.map((property) => property.propertyName);
    const propertyDetails = Object.fromEntries(
      event.properties.map((property) => [property.propertyName, property.propertyDetail]),
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
        propertyDetails,
        valueIssues: [],
        status: "事件缺失",
        triggerCount: null,
        notes: event.notes,
      };
    }

    const coveredProperties = expectedProperties.filter((propertyName) => hasAnyNonEmptyValue(actual, propertyName));
    const missingProperties = expectedProperties.filter((propertyName) => !hasAnyNonEmptyValue(actual, propertyName));

    return {
      eventTag: event.eventTag,
      eventName: event.eventName,
      matchedEventNames: [...actual.displayNames].filter((name) => name !== event.eventName),
      triggerDescription: event.triggerDescription,
      expectedProperties,
      coveredProperties,
      missingProperties,
      propertyDetails,
      valueIssues: [],
      status: missingProperties.length > 0 ? "属性缺失" : "已覆盖",
      triggerCount: actual.rows.length,
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
  const coveredEventCount = results.filter((result) => result.status === "已覆盖").length;

  return {
    results,
    summary: {
      totalEvents: results.length,
      coveredEvents: coveredEventCount,
      missingEvents: results.filter((result) => result.status === "事件缺失").length,
      propertyMissingEvents: results.filter((result) => result.status === "属性缺失").length,
      valueIssueEvents: results.filter((result) => result.status === "属性值异常").length,
      totalProperties,
      coveredProperties,
      missingProperties: totalProperties - coveredProperties,
      eventCoverageRate: results.length === 0 ? 0 : coveredEventCount / results.length,
      propertyCoverageRate: totalProperties === 0 ? 1 : coveredProperties / totalProperties,
    },
    extraEvents: [...actualEvents.keys()]
      .filter((eventName) => !expectedEventNames.has(eventName))
      .sort((a, b) => a.localeCompare(b)),
  };
}

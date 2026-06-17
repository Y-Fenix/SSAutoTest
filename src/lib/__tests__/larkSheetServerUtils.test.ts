import { describe, expect, it } from "vitest";
import { extractSheets, rowsFromValues, toSheetTabs } from "../larkSheetServerUtils";

describe("larkSheetServerUtils", () => {
  it("extracts sheets from the nested lark-cli info response", () => {
    const sheets = extractSheets({
      data: {
        sheets: {
          sheets: [
            { sheet_id: "f364af", title: "#事件数据", index: 0 },
            { sheet_id: "3prnsq", title: "广告&支付事件-SDK", index: 1 },
          ],
        },
      },
    });

    expect(toSheetTabs(sheets)).toEqual([
      { id: "f364af", title: "#事件数据", index: 0 },
      { id: "3prnsq", title: "广告&支付事件-SDK", index: 1 },
    ]);
  });

  it("turns read values into raw rows", () => {
    expect(
      rowsFromValues([
        ["事件名", "属性名"],
        ["common_ad_event", "ad_type"],
      ]),
    ).toEqual([{ "事件名": "common_ad_event", "属性名": "ad_type" }]);
  });
});

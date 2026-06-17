import { afterEach, describe, expect, it, vi } from "vitest";
import { listLarkSheetTabs, readLarkSheetRows } from "../larkSheetClient";

describe("larkSheetClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists sheet tabs from the local lark sheet API", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ tabs: [{ id: "3prnsq", title: "广告&支付事件-SDK", index: 1 }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listLarkSheetTabs("https://example.feishu.cn/wiki/wikxxx?sheet=3prnsq")).resolves.toEqual([
      { id: "3prnsq", title: "广告&支付事件-SDK", index: 1 },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/lark-sheet",
      expect.objectContaining({
        body: JSON.stringify({ action: "list", url: "https://example.feishu.cn/wiki/wikxxx?sheet=3prnsq" }),
      }),
    );
  });

  it("returns rows from the local lark sheet API", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ rows: [{ "事件名": "common_ad_event" }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(readLarkSheetRows("https://example.feishu.cn/sheets/shtxxx", ["f364af", "3prnsq"])).resolves.toEqual([
      { "事件名": "common_ad_event" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/lark-sheet",
      expect.objectContaining({
        body: JSON.stringify({
          action: "read",
          url: "https://example.feishu.cn/sheets/shtxxx",
          sheetIds: ["f364af", "3prnsq"],
        }),
      }),
    );
  });

  it("throws the API error message when reading fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ error: "Permission denied" }),
      })),
    );

    await expect(readLarkSheetRows("https://example.feishu.cn/sheets/shtxxx", ["f364af"])).rejects.toThrow(
      "Permission denied",
    );
  });
});

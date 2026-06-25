import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { listWorkbookSheets, readWorkbookSheets, readTabularFile } from "../fileReaders";

describe("readTabularFile", () => {
  it("reads and merges the first two Excel sheets only", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([{ "事件名": "event_a", "属性名": "prop_a" }]),
      "first",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([{ "事件名": "event_b", "属性名": "prop_b" }]),
      "second",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([{ "事件名": "event_c", "属性名": "prop_c" }]),
      "third",
    );

    const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const file = new File([buffer], "tracking.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const rows = await readTabularFile(file);

    expect(rows.map((row) => row["事件名"])).toEqual(["event_a", "event_b"]);
  });

  it("lists workbook sheets and reads selected sheets", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ "事件名": "event_a" }]), "first");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ "事件名": "event_b" }]), "second");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ "事件名": "event_c" }]), "third");
    const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const file = new File([buffer], "tracking.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    await expect(listWorkbookSheets(file)).resolves.toEqual([
      { id: "first", title: "first", index: 0 },
      { id: "second", title: "second", index: 1 },
      { id: "third", title: "third", index: 2 },
    ]);
    await expect(readWorkbookSheets(file, ["second", "third"])).resolves.toEqual([
      { "事件名": "event_b" },
      { "事件名": "event_c" },
    ]);
  });
});

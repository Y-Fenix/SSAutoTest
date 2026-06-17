import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { readTabularFile } from "../fileReaders";

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

});

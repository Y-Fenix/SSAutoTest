import react from "@vitejs/plugin-react";
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { defineConfig, type Plugin } from "vite";
import { extractSheets, extractValues, rowsFromValues, toSheetTabs } from "./src/lib/larkSheetServerUtils";

const execFileAsync = promisify(execFile);
let larkCliPathCache: string | null = null;

async function canAccess(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveLarkCliPath(): Promise<string> {
  if (larkCliPathCache) return larkCliPathCache;

  const pathDirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const candidates = [
    process.env.LARK_CLI_PATH,
    ...pathDirs.map((dir) => path.join(dir, "lark-cli")),
    path.join(homedir(), ".local/bin/lark-cli"),
    path.join(homedir(), ".npm-global/bin/lark-cli"),
    "/opt/homebrew/bin/lark-cli",
    "/usr/local/bin/lark-cli",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (await canAccess(candidate)) {
      larkCliPathCache = candidate;
      return candidate;
    }
  }

  throw new Error("未检测到 lark-cli。请先安装并登录飞书 CLI，或把 lark-cli 加入 PATH 后重启局域网常驻服务。");
}

async function execLarkCli(args: string[], options: { maxBuffer: number }) {
  const larkCliPath = await resolveLarkCliPath();
  return execFileAsync(larkCliPath, args, {
    ...options,
    env: {
      ...process.env,
      PATH: [
        path.join(homedir(), ".local/bin"),
        path.join(homedir(), ".npm-global/bin"),
        "/opt/homebrew/bin",
        "/usr/local/bin",
        process.env.PATH ?? "",
      ].join(path.delimiter),
    },
  });
}

function friendlyLarkError(error: unknown): string {
  const raw =
    error instanceof Error
      ? `${error.message}${"stderr" in error ? ` ${(error as { stderr?: string }).stderr ?? ""}` : ""}`
      : String(error);
  if (raw.includes("wiki:node:read")) {
    return '飞书 wiki 链接需要授权 wiki 读取权限，请在终端运行：lark-cli auth login --scope "wiki:node:read"';
  }
  if (raw.includes("sheets:spreadsheet:read")) {
    return '飞书表格需要授权电子表格读取权限，请在终端运行：lark-cli auth login --scope "sheets:spreadsheet:read"';
  }
  if (raw.includes("need_user_authorization") || raw.includes("missing_scope")) {
    return `飞书 CLI 授权不足，请按 lark-cli 提示补充 scope 后重试。原始错误：${raw}`;
  }
  if (raw.includes("未检测到 lark-cli") || raw.includes("ENOENT")) {
    return "未检测到 lark-cli。请先安装并登录飞书 CLI；如果已经安装，请重启局域网常驻服务。";
  }
  return raw;
}

function wikiTokenFromUrl(url: string): string | null {
  return url.match(/\/wiki\/([^/?#]+)/)?.[1] ?? null;
}

async function resolveSheetUrlOrToken(url: string): Promise<{ url?: string; spreadsheetToken?: string }> {
  const wikiToken = wikiTokenFromUrl(url);
  if (!wikiToken) return { url };

  const node = await execLarkCli(
    ["wiki", "spaces", "get_node", "--params", JSON.stringify({ token: wikiToken }), "--as", "user"],
    { maxBuffer: 1024 * 1024 * 8 },
  );
  const payload = JSON.parse(node.stdout) as {
    node?: { obj_type?: string; obj_token?: string };
    data?: { node?: { obj_type?: string; obj_token?: string } };
  };
  const resolvedNode = payload.node ?? payload.data?.node;
  if (resolvedNode?.obj_type !== "sheet" || !resolvedNode.obj_token) {
    throw new Error("该 wiki 链接不是飞书电子表格。");
  }
  return { spreadsheetToken: resolvedNode.obj_token };
}

function registerLarkSheetApi(middlewares: {
  use: (route: string, handler: (req: any, res: any) => void) => void;
}) {
  middlewares.use("/api/lark-sheet", async (req, res) => {
    try {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const { action = "read", url, sheetIds } = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        action?: "list" | "read";
        url?: string;
        sheetIds?: string[];
      };
      if (!url?.trim()) throw new Error("请填写飞书表格链接。");

      const target = await resolveSheetUrlOrToken(url.trim());
      const targetArgs = target.spreadsheetToken
        ? ["--spreadsheet-token", target.spreadsheetToken]
        : ["--url", target.url ?? url.trim()];
      const info = await execLarkCli(["sheets", "+info", ...targetArgs, "--as", "user"], {
        maxBuffer: 1024 * 1024 * 8,
      });
      const infoJson = JSON.parse(info.stdout);
      const tabs = toSheetTabs(extractSheets(infoJson));
      if (tabs.length === 0) throw new Error("未读取到飞书表格页签。");

      if (action === "list") {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ tabs }));
        return;
      }

      const selectedSheetIds = Array.isArray(sheetIds) && sheetIds.length > 0 ? sheetIds : tabs.slice(0, 2).map((tab) => tab.id);
      const selectedTabs = tabs.filter((tab) => selectedSheetIds.includes(tab.id));
      if (selectedTabs.length === 0) throw new Error("请至少选择一个有效页签。");

      const rows: Record<string, string | number | boolean | null | undefined>[] = [];
      for (const sheet of selectedTabs) {
        const read = await execLarkCli(
          [
            "sheets",
            "+read",
            ...targetArgs,
            "--sheet-id",
            sheet.id,
            "--range",
            "A1:Z1000",
            "--value-render-option",
            "ToString",
            "--as",
            "user",
          ],
          { maxBuffer: 1024 * 1024 * 16 },
        );
        rows.push(...rowsFromValues(extractValues(JSON.parse(read.stdout))));
      }

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ rows, sheetCount: selectedTabs.length }));
    } catch (error) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: friendlyLarkError(error) }));
    }
  });
}

function larkSheetPlugin(): Plugin {
  return {
    name: "lark-sheet-api",
    configureServer(server) {
      registerLarkSheetApi(server.middlewares);
    },
    configurePreviewServer(server) {
      registerLarkSheetApi(server.middlewares);
    },
  };
}

export default defineConfig({
  plugins: [react(), larkSheetPlugin()],
});

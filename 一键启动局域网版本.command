#!/bin/zsh
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_LABEL="com.yfenix.ssautotest.lan"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/${SERVICE_LABEL}.plist"
START_SCRIPT="$PROJECT_DIR/scripts/start-lan-service.sh"
SERVICE_PROJECT_LINK="$HOME/.ssautotest-lan"
LOG_DIR="$HOME/Library/Logs/SSAutoTest"

xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  value="${value//\"/&quot;}"
  printf "%s" "$value"
}

echo "======================================"
echo "SSAutoTest 局域网常驻服务"
echo "======================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js。请先安装 Node.js 20+：https://nodejs.org/"
  echo ""
  read "?按回车关闭窗口..."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "未检测到 npm。请检查 Node.js 安装是否完整。"
  echo ""
  read "?按回车关闭窗口..."
  exit 1
fi

NODE_BIN="$(command -v node)"

echo "Node 版本：$(node -v)"
echo "npm 版本：$(npm -v)"
echo ""

cd "$PROJECT_DIR"
mkdir -p "$PLIST_DIR" "$LOG_DIR"
chmod +x "$START_SCRIPT"
rm -f "$SERVICE_PROJECT_LINK"
ln -s "$PROJECT_DIR" "$SERVICE_PROJECT_LINK"
VITE_BIN="$SERVICE_PROJECT_LINK/node_modules/vite/bin/vite.js"
NODE_BIN_XML="$(xml_escape "$NODE_BIN")"
VITE_BIN_XML="$(xml_escape "$VITE_BIN")"
SERVICE_PROJECT_LINK_XML="$(xml_escape "$SERVICE_PROJECT_LINK")"
LOG_DIR_XML="$(xml_escape "$LOG_DIR")"

if [ ! -d "node_modules" ]; then
  echo "首次启动：正在安装依赖..."
  npm ci
  echo ""
fi

echo "正在构建..."
npm run build
echo ""

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN_XML}</string>
    <string>${VITE_BIN_XML}</string>
    <string>preview</string>
    <string>--host</string>
    <string>0.0.0.0</string>
    <string>--port</string>
    <string>5173</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${SERVICE_PROJECT_LINK_XML}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR_XML}/lan-service.out.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR_XML}/lan-service.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl kickstart -k "gui/$(id -u)/${SERVICE_LABEL}"

IP_ADDRESS="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"

echo "常驻服务已安装并启动。"
echo "关闭这个终端窗口后服务仍会继续运行。"
echo "以后登录 macOS 会自动启动。"
echo ""
if [ -n "$IP_ADDRESS" ]; then
  echo "局域网访问地址：http://${IP_ADDRESS}:5173/"
else
  echo "请在终端运行 ipconfig getifaddr en0 查询局域网 IP，然后访问：http://局域网IP:5173/"
fi
echo ""
echo "日志目录：${LOG_DIR}"
echo "如需停止常驻服务，请双击：停止局域网常驻服务.command"
echo ""
read "?按回车关闭窗口..."

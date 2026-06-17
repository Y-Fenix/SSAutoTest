#!/bin/zsh
set -e

SERVICE_LABEL="com.yfenix.ssautotest.lan"
PLIST_PATH="$HOME/Library/LaunchAgents/${SERVICE_LABEL}.plist"

echo "======================================"
echo "停止 SSAutoTest 局域网常驻服务"
echo "======================================"
echo ""

if [ -f "$PLIST_PATH" ]; then
  launchctl bootout "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || true
  rm -f "$PLIST_PATH"
  echo "已停止并移除开机自启服务。"
else
  echo "未发现已安装的常驻服务。"
fi

echo ""
read "?按回车关闭窗口..."

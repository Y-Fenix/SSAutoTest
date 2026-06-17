#!/bin/zsh
set -e

cd "$(dirname "$0")"

echo "======================================"
echo "SSAutoTest 埋点覆盖核对工具"
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

echo "Node 版本：$(node -v)"
echo "npm 版本：$(npm -v)"
echo ""

if [ ! -d "node_modules" ]; then
  echo "首次启动：正在安装依赖..."
  npm ci
  echo ""
fi

echo "正在构建..."
npm run build
echo ""

echo "正在启动局域网服务..."
echo "启动后请把终端里显示的 Network 地址发给同事，例如：http://192.168.x.x:5173/"
echo "关闭这个窗口会停止服务。"
echo ""

npm run preview:lan

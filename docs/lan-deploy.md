# 局域网常驻访问

## 推荐启动方式

双击项目根目录：

- `一键启动局域网版本.command`

它会安装 macOS 用户级常驻服务：

- 关闭终端窗口后服务仍会继续运行。
- 以后登录 macOS 会自动启动。
- 日志输出到 `~/Library/Logs/SSAutoTest/` 目录。

说明：这是 macOS 用户级 LaunchAgent，会在当前用户登录后自动启动；如果电脑刚开机但还没有登录用户，它不会在登录前运行。

停止常驻服务：

- 双击 `停止局域网常驻服务.command`

## 手动启动方式

临时局域网启动：

```bash
npm run build
npm run preview:lan
```

这种方式关闭终端后服务会停止。

## 分享链接

查询本机局域网 IP：

```bash
ipconfig getifaddr en0
```

同事访问：

```text
http://你的局域网IP:5173/
```

例如：

```text
http://192.168.1.23:5173/
```

## 注意事项

- 你的电脑需要和同事在同一个局域网。
- 飞书读取仍使用你这台电脑上的 `lark-cli` 登录态。
- 如果 macOS 弹出网络访问权限，需要允许 Node/Vite 接收局域网连接。

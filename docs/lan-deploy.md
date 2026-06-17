# 局域网常驻访问

## 启动方式

开发态常驻：

```bash
npm run dev:lan
```

构建后常驻：

```bash
npm run build
npm run preview:lan
```

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

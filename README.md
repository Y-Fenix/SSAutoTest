# SSAutoTest

埋点覆盖核对工具，用于读取飞书预期埋点表和实际 SQL 导出 CSV/Excel，对比事件、属性覆盖情况，并输出可视化明细。

## 功能

- 读取飞书表格页签，默认选择前 3 个页签。
- 上传实际 SQL 导出 CSV/Excel。
- 自动识别 `#event_name` 事件名列。
- 检查事件缺失、属性缺失、公共事件属性缺失。
- 统计每个事件触发次数。
- 支持导出核对结果 CSV。
- 支持局域网访问，方便团队共享。

## 本机启动

```bash
npm ci
npm run dev
```

## 局域网启动

```bash
npm ci
npm run build
npm run preview:lan
```

启动后终端会输出：

```text
Network: http://局域网IP:5173/
```

同事在同一局域网内访问该地址即可。

## 飞书读取

飞书链接读取依赖当前电脑的 `lark-cli` 登录态。

```bash
lark-cli auth login
```

如果读取 Wiki/表格时报权限问题，请按页面提示补充对应 scope。

## 验证

```bash
npm test
npm run build
```

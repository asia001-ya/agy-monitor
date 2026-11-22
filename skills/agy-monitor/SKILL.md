---
name: agy-monitor
description: >-
  当用户询问查看当前 Antigravity CLI (agy) 各模型 5 小时/周限额用量、上下文占用、当前项目快照，
  或希望切换 agy-monitor 状态栏显示模式（compact/minimal/detailed）、调整进度条/配额显示口径、
  以及诊断状态栏插件运行异常时激活此技能。
---

# AGY 用量与状态监控插件 (`agy-monitor`)

本技能用于配合 `agy-monitor` 状态栏插件，快速查看最新实时监控快照、调整底部状态栏排版与配色，或执行环境自检。

## 常用操作指引

所有命令均在插件根目录（全局安装路径 `~/.gemini/config/plugins/agy-monitor` 或本地开发目录）通过 Node.js 执行：

1. **查看当前实时用量快照（各模型 5h / 周限额、上下文、当前项目）**
   ```bash
   node ~/.gemini/config/plugins/agy-monitor/bin/agy-monitor.mjs inspect
   ```
   如需排查 agy 新版本新增的配额字段，可追加 `--raw` 查看原始 JSON：
   ```bash
   node ~/.gemini/config/plugins/agy-monitor/bin/agy-monitor.mjs inspect --raw
   ```

2. **切换状态栏显示模式**
   - 两行紧凑仪表盘（默认）：
     `node ~/.gemini/config/plugins/agy-monitor/bin/agy-monitor.mjs mode compact`
   - 单行极简模式（适合窄终端）：
     `node ~/.gemini/config/plugins/agy-monitor/bin/agy-monitor.mjs mode minimal`
   - 多行详细看板模式（按模型分行、显示精确重置时刻与缓存/费用）：
     `node ~/.gemini/config/plugins/agy-monitor/bin/agy-monitor.mjs mode detailed`

3. **自定义显示偏好**
   - 将配额显示口径切换为「已用百分比」或「剩余百分比」：
     `node ~/.gemini/config/plugins/agy-monitor/bin/agy-monitor.mjs config quotaDisplay=used`
     `node ~/.gemini/config/plugins/agy-monitor/bin/agy-monitor.mjs config quotaDisplay=remaining`
   - 切换进度条字符风格（默认 `square` 垂直居中实心方格，可选 `para` / `vbar` / `seg` / `line` / `half` / `dots` / `unicode` / `ascii`）或色彩方案（`truecolor` / `ansi`）：
     `node ~/.gemini/config/plugins/agy-monitor/bin/agy-monitor.mjs config barStyle=para`
     `node ~/.gemini/config/plugins/agy-monitor/bin/agy-monitor.mjs config colorProfile=ansi`

4. **模拟预览与健康诊断**
   - 模拟渲染检查效果：
     `node ~/.gemini/config/plugins/agy-monitor/bin/agy-monitor.mjs preview --mode compact --width 110`
   - 诊断运行环境与端到端渲染耗时：
     `node ~/.gemini/config/plugins/agy-monitor/bin/agy-monitor.mjs doctor`

# agy-monitor — Antigravity CLI (`agy`) 实时监控状态栏插件

`agy-monitor` 是一款专为 **Antigravity CLI (`agy`)** 打造的**零依赖**实时状态栏插件（无需 `npm install`，毫秒级渲染、零额外 Token 消耗），开箱即用，支持 Windows / macOS / Linux 跨平台一键部署。

---

## 核心特性

- **多模型 5h & 周限额监控**：自动聚合 Gemini、3P、Claude、GPT 等模型族的 **5 小时滚动窗口**与**周限额**，垂直居中实心进度条（`■`）+ 柔和语义色 + 重置倒计时。
- **上下文占用 + Token 消耗 + 实时 `tok/s`**：实时展示上下文窗口占用率、Token 用量比、会话累计输入/输出 Token（`↑入 ↓出`）以及实时生成吞吐速率（`tok/s`，空闲态保留最近一轮速率）。
- **高辨识度视觉设计**：
  - 24-bit TrueColor 柔和暗色盘（兼容 16 色降级）。
  - **不同模型专属颜色**（Gemini Neon 电光青 / Argon 宝石蓝 / Flash 薄荷青 / Claude 珊瑚橘·玫粉 / GPT 翡翠绿 / DeepSeek 靛蓝紫等）。
  - **运行模式纯前景着色**（`auto` 翡翠绿 / `plan` 冰天蓝 / `edits` 琥珀黄 / `default` 柔白 / `yolo` 珊瑚红），`Shift+Tab` 切换一目了然。
- **本地 Git 分支自动探测**：即使 `agy` 未下发分支名，也能 0.1 ms 直接读取 `.git/HEAD`（支持子目录、worktree 与 detached HEAD）并带缓存显示未提交改动标记 `*`。

---

## 30 秒一键部署

> 前置要求：已安装 **Node.js 18+**（[nodejs.org](https://nodejs.org/)）与 **Antigravity CLI (`agy`)**。本插件零外部依赖，**无需执行 `npm install`**。

### 方式一：下载 Release 压缩包（最适合直接分发）
前往 [Releases 页面](https://github.com/asia001-ya/agy-monitor/releases) 下载 `agy-monitor-v1.0.0.zip` 并解压：
- **Windows**：直接**双击根目录的 `install.bat`** 即可完成部署与自检（或在终端运行 `.\install.bat` / `.\scripts\install.ps1`）。
- **macOS / Linux**：进入解压目录运行 `bash ./install.sh`。

### 方式二：Git 克隆一行部署
```bash
git clone https://github.com/asia001-ya/agy-monitor.git && cd agy-monitor && node ./scripts/install.mjs
```

### 通用方式（任意系统 / npm）
```bash
node ./scripts/install.mjs
# 或：
npm run deploy
```

部署脚本会自动完成以下全部工作：
1. 将插件文件同步到全局纯 ASCII 插件目录：`~/.gemini/config/plugins/agy-monitor`（自动规避中文/空格路径坑）。
2. 自动备份原有的 `~/.gemini/antigravity-cli/settings.json`，安全合并写入 `statusLine` 配置（保留你原有的所有其他配置）。
3. 自动使用与 `agy` 一致的真实壳层执行端到端自检并打印预览效果。

部署完成后，**重新启动 `agy`**（或在 `agy` 中执行 `/statusline on`）即可在底部看到实时状态栏。

> 可选安装参数（示例：`node ./scripts/install.mjs --mode detailed --bar para`）：
> - `--mode compact|minimal|detailed`：安装时直接设定默认排版模式
> - `--bar square|para|vbar|seg|half|line|dots|unicode|ascii`：安装时直接设定进度条样式
> - `--stack-with-default`：保留 `agy` 原生状态栏，将本监控栏叠加显示在下方
> - `--skip-settings`：仅复制插件文件，不修改 `settings.json`
> - `--dry-run`：仅预览将执行的路径与命令，不修改任何文件

---

## 三种内置排版模式

1. **`compact`（默认：两行紧凑仪表盘）**
   ```text
   ◐ 示例项目 main*  │  Gemini 4 Neon · XHigh · auto  任务:1  │  CTX ■■■■■■■■ 14% · 149K/1M  │  ↑182K ↓41.2K · 46.8 tok/s  │  ✦ Pro  $0.42
   ◆ Gemini  5h ■■■■■■ 82% 4h16m · 周 ■■■■■■ 94% 6d11h  │  ◆ Claude  5h ■■■■■■ 46% 2h38m · 周 ■■■■■■ 68% 4d16h
   ```
2. **`minimal`（单行极简模式）**
   ```text
   ◐ 示例项目 main* │ Gemini 4 Neon · auto │ CTX 14% │ 224Ktok · 46.8 t/s │ G 5h 82%/周 94%  C 5h 46%/周 68%
   ```
3. **`detailed`（多行详细看板模式）**
   - 第 1 行：项目/子路径 + Git + 运行状态 + 专属色模型/思考强度/彩色模式 + 完整套餐 + 沙箱
   - 第 2 行：`◈ CTX` 垂直居中大进度条 + Token 消耗（↑入/↓出/总计）+ 实时 `tok/s` + 缓存命中率 + 费用 + 产物数
   - 第 3+ 行：每个模型族独立一行、等宽对齐展示 5h 与周限额居中进度条、倒计时与具体本地重置时刻

---

## 常用配置与诊断命令

所有个性化修改均实时生效，无需重启 `agy`（配置文件位于 `~/.gemini/antigravity-cli/agy-monitor.json`）：

```bash
# 切换排版模式
node ~/.gemini/config/plugins/agy-monitor/bin/agy-monitor.mjs mode compact
node ~/.gemini/config/plugins/agy-monitor/bin/agy-monitor.mjs mode minimal
node ~/.gemini/config/plugins/agy-monitor/bin/agy-monitor.mjs mode detailed

# 切换进度条风格
node ~/.gemini/config/plugins/agy-monitor/bin/agy-monitor.mjs config barStyle=square   # 默认：垂直居中实心方格 ■
node ~/.gemini/config/plugins/agy-monitor/bin/agy-monitor.mjs config barStyle=para     # 垂直居中斜切能量条 ▰
node ~/.gemini/config/plugins/agy-monitor/bin/agy-monitor.mjs config barStyle=vbar     # 垂直居中竖格电池条 ▮
node ~/.gemini/config/plugins/agy-monitor/bin/agy-monitor.mjs config barStyle=line     # 垂直居中极细线 ━/─
node ~/.gemini/config/plugins/agy-monitor/bin/agy-monitor.mjs config barStyle=ascii    # 纯 ASCII 兼容 [===---]

# 其他常用开关
node ~/.gemini/config/plugins/agy-monitor/bin/agy-monitor.mjs config quotaDisplay=used       # 切换显示已用/剩余百分比
node ~/.gemini/config/plugins/agy-monitor/bin/agy-monitor.mjs config showTokenSpeed=false    # 隐藏 tok/s 速率
node ~/.gemini/config/plugins/agy-monitor/bin/agy-monitor.mjs config detectGitDirty=false    # 超大仓库可关闭 * 脏标检测
node ~/.gemini/config/plugins/agy-monitor/bin/agy-monitor.mjs config colorProfile=ansi       # 老旧终端回退 16 色

# 查看实时快照明细 & 运行环境自检
node ~/.gemini/config/plugins/agy-monitor/bin/agy-monitor.mjs inspect
node ~/.gemini/config/plugins/agy-monitor/bin/agy-monitor.mjs doctor
```

---

## 卸载

- **Windows**：双击根目录 **`uninstall.bat`**（会自动备份并清理 `settings.json` 中的 `statusLine` 及全局插件目录）。
- **macOS / Linux**：运行 `bash ./uninstall.sh`（追加 `--purge` 可一并删除个人偏好与历史快照）。

---

## 打包分发给其他人

如果你修改了源码并希望重新打包发送给他人，只需在项目根目录运行：

```bash
npm run pack:zip
```

会在 `dist/agy-monitor-v<version>.zip` 生成干净的跨平台分发压缩包（自动排除临时文件并规范化 `.sh`/`.bat` 换行符），直接发给他人解压运行即可。

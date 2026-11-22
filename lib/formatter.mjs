/**
 * ANSI 终端颜色与格式化工具模块。
 * 注意：在 agy statusLine 中，stdout 通过管道传递，因此不能用 process.stdout.isTTY 判断是否输出颜色，
 * 而是由配置项 color（及 NO_COLOR 环境变量）显式控制。
 *
 * 默认启用现代 24-bit TrueColor 柔和色盘（Slate / Emerald / Sky / Amber / Rose / Violet / Orange），
 * 告别刺眼的 16 色荧光原色；同时支持配置 colorProfile="ansi" 回退标准 16 色。
 */

const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

/**
 * 构造 24-bit TrueColor 前景色转义码。
 * @param {number} r 红 (0-255)
 * @param {number} g 绿 (0-255)
 * @param {number} b 蓝 (0-255)
 * @returns {string}
 */
const fg = (r, g, b) => `\x1b[38;2;${r};${g};${b}m`;

// 现代深色终端柔和高级色盘（参考 Tailwind CSS 300/400/500/700 暗色平衡调校）
const TRUECOLOR_CODES = {
  bold: BOLD,
  dim: fg(148, 163, 184),                     // Slate 400 (#94A3B8) 清晰次级灰
  muted: fg(148, 163, 184),                   // Slate 400 (#94A3B8)
  subtle: fg(100, 116, 139),                  // Slate 500 (#64748B) 倒计时/单位弱灰
  track: fg(51, 65, 85),                      // Slate 700 (#334155) 底轨/分隔线骨架灰
  gray: fg(100, 116, 139),                    // Slate 500 (#64748B)
  white: fg(226, 232, 240),                   // Slate 200 (#E2E8F0) 柔和主白
  boldWhite: `${BOLD}${fg(248, 250, 252)}`,   // Slate 50 (#F8FAFC) 柔亮加粗白
  green: fg(52, 211, 153),                    // Emerald 400 (#34D399) 柔和翡翠绿
  boldGreen: `${BOLD}${fg(52, 211, 153)}`,
  yellow: fg(251, 191, 36),                   // Amber 400 (#FBBF24) 温润琥珀黄
  boldYellow: `${BOLD}${fg(251, 191, 36)}`,
  red: fg(251, 113, 133),                     // Rose 400 (#FB7185) 珊瑚红
  boldRed: `${BOLD}${fg(251, 113, 133)}`,
  cyan: fg(56, 189, 248),                     // Sky 400 (#38BDF8) 通透天空蓝
  boldCyan: `${BOLD}${fg(56, 189, 248)}`,
  boldElectricCyan: `${BOLD}${fg(34, 211, 238)}`, // Cyan 400 (#22D3EE) Neon 电光青
  blue: fg(96, 165, 250),                     // Blue 400 (#60A5FA)
  boldBlue: `${BOLD}${fg(96, 165, 250)}`,     // Argon 宝石蓝
  magenta: fg(192, 132, 252),                 // Purple 400 (#C084FC) 柔和薰衣草紫
  boldPurple: `${BOLD}${fg(192, 132, 252)}`,  // 3P 薰衣草紫
  violet: fg(167, 139, 250),                  // Violet 400 (#A78BFA)
  boldViolet: `${BOLD}${fg(196, 181, 253)}`,  // Violet 300 (#C4B5FD)
  boldIndigo: `${BOLD}${fg(129, 140, 248)}`,  // Indigo 400 (#818CF8) DeepSeek 靛蓝紫
  teal: fg(45, 212, 191),                     // Teal 400 (#2DD4BF) 薄荷青
  boldTeal: `${BOLD}${fg(45, 212, 191)}`,     // Flash / 实时速率薄荷青
  boldLime: `${BOLD}${fg(74, 222, 128)}`,     // Green 400 (#4ADE80) GPT 翡翠绿
  boldOrange: `${BOLD}${fg(251, 146, 60)}`,   // Orange 400 (#FB923C) Claude 珊瑚橘
  boldPink: `${BOLD}${fg(244, 114, 182)}`,    // Pink 400 (#F472B6) Claude Sonnet 玫粉
  gold: fg(252, 211, 77),                     // Amber 300 (#FCD34D) 香槟金徽章
  boldGold: `${BOLD}${fg(252, 211, 77)}`,
  // 运行模式纯前景配色（无背景色、小巧通透，切换模式色相清晰分明）
  modeAuto: `${BOLD}${fg(52, 211, 153)}`,     // 翡翠绿 (#34D399)
  modePlan: `${BOLD}${fg(56, 189, 248)}`,     // 冰天蓝 (#38BDF8)
  modeEdits: `${BOLD}${fg(251, 191, 36)}`,    // 琥珀黄 (#FBBF24)
  modeDefault: fg(203, 213, 225),             // 清晰柔白 (#CBD5E1)
  modeDanger: `${BOLD}${fg(251, 113, 133)}`,  // 珊瑚红 (#FB7185)
  modeOther: `${BOLD}${fg(192, 132, 252)}`,   // 薰衣草紫 (#C084FC)
};

// 标准 16 色降级色盘（兼容不支持 TrueColor 的老旧终端）
const ANSI16_CODES = {
  bold: BOLD,
  dim: DIM,
  muted: '\x1b[37m',
  subtle: '\x1b[90m',
  track: '\x1b[90m',
  gray: '\x1b[90m',
  white: '\x1b[37m',
  boldWhite: `${BOLD}\x1b[37m`,
  green: '\x1b[32m',
  boldGreen: `${BOLD}\x1b[32m`,
  yellow: '\x1b[33m',
  boldYellow: `${BOLD}\x1b[33m`,
  red: '\x1b[91m',
  boldRed: `${BOLD}\x1b[91m`,
  cyan: '\x1b[36m',
  boldCyan: `${BOLD}\x1b[36m`,
  boldElectricCyan: `${BOLD}\x1b[96m`,
  blue: '\x1b[34m',
  boldBlue: `${BOLD}\x1b[94m`,
  magenta: '\x1b[35m',
  boldPurple: `${BOLD}\x1b[95m`,
  violet: '\x1b[35m',
  boldViolet: `${BOLD}\x1b[35m`,
  boldIndigo: `${BOLD}\x1b[94m`,
  teal: '\x1b[36m',
  boldTeal: `${BOLD}\x1b[96m`,
  boldLime: `${BOLD}\x1b[92m`,
  boldOrange: `${BOLD}\x1b[93m`,
  boldPink: `${BOLD}\x1b[91m`,
  gold: '\x1b[33m',
  boldGold: `${BOLD}\x1b[93m`,
  modeAuto: `${BOLD}\x1b[92m`,
  modePlan: `${BOLD}\x1b[96m`,
  modeEdits: `${BOLD}\x1b[93m`,
  modeDefault: '\x1b[37m',
  modeDanger: `${BOLD}\x1b[91m`,
  modeOther: `${BOLD}\x1b[95m`,
};

/**
 * 创建带开关与色彩配置的颜色着色器。
 * @param {boolean} enabled 是否启用 ANSI 颜色
 * @param {'truecolor' | 'ansi'} [profile='truecolor'] 色彩方案
 * @returns {Record<string, (text: string) => string>}
 */
export function createStyler(enabled, profile = 'truecolor') {
  const palette = profile === 'ansi' ? ANSI16_CODES : TRUECOLOR_CODES;
  const wrap = (code) => (text) => (enabled ? `${code}${text}${RESET}` : String(text));
  const styler = {};
  for (const [key, code] of Object.entries(palette)) {
    styler[key] = wrap(code);
  }
  return styler;
}

/**
 * 去除字符串中的所有 ANSI 转义序列。
 * @param {string} text 待处理字符串
 * @returns {string}
 */
export function stripAnsi(text) {
  return String(text).replace(ANSI_REGEX, '');
}

/**
 * 判断单个 Unicode 码点在等宽终端下是否占 2 列（中日韩全角字符、全角标点、常见 Emoji）。
 * @param {number} cp Unicode 码点
 * @returns {boolean}
 */
function isWideCodePoint(cp) {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    cp === 0x2329 ||
    cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

/**
 * 计算字符串在终端中的真实显示宽度（忽略 ANSI 转义码，准确计算全角字符占 2 列）。
 * @param {string} text 待测量字符串
 * @returns {number}
 */
export function displayWidth(text) {
  const plain = stripAnsi(text);
  let width = 0;
  for (const ch of plain) {
    const cp = ch.codePointAt(0);
    if (cp === undefined || cp < 32 || (cp >= 0x7f && cp < 0xa0)) continue;
    width += isWideCodePoint(cp) ? 2 : 1;
  }
  return width;
}

/**
 * 按终端显示宽度安全截断带 ANSI 颜色的字符串，并在末尾追加省略号与颜色重置。
 * @param {string} text 原始字符串（可含 ANSI）
 * @param {number} maxWidth 最大显示列数
 * @param {boolean} colorEnabled 是否启用颜色重置
 * @returns {string}
 */
export function truncateAnsi(text, maxWidth, colorEnabled) {
  if (maxWidth <= 0) return '';
  if (displayWidth(text) <= maxWidth) return text;
  const ellipsis = maxWidth >= 2 ? '…' : '';
  const limit = Math.max(0, maxWidth - displayWidth(ellipsis));

  let out = '';
  let usedWidth = 0;
  let i = 0;
  let sawAnsi = false;

  while (i < text.length) {
    if (text[i] === '\x1b' && text[i + 1] === '[') {
      const endIdx = text.indexOf('m', i);
      if (endIdx !== -1) {
        out += text.slice(i, endIdx + 1);
        sawAnsi = true;
        i = endIdx + 1;
        continue;
      }
    }

    const cp = text.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const chWidth = cp < 32 ? 0 : (isWideCodePoint(cp) ? 2 : 1);
    if (usedWidth + chWidth > limit) break;
    out += ch;
    usedWidth += chWidth;
    i += ch.length;
  }

  return `${out}${ellipsis}${sawAnsi && colorEnabled ? RESET : ''}`;
}

/**
 * 将 Token 数量格式化为紧凑易读字符串（如 149K、1.05M、850）。
 * @param {number | null} tokens Token 数量
 * @returns {string}
 */
export function formatTokens(tokens) {
  if (tokens === null || tokens === undefined || !Number.isFinite(tokens)) return '-';
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return m >= 10 || Math.abs(m - Math.round(m)) < 0.06 ? `${Math.round(m)}M` : `${m.toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    const k = tokens / 1_000;
    return k >= 100 || Math.abs(k - Math.round(k)) < 0.06 ? `${Math.round(k)}K` : `${k.toFixed(1)}K`;
  }
  return String(Math.round(tokens));
}

/**
 * 将输出速率（token/s）格式化为紧凑数字（如 42.5、128、0）。
 * @param {number | null} tps 每秒 token 数
 * @returns {string}
 */
export function formatTokenRate(tps) {
  if (tps === null || tps === undefined || !Number.isFinite(tps) || tps <= 0) return '0';
  if (tps >= 100) return String(Math.round(tps));
  return tps.toFixed(1).replace(/\.0$/, '');
}

/**
 * 将百分比格式化为紧凑字符串（如 82%、14.2%）。
 * @param {number | null} pct 百分比值（0~100）
 * @param {boolean} [allowDecimal=false] 小于 10% 时是否保留 1 位小数
 * @returns {string}
 */
export function formatPercent(pct, allowDecimal = false) {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return 'N/A';
  if (allowDecimal && pct > 0 && pct < 10) {
    return `${pct.toFixed(1)}%`;
  }
  return `${Math.round(pct)}%`;
}

/**
 * 将重置剩余秒数格式化为等宽紧凑倒计时（如 4h07m、6d23h、42m、<1m）。
 * @param {number | null} seconds 剩余秒数
 * @returns {string}
 */
export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '';
  if (seconds <= 0) return '即将重置';
  if (seconds < 60) return '<1m';

  const totalMinutes = Math.floor(seconds / 60);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const pad2 = (n) => String(n).padStart(2, '0');

  if (days > 0) {
    return hours > 0 ? `${days}d${pad2(hours)}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h${pad2(minutes)}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

/**
 * 将 ISO 重置时间格式化为本地可读时间（用于详细模式或开启 showExactResetClock 时）。
 * @param {string | null} isoTime ISO 8601 时间字符串
 * @returns {string}
 */
export function formatLocalResetClock(isoTime) {
  if (!isoTime) return '';
  const date = new Date(isoTime);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 精简套餐等级名称以便紧凑展示（例如 Google AI Ultra -> Ultra）。
 * @param {string | null} planTier 原始套餐名
 * @param {boolean} [compact=true] 是否紧凑化
 * @returns {string}
 */
export function formatPlanTier(planTier, compact = true) {
  if (!planTier) return '';
  const trimmed = String(planTier).trim();
  if (!compact) return trimmed;
  return trimmed.replace(/^Google\s+AI\s+/i, '').replace(/^Antigravity\s+/i, '');
}

/**
 * 渲染现代垂直居中进度条。
 * 默认 square（■ U+25A0）：严格垂直居中、约 50% 黄金高度、无方括号无网纹，Cascadia Mono / Consolas 均实测 1 列等宽。
 * 同时支持 para / vbar / seg / half / line / dots / unicode / ascii。
 * @param {number | null} percent 填充百分比（0~100）
 * @param {number} width 进度条内部格数
 * @param {string} barStyle 进度条字符风格
 * @param {(text: string) => string} colorFn 填充部分着色函数
 * @param {Record<string, (text: string) => string>} styler 着色器
 * @returns {string}
 */
export function renderBar(percent, width, barStyle, colorFn, styler) {
  if (width <= 0) return '';

  const style = String(barStyle || 'square').toLowerCase();
  const trackFn = styler.track || styler.gray;

  // 纯 ASCII 兼容模式
  if (style === 'ascii') {
    if (percent === null || percent === undefined || !Number.isFinite(percent)) {
      return `${trackFn('[')}${trackFn('-'.repeat(width))}${trackFn(']')}`;
    }
    const ratio = Math.min(1, Math.max(0, percent / 100));
    const filled = Math.round(ratio * width);
    const empty = Math.max(0, width - filled);
    return `${trackFn('[')}${filled > 0 ? colorFn('='.repeat(filled)) : ''}${empty > 0 ? trackFn('-'.repeat(empty)) : ''}${trackFn(']')}`;
  }

  // 默认 square（■ U+25A0）：严格垂直居中、饱满中等高度、空轨同款深灰实心
  let fillChar = '■';
  let emptyChar = '■';
  if (style === 'para') {
    fillChar = '▰';
    emptyChar = '▰';
  } else if (style === 'vbar') {
    fillChar = '▮';
    emptyChar = '▮';
  } else if (style === 'seg') {
    fillChar = '▪';
    emptyChar = '▪';
  } else if (style === 'half') {
    fillChar = '▄';
    emptyChar = '▄';
  } else if (style === 'line') {
    fillChar = '━';
    emptyChar = '─';
  } else if (style === 'dots') {
    fillChar = '●';
    emptyChar = '○';
  } else if (style === 'unicode' || style === 'block') {
    fillChar = '█';
    emptyChar = '█';
  }

  if (percent === null || percent === undefined || !Number.isFinite(percent)) {
    return trackFn(emptyChar.repeat(width));
  }

  const ratio = Math.min(1, Math.max(0, percent / 100));
  const filled = Math.round(ratio * width);
  const empty = Math.max(0, width - filled);
  const filledStr = filled > 0 ? colorFn(fillChar.repeat(filled)) : '';
  const emptyStr = empty > 0 ? trackFn(emptyChar.repeat(empty)) : '';

  return `${filledStr}${emptyStr}`;
}

/**
 * 根据具体模型名称或模型家族分配专属高辨识度主题色，确保不同模型呈现不同色彩。
 * 未知模型通过确定性哈希自动映射到协调调色板，保证不同模型名自然区分。
 * @param {string} modelName 模型名或模型组名
 * @param {Record<string, (text: string) => string>} styler 着色器
 * @returns {(text: string) => string}
 */
export function pickModelColor(modelName, styler) {
  const raw = String(modelName || '').trim();
  const lower = raw.toLowerCase();

  if (!lower || lower === '未选择模型') return styler.muted || styler.gray;

  // Gemini 细分系列各具特色冷色系
  if (/neon/.test(lower)) return styler.boldElectricCyan || styler.boldCyan;
  if (/argon/.test(lower)) return styler.boldBlue || styler.blue;
  if (/flash/.test(lower)) return styler.boldTeal || styler.cyan;
  if (/gemini[-_\s]?pro|\bpro\b/.test(lower)) return styler.boldCyan;
  if (/gemini/.test(lower)) return styler.boldCyan;

  // Claude 细分系列：珊瑚橘 / 玫粉暖色系（高区分度）
  if (/sonnet/.test(lower)) return styler.boldPink || styler.boldOrange || styler.magenta;
  if (/opus|haiku|claude|anthropic/.test(lower)) return styler.boldOrange || styler.yellow;

  // OpenAI / GPT 系列：翡翠绿
  if (/gpt|openai|codex|\bo[134]\b/.test(lower)) return styler.boldLime || styler.boldGreen;

  // DeepSeek / Qwen / 3P 各自独立色系
  if (/deepseek/.test(lower)) return styler.boldIndigo || styler.boldBlue;
  if (/qwen/.test(lower)) return styler.boldViolet || styler.magenta;
  if (/third[-_\s]?party|thirdparty|\b3p\b/.test(lower)) return styler.boldPurple || styler.magenta;

  // 兜底：对未知模型名按确定性哈希分配不同主题色
  const dynamicPalette = [
    styler.boldElectricCyan,
    styler.boldOrange,
    styler.boldLime,
    styler.boldPurple,
    styler.boldPink,
    styler.boldBlue,
    styler.boldGold,
    styler.boldTeal,
  ].filter(Boolean);

  let hash = 0;
  for (let i = 0; i < lower.length; i += 1) {
    hash = (hash * 31 + lower.charCodeAt(i)) >>> 0;
  }
  return dynamicPalette[hash % dynamicPalette.length] || styler.boldWhite;
}

/**
 * 为配额模型组选择专属主题色（复用统一模型色彩体系）。
 * @param {string} groupName 模型组名称
 * @param {Record<string, (text: string) => string>} styler 着色器
 * @returns {(text: string) => string}
 */
export function pickModelGroupColor(groupName, styler) {
  return pickModelColor(groupName, styler);
}

/**
 * 渲染小巧通透的彩色运行模式标签（无背景色，仅用高区分度语义前景色区分 auto / plan / edits / default / yolo）。
 * @param {string | null} cycleMode 当前模式名
 * @param {Record<string, (text: string) => string>} styler 着色器
 * @returns {string}
 */
export function renderCycleModeBadge(cycleMode, styler) {
  if (!cycleMode) return '';
  const raw = String(cycleMode).trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();

  if (lower === 'auto' || lower === 'autonomous') {
    return (styler.modeAuto || styler.boldGreen)('auto');
  }
  if (lower === 'plan' || lower === 'planning') {
    return (styler.modePlan || styler.boldCyan)('plan');
  }
  if (lower === 'accept-edits' || lower === 'accept_edits' || lower === 'edits') {
    return (styler.modeEdits || styler.boldYellow)('edits');
  }
  if (lower === 'default' || lower === 'review' || lower === 'ask' || lower === 'interactive') {
    return (styler.modeDefault || styler.white)(lower);
  }
  if (lower === 'yolo' || lower === 'bypass' || lower === 'unsafe' || lower === 'always-proceed') {
    return (styler.modeDanger || styler.boldRed)(lower);
  }
  return (styler.modeOther || styler.boldPurple)(lower);
}

/**
 * 根据上下文已用百分比选择柔和告警颜色。
 * @param {number | null} usedPct 已用百分比
 * @param {Record<string, any>} thresholds 阈值配置
 * @param {Record<string, (text: string) => string>} styler 着色器
 * @returns {(text: string) => string}
 */
export function pickContextColor(usedPct, thresholds, styler) {
  if (usedPct === null || usedPct === undefined) return styler.subtle || styler.gray;
  const warn = thresholds?.contextWarn ?? 60;
  const critical = thresholds?.contextCritical ?? 80;
  if (usedPct >= critical) return styler.boldRed;
  if (usedPct >= warn) return styler.boldYellow || styler.yellow;
  if (usedPct <= 0) return styler.muted || styler.gray;
  return styler.green;
}

/**
 * 根据配额剩余百分比选择柔和告警颜色（剩余越少越红）。
 * @param {number | null} remainingPct 剩余百分比
 * @param {Record<string, any>} thresholds 阈值配置
 * @param {Record<string, (text: string) => string>} styler 着色器
 * @returns {(text: string) => string}
 */
export function pickQuotaColor(remainingPct, thresholds, styler) {
  if (remainingPct === null || remainingPct === undefined) return styler.subtle || styler.gray;
  const warn = thresholds?.quotaWarnRemaining ?? 50;
  const critical = thresholds?.quotaCriticalRemaining ?? 20;
  if (remainingPct <= critical) return styler.boldRed;
  if (remainingPct <= warn) return styler.boldYellow || styler.yellow;
  return styler.green;
}

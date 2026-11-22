import os from 'node:os';
import path from 'node:path';
import { resolveLocalGitInfo } from './git.mjs';

/**
 * 安全将数值转为有限数字，失败返回 null。
 * @param {any} value 原始值
 * @returns {number | null}
 */
function toFiniteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * 将数值限制在 [min, max] 区间内。
 * @param {number} value 输入值
 * @param {number} min 最小值
 * @param {number} max 最大值
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * 从路径字符串中提取目录基名（兼容 Windows 反斜杠和 POSIX 正斜杠）。
 * @param {string} rawPath 路径字符串
 * @returns {string}
 */
function safeBasename(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return '';
  const normalized = rawPath.replace(/[\\/]+$/, '');
  if (!normalized) return rawPath;
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : normalized;
}

/**
 * 计算 currentDir 相对于 projectDir 的简洁子路径（兼容跨平台分隔符）。
 * @param {string} projectDir 项目根目录
 * @param {string} currentDir 当前目录
 * @returns {string}
 */
function computeRelativeSubPath(projectDir, currentDir) {
  if (!projectDir || !currentDir) return '';
  const normProject = projectDir.replace(/\\/g, '/').replace(/\/+$/, '');
  const normCurrent = currentDir.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normProject.toLowerCase() === normCurrent.toLowerCase()) return '';
  if (normCurrent.toLowerCase().startsWith(`${normProject.toLowerCase()}/`)) {
    return normCurrent.slice(normProject.length + 1);
  }
  return '';
}

/**
 * 识别时间窗口类型（5小时 / 周限额 / 日限额 / 其他）。
 * @param {string} key 原始桶键名或完整路径键名
 * @param {number | null} resetInSeconds 重置剩余秒数（辅助推断）
 * @returns {{ windowType: '5h' | 'weekly' | 'daily' | 'other', windowLabel: string, windowOrder: number }}
 */
function detectWindow(key, resetInSeconds) {
  const lower = key.toLowerCase();

  // 显式匹配 5 小时窗口
  if (
    /(^|[-_.\s/])(5h|5hr|5hour|5hours|five[-_]?hour|fivehour|short[-_]?term)($|[-_.\s/])/.test(lower) ||
    lower.includes('fivehour') ||
    lower.includes('five_hour') ||
    lower.includes('5h')
  ) {
    return { windowType: '5h', windowLabel: '5h', windowOrder: 1 };
  }

  // 显式匹配周限额窗口
  if (
    /(^|[-_.\s/])(weekly|week|7d|7day|7days|wk)($|[-_.\s/])/.test(lower) ||
    lower.includes('weekly') ||
    lower.includes('7d')
  ) {
    return { windowType: 'weekly', windowLabel: '周', windowOrder: 2 };
  }

  // 显式匹配日限额窗口
  if (/(^|[-_.\s/])(daily|day|24h|1d)($|[-_.\s/])/.test(lower) || lower.includes('daily')) {
    return { windowType: 'daily', windowLabel: '日', windowOrder: 3 };
  }

  // 若键名没有明确周期，但提供了 reset_in_seconds，做保守推断
  if (typeof resetInSeconds === 'number' && resetInSeconds > 0) {
    if (resetInSeconds <= 6 * 3600) {
      return { windowType: '5h', windowLabel: '5h', windowOrder: 1 };
    }
    if (resetInSeconds > 24 * 3600 && resetInSeconds <= 8 * 24 * 3600) {
      return { windowType: 'weekly', windowLabel: '周', windowOrder: 2 };
    }
  }

  return { windowType: 'other', windowLabel: '限额', windowOrder: 9 };
}

/**
 * 标准化配额桶的模型分组名称与简写代号。
 * 兼容 gemini、neon、argon、claude、gpt、openai、anthropic、third_party/3p 等命名。
 * @param {string} rawKey 桶键名
 * @param {string[]} pathSegments 嵌套父路径片段
 * @param {Record<string, any>} bucketObj 桶对象自身（可能含 provider/model 字段）
 * @returns {{ groupName: string, shortCode: string }}
 */
function detectModelGroup(rawKey, pathSegments, bucketObj) {
  const combined = [
    bucketObj?.model,
    bucketObj?.model_name,
    bucketObj?.provider,
    rawKey,
    ...pathSegments,
  ]
    .filter((item) => typeof item === 'string' && item.trim() !== '')
    .join(' ')
    .toLowerCase();

  // 优先识别具体模型/家族名
  const rules = [
    { pattern: /claude|anthropic/, groupName: 'Claude', shortCode: 'C' },
    { pattern: /gpt|openai|codex|o[134]-/, groupName: 'GPT', shortCode: 'O' },
    { pattern: /neon/, groupName: 'Neon', shortCode: 'N' },
    { pattern: /argon/, groupName: 'Argon', shortCode: 'A' },
    { pattern: /gemini[-_\s]?pro|\bpro\b/, groupName: 'Gemini Pro', shortCode: 'GP' },
    { pattern: /gemini[-_\s]?flash|\bflash\b/, groupName: 'Gemini Flash', shortCode: 'GF' },
    { pattern: /gemini/, groupName: 'Gemini', shortCode: 'G' },
    { pattern: /third[-_\s]?party|thirdparty|\b3p\b/, groupName: '3P', shortCode: '3P' },
  ];

  for (const rule of rules) {
    if (rule.pattern.test(combined)) {
      return { groupName: rule.groupName, shortCode: rule.shortCode };
    }
  }

  // 兜底：去除周期后缀，生成易读首字母大写名称
  const cleaned = rawKey
    .replace(/[-_.\s]*(five[-_]?hour|5hr|5hour|5h|weekly|week|7days|7day|7d|daily|24h|quota|bucket|limit)/gi, '')
    .replace(/[-_]+/g, ' ')
    .trim();

  if (!cleaned) {
    return { groupName: '默认模型', shortCode: 'M' };
  }

  const titled = cleaned
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  const shortCode = titled.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'M';
  return { groupName: titled, shortCode };
}

/**
 * 判断一个对象是否为配额桶（包含剩余比例/已用比例/重置时间等指标字段）。
 * @param {any} node 待检测节点
 * @returns {boolean}
 */
function isQuotaBucketObject(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
  return (
    node.remaining_fraction !== undefined ||
    node.remainingFraction !== undefined ||
    node.remaining_percentage !== undefined ||
    node.remainingPercentage !== undefined ||
    node.used_percentage !== undefined ||
    node.usedPercentage !== undefined ||
    node.used_fraction !== undefined ||
    node.usedFraction !== undefined ||
    node.remaining_amount !== undefined ||
    node.remainingAmount !== undefined ||
    node.reset_time !== undefined ||
    node.resetTime !== undefined ||
    node.reset_in_seconds !== undefined ||
    node.resetInSeconds !== undefined
  );
}

/**
 * 将单个配额桶对象归一化为统一结构。
 * @param {string} rawKey 原始键名
 * @param {string[]} pathSegments 父路径片段
 * @param {Record<string, any>} obj 配额桶对象
 * @param {number} nowMs 当前时间戳（毫秒）
 * @returns {Record<string, any>}
 */
function normalizeBucket(rawKey, pathSegments, obj, nowMs) {
  let remainingFraction = toFiniteNumber(obj.remaining_fraction ?? obj.remainingFraction);

  if (remainingFraction === null) {
    const remainingPct = toFiniteNumber(obj.remaining_percentage ?? obj.remainingPercentage);
    if (remainingPct !== null) {
      remainingFraction = remainingPct > 1 ? remainingPct / 100 : remainingPct;
    }
  }

  if (remainingFraction === null) {
    const usedFraction = toFiniteNumber(obj.used_fraction ?? obj.usedFraction);
    if (usedFraction !== null) {
      remainingFraction = 1 - (usedFraction > 1 ? usedFraction / 100 : usedFraction);
    }
  }

  if (remainingFraction === null) {
    const usedPct = toFiniteNumber(obj.used_percentage ?? obj.usedPercentage);
    if (usedPct !== null) {
      remainingFraction = 1 - usedPct / 100;
    }
  }

  if (remainingFraction === null) {
    const remainingAmount = toFiniteNumber(obj.remaining_amount ?? obj.remainingAmount);
    const totalAmount = toFiniteNumber(obj.total_amount ?? obj.totalAmount ?? obj.limit);
    if (remainingAmount !== null && totalAmount !== null && totalAmount > 0) {
      remainingFraction = remainingAmount / totalAmount;
    }
  }

  if (remainingFraction !== null) {
    // 兼容部分来源把 0~100 当 fraction 传入的极端情况
    if (remainingFraction > 1 && remainingFraction <= 100) {
      remainingFraction = remainingFraction / 100;
    }
    remainingFraction = clamp(remainingFraction, 0, 1);
  }

  const resetTime = typeof (obj.reset_time ?? obj.resetTime) === 'string'
    ? (obj.reset_time ?? obj.resetTime)
    : null;

  let resetInSeconds = toFiniteNumber(obj.reset_in_seconds ?? obj.resetInSeconds);
  if (resetInSeconds === null && resetTime) {
    const parsedTime = Date.parse(resetTime);
    if (Number.isFinite(parsedTime)) {
      resetInSeconds = Math.max(0, Math.round((parsedTime - nowMs) / 1000));
    }
  }

  const fullKey = [...pathSegments, rawKey].filter(Boolean).join('/');
  const { windowType, windowLabel, windowOrder } = detectWindow(fullKey, resetInSeconds);
  const { groupName, shortCode } = detectModelGroup(rawKey, pathSegments, obj);

  const remainingPercent = remainingFraction !== null ? Number((remainingFraction * 100).toFixed(1)) : null;
  const usedPercent = remainingFraction !== null ? Number(((1 - remainingFraction) * 100).toFixed(1)) : null;

  return {
    id: fullKey || rawKey,
    rawKey,
    groupName,
    shortCode,
    windowType,
    windowLabel,
    windowOrder,
    remainingFraction,
    remainingPercent,
    usedPercent,
    remainingAmount: toFiniteNumber(obj.remaining_amount ?? obj.remainingAmount),
    resetTime,
    resetInSeconds,
    disabled: Boolean(obj.disabled),
  };
}

/**
 * 递归提取所有配额桶（支持扁平对象、多层嵌套对象以及数组形式）。
 * @param {any} quotaRoot payload.quota 节点
 * @param {number} nowMs 当前时间戳（毫秒）
 * @returns {Array<Record<string, any>>}
 */
function extractQuotaBuckets(quotaRoot, nowMs) {
  const buckets = [];
  if (!quotaRoot || typeof quotaRoot !== 'object') return buckets;

  const visit = (node, segments, depth) => {
    if (!node || typeof node !== 'object' || depth > 4) return;

    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        if (isQuotaBucketObject(item)) {
          const itemKey = String(item.id || item.bucket_id || item.name || item.model || `bucket-${index}`);
          buckets.push(normalizeBucket(itemKey, segments, item, nowMs));
        } else if (item && typeof item === 'object') {
          visit(item, [...segments, String(index)], depth + 1);
        }
      });
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      if (!value || typeof value !== 'object') continue;
      if (isQuotaBucketObject(value)) {
        buckets.push(normalizeBucket(key, segments, value, nowMs));
      } else {
        // 携带同级 provider 提示（例如 third_party: { provider: "anthropic", "claude-5h": {...} }）
        const nextSegments = [...segments, key];
        if (typeof value.provider === 'string' && value.provider.trim() !== '') {
          nextSegments.push(value.provider);
        }
        visit(value, nextSegments, depth + 1);
      }
    }
  };

  visit(quotaRoot, [], 0);
  return buckets;
}

/**
 * 将提取出的配额桶按模型分组并按配置顺序排序，同组内按 5h -> 周 -> 日 -> 其他排序。
 * @param {Array<Record<string, any>>} buckets 归一化后的配额桶列表
 * @param {Record<string, any>} config 监控配置
 * @returns {Array<{ groupName: string, shortCode: string, buckets: Array<Record<string, any>> }>}
 */
function groupQuotaBuckets(buckets, config) {
  const showDisabled = Boolean(config?.showDisabledQuotas);
  const filtered = buckets.filter((b) => showDisabled || !b.disabled);

  const groupsMap = new Map();
  for (const bucket of filtered) {
    if (!groupsMap.has(bucket.groupName)) {
      groupsMap.set(bucket.groupName, {
        groupName: bucket.groupName,
        shortCode: bucket.shortCode,
        buckets: [],
      });
    }
    groupsMap.get(bucket.groupName).buckets.push(bucket);
  }

  const modelOrder = Array.isArray(config?.modelOrder)
    ? config.modelOrder.map((m) => String(m).toLowerCase())
    : [];

  const getGroupRank = (name) => {
    const lower = name.toLowerCase();
    const exact = modelOrder.indexOf(lower);
    if (exact !== -1) return exact;
    const partial = modelOrder.findIndex((item) => lower.includes(item));
    return partial !== -1 ? partial : 999;
  };

  const groups = Array.from(groupsMap.values());
  groups.sort((a, b) => {
    const rankDiff = getGroupRank(a.groupName) - getGroupRank(b.groupName);
    if (rankDiff !== 0) return rankDiff;
    return a.groupName.localeCompare(b.groupName);
  });

  for (const group of groups) {
    group.buckets.sort((a, b) => {
      if (a.windowOrder !== b.windowOrder) return a.windowOrder - b.windowOrder;
      return a.id.localeCompare(b.id);
    });
  }

  return groups;
}

/**
 * 归一化上下文窗口占用指标。
 * @param {Record<string, any>} payload 原始状态 payload
 * @returns {Record<string, any>}
 */
function parseContextWindow(payload) {
  const cw = payload?.context_window || payload?.contextWindow || {};
  const current = cw.current_usage || cw.currentUsage || {};

  const windowSize = toFiniteNumber(cw.context_window_size ?? cw.contextWindowSize);
  const totalInputTokens = toFiniteNumber(cw.total_input_tokens ?? cw.totalInputTokens);
  const totalOutputTokens = toFiniteNumber(cw.total_output_tokens ?? cw.totalOutputTokens);

  const currentInput = toFiniteNumber(current.input_tokens ?? current.inputTokens);
  const currentOutput = toFiniteNumber(current.output_tokens ?? current.outputTokens);
  const cacheCreate = toFiniteNumber(current.cache_creation_input_tokens ?? current.cacheCreationInputTokens);
  const cacheRead = toFiniteNumber(current.cache_read_input_tokens ?? current.cacheReadInputTokens);

  let usedPercentage = toFiniteNumber(cw.used_percentage ?? cw.usedPercentage);
  let remainingPercentage = toFiniteNumber(cw.remaining_percentage ?? cw.remainingPercentage);

  // 估算当前上下文占用的 token 数
  let activeContextTokens = null;
  if (currentInput !== null || cacheRead !== null || cacheCreate !== null) {
    activeContextTokens = (currentInput || 0) + (cacheRead || 0) + (cacheCreate || 0);
  }
  const cumulativeTokens =
    totalInputTokens !== null || totalOutputTokens !== null
      ? (totalInputTokens || 0) + (totalOutputTokens || 0)
      : null;

  if (usedPercentage === null && remainingPercentage !== null) {
    usedPercentage = clamp(100 - remainingPercentage, 0, 100);
  }
  if (usedPercentage === null && windowSize && windowSize > 0) {
    const numerator = activeContextTokens ?? cumulativeTokens;
    if (numerator !== null) {
      usedPercentage = clamp((numerator / windowSize) * 100, 0, 100);
    }
  }
  if (usedPercentage !== null) {
    usedPercentage = clamp(usedPercentage, 0, 100);
    if (remainingPercentage === null) {
      remainingPercentage = clamp(100 - usedPercentage, 0, 100);
    }
  }

  // 根据百分比反推当前已占窗口 token（当 current_usage 缺失时非常有用）
  let usedTokensForBar = null;
  if (usedPercentage !== null && windowSize && windowSize > 0) {
    usedTokensForBar = Math.round((usedPercentage / 100) * windowSize);
  } else {
    usedTokensForBar = activeContextTokens ?? cumulativeTokens;
  }

  // 计算缓存读取命中率
  let cacheHitRate = null;
  if (cacheRead !== null && activeContextTokens && activeContextTokens > 0) {
    cacheHitRate = clamp((cacheRead / activeContextTokens) * 100, 0, 100);
  }

  return {
    windowSize,
    usedPercentage: usedPercentage !== null ? Number(usedPercentage.toFixed(1)) : null,
    remainingPercentage: remainingPercentage !== null ? Number(remainingPercentage.toFixed(1)) : null,
    usedTokens: usedTokensForBar,
    totalInputTokens,
    totalOutputTokens,
    totalTokens:
      totalInputTokens !== null || totalOutputTokens !== null
        ? (totalInputTokens || 0) + (totalOutputTokens || 0)
        : (currentInput !== null || currentOutput !== null ? (currentInput || 0) + (currentOutput || 0) : null),
    currentInput,
    currentOutput,
    cacheCreate,
    cacheRead,
    cacheHitRate: cacheHitRate !== null ? Number(cacheHitRate.toFixed(1)) : null,
    exceeds200k: Boolean(payload?.exceeds_200k_tokens ?? payload?.exceeds200kTokens),
  };
}

/**
 * 归一化当前项目与版本控制信息。
 * 当 agy 仅传入 vcs.type="git" 而未附带 branch 时，自动从本地 .git/HEAD 极速补全分支与脏标。
 * @param {Record<string, any>} payload 原始状态 payload
 * @param {Record<string, any>} [config] 监控配置
 * @returns {Record<string, any>}
 */
function parseProject(payload, config) {
  const workspace = payload?.workspace || {};
  const projectObj = payload?.project || {};
  const cwd = typeof payload?.cwd === 'string' ? payload.cwd : '';

  const projectDir =
    workspace.project_dir ||
    workspace.projectDir ||
    projectObj.project_dir ||
    projectObj.projectDir ||
    workspace.current_dir ||
    workspace.currentDir ||
    projectObj.current_dir ||
    projectObj.currentDir ||
    cwd ||
    '';

  const currentDir =
    workspace.current_dir ||
    workspace.currentDir ||
    projectObj.current_dir ||
    projectObj.currentDir ||
    cwd ||
    projectDir;

  const explicitName =
    (typeof projectObj.name === 'string' && projectObj.name.trim()) ||
    (typeof workspace.name === 'string' && workspace.name.trim()) ||
    (typeof payload?.project_name === 'string' && payload.project_name.trim()) ||
    '';

  const normHome = os.homedir().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const normProj = projectDir.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const isHomeDir = Boolean(normProj) && normProj === normHome;

  const name = explicitName || (isHomeDir ? '~' : safeBasename(projectDir)) || '未知项目';
  const subPath = computeRelativeSubPath(projectDir, currentDir);

  const vcsRaw = payload?.vcs || {};
  const vcs = {
    type: typeof vcsRaw.type === 'string' ? vcsRaw.type : null,
    branch: typeof vcsRaw.branch === 'string' && vcsRaw.branch.trim() ? vcsRaw.branch.trim() : null,
    dirty: Boolean(vcsRaw.dirty),
  };

  // agy CLI 部分版本在 vcs 中仅提供 type="git" 而省略 branch/dirty，此处自动读取本地 .git/HEAD 毫秒级补全
  if (config?.showVcs !== false && !vcs.branch && (currentDir || projectDir)) {
    const localGit = resolveLocalGitInfo(currentDir || projectDir, {
      detectDirty: config?.detectGitDirty !== false && vcsRaw.dirty === undefined,
    });
    if (localGit) {
      vcs.type = vcs.type || localGit.type;
      vcs.branch = localGit.branch;
      if (vcsRaw.dirty === undefined) {
        vcs.dirty = localGit.dirty;
      }
    }
  }

  return {
    name,
    projectDir,
    currentDir,
    subPath,
    vcs,
  };
}

/**
 * 归一化模型名称、思考强度与 Agent 运行态信息。
 * @param {Record<string, any>} payload 原始状态 payload
 * @returns {Record<string, any>}
 */
function parseModelAndAgent(payload) {
  const modelRaw = payload?.model;
  let id = '';
  let displayName = '';
  let effort = '';

  if (typeof modelRaw === 'string') {
    id = modelRaw;
    displayName = modelRaw;
  } else if (modelRaw && typeof modelRaw === 'object') {
    id = String(modelRaw.id || '');
    displayName = String(modelRaw.display_name || modelRaw.displayName || id || '');
    effort = String(modelRaw.effort || '');
  }

  // 如果 displayName 中已经包含 (High)/(Medium)/(XHigh) 等思考级别标注，避免重复拼接
  const effortMatch = displayName.match(/\s*\(([^()]+)\)\s*$/);
  const hasEffortInName = effort && new RegExp(`\\(${effort}\\)`, 'i').test(displayName);
  const label = displayName
    ? (effort && !hasEffortInName ? `${displayName} (${effort})` : displayName)
    : '未选择模型';

  // 拆出纯净模型主名与思考强度标签，便于 UI 以更精致的层级排版（告别括号嵌套）
  let baseName = displayName || '未选择模型';
  let effortLabel = '';
  if (hasEffortInName && effortMatch) {
    baseName = displayName.slice(0, effortMatch.index).trim() || displayName;
    effortLabel = effortMatch[1].trim();
  } else if (effort) {
    effortLabel = effort.charAt(0).toUpperCase() + effort.slice(1);
  }

  const rawState = String(payload?.agent_state || payload?.agentState || 'idle').toLowerCase();
  const stateMap = {
    idle: { code: 'idle', label: '就绪', tone: 'green', dot: '●' },
    ready: { code: 'idle', label: '就绪', tone: 'green', dot: '●' },
    working: { code: 'working', label: '运行', tone: 'cyan', dot: '◐' },
    thinking: { code: 'thinking', label: '思考', tone: 'cyan', dot: '◐' },
    tool_use: { code: 'tool_use', label: '工具', tone: 'blue', dot: '▸' },
    tool: { code: 'tool_use', label: '工具', tone: 'blue', dot: '▸' },
    reviewing: { code: 'reviewing', label: '待确认', tone: 'yellow', dot: '▲' },
    initializing: { code: 'initializing', label: '初始化', tone: 'dim', dot: '○' },
    authenticating: { code: 'authenticating', label: '认证中', tone: 'yellow', dot: '○' },
    error: { code: 'error', label: '异常', tone: 'red', dot: '×' },
  };
  const agentState = stateMap[rawState] || { code: rawState, label: rawState, tone: 'cyan', dot: '●' };

  const costRaw = payload?.cost || {};
  const cost = {
    totalUsd: toFiniteNumber(costRaw.total_usd ?? costRaw.totalUsd),
    subagentUsd: toFiniteNumber(costRaw.subagent_usd ?? costRaw.subagentUsd),
    estimated: Boolean(costRaw.estimated),
  };

  const subagents = Array.isArray(payload?.subagents) ? payload.subagents : [];

  return {
    model: {
      id,
      displayName: displayName || '未选择模型',
      baseName,
      effort,
      effortLabel,
      label,
    },
    agentState,
    cycleMode: typeof (payload?.cycle_mode ?? payload?.cycleMode) === 'string'
      ? (payload.cycle_mode ?? payload.cycleMode)
      : null,
    planTier: typeof (payload?.plan_tier ?? payload?.planTier) === 'string'
      ? (payload.plan_tier ?? payload.planTier)
      : null,
    version: typeof payload?.version === 'string' ? payload.version : null,
    email: typeof payload?.email === 'string' ? payload.email : null,
    conversationId: payload?.conversation_id || payload?.session_id || null,
    conversationTitle: typeof payload?.conversation_title === 'string' ? payload.conversation_title : null,
    sandboxEnabled: Boolean(payload?.sandbox?.enabled),
    artifactCount: toFiniteNumber(payload?.artifact_count ?? payload?.artifactCount) || 0,
    taskCount: toFiniteNumber(payload?.task_count ?? payload?.taskCount) || 0,
    subagentCount: subagents.length,
    subagents,
    cost,
  };
}

/**
 * 将 agy statusLine 原始 JSON payload 解析为统一结构化监控模型。
 * @param {Record<string, any>} payload 原始 JSON 对象
 * @param {Record<string, any>} config 监控配置
 * @param {number} [nowMs] 可选当前时间戳（毫秒，便于测试固定时间）
 * @returns {Record<string, any>}
 */
export function parseStatusPayload(payload, config, nowMs = Date.now()) {
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  const terminalWidth = toFiniteNumber(safePayload.terminal_width ?? safePayload.terminalWidth) || 120;

  const project = parseProject(safePayload, config);
  const context = parseContextWindow(safePayload);
  const meta = parseModelAndAgent(safePayload);
  const rawBuckets = extractQuotaBuckets(safePayload.quota || safePayload.quotas, nowMs);
  const quotaGroups = groupQuotaBuckets(rawBuckets, config);

  return {
    timestamp: new Date(nowMs).toISOString(),
    terminalWidth,
    project,
    context,
    ...meta,
    telemetry: {
      tokensPerSecond: null,
      isLive: false,
      source: 'none',
    },
    quotaBuckets: rawBuckets,
    quotaGroups,
  };
}

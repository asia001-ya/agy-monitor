import {
  createStyler,
  displayWidth,
  formatDuration,
  formatLocalResetClock,
  formatPercent,
  formatPlanTier,
  formatTokenRate,
  formatTokens,
  pickContextColor,
  pickModelColor,
  pickModelGroupColor,
  pickQuotaColor,
  renderBar,
  renderCycleModeBadge,
  truncateAnsi,
} from './formatter.mjs';

/**
 * 渲染当前项目、运行态指示点与 Git 分支片段（柔白项目名，把专属亮色让给模型名）。
 * @param {Record<string, any>} data 归一化后的监控数据
 * @param {Record<string, any>} config 监控配置
 * @param {Record<string, (text: string) => string>} styler 着色器
 * @param {boolean} compact 是否超紧凑格式
 * @returns {string}
 */
function renderProjectSegment(data, config, styler, compact = false) {
  const { project, agentState } = data;
  const stateColor = styler[agentState.tone] || styler.cyan;
  const dot = stateColor(agentState.dot);

  const projectDisplay =
    config.showSubPath && project.subPath && !compact
      ? `${project.name}/${project.subPath}`
      : project.name;

  let vcsPart = '';
  if (config.showVcs && project.vcs?.branch) {
    const dirtyMark = project.vcs.dirty ? styler.yellow('*') : '';
    const branchText = `${styler.magenta(project.vcs.branch)}${dirtyMark}`;
    vcsPart = ` ${branchText}`;
  }

  return `${dot} ${styler.boldWhite(projectDisplay)}${vcsPart}`;
}

/**
 * 渲染当前模型、思考强度与运行附加信息。
 * 不同模型/系列自动匹配专属主题色，一眼区分当前活跃模型。
 * @param {Record<string, any>} data 归一化后的监控数据
 * @param {Record<string, any>} config 监控配置
 * @param {Record<string, (text: string) => string>} styler 着色器
 * @param {boolean} includeExtras 是否附带思考强度/模式/子代理/任务徽章
 * @returns {string}
 */
function renderModelSegment(data, config, styler, includeExtras = true, includeModeBadge = true) {
  const dot = styler.track('·');
  const baseName = data.model.baseName || data.model.displayName;
  const effortLabel = data.model.effortLabel || '';
  const modelColor = pickModelColor(data.model.displayName || baseName, styler);

  const coreParts = [modelColor(baseName)];
  if (effortLabel) {
    coreParts.push(styler.violet(effortLabel));
  }
  if (includeModeBadge && data.cycleMode) {
    coreParts.push(renderCycleModeBadge(data.cycleMode, styler));
  }

  const parts = [coreParts.join(` ${dot} `)];

  if (includeExtras) {
    if (data.subagentCount > 0) {
      parts.push(styler.cyan(`子代理:${data.subagentCount}`));
    }
    if (data.taskCount > 0) {
      parts.push(styler.yellow(`任务:${data.taskCount}`));
    }
  }

  return parts.join('  ');
}

/**
 * 渲染上下文占用片段（垂直居中进度条 + 柔和语义配色）。
 * @param {Record<string, any>} data 归一化后的监控数据
 * @param {Record<string, any>} config 监控配置
 * @param {Record<string, (text: string) => string>} styler 着色器
 * @param {number} barWidth 进度条格数（0 表示不显示进度条）
 * @param {boolean} [showTokenRatio=true] 是否显示 token 比例
 * @returns {string}
 */
function renderContextSegment(data, config, styler, barWidth, showTokenRatio = true) {
  const { context } = data;
  const colorFn = pickContextColor(context.usedPercentage, config.thresholds, styler);
  const pctStr = colorFn(formatPercent(context.usedPercentage, true));

  const pieces = [styler.subtle('CTX')];
  if (barWidth > 0) {
    pieces.push(renderBar(context.usedPercentage, barWidth, config.barStyle, colorFn, styler));
  }
  pieces.push(pctStr);

  if (showTokenRatio && context.windowSize) {
    const tokenRatio = `${formatTokens(context.usedTokens)}/${formatTokens(context.windowSize)}`;
    pieces.push(`${styler.track('·')} ${styler.subtle(tokenRatio)}`);
  }

  if (context.exceeds200k) {
    pieces.push(styler.boldYellow('>200K'));
  }

  return pieces.join(' ');
}

/**
 * 渲染会话 Token 消耗（输入/输出）与生成速率（tok/s）。
 * @param {Record<string, any>} data 归一化后的监控数据
 * @param {Record<string, any>} config 监控配置
 * @param {Record<string, (text: string) => string>} styler 着色器
 * @param {{ compact?: boolean, detailed?: boolean }} [options] 排版紧凑度选项
 * @returns {string}
 */
function renderTokenMetricsSegment(data, config, styler, options = {}) {
  const showUsage = config.showTokenUsage !== false;
  const showSpeed = config.showTokenSpeed !== false;
  if (!showUsage && !showSpeed) return '';

  const compact = Boolean(options.compact);
  const detailed = Boolean(options.detailed);
  const parts = [];

  if (showUsage) {
    const inTok = data.context.totalInputTokens ?? data.context.currentInput ?? 0;
    const outTok = data.context.totalOutputTokens ?? data.context.currentOutput ?? 0;
    const totalTok = inTok + outTok;

    if (compact) {
      const valColor = totalTok > 0 ? styler.white : styler.subtle;
      parts.push(`${valColor(formatTokens(totalTok))}${styler.subtle('tok')}`);
    } else {
      const inValColor = inTok > 0 ? styler.muted : styler.subtle;
      const outValColor = outTok > 0 ? styler.white : styler.subtle;
      let usageStr = `${styler.subtle('↑')}${inValColor(formatTokens(inTok))} ${styler.subtle('↓')}${outValColor(formatTokens(outTok))}`;
      if (detailed && totalTok > 0) {
        usageStr = `${styler.subtle('消耗')} ${usageStr} ${styler.subtle(`共${formatTokens(totalTok)}`)}`;
      }
      parts.push(usageStr);
    }
  }

  if (showSpeed) {
    const tps = data.telemetry?.tokensPerSecond ?? null;
    const isLive = Boolean(data.telemetry?.isLive);
    const rateText = formatTokenRate(tps);
    const unit = compact ? 't/s' : 'tok/s';

    if (isLive && tps > 0) {
      parts.push(`${styler.boldTeal(rateText)} ${styler.teal(unit)}`);
    } else if (tps !== null && tps > 0) {
      parts.push(`${styler.muted(rateText)} ${styler.subtle(unit)}`);
    } else {
      parts.push(styler.subtle(`${rateText} ${unit}`));
    }
  }

  return parts.join(` ${styler.track('·')} `);
}

/**
 * 渲染套餐徽章（紧凑模式精简为 ✦ Ultra / ✦ Pro，详细模式保留全称）。
 * @param {string | null} planTier 套餐名
 * @param {Record<string, (text: string) => string>} styler 着色器
 * @param {boolean} [compact=true] 是否紧凑化
 * @returns {string}
 */
function renderPlanTierBadge(planTier, styler, compact = true) {
  const text = formatPlanTier(planTier, compact);
  if (!text) return '';
  return `${styler.gold('✦')} ${styler.gold(text)}`;
}

/**
 * 渲染单个配额桶片段（5h 或 周限额），去除括号噪音并建立清晰主次层次。
 * @param {Record<string, any>} bucket 归一化配额桶
 * @param {Record<string, any>} config 监控配置
 * @param {Record<string, (text: string) => string>} styler 着色器
 * @param {number} barWidth 进度条格数
 * @param {boolean} showReset 是否显示重置倒计时
 * @param {boolean} showClock 是否显示具体本地重置时刻
 * @param {boolean} [alignPercent=false] 是否将百分比右对齐至 4 列（详细看板对齐）
 * @returns {string}
 */
function renderBucketSegment(
  bucket,
  config,
  styler,
  barWidth,
  showReset,
  showClock,
  alignPercent = false,
) {
  const showUsed = config.quotaDisplay === 'used';
  const metricPct = showUsed ? bucket.usedPercent : bucket.remainingPercent;
  const barColorFn = pickQuotaColor(bucket.remainingPercent, config.thresholds, styler);
  const pctColorFn =
    bucket.remainingPercent !== null && bucket.remainingPercent <= (config.thresholds?.quotaWarnRemaining ?? 50)
      ? barColorFn
      : (styler.boldGreen || styler.green);

  const label = styler.muted(bucket.windowLabel);
  const bar = barWidth > 0 ? renderBar(metricPct, barWidth, config.barStyle, barColorFn, styler) : '';

  const pctPrefix = showUsed ? '用' : '';
  const rawPctText = `${pctPrefix}${formatPercent(metricPct)}`;
  const paddedPctText = alignPercent ? rawPctText.padStart(4) : rawPctText;
  const pct = pctColorFn(paddedPctText);

  let resetStr = '';
  if (showReset) {
    const countdown = formatDuration(bucket.resetInSeconds);
    const clock = showClock ? formatLocalResetClock(bucket.resetTime) : '';
    if (countdown && clock) {
      resetStr = `${styler.subtle(countdown)} ${styler.track(clock)}`;
    } else if (countdown) {
      resetStr = styler.subtle(countdown);
    } else if (clock) {
      resetStr = styler.subtle(clock);
    }
  }

  return [label, bar, pct, resetStr].filter(Boolean).join(' ');
}

/**
 * 按终端宽度将多个片段智能排布成单行或多行（优先保持在单行内，过宽时自然分组换行）。
 * @param {string[]} segments 片段列表
 * @param {string} sep 分隔符
 * @param {number} maxWidth 终端最大宽度
 * @param {boolean} colorEnabled 是否启用颜色
 * @returns {string[]}
 */
function wrapSegments(segments, sep, maxWidth, colorEnabled) {
  if (segments.length === 0) return [];
  const sepWidth = displayWidth(sep);
  const lines = [];
  let current = '';
  let currentWidth = 0;

  for (const seg of segments) {
    const segWidth = displayWidth(seg);
    if (!current) {
      current = segWidth > maxWidth ? truncateAnsi(seg, maxWidth, colorEnabled) : seg;
      currentWidth = displayWidth(current);
      continue;
    }

    if (currentWidth + sepWidth + segWidth <= maxWidth) {
      current = `${current}${sep}${seg}`;
      currentWidth += sepWidth + segWidth;
    } else {
      lines.push(current);
      current = segWidth > maxWidth ? truncateAnsi(seg, maxWidth, colorEnabled) : seg;
      currentWidth = displayWidth(current);
    }
  }

  if (current) lines.push(current);
  return lines;
}

/**
 * 渲染「两行紧凑仪表盘」模式（默认模式）。
 * 第 1 行：● 项目 分支 │ 彩色模型 · 强度 · 模式 │ CTX 居中进度条 百分比 Token │ ↑入 ↓出 · tok/s │ ✦ 套餐
 * 第 2 行：◆ 模型族 5h 居中进度条 百分比 倒计时 · 周 居中进度条 百分比 倒计时 │ ...
 * @param {Record<string, any>} data 归一化后的监控数据
 * @param {Record<string, any>} config 监控配置
 * @param {Record<string, (text: string) => string>} styler 着色器
 * @returns {string}
 */
function renderCompactMode(data, config, styler) {
  const width = Math.max(40, data.terminalWidth || 120);
  const isWide = width >= 115;
  const isNarrow = width < 85;
  const sep = styler.track(isWide ? '  │  ' : ' │ ');
  const compactSep = styler.track(' │ ');
  const tightDotSep = styler.track(' · ');

  // 第 1 行：项目 + 专属色模型 + 上下文 + Token 消耗/速率 + 套餐/费用
  const ctxBarWidth = isNarrow ? 5 : (config.barWidth?.context ?? 8);
  const tokenMetricsFull = renderTokenMetricsSegment(data, config, styler, { compact: false });
  const tokenMetricsCompact = renderTokenMetricsSegment(data, config, styler, { compact: true });

  const metaBadges = [];
  if (config.showPlanTier && data.planTier && !isNarrow) {
    metaBadges.push(renderPlanTierBadge(data.planTier, styler, true));
  }
  if (config.showCost && data.cost?.totalUsd !== null && !isNarrow) {
    const prefix = data.cost.estimated ? '~$' : '$';
    metaBadges.push(styler.subtle(`${prefix}${data.cost.totalUsd.toFixed(2)}`));
  }

  const buildLine1 = (barW, tokSeg, includeMeta, lineSep, compactProj, includeModelExtras, showCtxRatio) => {
    const parts = [
      renderProjectSegment(data, config, styler, compactProj),
      renderModelSegment(data, config, styler, includeModelExtras, true),
      renderContextSegment(data, config, styler, barW, showCtxRatio),
    ];
    if (tokSeg) parts.push(tokSeg);
    if (includeMeta && metaBadges.length > 0) parts.push(metaBadges.join('  '));
    return parts.join(lineSep);
  };

  let line1 = buildLine1(ctxBarWidth, tokenMetricsFull, true, sep, isNarrow, !isNarrow, true);

  // 逐级自适应压缩，优先保留模型、CTX、Token 消耗与 tok/s 核心指标
  if (displayWidth(line1) > width) {
    const candidates = [
      // 级 1：收紧主分隔符并略缩 CTX 条至 6 格，完整保留全部指标
      buildLine1(Math.min(ctxBarWidth, 6), tokenMetricsFull, true, compactSep, isNarrow, !isNarrow, true),
      // 级 2：将 Token 指标切换为紧凑格式（如 223Ktok · 42.5t/s）
      buildLine1(Math.min(ctxBarWidth, 6), tokenMetricsCompact, true, compactSep, true, !isNarrow, true),
      // 级 3：去掉套餐徽章，保留 CTX 进度条 + 完整 Token/速率
      buildLine1(Math.min(ctxBarWidth, 5), tokenMetricsCompact, false, compactSep, true, false, true),
      // 级 4：去掉 CTX 进度条，保留项目、模型、上下文比例与 Token/速率
      buildLine1(0, tokenMetricsCompact, false, compactSep, true, false, true),
      // 级 5：极窄屏去 Token 比例，保核心模型、彩色模式与 CTX%
      [
        renderProjectSegment(data, config, styler, true),
        [
          pickModelColor(data.model.displayName || data.model.baseName, styler)(
            data.model.baseName || data.model.displayName,
          ),
          data.cycleMode ? renderCycleModeBadge(data.cycleMode, styler) : '',
        ]
          .filter(Boolean)
          .join(` ${styler.track('·')} `),
        renderContextSegment(data, config, styler, 0, false),
      ].join(compactSep),
    ];

    const fitted = candidates.find((c) => displayWidth(c) <= width);
    line1 = fitted || truncateAnsi(candidates[candidates.length - 1], width, config.color);
  }

  // 第 2 行：各模型 5h & 周限额
  if (!data.quotaGroups || data.quotaGroups.length === 0) {
    const line2 = truncateAnsi(
      `${styler.track('◆')} ${styler.subtle('配额')}  ${styler.subtle('等待 agy 推送各模型 5h/周配额数据...')}`,
      width,
      config.color,
    );
    return `${line1}\n${line2}`;
  }

  const buildGroupSegments = (qBarWidth, showReset, innerSep) =>
    data.quotaGroups.map((group) => {
      const groupColor = pickModelGroupColor(group.groupName, styler);
      const bucketStrs = group.buckets.map((bucket) =>
        renderBucketSegment(
          bucket,
          config,
          styler,
          qBarWidth,
          showReset,
          Boolean(config.showExactResetClock),
          false,
        ),
      );
      return `${groupColor('◆')} ${groupColor(group.groupName)}  ${bucketStrs.join(innerSep)}`;
    });

  // 逐级自适应：组内紧凑「 · 」、组间宽「  │  」；装不下依次收紧分隔、缩进度条或换行
  const configuredQBar = config.barWidth?.quota ?? 6;
  let quotaSegments = buildGroupSegments(configuredQBar, Boolean(config.showResetTime), tightDotSep);
  let joinedLine2 = quotaSegments.join(sep);

  if (displayWidth(joinedLine2) > width && isWide) {
    joinedLine2 = quotaSegments.join(compactSep);
  }

  if (displayWidth(joinedLine2) > width && configuredQBar > 4) {
    quotaSegments = buildGroupSegments(4, Boolean(config.showResetTime), tightDotSep);
    joinedLine2 = quotaSegments.join(compactSep);
  }

  if (displayWidth(joinedLine2) > width) {
    const noBarSegments = buildGroupSegments(0, Boolean(config.showResetTime), tightDotSep);
    const noBarJoined = noBarSegments.join(compactSep);
    if (displayWidth(noBarJoined) <= width) {
      return `${line1}\n${noBarJoined}`;
    }
    const wrapped = wrapSegments(quotaSegments, compactSep, width, config.color);
    return [line1, ...wrapped].join('\n');
  }

  return `${line1}\n${joinedLine2}`;
}

/**
 * 渲染「单行极简」模式。
 * 适合小窗口终端，单行清爽展示项目、彩色模型名、上下文百分比、Token 消耗/速率及各模型 5h/周剩余百分比。
 * @param {Record<string, any>} data 归一化后的监控数据
 * @param {Record<string, any>} config 监控配置
 * @param {Record<string, (text: string) => string>} styler 着色器
 * @returns {string}
 */
function renderMinimalMode(data, config, styler) {
  const width = Math.max(36, data.terminalWidth || 100);
  const sep = styler.track(' │ ');
  const showUsed = config.quotaDisplay === 'used';

  const modelColor = pickModelColor(data.model.displayName || data.model.baseName, styler);
  const ctxColor = pickContextColor(data.context.usedPercentage, config.thresholds, styler);
  const ctxPart = `${styler.subtle('CTX')} ${ctxColor(formatPercent(data.context.usedPercentage))}`;
  const tokPart = renderTokenMetricsSegment(data, config, styler, { compact: true });

  const quotaParts = (data.quotaGroups || []).map((group) => {
    const groupColor = pickModelGroupColor(group.groupName, styler);
    const items = group.buckets.map((b) => {
      const pct = showUsed ? b.usedPercent : b.remainingPercent;
      const colorFn = pickQuotaColor(b.remainingPercent, config.thresholds, styler);
      return `${styler.subtle(b.windowLabel)} ${colorFn(formatPercent(pct))}`;
    });
    return `${groupColor(group.shortCode)} ${items.join(styler.track('/'))}`;
  });

  const modelBadge = [
    modelColor(data.model.baseName || data.model.displayName),
    data.cycleMode ? renderCycleModeBadge(data.cycleMode, styler) : '',
  ]
    .filter(Boolean)
    .join(` ${styler.track('·')} `);

  const parts = [
    renderProjectSegment(data, config, styler, true),
    modelBadge,
    ctxPart,
  ];
  if (tokPart) {
    parts.push(tokPart);
  }
  if (quotaParts.length > 0) {
    parts.push(quotaParts.join('  '));
  }

  return truncateAnsi(parts.join(sep), width, config.color);
}

/**
 * 渲染「多行详细看板」模式。
 * 第 1 行：项目/分支/运行态 │ 彩色模型/思考强度/模式 │ ✦ 完整套餐
 * 第 2 行：◈ CTX 居中大进度条 │ 消耗 ↑入 ↓出 · tok/s │ 缓存命中率 │ 费用 │ 产物数
 * 第 3+ 行：每个模型族独立一行、等宽对齐展示 5h 与周限额居中进度条、倒计时与本地重置时刻
 * @param {Record<string, any>} data 归一化后的监控数据
 * @param {Record<string, any>} config 监控配置
 * @param {Record<string, (text: string) => string>} styler 着色器
 * @returns {string}
 */
function renderDetailedMode(data, config, styler) {
  const width = Math.max(50, data.terminalWidth || 120);
  const sep = styler.track('  │  ');
  const lines = [];

  // 第 1 行：项目与运行环境
  const stateColor = styler[data.agentState.tone] || styler.cyan;
  const headerParts = [
    `${renderProjectSegment(data, config, styler, false)} ${styler.track('·')} ${stateColor(data.agentState.label)}`,
    renderModelSegment(data, config, styler, true),
  ];
  if (config.showPlanTier && data.planTier) {
    headerParts.push(renderPlanTierBadge(data.planTier, styler, false));
  }
  if (data.sandboxEnabled) {
    headerParts.push(styler.teal('沙箱'));
  }
  lines.push(truncateAnsi(headerParts.join(sep), width, config.color));

  // 第 2 行：上下文、Token 消耗与生成速率（左侧 ◈ 与上下行 ● / ◆ 垂直对齐）
  const detailBarWidth = config.barWidth?.detailed ?? 10;
  const ctxLineParts = [`${styler.cyan('◈')} ${renderContextSegment(data, config, styler, detailBarWidth)}`];

  const tokenMetrics = renderTokenMetricsSegment(data, config, styler, { detailed: true });
  if (tokenMetrics) {
    ctxLineParts.push(tokenMetrics);
  }
  if (data.context.cacheHitRate !== null) {
    ctxLineParts.push(`${styler.subtle('缓存:')}${styler.cyan(formatPercent(data.context.cacheHitRate))}`);
  }
  if (config.showCost && data.cost?.totalUsd !== null) {
    const prefix = data.cost.estimated ? '~$' : '$';
    ctxLineParts.push(`${styler.subtle('费用:')}${styler.gold(`${prefix}${data.cost.totalUsd.toFixed(3)}`)}`);
  }
  if (data.artifactCount > 0) {
    ctxLineParts.push(styler.subtle(`产物:${data.artifactCount}`));
  }
  lines.push(truncateAnsi(ctxLineParts.join(sep), width, config.color));

  // 第 3+ 行：按模型族逐行对齐展示配额
  if (!data.quotaGroups || data.quotaGroups.length === 0) {
    lines.push(`${styler.track('◆')} ${styler.subtle('配额: 暂无配额桶数据')}`);
  } else {
    const maxNameWidth = Math.max(...data.quotaGroups.map((g) => displayWidth(g.groupName)), 6);
    for (const group of data.quotaGroups) {
      const groupColor = pickModelGroupColor(group.groupName, styler);
      const padSpaces = ' '.repeat(Math.max(0, maxNameWidth - displayWidth(group.groupName)));
      const bucketStrs = group.buckets.map((bucket) =>
        renderBucketSegment(
          bucket,
          config,
          styler,
          Math.min(detailBarWidth, 10),
          Boolean(config.showResetTime),
          true,
          true,
        ),
      );
      const row = `${groupColor('◆')} ${groupColor(group.groupName)}${padSpaces}  ${bucketStrs.join(sep)}`;
      lines.push(truncateAnsi(row, width, config.color));
    }
  }

  return lines.join('\n');
}

/**
 * 主渲染入口：根据配置模式将归一化数据渲染为最终状态栏输出文本。
 * @param {Record<string, any>} data 归一化后的监控数据
 * @param {Record<string, any>} config 监控配置
 * @returns {string}
 */
export function renderStatusLine(data, config) {
  const styler = createStyler(Boolean(config?.color), config?.colorProfile || 'truecolor');
  const mode = String(config?.mode || 'compact').toLowerCase();

  if (mode === 'minimal' || mode === 'single') {
    return renderMinimalMode(data, config, styler);
  }
  if (mode === 'detailed' || mode === 'full') {
    return renderDetailedMode(data, config, styler);
  }
  return renderCompactMode(data, config, styler);
}

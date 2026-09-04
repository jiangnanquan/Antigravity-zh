'use strict';

const ANSI_COLORS = {
  gray: '\x1b[90m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  brightBlack: '\x1b[90m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',
};

function isTrueColorSupported() {
  return (
    process.env.COLORTERM === 'truecolor' ||
    process.env.COLORTERM === '24bit' ||
    process.env.TERM_PROGRAM === 'iTerm.app' ||
    process.env.TERM_PROGRAM === 'vscode' ||
    process.env.TERM_PROGRAM === 'ghostty' ||
    process.env.TERM_PROGRAM === 'WezTerm' ||
    process.env.TERM_PROGRAM === 'Alacritty' ||
    !!process.env.WT_SESSION
  );
}

function getCyberpunkPalette() {
  const trueColor = isTrueColorSupported();
  if (trueColor) {
    return {
      pink: '\x1b[38;2;255;42;133m',       // #FF2A85 霓虹粉紫
      cyan: '\x1b[38;2;0;240;255m',        // #00F0FF 电光青
      yellow: '\x1b[38;2;255;225;53m',     // #FFE135 赛博黄
      green: '\x1b[38;2;0;255;159m',       // #00FF9F 矩阵绿
      red: '\x1b[38;2;255;0;85m',          // #FF0055 故障红
      purple: '\x1b[38;2;120;95;160m',     // #785FA0 暗夜紫（次级元素/分隔符）
      trackDark: '\x1b[38;2;60;50;85m',    // #3C3255 轨道深暗色
      dimGray: '\x1b[38;2;90;80;105m',
    };
  }
  return {
    pink: '\x1b[95m',       // Bright Magenta
    cyan: '\x1b[96m',       // Bright Cyan
    yellow: '\x1b[93m',     // Bright Yellow
    green: '\x1b[92m',      // Bright Green
    red: '\x1b[91m',        // Bright Red
    purple: '\x1b[90m',     // Bright Black / Gray
    trackDark: '\x1b[90m',
    dimGray: '\x1b[90m',
  };
}

const DEFAULT_THRESHOLDS = {
  warning: 0.7,
  critical: 0.9,
};

const DEFAULT_COLUMN_WIDTH = 40;
const QUOTA_CHROME_WIDTH = 21;

const TIER_ABBREVS = { Thinking: 'Th', High: 'H', Medium: 'M', Low: 'L' };

const ABBREVIATION_RULES = [
  [/^Gemini ([\d.]+) (Flash|Pro) \((\w+)\)/, (_, ver, fam, tier) =>
    `Gemini ${ver} ${fam}(${TIER_ABBREVS[tier] || tier[0]})`],
  [/^Claude (\w+) ([\d.]+) \((\w+)\)/, (_, fam, ver, tier) =>
    `${fam} ${ver}(${TIER_ABBREVS[tier] || tier[0]})`],
  [/^GPT-OSS (.+?) \(\w+\)/, (_, spec) => `GPT-OSS ${spec}`],
];

function abbreviateDisplayName(name) {
  for (const [re, replacer] of ABBREVIATION_RULES) {
    const m = re.exec(name);
    if (m) return name.replace(re, replacer);
  }
  return name;
}


function simplifyModelName(name) {
  if (!name) return '';
  return abbreviateDisplayName(name);
}

const COMPACT_NAME_RULES = [
  [/^Gemini [\d.]+ (Flash|Pro) \((\w+)\)/, (_, fam, tier) =>
    `${fam}(${TIER_ABBREVS[tier] || tier[0]})`],
  [/^Claude (\w+) [\d.]+ \((\w+)\)/, (_, fam) => fam],
  [/^GPT-OSS .+/, () => 'GPT'],
];

function compactModelName(displayName) {
  for (const [re, replacer] of COMPACT_NAME_RULES) {
    const m = re.exec(displayName);
    if (m) return displayName.replace(re, replacer);
  }
  return displayName.slice(0, 6);
}

function normalizeModelMatchValue(value) {
  if (!value) return '';
  return simplifyModelName(value)
    .replace(/\s+(preview|experimental|beta|latest)$/i, '')
    .trim()
    .toLowerCase();
}

function modelNamesMatch(left, right) {
  const a = normalizeModelMatchValue(left);
  const b = normalizeModelMatchValue(right);
  if (!a || !b) return false;
  return a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `);
}

function modelIncludesCacheInInput(nameOrId) {
  if (!nameOrId) return false;
  const name = nameOrId.toLowerCase();
  return name.includes('claude') || name.includes('sonnet') || name.includes('opus') || name.includes('haiku') || name.includes('gpt');
}

/**
 * Format a token count into "1.2M", "150k", or "42" (compact).
 * Boundary thresholds use 999950 / 999.5 so the rounding never spits out
 * spike values like "1000k" (regression covered by a unit test).
 */
function formatTokens(n) {
  if (n >= 999950) {
    const val = n / 1000000;
    let str = val.toFixed(1);
    if (str.endsWith('.0')) str = str.slice(0, -2);
    return str + 'M';
  }
  if (n >= 999.5) {
    const val = n / 1000;
    let str = val.toFixed(1);
    if (str.endsWith('.0')) str = str.slice(0, -2);
    if (str === '1000') return '1M';
    return str + 'k';
  }
  return Math.round(n).toString();
}

/** Format seconds into "XhYm" / "Ym" / "now" (compact). */
function formatDuration(secs) {
  if (secs <= 0) return 'now';
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d >= 10) return `${d}d`;
  if (d > 0) return `${d}d${h}h`;
  if (h >= 10) return `${h}h`;
  if (h > 0) return `${h}h${m}m`;
  return `${m}m`;
}

function sanitizeTerminalText(value, maxLength = 120) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/\x1b\][^\x07]*?(?:\x07|\x1b\\|$)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .slice(0, maxLength);
}

/**
 * Format remainingFraction into an integer percentage.
 * Clamps non-100% values (e.g. 0.9953883) to at most 99% so that
 * fractional usage does not get rounded up to 100% and look stuck.
 */
function formatQuotaPercent(fraction) {
  if (fraction === undefined || fraction === null || Number.isNaN(fraction)) return 0;
  if (fraction >= 1) return 100;
  if (fraction <= 0) return 0;
  return Math.min(99, Math.max(0, Math.floor(fraction * 100)));
}

module.exports = {
  ANSI_COLORS,
  DEFAULT_THRESHOLDS,
  DEFAULT_COLUMN_WIDTH,
  QUOTA_CHROME_WIDTH,
  TIER_ABBREVS,
  abbreviateDisplayName,
  simplifyModelName,
  compactModelName,
  normalizeModelMatchValue,
  modelNamesMatch,
  modelIncludesCacheInInput,
  sanitizeTerminalText,
  formatTokens,
  formatDuration,
  formatQuotaPercent,
  isTrueColorSupported,
  getCyberpunkPalette,
};

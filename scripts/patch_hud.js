#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const BACKUP_SUFFIX = '.antigravity-zh.orig';
const REQUIRED_FILES = [
  'renderer/lang.js',
  'renderer.js',
  'renderer/quota-render.js',
  'agy-hud.config.json',
];

function unique(values) {
  return [...new Set(values.map(value => path.resolve(value)))];
}

function discoverRuntimeRoots() {
  if (process.env.ANTIGRAVITY_ZH_HUD_ROOTS) {
    return unique(process.env.ANTIGRAVITY_ZH_HUD_ROOTS.split(path.delimiter).filter(Boolean));
  }

  const home = os.homedir();
  const roots = [
    path.join(home, '.gemini', 'config', 'plugins', 'agy-hud', 'runtime'),
    path.join(home, '.gemini', 'antigravity-cli', 'agy-hud-runtime', 'runtime'),
  ];
  const settingsPath = path.join(home, '.gemini', 'antigravity-cli', 'settings.json');
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const command = settings?.statusLine?.command || '';
    const match = command.match(/["']([^"']*agy-hud\.js)["']/);
    if (match) roots.push(path.dirname(path.dirname(match[1])));
  } catch {
    // The two conventional roots above are still checked below.
  }

  return unique(roots).filter(root => REQUIRED_FILES.every(relative => fs.existsSync(path.join(root, relative))));
}

function gitOriginal(runtimeRoot, relativePath) {
  const pluginRoot = path.dirname(runtimeRoot);
  if (!fs.existsSync(path.join(pluginRoot, '.git'))) return null;
  try {
    return execFileSync('git', ['show', `HEAD:runtime/${relativePath}`], {
      cwd: pluginRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

function ensureBackup(runtimeRoot, relativePath, content) {
  const target = path.join(runtimeRoot, relativePath);
  const backup = target + BACKUP_SUFFIX;
  if (fs.existsSync(backup)) return;

  // The first broken attempt changed the Git checkout before backups existed.
  // Recover HEAD as the pristine backup when this is that checkout.
  const pristine = gitOriginal(runtimeRoot, relativePath);
  fs.writeFileSync(backup, pristine ?? content, { mode: fs.statSync(target).mode });
}

function replaceOnce(source, original, translated, label) {
  if (source.includes(translated)) return source;
  const first = source.indexOf(original);
  if (first < 0) throw new Error(`${label}: expected source text was not found`);
  if (source.indexOf(original, first + original.length) >= 0) {
    throw new Error(`${label}: source text is ambiguous`);
  }
  return source.slice(0, first) + translated + source.slice(first + original.length);
}

function patchLang(source) {
  if (!source.includes("unknownBranch: 'unknown'")) {
    source = replaceOnce(
      source,
      "      quota_fetch_failed: 'quota fetch failed',\n    },\n  },\n  zh: {",
      "      quota_fetch_failed: 'quota fetch failed',\n    },\n    unknownBranch: 'unknown',\n    freePlan: 'Free',\n    unknownModel: 'Unknown Model',\n    tokenIn: 'in: ',\n    tokenOut: 'out: ',\n    tokenCache: 'cache: ',\n    tokensLabel: 'Tokens',\n    quotaLabel: 'Quota: ',\n    imageQuotaExhausted: 'Image Quota Exhausted (Resets in: ',\n    imageQuotaLabel: 'Image Quota: ',\n    rulesCount: 'rules',\n    mcpsCount: 'MCPs',\n    hooksCount: 'hooks',\n    providerOther: 'Other',\n  },\n  zh: {",
      'lang.js English translations',
    );
  }
  if (!source.includes("unknownBranch: '未知'")) {
    source = replaceOnce(
      source,
      "      quota_fetch_failed: '额度获取失败',\n    },\n  },\n};",
      "      quota_fetch_failed: '额度获取失败',\n    },\n    unknownBranch: '未知',\n    freePlan: '免费版',\n    unknownModel: '未知模型',\n    tokenIn: '入: ',\n    tokenOut: '出: ',\n    tokenCache: '缓存: ',\n    tokensLabel: '令牌',\n    quotaLabel: '额度: ',\n    imageQuotaExhausted: '图片额度已耗尽 (重置倒计时: ',\n    imageQuotaLabel: '图片额度: ',\n    rulesCount: '规则',\n    mcpsCount: 'MCPs',\n    hooksCount: 'hooks',\n    providerOther: '其他',\n  },\n};",
      'lang.js Chinese translations',
    );
  }
  return source;
}

function patchRenderer(source) {
  const replacements = [
    ["state.branch || 'unknown'", 'state.branch || text.unknownBranch'],
    ["tierName || agyData?.plan_tier || 'Free'", 'tierName || agyData?.plan_tier || text.freePlan'],
    ["agyData?.model?.id || 'Unknown Model'", 'agyData?.model?.id || text.unknownModel'],
    ['`in: ${formatTokens(displayIn)}`', '`${text.tokenIn}${formatTokens(displayIn)}`'],
    ['`out: ${formatTokens(outTokens)}`', '`${text.tokenOut}${formatTokens(outTokens)}`'],
    ['`cache: ${cacheLabel}`', '`${text.tokenCache}${cacheLabel}`'],
    ["? 'Tokens' : `${tokenIcon}Tokens`", '? text.tokensLabel : `${tokenIcon}${text.tokensLabel}`'],
    ['`${pctColor}Quota: ${pct}%${reset}${timeStr}`', '`${pctColor}${text.quotaLabel}${pct}%${reset}${timeStr}`'],
    ['`${red}${icon}Image Quota Exhausted (Resets in: ${countdownStr})${reset}`', '`${red}${icon}${text.imageQuotaExhausted}${countdownStr})${reset}`'],
    ['`${cyan}${imgIcon}Image Quota: ${bar} ${pctColor}${pct}%${reset}${timeStr}`', '`${cyan}${imgIcon}${text.imageQuotaLabel}${bar} ${pctColor}${pct}%${reset}${timeStr}`'],
    ['`${gray}${rulesCount} rules${reset}`', '`${gray}${rulesCount} ${text.rulesCount}${reset}`'],
    ['`${gray}${mcpCount} MCPs${reset}`', '`${gray}${mcpCount} ${text.mcpsCount}${reset}`'],
    ['`${gray}${hooksCount} hooks${reset}`', '`${gray}${hooksCount} ${text.hooksCount}${reset}`'],
    ['    truncateAndPad,\n  });', '    truncateAndPad,\n    text,\n  });'],
  ];
  for (const [original, translated] of replacements) {
    source = replaceOnce(source, original, translated, `renderer.js ${original}`);
  }
  return source;
}

function patchQuotaRenderer(source) {
  source = replaceOnce(
    source,
    'createProgressBar, truncateAndPad } = ctx;',
    'createProgressBar, truncateAndPad, text } = ctx;',
    'quota-render.js context',
  );
  return replaceOnce(
    source,
    "PROVIDER_LABELS[q.modelProvider] || 'Other'",
    'PROVIDER_LABELS[q.modelProvider] || text.providerOther',
    'quota-render.js provider fallback',
  );
}

function patchConfig(source) {
  const config = JSON.parse(source);
  config.language = 'zh';
  return `${JSON.stringify(config, null, 2)}\n`;
}

function patchRoot(root) {
  const transforms = {
    'renderer/lang.js': patchLang,
    'renderer.js': patchRenderer,
    'renderer/quota-render.js': patchQuotaRenderer,
    'agy-hud.config.json': patchConfig,
  };
  const staged = [];
  for (const relativePath of REQUIRED_FILES) {
    const target = path.join(root, relativePath);
    const source = fs.readFileSync(target, 'utf8');
    ensureBackup(root, relativePath, source);
    staged.push([target, transforms[relativePath](source)]);
  }
  for (const [target, content] of staged) fs.writeFileSync(target, content);
}

function restoreRoot(root) {
  for (const relativePath of REQUIRED_FILES) {
    const target = path.join(root, relativePath);
    const backup = target + BACKUP_SUFFIX;
    if (!fs.existsSync(backup)) throw new Error(`${backup} does not exist`);
    fs.copyFileSync(backup, target);
  }
}

function checkRoot(root) {
  const lang = fs.readFileSync(path.join(root, 'renderer/lang.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  const quota = fs.readFileSync(path.join(root, 'renderer/quota-render.js'), 'utf8');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'agy-hud.config.json'), 'utf8'));
  return config.language === 'zh' &&
    lang.includes("unknownBranch: '未知'") &&
    renderer.includes('text.unknownBranch') &&
    renderer.includes('text.imageQuotaLabel') &&
    quota.includes('text.providerOther');
}

function checkOriginalRoot(root) {
  const lang = fs.readFileSync(path.join(root, 'renderer/lang.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  const quota = fs.readFileSync(path.join(root, 'renderer/quota-render.js'), 'utf8');
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(path.join(root, 'agy-hud.config.json'), 'utf8'));
  } catch {}
  return config.language !== 'zh' &&
    !lang.includes("unknownBranch: '未知'") &&
    !renderer.includes('text.unknownBranch') &&
    !renderer.includes('text.imageQuotaLabel') &&
    !quota.includes('text.providerOther');
}

function applyPreset(root) {
  const presetPath = path.join(__dirname, '..', 'presets', 'agy-hud.config.json');
  if (!fs.existsSync(presetPath)) throw new Error(`预设文件 ${presetPath} 不存在`);
  const target = path.join(root, 'agy-hud.config.json');
  ensureBackup(root, 'agy-hud.config.json', fs.readFileSync(target, 'utf8'));
  fs.copyFileSync(presetPath, target);
}

function main() {
  const mode = process.argv[2] || '--apply';
  const roots = discoverRuntimeRoots();
  if (roots.length === 0) throw new Error('未找到 agy-hud 源码或已部署运行时');
  for (const root of roots) {
    if (mode === '--restore') restoreRoot(root);
    else if (mode === '--check') {
      if (!checkRoot(root)) throw new Error(`${root}: HUD 汉化未完整应用`);
    } else if (mode === '--check-original') {
      if (!checkOriginalRoot(root)) throw new Error(`${root}: HUD 尚未恢复为原版`);
    } else if (mode === '--apply') patchRoot(root);
    else if (mode === '--preset') applyPreset(root);
    else throw new Error(`未知参数: ${mode}`);
    process.stdout.write(`${mode.slice(2)}: ${root}\n`);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`错误: ${error.message}\n`);
  process.exit(1);
}

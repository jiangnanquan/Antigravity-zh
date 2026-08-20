# 架构与汉化原理

## AGY CLI 技术栈

```
agy (Go 编译，Mach-O arm64, ~170MB)
├── TUI 框架：charmbracelet/bubbletea + lipgloss
├── 终端渲染：midterm / termtex / termenv
├── 渲染入口：jetski/cli/render/render.go
│   ├── step_render.go    — 步骤/工具调用渲染
│   └── diff_render.go    — diff 渲染
├── 步骤处理：jetski/cli/steps/steps.go
│   ├── DeriveStepState   — 步骤状态判定
│   └── DeriveStepType    — 步骤类型判定
└── 插件系统：agy-hud (JavaScript, 通过 statusline 集成)
    ├── renderer.js       — HUD 主渲染
    ├── renderer/lang.js  — 多语言文本
    └── renderer/format.js — 格式化工具
```

## 第一层：HUD 插件层（JS，默认保持原版）

HUD 只负责状态栏，不是本项目当前的汉化重点。默认安装和冒烟测试都要求它与首次
备份完全一致；`patch_hud.sh --apply` 仅保留为可选实验能力，推荐状态是
`patch_hud.sh --restore`。

### 多语言框架

`agy-hud` 已内建多语言支持，核心在 `renderer/lang.js`：

```javascript
const LANGUAGE_TEXT = {
  en: { quotaUnavailable: 'Quota unavailable', ... },
  zh: { quotaUnavailable: '额度不可用', ... },
};

function resolveLanguage(config, env = process.env) {
  const language = config?.language;
  if (language === 'en' || language === 'zh') return language;
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || '';
  return /^zh(?:_|-|$)/i.test(locale) ? 'zh' : 'en';
}
```

语言判定优先级：`config.language` > `LC_ALL` > `LC_CTYPE` > `LANG` > 默认 `en`

### 可选实验翻译清单

可选 HUD 补丁会将以下硬编码文本移入 `LANGUAGE_TEXT`：

| 位置 (行号) | 英文原文 | 分类 | 翻译建议 |
|------------|---------|------|---------|
| L129 | `'unknown'` | 分支名兜底 | `'未知'` |
| L141 | `'Free'` | 套餐名兜底 | `'免费版'` |
| L145 | `'Unknown Model'` | 模型名兜底 | `'未知模型'` |
| L239 | `'in: '` | 令牌输入标签 | `'入: '` |
| L239 | `'out: '` | 令牌输出标签 | `'出: '` |
| L242 | `'cache: '` | 令牌缓存标签 | `'缓存: '` |
| L245 | `'Tokens'` | 令牌总量标签 | `'令牌'` |
| L279 | `'Quota: '` | 额度标签 | `'额度: '` |
| L293 | `'Image Quota Exhausted (Resets in: ...)'` | 图片额度耗尽 | `'图片额度已耗尽 (重置倒计时: ...)'` |
| L310 | `'Image Quota: '` | 图片额度标签 | `'图片额度: '` |
| L334 | `'rules'` | 规则数量 | `'规则'` |
| L335 | `'MCPs'` | MCP 数量 | 保留 `'MCPs'` |
| L336 | `'hooks'` | Hooks 数量 | 保留 `'hooks'` |

`quota-render.js` 中：

| 位置 (行号) | 英文原文 | 翻译建议 |
|------------|---------|---------|
| L69 | `'Other'` (provider 兜底) | `'其他'` |

`lang.js` 上游已经提供的 `zh` 条目：

| key | 已有 en 值 | 已有 zh 值 | 状态 |
|-----|-----------|-----------|------|
| `quotaUnavailable` | `'Quota unavailable'` | `'额度不可用'` | ✅ 已有 |
| `quotaLoading` | `'Quota loading'` | `'额度加载中'` | ✅ 已有 |
| `quotaReasons.not_logged_in` | `'not logged into Antigravity'` | `'未登录 Antigravity'` | ✅ 已有 |
| `quotaReasons.expired_token` | `'Antigravity token expired'` | `'Antigravity token 已过期'` | ✅ 已有 |
| `quotaReasons.auth_failed` | `'Antigravity auth failed'` | `'Antigravity 认证失败'` | ✅ 已有 |
| `quotaReasons.quota_fetch_failed` | `'quota fetch failed'` | `'额度获取失败'` | ✅ 已有 |

### 可选汉化方式

1. 扩展 `lang.js` 的 `LANGUAGE_TEXT.zh`，添加上述所有文本
2. 修改 `renderer.js`，将硬编码字符串改为 `text.xxx` 引用
3. 修改 `quota-render.js`，将 `'Other'` 改为从 `lang.js` 获取

这些改动不在默认流程中启用。

---

## 第二层：Go 二进制层

### 字符串存储原理

Go 编译器将所有字符串常量打包到 `__rodata` 段（macOS 上是 `__TEXT,__rodata`），
每个字符串引用由 `(pointer, length)` 二元组表示，存储在 `__DATA` 段。

```
__TEXT,__rodata:  "navigate\0scroll page\0auto approve\0..."
                  ↑ ptr_1    ↑ ptr_2       ↑ ptr_3

__DATA:           [ptr_1, 8]  [ptr_2, 11]  [ptr_3, 12]   ← (ptr, len) 对
```

### 已识别的 TUI 渲染函数

```
render.HintNavigate        — 导航提示
render.HintScrollPage      — 翻页提示
render.HintSubmit           — 提交提示
render.HintSelect           — 选择提示
render.HintConfirm          — 确认提示
render.HintEdit             — 编辑提示
render.HintAmend            — 修改提示
render.HintComplete         — 补全提示
render.HintReview           — 审查提示
render.HintToggle           — 切换提示
render.EscHint              — Esc 返回提示
render.AltScreenHint        — 全屏切换提示
render.AutoApproveHint      — 自动批准提示
render.NavHints             — 导航提示组
render.BuildHeader          — 头部栏构建
render.StatusMarker         — 状态标记
render.RenderSubagentItem   — 子代理条目渲染
render.RenderTaskItem       — 任务条目渲染
render.FormatTime           — 时间格式化
```

### 当前实现：版本锁定的精确偏移替换

旧实现曾对 `navigate`、`select` 等短词执行全文件 `bytes.replace`。在 170MB 的
Go 二进制中，同一个短词可能同时属于 UI、协议、帮助文本和第三方库；全局替换会
误改数百处内容，而且任何字节变化都会使 Google Developer ID 签名失效，最终表现为
macOS 直接 `SIGKILL`（退出码 137）。

当前实现采用以下约束：

1. 同时锁定 `agy --version`、平台和官方文件 SHA-256；
   若当前文件是未知的正式签名版本，即使旧备份仍存在也拒绝覆盖；
2. 通过 Go `pclntab` 恢复渲染函数地址，再由 arm64 反汇编确认字符串地址；
3. 每条翻译记录精确文件偏移和预期英文原文，任一不匹配就整体失败；
4. 中文 UTF-8 字节不得超过原字符串，剩余空间使用空格填充；
5. 若当前文件已被后台增量更新为中英混合状态，则从清单固定的官方 HTTPS 发布包重新
   取得原件，并校验归档 SHA-512、二进制 SHA-256、版本号和 Google Developer ID；
6. 在同目录临时文件上 patch、签名和冒烟，全部通过后才原子替换 `agy`；
7. patch 后使用 ad-hoc hardened-runtime 签名，Google 原签名版本按版本保留为
   `agy.zh-backup-<version>`，可一键恢复；已有旧备份不会被覆盖。

斜杠菜单中的普通命令说明来自二进制；`agy-customizations`、
`antigravity-guide` 和 `migrate-workflows` 等系统 Skill 则从
`~/.gemini/antigravity-cli/builtin/skills/` 的已解包 `SKILL.md` 读取。
`patch_skill_descriptions.sh` 只替换清单声明文件的 YAML `description`，保留正文与
独立备份，避免把 Skill 正文误当成菜单说明整体翻译。

这不是完整的上游国际化框架。超过原字节长度、无法唯一定位或尚未经过真实界面确认的
文本会保留英文，安全性优先于覆盖率。

## 验证分层

| 层级 | 命令或证据 | 能证明什么 |
|---|---|---|
| 清单预检 | `patch_binary.sh --dry-run` | 版本、平台、SHA-256、偏移原文和字节预算匹配 |
| 安装状态 | `patch_binary.sh --status`、`patch_skill_descriptions.sh --check` | 当前安装内容与清单一致 |
| 系统冒烟 | `smoke_test.sh` | 签名、版本、帮助文本、Skill 说明和 HUD 默认状态正常 |
| 真实 TUI | 启动 `agy` 后输入 `/` | 菜单布局、中文显示和快捷键提示实际可用 |
| HUD 上游测试 | 在 agy-hud 源码运行 `npm test` | 恢复原版后没有破坏插件自身行为 |

前三级可以自动化；真实 TUI 仍是发布前必需的主机验收。网络登录失败需要与补丁回归
分开判断，不能把 TLS、OAuth 或服务端故障归因于汉化文本。

---

## 安全设计

| 机制 | 说明 |
|------|------|
| 备份/恢复 | 按版本保留 Google 原签名 `.zh-backup-<version>`，`--restore` 原子还原 |
| 版本锁定 | 版本、平台、SHA-256、逐条偏移四重校验 |
| HUD 原版校验 | 同时检查插件源码与 `settings.json` 指向的已部署运行时 |
| 失败关闭 | 任一二进制条目不匹配就拒绝整个 patch，不做部分安装 |
| 冒烟测试 | 校验签名、版本、中文帮助标题和 HUD 原版输出 |

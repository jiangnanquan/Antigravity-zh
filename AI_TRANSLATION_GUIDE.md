# AI 汉化维护指南

本文给出 AI 或人工维护者添加翻译时必须遵守的语言与技术契约。

## 先判断文本来自哪里

| 界面文本 | 来源 | 处理方式 |
|---|---|---|
| 斜杠命令右侧说明、TUI 标签、权限和工具状态 | Go 二进制只读数据段 | 添加精确偏移记录 |
| `/agy-customizations`、`/antigravity-guide` 右侧说明 | 已解包内置 `SKILL.md` 的 YAML `description` | 添加精确文本记录 |
| 底部状态栏 | `agy-hud` JavaScript 插件 | 默认不汉化 |

无法确认来源时先用真实 TUI 复现，再定位；不要猜测。

## 翻译规则

- 命令、别名和 flags 保持不变：`/resume`、`(switch)`、`--add-dir`。
- 快捷键按键保持不变：`enter`、`tab`、`ctrl+c`；只翻译其动作，如“选择”“补全”。
- 品牌、模型和协议名保持不变：Antigravity、AGY、Gemini、Google、MCP、CLI、SDK。
- 格式占位符必须原样保留：`%s`、`%q`、`%d`、`%v`、`<query>`。
- 路径、文件名、代码符号和环境变量不得翻译。
- 菜单说明使用简短的动宾短语，例如“查看后台任务”，避免解释性长句。
- 优先使用项目既有术语：agent → 代理，artifact → 产物，context → 上下文，quota → 额度，reasoning effort → 推理强度。

## 二进制字节预算

二进制补丁不修改 Go 字符串长度字段，因此必须满足：

```text
len(中文译文.encode("utf-8")) <= len(英文原文.encode("utf-8"))
```

脚本会用空格填满剩余字节。任何超长译文都应先缩写，不得截断 UTF-8 字符，也不得修改相邻字符串。

## 新增二进制翻译

每条 `i18n/binary-translations.json` 记录必须包含：

```json
{
  "offset": "0x00000000",
  "en": "Exact English text",
  "zh": "精确中文",
  "context": "它在真实界面中的用途"
}
```

验收顺序：

1. 从官方原签名备份确认英文原文和偏移；
2. 检查偏移不重复、译文字节不超长；
3. 运行 `bash scripts/patch_binary.sh --dry-run`；
4. 应用补丁并运行 `bash scripts/smoke_test.sh`；
5. 在真实 TUI 中确认目标文本出现，且相邻文本没有异常。

## 新增 Skill 说明翻译

只替换 YAML frontmatter 的 `description`，不要翻译 Skill 正文。正文可能包含对代理有约束力的使用说明，菜单汉化不应改变其语义或行为。

## 禁止事项

- 禁止 `bytes.replace()` 扫描整个二进制；
- 禁止为了让补丁通过而跳过 SHA-256、版本、签名或原文校验；
- 禁止把本机已安装文件作为唯一改动，必须同步更新仓库清单和脚本；
- 禁止以“程序能启动”代替真实菜单和回滚验收；
- 禁止在仓库中记录 OAuth token、账号邮箱、对话日志或崩溃日志。

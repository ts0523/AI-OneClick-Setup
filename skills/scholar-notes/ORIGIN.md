# scholar-notes（学霸笔记）— 来源与致谢

>本技能**不是**本项目原创。它是 **UncleCheng-li** 的开源作品，
> 本仓库只是**原样收录**并做了少量适配。感谢作者的公开。

## 原始来源

| 项 | 内容 |
| --- | --- |
| **技能名** | 学霸笔记（收录时改名为 `scholar-notes`） |
| **原作者** | **UncleCheng-li** |
| **原仓库** | https://github.com/UncleCheng-li/AI_Animation |
| **原路径** | `skills/scholar-notes/` |
| **同作者的独立仓库** | https://github.com/UncleCheng-li/note-skill（同一作品的单技能版本） |
| **许可** | MIT License, Copyright (c) 2026 UncleCheng（见本目录 `LICENSE`） |
| **收录方式** | 按 MIT 条款使用，保留原 `LICENSE` 与全部版权声明 |

## 收录时做了哪些改动（正文一字未改）

为了让它能在本仓库的技能库里正常加载，只动了三处**结构性**内容：

| # | 改动 | 为什么| 是否碰过正文 |
| --- | --- | --- | --- |
| 1 | 目录名 `scholar-notes/` 保持不变，改为补齐 frontmatter 使其能独立加载 | 与本仓库其他技能的元数据格式对齐 | 否 |
| 2 | frontmatter 里 `trigger_words:` → `triggers:`、`name`/`description` 加引号、补`version` | 与本仓库其他技能的元数据格式对齐 | 否 |
| 3 | `README.md` 里的安装路径改为通用「技能库」目录、`git clone` 改为 `npx skills add` | 原路径写死了作者的 `~/.workbuddy/skills/`，换机器就失效 | 仅README |

**已用git blob SHA 逐文件核验**（`git hash-object` vs GitHub API `.sha`）：

| 文件 | 核验结果 |
| --- | --- |
| `LICENSE` | 与上游**逐字节一致** |
| `assets/template.html` | 与上游**逐字节一致** |
| `references/layouts.md` | 与上游**逐字节一致** |
| `SKILL.md` | 仅 frontmatter 键位差异，正文一致 |
| `README.md` | 仅安装说明差异 |

> 另：本目录下的 `examples/style-a/`（5 个）与 `examples/style-b/`（3 个）
> 是运行该技能产出的示例笔记，用于展示效果。

## 使用须知

1. **必须保留本文件与 `LICENSE`。** MIT 协议要求保留原始版权声明，删掉任何一处都是违约。
2. **原作者署名是 UncleCheng-li。** 转载、二次分发、二次创作时请沿用这个署名，
   不要改成`ts0523` 或本仓库的名字 —— 那会把别人的作品说成自己的。
3. **不要把本技能计入「本项目原创」。** 仓库的统计口径是20 个原创 + 42 个第三方收录，
   `scholar-notes` 属于后者。
4. **不会自动更新。** 上游有新版本时需自行取回并重新比对。
5. **上游仓库可能已改名或下线。** 若链接失效，本文件里的署名信息与
   `LICENSE` 中的版权声明仍作为署名依据保留。

## 致谢

感谢 **UncleCheng-li** 公开了这个作品，本项目才得以收录使用。
如果你觉得这个技能好用，欢迎去原仓库点个 Star：
<https://github.com/UncleCheng-li/AI_Animation>

---
*本文件（`ORIGIN.md`）由整理者在收录时添加，用于署名与溯源，不修改原作者的任何内容。*

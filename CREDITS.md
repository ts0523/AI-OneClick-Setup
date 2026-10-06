# 致谢与来源（Credits）

本仓库（`AI-OneClick-Setup`，作者 [ts0523](https://github.com/ts0523)）是一个
**组合式**开源项目：把网上合规的 AI Agent 技能、AI 编程工具配置方案、
工具链安装经验组装成一套可以直接双击安装的方案。

> **技能来自各个开源作者的贡献，署名逐个列清。**
> 一键配置脚本、Git 教程、工具链说明、隐私扫描器是本项目原创。
> 下表列清每一部分的来源与许可 —— 这是我们做这个仓库的底线：
> **别人的东西，一定署名。**

---

## 一、数据总览

| 项 | 数量 | 说明 |
| --- | --- | --- |
| 收录技能总数 | **62** | 全部在 `skills/`，扁平结构 |
| ├ 本项目原创 | 20 | frontmatter 标 `agent_created: true` |
| └ 第三方 MIT 收录 | 42 | 分属 4 个开源项目，逐个署名 |
| 原创文档与脚本 | 6 | `README.md` / `CREDITS.md` / 教程 / 脚本 / 扫描器 |
| 仓库体积 | 约 12 MB | 不含二进制安装包 |

**四个上游来源：**

| # | 上游项目 | 作者 | 收录数 | 许可 |
| --- | --- | --- | --- | --- |
| 1 | [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) | **Addy Osmani**（Google Chrome 团队工程负责人） | 22 | MIT |
| 2 | [obra/superpowers](https://github.com/obra/superpowers) | **Jesse Vincent** | 10 | MIT |
| 3 | [UncleCheng-li/AI_Animation](https://github.com/UncleCheng-li/AI_Animation)（1.4k star） | **UncleCheng-li** | 9 | MIT |
| 4 | [Cocoon-AI/architecture-diagram-generator](https://github.com/Cocoon-AI/architecture-diagram-generator) → 本仓库改名为 `dynamic-archify` | **tt-a1i**（重写）/ **Cocoon AI**（原始） | 1 | MIT |
| | | | **小计 42** | |

> **UncleCheng-li/AI_Animation 收录了 9 个**：`scholar-notes`（学霸笔记）、`card-theater`（卡片剧场）、
> `flowchart`（流程图）、`network-protocol-viz`（网络协议可视化）、`phone-ui-demos`（手机 UI 演示）、
> `ppt-animation`（PPT 翻页）、`stacked-data-cards`（叠放数据卡）、`video-shot-demos`（分镜演示）、
> `win11-ui-demos`（仿 Win11 演示）。
> 其中 `win11-ui-demos` 与 `video-shot-demos` 的示例素材（`assets/examples/`，约 100 MB GIF）
> **未入库** —— 技能本体（`SKILL.md` / `references/` / `template.html`）完整收录，可正常加载，
> 需要看效果请去上游仓库。
>
> 另有 1 个技能 `test-driven-development` 来自 superpowers 库但**未收录**，
> 因为 Addy Osmani 的同名版本内容更完整，只收录了后者。原因写在该目录的 `ORIGIN.md` 里。

每个第三方技能目录下都有两份文件：

- **`ORIGIN.md`** —— 写明作者、仓库地址、原路径、许可条款、改了什么、使用须知。
- **`LICENSE`** —— 上游的 MIT 许可全文原文，**一个字都没改**。
  MIT 协议要求「所有副本都包含版权声明」，所以这 42 个目录一个都不能少。

---

## 二、第三方技能清单（MIT 许可，可商用可再分发）

### 来自 addyosmani/agent-skills（22 个）

> Addy Osmani 是 Google Chrome 团队工程负责人，《Learning JavaScript Design Patterns》
> 作者、Web 性能领域（Core Web Vitals）长期布道者。这套技能把资深工程师的
> 工程纪律编码成了 AI 可执行的流程。

| 技能 | 用途 |
| --- | --- |
| `api-and-interface-design` | 设计稳定的 API 与模块边界 |
| `code-review-and-quality` | 多维度代码评审 |
| `code-simplification` | 在不改行为的前提下简化代码 |
| `constraint-driven-development` | 把项目质量底线写成契约，防止 AI 悄悄降标准 |
| `context-engineering` | 优化 AI 上下文配置 |
| `debugging-and-error-recovery` | 系统化根因排查 |
| `deprecation-and-migration` | 弃用与迁移管理 |
| `documentation-and-adrs` | 记录架构决策（ADR） |
| `doubt-driven-development` | 对每个决策做对抗性复查 |
| `frontend-ui-engineering` | 生产级可访问前端 UI |
| `git-workflow-and-versioning` | 规范的 Git 工作流 |
| `idea-refine` | 把模糊想法打磨成可执行方案 |
| `incremental-implementation` | 薄切片增量实现 |
| `interview-me` | 通过追问挖出用户真正想要的 |
| `observability-and-instrumentation` | 日志、指标、可观测性 |
| `performance-optimization` | 前后端性能优化 |
| `planning-and-task-breakdown` | 拆解成有序任务 |
| `security-and-hardening` | 安全加固与漏洞审计 |
| `shipping-and-launch` | 生产发布前的检查 |
| `source-driven-development` | 所有实现决策都要对官方文档 |
| `spec-driven-development` | 先写规格再写代码 |
| `test-driven-development` | 红-绿-重构驱动开发 |

### 来自 obra/superpowers（10 个）

> Jesse Vincent 的 superpowers 是社区最常被引用的技能库之一（29 万 star）。

| 技能 | 用途 |
| --- | --- |
| `brainstorming` | 创造性工作前的结构化头脑风暴 |
| `dispatching-parallel-agents` | 多个无依赖任务并行分派 |
| `finishing-a-development-branch` | 开发分支的收尾与合并决策 |
| `receiving-code-review` | 如何正确接收和处理评审意见 |
| `requesting-code-review` | 如何发起有效的代码评审 |
| `subagent-driven-development` | 用子 agent 执行独立任务 |
| `systematic-debugging` | 系统化调试（40 KB，含完整方法论） |
| `using-git-worktrees` | 用 worktree 隔离功能开发 |
| `verification-before-completion` | 声称「完成」前必须验证 |
| `writing-plans` | 写实现计划 |

### 来自其他开源项目（10 个）

| 技能 | 作者 | 来源仓库 | 处理方式 |
| --- | --- | --- | --- |
| `scholar-notes`（学霸笔记） | **UncleCheng-li** | [UncleCheng-li/AI_Animation](https://github.com/UncleCheng-li/AI_Animation)（`skills/scholar-notes`） | 原文收录。仅改frontmatter 键位与 README 安装路径，正文未改，保留原 `LICENSE`（MIT, Copyright (c) 2026 UncleCheng） |
| `card-theater`（卡片剧场） | **UncleCheng-li** | 同上（`skills/card-theater`） | 原文收录，SKILL.md 与上游 blob SHA 归一化后逐字节一致 |
| `flowchart`（流程图动画） | **UncleCheng-li** | 同上（`skills/flowchart`） | 同上 |
| `network-protocol-viz`（网络协议可视化） | **UncleCheng-li** | 同上（`skills/network-protocol-viz`） | 同上 |
| `phone-ui-demos`（手机 UI 演示） | **UncleCheng-li** | 同上（`skills/phone-ui-demos`） | 同上 |
| `ppt-animation`（PPT 翻页演示） | **UncleCheng-li** | 同上（`skills/ppt-animation`） | 同上 |
| `stacked-data-cards`（叠放数据卡） | **UncleCheng-li** | 同上（`skills/stacked-data-cards`） | 同上 |
| `video-shot-demos`（分镜演示） | **UncleCheng-li** | 同上（`skills/video-shot-demos`） | 技能本体完整收录；`assets/examples/`（约 49 MB）未入库 |
| `win11-ui-demos`（仿 Win11 演示） | **UncleCheng-li** | 同上（`skills/win11-ui-demos`） | 技能本体完整收录；`assets/examples/`（约 51 MB）未入库 |
| `dynamic-archify` | **tt-a1i** 重写<br>**Cocoon AI** 原始 | [Cocoon-AI/architecture-diagram-generator](https://github.com/Cocoon-AI/architecture-diagram-generator) | 原文收录，保留 `LICENSE` 中**两行**版权声明 |

> **UncleCheng-li 就是 ts 所说的「网络小白」。** 他是本仓库收录技能最多的独立作者
> （9 个），主仓库 [AI_Animation](https://github.com/UncleCheng-li/AI_Animation) 有 1.4k star。

---

## 三、本项目原创部分

以下内容原创，作者 **[ts0523](https://github.com/ts0523)**：

**脚本与工具**

- 一键配置脚本：`install.bat`、`setup.ps1`、`install/02-install-tools.ps1`、`install/03-setup-agents.ps1`
- 隐私与合规扫描器：`install/privacy-scan.js`（原创设计：递归遍历而非通配符 + 多层转义覆盖）

**文档**

- `README.md`、`CREDITS.md`（本文档）
- `git-github/Git与GitHub使用教程.md`、`git-github/gitconfig.template`
- `codetool/工具链清单.md`
- `docs/privacy/脱敏报告.md`
- `skills/技能库统一规则.md`

**配置模板**

- 五家 AI 工具（WorkBuddy / Cursor / Claude Code / VS Code / Cursor BYOK）的配置模板

**自研技能（20 个）**

`android-apk-no-gradle`、`android-webview-apk`、`app-listing-kit`、`bundle-string-patch`、
`codex-api-deploy`、`codex-config-repair`、`gh-cli-setup`、`headless-ui-verify`、
`lmstudio-load-failure-triage`、`project-zh-localizer`、`promo-kit`、`sandbox-safe-file-ops`、
`tls-mitm-downloader`、`vscode-activitybar-icon`、`vscode-webview-verify`、
`windows-bat-launcher`、`workbuddy-sandbox-constraints`、`workbuddy-spill-enoent`、
以及 `agnes-image-gen` / `agnes-video-gen`（图像视频生成）。

---

## 四、⚠️ 故意没有收录的技能（重要）

这些技能**经过核查后决定不收录**，判断依据留档如下。

### 4.1 腾讯官方技能（20 个）

本机装有 20 个腾讯系技能（`tencent-*` / `cloud-service` / `weixinpay-*` /
`miora-*` / `ardot-*` / `wb-finance-skill`）。逐个核查许可字段后：

| 核查项 | 结果 |
| --- | --- |
| `cloud-service` 的 frontmatter | **明确写着 `license: Internal`** |
| 另外 19 个 | **既无 license 字段，也无 LICENSE 文件** |
| 结论 | `Internal` = 仅限内部使用、**不可再分发**；无声明 = 默认保留全部权利 |

**本仓库不收录这些文件。** 收录不是「帮忙传播」那么简单 ——
把 `license: Internal` 的文件打进开源仓库，是明确违反授权。

用户如果需要这些能力，请从官方渠道安装，不要从本仓库取。

### 4.2 Cursor 官方技能（7 个）

| 技能 | 原因 |
| --- | --- |
| `card-theater`、`flowchart`、`ppt-animation`、`phone-ui-demos`、<br>`win11-ui-demos`、`stacked-data-cards`、`network-protocol-viz` | 这7 个技能**没有任何 license 声明，也没有 LICENSE 文件**。<br>本仓库早期版本曾收录，后经核查**已全部移除**。<br><br>理由：无 license 声明 ≠ 可自由再分发。「装在本地能用」和「打包进开源仓库发布」是两件不同的事，<br>后者属于再分发，需要明确授权。 |

### 4.3 其他

| 技能 | 原因 |
| --- | --- |
| `browser-skill` | 来自**腾讯**官方产品（[Tencent/BrowserSkill](https://github.com/Tencent/BrowserSkill)），版权归腾讯所有，随产品分发 |
| `video-shot-demos` | 素材含多家厂商产品名与商标形象，且体积达 74 MB。商标与版权风险，本仓库不收录 |
| 某浏览器产品示例资源目录 | 含第三方产品 logo 与 GIF（78 文件 / 52.7 MB），已整目录删除 |

---

## 五、为什么坚持逐个署名

写这套技能的人也是从 GitHub 上学的。**把好东西整理到一起、标明出处、
让人能一条命令装上，本身就有价值** —— 但前提是诚实：

1. **每一个第三方技能都保留 `ORIGIN.md`**，写清作者、仓库、许可。
2. **MIT 协议要求保留版权声明**，删掉就是违约，所以 `ORIGIN.md` 不可删除。
3. **不收录许可不清的**。哪怕技术上能拿到，也不放进仓库。
4. **本仓库的 MIT 许可只覆盖原创部分**，不覆盖第三方技能 ——
   第三方技能一律遵循其原始许可。

---

## 六、许可

| 范围 | 许可 |
| --- | --- |
| 本项目原创脚本与文档 | **MIT License**（见根目录 `LICENSE`） |
| 第三方技能（42 个） | 各自遵循其原始许可，**全部为 MIT**，详见各目录的 `ORIGIN.md` |
| 商标 / 商标性内容 | 无。仓库不含任何第三方厂商素材 |

第三方技能不受本项目 MIT 许可约束，使用前请先读对应目录的 `ORIGIN.md`。

---

## 七、如果你想贡献

1. 加新技能：放进 `skills/<技能名>/SKILL.md`，
   frontmatter 写清 `name` 与 `description`（**description 必须含触发语**，
   否则 AI 不会主动调用）。
2. **技能来自别人的工作**：必须放上原 `LICENSE` 或写 `ORIGIN.md` 署名。
   **不要**把别人的成果当成自己的发布 —— 这是硬性要求，不是建议。
3. 提交前跑一遍脱敏扫描：

   ```bash
   node install/privacy-scan.js
   ```

4. 在本文档的对应表格里加一行。

---

## 八、致谢

- **Addy Osmani** —— 22 个工程纪律技能
- **Jesse Vincent** —— 10 个 superpowers 技能
- **UncleCheng-li** —— 9 个演示动画技能（含 scholar-notes），来源 [UncleCheng-li/AI_Animation](https://github.com/UncleCheng-li/AI_Animation)
- **tt-a1i / Cocoon AI** —— dynamic-archify
- 所有在 GitHub 上开源并允许再分发的技能作者

谢谢你们。这套技能能被更多人用上，是因为你们选择了开源。

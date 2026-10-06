# swiss-shot-demos — 来源与致谢

> 本技能**不是**本项目原创。它是 **UncleCheng-li** 的开源作品，
> 本仓库只是收录并做了少量适配。感谢作者的公开。

## 原始来源

| 项 | 内容 |
| --- | --- |
| **技能名** | `swiss-shot-demos`（瑞士风格 + 图表驱动的分镜演示动画） |
| **原作者** | **UncleCheng-li** |
| **原仓库** | https://github.com/UncleCheng-li/AI_Animation |
| **原路径** | `skills/swiss-shot-demos/` |
| **许可** | MIT License, Copyright (c) 2026 Unclecheng（见本目录 `LICENSE`） |
| **收录方式** | 按 MIT 条款使用，保留原 `LICENSE` 与全部版权声明 |

## 收录时做了哪些改动

**技能内容未做任何修改。** 已用 git blob SHA 核验：

| 文件 | 核验结果 |
| --- | --- |
| `SKILL.md` | 与上游**逐字节一致**（blob SHA `efdd9c118fead9ec6eae62b2e30325782e0a4e62`） |

其余 `references/`、`assets/`、`README.md` 均从上游按原始字节下载，未做任何编辑。

### 素材取舍

1. **`assets/examples/` 未收录**（约 22 MB 的 GIF 与成品页）。
   需要完整示例请前往原仓库：
   <https://github.com/UncleCheng-li/AI_Animation/tree/main/skills/swiss-shot-demos>
2. **`assets/chart-skills/` 已完整收录**，内含两个嵌套技能包：
   `archify`（图表渲染）与 `diagram-design`（图表设计）。
   两者**各自带有独立的 `LICENSE`**，其中 `archify` 的版权为
   **Copyright (c) 2026 tt-a1i**（与本技能作者不同）。
   `archify` 还带一份 `THIRD_PARTY_NOTICES.md`，逐条记录了它内部引用的第三方素材
   及其许可，**请务必保留该文件**。
   **这些文件按原样保留，其版权归属不受本仓库的署名影响。**
   （`diagram-design` 原本只有 frontmatter 声明 `license: MIT` 而缺少 LICENSE 文件，
   本仓库按其声明补齐了一份。）

## ⚠️ 关于 `archify` 内的第三方商标素材

`archify/THIRD_PARTY_NOTICES.md` 记录它引用了若干第三方品牌的矢量素材，
其中**至少两项不是 MIT**：

| 素材 | 许可 | 备注 |
| --- | --- | --- |
| Jenkins 商标 | `CC-BY-SA-3.0` | 需署名 + 同方式共享；Jenkins 保留商标权 |
| Vue.js 商标 | `CC-BY-NC-SA-4.0` | **含非商业（NC）条款** |

**这意味着本目录并非「可直接用于商业用途」的干净 MIT 代码。**
如果你的项目要商用、或要注册商标、或是企业对外分发产品，
**请先移除或替换 `archify/brand-marks/` 里对应的素材文件**，
只保留 MIT 授权的代码部分。详细条款见 `archify/THIRD_PARTY_NOTICES.md`。

> 上游作者已在该文件中做了标注，本仓库原样保留、未做任何删改，
> 以维持「原样收录」与溯源完整性。是否移除由使用者自行判断。

## 使用须知

1. **必须保留本文件与 `LICENSE`。** MIT 协议要求保留原始版权声明。
2. **原作者署名是 UncleCheng-li**；嵌套的 `archify` 属**tt-a1i**。
   转载、二次分发时请分别沿用对应署名，不要统一改成 `ts0523`。
3. **不要把本技能计入「本项目原创」。** 统计口径见 `docs/skills-manifest.json`。
4. **不会自动更新。** 上游有新版本时需自行取回并重新比对。
5. **商用前先读上面那节商标素材说明。**

## 致谢

感谢 **UncleCheng-li** 公开了这个作品；嵌套的 `archify` 由 **tt-a1i** 贡献。
欢迎去原仓库点个Star：
<https://github.com/UncleCheng-li/AI_Animation>

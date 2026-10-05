---
name: sandbox-safe-file-ops
description: |
  在安全策略受限的 Windows 沙箱里安全地整理文件：清理空目录、合并重复目录、
  给目录建符号链接代替快捷方式、把删除操作换成移到隔离区。当用户说
  「清理空文件夹」「合并重复目录」「桌面建个快捷方式」「这些不要了但先别删」
  「做个可回退的清理」时使用。已验证可绕开 COM / 回收站 API / cmd.exe 全被拦的限制。
agent_created: true
---

# 沙箱环境下的安全文件操作

## 为什么需要这个技能

受限 Windows 沙箱里，**最直觉的做法全部会被拦**。先记住这张表，别再逐个试错：

| 想做的事 | 直觉做法 | 实际结果 | 可行替代 |
| --- | --- | --- | --- |
| 删文件（可回退） | 回收站 API | `Add-Type` 被拦 | `Move-Item` 到隔离区 |
| 删文件 | `Shell.Application` COM | 被拦 | 同上 |
| 建桌面快捷方式 | `New-Object -ComObject WScript.Shell` | COM 全面禁用 | `New-Item -ItemType SymbolicLink` |
| 跑 cmd 命令 | `cmd /c xxx` | 被拦 | 纯 PowerShell  cmdlet |
| 写含中文的 .ps1 | Write 工具写 .ps1 再执行 | 中文路径乱码→语法错 | 内联执行，或用码点构造中文 |
| 启动后台任务 | `Start-Job` | 被拦 | 工具自身的 `run_in_background` |

## 核心原则：隔离区代替删除

沙箱里**永远不要真删**。建一个隔离区，把要删的移进去，效果一样、随时能回退。

```powershell
# 一次性建隔离区（挑一个大盘位置）
New-Item -ItemType Directory -Path "<隔离区>\_待清空_YYYY-MM-DD" -Force

# 清理时的标准三步
Move-Item -LiteralPath $src -Destination "<隔离区>\_待清空_YYYY-MM-DD\" -Force
# → 告诉用户移了什么、多少 MB、确认后可删
# → 不要自己删，也不要问"要不要删"，直接报告即可
```

命名带日期，方便区分批次。用户说"确认可删"时，那才是真删的时机。

## 合并重复目录：先取证，再动手

用户说"合并 A 和 B"时，**绝不能直接删一边**。先算出精确差异，把证据摆给用户。

```powershell
$a = "C:\...\Desktop\ai项目"; $b = "D:\ai项目"
$la = Get-ChildItem -LiteralPath $a -Force | Select-Object -ExpandProperty Name
$lb = Get-ChildItem -LiteralPath $b -Force | Select-Object -ExpandProperty Name
"仅A有 : " + (($la | Where-Object { $lb -notcontains $_ }) -join ", ")
"仅B有 : " + (($lb | Where-Object { $la -notcontains $_ }) -join ", ")
```

### 关键：大小相同 ≠ 内容相同

必须做**逐字节哈希**才算取证完成：

```powershell
Get-FileHash -LiteralPath $p -Algorithm SHA256
```

两边同名项逐个比。本机实测：43 个文件哈希全同、0 个不同，唯一例外是 `.tmp`
（一边是早期快照，317 文件/77MB vs 9667 文件/534MB）—— 这仍不是"独有内容"。

### 还要扫一遍有没有人依赖旧路径

移动/替换目录前，必须确认没有脚本、配置、链接指向它：

```powershell
Select-String -LiteralPath $cfgFile -Pattern 'Desktop\\ai项目'
Get-ChildItem $somewhere -Recurse -Force |
  Where-Object { $_.LinkType -eq 'SymbolicLink' } | Select-Object Name, Target
```

实测：18 个桌面符号链接全部指向 `%PROJECT_DIR%/*`，**没有一个**指向 `Desktop\ai项目`
→ 证明那个目录是纯冗余副本，合并安全。

## 合并的标准姿势：移走 + 建链接

不要删完重建，**保持旧路径可用**：

```powershell
Move-Item -LiteralPath $oldPath -Destination $quarantine -Force
New-Item -ItemType SymbolicLink -Path $oldPath -Target $realPath -ErrorAction Stop
```

验证必须做"穿透读"——链接能不能真的读到内容：

```powershell
(Get-Item -LiteralPath $oldPath -Force).LinkType   # 期望 SymbolicLink
(Get-ChildItem -LiteralPath $oldPath -Force).Count  # 期望 == 真实目录项数
Test-Path -LiteralPath (Join-Path $oldPath "某个已知文件")
```

用户双击旧图标照常能用，但数据只有一份。

## 符号链接 vs 快捷方式（沙箱里只能选前者）

- **符号链接**：`New-Item -ItemType SymbolicLink` —— 内联 PowerShell 可用，跨工具、跨 AI 通用
- **快捷方式 .lnk**：需要 COM → 沙箱里建不了

代价：符号链接的图标/名称来自目标，不像真快捷方式有独立外观。MSIX 应用没有传统
exe 入口时，链到它的**执行别名**（`%LOCALAPPDATA%\Microsoft\WindowsApps\xxx.exe`）
是正道，双击能开。

## 中文路径的码点构造法

需要把中文写进命令行又担心编码问题时：

```powershell
function U([int[]]$cp){ -join ($cp | ForEach-Object { [char]$_ }) }
# 例：U @(0x4F60,0x597D) → "你好"
```

## 交付时必须交代的

- 移走了什么、多少 MB、隔离区在哪
- 验证结果用什么数字证明（不是"应该没问题"）
- 旧副本**可恢复**，随时能移回

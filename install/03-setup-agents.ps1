# 03 · 配置五家 AI 工具（WorkBuddy / Cursor / Claude Code / VS Code / Cursor BYOK）
#
# 核心思路：**技能库只存一份**，用符号链接让五家工具都指过去。
#   好处：加一个技能，五家同时就有了；不会版本不一样。
#   代价：别去动那个技能库目录本身，也别在里面加分类子文件夹（各家只扫一层）。

param(
  # 技能库放哪。留空 = 自动挑（沿用已有链接，或选一个空间够的非系统盘）
  [string]$SkillLib = '',
  [switch]$CopyInsteadOfLink,   # 不建符号链接，改成真实复制（不推荐，会版本分叉）
  [switch]$Force                # 允许改掉已指向别处的链接（默认不动，防止误改已有配置）
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$SkillsInRepo = Join-Path $ProjectRoot 'skills'
# 注意：不能叫 $Home —— PowerShell 的 $HOME 是只读内置变量，赋值会直接报错。
$UserHome = $env:USERPROFILE

# 留空则自动选：沿用现有链接 → 挑空间够的非系统盘 → 用户目录
if (-not $SkillLib) {
  $existing = Join-Path $UserHome '.workbuddy\skills'
  if (Test-Path $existing) {
    $it = Get-Item $existing -Force
    if ($it.Attributes -band [IO.FileAttributes]::ReparsePoint) { $SkillLib = ($it.Target -join ',') }
  }
  if (-not $SkillLib) {
    $drives = Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue |
              Where-Object { $_.Free -gt 2GB }
    $nonSys = $drives | Where-Object { $_.Name -ne 'C' } | Select-Object -First 1
    if ($nonSys) { $SkillLib = "$($nonSys.Root.TrimEnd('\'))\AI-Skills" }
    else { $SkillLib = "$UserHome\.ai\skills" }
  }
}

function Write-Step($msg) { Write-Host "  $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "  [!] $msg"  -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "  [X] $msg"  -ForegroundColor Red }

Write-Host ""
Write-Host "==========================================" -ForegroundColor Blue
Write-Host "  03 · 配置 AI 工具" -ForegroundColor Blue
Write-Host "==========================================" -ForegroundColor Blue
Write-Host "  技能库：$SkillLib"
Write-Host ""

# ---------------------------------------------------------------
# 1. 准备技能库
# ---------------------------------------------------------------
Write-Step "准备技能库 ..."
if (-not (Test-Path $SkillLib)) {
  New-Item -ItemType Directory -Path $SkillLib -Force | Out-Null
  Write-Ok "已创建 $SkillLib"
}

# 把本仓库的 skills 同步过去
if (Test-Path $SkillsInRepo) {
  $names = Get-ChildItem $SkillsInRepo -Directory
  $copied = 0
  foreach ($d in $names) {
    $dest = Join-Path $SkillLib $d.Name
    if (-not (Test-Path $dest)) {
      Copy-Item $d.FullName $dest -Recurse -Force
      $copied++
    } else {
      # 已存在：同步内容
      Copy-Item (Join-Path $d.FullName '*') $dest -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  Write-Ok "技能库就绪：$($names.Count) 个技能（本次新增 $copied 个）"
}

# 库内总纲
$GuideFile = Join-Path $SkillLib '技能库统一规则.md'
if (-not (Test-Path $GuideFile)) {
  $src = Join-Path $SkillsInRepo '技能库统一规则.md'
  if (Test-Path $src) { Copy-Item $src $GuideFile; Write-Ok "已放入总纲规则" }
}

# ---------------------------------------------------------------
# 2. 建符号链接（五家工具的技能目录都指向它）
# ---------------------------------------------------------------
$targets = [ordered]@{
  'workbuddy'   = Join-Path $UserHome '.workbuddy\skills'
  'cursor'      = Join-Path $UserHome '.cursor\skills'
  'claude'      = Join-Path $UserHome '.claude\skills'
}

Write-Step "建立技能库链接 ..."
foreach ($k in $targets.Keys) {
  $link = $targets[$k]
  $parent = Split-Path -Parent $link
  if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }

  if (Test-Path $link) {
    $item = Get-Item $link -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
      # 已经是链接了
      $t = $item.Target
      if ($t -eq $SkillLib) { Write-Ok "$k 已是链接 → $SkillLib"; continue }
      # 指向别处：这是危险操作，先问清楚
      Write-Warn2 "$k 链接当前指向别处：$t"
      Write-Warn2 "    本次要改成：$SkillLib"
      if (-not $Force) {
        Write-Warn2 "    跳过（不改动已有链接）。确认要改就加 -Force 重跑。"
        continue
      }
      Write-Warn2 "    -Force 已指定，删除旧链接并重建"
      (Get-Item $link -Force).Delete()
    } else {
      # 是真实目录：备份后建链接
      $bak = "$link.backup-$(Get-Date -Format yyyyMMdd-HHmmss)"
      Write-Warn2 "$k 是真实目录，备份为 $(Split-Path -Leaf $bak)"
      Move-Item $link $bak
    }
  }

  if ($CopyInsteadOfLink) {
    Copy-Item $SkillLib $link -Recurse -Force
    Write-Ok "$k 改为真实复制（不推荐，版本会分叉）"
  } else {
    try {
      New-Item -ItemType SymbolicLink -Path $link -Target $SkillLib -ErrorAction Stop | Out-Null
      Write-Ok "$k → $SkillLib （符号链接）"
    } catch {
      Write-Warn2 "$k 建符号链接失败（需要管理员权限或开发者模式）：$($_.Exception.Message)"
      Copy-Item $SkillLib $link -Recurse -Force
      Write-Warn2 "已退回为真实复制"
    }
  }
}

# ---------------------------------------------------------------
# 3. 放配置文件
# ---------------------------------------------------------------
Write-Step "安装配置文件 ..."

# 3.1 全局 AGENTS.md（WorkBuddy 读）
$agentsMd = Join-Path $UserHome 'AGENTS.md'
$srcAgents = Join-Path $ProjectRoot 'agents\workbuddy\AGENTS.md'
if ((Test-Path $srcAgents) -and (-not (Test-Path $agentsMd))) {
  Copy-Item $srcAgents $agentsMd
  Write-Ok "AGENTS.md → $agentsMd"
} elseif (Test-Path $srcAgents) {
  Write-Ok "AGENTS.md 已存在，未覆盖（如需更新请手动比对）"
} else {
  Write-Warn2 "仓库里没有 agents\workbuddy\AGENTS.md"
}

# 3.2 Cursor rules
$cursorRules = Join-Path $UserHome '.cursor\rules'
New-Item -ItemType Directory -Path $cursorRules -Force | Out-Null
Get-ChildItem (Join-Path $ProjectRoot 'agents\cursor') -Filter '*.mdc' -ErrorAction SilentlyContinue | ForEach-Object {
  Copy-Item $_.FullName (Join-Path $cursorRules $_.Name) -Force
  Write-Ok "Cursor rule → $($_.Name)"
}

# 3.3 Claude Code
$claudeDir = Join-Path $UserHome '.claude'
New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
$srcClaude = Join-Path $ProjectRoot 'agents\claude-code\CLAUDE.md'
if (Test-Path $srcClaude) {
  Copy-Item $srcClaude (Join-Path $claudeDir 'CLAUDE.md') -Force
  Write-Ok "CLAUDE.md → $claudeDir"
}
$srcSettings = Join-Path $ProjectRoot 'agents\claude-code\settings.json'
if (Test-Path $srcSettings) {
  Copy-Item $srcSettings (Join-Path $claudeDir 'settings.json') -Force
  Write-Ok "settings.json（已脱敏）→ $claudeDir"
  Write-Warn2 "记得把里面的 <YOUR_KEY> 换成你自己的 API Key"
}

# 3.4 VS Code
$vscodeUser = Join-Path $env:APPDATA 'Code\User'
if (Test-Path (Split-Path -Parent $vscodeUser)) {
  New-Item -ItemType Directory -Path $vscodeUser -Force | Out-Null
  $srcVs = Join-Path $ProjectRoot 'agents\vscode\settings.json'
  if (Test-Path $srcVs) {
    # VSCode 的 settings.json 用户可能已经配了别的，不覆盖，只提示
    if (Test-Path (Join-Path $vscodeUser 'settings.json')) {
      Write-Warn2 "VSCode settings.json 已存在，未覆盖（仓库里的版本在 agents\vscode\settings.json，自行合并）"
    } else {
      Copy-Item $srcVs (Join-Path $vscodeUser 'settings.json') -Force
      Write-Ok "VSCode settings.json 已安装"
    }
  }
} else {
  Write-Warn2 "未检测到 VS Code，跳过"
}

# 3.5 Cursor BYOK
$byokRules = Join-Path $UserHome '.cursor-byok-v3\rules'
if (Test-Path (Split-Path -Parent $byokRules)) {
  New-Item -ItemType Directory -Path $byokRules -Force | Out-Null
  $srcByok = Join-Path $ProjectRoot 'agents\cursor-byok\rules'
  if (Test-Path $srcByok) {
    Copy-Item (Join-Path $srcByok '*') $byokRules -Recurse -Force
    Write-Ok "Cursor BYOK rules 已安装"
  }
}

# ---------------------------------------------------------------
# 4. 汇总
# ---------------------------------------------------------------
Write-Host ""
Write-Host "  当前状态" -ForegroundColor Blue
Write-Host "  ----------------------------------------"
Write-Host "  技能库：$SkillLib"
$cnt = (Get-ChildItem $SkillLib -Directory -ErrorAction SilentlyContinue | Measure-Object).Count
Write-Host "  技能数：$cnt"
Write-Host ""
foreach ($k in $targets.Keys) {
  $p = $targets[$k]
  $mark = if (Test-Path $p) { '有' } else { '无' }
  Write-Host "  [$mark] $k  →  $p"
}
Write-Host ""
Write-Host "  下一步：打开各 AI 工具，问它「你有几个技能」验证是否生效。" -ForegroundColor Green
Write-Host ""

if ($env:AI_ONESHOT -ne '1') {
  $null = Read-Host "按回车键继续"
}

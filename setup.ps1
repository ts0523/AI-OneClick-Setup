# ============================================================
#  AI 一键配置 · 主入口
#  把技能库 + 五家 AI 工具 + Git/GitHub + C/C++ 工具链 一次配好
#
#  用法：
#    双击 install.bat                    走菜单（推荐）
#    powershell -File setup.ps1          全默认装
#    powershell -File setup.ps1 -Only skills
#    powershell -File setup.ps1 -ToolRoot "E:\DevTools"
#
#  设计原则：**不写死盘符**。留空 = 自动探测已装工具 + 自动挑安装位置。
# ============================================================

param(
  [string[]]$Only = @(),          # 只跑某几步：tools / skills
  [string]$ToolRoot = '',         # 工具装哪；留空=自动选
  [string]$SkillLib = '',         # 技能库放哪；留空=自动选
  [switch]$AddToPath,
  [switch]$Force,                 # 允许改掉已指向别处的符号链接
  [switch]$NoPause
)

$ErrorActionPreference = 'Continue'
$ProjectRoot = $PSScriptRoot
if ([string]::IsNullOrEmpty($ProjectRoot)) { $ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path }
$InstallDir = Join-Path $ProjectRoot 'install'
if ($NoPause) { $env:AI_ONESHOT = '1' }

function Write-Big($msg, $color = 'Blue') {
  Write-Host ""
  Write-Host "==========================================" -ForegroundColor $color
  Write-Host "  $msg" -ForegroundColor $color
  Write-Host "==========================================" -ForegroundColor $color
}

# ---------------------------------------------------------------
# 路径自动选择：不猜用户的盘符，让机器自己回答
# ---------------------------------------------------------------
function Pick-ToolRoot {
  # 已经在 PATH 里，或在常规安装位置 → 从它反推工具根。
  # 注意层级不能拍脑袋：git 是 <root>\git\cmd\git.exe（退两级到 git 目录，
  # 若那层叫 Git 再退一级），而 gcc 是 <root>\mingw64\bin\gcc.exe（只需退一级）。
  foreach ($n in @('git', 'gh', 'gcc', 'ninja')) {
    $c = Get-Command $n -ErrorAction SilentlyContinue
    if (-not $c) { continue }
    $leaf = Split-Path -Leaf $c.Source
    if ($leaf -ieq 'git.exe') {
      $root = Split-Path -Parent (Split-Path -Parent $c.Source)   # -> ...\git
      if ((Split-Path -Leaf $root) -ieq 'git') { $root = Split-Path -Parent $root }
      return $root
    }
    # gcc / ninja / gh：exe 就在 bin 下，退一级即工具根
    return (Split-Path -Parent (Split-Path -Parent $c.Source))
  }
  # 否则：挑一个空间够的非系统盘，没有就用用户目录
  $drives = Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue |
            Where-Object { $_.Free -gt 5GB }
  $nonSys = $drives | Where-Object { $_.Name -ne 'C' } | Select-Object -First 1
  if ($nonSys) { return "$($nonSys.Root.TrimEnd('\'))\DevTools" }
  $any = $drives | Select-Object -First 1
  if ($any) { return "$($any.Root.TrimEnd('\'))\DevTools" }
  return "$env:USERPROFILE\DevTools"
}

function Pick-SkillLib {
  # 已有技能库（是符号链接）就沿用
  $link = Join-Path $env:USERPROFILE '.workbuddy\skills'
  if (Test-Path $link) {
    $i = Get-Item $link -Force
    if ($i.Attributes -band [IO.FileAttributes]::ReparsePoint) { return ($i.Target -join ',') }
  }
  # 找一个空间够的盘
  $drives = Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue |
            Where-Object { $_.Free -gt 2GB }
  $nonSys = $drives | Where-Object { $_.Name -ne 'C' } | Select-Object -First 1
  if ($nonSys) { return "$($nonSys.Root.TrimEnd('\'))\AI-Skills" }
  return "$env:USERPROFILE\.ai\skills"
}

if (-not $ToolRoot) { $ToolRoot = Pick-ToolRoot }
if (-not $SkillLib) { $SkillLib = Pick-SkillLib }

# ---------------------------------------------------------------
# 执行策略检查
# ---------------------------------------------------------------
if ((Get-ExecutionPolicy -ErrorAction SilentlyContinue) -eq 'Restricted') {
  Write-Big "需要调整执行策略" 'Yellow'
  Write-Host "  当前策略 Restricted，PowerShell 脚本无法运行。"
  Write-Host "  请在【管理员】PowerShell 里执行一次："
  Write-Host ""
  Write-Host "    Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned"
  Write-Host ""
  if ($NoPause) { exit 1 } else { $null = Read-Host "按回车键退出"; exit 1 }
}

Write-Big "AI 一键配置" 'Cyan'
Write-Host "  脚本目录：$ProjectRoot"
Write-Host "  技能库  ：$SkillLib"
Write-Host "  工具目录：$ToolRoot"
Write-Host ""
Write-Host "  路径是自动挑的。想指定就加参数，例如："
Write-Host "    -ToolRoot `"E:\DevTools`" -SkillLib `"E:\AI-Skills`""
Write-Host ""

$steps = @(
  @{ id = 'tools';  title = '02 · 安装工具链（Git / GitHub CLI / MinGW / ninja）'
     script = '02-install-tools.ps1'
     args = @("`"$ToolRoot`"") + $(if ($AddToPath) { '-AddToPath' } else { @() }) }
  @{ id = 'skills'; title = '03 · 部署技能库并配置五家 AI 工具'
     script = '03-setup-agents.ps1'
     args = @("`"$SkillLib`"") + $(if ($Force) { '-Force' } else { @() }) }
)

$run = if ($Only.Count -gt 0) { $steps | Where-Object { $Only -contains $_.id } } else { $steps }
$results = @()

foreach ($s in $run) {
  Write-Big $s.title
  $f = Join-Path $InstallDir $s.script
  if (-not (Test-Path $f)) { Write-Host "  [X] 找不到：$f" -ForegroundColor Red; continue }
  & powershell -ExecutionPolicy Bypass -NoProfile -File $f @($s.args) 2>&1 | Out-Host
  $results += [PSCustomObject]@{ 步骤 = $s.id; 结果 = $(if ($LASTEXITCODE -eq 0 -or $null -eq $LASTEXITCODE) { '完成' } else { "退出码 $LASTEXITCODE" }) }
}

# ---------------------------------------------------------------
# 隐私扫描
# ---------------------------------------------------------------
Write-Big "04 · 隐私与合规扫描" 'Magenta'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  $guess = Get-ChildItem "$env:USERPROFILE" -Recurse -Depth 5 -Filter 'node.exe' -ErrorAction SilentlyContinue |
           Where-Object { $_.FullName -match 'node|Node' } | Select-Object -First 1
  $node = $guess.FullName
}
if ($node) {
  Write-Host "  用 node：$node`n"
  & $node (Join-Path $InstallDir 'privacy-scan.js')
} else {
  Write-Host "  [!] 未找到 node，跳过扫描。" -ForegroundColor Yellow
  Write-Host "      装了 Node.js 后可手动跑：node install\privacy-scan.js" -ForegroundColor Yellow
}

# ---------------------------------------------------------------
# 汇总
# ---------------------------------------------------------------
Write-Big "全部完成" 'Green'
if ($results.Count -gt 0) { $results | Format-Table -AutoSize | Out-Host }
Write-Host "  技能库  ：$SkillLib" -ForegroundColor Cyan
Write-Host "  工具目录：$ToolRoot" -ForegroundColor Cyan
Write-Host ""
Write-Host "  下一步：" -ForegroundColor Cyan
Write-Host "    1) 把上面打印的 git / gh / gcc 路径填进你的 AI 规则文件" -ForegroundColor Cyan
Write-Host "    2) 打开任一 AI 工具，问「你现在有哪些技能」验证" -ForegroundColor Cyan
Write-Host "    3. 看 git-github/ 下的 Git 与 GitHub 使用教程" -ForegroundColor Cyan
Write-Host ""
Write-Host "  教程：README.md ｜ 工具说明：codetool/工具链清单.md ｜ 署名：CREDITS.md" -ForegroundColor Cyan
Write-Host ""

if (-not $NoPause) { $null = Read-Host "按回车键退出" }

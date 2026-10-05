# 02 · 安装工具链（Git / GitHub CLI / MinGW / ninja / Node.js / Python / 7-Zip）
#
# 设计原则：
#   1. **不写死任何盘符**。先在常见位置探测已装的工具，找到就用；
#      找不到才需要一个安装目录（-ToolRoot），默认放在用户目录下。
#   2. 优先用 installers/ 里的离线安装包（网络不通也能装）。
#   3. 幂等：已装就跳过，不重复装。
#   4. **不加系统 PATH**，避免多版本互相覆盖；统一用本脚本打印的绝对路径。

param(
  # 装到哪。留空 = 自动选一个推荐位置（见 Resolve-ToolRoot）
  [string]$ToolRoot = '',
  [switch]$AddToPath
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$InstallerDir = Join-Path $ProjectRoot 'installers'

function Write-Step($msg)  { Write-Host "  $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "  [!] $msg"  -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host "  [X] $msg"  -ForegroundColor Red }

# ---------------------------------------------------------------
# 工具探测：在多个常见位置找已安装的工具
# ---------------------------------------------------------------
function Find-Tool {
  param([string[]]$Candidates)
  foreach ($c in $Candidates) {
    if ($c -and (Test-Path $c)) { return $c }
  }
  return $null
}

# 在 $ToolRoot 下拼子路径。
# $ToolRoot 可能还是空串（探测阶段），此时 Join-Path 会直接抛
#「无法将参数绑定到参数 Path」，必须先挡掉。
function Under-ToolRoot {
  param([string]$Sub)
  if (-not $ToolRoot) { return $null }
  return (Join-Path $ToolRoot $Sub)
}

# 常见安装位置：先找用户自己装的（别人机器上可能是任意盘）
function Find-Git {
  $paths = @(
    (Under-ToolRoot 'git\cmd\git.exe'),
    "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe",
    "$env:ProgramFiles\Git\cmd\git.exe",
    "${env:ProgramFiles(x86)}\Git\cmd\git.exe",
    "$env:ChocolateyInstall\bin\git.exe"
  )
  # 已经在 PATH 里就算了
  $onPath = Get-Command git -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  return Find-Tool $paths
}

function Find-Gh {
  $paths = @(
    (Under-ToolRoot 'gh\bin\gh.exe'),
    "$env:LOCALAPPDATA\Programs\GitHub CLI\gh.exe",
    "$env:ProgramFiles\GitHub CLI\gh.exe",
    "${env:ProgramFiles(x86)}\GitHub CLI\gh.exe",
    "$env:ChocolateyInstall\bin\gh.exe"
  )
  $onPath = Get-Command gh -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  return Find-Tool $paths
}

function Find-Gcc {
  $paths = @(
    (Under-ToolRoot 'mingw64\bin\gcc.exe'),
    "$env:LOCALAPPDATA\Programs\mingw64\bin\gcc.exe",
    "$env:ProgramFiles\mingw64\bin\gcc.exe",
    "${env:ProgramFiles(x86)}\mingw64\bin\gcc.exe",
    "$env:ChocolateyInstall\bin\gcc.exe"
  )
  $onPath = Get-Command gcc -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  return Find-Tool $paths
}

# 取工具版本号。
# 注意：不能写 & $exe --version —— PowerShell 解析器会把「--」当成递减运算符，
# 报「意外的标记 version」。必须整体加引号当字符串传。
function Get-ToolVersion($exe) {
  if (-not $exe) { return '(未安装)' }
  try {
    $v = & $exe '--version' 2>&1 | Select-Object -First 1
    return ("$v").Trim()
  } catch {
    return '(无法获取版本)'
  }
}

# 没有 -ToolRoot 时，挑一个「有空间且不装在系统根目录」的位置
function Resolve-ToolRoot {
  # 用户显式给了就用
  if ($ToolRoot) { return $ToolRoot }

  # 已经在别处装好了工具 → 从它反推工具根
  $g = Find-Git
  if ($g) {
    # 形如 <工具目录>\git\cmd\git.exe → 先退两级到那个 git 目录 ...
    $root = Split-Path -Parent (Split-Path -Parent $g)
    # ... 如果那层目录就叫 Git，再退一级拿到真正的工具根（上面那个 Git 目录）
    if ((Split-Path -Leaf $root) -ieq 'Git') { $root = Split-Path -Parent $root }
    return $root
  }

  # 否则：挑一个剩余空间 >5GB 的盘，优先非系统盘（C 盘常年紧张）
  $candidates = @()
  foreach ($d in (Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue)) {
    if ($d.Root -match '^[A-Z]:\\$' -and $d.Free -gt 5GB) {
      $candidates += $d.Root.TrimEnd('\')
    }
  }
  # 非系统盘优先（D、E...），其次 C
  $nonSystem = $candidates | Where-Object { $_ -notmatch '^[C]$' }
  if ($nonSystem) { return "$($nonSystem[0])\DevTools" }
  if ($candidates) { return "$($candidates[0])\DevTools" }

  # 最后兜底：用户目录下
  return "$env:USERPROFILE\DevTools"
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Blue
Write-Host "  02 · 安装工具链" -ForegroundColor Blue
Write-Host "==========================================" -ForegroundColor Blue

$ToolRoot = Resolve-ToolRoot
Write-Host "  工具目录：$ToolRoot"
Write-Host "  写入 PATH：$(if ($AddToPath) { '是' } else { '否（推荐）' })"
Write-Host ""

# ---------------------------------------------------------------
# 1. Git
# ---------------------------------------------------------------
Write-Step "Git ..."
$gitExe = Find-Git
if ($gitExe) {
  Write-Ok "已安装：$(Get-ToolVersion $gitExe)"
  Write-Host "       路径：$gitExe"
} else {
  $pkg = Get-ChildItem $InstallerDir -Filter 'Git-*-64-bit.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($pkg) {
    Write-Step "用离线包安装：$($pkg.Name)"
    $a = @('/VERYSILENT', '/NORESTART', '/NOCANCEL', '/SP-',
           "/DIR=$ToolRoot\git", '/COMPONENTS="icons,ext\reg\shellhere,assoc,assoc_sh"')
    Start-Process -FilePath $pkg.FullName -ArgumentList $a -Wait -NoNewWindow
    $gitExe = Find-Git
    if ($gitExe) { Write-Ok "安装完成：$gitExe" }
    else { Write-Err "装完仍未找到 git，请手动确认" }
  } else {
    Write-Warn2 "未检测到 Git。"
    Write-Warn2 "  1) 把官方安装包放进：$InstallerDir"
    Write-Warn2 "  2) 或手动下载：https://git-scm.com/download/win"
    Write-Warn2 "     建议装到：$ToolRoot\git"
  }
}

# ---------------------------------------------------------------
# 2. GitHub CLI
# ---------------------------------------------------------------
Write-Step "GitHub CLI ..."
$ghExe = Find-Gh
if ($ghExe) {
  Write-Ok "已安装：$(Get-ToolVersion $ghExe)"
  Write-Host "       路径：$ghExe"
} else {
  $pkg = Get-ChildItem $InstallerDir -Filter 'gh_*_windows_amd64.zip' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($pkg) {
    Write-Step "解压离线包：$($pkg.Name)"
    $tmp = Join-Path $env:TEMP "gh_install_$([guid]::NewGuid().ToString('N').Substring(0,8))"
    Expand-Archive -Path $pkg.FullName -DestinationPath $tmp -Force
    $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
    $dest = Join-Path $ToolRoot 'gh'
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    Move-Item $inner.FullName $dest
    Remove-Item $tmp -Recurse -Force
    $ghExe = Find-Gh
    if ($ghExe) { Write-Ok "安装完成：$ghExe" }
    else { Write-Err "解压后仍未找到 gh.exe，请检查压缩包结构" }
  } else {
    Write-Warn2 "未检测到 GitHub CLI（可选，但强烈建议装）。"
    Write-Warn2 "  1) 把 gh_*_windows_amd64.zip 放进：$InstallerDir"
    Write-Warn2 "  2) 或手动下载：https://cli.github.com/"
  }
}

# ---------------------------------------------------------------
# 3. MinGW-w64（可选）
# ---------------------------------------------------------------
Write-Step "MinGW-w64 (gcc) ..."
$gccExe = Find-Gcc
if ($gccExe) {
  Write-Ok "已安装：$(Get-ToolVersion $gccExe)"
  Write-Host "       路径：$gccExe"
} else {
  $pkg = Get-ChildItem $InstallerDir -Filter 'x86_64-*.7z' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($pkg) {
    Write-Warn2 "离线包已就位：$($pkg.Name)"
    Write-Warn2 "  .7z 需要 7-Zip 解压，请执行："
    Write-Warn2 "    & 'C:\Program Files\7-Zip\7z.exe' x '$($pkg.FullName)' -o'$ToolRoot\mingw64' -y"
  } else {
    Write-Warn2 "未检测到 gcc（只在编译 C/C++ 时需要）。"
    Write-Warn2 "  下载：https://www.mingw-w64.org/downloads/"
  }
}

# ---------------------------------------------------------------
# 4. ninja（可选）
# ---------------------------------------------------------------
Write-Step "ninja ..."
$ninjaCandidates = @(
  (Join-Path $ToolRoot 'ninja\ninja.exe'),
  "$env:LOCALAPPDATA\ninja\ninja.exe"
)
$onPathNinja = Get-Command ninja -ErrorAction SilentlyContinue
if ($onPathNinja) { $ninjaExe = $onPathNinja.Source }
else { $ninjaExe = Find-Tool $ninjaCandidates }

if ($ninjaExe) {
  Write-Ok "已安装：$ninjaExe"
} else {
  $pkg = Get-ChildItem $InstallerDir -Filter 'ninja-win.zip' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($pkg) {
    $dest = Join-Path $ToolRoot 'ninja'
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
    Expand-Archive -Path $pkg.FullName -DestinationPath $dest -Force
    if (Test-Path (Join-Path $dest 'ninja.exe')) { Write-Ok "安装完成" }
    else { Write-Warn2 "解压了但没找到 ninja.exe，请检查压缩包结构" }
  } else {
    Write-Warn2 "未检测到 ninja（可选）：https://github.com/ninja-build/ninja/releases"
  }
}

# ---------------------------------------------------------------
# 5. Node.js（跑脚本 / 装依赖）
# ---------------------------------------------------------------
Write-Step "Node.js ..."
$nodeExe = $null
# 优先找「本工具目录里的」，再找常规安装位置，最后看 PATH
$nodeCandidates = @(
  (Join-Path $ToolRoot 'node\node.exe'),
  "$env:ProgramFiles\nodejs\node.exe",
  "${env:ProgramFiles(x86)}\nodejs\node.exe",
  "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
  "$env:APPDATA\nvm\node.exe"
)
$onPathNode = Get-Command node -ErrorAction SilentlyContinue
if ($onPathNode) { $nodeExe = $onPathNode.Source }
else { $nodeExe = Find-Tool $nodeCandidates }

if ($nodeExe) {
  Write-Ok "已安装：$(Get-ToolVersion $nodeExe)"
  Write-Host "       路径：$nodeExe"
  # npm 通常与 node 同目录
  $npmCmd = Join-Path (Split-Path -Parent $nodeExe) 'npm.cmd'
  if (Test-Path $npmCmd) {
    $npmExe = $npmCmd
    Write-Ok "npm：$(Get-ToolVersion $npmCmd)"
  } else { $npmExe = $null }
} else {
  $pkg = Get-ChildItem $InstallerDir -Filter 'node-v*-win-x64*.zip' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($pkg) {
    $dest = Join-Path $ToolRoot 'node'
    Write-Step "解压 Node.js：$($pkg.Name)"
    Expand-Archive -Path $pkg.FullName -DestinationPath $ToolRoot -Force
    # 官方包解压出来是 node-vXX.Y.Z-win-x64 这一层
    $inner = Get-ChildItem $ToolRoot -Directory -Filter 'node-v*' | Select-Object -First 1
    if ($inner) {
      if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
      Move-Item $inner.FullName $dest
    }
    $nodeExe = Find-Tool @((Join-Path $dest 'node.exe'))
    if ($nodeExe) {
      Write-Ok "安装完成：$(Get-ToolVersion $nodeExe)"
      $npmExe = Join-Path $dest 'npm.cmd'
    } else { Write-Err "解压了但没找到 node.exe，请检查包结构"; $npmExe = $null }
  } else {
    Write-Warn2 "未检测到 Node.js（跑 JS 脚本、AI 工具自身都要用它，建议装）。"
    Write-Warn2 "  下载便携版（免安装）：https://nodejs.org/zh-cn/download"
    Write-Warn2 "  选 Windows Installer (.msi) 或 ZIP 版，放到 installers\ 即可自动装"
    $npmExe = $null
  }
}

# ---------------------------------------------------------------
# 6. Python（脚本 / 数据处理）
# ---------------------------------------------------------------
Write-Step "Python ..."
$pyExe = $null
$pyCandidates = @(
  (Join-Path $ToolRoot 'python\python.exe'),
  "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
  "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
  "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
  "$env:ProgramFiles\Python313\python.exe"
)
$onPathPy = Get-Command python -ErrorAction SilentlyContinue
if ($onPathPy) { $pyExe = $onPathPy.Source }
else {
  foreach ($c in $pyCandidates) { if ($c -and (Test-Path $c)) { $pyExe = $c; break } }
}

if ($pyExe) {
  # WindowsApps\python.exe 是微软商店的「占位转发器」：文件存在，
  # 但真机没装 Python 时它会弹商店而不是执行。跑一次拿版本，
  # 拿不到就当没装 —— 否则会把一个空壳路径写进 AI 规则文件。
  $pyVer = Get-ToolVersion $pyExe
  if ($pyVer -match '^\d+\.\d+') {
    Write-Ok "已安装：Python $pyVer"
    Write-Host "       路径：$pyExe"
  } else {
    Write-Warn2 "找到 $pyExe，但它不是可用的 Python（可能是商店占位符）"
    $pyExe = $null
  }
}
if (-not $pyExe) {
  $pkg = Get-ChildItem $InstallerDir -Filter 'python-*-amd64.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($pkg) {
    $dest = Join-Path $ToolRoot 'python'
    Write-Step "用离线包安装 Python：$($pkg.Name)"
    $a = @('/quiet', 'InstallAllUsers=0', "TargetDir=$dest", 'PrependPath=0', 'Include_test=0')
    Start-Process -FilePath $pkg.FullName -ArgumentList $a -Wait -NoNewWindow
    $cand = Join-Path $dest 'python.exe'
    if (Test-Path $cand) { $pyExe = $cand; Write-Ok "安装完成：Python $(Get-ToolVersion $cand)" }
    else { Write-Err "装完仍未找到 python.exe，请手动确认" }
  } else {
    Write-Warn2 "未检测到可用的 Python（可选，很多技能用它做数据处理）。"
    Write-Warn2 "  下载：https://www.python.org/downloads/"
    Write-Warn2 "  装完记得勾选「Add Python to PATH」，或把安装包放 installers\ 让脚本自动装"
  }
}

# ---------------------------------------------------------------
# 7. 7-Zip（解压 .7z 格式的 MinGW 包要用）
# ---------------------------------------------------------------
Write-Step "7-Zip ..."
$sevenZip = $null
$szCandidates = @(
  (Join-Path $ToolRoot '7zip\7z.exe'),
  "$env:ProgramFiles\7-Zip\7z.exe",
  "${env:ProgramFiles(x86)}\7-Zip\7z.exe"
)
$onPathSz = Get-Command 7z -ErrorAction SilentlyContinue
if ($onPathSz) { $sevenZip = $onPathSz.Source }
else { $sevenZip = Find-Tool $szCandidates }

if ($sevenZip) {
  Write-Ok "已安装：$sevenZip"
} else {
  Write-Warn2 "未检测到 7-Zip（只有在装 .7z 格式的 MinGW 包时才需要）。"
  Write-Warn2 "  下载：https://www.7-zip.org/"
}

# ---------------------------------------------------------------
# 8. PATH
# ---------------------------------------------------------------
if ($AddToPath) {
  Write-Step "写入用户级 PATH ..."
  $dirs = @()
  foreach ($exe in @($gitExe, $ghExe, $gccExe, $ninjaExe, $nodeExe, $pyExe)) {
    if ($exe) { $dirs += (Split-Path -Parent $exe) }
  }
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $changed = $false
  foreach ($d in ($dirs | Select-Object -Unique)) {
    if ($userPath -notlike "*$d*") {
      $userPath = if ([string]::IsNullOrEmpty($userPath)) { $d } else { "$userPath;$d" }
      $changed = $true
    }
  }
  if ($changed) {
    [Environment]::SetEnvironmentVariable('Path', $userPath, 'User')
    Write-Ok "已写入，**需要重开终端才生效**"
  } else { Write-Ok "PATH 中已存在，无需修改" }
  Write-Warn2 "注意：多个 MinGW 同时在 PATH 里会让 gcc 版本飘，只留一个"
} else {
  Write-Step "跳过 PATH 写入（推荐：所有工具用绝对路径调用）"
}

# ---------------------------------------------------------------
# 9. 汇总：打印可直接复制的路径
# ---------------------------------------------------------------
Write-Host ""
Write-Host "  工具路径（复制即可用）" -ForegroundColor Blue
Write-Host "  ----------------------------------------"
if ($gitExe)  { Write-Host "  git  = `"$gitExe`""  -ForegroundColor DarkGray }
if ($ghExe)   { Write-Host "  gh   = `"$ghExe`""   -ForegroundColor DarkGray }
if ($gccExe)  { Write-Host "  gcc  = `"$gccExe`""  -ForegroundColor DarkGray }
if ($ninjaExe){ Write-Host "  ninja = `"$ninjaExe`"" -ForegroundColor DarkGray }
if ($nodeExe) { Write-Host "  node = `"$nodeExe`"" -ForegroundColor DarkGray }
if ($npmExe)  { Write-Host "  npm  = `"$npmExe`""  -ForegroundColor DarkGray }
if ($pyExe)   { Write-Host "  python = `"$pyExe`"" -ForegroundColor DarkGray }
if ($sevenZip){ Write-Host "  7z   = `"$sevenZip`"" -ForegroundColor DarkGray }
Write-Host ""
Write-Host "  把这些填进你的 AI 规则文件（AGENTS.md / CLAUDE.md / .mdc），"
Write-Host "  AI 就能直接用绝对路径调这些工具，不会找错。"
Write-Host ""
if ($gitExe) {
  Write-Host "  下一步：03-setup-agents.ps1" -ForegroundColor Green
}
Write-Host ""

if ($env:AI_ONESHOT -ne '1') { $null = Read-Host "按回车键继续" }

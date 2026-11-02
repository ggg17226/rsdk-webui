# ---------------------------------------------------------------------------
# rsdk-webui 一键启动（Windows x86_64）
#
#   git clone https://github.com/xzl01/rsdk-webui && cd rsdk-webui
#   .\start.cmd          （或 PowerShell 里 .\start.ps1）
#
# 做四件事，每件只在需要时才做：校验 Node/pnpm → 安装依赖 → 构建 web 产物 →
# 检查 Docker 镜像 → 起服务。
#
# Windows 上的两种用法：
#   * GitHub Actions 后端（推荐，开箱即用）：界面 + 推送构建包到你的仓库，
#     不需要 Docker 和 bash。
#   * 本机容器构建（进阶）：需要 Git for Windows（bash.exe 在 PATH 里，run.sh
#     是 bash 脚本）+ 已导入的 rsdk 镜像。镜像导入建议在 WSL 里跑
#     ./ops/setup.sh，Git Bash 里没有 ar/bsdtar。
#
# 选项：--skip-setup 跳过镜像检查；--force-setup 强制重导镜像。
# ---------------------------------------------------------------------------
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Log($m)  { Write-Host "==> $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "warn: $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "error: $m" -ForegroundColor Red; exit 1 }

$skipSetup = $false
$forceSetup = $false
foreach ($a in $args) {
  switch ($a) {
    "--skip-setup"  { $skipSetup = $true }
    "--no-image"    { $skipSetup = $true }
    "--force-setup" { $forceSetup = $true }
    "-h"            { Get-Content $MyInvocation.MyCommand.Path | Select-Object -First 18; exit 0 }
    default         { Die "未知参数: $a（-h 看帮助）" }
  }
}

# --- 1. node / pnpm ---------------------------------------------------------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Die "没有找到 node（需要 >= 20）：https://nodejs.org"
}
$nodeMajor = [int]((& node -p "process.versions.node").Split(".")[0])
if ($nodeMajor -lt 20) { Die "node 版本过低（$(& node -v)），需要 >= 20" }

if (Get-Command pnpm -ErrorAction SilentlyContinue) {
  function Pnpm { & pnpm @args }
} else {
  # packageManager 字段钉了 pnpm 版本，corepack 会按它来
  Log "pnpm 不在，尝试 corepack"
  try { & corepack enable 2>$null } catch {}
  if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    function Pnpm { & pnpm @args }
  } elseif (Get-Command corepack -ErrorAction SilentlyContinue) {
    function Pnpm { & corepack pnpm @args }
  } else {
    Die "pnpm/corepack 都不可用，手动安装：npm i -g pnpm"
  }
}

# --- 2. 依赖 ----------------------------------------------------------------
$needInstall = -not (Test-Path node_modules)
if (-not $needInstall) {
  $lock = Get-Item pnpm-lock.yaml -ErrorAction SilentlyContinue
  $marker = Get-Item node_modules\.modules.yaml -ErrorAction SilentlyContinue
  if (-not $lock -or -not $marker -or $lock.LastWriteTime -gt $marker.LastWriteTime) { $needInstall = $true }
}
if ($needInstall) {
  Log "安装依赖"
  Pnpm install --frozen-lockfile
} else {
  Log "依赖已就绪，跳过安装"
}

# --- 3. web 产物 ------------------------------------------------------------
$needBuild = -not (Test-Path web\dist\index.html)
if (-not $needBuild) {
  $distTime = (Get-Item web\dist\index.html).LastWriteTime
  # 与 start.sh 的 find 集合保持一致：vite.config.ts 也影响产物
  $newest = Get-ChildItem web\src, shared\src, web\index.html, web\vite.config.ts -Recurse -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($newest -and $newest.LastWriteTime -gt $distTime) { $needBuild = $true }
}
if ($needBuild) {
  Log "构建 web 产物"
  Pnpm build
} else {
  Log "web 产物已是最新，跳过构建"
}

# --- 4. docker / 镜像 ---------------------------------------------------------
$image = if ($env:RSDK_WEBUI_IMAGE) { $env:RSDK_WEBUI_IMAGE } else { "rsdk-image:latest" }
$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
  Write-Host ""
  Warn "环境检查没通过：没有找到 docker"
  Write-Host "  Windows 装 Docker Desktop（需要 WSL2）：https://www.docker.com/products/docker-desktop/"
  Write-Host "  或者用 WSL，在 WSL 终端里跑 ./start.sh"
  if (-not $skipSetup) {
    Write-Host ""
    Die "装好 Docker Desktop 后重新运行 .\start.ps1；只想先看界面用 .\start.ps1 --no-image"
  }
  Warn "按 --no-image 继续：界面能打开，但板子列表读不出来（catalog 来自容器镜像）"
} elseif (-not (& docker info 2>$null)) {
  Write-Host ""
  Warn "环境检查没通过：docker 已安装，但守护进程连不上"
  Write-Host "  启动 Docker Desktop（托盘图标），或检查 WSL2 是否正常：wsl --status"
  Write-Host ""
  Die "修好后重新运行 .\start.ps1"
} else {
  $present = & docker image inspect $image 2>$null
  if ($forceSetup) {
    Warn "Windows 下镜像导入请在 WSL 里跑 ./ops/setup.sh --force（Git Bash 缺 ar/bsdtar）"
  } elseif ($skipSetup) {
    Log "跳过镜像检查（--skip-setup）"
  } elseif (-not $present) {
    Warn "镜像 $image 未导入 —— Windows 下请在 WSL 里跑 ./ops/setup.sh，"
    Warn "或者直接用 GitHub Actions 后端（界面 → 构建后端），不需要本地镜像"
  } else {
    Log "镜像 $image 已就绪"
  }
}

# Windows ARM64（少数设备）：镜像只有 amd64，Docker Desktop 一般自带仿真
if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") {
  Log "ARM64 主机：构建容器将以 --platform linux/amd64 运行"
  $env:RSDK_RUN_EXTRA = if ($env:RSDK_RUN_EXTRA) { "$($env:RSDK_RUN_EXTRA) --platform linux/amd64" } else { "--platform linux/amd64" }
}

# --- 5. 起服务 ----------------------------------------------------------------
$port = if ($env:RSDK_WEBUI_PORT) { $env:RSDK_WEBUI_PORT } else { "8787" }
$listener = Get-NetTCPConnection -LocalPort ([int]$port) -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  Warn "端口 $port 已被监听 —— 可能已有一个实例在跑。换端口：`$env:RSDK_WEBUI_PORT=8788"
}

if (-not (Get-Command bash -ErrorAction SilentlyContinue)) {
  Warn "PATH 里没有 bash：本机容器构建跑不起来（run.sh 是 bash 脚本）。"
  Warn "装 Git for Windows 并确认 bash 在 PATH，或用 GitHub Actions 后端。"
}

Log "启动 rsdk-webui -> http://127.0.0.1:$port  （Ctrl-C 停止）"
# 服务起来后自动打开浏览器（RSDK_WEBUI_NO_OPEN=1 关闭）
if ($env:RSDK_WEBUI_NO_OPEN -ne "1") {
  Start-Process "http://127.0.0.1:$port"
}
Pnpm start

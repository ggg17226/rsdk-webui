#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# rsdk-webui 本地一键启动（Linux x86_64/arm64、macOS）
#
#   git clone https://github.com/xzl01/rsdk-webui && cd rsdk-webui
#   ./start.sh
#
# 顺序（每步只在需要时才做）：
#   1. 检查 node ≥ 20、pnpm（缺了用 corepack 补）
#   2. 检查容器引擎：docker / podman 有没有装、守护进程通不通
#      —— 不通过就直接停在这里，并按平台给出安装命令
#   3. 安装依赖、构建 web 产物
#   4. 导入 rsdk 镜像（首次 ~480MB）；arm64 主机自动装 amd64 仿真
#   5. 起服务并打开浏览器
#
# 选项：
#   --check         只做环境检查然后退出（排查问题时用；不通过返回 1）
#   --no-image      跳过镜像导入（= --skip-setup；没装引擎也想先看界面时用）
#   --force-setup   强制重跑 ops/setup.sh（换镜像版本后用）
#   --engine NAME   指定容器引擎：docker 或 podman（默认自动探测，podman 优先）
#
# 常用环境变量：
#   RSDK_WEBUI_PORT=8787   RSDK_WEBUI_HOST=127.0.0.1   RSDK_WEBUI_IMAGE=rsdk-image:latest
#   RSDK_WEBUI_NO_OPEN=1   不自动打开浏览器
#   RSDK_WEBUI_ALLOW_REMOTE=1  允许 RSDK_WEBUI_HOST 绑非回环地址（无认证，慎用）
#
# Windows 用户请用 start.cmd（PowerShell），见 README「目标平台」。
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
bad()  { printf '  \033[1;31m✗\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarn:\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

FORCE_SETUP=0
SKIP_SETUP=0
CHECK_ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK_ONLY=1; shift ;;
    --force-setup) FORCE_SETUP=1; shift ;;
    --skip-setup|--no-image) SKIP_SETUP=1; shift ;;
    --engine)
      [[ -n ${2:-} ]] || die "--engine 需要一个值：docker 或 podman"
      export RSDK_WEBUI_ENGINE="$2"
      shift 2
      ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) die "未知参数: $1（-h 看帮助）" ;;
  esac
done

# --- 1. node / pnpm ---------------------------------------------------------
command -v node >/dev/null 2>&1 || die "没有找到 node（需要 ≥ 20）：https://nodejs.org 或用系统包管理器安装"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
(( NODE_MAJOR >= 20 )) || die "node 版本过低（$(node -v)），需要 ≥ 20"

# pnpm 常被装在用户目录（standalone installer、npm --prefix），非交互 shell
# 的 PATH 里往往没有 —— 先把这些常见位置补进来，再判断有没有
for d in "$HOME/.local/bin" "$HOME/Library/pnpm" "$HOME/.npm-global/bin" \
         "$HOME/.local/share/pnpm" "$HOME/.pnpm" "/opt/homebrew/bin" "/usr/local/bin"; do
  if [[ -x "$d/pnpm" ]]; then PATH="$d:$PATH"; fi
done

PNPM=()
if command -v pnpm >/dev/null 2>&1; then
  PNPM=(pnpm)
else
  # packageManager 字段钉了 pnpm 版本，corepack 会按它来
  log "pnpm 不在，尝试 corepack"
  corepack enable >/dev/null 2>&1 || true
  if command -v pnpm >/dev/null 2>&1; then
    PNPM=(pnpm)
  elif command -v corepack >/dev/null 2>&1; then
    PNPM=(corepack pnpm)
  else
    die "pnpm/corepack 都不可用。装一个：npm i -g pnpm --prefix ~/.local 然后把 ~/.local/bin 加进 PATH（或用 corepack enable）"
  fi
fi

# --- 2. 容器引擎检查 ---------------------------------------------------------
IMAGE="${RSDK_WEBUI_IMAGE:-rsdk-image:latest}"
ENGINE="${RSDK_WEBUI_ENGINE:-}"
if [[ -z $ENGINE ]]; then
  if command -v podman >/dev/null 2>&1; then ENGINE=podman
  elif command -v docker >/dev/null 2>&1; then ENGINE=docker
  fi
fi

install_hint() {
  case "$(uname -s)" in
    Darwin)
      printf '  %s\n' \
        'macOS 装一个就行：' \
        '  brew install podman && podman machine init && podman machine start' \
        '  或者装 Docker Desktop：https://www.docker.com/products/docker-desktop/'
      ;;
    Linux)
      if command -v apt-get >/dev/null 2>&1; then
        printf '  %s\n' \
          'Debian / Ubuntu：' \
          '  sudo apt update && sudo apt install -y docker.io' \
          '  sudo usermod -aG docker "$USER"    # 之后重新登录一次'
      elif command -v dnf >/dev/null 2>&1; then
        printf '  %s\n' 'Fedora / RHEL：' '  sudo dnf install -y podman'
      elif command -v pacman >/dev/null 2>&1; then
        printf '  %s\n' 'Arch：' '  sudo pacman -S --needed podman'
      else
        printf '  %s\n' '用系统包管理器装 docker 或 podman 之一，装完确认 `docker info` 能跑'
      fi
      ;;
    *)
      printf '  %s\n' '安装 Docker 或 Podman 之一，装完确认 `docker info` 能跑'
      ;;
  esac
}

engine_daemon_ok() {
  [[ -n $ENGINE ]] && "$ENGINE" info >/dev/null 2>&1
}

# --check：打印清单后退出，不安装、不构建、不启动
if (( CHECK_ONLY )); then
  echo "rsdk-webui 环境检查"
  ok "node $(node -v)"
  if (( ${#PNPM[@]} )); then ok "pnpm $("${PNPM[@]}" -v 2>/dev/null || echo '?')"; else bad "pnpm 不可用"; fi
  if [[ -z $ENGINE ]]; then
    bad "容器引擎：没有找到 docker / podman"
    install_hint
  elif ! engine_daemon_ok; then
    bad "容器引擎：$ENGINE 已安装，但守护进程连不上"
    case "$(uname -s)" in
      Darwin) echo '  Docker Desktop 打开了吗？podman 用户先跑：podman machine start' ;;
      *)      echo '  试试：sudo systemctl start docker（或 podman.socket）'
              echo '  权限：sudo usermod -aG docker "$USER" 后重新登录' ;;
    esac
  else
    ok "容器引擎：$ENGINE $("$ENGINE" --version 2>/dev/null | head -1)"
  fi
  if engine_daemon_ok; then
    if "$ENGINE" image inspect "$IMAGE" >/dev/null 2>&1; then ok "镜像：$IMAGE 已导入"; else bad "镜像：$IMAGE 未导入（首次启动会下载 ~480MB）"; fi
  fi
  if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"${RSDK_WEBUI_PORT:-8787}" -sTCP:LISTEN >/dev/null 2>&1; then
    printf '  \033[1;33m!\033[0m %s\n' "端口 ${RSDK_WEBUI_PORT:-8787} 已被占用（可能已有实例在跑）"
  else
    ok "端口 ${RSDK_WEBUI_PORT:-8787} 空闲"
  fi
  if [[ -z $ENGINE ]] || ! engine_daemon_ok; then exit 1; fi
  exit 0
fi

if [[ -z $ENGINE ]]; then
  printf '\n'
  warn "环境检查没通过：没有找到 docker / podman"
  install_hint
  printf '\n'
  if (( SKIP_SETUP )); then
    warn "按 --no-image 继续启动：界面能打开，但板子列表读不出来（catalog 来自容器镜像），本机构建同样不可用"
  else
    printf '  只想先看看界面（不跑本机构建）：\n'
    printf '      ./start.sh --no-image\n\n'
    die "装好容器引擎后重新运行 ./start.sh"
  fi
elif ! engine_daemon_ok; then
  printf '\n'
  warn "环境检查没通过：$ENGINE 已安装，但守护进程连不上"
  case "$(uname -s)" in
    Darwin) echo '  Docker Desktop 打开了吗？podman 用户先跑：podman machine start' ;;
    *)      echo '  试试启动服务：sudo systemctl start docker（或 podman.socket）'
            echo '  权限不够：sudo usermod -aG docker "$USER" 之后重新登录' ;;
  esac
  printf '\n'
  die "修好后重新运行 ./start.sh"
fi

# --- 3. 依赖 ----------------------------------------------------------------
NEED_INSTALL=0
[[ -d node_modules ]] || NEED_INSTALL=1
[[ node_modules/.modules.yaml -ot pnpm-lock.yaml ]] 2>/dev/null && NEED_INSTALL=1
if (( NEED_INSTALL )); then
  log "安装依赖"
  "${PNPM[@]}" install --frozen-lockfile
else
  log "依赖已就绪，跳过安装"
fi

# --- 4. web 产物 ------------------------------------------------------------
NEED_BUILD=0
[[ -f web/dist/index.html ]] || NEED_BUILD=1
if [[ -f web/dist/index.html ]]; then
  # 源码比产物新（比如刚 git pull 过）就重建
  if [[ -n "$(find web/src web/index.html web/vite.config.ts shared/src -newer web/dist/index.html -print -quit 2>/dev/null)" ]]; then
    NEED_BUILD=1
  fi
fi
if (( NEED_BUILD )); then
  log "构建 web 产物"
  "${PNPM[@]}" build
else
  log "web 产物已是最新，跳过构建"
fi

# --- 5. 镜像 / 仿真 ----------------------------------------------------------
if [[ -n $ENGINE ]]; then
  # 镜像只有 amd64：arm64 主机要先有仿真能力，否则连 setup.sh 里的
  # `engine run … dpkg-query` 校验都跑不起来（exec format error）。
  # 必须排在导入镜像之前。
  if [[ "$(uname -m)" == aarch64 || "$(uname -m)" == arm64 ]]; then
    if [[ "$(uname -s)" == Darwin ]]; then
      # Docker Desktop / podman machine 自带 binfmt 与 Rosetta
      log "arm64 主机（macOS）：仿真由 Docker Desktop / podman machine 提供"
    elif [[ -r /proc/sys/fs/binfmt_misc/qemu-x86_64 ]] && grep -q '^enabled' /proc/sys/fs/binfmt_misc/qemu-x86_64 2>/dev/null; then
      log "arm64 主机：amd64 仿真已就绪"
    else
      log "arm64 主机：安装 amd64 仿真（tonistiigi/binfmt）"
      "$ENGINE" run --rm --privileged tonistiigi/binfmt --install amd64
    fi
    # 构建容器本身要以 amd64 模式跑（run.sh 的 RUN_EXTRA 会带上它）
    export RSDK_RUN_EXTRA="${RSDK_RUN_EXTRA:+$RSDK_RUN_EXTRA }--platform linux/amd64"
  fi

  if (( FORCE_SETUP )); then
    log "强制重新导入镜像（--force-setup）"
    ./ops/setup.sh --force
  elif (( SKIP_SETUP )); then
    log "跳过镜像检查（--no-image）"
  elif ! "$ENGINE" image inspect "$IMAGE" >/dev/null 2>&1; then
    log "镜像 $IMAGE 未导入，运行 ops/setup.sh（首次 ~480MB，取决于网络）"
    ./ops/setup.sh
  else
    log "镜像 $IMAGE 已就绪"
  fi
fi

# --- 6. 起服务 ----------------------------------------------------------------
PORT="${RSDK_WEBUI_PORT:-8787}"
port_busy() {
  command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}
DATA_DIR="${RSDK_WEBUI_DATA:-$HOME/.local/share/rsdk-webui}"
if port_busy "$PORT"; then
  # 服务端会在数据目录写 server.lock；有活着的主人就直接当"已经在跑"处理
  LOCK_INFO="$(node -e 'const fs=require("fs");try{const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));console.log((j.pid||"")+" "+(j.port||""))}catch{}' "$DATA_DIR/server.lock" 2>/dev/null || true)"
  LOCK_PID="${LOCK_INFO%% *}"
  LOCK_PORT="${LOCK_INFO##* }"
  if [[ -n $LOCK_PID ]] && kill -0 "$LOCK_PID" 2>/dev/null; then
    log "已经在跑：pid $LOCK_PID → http://127.0.0.1:${LOCK_PORT:-$PORT}"
    if [[ ${RSDK_WEBUI_NO_OPEN:-} != 1 ]] && command -v open >/dev/null 2>&1; then
      open "http://127.0.0.1:${LOCK_PORT:-$PORT}" >/dev/null 2>&1 || true
    elif [[ ${RSDK_WEBUI_NO_OPEN:-} != 1 ]] && command -v xdg-open >/dev/null 2>&1; then
      xdg-open "http://127.0.0.1:${LOCK_PORT:-$PORT}" >/dev/null 2>&1 || true
    fi
    exit 0
  fi
  if [[ -n ${RSDK_WEBUI_PORT:-} ]]; then
    die "端口 $PORT 已被占用（你显式指定了 RSDK_WEBUI_PORT），换一个：RSDK_WEBUI_PORT=$((PORT + 1)) ./start.sh"
  fi
  ORIGIN=$PORT
  for ((PORT = ORIGIN + 1; PORT <= ORIGIN + 20; PORT++)); do
    port_busy "$PORT" || break
  done
  warn "端口 $ORIGIN 被别的进程占用，改用 $PORT"
  export RSDK_WEBUI_PORT="$PORT"
fi

# 服务起来后自动打开浏览器（延时 2s 让 Fastify 先监听；RSDK_WEBUI_NO_OPEN=1 关闭）
if [[ ${RSDK_WEBUI_NO_OPEN:-} != 1 ]]; then
  OPEN=""
  if command -v open >/dev/null 2>&1; then OPEN=open                       # macOS
  elif command -v xdg-open >/dev/null 2>&1 && [[ -n ${DISPLAY:-}${WAYLAND_DISPLAY:-} ]]; then OPEN=xdg-open
  fi
  if [[ -n $OPEN ]]; then ( sleep 2 && "$OPEN" "http://127.0.0.1:$PORT" >/dev/null 2>&1 ) & fi
fi

log "启动 rsdk-webui → http://127.0.0.1:${PORT}  （Ctrl-C 停止）"
exec "${PNPM[@]}" start

# rsdk-webui

网页里点选定制 [RadxaOS](https://github.com/RadxaOS-SDK/rsdk) 系统镜像，构建跑在
**本机容器**（podman / docker）或你自己的 **GitHub Actions** 上。

它是对官方工具链的薄封装——`rsdk build`、官方 `rsdk-image` 容器、上游 jsonnet
树——不重新实现构建引擎。架构与设计取舍见
[docs/DESIGN.md](docs/DESIGN.md)。

```
┌ 定制流程 ──────┬──────────────────────────────────────────────┬─ 生成物预览 ─┐
│ 1 开发板与系统 │  选择开发板 (40 款，跟随 rsdk 的 BSP 支持)   │ rsdk build   │
│ 2 软件源       │  Radxa / Debian 镜像、test 源、快照           │ profile.json │
│ 3 软件包       │  64k 包索引搜索 + 常用组合                   │ install.sh   │
│ 4 系统配置     │  主机名、时区、用户、SSH、Wi-Fi、服务        │ inner.sh     │
│ 5 覆盖与脚本   │  往 rootfs 塞文件 / 跑自己的脚本             │ run.sh       │
│ 6 构建后端     │  本机容器 或 GitHub Actions                  │              │
│ 7 确认构建     │  预检 + 实时日志 + 产物下载                  │              │
└────────────────┴──────────────────────────────────────────────┴──────────────┘
```

## 快速开始

**方式一：本机运行**（Linux x86_64/arm64、macOS、Windows）

```bash
git clone https://github.com/xzl01/rsdk-webui && cd rsdk-webui
./start.sh            # Windows: .\start.cmd
```

一条命令起界面 + API（http://127.0.0.1:8787，自动打开浏览器）。脚本先做环境检查：
node/pnpm 有没有、**docker 或 podman 装没装、守护进程通不通**——缺了就停在这一步，
按你的系统给出安装命令，而不是带着半个环境继续跑。之后只在需要时做事：依赖齐了
跳过安装，产物比源码旧才重新构建，镜像已导入就不再碰，重复执行没有副作用。
首次会下载官方镜像（~480MB）。

```bash
./start.sh --check     # 只体检，看四项：node / pnpm / 容器引擎 / 镜像
./start.sh --no-image  # 不导入镜像，先看看界面（A 处构建不可用）
```

**方式二：GitHub Pages，零安装**

把构建完全交给 GitHub Actions，本机什么都不用装：

1. **Use this template** 或 **Fork** 本仓库，启用 **Actions**（fork 默认关闭）
   和 **Pages**（Settings → Pages → Source 选 *GitHub Actions*）
2. 打开 `https://<you>.github.io/rsdk-webui/`，粘一个只限该仓库的
   **fine-grained PAT**（Contents / Actions / Workflows 都是 Read and write）
3. 在界面里走完向导点构建——构建包在**浏览器里**组装，通过 Git Data API 提交到
   **你自己仓库**的 `build/<id>` 分支，触发仓库里的 workflow 跑 `run.sh`，日志与
   产物直接从 api.github.com 读回来

PAT 只存在浏览器 `localStorage`（界面上有大字提醒：页面上任何脚本能读到它）。
两种方式的 profile 与产物完全一致——靠运行时探测 `/api/health` 区分，一套代码。

**两种方式跑完之后**：本机构建的产物在
`~/.local/share/rsdk-webui/builds/<job-id>/work/out/`，Actions 构建在仓库的
Actions artifacts / Releases。构建包（bundle）是自包含的纯文件目录，
`profile.json` 可重新导入 UI，也可以拷到任何机器上 `./run.sh` 复现。

## 要求与平台

* Node.js ≥ 20（没有 pnpm 时启动脚本会用 corepack 自动补上）
* 本机容器构建需要 podman 或 docker + 约 8GB 磁盘（镜像 + 一次构建）
* `gh` CLI 已登录——仅 GitHub Actions 后端（本机运行模式）需要

| 平台 | 本机容器构建 | 说明 |
|---|---|---|
| Ubuntu / Debian x86_64 | podman 或 docker | 一等支持，`./start.sh` |
| Ubuntu / Debian **arm64** | docker | 镜像只有 amd64：`start.sh` 自动装 binfmt 仿真并以 `--platform linux/amd64` 运行构建容器（速度受仿真影响） |
| macOS x86_64 / Apple Silicon | podman 或 docker | 同 arm64 逻辑，`start.sh` 自动处理 |
| Windows x86_64 | 见下 | `.\start.cmd`（PowerShell） |

Windows 上：**GitHub Actions 后端**开箱即用（不需要 Docker 和 bash）；
**本机容器构建**是进阶玩法——需要 Git for Windows（`bash.exe` 在 PATH 里，run.sh
是 bash 脚本）+ 已导入的镜像，镜像导入建议在 WSL 里跑 `./ops/setup.sh`。

常用环境变量：`RSDK_WEBUI_PORT`（默认 8787）、`RSDK_WEBUI_HOST`（默认
127.0.0.1，改非回环地址会被拒绝启动，见疑难排查）、`RSDK_WEBUI_IMAGE`；
`start.sh` 选项 `--check` / `--no-image`（= `--skip-setup`）/ `--force-setup` /
`--engine docker|podman`、
`RSDK_WEBUI_NO_OPEN=1` 禁止自动开浏览器。

## 可定制什么

* **目标** —— 板卡、suite、edition、扇区大小、镜像名、产品覆盖
* **软件源** —— Radxa 镜像、Debian/Ubuntu 镜像、`-test` 源、快照时间戳、
  `pkgs.json`、任意带密钥的第三方 apt 源
* **软件包** —— 任意源的增删包（64k 条可搜索索引）、`--no-vendor-packages`、
  `-k` / `-f` 内核与固件覆盖、本地 `.deb` 目录 / 下载 URL
* **系统** —— 主机名、时区、locale、键盘、首个用户（密码哈希在浏览器里算），
  SSH（密钥 / 密码 / root 登录），NetworkManager Wi-Fi，systemd 服务
* **文件与脚本** —— 覆盖文件（文本或 base64 二进制，带 mode/owner），构建宿主
  或 rootfs 内执行的任意 shell 钩子

## 疑难排查

**服务退出并提示 `拒绝启动`** —— 你把 `RSDK_WEBUI_HOST` 设成了非回环地址。API
没有认证（profile 里可能有 Wi-Fi PSK），除非显式设置
`RSDK_WEBUI_ALLOW_REMOTE=1` 自担风险，否则拒绝监听网络。

**`podman` 报 `kernel does not support overlay fs`** —— graph root 在 btrfs 上。
`ops/setup.sh` 和服务端都会检测并切到 `~/.local/share/rsdk-webui/podman-root`
的独立存储（btrfs driver），不影响你自己的 podman 存储。

**构建在 `essential-hook` 报 `Unable to locate package linux-headers-<board>`**
—— 该板子的内核只发布在 `-test` 源（或该 suite 根本没有）。**确认构建**页会在
几秒内预检出这种情况；打开「使用测试源」重试。

**`rm: cannot remove '.../boot/efi': Device or resource busy`** —— 是之前失败的
后续，不是原因。往上翻日志找真正的错误。

**想要比发布镜像更新的 rsdk** —— `./ops/build-rsdk-image.sh` 从上游源码构建，
然后用 `RSDK_WEBUI_IMAGE=rsdk-webui/rsdk:latest ./start.sh` 启动。

## 开发

```bash
pnpm -r typecheck
pnpm test                     # 渲染器单测 + 容器集成测试
pnpm dev                      # 前端热更新（UI :5173 / API :8787）
node ops/ui-shot.mjs http://127.0.0.1:8787 /tmp/ui.png \
  --wait "document.querySelectorAll('.board').length > 0" \
  --eval "document.querySelectorAll('.rail .step')[3].click()"
```

`ops/ui-shot.mjs` 通过 CDP 驱动无头 Chrome：等真实条件满足再截图、可先执行 JS，
这就是这个项目不需要人守着键盘验证 UI 的方式。

## 仓库结构

```
shared/     zod profile schema + 所有渲染器（服务端与浏览器共用）
server/     Fastify API：catalog、profiles、包索引、preflight、jobs、后端
web/        Vite + React 向导、实时日志、构建历史
ops/        setup.sh、build-rsdk-image.sh、emit-static-assets.sh、check-boards.py
docs/       DESIGN.md（架构与决策记录）
```

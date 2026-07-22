# SymType

SymType 是一个私有、本地优先的 ANSI US QWERTY 英文打字训练 Web 应用。默认使用
**Symmetric 指法分区**：字符布局仍是标准 QWERTY，变化的是每个物理键建议使用的手指。
浏览器事件只能识别物理键，所有“手指/手区表现”都是依据当前映射推断，应用不会声称检测到
真实手指动作。

学习历史、设置、课程、逐键事件、游戏进度和导入文本均以本机服务器 SQLite 为权威数据源。
应用无账户、无遥测、无云服务、无 Docker；运行时不从 CDN 下载资源。

## 产品范围

- 今日训练、首次校准、智能/传统/弱点与迁移训练，以及独立计分的定时测试。
- 英文、伪词、数字录入、标点、大小写/Shift、源代码、自定义文本和长文内容模式。
- 按字符、组合、推断手/手指区、键盘行和内容模式组织的趋势、热力图与可解释反馈。
- 三套本地 Web Audio 音色、虚拟键盘、明暗主题、减少动态和训练交互设置。
- 六关虚构 Pineapple Breach campaign、Standard/Hard/Adaptive 难度与 Hardcore Run。
- CSV/JSON 导出、轮转 SQLite 快照、JSON 恢复预检和恢复前安全快照。

仓库采用 npm workspaces：`apps/web` 是 React/Vite 客户端，`apps/server` 是 Fastify/SQLite
本地服务，`packages/shared` 保存确定性键盘/指标/训练逻辑，`packages/content` 保存离线训练与
虚构游戏内容，`tests/e2e` 保存 Chromium/WebKit 验收，`docs` 保存规格、架构和可追踪证据。

## 一键启动

### 前提

- Node.js **22 LTS（22.12 或更新）**或 **24 LTS**，对应 package engine
  `>=22.12 <23 || >=24 <25`，并包含 npm 10 或更新版本。
- 首次安装依赖需要网络。首次成功安装后，在 lockfile 未变化的情况下，日常启动和运行可离线。
- 最新两个主要版本的 Chrome 与 Safari 是目标浏览器；自动化验收使用 Chromium 与 WebKit。

不要用非 LTS 的 Node 代替日常运行环境。`SYMTYPE_ALLOW_UNSUPPORTED_NODE=1` 只用于诊断，
不能把非受支持版本变成发布支持版本，原生 SQLite 模块也可能因此无法加载。

### macOS

在 Finder 中双击 **`start.command`**。也可在终端运行：

```sh
./start.command
```

如果 macOS 首次阻止未知的本地脚本，可在 Finder 中按住 Control 点击文件，选择“打开”，确认这
是你保存的项目副本。启动失败时窗口会保留错误信息；不要绕过系统对来源不明下载文件的安全检查。

### Windows

双击 `start.bat`。脚本从自身目录启动，与当前终端目录无关；失败时会停留等待确认。

### Linux

双击或从终端运行：

```sh
./start.sh
```

如果文件系统丢失了可执行位，先运行 `chmod +x start.sh`。

### npm 启动方式

以下命令启动、等待健康检查、打印最终 URL 并自动打开默认浏览器：

```sh
npm run start:local
```

自动化或无图形环境需要禁止打开浏览器时使用：

```sh
npm run start:local:no-open
```

启动器会检查 Node/npm，只有首次、`package-lock.json` 变化或依赖目录损坏时执行锁定安装；安装命令
会显式包含构建所需的开发依赖，即使调用环境预设了 `NODE_ENV=production`。
Node ABI、操作系统或 CPU 架构单独变化时只重建原生 SQLite 模块。它只在产物缺失/损坏或
源码/构建配置指纹变化时构建，并用带 SHA-256 的产物清单检查延迟加载脚本、样式和 sourcemap，
随后执行迁移、等待 `/api/v1/health`，再打开最终 URL。首选端口
默认是 `4173`；端口占用时服务器
会选择安全的空闲回环端口。已存在的健康实例会被复用。请保留首次启动它的终端窗口；在该窗口按
Ctrl+C 会触发服务器优雅关闭。复用实例的后续启动器不会停止或接管原进程。

## 开发与质量命令

在仓库根目录运行：

```sh
npm ci                 # 按 lockfile 安装依赖
npm run dev            # 启动各 workspace 的开发监听
npm run start:local    # 生产式本地启动并打开验证后的 URL
npm run start:local:no-open
npm run migrate        # 前向迁移并检查 SQLite 完整性
npm run build          # 构建 shared、content、web、server
npm run format:check   # 检查 Prettier 格式，不改写文件
npm run lint
npm run typecheck
npm test
npm run test:regression # V1 固定输出回归
npm run test:e2e       # Playwright Chromium + WebKit
npm run check          # lint + typecheck + unit/integration + build
```

`npm run check` 是非交互式质量门；发布候选还必须单独运行 `npm run test:e2e`。开发服务器与生产
服务器都只应在回环地址上使用。生产式启动由 Fastify 同一源提供构建后的前端和 `/api/v1`。
首次在某台开发机运行 E2E 前，还需下载 Playwright 管理的本地浏览器二进制；这不是应用运行时依赖：

```sh
npx playwright install chromium webkit
```

Linux 若提示缺少系统库，请按 Playwright 输出安装对应依赖；不要为普通日常启动安装浏览器测试包。

### 项目状态与证据索引

SymType 采用基于文档的开发模式。V1 功能追踪见 [`docs/requirements-matrix.md`](docs/requirements-matrix.md)；
V2 当前状态、分类和验收见 [`docs/v2/V2-PLAN.md`](docs/v2/V2-PLAN.md) 与
[`docs/v2/REQUIREMENTS-MATRIX.md`](docs/v2/REQUIREMENTS-MATRIX.md)。持久设计选择写入决策记录，
性能和兼容性只保存会影响发布结论的命令与结果，不逐条复制机械调查过程。

2026-07-22 的 2.0.0 发布候选使用 Node.js 22.16.0：`npm run check` 通过 lint、严格类型检查、
60 个 Vitest 文件（421 通过、1 个有意跳过）、22 项 V1 固定输出和四个生产构建；完整生产式
Playwright 收集 74 个 Chromium/WebKit 用例，73 个通过、1 个只需由 Chromium 单次拥有的生命周期
用例有意跳过，耗时 7.1 分钟。隔离一键启动通过离线首次安装、schema v10、端口回退、实例复用、
损坏产物重建与优雅关闭。最小性能基线和 100k Today → 课程完成 → Analytics 烟测也通过；详见
[`docs/v2/PERFORMANCE-RESULTS.md`](docs/v2/PERFORMANCE-RESULTS.md)。

## 数据、日志与端口

默认应用数据目录：

| 系统    | 目录                                        |
| ------- | ------------------------------------------- |
| macOS   | `~/Library/Application Support/SymType/`    |
| Windows | `%APPDATA%\SymType\`                        |
| Linux   | `${XDG_DATA_HOME:-~/.local/share}/symtype/` |

主要文件：

- `symtype.sqlite3`：权威数据库；运行时可能同时看到 SQLite 的 `-wal` 和 `-shm` 文件。
- `backups/*.sqlite3`：应用创建并轮转的 SQLite 快照，默认保留最近 7 个。
- `logs/launcher.log`：安装、构建、迁移、实例复用和健康检查记录。
- `logs/symtype.log`：本地服务器日志；事件正文和自定义文本不会写入日志。
- `server-info.json`：最终 URL、PID、启动时间和数据库路径。端口冲突时从这里读取真实 URL。

在 macOS/Linux 上，一键启动器与服务器为新建的数据、日志和备份采用仅当前用户可访问的 umask；
Windows 依赖 `%APPDATA%` 的用户 ACL。已有文件不会被启动器静默改写权限，迁移旧目录前请先检查其
所有者与访问权限。

可在启动前设置 `SYMTYPE_DATA_DIR` 使用独立数据目录；相对路径按仓库根目录解析。开发和自动化
测试应使用 `.symtype-data/` 或 `.symtype-test-data/` 等 gitignore 目录，不要指向正式个人数据。
为避免把数据库、锁或日志误放到危险范围，启动器会拒绝把文件系统根目录作为数据目录。
这一检查也会解析已经存在的符号链接，不能用指向根目录的链接绕过。
Linux 上只接受绝对路径形式的 `XDG_DATA_HOME`；空值或相对值按 XDG 规范回退到
`~/.local/share`。`.env.example` 是环境变量清单，启动器不会在未告知用户的情况下自动读取
`.env`；请在启动命令所在的 shell 中设置需要的覆盖项。

示例（macOS/Linux）：

```sh
SYMTYPE_DATA_DIR=.symtype-data npm run start:local
```

PowerShell：

```powershell
$env:SYMTYPE_DATA_DIR = ".symtype-data"
npm run start:local
```

## 导出、备份与恢复

在“设置 → 数据与备份”中可以：

- 导出课程汇总 CSV；CSV 只用于分析，不是完整备份。
- 导出带 schema 和算法版本的完整 JSON；这是应用内可校验、可移植的恢复格式。
- 下载当前数据库的一致性 SQLite 备份，用于完整的本机灾难恢复。
- 创建当前 SQLite 的一致性快照；快照保存在数据目录的 `backups/`，并自动轮转。
- 每次启动在迁移与完整性检查通过后确保当天已有一个自动快照；同一天重复启动不会重复创建，
  损坏或校验不一致的快照不会计入 7 份有效轮转。
- 选择 SymType JSON 或 `.sqlite`/`.sqlite3`/`.db` 备份后，先预览 profile/session/event 数量再确认。
  SQLite 上传使用 15 分钟、单次有效的本机恢复令牌；提交前会再次校验 schema、外键和
  `integrity_check`。两种恢复都会先创建当前数据库快照，失败时保留原库。

恢复期间不要关闭服务器。格式错误、未来 schema 或引用损坏的 JSON 会被拒绝；应用不会通过新建
空数据库掩盖迁移/恢复失败。不要在服务器仍运行时直接覆盖 `symtype.sqlite3`；优先使用应用内
经过预检、恢复前快照与 SQLite 事务执行的 JSON/SQLite 恢复。确需手工操作时，先停止 SymType
并复制整个数据目录。

## 常见故障

### 提示 Node 版本不受支持

安装 Node 22 LTS（至少 22.12）或 Node 24 LTS，关闭旧终端后重试。诊断覆盖只用于收集错误，
不能作为正常启动方案。

### 首次 `npm ci` 失败

确认首次安装时网络和 npm registry 可用，并查看 `logs/launcher.log` 的首个错误。不要删除数据库；
依赖目录与应用数据目录彼此独立。lockfile 未变化时，后续正常启动不会重复安装。

### 浏览器没有自动打开

启动成功信息会打印准确 URL；也可查看 `server-info.json`。复制其中的本机 `http://127...` URL 到
浏览器。`npm run start:local:no-open`、`--no-open` 或 `SYMTYPE_OPEN_BROWSER=0` 会有意禁止自动打开。

### 默认端口已占用

无需结束其他程序。SymType 会请求操作系统分配空闲回环端口，健康检查通过后使用最终 URL。不要
手工猜测端口。

### 数据库或迁移失败

先保留整个应用数据目录，再查看 `logs/launcher.log` 和 `logs/symtype.log`。启动器不会静默删除、
重建或替换失败的数据库。不要在未备份时删除 SQLite、WAL 或 SHM 文件。

### 只检查启动决策

以下命令不安装、不构建、不迁移、不启动，也不打开浏览器：

```sh
node scripts/start-local.mjs --dry-run --no-open
```

可自动验证 Node 版本门槛、错误工作目录、三平台 wrapper 契约和 dry-run 无数据库副作用：

```sh
npx vitest run apps/server/test/launcher.test.ts --config vitest.config.ts
```

发布候选可在系统临时目录创建隔离副本，执行真实的首次安装、构建、迁移、端口冲突回退、健康复用、
POSIX 私有文件权限、无变化离线重启、损坏产物重建、lockfile 变化决策和优雅停止；它不会读取
`.env`、浏览器 profile、正式数据库或自定义文本，成功后自动删除副本：

```sh
node scripts/launcher-full-smoke.mjs --node /path/to/node-24
```

已有完整 npm cache 时可加 `--offline`。这项验证会在隔离副本执行 `npm ci`，未缓存时仍需首次安装
网络；不要用 `--allow-unsupported` 的诊断结果作为发布证据。

更详细的状态机和验收场景见 [`docs/launcher.md`](docs/launcher.md)。

## 参与开发

`main` 是唯一稳定主线，禁止直接在其上开发或提交产品变更。每项功能、修复、重构、测试、文档或
工程配置工作都必须先关联 Issue，再从最新 `main` 创建带 Issue 编号的独立分支，经原子 Commit、
Pull Request、CI 和至少一次批准审查后，以 Squash Merge 进入主线。空远程仓库只允许一个不包含
任何文件的初始化 Commit；此后所有仓库文件同样必须通过 PR。

完整的分支命名、Issue 内容、质量门禁、审查、合并和发布规则见
[`CONTRIBUTING.md`](CONTRIBUTING.md)。提交 PR 前至少运行 `npm run format:check` 与
`npm run check`；发布候选还必须运行 `npm run test:e2e`，并记录 Chromium 与 WebKit 的实际结果。

## 隐私与安全边界

服务默认绑定 `127.0.0.1`，并校验 Host、Origin 和修改型 API 的 CSRF 令牌。自定义文本按纯文本
显示；不要导入真实密码、API key、私钥、钱包助记词或恢复短语。应用只记录激活训练区域内的
按键，不会记录其他应用或页面的输入。清除浏览器数据或换浏览器不会删除服务器 SQLite 历史。

## Clean-room 与许可证

SymType 采用独立 clean-room 实现。Keybr 的公开功能说明与用户提供的功能截图只用于功能盘点；
本仓库不复制 Keybr 的源代码、图标、文案、视觉资产或页面布局，也不依赖 Keybr。Keybr 公开仓库
采用 AGPL-3.0，其权利仍归相应作者。研究来源与证据边界见
[`docs/research-basis.md`](docs/research-basis.md)。

SymType 源代码采用 [MIT License](LICENSE)。依赖与内容许可见
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

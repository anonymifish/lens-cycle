# Lens Cycle

Lens Cycle 是一款 Windows 11 本地桌面应用，用于管理眼部护理用品的库存、使用生命周期、
护理事件、预测和成本。应用以本地 SQLite 为唯一业务数据源，无需账户或云端服务。

## 主要功能

- 连续时间轴：平移、缩放、筛选、分组、生命周期和护理事件；
- 用品配置、产品、批次、包装/散片库存和多地点转移；
- 长期硬镜、日抛、多天软镜、镜盒、镜片用品、开封瓶、离散剂量、批次耗材八类模板；
- 启用、使用、暂停、恢复、结束、撤销、改期和误录删除；
- 不可变库存流水、反向更正、低库存/临期预警和成本统计；
- JSON 备份恢复和本机数据位置移动。

完整需求见 [docs/requirements.md](./docs/requirements.md)，开发文档入口见
[docs/README.md](./docs/README.md)。

## 技术栈

React 19 + TypeScript + Vite 构建界面，Tauri 2 承载 Windows 桌面运行时，Rust +
rusqlite 管理 SQLite。Zustand 只保存已成功提交到 SQLite 的界面状态。

系统结构见 [docs/system_architecture.md](./docs/system_architecture.md)，领域和事务规则见
[docs/system_design.md](./docs/system_design.md)。

## 本地构建

支持环境为 Windows 11 x64。请先安装：

- Node.js `24.19.0` 和 pnpm `11.19.0`；
- Rust `1.98.0`（MSVC target）；
- Visual Studio 2022 Build Tools：使用 C++ 的桌面开发及 Windows SDK；
- Microsoft Edge WebView2 Runtime；
- PowerShell 7。

```powershell
git clone git@github.com:anonymifish/lens-cycle.git
Set-Location lens-cycle
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm check:environment
pnpm install --frozen-lockfile
pnpm qa:all local-check
pnpm dev
```

`pnpm dev` 是正式桌面开发入口。单独运行 `pnpm dev:frontend` 不提供可验收的业务存储。
开发前建议按 [开发指南](./docs/development.md#3-桌面开发) 设置隔离的
`LENS_CYCLE_DATA_DIR`，避免访问已安装应用的数据。

构建经过完整门禁的 Windows Release：

```powershell
$runId = "release-$((Get-Date).ToString('yyyyMMdd-HHmmss'))"
pnpm release:windows $runId
```

输出位于 `releases/<version>/windows-x64`。详细环境准备、独立命令、测试和产物说明见
[docs/development.md](./docs/development.md)。

## 质量门禁

```powershell
pnpm check:environment
pnpm check:storage-architecture
pnpm typecheck
pnpm lint
pnpm test:coverage
pnpm build
```

前端覆盖率门槛为行覆盖率 90%、分支覆盖率 85%。`pnpm qa:all <run-id>` 还会运行 Rust
fmt、clippy 和完整测试，并把生成物写入被 Git 忽略的隔离目录。

## 数据与隐私

业务数据默认位于操作系统分配给 `com.lenscycle.desktop` 的应用数据目录。仓库不应包含
真实数据库、备份、测试运行结果、日志、安装包、密钥或个人路径；`.gitignore` 已覆盖常见
产物。

## 许可证

Lens Cycle 以 [GNU General Public License v3.0 only](./LICENSE) 发布，SPDX 标识为
`GPL-3.0-only`。你可以使用、研究、修改和分发本项目；对外分发修改版或二进制时，必须
遵守 GPLv3 对许可证声明和对应源代码的要求。

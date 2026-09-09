# Lens Cycle 开发与构建指南

## 1. 环境

支持 Windows 11 x64。需要 Git、PowerShell 7，以及：

- Node.js `24.19.0`；
- pnpm `11.19.0`；
- Rust `1.98.0` 和 `x86_64-pc-windows-msvc` target；
- Visual Studio 2022 Build Tools 的“使用 C++ 的桌面开发”组件和 Windows SDK；
- Microsoft Edge WebView2 Runtime（Windows 11 通常已安装）。

版本文件 `.node-version`、`package.json`、`rust-toolchain.toml` 是最终依据。

## 2. 获取项目

```powershell
git clone git@github.com:anonymifish/lens-cycle.git
Set-Location lens-cycle
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm check:environment
pnpm install --frozen-lockfile
```

环境门禁失败时应安装指定版本，不要绕过 `.npmrc` 的 `engine-strict`。

## 3. 桌面开发

正式业务入口必须通过 Tauri 启动。建议每次开发显式使用隔离数据目录：

```powershell
$runId = "dev-$((Get-Date).ToString('yyyyMMdd-HHmmss'))"
$dataDir = Join-Path (Get-Location) "artifacts/runs/$runId/data"
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
$env:LENS_CYCLE_DATA_DIR = $dataDir
pnpm dev
```

`pnpm dev:frontend` 只用于 Tauri 的 Vite 开发服务器。单独打开会停在启动错误页，不是受
支持的业务入口，也不会回退到浏览器存储。

## 4. 常用检查

```powershell
pnpm check:environment
pnpm check:storage-architecture
pnpm typecheck
pnpm lint
pnpm test
pnpm test:coverage
pnpm build
```

完整门禁使用隔离 Run：

```powershell
pnpm qa:new-run local-check
pnpm qa:all local-check
```

脚本会把覆盖率、日志、测试数据库和 Cargo target 写入
`artifacts/runs/<run-id>`。测试规则见 [testing.md](./testing.md)。

## 5. Windows Release

推荐使用项目脚本完成隔离构建和门禁：

```powershell
$runId = "release-$((Get-Date).ToString('yyyyMMdd-HHmmss'))"
pnpm release:windows $runId
```

脚本生成独立 Vite 和 Cargo 输出，并把 EXE、MSI、NSIS 安装程序复制到
`releases/<version>/windows-x64`。构建和测试生成物默认被 Git 忽略。未经 Authenticode
签名的安装包可以本地安装，但 Windows 可能显示未知发布者或 SmartScreen 提示。

## 6. 目录约定

| 目录 | 内容 | 提交 Git |
| --- | --- | --- |
| `src` | 前端生产代码和就近单元测试 | 是 |
| `src-tauri` | Rust、迁移、权限和图标 | 是，生成目录除外 |
| `tests` | 验收定义、人工 fixture、桌面驱动 | 是 |
| `docs` | 现行需求、设计、开发和测试文档 | 是 |
| `scripts` | 环境、QA、Release 和维护脚本 | 是 |
| `artifacts` | 隔离测试和构建工作区 | 否，仅 README |
| `releases` | 本地构建的可执行程序和安装包 | 否，说明文档可提交 |
| `node_modules`、`.pnpm-store-local` | 可重建依赖 | 否 |

## 7. 变更规则

- 业务规则变化必须同步更新需求、设计和测试；
- SQLite 结构变化必须新增迁移，不改写已经分发的迁移；
- 库存余额必须能由不可变流水重建；
- 测试数据必须从空隔离目录创建，不复制真实数据库；
- 修改业务源码后运行完整前端覆盖率和 Rust 门禁；
- 不提交数据库、备份、日志、覆盖率、安装包、密钥或个人绝对路径。

## 8. 许可证与分发

项目采用 `GPL-3.0-only`。贡献代码应能够在该许可证下分发。发布 EXE、MSI 或 NSIS 时，
需要同时保留许可证声明，并按 GPLv3 要求向接收者提供对应版本的完整源代码或有效的源代码
获取方式。许可证全文见 [`LICENSE`](../LICENSE)。

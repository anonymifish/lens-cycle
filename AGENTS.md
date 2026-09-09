# Lens Cycle

Windows 11 本地眼部护理用品生命周期管理应用。React/TypeScript 提供界面，Tauri 2 +
Rust + SQLite 是唯一业务持久化路径。产品面向个人离线管理。

## 文档入口

先读 [docs/README.md](./docs/README.md)，再按任务查看：

- 需求：[docs/requirements.md](./docs/requirements.md)
- 架构：[docs/system_architecture.md](./docs/system_architecture.md)
- 设计：[docs/system_design.md](./docs/system_design.md)
- 开发和构建：[docs/development.md](./docs/development.md)
- 测试：[docs/testing.md](./docs/testing.md)

## 核心约束

- 正式入口必须通过 Tauri；不要增加浏览器存储或内存业务数据回退。
- SQLite 提交成功后才能发布 Store 状态；失败操作必须完整回滚。
- 库存由流水重建；已提交流水不可修改或删除，只追加更正或反向流水。
- 日期使用本地 `YYYY-MM-DD`，金额使用最小货币单位整数。
- 已发布 schema 只通过新增迁移演进。
- 测试数据必须位于 `artifacts/runs/<run-id>/data`，不得读取或复制真实应用数据。
- 不提交数据库、备份、日志、覆盖率、构建产物、安装包、密钥或个人路径。
- 项目许可证为 `GPL-3.0-only`；新增代码和依赖必须与其兼容。

## 验证

```powershell
pnpm check:environment
pnpm qa:all <run-id>
```

前端覆盖率门槛：行 90%，分支 85%。业务规则、schema 或操作方式变化时，先确认需求，
并在同一变更中更新自动测试、169 项清单和对应现行文档。

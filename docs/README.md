# Lens Cycle 开发文档

本目录只把以下文件视为当前权威文档：

| 主题 | 文档 |
| --- | --- |
| 产品定位、范围和验收条件 | [requirements.md](./requirements.md) |
| 系统架构和源码边界 | [system_architecture.md](./system_architecture.md) |
| 领域、事务、库存和恢复设计 | [system_design.md](./system_design.md) |
| 开发环境、本地构建和目录规范 | [development.md](./development.md) |
| 测试分层、桌面闭环和门禁 | [testing.md](./testing.md) |
| 当前可公开测试基线 | [test_report.md](./test_report.md) |
| SQLite 可执行 schema | [`src-tauri/migrations/001_initial.sql`](../src-tauri/migrations/001_initial.sql) |

需求、设计和测试信息已从旧需求稿、技术指南、手工清单、测试方案和历史执行提示词合并到
上述文档。机器可读的 169 项验收清单保存在
[`tests/acceptance/cases-169.csv`](../tests/acceptance/cases-169.csv)。

发生冲突时，以已发布迁移和生产代码为第一依据，然后是自动测试与本目录现行文档。业务
规则有歧义时先确认需求，不要增加兼容分支或修改测试数据来掩盖差异。

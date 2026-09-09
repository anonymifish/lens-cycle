# 测试与构建产物

- `work`：日常开发可复用、可随时清理的构建产物。
- `runs/<run-id>`：正式测试的隔离数据、日志、证据、报告和临时构建目录。
- `legacy`：尚未转成标准 Run 的旧测试现场。

正式 Run 完成后，将发布文件复制到 `releases`，再使用
`scripts/maintenance/compact-run.ps1` 清理大型可重建目录。

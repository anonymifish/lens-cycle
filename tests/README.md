# Lens Cycle 测试目录

- `acceptance/cases-169.csv`：可复用的验收用例定义，不保存某次执行状态。
- `desktop/cdp-driver.mjs`：连接已启动 WebView2 调试端口的桌面自动化驱动。
- `desktop/scenarios`：后续存放可重复执行的桌面场景脚本。
- `fixtures`：仅存放人工构造或程序生成的测试输入；禁止复制真实数据库作为测试夹具。

测试执行结果统一写入 `artifacts/runs/<run-id>`。测试源码继续与生产源码就近放置，
不在本目录重复维护前端或 Rust 单元测试。

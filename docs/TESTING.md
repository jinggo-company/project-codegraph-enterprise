# CodeGraph Enterprise — TESTING v1

## 环境矩阵

| 环境 | OS | 用途 |
|------|-----|------|
| dev | Ubuntu 22.04 / macOS 14+ | 本地开发 + CodeGraph OSS 验证 |
| staging | Ubuntu 22.04 + Docker | PRD 验收 + 集成测试 |
| prod | Ubuntu 22.04 + K8s | 多租户生产部署 |
| ci | GitHub Actions (Ubuntu 22.04) | Webhook 模拟 + 自动化测试 |

### 环境搭建命令
```bash
# 1. 克隆项目 + CodeGraph OSS 验证
git clone https://github.com/colbymchenry/codegraph.git && cd codegraph

# 2. CodeGraph 本地扫描验证
npx codegraph init
npx codegraph scan .
npx codegraph serve &
# 验证 MCP 端点可用
curl http://localhost:3000/health

# 3. Docker Compose 启动 SaaS 平台
cd ../codegraph-enterprise
docker compose up -d

# 4. 健康检查
curl http://localhost:8000/api/health
# → {"status": "ok", "version": "1.0.0"}
```

## E2E 冒烟路径

### Path 1: 平台部署与项目索引
1. `docker compose up -d` 启动 SaaS 平台
2. `curl http://localhost:8000/api/health` → 200 OK
3. 注册团队账号 → 创建项目 → 绑定 GitHub 仓库
4. 手动触发索引构建 → 等待完成
5. 控制台查看索引状态 → 显示文件数/语言分布/构建时间

### Path 2: CI/CD 自动索引
1. 配置 GitHub Webhook URL 和 Secret
2. 向绑定仓库 push 一次代码
3. 观察平台接收 Webhook 事件 → 触发异步索引构建
4. 构建完成后控制台状态更新为 "synced"
5. 审计日志显示 Webhook 接收记录和构建记录

### Path 3: MCP Server 查询
1. 获取 MCP 端点 URL 和 API Key
2. 配置 Claude Code / Cursor 连接到 CodeGraph Enterprise MCP
3. 执行查询 "find callers of function X"
4. 验证返回图谱数据包含调用链/符号关系
5. 审计日志记录此次查询

### Path 4: 跨项目搜索
1. 索引 2 个不同项目
2. 执行跨项目搜索 "getUser"
3. 验证返回结果覆盖两个项目
4. 按项目维度分组展示

### Path 5: 多租户隔离
1. 租户 A 登录，创建项目，触发索引
2. 租户 B 登录，尝试访问租户 A 的项目 API
3. 验证返回 403 Forbidden
4. 租户 B 只能看到自己的项目

### Path 6: 企微/钉钉通知
1. 配置企微/钉钉 Webhook 地址
2. 手动触发索引构建
3. 验证收到 "索引构建成功" 通知消息

## AC → 测试类型映射

| AC | 测试类型 | 自动化级别 |
|----|----------|-----------|
| AC-1 | E2E + 环境部署 | 手动 + 脚本验证 |
| AC-2 | E2E + 认证 | 自动化 (Playwright) |
| AC-3 | E2E + 性能 | 自动化 (pytest + time) |
| AC-4 | 集成 + E2E | 自动化 (GitHub Actions mock) |
| AC-5 | E2E + 集成 | 手动 + MCP SDK 测试 |
| AC-6 | E2E | 自动化 (API test) |
| AC-7 | 安全 | 自动化 (API 鉴权测试) |
| AC-8 | E2E + 安全 | 自动化 (日志查询 API) |
| AC-9 | E2E + 计费 | 自动化 (mock 支付) |
| AC-10 | 集成 | 自动化 (webhook mock) |
| AC-11 | 性能 | 自动化 (locust) |
| AC-12 | 安全 | 自动化 (SQLi + RLS 测试) |

## 测试命令

```bash
# 单元测试
pytest tests/unit/ -v

# 集成测试
pytest tests/integration/ -v

# MCP 查询链路测试
pytest tests/mcp/ -v

# E2E 冒烟测试
pytest tests/e2e/smoke/ -v

# 多租户隔离测试
pytest tests/security/tenant_isolation/ -v

# 性能压测
locust -f tests/perf/locustfile.py --headless -u 10 -r 2 --run-time 60s

# Webhook 集成测试（GitHub mock）
pytest tests/integration/webhook/ -v --github-mock
```

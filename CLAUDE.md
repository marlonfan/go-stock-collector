# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 在此代码库中工作时提供指导。

## 项目概述

这是一个使用 Go 构建的股票数据采集和跟踪应用。它从 Yahoo Finance 获取分钟级股票数据，存储到 SQLite 数据库，并提供 CLI 和 Web 两种界面进行数据访问和分析。

## 常用命令

### 开发环境
```bash
# 安装依赖
go mod tidy

# Web 模式运行（默认，在 8080 端口启动 Web 服务器）
go run .

# CLI 模式运行
go run . -mode=cli -symbol=TSLA -days=30 -action=collect

# 构建应用
go build -o stock-data-collector
```

### CLI 操作
```bash
# 收集股票数据
go run . -mode=cli -symbol=TSLA -days=30 -action=collect

# 分析现有数据
go run . -mode=cli -symbol=TSLA -action=analyze

# 显示样本数据
go run . -mode=cli -symbol=TSLA -action=sample
```

### Web 模式
```bash
# 启动 Web 服务器（默认 8080 端口，启用定时更新）
go run . -mode=web

# 自定义端口
go run . -mode=web -port=3000

# 禁用定时更新（仅手动同步）
go run . -mode=web -scheduler=false
```

### 定时更新功能
Web 模式默认启用定时更新功能，每天中国时间早上 8:00 自动同步所有监控列表中的股票数据。

**特性**：
- 使用中国时区（Asia/Shanghai, UTC+8）
- 每天 8:00 AM 自动更新所有监控股票
- 智能增量更新（自动判断需要获取的天数）
- 使用 `github.com/robfig/cron/v3` 实现调度

**控制选项**：
- `-scheduler=true`：启用定时更新（默认）
- `-scheduler=false`：禁用定时更新，仅手动同步

## 架构设计

### 核心组件

**main.go**: 程序入口，处理模式切换（web/cli）。解析命令行参数并路由到相应模式。

**数据库层 (database.go)**:
- SQLite 数据库封装，包含三张表：`stock_minute_data`（分钟数据）、`watched_stocks`（监控列表）、`stock_daily_summary`（日线汇总）
- 分钟数据存储带自动去重（symbol+timestamp 唯一约束）
- 从分钟数据计算日线汇总，自动过滤周末
- 提供时间范围查询的数据检索功能

**数据采集 (stock_collector.go + yahoo_client.go)**:
- `StockCollector`: 协调数据获取和存储
- `YahooFinanceClient`: Yahoo Finance API 客户端，支持批量获取（7天一批以遵守 API 限制）
- 实现智能增量更新（只获取自上次同步以来的新数据）
- **关键改进**: 始终重新获取最后一天的完整数据，确保盘中更新不会导致数据不完整
- 数据验证过滤器：移除零成交量K线、异常价格、极端价格变动（单分钟 >20%）

**Web 服务器 (server.go + handlers.go)**:
- 基于 Gin 的 REST API，从 `./static/` 提供静态文件服务
- API 端点使用 `/api/` 前缀
- 股票管理：添加/移除监控股票、同步数据、获取汇总
- 搜索功能，支持中文/拼音搜索

**股票搜索 (stock_search.go)**:
- 从 `stocks.csv` 加载股票数据（股票代码、名称、中文名称、代码）
- 支持模糊匹配：精确匹配、前缀匹配、拼音首字母、子串匹配
- 内置常见股票的中文-拼音映射（AAPL→苹果、TSLA→特斯拉等）

**定时调度器 (scheduler.go)**:
- 使用 `github.com/robfig/cron/v3` 实现定时任务调度
- 配置为中国时区（Asia/Shanghai, UTC+8）
- 每天早上 8:00 自动更新所有监控列表中的股票
- 支持优雅关闭（在 Web 服务器关闭时自动停止）
- 可通过命令行参数 `-scheduler` 启用/禁用

### 数据流

1. **CLI 模式**: 用户运行命令 → StockCollector 从 Yahoo 获取 → Database 存储/去重 → 分析/显示
2. **Web 模式**: 前端调用 API → Handler 验证 → StockCollector/Database 操作 → JSON 响应
3. **日线汇总**: 分钟K线 → 按日期分组 → 计算 OHLCV → 存储到 daily_summary 表
4. **定时更新**: Scheduler (cron) → 每天 8:00 AM → 遍历监控股票 → StockCollector 增量更新 → 更新同步时间

### 关键文件
- `models.go`: API 请求/响应和领域对象的数据结构
- `stocks.csv`: 搜索功能的股票代码查找数据库
- `stock_data.db`: SQLite 数据库（首次运行时自动创建）

## 重要实现细节

### Yahoo Finance API 限制
- 每次请求最多 7-8 天的分钟数据
- 客户端对超过 7 天的请求实现批处理
- 批次之间延迟 1 秒以避免触发速率限制
- 包含盘前/盘后数据（`includePrePost=true`）

### 数据验证
系统过滤无效数据点：
- 零成交量K线（可能是盘前/盘后噪音）
- $1-$10,000 范围外的价格
- 无效的 OHLC 关系（最高价 < 开盘/收盘价，最低价 > 开盘/收盘价）
- 极端价格变动（单分钟 >20%）

### 数据库架构
- `stock_minute_data`: 分钟级 OHLCV 数据，在 (symbol, timestamp) 上建立索引
- `watched_stocks`: 用户监控列表，跟踪最后同步时间
- `stock_daily_summary`: 从分钟数据计算的日线聚合 OHLCV

### 分钟线到日线的转换逻辑

#### 时区处理 (database.go:326-352)
美股交易时间跨越两个日期（例如：美东时间 10/1 09:30 = 中国时间 10/1 21:30，美东时间 10/1 16:00 = 中国时间 10/2 04:00）

**解决方案**：
- 将所有时间戳转换为美东时间 (America/New_York)
- 按美东时间的日期分组
- 这确保一个交易日的所有数据都归到同一个日期

#### OHLCV 计算 (database.go:361-390)
```
1. 按美东时间日期分组分钟K线
2. 过滤周末（周六和周日）
3. 对每天的K线按时间排序
4. 计算：
   - Open (开盘):  第一根分钟K线的开盘价
   - High (最高):  所有分钟K线中的最高价
   - Low (最低):   所有分钟K线中的最低价
   - Close (收盘): 最后一根分钟K线的收盘价
   - Volume (成交量): 所有分钟K线的成交量总和
5. 使用 INSERT OR REPLACE 保存（允许更新不完整的数据）
```

### 数据更新机制

#### 手动触发更新
数据**不会自动更新**，需要手动触发：
- CLI: `go run . -mode=cli -symbol=TSLA -action=collect`
- Web: 点击 "Sync Data" 按钮（调用 `POST /api/stocks/{symbol}/sync`）

#### 智能增量更新 (stock_collector.go:37-75)
系统会自动判断需要获取多少天的数据：

1. **检查最新数据时间戳**
2. **计算需要获取的天数** = 距离最新数据的天数 + 1
3. **关键特性**：始终重新获取最后一天，确保数据完整性

**为什么要 +1 天？**

假设场景：
```
10月2日下午2点 - 首次同步
  ↓ 获取 10/2 的部分数据（09:30-14:00）
  ↓ 最新时间戳：2025-10-02 14:00

10月2日收盘后 - 再次同步
  ↓ 检测到最新数据是今天
  ↓ 重新获取完整的 10/2 数据（09:30-16:00）
  ↓ INSERT OR REPLACE 覆盖部分数据
  ↓ 日线数据重新计算（正确的收盘价和成交量）
```

**更新逻辑**：
- 如果最新数据是今天 → 重新获取 1 天（确保完整性）
- 如果最新数据是昨天或更早 → 获取 (天数差 + 1) 天
- 使用 `INSERT OR REPLACE` 确保数据可以被覆盖更新

#### 数据去重
- 分钟数据：`UNIQUE(symbol, timestamp)` 约束防止重复
- 日线数据：`UNIQUE(symbol, date)` 约束，使用 `INSERT OR REPLACE` 允许更新

### Web API 端点
- `GET /api/search?q=<query>`: 搜索股票（支持中文/拼音）
- `GET /api/stocks`: 列出监控的股票
- `POST /api/stocks`: 添加股票到监控列表
- `DELETE /api/stocks/:symbol`: 从监控列表移除
- `GET /api/stocks/:symbol/summary`: 获取股票汇总（含日线数据）
- `GET /api/stocks/:symbol/data?days=30`: 获取分钟级数据
- `POST /api/stocks/:symbol/sync`: 从 Yahoo Finance 同步最新数据

### 前端显示逻辑 (static/js/app.js)

#### 颜色规则
- **开盘价 (Open)**:
  - 高于前一天收盘 → 红色
  - 低于前一天收盘 → 绿色
  - 字重：600（加粗）

- **最高价 (High)** 和 **最低价 (Low)**:
  - 无颜色（默认文本颜色）
  - 字重：400（正常）

- **收盘价 (Close)**:
  - 高于当天开盘 → 红色
  - 低于当天开盘 → 绿色
  - 字重：600（加粗）

#### 横向表格视图
- 股票列在左侧（固定列）
- 日期按时间倒序排列（最新的在左边）
- 每个单元格显示 OHLCV 数据
- 支持水平滚动查看历史数据

### 依赖项
- `github.com/gin-gonic/gin`: Web 框架
- `github.com/go-resty/resty/v2`: Yahoo Finance 的 HTTP 客户端
- `modernc.org/sqlite`: 纯 Go 实现的 SQLite 驱动（无需 CGO）
- `github.com/robfig/cron/v3`: Cron 定时任务调度器

### 构建说明
- 使用纯 Go 实现的 SQLite 驱动 (`modernc.org/sqlite`)，无需 CGO
- 可以使用 `CGO_ENABLED=0` 进行静态编译
- SQLite 数据库不存在时自动创建
- 所有价格四舍五入到 2 位小数以避免浮点精度问题
- Docker 镜像构建无需安装 gcc 等 C 编译工具

## 开发注意事项

### 时区处理
- 所有存储的时间戳保留原始时区
- 日线分组时转换为美东时间
- 确保交易日正确对应美股市场时间

### 数据完整性
- 始终重新获取最后一天的数据，防止盘中更新导致数据不完整
- 使用 `INSERT OR REPLACE` 允许数据更新
- 日线数据在每次获取分钟数据后自动重新计算

### 性能优化
- 数据库索引：(symbol, timestamp) 和 (symbol, date)
- 批量插入使用事务
- Yahoo API 调用间延迟 1 秒避免速率限制

### 错误处理
- 网络错误不会中断整个批处理
- 数据验证过滤异常值
- 数据库操作使用事务确保一致性

## 未来扩展建议

- ~~添加定时任务（cron）在每日收盘后自动同步~~ ✅ 已实现（每天中国时间 8:00 AM）
- 实现 WebSocket 实时数据推送
- 添加技术指标计算（MA、RSI、MACD等）
- 支持更多数据源（Alpha Vantage、IEX Cloud）
- 添加价格预警功能
- 实现数据可视化图表（K线图、折线图）

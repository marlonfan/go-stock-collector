# Stock Data Tracker

一个功能完善的股票数据采集和跟踪应用，支持从 Yahoo Finance 获取分钟级股票数据，并提供 Web 界面和 CLI 两种使用方式。

## 主要特性

- 📊 **分钟级数据采集**: 从 Yahoo Finance 获取高精度分钟K线数据
- 🌐 **Web 界面**: 现代化的 Web 界面，支持多股票监控
- 💾 **本地存储**: SQLite 数据库，支持数据去重和增量更新
- 🔄 **智能同步**: 自动检测数据缺口，只获取必要的新数据
- ⏰ **定时更新**: 每天中国时间早上 8:00 自动同步所有监控股票
- 🔍 **股票搜索**: 支持中文/拼音模糊搜索股票代码
- 📈 **日线汇总**: 自动从分钟数据计算日线 OHLCV

## 快速开始

### 安装依赖

```bash
go mod tidy
```

### Web 模式（推荐）

```bash
# 启动 Web 服务器（默认端口 8080，启用定时更新）
CGO_ENABLED=1 go run .

# 自定义端口
CGO_ENABLED=1 go run . -mode=web -port=3000

# 禁用定时更新（仅手动同步）
CGO_ENABLED=1 go run . -mode=web -scheduler=false
```

访问 http://localhost:8080 使用 Web 界面。

### CLI 模式

```bash
# 收集股票数据
CGO_ENABLED=1 go run . -mode=cli -symbol=TSLA -days=30 -action=collect

# 分析现有数据
CGO_ENABLED=1 go run . -mode=cli -symbol=TSLA -action=analyze

# 显示样本数据
CGO_ENABLED=1 go run . -mode=cli -symbol=TSLA -action=sample
```

### 构建可执行文件

```bash
CGO_ENABLED=1 go build -o stock-data-collector
./stock-data-collector -mode=web
```

## Docker 部署

### 一键启动（推荐）

使用 Docker Compose 一键启动 Web 服务器：

```bash
# 复制环境变量配置模板
cp .env.example .env

# 编辑配置文件（可选）
nano .env

# 构建并启动容器
docker-compose up -d

# 查看日志
docker-compose logs -f stock-data-collector

# 停止服务
docker-compose down
```

服务将在 http://localhost:8080 启动，并自动配置所需的时区。

**重要**：数据库文件将存储在 `./data/stock_data.db`，该文件会挂载到容器内并持久化保存。

### 手动 Docker 部署

```bash
# 构建镜像
docker build -t stock-data-collector .

# 运行容器
docker run -d \
  --name stock-data-collector \
  -p 8080:8080 \
  -v $(pwd)/data:/app/data \
  -e TZ=Asia/Shanghai \
  stock-data-collector

# 查看日志
docker logs -f stock-data-collector
```

### Docker CLI 模式

```bash
# 使用 CLI 模式收集数据
docker run --rm \
  -v $(pwd)/data:/app/data \
  -e TZ=Asia/Shanghai \
  stock-data-collector \
  -mode=cli -symbol=TSLA -days=30 -action=collect

# 进入 CLI 容器进行交互式操作
docker-compose run --rm stock-cli
# 然后在容器内执行：
# ./stock-data-collector -mode=cli -symbol=AAPL -action=collect
```

### Docker 特性

- ✅ **多阶段构建**: 优化镜像大小
- ✅ **时区支持**: 预装 Asia/Shanghai 和 America/New_York 时区
- ✅ **健康检查**: 自动监控服务状态
- ✅ **数据持久化**: 数据库文件映射到本地目录
- ✅ **非 root 用户**: 提高安全性
- ✅ **自动重启**: 容器异常退出时自动重启
- ✅ **多架构支持**: 支持 linux/amd64 和 linux/arm64 架构

## GitHub Container Registry (GHCR)

项目镜像自动构建并推送到 GitHub Container Registry：

### 镜像标签

- `ghcr.io/your-username/stock-data-collector:latest` - 最新版本
- `ghcr.io/your-username/stock-data-collector:main` - main 分支构建
- `ghcr.io/your-username/stock-data-collector:v1.0.0` - 发布版本

### 使用 GHCR 镜像

```bash
# 使用最新版本
docker run -d \
  --name stock-data-collector \
  -p 8080:8080 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/logs:/app/logs \
  ghcr.io/your-username/stock-data-collector:latest \
  -db=/app/data/stock_data.db

# 使用特定版本
docker run -d \
  --name stock-data-collector \
  -p 8080:8080 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/logs:/app/logs \
  ghcr.io/your-username/stock-data-collector:v1.0.0 \
  -db=/app/data/stock_data.db
```

### 使用 GHCR 的 Docker Compose

```yaml
version: '3.8'

services:
  stock-data-collector:
    image: ghcr.io/your-username/stock-data-collector:latest
    container_name: stock-data-collector
    ports:
      - "8080:8080"
    environment:
      - TZ=Asia/Shanghai
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
    restart: unless-stopped
    command: ["./stock-data-collector", "-mode=web", "-port=8080", "-scheduler=true", "-db=/app/data/stock_data.db"]
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:8080/api/stocks"]
      interval: 30s
      timeout: 10s
      retries: 3
```

## GitHub Actions 自动化

项目配置了完整的 GitHub Actions 工作流：

### 工作流文件

- **`.github/workflows/docker.yml`** - 自动构建和推送 Docker 镜像
- **`.github/workflows/release.yml`** - 发布版本和构建二进制文件
- **`.github/workflows/scan.yml`** - 安全扫描和依赖检查

### 自动触发条件

1. **代码推送** (main/develop 分支)
   - 运行测试
   - 构建 Docker 镜像
   - 推送到 GHCR

2. **创建标签** (`v*.*.*`)
   - 创建 GitHub Release
   - 构建多架构镜像
   - 构建跨平台二进制文件
   - 上传发布资产

3. **每日安全扫描**
   - Gosec 代码安全扫描
   - Trivy 容器镜像扫描
   - 依赖漏洞检查

### 手动触发

```bash
# 手动触发 Docker 构建推送
gh workflow run docker.yml

# 手动触发发布流程
gh workflow run release.yml -f version=v1.2.0
```

### CI 测试验证

GitHub Actions 包含完整的 Docker 配置测试：

1. **Docker 镜像测试**
   - 启动容器并挂载数据库目录
   - 验证数据库文件在挂载目录中创建
   - 测试 CLI 功能和数据持久化

2. **Docker Compose 测试**
   - 使用 docker-compose 启动服务
   - 验证数据库挂载和 API 访问
   - 确认配置文件正确性

3. **测试覆盖范围**
   - ✅ 数据库文件挂载路径验证
   - ✅ 容器启动和健康检查
   - ✅ Web API 访问测试
   - ✅ CLI 命令功能测试
   - ✅ 数据持久化验证

**测试命令示例**（在 CI 环境中自动执行）：
```bash
# 测试 Docker 直接运行
docker run -d -v /tmp/test-data:/app/data \
  image-name -db=/app/data/test.db

# 测试 docker-compose
docker-compose up -d
curl -f http://localhost:8080/api/stocks
```

### 数据库挂载验证

当前配置确保数据库文件正确挂载和持久化：

**配置路径对应关系**：
```
主机路径: ./data/stock_data.db
容器路径: /app/data/stock_data.db
挂载映射: ./data:/app/data
```

**验证步骤**：
1. 启动服务：`docker-compose up -d`
2. 检查文件：`ls -la ./data/stock_data.db`
3. 测试 API：`curl http://localhost:8080/api/stocks`
4. 停止服务：`docker-compose down`
5. 确认数据：`ls -la ./data/` - 数据库文件应保留

**GitHub Actions 自动验证**：
- 每次推送代码时自动测试上述流程
- 验证多架构镜像构建（amd64/arm64）
- 确保数据库挂载配置正确性

### 发布新版本

```bash
# 创建版本标签并推送
git tag v1.0.0
git push origin v1.0.0

# GitHub Actions 将自动：
# 1. 创建 Release
# 2. 构建多平台二进制文件
# 3. 构建 Docker 镜像
# 4. 上传所有资产到 Release
```

## 命令行参数

### Web 模式参数
- `-mode`: 运行模式 (`web` 或 `cli`，默认: `web`)
- `-port`: Web 服务器端口 (默认: `8080`)
- `-db`: 数据库文件路径 (默认: `stock_data.db`)
- `-scheduler`: 启用定时更新 (默认: `true`)

### CLI 模式参数
- `-mode`: 必须设置为 `cli`
- `-symbol`: 股票代码 (默认: `TSLA`)
- `-days`: 获取天数 (默认: `30`)
- `-db`: 数据库文件路径 (默认: `stock_data.db`)
- `-action`: 操作类型
  - `collect`: 收集数据
  - `analyze`: 分析数据
  - `sample`: 显示样本数据

## 定时更新功能

Web 模式默认启用定时更新，每天**中国时间早上 8:00** 自动同步所有监控列表中的股票数据。

**特性**：
- ⏰ 使用中国时区（Asia/Shanghai, UTC+8）
- 📅 每天 8:00 AM 自动执行
- 🔄 智能增量更新（只获取缺失的数据）
- 📊 自动更新日线汇总
- 🛡️ 优雅关闭（服务器停止时自动停止调度器）

**控制选项**：
```bash
# 启用定时更新（默认）
CGO_ENABLED=1 go run . -mode=web -scheduler=true

# 禁用定时更新
CGO_ENABLED=1 go run . -mode=web -scheduler=false
```

## Web API 端点

- `GET /api/search?q=<query>`: 搜索股票（支持中文/拼音）
- `GET /api/stocks`: 获取监控列表
- `POST /api/stocks`: 添加股票到监控列表
- `DELETE /api/stocks/:symbol`: 从监控列表移除
- `GET /api/stocks/:symbol/summary`: 获取股票汇总数据
- `GET /api/stocks/:symbol/data?days=30`: 获取分钟级数据
- `POST /api/stocks/:symbol/sync`: 手动同步股票数据

## 数据库结构

### 分钟级数据表
```sql
CREATE TABLE stock_minute_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    timestamp DATETIME NOT NULL,
    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,
    volume INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(symbol, timestamp)
);
```

### 监控股票表
```sql
CREATE TABLE watched_stocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT UNIQUE NOT NULL,
    name TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_sync DATETIME,
    is_active BOOLEAN DEFAULT TRUE
);
```

### 日线汇总表
```sql
CREATE TABLE stock_daily_summary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    date DATE NOT NULL,
    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,
    volume INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(symbol, date)
);
```

## 使用示例

### Web 模式示例

1. **启动服务器**
```bash
CGO_ENABLED=1 go run .
```

2. **使用 Web 界面**
   - 访问 http://localhost:8080
   - 搜索并添加股票到监控列表
   - 点击 "Sync Data" 手动同步数据
   - 查看日线汇总数据
   - 定时任务每天 8:00 AM 自动更新

### CLI 模式示例

1. **首次获取特斯拉 30 天数据**
```bash
CGO_ENABLED=1 go run . -mode=cli -symbol=TSLA -days=30 -action=collect
```

2. **获取苹果股票数据**
```bash
CGO_ENABLED=1 go run . -mode=cli -symbol=AAPL -days=30 -action=collect
```

3. **分析已有数据**
```bash
CGO_ENABLED=1 go run . -mode=cli -symbol=TSLA -action=analyze
```

4. **自定义数据库路径**
```bash
CGO_ENABLED=1 go run . -mode=cli -symbol=TSLA -db=/path/to/custom.db -action=collect
```

## 技术栈

- **语言**: Go 1.21+
- **Web 框架**: [Gin](https://github.com/gin-gonic/gin)
- **数据库**: SQLite3 ([go-sqlite3](https://github.com/mattn/go-sqlite3))
- **HTTP 客户端**: [Resty](https://github.com/go-resty/resty)
- **定时任务**: [Cron](https://github.com/robfig/cron)
- **数据源**: Yahoo Finance API

## 注意事项

1. **CGO 要求**: 由于使用 SQLite，所有命令都需要 `CGO_ENABLED=1`
2. **数据源限制**: Yahoo Finance API 免费但有速率限制，请合理使用
3. **数据去重**: 系统自动去重，重复运行只会获取新数据
4. **定时更新**: Web 模式默认启用，每天 8:00 AM 中国时间自动同步
5. **时区处理**: 所有日线数据按美东时间（America/New_York）分组

## 架构说明

详细的架构设计和实现细节请参考 [CLAUDE.md](CLAUDE.md)。

## 扩展功能建议

- ✅ ~~定时任务自动同步~~ (已实现)
- 🔲 WebSocket 实时数据推送
- 🔲 技术指标计算（MA、RSI、MACD等）
- 🔲 价格预警功能
- 🔲 K线图可视化
- 🔲 支持更多数据源（Alpha Vantage、IEX Cloud）

## License

MIT
# Tesla Stock Data Collector

一个用于获取特斯拉(TSLA)过去30天分钟级股票数据并保存到本地SQLite数据库的Go程序。

## 功能特性

- 获取Yahoo Finance的免费股票数据
- 支持分钟级别的历史数据
- 数据存储到本地SQLite数据库
- 增量更新，避免重复获取
- 基本的数据分析功能

## 安装和运行

### 1. 安装依赖

```bash
go mod tidy
```

### 2. 运行程序

**获取数据 (推荐首次运行):**
```bash
go run . -symbol=TSLA -days=30 -action=collect
```

**分析已有数据:**
```bash
go run . -symbol=TSLA -days=30 -action=analyze
```

**查看样本数据:**
```bash
go run . -symbol=TSLA -action=sample
```

### 3. 参数说明

- `-symbol`: 股票代码 (默认: TSLA)
- `-days`: 获取天数 (默认: 30)
- `-db`: 数据库文件路径 (默认: stock_data.db)
- `-action`: 操作类型
  - `collect`: 收集数据
  - `analyze`: 分析数据
  - `sample`: 显示样本数据

## 数据库结构

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

## 使用示例

### 1. 首次获取特斯拉30天数据
```bash
go run . -symbol=TSLA -days=30 -action=collect
```

### 2. 获取苹果股票数据
```bash
go run . -symbol=AAPL -days=30 -action=collect
```

### 3. 分析已有数据
```bash
go run . -symbol=TSLA -action=analyze
```

### 4. 自定义数据库路径
```bash
go run . -symbol=TSLA -db=/path/to/custom.db -action=collect
```

## 注意事项

1. Yahoo Finance API是免费的，但请合理使用，避免过于频繁的请求
2. 数据会自动去重，重复运行只会获取新数据
3. 建议每天运行一次以保持数据最新
4. 程序会自动处理网络错误和数据解析问题

## 扩展功能

你可以基于此程序扩展以下功能：
- 添加更多股票的技术指标计算
- 实现数据可视化图表
- 添加价格警报功能
- 集成其他数据源
- 实现自动交易策略
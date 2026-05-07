// Mock watchlist data — represents what /api/stocks/:symbol/summary already returns,
// plus a sparkline series from /data?days=30. All data is illustrative.

const MOCK_STOCKS = [
  { symbol: 'AAPL', name: 'Apple Inc.', cn: '苹果',
    currentPrice: 232.41, change: 2.87, changePercent: 1.25,
    open: 230.10, high: 233.05, low: 229.40, close: 232.41,
    prevClose: 229.54, volume: 48_320_000, avgVolume30d: 52_000_000,
    week52High: 260.10, week52Low: 164.08, marketCap: '3.52T',
    pe: 35.2, lastUpdate: Date.now() - 1000 * 60 * 4, pinned: true },
  { symbol: 'TSLA', name: 'Tesla, Inc.', cn: '特斯拉',
    currentPrice: 348.92, change: -7.21, changePercent: -2.03,
    open: 357.50, high: 361.20, low: 346.10, close: 348.92,
    prevClose: 356.13, volume: 89_240_000, avgVolume30d: 95_000_000,
    week52High: 488.54, week52Low: 138.80, marketCap: '1.11T',
    pe: 84.6, lastUpdate: Date.now() - 1000 * 60 * 12, pinned: true },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', cn: '英伟达',
    currentPrice: 142.83, change: 4.12, changePercent: 2.97,
    open: 138.50, high: 143.10, low: 138.20, close: 142.83,
    prevClose: 138.71, volume: 217_530_000, avgVolume30d: 198_000_000,
    week52High: 153.13, week52Low: 60.69, marketCap: '3.51T',
    pe: 71.2, lastUpdate: Date.now() - 1000 * 60 * 2, pinned: false },
  { symbol: 'MSFT', name: 'Microsoft Corporation', cn: '微软',
    currentPrice: 415.20, change: 1.04, changePercent: 0.25,
    open: 414.30, high: 416.85, low: 413.10, close: 415.20,
    prevClose: 414.16, volume: 19_840_000, avgVolume30d: 22_000_000,
    week52High: 468.35, week52Low: 309.45, marketCap: '3.09T',
    pe: 35.8, lastUpdate: Date.now() - 1000 * 60 * 6, pinned: false },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', cn: '谷歌',
    currentPrice: 178.34, change: -0.62, changePercent: -0.35,
    open: 179.20, high: 180.10, low: 177.80, close: 178.34,
    prevClose: 178.96, volume: 28_120_000, avgVolume30d: 31_000_000,
    week52High: 207.05, week52Low: 130.67, marketCap: '2.18T',
    pe: 24.1, lastUpdate: Date.now() - 1000 * 60 * 8, pinned: false },
  { symbol: 'AMZN', name: 'Amazon.com, Inc.', cn: '亚马逊',
    currentPrice: 213.50, change: 3.21, changePercent: 1.53,
    open: 210.40, high: 214.20, low: 209.85, close: 213.50,
    prevClose: 210.29, volume: 41_270_000, avgVolume30d: 44_000_000,
    week52High: 233.00, week52Low: 144.05, marketCap: '2.24T',
    pe: 47.5, lastUpdate: Date.now() - 1000 * 60 * 3, pinned: false },
  { symbol: 'META', name: 'Meta Platforms, Inc.', cn: 'Meta',
    currentPrice: 612.35, change: 8.42, changePercent: 1.39,
    open: 604.10, high: 614.20, low: 602.80, close: 612.35,
    prevClose: 603.93, volume: 14_850_000, avgVolume30d: 13_500_000,
    week52High: 638.40, week52Low: 414.50, marketCap: '1.55T',
    pe: 28.4, lastUpdate: Date.now() - 1000 * 60 * 5, pinned: false },
  { symbol: '0700.HK', name: 'Tencent Holdings', cn: '腾讯控股',
    currentPrice: 432.20, change: -5.80, changePercent: -1.32,
    open: 438.40, high: 440.20, low: 430.00, close: 432.20,
    prevClose: 438.00, volume: 18_240_000, avgVolume30d: 22_000_000,
    week52High: 470.40, week52Low: 287.20, marketCap: 'HK$4.05T',
    pe: 22.8, lastUpdate: Date.now() - 1000 * 60 * 14, pinned: false },
];

// Generate a deterministic 30-day sparkline series for each stock.
function makeSeries(stock, days = 30) {
  const out = [];
  let price = stock.prevClose;
  // Use symbol charcodes as a pseudorandom seed for repeatability.
  let seed = 0;
  for (const ch of stock.symbol) seed = (seed * 31 + ch.charCodeAt(0)) % 9973;
  const rng = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const targetEnd = stock.currentPrice;
  for (let i = 0; i < days; i++) {
    // Drift toward target, with daily volatility scaled to price.
    const drift = (targetEnd - price) * (i / (days - 1)) * 0.18;
    const vol = price * 0.018 * (rng() - 0.5);
    price = price + drift + vol;
    const open = price;
    const close = price + price * 0.012 * (rng() - 0.5);
    const high = Math.max(open, close) + price * 0.008 * rng();
    const low = Math.min(open, close) - price * 0.008 * rng();
    const date = new Date();
    date.setDate(date.getDate() - (days - 1 - i));
    out.push({
      date: date.toISOString().slice(0, 10),
      open, high, low, close,
      volume: Math.round(stock.avgVolume30d * (0.6 + rng() * 0.8)),
    });
    price = close;
  }
  // Force the last bar to match today's reported OHLCV exactly.
  out[out.length - 1] = {
    ...out[out.length - 1],
    open: stock.open, high: stock.high, low: stock.low, close: stock.close,
    volume: stock.volume,
  };
  return out;
}

const STOCKS_WITH_SERIES = MOCK_STOCKS.map(s => ({ ...s, series: makeSeries(s, 30) }));

// Helpers
function fmtPrice(p, digits = 2) {
  if (p == null) return '—';
  return p.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function fmtVol(v) {
  if (v == null) return '—';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return String(v);
}
function fmtRel(ts) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}
function rangePct(low, current, high) {
  if (high <= low) return 0;
  return Math.max(0, Math.min(1, (current - low) / (high - low)));
}

window.STOCKS = STOCKS_WITH_SERIES;
window.fmtPrice = fmtPrice;
window.fmtVol = fmtVol;
window.fmtRel = fmtRel;
window.rangePct = rangePct;

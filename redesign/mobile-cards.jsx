// Mobile cards variant — denser than the original. Compresses the same data
// into a card with: symbol+price line, %change pill, day range bar with low/high,
// inline OHLCV strip, and a small sparkline. One card occupies ~1/3 of phone screen.

function MobileCardsVariant({ stocks, dark = false }) {
  return (
    <div style={{ padding: '8px 12px', background: dark ? '#0f172a' : '#fafafa' }}>
      <window.MobileSectionHeader title="📌 PINNED" sub="2 stocks" dark={dark} />
      {stocks.filter(s => s.pinned).map(s => <MobileCard key={s.symbol} stock={s} dark={dark} />)}
      <window.MobileSectionHeader title="WATCHLIST" sub="6 stocks" dark={dark} />
      {stocks.filter(s => !s.pinned).slice(0, 4).map(s => <MobileCard key={s.symbol} stock={s} dark={dark} />)}
    </div>
  );
}

function MobileCard({ stock: s, dark }) {
  const isUp = s.change >= 0;
  const accent = isUp ? '#10b981' : '#ef4444';
  const bg = dark ? '#1e293b' : '#fff';
  const text = dark ? '#f1f5f9' : '#0f172a';
  const sub = dark ? '#94a3b8' : '#6b7280';
  const border = dark ? '#334155' : '#e5e7eb';

  return (
    <div style={{
      background: bg, borderRadius: 12,
      border: '1px solid ' + (s.pinned ? '#f59e0b66' : border),
      padding: '12px 14px', marginBottom: 8,
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
        background: accent,
      }} />
      {/* Top: symbol + price */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span className="mono" style={{ fontSize: 15, fontWeight: 700, color: text }}>{s.symbol}</span>
            {s.pinned && <span style={{ color: '#f59e0b', fontSize: 10 }}>★</span>}
          </div>
          <div style={{ fontSize: 11, color: sub, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>
            {s.cn}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: text, lineHeight: 1.1 }}>
            {window.fmtPrice(s.currentPrice)}
          </div>
          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', marginTop: 3 }}>
            <window.TrendPill value={s.changePercent} size="sm" />
          </div>
        </div>
      </div>

      {/* Mid: sparkline + day range */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <div style={{ flex: 1 }}>
          <window.DayRangeBar low={s.low} high={s.high} current={s.currentPrice} prevClose={s.prevClose} label />
        </div>
        <window.Sparkline series={s.series.slice(-15)} width={64} height={26} isUp={isUp} fill={false} />
      </div>

      {/* Bottom: OHLCV inline */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 10,
        fontSize: 10,
      }}>
        {[
          { l: 'O', v: window.fmtPrice(s.open), c: text },
          { l: 'C', v: window.fmtPrice(s.close), c: s.close >= s.open ? '#10b981' : '#ef4444' },
          { l: 'V', v: window.fmtVol(s.volume), c: text },
          { l: 'AMP', v: ((s.high - s.low) / s.prevClose * 100).toFixed(2) + '%', c: text },
        ].map((kv, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 9, color: sub, fontWeight: 600 }}>{kv.l}</span>
            <span className="mono" style={{ fontSize: 11, fontWeight: 500, color: kv.c }}>{kv.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

window.MobileCardsVariant = MobileCardsVariant;

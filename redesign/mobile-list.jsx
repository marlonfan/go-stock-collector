// Mobile list variant — compact watchlist row, more stocks visible.
// One row shows: symbol/name, price, %change pill, sparkline, optional day range.

function MobileListVariant({ stocks, dark = false }) {
  const text = dark ? '#f1f5f9' : '#0f172a';
  const sub = dark ? '#94a3b8' : '#6b7280';
  const border = dark ? '#1e293b' : '#f3f4f6';

  return (
    <div style={{ background: dark ? '#0f172a' : '#fff' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
        background: dark ? '#1e293b' : '#f9fafb',
        borderBottom: '1px solid ' + border,
        fontSize: 11, color: sub,
      }}>
        <button style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: '#3b82f6', color: '#fff', fontSize: 11, fontWeight: 600 }}>全部 8</button>
        <button style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid ' + border, background: 'transparent', color: sub, fontSize: 11 }}>📌 2</button>
        <button style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid ' + border, background: 'transparent', color: sub, fontSize: 11 }}>↑ 5</button>
        <button style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid ' + border, background: 'transparent', color: sub, fontSize: 11 }}>↓ 3</button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: sub }}>↑↓ %</span>
      </div>

      {stocks.map((s, idx) => {
        const isUp = s.change >= 0;
        const accent = isUp ? '#10b981' : '#ef4444';
        return (
          <div key={s.symbol} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 14px',
            borderBottom: '1px solid ' + border,
            background: s.pinned ? (dark ? 'rgba(245,158,11,0.06)' : '#fffbeb') : 'transparent',
            boxShadow: s.pinned ? 'inset 3px 0 0 #f59e0b' : 'none',
          }}>
            {/* Symbol + name */}
            <div style={{ width: 84, minWidth: 84 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: text }}>{s.symbol}</span>
              </div>
              <div style={{ fontSize: 10, color: sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.cn}
              </div>
              <div className="mono" style={{ fontSize: 9, color: sub, marginTop: 1 }}>
                V {window.fmtVol(s.volume)}
              </div>
            </div>

            {/* Sparkline middle */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <window.Sparkline series={s.series.slice(-15)} width={70} height={22} isUp={isUp} fill={false} />
              <window.DayRangeBar low={s.low} high={s.high} current={s.currentPrice} prevClose={s.prevClose} />
            </div>

            {/* Price + change */}
            <div style={{ textAlign: 'right', minWidth: 78 }}>
              <div className="mono" style={{ fontSize: 14, fontWeight: 600, color: text, lineHeight: 1.1 }}>
                {window.fmtPrice(s.currentPrice)}
              </div>
              <div style={{
                display: 'inline-flex', marginTop: 3,
                padding: '2px 6px', borderRadius: 4,
                background: isUp ? 'var(--color-up-bg-strong)' : 'var(--color-down-bg-strong)',
                color: isUp ? '#047857' : '#b91c1c',
                fontSize: 11, fontWeight: 600,
              }} className="mono">
                {isUp ? '+' : ''}{s.changePercent.toFixed(2)}%
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

window.MobileListVariant = MobileListVariant;

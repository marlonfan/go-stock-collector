// Desktop card view — info-dense card with mini OHLC strip, day range, sparkline,
// and inline action affordances on hover.

function DesktopCardsVariant({ stocks, dark = false }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))',
      gap: 14, padding: 16,
      background: dark ? '#0f172a' : '#fafafa',
    }}>
      {stocks.slice(0, 6).map(s => <DesktopCard key={s.symbol} stock={s} dark={dark} />)}
    </div>
  );
}

function DesktopCard({ stock: s, dark }) {
  const isUp = s.change >= 0;
  const bg = dark ? '#1e293b' : '#fff';
  const text = dark ? '#f1f5f9' : '#0f172a';
  const sub = dark ? '#94a3b8' : '#6b7280';
  const border = dark ? '#334155' : '#e5e7eb';
  const accent = isUp ? '#10b981' : '#ef4444';

  return (
    <div style={{
      position: 'relative', background: bg, borderRadius: 14,
      border: '1px solid ' + (s.pinned ? '#f59e0b' : border),
      padding: '14px 16px',
      boxShadow: dark ? 'none' : '0 1px 2px rgba(0,0,0,0.04)',
      overflow: 'hidden',
    }}>
      {/* Trend stripe */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
        background: accent, opacity: 0.85,
      }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: text }}>{s.symbol}</span>
            {s.pinned && <span style={{ color: '#f59e0b', fontSize: 11 }}>★</span>}
          </div>
          <div style={{
            fontSize: 11, color: sub, marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200,
          }}>{s.cn} · {s.name}</div>
        </div>
        <div style={{ display: 'flex', gap: 2 }}>
          {['↻', '✕'].map((c, i) => (
            <button key={i} style={{
              width: 24, height: 24, borderRadius: 6, border: 'none',
              background: 'transparent', cursor: 'pointer',
              color: sub, fontSize: 12,
            }}>{c}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 10 }}>
        <span className="mono" style={{ fontSize: 26, fontWeight: 600, color: text, letterSpacing: '-0.02em' }}>
          {window.fmtPrice(s.currentPrice)}
        </span>
        <window.TrendPill value={s.changePercent} size="md" />
        <span className="mono" style={{ fontSize: 12, color: accent, fontWeight: 500 }}>
          {isUp ? '+' : ''}{s.change.toFixed(2)}
        </span>
      </div>

      {/* OHLC mini strip */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 10,
        padding: '8px 10px', background: dark ? '#0f172a' : '#f9fafb', borderRadius: 8,
      }}>
        {[
          { l: 'O', v: s.open, c: '' },
          { l: 'H', v: s.high, c: '#10b981' },
          { l: 'L', v: s.low, c: '#ef4444' },
          { l: 'V', v: window.fmtVol(s.volume), c: '', mono: true },
        ].map((kv, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 9, color: sub, fontWeight: 600, letterSpacing: '0.05em' }}>{kv.l}</span>
            <span className="mono" style={{ fontSize: 11, fontWeight: 500, color: kv.c || text }}>
              {typeof kv.v === 'number' ? window.fmtPrice(kv.v) : kv.v}
            </span>
          </div>
        ))}
      </div>

      {/* Sparkline */}
      <div style={{ marginTop: 12, height: 48, display: 'flex', alignItems: 'center' }}>
        <window.Sparkline series={s.series} width={278} height={48} isUp={isUp} />
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: '1px solid ' + border }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1 }}>
          <span style={{ fontSize: 10, color: sub }}>52W Range</span>
          <window.YearRangeBar low={s.week52Low} high={s.week52High} current={s.currentPrice} />
        </div>
        <div style={{ marginLeft: 12, fontSize: 10, color: sub, textAlign: 'right' }}>
          <div>市值 <span className="mono" style={{ color: text, fontWeight: 500 }}>{s.marketCap}</span></div>
          <div style={{ marginTop: 2 }}>P/E <span className="mono" style={{ color: text, fontWeight: 500 }}>{s.pe}</span></div>
        </div>
      </div>
    </div>
  );
}

window.DesktopCardsVariant = DesktopCardsVariant;

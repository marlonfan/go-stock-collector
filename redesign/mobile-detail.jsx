// Mobile detail / drilldown screen — when user taps a card.
// Shows: hero price, mini chart, OHLCV, day range, 52W range, vs avg vol, fundamentals.

function MobileDetailVariant({ stock: s, dark = false }) {
  const isUp = s.change >= 0;
  const accent = isUp ? '#10b981' : '#ef4444';
  const bg = dark ? '#0f172a' : '#fafafa';
  const card = dark ? '#1e293b' : '#fff';
  const text = dark ? '#f1f5f9' : '#0f172a';
  const sub = dark ? '#94a3b8' : '#6b7280';
  const border = dark ? '#334155' : '#e5e7eb';

  return (
    <div style={{ background: bg, minHeight: '100%' }}>
      {/* Top nav bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
        background: card, borderBottom: '1px solid ' + border,
      }}>
        <button style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', color: text, fontSize: 18 }}>‹</button>
        <div style={{ flex: 1 }}>
          <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: text }}>{s.symbol}</div>
          <div style={{ fontSize: 10, color: sub }}>{s.cn} · {s.name}</div>
        </div>
        <button style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', color: '#f59e0b', fontSize: 14 }}>★</button>
        <button style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', color: sub, fontSize: 14 }}>↻</button>
      </div>

      {/* Hero price */}
      <div style={{ padding: '16px 16px 12px' }}>
        <div className="mono" style={{ fontSize: 32, fontWeight: 700, color: text, letterSpacing: '-0.02em', lineHeight: 1 }}>
          {window.fmtPrice(s.currentPrice)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <span className="mono" style={{ fontSize: 14, color: accent, fontWeight: 600 }}>
            {isUp ? '+' : ''}{s.change.toFixed(2)} ({isUp ? '+' : ''}{s.changePercent.toFixed(2)}%)
          </span>
          <span style={{ fontSize: 11, color: sub }}>· 4 分钟前</span>
        </div>
      </div>

      {/* Period tabs */}
      <div style={{ padding: '0 12px 8px', display: 'flex', gap: 4, overflowX: 'auto' }}>
        {['1D', '5D', '1M', '3M', '6M', '1Y'].map((p, i) => (
          <button key={p} style={{
            padding: '6px 12px', borderRadius: 8, border: 'none',
            background: i === 2 ? '#3b82f6' : (dark ? '#1e293b' : '#fff'),
            color: i === 2 ? '#fff' : text,
            fontSize: 11, fontWeight: 600,
            border: '1px solid ' + (i === 2 ? '#3b82f6' : border),
          }}>{p}</button>
        ))}
      </div>

      {/* Chart card */}
      <div style={{ margin: '0 12px', background: card, borderRadius: 12, border: '1px solid ' + border, padding: '14px 12px 8px' }}>
        <ChartMini series={s.series} isUp={isUp} dark={dark} />
      </div>

      {/* OHLC card */}
      <div style={{ margin: '12px 12px 0', background: card, borderRadius: 12, border: '1px solid ' + border, padding: '12px 14px' }}>
        <div style={{ fontSize: 10, color: sub, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>今日 OHLCV</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {[
            { l: '开盘', v: window.fmtPrice(s.open) },
            { l: '收盘', v: window.fmtPrice(s.close), c: s.close >= s.open ? '#10b981' : '#ef4444' },
            { l: '最高', v: window.fmtPrice(s.high), c: '#10b981' },
            { l: '最低', v: window.fmtPrice(s.low), c: '#ef4444' },
            { l: '成交量', v: window.fmtVol(s.volume) },
            { l: '振幅', v: ((s.high - s.low) / s.prevClose * 100).toFixed(2) + '%' },
          ].map((kv, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 12, color: sub }}>{kv.l}</span>
              <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: kv.c || text }}>{kv.v}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid ' + border }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: sub, marginBottom: 4 }}>
            <span>今日区间</span>
            <span className="mono">{window.fmtPrice(s.low)} – {window.fmtPrice(s.high)}</span>
          </div>
          <window.DayRangeBar low={s.low} high={s.high} current={s.currentPrice} prevClose={s.prevClose} />
        </div>
      </div>

      {/* 52W + fundamentals */}
      <div style={{ margin: '12px 12px 0', background: card, borderRadius: 12, border: '1px solid ' + border, padding: '12px 14px' }}>
        <div style={{ fontSize: 10, color: sub, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>趋势 / 基本面</div>
        <window.YearRangeBar low={s.week52Low} high={s.week52High} current={s.currentPrice} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 12 }}>
          {[
            { l: '市值', v: s.marketCap },
            { l: 'P/E', v: s.pe },
            { l: '量比', v: (s.volume / s.avgVolume30d).toFixed(2) },
          ].map((kv, i) => (
            <div key={i} style={{ background: dark ? '#0f172a' : '#f9fafb', borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ fontSize: 10, color: sub }}>{kv.l}</div>
              <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: text, marginTop: 2 }}>{kv.v}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ height: 16 }} />
    </div>
  );
}

function ChartMini({ series, isUp, dark }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.parentElement.clientWidth - 4;
    const h = 140;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    if (!series || series.length < 2) return;
    let lo = Infinity, hi = -Infinity;
    for (const s of series) { if (s.low < lo) lo = s.low; if (s.high > hi) hi = s.high; }
    const range = hi - lo || 1;
    const stepX = w / series.length;
    const cw = Math.max(2, stepX * 0.6);

    // grid
    ctx.strokeStyle = dark ? '#334155' : '#e5e7eb';
    ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
    for (let i = 0; i < 4; i++) {
      const y = (h / 4) * i + 4;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.setLineDash([]);

    series.forEach((bar, i) => {
      const x = stepX * i + stepX / 2;
      const oY = ((hi - bar.open) / range) * (h - 12) + 4;
      const cY = ((hi - bar.close) / range) * (h - 12) + 4;
      const hY = ((hi - bar.high) / range) * (h - 12) + 4;
      const lY = ((hi - bar.low) / range) * (h - 12) + 4;
      const rising = bar.close >= bar.open;
      ctx.strokeStyle = rising ? '#10b981' : '#ef4444';
      ctx.fillStyle = rising ? '#10b981' : '#ef4444';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, hY); ctx.lineTo(x, lY); ctx.stroke();
      const top = Math.min(oY, cY);
      const ht = Math.max(1.5, Math.abs(cY - oY));
      if (rising) { ctx.lineWidth = 1.5; ctx.strokeRect(x - cw / 2, top, cw, ht); }
      else { ctx.fillRect(x - cw / 2, top, cw, ht); }
    });
  }, [series, isUp, dark]);
  return <canvas ref={ref} />;
}

window.MobileDetailVariant = MobileDetailVariant;

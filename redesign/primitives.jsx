// Shared visual primitives used across all artboards.

// Sparkline canvas — renders to fit container width.
function Sparkline({ series, width = 120, height = 36, isUp, strokeWidth = 1.5, fill = true }) {
  const canvasRef = React.useRef(null);
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !series || series.length < 2) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    const closes = series.map(s => s.close);
    let lo = Infinity, hi = -Infinity;
    for (const c of closes) { if (c < lo) lo = c; if (c > hi) hi = c; }
    const range = hi - lo || 1;
    const padY = 3;
    const stepX = (closes.length > 1) ? width / (closes.length - 1) : 0;
    const color = isUp ? '#10b981' : '#ef4444';

    if (fill) {
      ctx.beginPath();
      ctx.moveTo(0, height - padY);
      closes.forEach((c, i) => {
        const x = i * stepX;
        const y = padY + (1 - (c - lo) / range) * (height - 2 * padY);
        ctx.lineTo(x, y);
      });
      ctx.lineTo((closes.length - 1) * stepX, height - padY);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, height);
      grad.addColorStop(0, color + '33');
      grad.addColorStop(1, color + '00');
      ctx.fillStyle = grad;
      ctx.fill();
    }

    ctx.beginPath();
    closes.forEach((c, i) => {
      const x = i * stepX;
      const y = padY + (1 - (c - lo) / range) * (height - 2 * padY);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = strokeWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // Last point dot
    const lastY = padY + (1 - (closes[closes.length - 1] - lo) / range) * (height - 2 * padY);
    const lastX = (closes.length - 1) * stepX;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(lastX - 1, lastY, 2, 0, Math.PI * 2);
    ctx.fill();
  }, [series, width, height, isUp, strokeWidth, fill]);
  return <canvas ref={canvasRef} />;
}

// Day range bar: shows where current price sits between low and high
function DayRangeBar({ low, current, high, prevClose, width = 100, label = false }) {
  const pct = window.rangePct(low, current, high) * 100;
  const prevPct = (prevClose != null && high > low)
    ? window.rangePct(low, prevClose, high) * 100 : null;
  return (
    <div style={{ width: '100%', minWidth: width }}>
      {label && (
        <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9ca3af', marginBottom: 3 }}>
          <span>L {window.fmtPrice(low)}</span>
          <span>H {window.fmtPrice(high)}</span>
        </div>
      )}
      <div style={{ position: 'relative', height: 4, background: '#e5e7eb', borderRadius: 2 }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, height: '100%',
          width: pct + '%',
          background: 'linear-gradient(90deg, #ef444444 0%, #f59e0b44 50%, #10b98144 100%)',
          borderRadius: 2,
        }} />
        {prevPct != null && (
          <div style={{
            position: 'absolute', left: `calc(${prevPct}% - 1px)`, top: -2, width: 2, height: 8,
            background: '#9ca3af', borderRadius: 1, opacity: 0.5,
          }} title="Prev close" />
        )}
        <div style={{
          position: 'absolute', left: `calc(${pct}% - 4px)`, top: -2, width: 8, height: 8,
          background: '#111827', border: '2px solid #fff', borderRadius: '50%',
          boxShadow: '0 0 0 1px #11182722',
        }} />
      </div>
    </div>
  );
}

// 52w range bar — taller, with markers, and labels
function YearRangeBar({ low, current, high }) {
  const pct = window.rangePct(low, current, high) * 100;
  return (
    <div style={{ width: '100%' }}>
      <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9ca3af', marginBottom: 3 }}>
        <span>{window.fmtPrice(low)}</span>
        <span style={{ color: '#6b7280' }}>52W</span>
        <span>{window.fmtPrice(high)}</span>
      </div>
      <div style={{ position: 'relative', height: 4, background: '#e5e7eb', borderRadius: 2 }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, height: '100%',
          width: pct + '%',
          background: '#3b82f6', opacity: 0.25, borderRadius: 2,
        }} />
        <div style={{
          position: 'absolute', left: `calc(${pct}% - 1px)`, top: -2, width: 2, height: 8,
          background: '#3b82f6', borderRadius: 1,
        }} />
      </div>
    </div>
  );
}

// Trend pill: change% with subtle bg
function TrendPill({ value, isPercent = true, size = 'md', strong = false }) {
  const isUp = value >= 0;
  const sign = isUp ? '+' : '';
  const text = isPercent ? `${sign}${value.toFixed(2)}%` : `${sign}${value.toFixed(2)}`;
  const sizes = {
    sm: { px: 6, py: 1, fz: 11 },
    md: { px: 8, py: 2, fz: 12 },
    lg: { px: 10, py: 3, fz: 13 },
  };
  const s = sizes[size];
  return (
    <span className="mono" style={{
      display: 'inline-flex', alignItems: 'center',
      padding: `${s.py}px ${s.px}px`,
      borderRadius: 6,
      fontSize: s.fz, fontWeight: 600,
      color: strong ? '#fff' : (isUp ? '#047857' : '#b91c1c'),
      background: strong
        ? (isUp ? '#10b981' : '#ef4444')
        : (isUp ? 'var(--color-up-bg)' : 'var(--color-down-bg)'),
    }}>{text}</span>
  );
}

// Heat cell: cell with bg colored by trend intensity
function HeatCell({ value, children, mode = 'bg' }) {
  const isUp = value >= 0;
  const intensity = Math.min(Math.abs(value) / 3, 1); // saturate at ±3%
  const color = isUp ? '16, 185, 129' : '239, 68, 68';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end',
      padding: '2px 6px', borderRadius: 4,
      background: `rgba(${color}, ${0.06 + intensity * 0.18})`,
      color: isUp ? '#047857' : '#b91c1c',
      fontWeight: 600,
    }}>{children}</span>
  );
}

// Volume vs avg — bar showing today's vol relative to 30d avg
function VolumeRatio({ volume, avg }) {
  const ratio = avg > 0 ? volume / avg : 1;
  const pct = Math.min(ratio, 2) / 2 * 100;
  const isHigh = ratio >= 1.2;
  const isLow = ratio < 0.8;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 70 }}>
      <div className="mono" style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>
        {window.fmtVol(volume)}
      </div>
      <div style={{ position: 'relative', height: 3, background: '#e5e7eb', borderRadius: 2 }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, height: '100%',
          width: pct + '%',
          background: isHigh ? '#f59e0b' : (isLow ? '#9ca3af' : '#3b82f6'),
          borderRadius: 2,
        }} />
        <div style={{
          position: 'absolute', left: '50%', top: -1, width: 1, height: 5,
          background: '#9ca3af', opacity: 0.5,
        }} />
      </div>
    </div>
  );
}

// Stock symbol cell
function SymbolCell({ symbol, name, cn, pinned, onPin, compact = false }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      {onPin && (
        <button
          onClick={(e) => { e.stopPropagation(); onPin(); }}
          style={{
            border: 'none', background: 'transparent', cursor: 'pointer', padding: 2,
            color: pinned ? '#f59e0b' : '#d1d5db',
            display: 'flex', alignItems: 'center',
          }}>
          <svg width="14" height="14" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l3.09 6.32L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.05L12 2z"/>
          </svg>
        </button>
      )}
      <div style={{ minWidth: 0 }}>
        <div className="mono" style={{ fontWeight: 700, fontSize: compact ? 13 : 14, color: '#0f172a', letterSpacing: '-0.01em' }}>
          {symbol}
        </div>
        <div style={{
          fontSize: 11, color: '#6b7280', marginTop: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          maxWidth: compact ? 100 : 160,
        }}>{cn || name}</div>
      </div>
    </div>
  );
}

// Browser-window-style frame around a screen
function ScreenFrame({ children, width = '100%', height = 'auto', dark = false, kind = 'browser', label }) {
  const bg = dark ? '#0f172a' : '#ffffff';
  const headerBg = dark ? '#1e293b' : '#f3f4f6';
  if (kind === 'phone') {
    return (
      <div style={{
        width, height, background: bg,
        borderRadius: 36, border: '8px solid #1f2937',
        overflow: 'hidden', boxShadow: '0 18px 40px rgba(0,0,0,0.16)',
        position: 'relative',
      }}>
        <div style={{
          position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
          width: 100, height: 22, background: '#1f2937', borderBottomLeftRadius: 12, borderBottomRightRadius: 12,
          zIndex: 30,
        }} />
        <div style={{
          height: 36, padding: '8px 24px', display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', fontSize: 12, fontWeight: 600,
          color: dark ? '#f3f4f6' : '#0f172a',
        }}>
          <span>9:41</span>
          <span style={{ display: 'flex', gap: 4 }}>
            <span>●●●●</span>
            <span>📶</span>
            <span>🔋</span>
          </span>
        </div>
        <div style={{ height: 'calc(100% - 36px)', overflow: 'auto', background: dark ? '#0f172a' : '#fafafa' }}>
          {children}
        </div>
      </div>
    );
  }
  return (
    <div style={{
      width, height, background: bg,
      borderRadius: 12, border: '1px solid #e5e7eb',
      overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    }}>
      <div style={{
        height: 32, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 8,
        background: headerBg, borderBottom: '1px solid ' + (dark ? '#0f172a' : '#e5e7eb'),
      }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444' }} />
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b' }} />
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#10b981' }} />
        <span style={{ flex: 1, textAlign: 'center', fontSize: 11, color: dark ? '#94a3b8' : '#6b7280' }}>
          {label || 'Stock Tracker'}
        </span>
      </div>
      <div style={{ background: dark ? '#0f172a' : '#fafafa', minHeight: 200 }}>
        {children}
      </div>
    </div>
  );
}

// Header bar (mobile): brand + search + actions
function MobileHeader({ dark = false, syncCount = 8 }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
      background: dark ? '#0f172a' : '#ffffff',
      borderBottom: '1px solid ' + (dark ? '#1e293b' : '#e5e7eb'),
      position: 'sticky', top: 0, zIndex: 20,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 700, fontSize: 14,
        }}>S</div>
      </div>
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', gap: 6,
        background: dark ? '#1e293b' : '#f3f4f6', borderRadius: 10,
        padding: '7px 10px',
      }}>
        <svg width="14" height="14" fill="none" stroke={dark ? '#94a3b8' : '#9ca3af'} strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
        </svg>
        <span style={{ fontSize: 13, color: dark ? '#94a3b8' : '#9ca3af' }}>搜索股票…</span>
      </div>
      <button style={{
        width: 34, height: 34, borderRadius: 9,
        background: 'transparent', border: 'none', cursor: 'pointer',
        color: dark ? '#94a3b8' : '#6b7280',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
        </svg>
      </button>
      <button style={{
        width: 34, height: 34, borderRadius: 9,
        background: '#3b82f6', border: 'none', cursor: 'pointer',
        color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
        </svg>
      </button>
    </div>
  );
}

// Section/category header inside mobile
function MobileSectionHeader({ title, sub, dark }) {
  return (
    <div style={{
      padding: '12px 16px 6px',
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
    }}>
      <div style={{
        fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: dark ? '#64748b' : '#9ca3af',
      }}>{title}</div>
      {sub && <div style={{ fontSize: 11, color: dark ? '#64748b' : '#9ca3af' }}>{sub}</div>}
    </div>
  );
}

window.Sparkline = Sparkline;
window.DayRangeBar = DayRangeBar;
window.YearRangeBar = YearRangeBar;
window.TrendPill = TrendPill;
window.HeatCell = HeatCell;
window.VolumeRatio = VolumeRatio;
window.SymbolCell = SymbolCell;
window.ScreenFrame = ScreenFrame;
window.MobileHeader = MobileHeader;
window.MobileSectionHeader = MobileSectionHeader;

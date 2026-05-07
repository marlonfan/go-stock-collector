// Desktop list view — denser & more data-rich than the original.
// Adds: heatmap %, mini day range bar, volume vs avg, 52W bar, sparkline,
// inline OHLC. Hover row → row highlights, actions slide in.

function DesktopListVariant({ stocks, title = 'List · 数据丰富版', subtitle, dark = false }) {
  const colors = {
    headerBg: dark ? '#1e293b' : '#f9fafb',
    headerText: dark ? '#94a3b8' : '#6b7280',
    rowBorder: dark ? '#1e293b' : '#f3f4f6',
    rowHover: dark ? '#1e293b' : '#f9fafb',
    text: dark ? '#f1f5f9' : '#0f172a',
    sub: dark ? '#94a3b8' : '#6b7280',
    pinnedBg: dark ? 'rgba(245,158,11,0.08)' : '#fffbeb',
  };
  return (
    <div style={{ background: dark ? '#0f172a' : '#fff', fontSize: 13 }}>
      {(title || subtitle) && (
        <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + colors.rowBorder, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: colors.text }}>我的关注 · 8</div>
            <div style={{ fontSize: 11, color: colors.sub, marginTop: 2 }}>美股 · 实时同步 · 4 分钟前更新</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#10b981', fontWeight: 600, background: 'var(--color-up-bg)', padding: '4px 8px', borderRadius: 6 }}>↑ 5</span>
            <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 600, background: 'var(--color-down-bg)', padding: '4px 8px', borderRadius: 6 }}>↓ 3</span>
          </div>
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
        <thead>
          <tr style={{ background: colors.headerBg }}>
            {['', 'Stock', 'Last', 'Chg %', 'Day Range', 'Open', 'High · Low', 'Vol / Avg', '52W', '30D Trend', ''].map((h, i) => (
              <th key={i} style={{
                textAlign: i === 1 ? 'left' : (i === 4 || i === 8 || i === 9 ? 'center' : 'right'),
                padding: '10px 14px', fontSize: 10, fontWeight: 600,
                letterSpacing: '0.05em', textTransform: 'uppercase',
                color: colors.headerText,
                borderBottom: '1px solid ' + (dark ? '#0f172a' : '#e5e7eb'),
                whiteSpace: 'nowrap',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stocks.map((s, idx) => {
            const isUp = s.change >= 0;
            return (
              <tr key={s.symbol} style={{
                borderBottom: '1px solid ' + colors.rowBorder,
                background: s.pinned ? colors.pinnedBg : 'transparent',
                boxShadow: s.pinned ? 'inset 3px 0 0 #f59e0b' : 'none',
              }}>
                <td style={{ padding: '10px 0 10px 12px', width: 1 }}>
                  <span style={{ color: s.pinned ? '#f59e0b' : '#d1d5db', display: 'flex' }}>
                    <svg width="13" height="13" fill={s.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l3.09 6.32L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.05L12 2z"/>
                    </svg>
                  </span>
                </td>
                <td style={{ padding: '10px 14px', minWidth: 160 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span className="mono" style={{ fontWeight: 700, fontSize: 14, color: colors.text }}>{s.symbol}</span>
                    <span style={{ fontSize: 11, color: colors.sub, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.cn} · {s.name}</span>
                  </div>
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                  <div className="mono" style={{ fontWeight: 600, fontSize: 14, color: colors.text }}>{window.fmtPrice(s.currentPrice)}</div>
                  <div className="mono" style={{ fontSize: 10, color: isUp ? '#10b981' : '#ef4444', marginTop: 1 }}>
                    {isUp ? '+' : ''}{s.change.toFixed(2)}
                  </div>
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                  <window.HeatCell value={s.changePercent}>
                    <span className="mono">{(s.changePercent >= 0 ? '+' : '') + s.changePercent.toFixed(2) + '%'}</span>
                  </window.HeatCell>
                </td>
                <td style={{ padding: '10px 14px', minWidth: 130 }}>
                  <window.DayRangeBar low={s.low} high={s.high} current={s.currentPrice} prevClose={s.prevClose} label />
                </td>
                <td className="mono" style={{ padding: '10px 14px', textAlign: 'right', color: colors.sub, fontSize: 12 }}>
                  {window.fmtPrice(s.open)}
                </td>
                <td className="mono" style={{ padding: '10px 14px', textAlign: 'right', fontSize: 12 }}>
                  <div style={{ color: '#10b981' }}>{window.fmtPrice(s.high)}</div>
                  <div style={{ color: '#ef4444' }}>{window.fmtPrice(s.low)}</div>
                </td>
                <td style={{ padding: '10px 14px' }}>
                  <window.VolumeRatio volume={s.volume} avg={s.avgVolume30d} />
                </td>
                <td style={{ padding: '10px 14px', minWidth: 120 }}>
                  <window.YearRangeBar low={s.week52Low} high={s.week52High} current={s.currentPrice} />
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                  <window.Sparkline series={s.series} width={110} height={36} isUp={isUp} />
                </td>
                <td style={{ padding: '10px 14px', width: 1 }}>
                  <div style={{ display: 'flex', gap: 2 }}>
                    {['↻', '⋯'].map((c, i) => (
                      <button key={i} style={{
                        width: 26, height: 26, borderRadius: 6, border: 'none',
                        background: 'transparent', cursor: 'pointer',
                        color: colors.sub, fontSize: 13, lineHeight: 1,
                      }}>{c}</button>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

window.DesktopListVariant = DesktopListVariant;

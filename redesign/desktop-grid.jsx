// Desktop history grid — improved version of the existing "grid" view.
// Adds: heatmap-colored cells per day, sticky stock column with mini sparkline,
// daily change% inline, hoverable cell.

function DesktopGridVariant({ stocks, dark = false }) {
  const colors = {
    bg: dark ? '#0f172a' : '#fff',
    headerBg: dark ? '#1e293b' : '#f9fafb',
    rowBorder: dark ? '#1e293b' : '#f3f4f6',
    text: dark ? '#f1f5f9' : '#0f172a',
    sub: dark ? '#94a3b8' : '#6b7280',
  };
  // Use last 8 days for visibility
  const days = 8;
  return (
    <div style={{ background: colors.bg, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{
              position: 'sticky', left: 0, zIndex: 2,
              background: colors.headerBg, padding: '10px 14px',
              fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
              textTransform: 'uppercase', color: colors.sub,
              borderBottom: '1px solid ' + (dark ? '#0f172a' : '#e5e7eb'),
              borderRight: '1px solid ' + (dark ? '#0f172a' : '#e5e7eb'),
              textAlign: 'left', minWidth: 180,
            }}>Stock</th>
            {Array.from({ length: days }).map((_, i) => {
              const date = new Date();
              date.setDate(date.getDate() - i);
              const isToday = i === 0;
              return (
                <th key={i} style={{
                  padding: '10px 8px', fontSize: 10, fontWeight: 600,
                  letterSpacing: '0.04em', color: isToday ? '#3b82f6' : colors.sub,
                  background: colors.headerBg,
                  borderBottom: '1px solid ' + (dark ? '#0f172a' : '#e5e7eb'),
                  textAlign: 'center', minWidth: 92,
                }}>
                  {isToday ? 'TODAY' : `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {stocks.map(s => {
            const isUp = s.change >= 0;
            return (
              <tr key={s.symbol}>
                <td style={{
                  position: 'sticky', left: 0, zIndex: 1,
                  background: s.pinned ? (dark ? 'rgba(245,158,11,0.08)' : '#fffbeb') : colors.bg,
                  padding: '10px 14px',
                  borderBottom: '1px solid ' + colors.rowBorder,
                  borderRight: '1px solid ' + (dark ? '#1e293b' : '#e5e7eb'),
                  boxShadow: s.pinned ? 'inset 3px 0 0 #f59e0b' : 'none',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="mono" style={{ fontWeight: 700, fontSize: 13, color: colors.text }}>{s.symbol}</div>
                      <div style={{ fontSize: 10, color: colors.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>{s.cn}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                        <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: colors.text }}>{window.fmtPrice(s.currentPrice)}</span>
                        <span className="mono" style={{ fontSize: 10, color: isUp ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                          {isUp ? '+' : ''}{s.changePercent.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                    <window.Sparkline series={s.series.slice(-15)} width={48} height={24} isUp={isUp} fill={false} />
                  </div>
                </td>
                {Array.from({ length: days }).map((_, i) => {
                  const day = s.series[s.series.length - 1 - i];
                  if (!day) return <td key={i} style={{ borderBottom: '1px solid ' + colors.rowBorder, color: '#d1d5db', textAlign: 'center' }}>—</td>;
                  const dayChange = ((day.close - day.open) / day.open) * 100;
                  const dayUp = dayChange >= 0;
                  const intensity = Math.min(Math.abs(dayChange) / 3, 1);
                  const cellBg = dayUp
                    ? `rgba(16, 185, 129, ${0.04 + intensity * 0.16})`
                    : `rgba(239, 68, 68, ${0.04 + intensity * 0.16})`;
                  return (
                    <td key={i} style={{
                      padding: '6px 8px', textAlign: 'center',
                      background: cellBg,
                      borderBottom: '1px solid ' + colors.rowBorder,
                      verticalAlign: 'top',
                    }}>
                      <div className="mono" style={{
                        fontSize: 12, fontWeight: 600,
                        color: dayUp ? '#047857' : '#b91c1c',
                      }}>
                        {dayUp ? '+' : ''}{dayChange.toFixed(2)}%
                      </div>
                      <div className="mono" style={{ fontSize: 10, color: colors.sub, marginTop: 2 }}>
                        {window.fmtPrice(day.close)}
                      </div>
                      <div style={{
                        fontSize: 9, color: colors.sub, marginTop: 2,
                        display: 'flex', justifyContent: 'space-between', gap: 4,
                      }}>
                        <span style={{ color: '#10b981' }}>{day.high.toFixed(0)}</span>
                        <span style={{ color: '#ef4444' }}>{day.low.toFixed(0)}</span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

window.DesktopGridVariant = DesktopGridVariant;

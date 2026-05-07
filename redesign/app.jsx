// App shell — design canvas with all variants laid out.

function App() {
  const stocks = window.STOCKS;
  const detailStock = stocks.find(s => s.symbol === 'NVDA');

  return (
    <DesignCanvas title="Stock Tracker · UI 优化方案" subtitle="保持功能不变,提升信息密度与移动端体验">
      <DCSection id="overview" title="设计目标">
        <div style={{
          padding: '24px 28px', background: '#fff', borderRadius: 12,
          border: '1px solid #e5e7eb', maxWidth: 920, fontSize: 14, lineHeight: 1.7,
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
            <div>
              <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>① 更多数据露出</div>
              <div style={{ color: '#475569' }}>
                每个单元/卡片在不增加视觉负担的前提下,新增日内涨跌热力色、日内区间条、量比柱、52周区间条、振幅,以及当日收盘相对开盘的方向色。
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>② 更易扫读</div>
              <div style={{ color: '#475569' }}>
                列表中关键数字 (价格 / 涨跌幅) 用 tabular-nums 等宽对齐;%列加热力底色,绿涨红跌一眼可识别;Pin 行用 3px 左侧条,不挤占内容。
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>③ 移动端美观且密集</div>
              <div style={{ color: '#475569' }}>
                Mobile 卡片含 OHLCV + 振幅 + sparkline + 区间条,一屏 4-5 张;另提供超紧凑列表,一屏 8-10 行;详情页用堆叠卡片承载更多基本面。
              </div>
            </div>
          </div>
        </div>
      </DCSection>

      <DCSection id="desktop-list" title="桌面 · List 视图 (信息丰富)">
        <DCArtboard id="desktop-list-light" label="Light · 1280×640" width={1280} height={640}>
          <window.ScreenFrame width="100%" label="stock.local · List view">
            <window.DesktopListVariant stocks={stocks} />
          </window.ScreenFrame>
        </DCArtboard>
        <DCArtboard id="desktop-list-dark" label="Dark · 1280×640" width={1280} height={640}>
          <window.ScreenFrame width="100%" label="stock.local · Dark" dark>
            <window.DesktopListVariant stocks={stocks} dark />
          </window.ScreenFrame>
        </DCArtboard>
      </DCSection>

      <DCSection id="desktop-cards" title="桌面 · 卡片视图 (含 OHLC + 52W)">
        <DCArtboard id="desktop-cards-light" label="Cards · 1100×620" width={1100} height={620}>
          <window.ScreenFrame width="100%" label="stock.local · Cards">
            <window.DesktopCardsVariant stocks={stocks} />
          </window.ScreenFrame>
        </DCArtboard>
      </DCSection>

      <DCSection id="desktop-grid" title="桌面 · 历史日历视图 (热力化)">
        <DCArtboard id="desktop-grid-light" label="Heatmap Grid · 1280×560" width={1280} height={560}>
          <window.ScreenFrame width="100%" label="stock.local · History grid">
            <window.DesktopGridVariant stocks={stocks} />
          </window.ScreenFrame>
        </DCArtboard>
      </DCSection>

      <DCSection id="mobile" title="移动端 · 三种形态">
        <DCArtboard id="mobile-cards" label="Cards · 375×800" width={375} height={800}>
          <window.ScreenFrame width={375} height={800} kind="phone">
            <window.MobileHeader />
            <window.MobileCardsVariant stocks={stocks} />
          </window.ScreenFrame>
        </DCArtboard>
        <DCArtboard id="mobile-list" label="List · 紧凑 · 375×800" width={375} height={800}>
          <window.ScreenFrame width={375} height={800} kind="phone">
            <window.MobileHeader />
            <window.MobileListVariant stocks={stocks} />
          </window.ScreenFrame>
        </DCArtboard>
        <DCArtboard id="mobile-detail" label="Detail · 375×800" width={375} height={800}>
          <window.ScreenFrame width={375} height={800} kind="phone">
            <window.MobileDetailVariant stock={detailStock} />
          </window.ScreenFrame>
        </DCArtboard>
      </DCSection>

      <DCSection id="mobile-dark" title="移动端 · 暗色主题">
        <DCArtboard id="mobile-cards-dark" label="Cards Dark · 375×800" width={375} height={800}>
          <window.ScreenFrame width={375} height={800} kind="phone" dark>
            <window.MobileHeader dark />
            <window.MobileCardsVariant stocks={window.STOCKS} dark />
          </window.ScreenFrame>
        </DCArtboard>
        <DCArtboard id="mobile-detail-dark" label="Detail Dark · 375×800" width={375} height={800}>
          <window.ScreenFrame width={375} height={800} kind="phone" dark>
            <window.MobileDetailVariant stock={detailStock} dark />
          </window.ScreenFrame>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

window.App = App;

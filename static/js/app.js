// Stock Tracker Frontend Application
class StockTracker {
    constructor() {
        this.stocks = new Map();
        this.chartCache = new Map();
        this.currentChartRequest = null;
        this.currentChartSymbol = null;
        this.currentChartPeriod = 90;
        this.chartModalClickHandler = null;
        this.chartPeriodClickHandler = null;
        this.suppressCardRerender = false;
        this.activeSearchSource = null; // 'modal' | 'global'
        this.searchDebounce = { modal: null, global: null };
        this.viewMode = this._initialViewMode(); // 'list' | 'cards' | 'grid'
        this.currentUser = null; // {id, email}
        this.init();
    }

    _initialViewMode() {
        let stored = null;
        try { stored = localStorage.getItem('viewMode'); } catch (e) {}
        if (stored === 'list' || stored === 'cards' || stored === 'grid') return stored;
        // PC default = list (better for at-a-glance OHLC scan), mobile = cards
        return (window.innerWidth >= 768) ? 'list' : 'cards';
    }

    async init() {
        this.setupEventListeners();
        this.setupGlobalSearch();
        this.setupDarkModeToggle();
        this.setupSyncAll();
        this.setupViewModeToggle();
        this.setupKeyboardShortcuts();
        this.setupAuth();

        // Decide whether the user can see the app or must log in first.
        const me = await this.fetchMe();
        if (!me) {
            await this.showAuthOverlay();
            return;
        }
        this.applyAuthSuccess(me);
        this.loadWatchedStocks();
    }

    // ---------- Auth ----------

    setupAuth() {
        // Tab switching
        document.querySelectorAll('.auth-tab').forEach(tab => {
            tab.addEventListener('click', () => this.switchAuthTab(tab.dataset.authTab));
        });

        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const fd = new FormData(loginForm);
                this.submitAuth('login', { email: fd.get('email'), password: fd.get('password') });
            });
        }

        const registerForm = document.getElementById('registerForm');
        if (registerForm) {
            registerForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const fd = new FormData(registerForm);
                this.submitAuth('register', {
                    email: fd.get('email'),
                    password: fd.get('password'),
                    inviteCode: fd.get('inviteCode'),
                });
            });
        }

        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.logout());
        }
    }

    switchAuthTab(name) {
        document.querySelectorAll('.auth-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.authTab === name);
        });
        document.getElementById('loginForm').classList.toggle('hidden', name !== 'login');
        document.getElementById('registerForm').classList.toggle('hidden', name !== 'register');
        this.setAuthError('');
    }

    async fetchMe() {
        try {
            const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
            if (!r.ok) return null;
            return await r.json();
        } catch (e) {
            return null;
        }
    }

    async showAuthOverlay() {
        const overlay = document.getElementById('authOverlay');
        if (!overlay) return;
        overlay.classList.remove('hidden');
        // Probe onboarding (public endpoint) to show "你将接管 X 只股票" hint
        try {
            const r = await fetch('/api/auth/onboarding');
            if (r.ok) {
                const info = await r.json();
                this._renderOnboardingHint(info);
                // If there are unclaimed stocks, default to the Register tab so
                // the inheriting flow is the primary action.
                if (info.unclaimedStockCount > 0 && !info.hasAnyUser) {
                    this.switchAuthTab('register');
                }
            }
        } catch (e) { /* non-fatal */ }
        const firstField = document.querySelector('.auth-form:not(.hidden) input');
        if (firstField) firstField.focus();
    }

    _renderOnboardingHint(info) {
        const banner = document.getElementById('authOnboardingBanner');
        if (!banner) return;
        if (info && !info.hasAnyUser && info.unclaimedStockCount > 0) {
            banner.textContent = `🎁 这台服务器上还有 ${info.unclaimedStockCount} 只未认领的股票,注册第一个账号将自动继承。`;
            banner.classList.remove('hidden');
        } else {
            banner.classList.add('hidden');
        }
    }

    async submitAuth(kind, body) {
        this.setAuthError('');
        const url = kind === 'login' ? '/api/auth/login' : '/api/auth/register';
        try {
            const r = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(body),
            });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) {
                this.setAuthError(data.error || '操作失败');
                return;
            }
            // Hide overlay, swap to app, fetch watchlist
            document.getElementById('authOverlay').classList.add('hidden');
            this.applyAuthSuccess(data);
            await this._migrateLegacyPinsIfAny();
            if (kind === 'register' && data.claimedStocks > 0) {
                this.showSuccess(`已继承 ${data.claimedStocks} 只股票`);
            }
            await this.loadWatchedStocks();
        } catch (e) {
            this.setAuthError('网络错误,请重试');
        }
    }

    applyAuthSuccess(user) {
        this.currentUser = user;
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.classList.remove('hidden');
            logoutBtn.title = `Logout (${user.email})`;
        }
    }

    setAuthError(msg) {
        const el = document.getElementById('authError');
        if (!el) return;
        if (!msg) {
            el.classList.add('hidden');
            el.textContent = '';
            return;
        }
        el.textContent = msg;
        el.classList.remove('hidden');
    }

    async logout() {
        try {
            await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
        } catch (e) { /* ignore */ }
        this.currentUser = null;
        this.stocks.clear();
        this.chartCache.clear();
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) logoutBtn.classList.add('hidden');
        // Clear forms then surface the overlay again
        document.querySelectorAll('.auth-form').forEach(f => f.reset());
        this.setAuthError('');
        await this.showAuthOverlay();
    }

    // Migrate localStorage pinnedStocks → server pin column on first login,
    // then drop the localStorage key. Idempotent and per-device.
    async _migrateLegacyPinsIfAny() {
        let legacy = null;
        try { legacy = localStorage.getItem('pinnedStocks'); } catch (e) { return; }
        if (!legacy) return;
        let symbols;
        try { symbols = JSON.parse(legacy); } catch (e) { symbols = null; }
        if (!Array.isArray(symbols) || symbols.length === 0) {
            try { localStorage.removeItem('pinnedStocks'); } catch (e) {}
            return;
        }
        // Best-effort: try each symbol; ignore errors (e.g. not in user's watchlist)
        await Promise.all(symbols.map(s =>
            fetch(`/api/stocks/${encodeURIComponent(s)}/pin`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ pinned: true }),
            }).catch(() => null)
        ));
        try { localStorage.removeItem('pinnedStocks'); } catch (e) {}
    }

    // Centralized fetch wrapper: any 401 from the API while logged in
    // surfaces the auth overlay (session expired / cleared).
    async _apiFetch(url, opts = {}) {
        const merged = Object.assign({ credentials: 'same-origin' }, opts);
        const r = await fetch(url, merged);
        if (r.status === 401 && this.currentUser) {
            this.currentUser = null;
            const logoutBtn = document.getElementById('logoutBtn');
            if (logoutBtn) logoutBtn.classList.add('hidden');
            await this.showAuthOverlay();
        }
        return r;
    }

    setupViewModeToggle() {
        const toggle = document.getElementById('viewToggle');
        if (!toggle) return;
        // Initial active state
        toggle.querySelectorAll('.view-toggle-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === this.viewMode);
        });
        toggle.addEventListener('click', (e) => {
            const btn = e.target.closest('.view-toggle-btn');
            if (!btn) return;
            const mode = btn.dataset.view;
            if (!mode || mode === this.viewMode) return;
            this.viewMode = mode;
            try { localStorage.setItem('viewMode', mode); } catch (err) {}
            toggle.querySelectorAll('.view-toggle-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.view === mode);
            });
            this.renderStocks();
        });
    }

    setupEventListeners() {
        // Add stock button
        document.getElementById('addStockBtn').addEventListener('click', () => {
            this.showAddStockModal();
        });

        // Empty state CTA (was using bare `showAddStockModal()` which broke)
        const emptyAddBtn = document.getElementById('emptyAddStockBtn');
        if (emptyAddBtn) {
            emptyAddBtn.addEventListener('click', () => this.showAddStockModal());
        }

        // Add stock form
        document.getElementById('addStockForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addStock();
        });

        // Cancel button inside Add Stock modal
        const cancelBtn = document.getElementById('cancelAddStockBtn');
        if (cancelBtn) cancelBtn.addEventListener('click', () => this.hideAddStockModal());

        // Close button inside chart modal
        const closeChart = document.getElementById('closeChartModalBtn');
        if (closeChart) closeChart.addEventListener('click', () => this.hideChartModal());

        // Modal stock-symbol input → searchStocks(query, 'modal')
        const stockSymbolInput = document.getElementById('stockSymbol');
        stockSymbolInput.addEventListener('input', (e) => {
            clearTimeout(this.searchDebounce.modal);
            const query = e.target.value.trim();
            if (query.length >= 1) {
                this.searchDebounce.modal = setTimeout(() => {
                    this.searchStocks(query, 'modal');
                }, 300);
            } else {
                this.hideSearchResults('modal');
            }
        });

        // Hide either search dropdown when clicking outside its input/results
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#stockSymbol') && !e.target.closest('#stockSearchResults')) {
                this.hideSearchResults('modal');
            }
            if (!e.target.closest('#globalSearch') && !e.target.closest('#globalSearchResults')) {
                this.hideSearchResults('global');
            }
        });

        // Close add-stock modal on backdrop click
        document.getElementById('addStockModal').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) {
                this.hideAddStockModal();
            }
        });

        // Card grid: event delegation (replaces inline onclick everywhere)
        const stocksContainer = document.getElementById('stocksContainer');
        if (stocksContainer) {
            stocksContainer.addEventListener('click', (e) => this.handleCardClick(e));
        }
    }

    setupGlobalSearch() {
        const input = document.getElementById('globalSearch');
        const results = document.getElementById('globalSearchResults');
        if (!input || !results) return;

        input.addEventListener('input', (e) => {
            clearTimeout(this.searchDebounce.global);
            const query = e.target.value.trim();
            if (query.length >= 1) {
                this.searchDebounce.global = setTimeout(() => {
                    this.searchStocks(query, 'global');
                }, 300);
            } else {
                this.hideSearchResults('global');
            }
        });

        // Esc / Enter inside the field
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideSearchResults('global');
                input.blur();
            }
        });
    }

    setupDarkModeToggle() {
        const btn = document.getElementById('darkToggleBtn');
        if (!btn) return;

        btn.addEventListener('click', () => {
            const isDark = document.documentElement.classList.toggle('dark');
            try {
                localStorage.setItem('darkMode', isDark ? 'dark' : 'light');
            } catch (e) { /* ignore */ }
            // Redraw any open chart so it picks up new isDarkMode reads
            if (this.currentChartSymbol && this._chartLayout) {
                this.drawCandlestickChart(this._chartLayout.data, this.currentChartSymbol);
            }
            // Re-render sparklines with new colors
            this.renderAllSparklines();
        });

        // Follow system pref only when user hasn't picked manually
        if (window.matchMedia) {
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
                let stored = null;
                try { stored = localStorage.getItem('darkMode'); } catch (err) {}
                if (stored === 'dark' || stored === 'light') return;
                document.documentElement.classList.toggle('dark', e.matches);
                this.renderAllSparklines();
            });
        }
    }

    setupSyncAll() {
        const btn = document.getElementById('syncAllBtn');
        if (!btn) return;
        btn.addEventListener('click', () => this.syncAllStocks());
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            const tag = (e.target && e.target.tagName) || '';
            const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable);

            // Esc: close topmost open thing
            if (e.key === 'Escape') {
                const chartModal = document.getElementById('chartModal');
                const addModal = document.getElementById('addStockModal');
                if (chartModal && !chartModal.classList.contains('hidden')) {
                    this.hideChartModal();
                    e.preventDefault();
                    return;
                }
                if (addModal && !addModal.classList.contains('hidden')) {
                    this.hideAddStockModal();
                    e.preventDefault();
                    return;
                }
                const globalResults = document.getElementById('globalSearchResults');
                if (globalResults && !globalResults.classList.contains('hidden')) {
                    this.hideSearchResults('global');
                    const gi = document.getElementById('globalSearch');
                    if (gi) gi.blur();
                    e.preventDefault();
                    return;
                }
                return;
            }

            if (isTyping) return;

            if (e.key === '/') {
                const gi = document.getElementById('globalSearch');
                if (gi) {
                    e.preventDefault();
                    gi.focus();
                    gi.select();
                }
            } else if (e.key === 'a' || e.key === 'A') {
                e.preventDefault();
                this.showAddStockModal();
            }
        });
    }

    showAddStockModal() {
        document.getElementById('addStockModal').classList.remove('hidden');
        document.getElementById('stockSymbol').focus();
    }

    hideAddStockModal() {
        document.getElementById('addStockModal').classList.add('hidden');
        document.getElementById('addStockForm').reset();
    }

    async loadWatchedStocks() {
        try {
            console.log('🚀 Starting to load watched stocks...');
            const response = await fetch('/api/stocks');
            const stocks = await response.json();
            console.log('📊 Loaded stocks list:', stocks);

            if (!stocks || stocks.length === 0) {
                console.log('📭 No stocks found, showing empty state');
                this.showEmptyState();
                return;
            }

            this.hideEmptyState();

            // Show loading state
            this.showLoadingState('Loading stock data...');

            // Load all stocks data in parallel
            console.log('⏳ Loading stock data in parallel for', stocks.length, 'stocks');
            const stockDataPromises = stocks.map(async (stock, index) => {
                console.log(`📈 Loading data for ${stock.symbol} (${index + 1}/${stocks.length})`);
                this.stocks.set(stock.symbol, stock);
                try {
                    await this.loadStockData(stock.symbol);
                    console.log(`✅ Successfully loaded data for ${stock.symbol}`);
                } catch (error) {
                    console.error(`❌ Failed to load data for ${stock.symbol}:`, error);
                    // Continue with other stocks even if one fails
                }
            });

            // Wait for all stock data to load
            console.log('⏳ Waiting for all stock data to load...');
            await Promise.all(stockDataPromises);
            console.log('🎉 All stock data loaded, creating grid view...');
            console.log('📊 Current stocks in memory:', this.stocks.size);

            this.renderStocks();
            this.hideLoadingState();
            console.log('👋 Loading state hidden, grid should be visible');

            console.log('🔍 Checking if container was updated...');
        setTimeout(() => {
            const container = document.getElementById('stocksContainer');
            console.log('📦 Container HTML after update:', container.innerHTML.substring(0, 200) + '...');
            console.log('📦 Container is visible:', !container.classList.contains('hidden'));
            console.log('📦 Loading state is hidden:', document.getElementById('loadingState').classList.contains('hidden'));
        }, 100);
        } catch (error) {
            console.error('💥 Failed to load watched stocks:', error);
            this.showError('Failed to load stocks');
        }
    }

    async addStock() {
        const form = document.getElementById('addStockForm');
        const formData = new FormData(form);
        const symbol = formData.get('symbol').toUpperCase().trim();
        const name = formData.get('name').trim();

        if (!symbol) {
            this.showError('Please enter a stock symbol');
            return;
        }

        try {
            // Add stock to watchlist
            const response = await fetch('/api/stocks', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ symbol, name }),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to add stock');
            }

            this.hideAddStockModal();
            this.showSuccess(`Added ${symbol} to watchlist, fetching data...`);

            // Automatically sync data for the new stock
            try {
                const syncResponse = await fetch(`/api/stocks/${symbol}/sync`, {
                    method: 'POST',
                });

                if (!syncResponse.ok) {
                    console.warn(`Failed to sync ${symbol} data automatically`);
                } else {
                    const syncResult = await syncResponse.json();
                    console.log(`Synced ${symbol}: ${syncResult.recordsAdded} records added`);
                }
            } catch (syncError) {
                console.warn(`Auto-sync failed for ${symbol}:`, syncError);
            }

            // Refresh the view
            await this.loadWatchedStocks();
        } catch (error) {
            console.error('Failed to add stock:', error);
            this.showError(error.message);
        }
    }

    async removeStock(symbol) {
        if (!confirm(`Are you sure you want to remove ${symbol} from your watchlist?`)) {
            return;
        }

        try {
            const response = await fetch(`/api/stocks/${symbol}`, {
                method: 'DELETE',
            });

            if (!response.ok) {
                throw new Error('Failed to remove stock');
            }

            this.stocks.delete(symbol);
            this.showSuccess(`Removed ${symbol} from watchlist`);

            this.renderStocks();
        } catch (error) {
            console.error('Failed to remove stock:', error);
            this.showError('Failed to remove stock');
        }
    }

    async syncStockData(symbol) {
        // Find this stock's syncing affordances via data attributes (works for
        // both card and list views since both use [data-symbol]).
        const root = document.querySelector(`#stocksContainer [data-symbol="${symbol}"]`);
        const card = root && root.classList.contains('stock-card') ? root : null;
        const syncBtn = document.querySelector(`#stocksContainer .js-sync-btn[data-symbol="${symbol}"]`);

        if (card) card.classList.add('is-syncing');
        if (syncBtn) syncBtn.disabled = true;

        try {
            const response = await fetch(`/api/stocks/${symbol}/sync`, {
                method: 'POST',
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to sync data');
            }

            const result = await response.json();
            this.showSuccess(`${symbol} data synchronized successfully`);

            // Invalidate cached chart series for this symbol so next open shows fresh daily K
            for (const key of Array.from(this.chartCache.keys())) {
                if (key.startsWith(`${symbol}-`)) {
                    this.chartCache.delete(key);
                }
            }

            // Reload stock data and refresh the affected card
            await this.loadStockData(symbol);
            this.renderStocks();
        } catch (error) {
            console.error('Failed to sync stock:', error);
            this.showError(error.message);
        } finally {
            if (card) card.classList.remove('is-syncing');
            if (syncBtn) syncBtn.disabled = false;
        }
    }

    async loadStockData(symbol) {
        try {
            const response = await fetch(`/api/stocks/${symbol}/summary`);
            const data = await response.json();

            this.stocks.set(symbol, data);
        } catch (error) {
            console.error(`Failed to load data for ${symbol}:`, error);
            this.showError(`Failed to load data for ${symbol}`);
        }
    }

    showLoadingState(message = 'Loading stocks...') {
        const loadingState = document.getElementById('loadingState');
        loadingState.classList.remove('hidden');
        loadingState.innerHTML = `
            <div class="text-center">
                <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p class="text-gray-600 dark:text-gray-400">${message}</p>
            </div>
        `;
        document.getElementById('emptyState').classList.add('hidden');
        document.getElementById('stocksContainer').classList.add('hidden');
    }

    showEmptyState() {
        document.getElementById('loadingState').classList.add('hidden');
        document.getElementById('emptyState').classList.remove('hidden');
        document.getElementById('stocksContainer').classList.add('hidden');
    }

    hideEmptyState() {
        document.getElementById('loadingState').classList.add('hidden');
        document.getElementById('emptyState').classList.add('hidden');
        document.getElementById('stocksContainer').classList.remove('hidden');
    }

    hideLoadingState() {
        document.getElementById('loadingState').classList.add('hidden');
        document.getElementById('emptyState').classList.add('hidden');
        document.getElementById('stocksContainer').classList.remove('hidden');
    }

    showSuccess(message) {
        this.showMessage(message, 'success');
    }

    showError(message) {
        this.showMessage(message, 'error');
    }

    showMessage(message, type = 'success') {
        const messageEl = document.createElement('div');
        messageEl.className = type === 'success' ? 'success-message' : 'error-message';
        messageEl.textContent = message;

        if (type === 'error') {
            messageEl.style.background = 'var(--apple-red)';
        }

        document.body.appendChild(messageEl);

        setTimeout(() => {
            messageEl.style.opacity = '0';
            setTimeout(() => messageEl.remove(), 300);
        }, 3000);
    }

    // Utility functions
    formatPrice(price) {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(price);
    }

    formatPriceChange(change, percent) {
        const sign = change >= 0 ? '+' : '';
        return `${sign}${this.formatPrice(change)} (${sign}${percent.toFixed(2)}%)`;
    }

    formatVolume(volume) {
        if (volume >= 1000000) {
            return `${(volume / 1000000).toFixed(1)}M`;
        } else if (volume >= 1000) {
            return `${(volume / 1000).toFixed(1)}K`;
        }
        return volume.toString();
    }

    formatDate(date) {
        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        }).format(new Date(date));
    }

    formatDateTime(date) {
        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        }).format(new Date(date));
    }

    renderStocks() {
        if (this.suppressCardRerender) return;

        const container = document.getElementById('stocksContainer');
        if (!container) return;
        container.innerHTML = '';

        if (this.stocks.size === 0) {
            this.showEmptyState();
            return;
        }
        this.hideEmptyState();

        // Sort: pinned first, then alphabetical
        const pinned = this.getPinnedStocks();
        const symbols = Array.from(this.stocks.keys()).sort((a, b) => {
            const ap = pinned.includes(a), bp = pinned.includes(b);
            if (ap && !bp) return -1;
            if (!ap && bp) return 1;
            return a.localeCompare(b);
        });

        // Toggle layout class without dropping `hidden` (managed by show/hide methods)
        container.classList.remove('stocks-grid', 'stocks-list-wrap', 'stocks-history-wrap');
        if (this.viewMode === 'list') {
            container.classList.add('stocks-list-wrap');
            container.innerHTML = this.listHTML(symbols);
        } else if (this.viewMode === 'grid') {
            container.classList.add('stocks-history-wrap');
            container.innerHTML = this.gridHTML(symbols);
        } else {
            container.classList.add('stocks-grid');
            container.innerHTML = symbols.map(symbol => this.cardHTML(this.stocks.get(symbol))).join('');
        }

        // Defer sparkline render past the layout the browser is about to do.
        requestAnimationFrame(() => this.renderAllSparklines());
    }

    listHTML(symbols) {
        const rows = symbols.map(s => this.rowHTML(this.stocks.get(s))).join('');
        return `
            <table class="stocks-list">
                <thead>
                    <tr>
                        <th class="pin-cell"></th>
                        <th class="col-symbol">Stock</th>
                        <th>Price</th>
                        <th>Change</th>
                        <th>Open</th>
                        <th>High</th>
                        <th>Low</th>
                        <th>Close</th>
                        <th class="col-vol">Vol</th>
                        <th class="col-spark">30D</th>
                        <th class="col-actions"></th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;
    }

    rowHTML(stock) {
        if (!stock) return '';
        const symbol = stock.symbol;
        const isPinned = this.isPinned(symbol);
        const change = stock.change || 0;
        const changePct = stock.changePercent || 0;
        const isUp = change >= 0;
        const trendClass = isUp ? 'trend-up' : 'trend-down';
        const sign = isUp ? '+' : '';
        const last = stock.dailyData && stock.dailyData[0]; // DESC, so [0] is latest
        const open = last ? this.formatPrice(last.open) : '—';
        const high = last ? this.formatPrice(last.high) : '—';
        const low = last ? this.formatPrice(last.low) : '—';
        const close = last ? this.formatPrice(last.close) : '—';
        const vol = last ? this.formatVolume(last.volume) : '—';
        const pinnedRowClass = isPinned ? ' pinned' : '';

        return `
            <tr data-symbol="${symbol}" data-action="open-chart"${pinnedRowClass ? ` class="${pinnedRowClass.trim()}"` : ''}>
                <td class="pin-cell" data-stop="1">
                    <button type="button" class="pin-btn ${isPinned ? 'is-pinned' : ''}"
                        data-action="pin" data-symbol="${symbol}" title="${isPinned ? 'Unpin' : 'Pin'}">
                        <svg class="w-4 h-4" fill="${isPinned ? 'currentColor' : 'none'}" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 2l3.09 6.32L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.05L12 2z"></path>
                        </svg>
                    </button>
                </td>
                <td class="col-symbol">
                    <div class="row-symbol">${symbol}</div>
                    <div class="row-name">${this._escape(stock.name || '')}</div>
                </td>
                <td class="col-num-strong">${this.formatPrice(stock.currentPrice || 0)}</td>
                <td class="${trendClass}">${sign}${changePct.toFixed(2)}%</td>
                <td>${open}</td>
                <td>${high}</td>
                <td>${low}</td>
                <td class="col-num-strong">${close}</td>
                <td class="col-vol">${vol}</td>
                <td class="col-spark">
                    <canvas class="stock-card-sparkline" data-symbol="${symbol}"></canvas>
                </td>
                <td class="col-actions">
                    <div class="col-actions-inner">
                        <button type="button" class="stock-card-action-btn js-sync-btn"
                            data-action="sync" data-symbol="${symbol}" title="Sync data">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                            </svg>
                        </button>
                        <button type="button" class="stock-card-action-btn is-danger"
                            data-action="remove" data-symbol="${symbol}" title="Remove">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                            </svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }

    // History grid: rows = stocks, columns = trading days, cells = full OHLCV.
    // Reuses the original "horizontal grid" idea — best for scanning daily
    // patterns across multiple stocks. Cap at the most recent 30 dates so the
    // table stays usable with many stocks; horizontal scroll handles overflow.
    gridHTML(symbols) {
        const MAX_DATES = 30;

        // Build the union of dates across all stocks (date-only string keys).
        const dateSet = new Set();
        const stockData = new Map();
        for (const sym of symbols) {
            const stock = this.stocks.get(sym);
            if (!stock || !Array.isArray(stock.dailyData) || stock.dailyData.length === 0) continue;
            stockData.set(sym, stock);
            for (const day of stock.dailyData) {
                if (day && day.date) dateSet.add(String(day.date).split('T')[0]);
            }
        }
        if (stockData.size === 0 || dateSet.size === 0) {
            return '<div class="text-center text-gray-500 py-8">No daily data available</div>';
        }

        const sortedDates = Array.from(dateSet).sort().reverse().slice(0, MAX_DATES);

        const headerCells = sortedDates.map(d => `<th>${this._formatGridDate(d)}</th>`).join('');

        const rows = symbols.filter(s => stockData.has(s)).map(sym => {
            const stock = stockData.get(sym);
            const isPinned = this.isPinned(sym);
            const dayMap = new Map();
            stock.dailyData.forEach(d => { if (d && d.date) dayMap.set(String(d.date).split('T')[0], d); });

            const change = stock.change || 0;
            const changePct = stock.changePercent || 0;
            const isUp = change >= 0;
            const trendClass = isUp ? 'trend-up' : 'trend-down';
            const sign = isUp ? '+' : '';

            const stockCell = `
                <td class="col-stock">
                    <div class="stock-meta">
                        <div class="stock-meta-info">
                            <div class="stock-meta-symbol" data-action="open-chart" data-symbol="${sym}" title="Open chart">${sym}</div>
                            <div class="stock-meta-name">${this._escape(stock.name || '')}</div>
                            <div class="stock-meta-price ${trendClass}">
                                ${this.formatPrice(stock.currentPrice || 0)}
                                <span style="font-size:11px;opacity:.85;">${sign}${changePct.toFixed(2)}%</span>
                            </div>
                        </div>
                        <div class="stock-meta-actions">
                            <button type="button" class="stock-card-action-btn ${isPinned ? 'is-pinned' : ''}"
                                data-action="pin" data-symbol="${sym}" title="${isPinned ? 'Unpin' : 'Pin'}">
                                <svg class="w-4 h-4" fill="${isPinned ? 'currentColor' : 'none'}" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 2l3.09 6.32L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.05L12 2z"></path>
                                </svg>
                            </button>
                            <button type="button" class="stock-card-action-btn js-sync-btn"
                                data-action="sync" data-symbol="${sym}" title="Sync data">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                                </svg>
                            </button>
                            <button type="button" class="stock-card-action-btn is-danger"
                                data-action="remove" data-symbol="${sym}" title="Remove">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                                </svg>
                            </button>
                        </div>
                    </div>
                </td>
            `;

            const dayCells = sortedDates.map((dateStr, idx) => {
                const day = dayMap.get(dateStr);
                if (!day) return '<td class="ohlc-empty">—</td>';

                // Compare today's close vs yesterday's close (yesterday = next index since DESC)
                let prevClose = null;
                if (idx < sortedDates.length - 1) {
                    const prev = dayMap.get(sortedDates[idx + 1]);
                    if (prev) prevClose = prev.close;
                }
                // Open color: green if open >= prev close (gap up), red if gap down
                let openTrend = '';
                if (prevClose !== null) openTrend = day.open >= prevClose ? 'trend-up' : 'trend-down';
                // Close color: green if close >= open (bullish bar), red if bearish
                const closeTrend = day.close >= day.open ? 'trend-up' : 'trend-down';

                return `
                    <td>
                        <div class="ohlc-cell">
                            <div class="ohlc-open ${openTrend}">O ${this._formatCompact(day.open)}</div>
                            <div class="ohlc-high">H ${this._formatCompact(day.high)}</div>
                            <div class="ohlc-low">L ${this._formatCompact(day.low)}</div>
                            <div class="ohlc-close ${closeTrend}">C ${this._formatCompact(day.close)}</div>
                            <div class="ohlc-volume text-gray-500">${this.formatVolume(day.volume)}</div>
                        </div>
                    </td>
                `;
            }).join('');

            return `<tr data-symbol="${sym}"${isPinned ? ' class="pinned"' : ''}>${stockCell}${dayCells}</tr>`;
        }).join('');

        return `
            <table class="stocks-history">
                <thead>
                    <tr>
                        <th class="col-stock">Stock</th>
                        ${headerCells}
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;
    }

    _formatGridDate(dateStr) {
        // dateStr is "YYYY-MM-DD". Render compact MM.DD; year prefix only on Jan 1
        // to keep the column header narrow.
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
        if (!m) return dateStr;
        const [, year, month, day] = m;
        if (month === '01' && day === '01') return `${year}.01.01`;
        return `${month}.${day}`;
    }

    _formatCompact(price) {
        if (price >= 1000) return (price / 1000).toFixed(1) + 'k';
        return price.toFixed(price < 10 ? 3 : 2);
    }

    cardHTML(stock) {
        if (!stock) return '';
        const symbol = stock.symbol;
        const isPinned = this.isPinned(symbol);
        const change = stock.change || 0;
        const changePct = stock.changePercent || 0;
        const isUp = change >= 0;
        const trendClass = isUp ? 'trend-up' : 'trend-down';
        const sign = isUp ? '+' : '';
        const lastBar = stock.dailyData && stock.dailyData[0]; // dailyData is DESC
        const volume = lastBar ? this.formatVolume(lastBar.volume) : '—';
        const lastUpdate = stock.lastUpdate ? this.formatRelativeTime(stock.lastUpdate) : '—';

        const pinnedClass = isPinned ? ' pinned' : '';
        const pinBtnClass = isPinned ? 'is-pinned' : '';
        const pinTitle = isPinned ? 'Unpin' : 'Pin';

        return `
            <div class="stock-card${pinnedClass}" data-symbol="${symbol}" data-action="open-chart">
                <div class="stock-card-syncing-overlay"></div>
                <div class="stock-card-head">
                    <div style="min-width: 0;">
                        <div class="stock-card-symbol">${symbol}</div>
                        <div class="stock-card-name">${this._escape(stock.name || '')}</div>
                    </div>
                    <div class="stock-card-actions">
                        <button type="button" class="stock-card-action-btn ${pinBtnClass}"
                            data-action="pin" data-symbol="${symbol}" title="${pinTitle}">
                            <svg class="w-4 h-4" fill="${isPinned ? 'currentColor' : 'none'}" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 2l3.09 6.32L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.05L12 2z"></path>
                            </svg>
                        </button>
                        <button type="button" class="stock-card-action-btn js-sync-btn"
                            data-action="sync" data-symbol="${symbol}" title="Sync data">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                            </svg>
                        </button>
                        <button type="button" class="stock-card-action-btn is-danger"
                            data-action="remove" data-symbol="${symbol}" title="Remove">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="stock-card-price">${this.formatPrice(stock.currentPrice || 0)}</div>
                <div class="stock-card-change ${trendClass}">${sign}${this.formatPrice(change)} &nbsp; ${sign}${changePct.toFixed(2)}%</div>
                <div class="stock-card-sparkline-wrap">
                    <canvas class="stock-card-sparkline" data-symbol="${symbol}"></canvas>
                </div>
                <div class="stock-card-foot">
                    <span>Vol ${volume}</span>
                    <span>${lastUpdate}</span>
                </div>
            </div>
        `;
    }

    handleCardClick(e) {
        const actionEl = e.target.closest('[data-action]');
        if (!actionEl) return;
        const action = actionEl.dataset.action;
        const symbol = actionEl.dataset.symbol;

        // Inner action buttons must not trigger the card's own open-chart action
        if (action !== 'open-chart') {
            e.stopPropagation();
        }

        switch (action) {
            case 'open-chart':
                if (symbol) this.showChartModal(symbol);
                break;
            case 'pin':
                if (symbol) this.togglePin(symbol);
                break;
            case 'sync':
                if (symbol) this.syncStockData(symbol);
                break;
            case 'remove':
                if (symbol) this.removeStock(symbol);
                break;
        }
    }

    formatRelativeTime(ts) {
        const t = new Date(ts).getTime();
        if (isNaN(t)) return '—';
        const diff = (Date.now() - t) / 1000;
        if (diff < 60) return 'just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return `${Math.floor(diff / 86400)}d ago`;
    }

    renderAllSparklines() {
        document.querySelectorAll('.stock-card-sparkline').forEach(canvas => {
            const symbol = canvas.dataset.symbol;
            const stock = this.stocks.get(symbol);
            this.renderSparkline(canvas, stock);
        });
    }

    renderSparkline(canvas, stock) {
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(1, rect.width);
        const height = 56;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);

        const series = stock && Array.isArray(stock.dailyData) ? stock.dailyData : [];
        if (series.length < 2) {
            // Flat midline placeholder
            const styles = getComputedStyle(document.documentElement);
            ctx.strokeStyle = styles.getPropertyValue('--color-up').trim() || '#10b981';
            ctx.lineWidth = 1.5;
            ctx.globalAlpha = 0.3;
            ctx.beginPath();
            ctx.moveTo(0, height / 2);
            ctx.lineTo(width, height / 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
            return;
        }

        // dailyData is DESC; reverse to chronological for left-to-right plotting.
        const closes = series.slice().reverse().slice(-30).map(d => d.close);
        let lo = Infinity, hi = -Infinity;
        for (const c of closes) { if (c < lo) lo = c; if (c > hi) hi = c; }
        const range = hi - lo || 1;
        const padY = 4;
        const stepX = closes.length > 1 ? width / (closes.length - 1) : 0;

        const isUp = closes[closes.length - 1] >= closes[0];
        const styles = getComputedStyle(document.documentElement);
        const color = (isUp
            ? styles.getPropertyValue('--color-up').trim()
            : styles.getPropertyValue('--color-down').trim()) || (isUp ? '#10b981' : '#ef4444');

        // Filled area
        ctx.beginPath();
        ctx.moveTo(0, height - padY);
        closes.forEach((c, i) => {
            const x = i * stepX;
            const y = padY + (1 - (c - lo) / range) * (height - 2 * padY);
            ctx.lineTo(x, y);
        });
        ctx.lineTo((closes.length - 1) * stepX, height - padY);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.12;
        ctx.fill();
        ctx.globalAlpha = 1;

        // Stroke line
        ctx.beginPath();
        closes.forEach((c, i) => {
            const x = i * stepX;
            const y = padY + (1 - (c - lo) / range) * (height - 2 * padY);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.stroke();
    }

    async syncAllStocks() {
        const symbols = Array.from(this.stocks.keys());
        if (symbols.length === 0) {
            this.showError('No stocks to sync');
            return;
        }

        const btn = document.getElementById('syncAllBtn');
        if (btn) {
            btn.disabled = true;
            btn.classList.add('is-busy');
        }
        document.querySelectorAll('.js-sync-btn').forEach(b => b.disabled = true);

        this.showSuccess(`Syncing ${symbols.length} stocks...`);

        // Suppress per-call rerenders, run chunks of 3, collect outcomes.
        this.suppressCardRerender = true;
        const results = [];
        for (let i = 0; i < symbols.length; i += 3) {
            const chunk = symbols.slice(i, i + 3);
            const settled = await Promise.allSettled(chunk.map(s =>
                fetch(`/api/stocks/${s}/sync`, { method: 'POST' }).then(r => {
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    return r.json();
                })
            ));
            settled.forEach((res, idx) => {
                results.push({ symbol: chunk[idx], status: res.status, reason: res.reason });
            });
        }
        this.suppressCardRerender = false;

        // Clear chart cache wholesale — every stock may have changed
        this.chartCache.clear();

        // Single refresh
        await this.loadWatchedStocks();

        if (btn) {
            btn.disabled = false;
            btn.classList.remove('is-busy');
        }

        const ok = results.filter(r => r.status === 'fulfilled').length;
        const fail = results.length - ok;
        if (fail > 0) {
            this.showError(`Synced ${ok}, failed ${fail}`);
        } else {
            this.showSuccess(`Synced ${ok} stocks`);
        }
    }

    // Stock search methods. `source` is 'modal' or 'global'.
    async searchStocks(query, source = 'modal') {
        try {
            const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
            const data = await response.json();

            if (data.results && data.results.length > 0) {
                this.showSearchResults(data.results, source);
            } else {
                this.hideSearchResults(source);
            }
        } catch (error) {
            console.error('Failed to search stocks:', error);
            this.hideSearchResults(source);
        }
    }

    _searchTargetIds(source) {
        return source === 'global'
            ? { results: 'globalSearchResults', dataSource: 'global' }
            : { results: 'stockSearchResults', dataSource: 'modal' };
    }

    showSearchResults(results, source = 'modal') {
        const { results: resultsId, dataSource } = this._searchTargetIds(source);
        const resultsContainer = document.getElementById(resultsId);
        if (!resultsContainer) return;

        if (results.length === 0) {
            this.hideSearchResults(source);
            return;
        }

        const ctaText = source === 'global' ? '一键加入' : '点击选择';

        const resultsHTML = results.map(stock => `
            <div class="stock-search-result px-4 py-3 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer border-b border-gray-100 dark:border-gray-600 last:border-b-0"
                 data-symbol="${stock.symbol}"
                 data-name="${this._escape(stock.name)}"
                 data-source="${dataSource}">
                <div class="flex items-center justify-between gap-3">
                    <div class="flex-1 min-w-0">
                        <div class="font-semibold text-gray-900 dark:text-gray-100">
                            ${stock.symbol}
                        </div>
                        <div class="text-sm text-gray-600 dark:text-gray-400 truncate">
                            ${this._escape(stock.fullName || stock.name || '')}
                        </div>
                    </div>
                    <div class="text-xs text-blue-600 dark:text-blue-400 whitespace-nowrap">${ctaText}</div>
                </div>
            </div>
        `).join('');

        resultsContainer.innerHTML = resultsHTML;
        resultsContainer.classList.remove('hidden');

        // Bind click handlers (no inline onclick)
        resultsContainer.querySelectorAll('.stock-search-result').forEach(el => {
            el.addEventListener('click', () => {
                const symbol = el.dataset.symbol;
                const name = el.dataset.name;
                if (el.dataset.source === 'global') {
                    this.addStockDirect(symbol, name);
                } else {
                    this.selectStock(symbol, name);
                }
            });
        });
    }

    hideSearchResults(source = 'modal') {
        const { results: resultsId } = this._searchTargetIds(source);
        const resultsContainer = document.getElementById(resultsId);
        if (!resultsContainer) return;
        resultsContainer.classList.add('hidden');
        resultsContainer.innerHTML = '';
    }

    selectStock(symbol, name) {
        const symbolInput = document.getElementById('stockSymbol');
        const nameInput = document.getElementById('stockName');
        symbolInput.value = symbol;
        nameInput.value = name || '';
        this.hideSearchResults('modal');
        symbolInput.focus();
    }

    // Header search "一键加入": add to watchlist directly + auto-sync.
    async addStockDirect(symbol, name) {
        const sym = (symbol || '').toUpperCase().trim();
        if (!sym) return;
        try {
            const response = await fetch('/api/stocks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol: sym, name: name || '' }),
            });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to add stock');
            }
            this.showSuccess(`Added ${sym}, fetching data...`);

            // Reset header search
            const gi = document.getElementById('globalSearch');
            if (gi) gi.value = '';
            this.hideSearchResults('global');

            // Best-effort sync, then refresh
            try {
                await fetch(`/api/stocks/${sym}/sync`, { method: 'POST' });
            } catch (e) { /* non-fatal */ }
            await this.loadWatchedStocks();
        } catch (error) {
            this.showError(error.message);
        }
    }

    _escape(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // K-line Chart Modal Methods
    async showChartModal(symbol) {
        const modal = document.getElementById('chartModal');
        const chartTitle = document.getElementById('chartTitle');
        const chartSubtitle = document.getElementById('chartSubtitle');

        const stock = this.stocks.get(symbol);
        if (stock) {
            chartTitle.textContent = `${symbol} - ${stock.name || 'Stock Chart'}`;
            chartSubtitle.textContent = `Historical performance`;
        }

        this.currentChartSymbol = symbol;
        modal.classList.remove('hidden');

        // Setup event listeners for the modal first so button state is synced
        this.setupChartModalEventListeners(symbol);

        // Load initial chart data
        await this.loadChartData(symbol);
    }

    hideChartModal() {
        const modal = document.getElementById('chartModal');
        modal.classList.add('hidden');
        this.abortActiveChartRequest();
        this.setChartControlsDisabled(false);
        this.hideChartLoading();
        this.hideChartTooltip();
        this.currentChartSymbol = null;
    }

    setupChartModalEventListeners(symbol) {
        const periodGroup = document.getElementById('chartPeriodGroup');
        const refreshBtn = document.getElementById('refreshChart');

        // Sync active button styling with currentChartPeriod
        this.syncChartPeriodButtons();

        // Remove existing period click handler if present
        if (this.chartPeriodClickHandler && periodGroup) {
            periodGroup.removeEventListener('click', this.chartPeriodClickHandler);
        }

        if (periodGroup) {
            this.chartPeriodClickHandler = (e) => {
                const btn = e.target.closest('.chart-period-btn');
                if (!btn || btn.disabled) return;
                const period = parseInt(btn.dataset.period, 10);
                if (!period || period === this.currentChartPeriod) return;
                this.currentChartPeriod = period;
                this.syncChartPeriodButtons();
                this.loadChartData(symbol, { forceRefresh: true });
            };
            periodGroup.addEventListener('click', this.chartPeriodClickHandler);
        }

        // Replace refresh button to clear stale listeners
        refreshBtn.replaceWith(refreshBtn.cloneNode(true));
        const newRefreshBtn = document.getElementById('refreshChart');
        newRefreshBtn.addEventListener('click', () => {
            this.loadChartData(symbol, { forceRefresh: true });
        });

        // Close modal on backdrop click
        const modal = document.getElementById('chartModal');
        if (this.chartModalClickHandler) {
            modal.removeEventListener('click', this.chartModalClickHandler);
        }

        this.chartModalClickHandler = (e) => {
            if (e.target === modal) {
                this.hideChartModal();
            }
        };

        modal.addEventListener('click', this.chartModalClickHandler);

        // Bind hover tooltip on the canvas (idempotent via stored handlers).
        this.setupChartHover();
    }

    setupChartHover() {
        const canvas = document.getElementById('candlestickChart');
        if (!canvas) return;

        if (this.chartMouseMoveHandler) {
            canvas.removeEventListener('mousemove', this.chartMouseMoveHandler);
            canvas.removeEventListener('mouseleave', this.chartMouseLeaveHandler);
        }

        this.chartMouseMoveHandler = (e) => this.handleChartHover(e);
        this.chartMouseLeaveHandler = () => this.hideChartTooltip();

        canvas.addEventListener('mousemove', this.chartMouseMoveHandler);
        canvas.addEventListener('mouseleave', this.chartMouseLeaveHandler);
    }

    handleChartHover(e) {
        const layout = this._chartLayout;
        const tooltip = document.getElementById('chartTooltip');
        if (!layout || !tooltip) return;

        const canvas = document.getElementById('candlestickChart');
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Map mouse x to candle index using cached layout.
        const relX = mouseX - layout.padding.left;
        const index = Math.floor(relX / layout.candleSpacing);

        // Outside the plot region (margins, x-axis area) → hide.
        if (
            index < 0 || index >= layout.data.length ||
            mouseY < layout.padding.top ||
            mouseY > layout.padding.top + layout.chartHeight
        ) {
            this.hideChartTooltip();
            return;
        }

        const item = layout.data[index];
        this.showChartTooltip(tooltip, item, layout, mouseX, mouseY, rect);
    }

    showChartTooltip(tooltip, item, layout, mouseX, mouseY, canvasRect) {
        const isUp = item.close >= item.open;
        const trendClass = isUp ? 'up' : 'down';
        const timeLabel = this.formatTooltipTime(item.timestamp, layout.period);
        const change = item.close - item.open;
        const changePct = item.open > 0 ? (change / item.open) * 100 : 0;
        const sign = change >= 0 ? '+' : '';

        tooltip.innerHTML = `
            <div class="chart-tooltip-time">${timeLabel}</div>
            <div class="chart-tooltip-row"><span class="chart-tooltip-label">Open</span><span class="chart-tooltip-value">${this.formatPrice(item.open)}</span></div>
            <div class="chart-tooltip-row"><span class="chart-tooltip-label">High</span><span class="chart-tooltip-value">${this.formatPrice(item.high)}</span></div>
            <div class="chart-tooltip-row"><span class="chart-tooltip-label">Low</span><span class="chart-tooltip-value">${this.formatPrice(item.low)}</span></div>
            <div class="chart-tooltip-row"><span class="chart-tooltip-label">Close</span><span class="chart-tooltip-value ${trendClass}">${this.formatPrice(item.close)}</span></div>
            <div class="chart-tooltip-row"><span class="chart-tooltip-label">Change</span><span class="chart-tooltip-value ${trendClass}">${sign}${change.toFixed(2)} (${sign}${changePct.toFixed(2)}%)</span></div>
            <div class="chart-tooltip-row"><span class="chart-tooltip-label">Volume</span><span class="chart-tooltip-value">${this.formatVolume(item.volume)}</span></div>
        `;

        tooltip.classList.remove('hidden');

        // Position relative to .chart-canvas-container (the tooltip's offset parent).
        // Flip the tooltip to the left of the cursor when it would overflow the right edge.
        const tooltipWidth = tooltip.offsetWidth;
        const tooltipHeight = tooltip.offsetHeight;
        const offset = 14;
        let left = mouseX + offset;
        let top = mouseY + offset;
        if (left + tooltipWidth > canvasRect.width) {
            left = mouseX - tooltipWidth - offset;
        }
        if (top + tooltipHeight > canvasRect.height) {
            top = canvasRect.height - tooltipHeight - 4;
        }
        if (left < 0) left = 4;
        if (top < 0) top = 4;
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    }

    hideChartTooltip() {
        const tooltip = document.getElementById('chartTooltip');
        if (tooltip) tooltip.classList.add('hidden');
    }

    formatTooltipTime(timestamp, period) {
        const date = new Date(timestamp);
        const pad = (n) => String(n).padStart(2, '0');
        if (period <= 5) {
            // Intraday: full local datetime
            return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
        }
        return `${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())}`;
    }

    formatVolume(v) {
        if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
        if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
        if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
        return String(v);
    }

    syncChartPeriodButtons() {
        const buttons = document.querySelectorAll('#chartPeriodGroup .chart-period-btn');
        buttons.forEach(btn => {
            const period = parseInt(btn.dataset.period, 10);
            btn.classList.toggle('active', period === this.currentChartPeriod);
        });
    }

    async loadChartData(symbol, options = {}) {
        const { forceRefresh = false } = options;
        let requestToken = null;

        try {
            const period = this.currentChartPeriod;
            const cacheKey = `${symbol}-${period}`;
            const cachedSeries = this.chartCache.get(cacheKey);
            const shouldShowLoading = forceRefresh || !cachedSeries;

            if (shouldShowLoading) {
                this.showChartLoading();
            } else if (cachedSeries) {
                this.hideChartLoading();
                this.drawCandlestickChart(cachedSeries, symbol);
                this.updateChartStats(cachedSeries);
            }

            this.abortActiveChartRequest();

            const controller = new AbortController();
            requestToken = Symbol('chart-request');
            this.currentChartRequest = { controller, symbol, cacheKey, requestToken };
            this.setChartControlsDisabled(true);

            // Pick granularity by period:
            //   1D   → raw 1m intraday (~390 candles)
            //   5D   → 15m aggregated intraday (~130 candles, server-side bucketed)
            //   ≥30D → daily candles
            let url;
            if (period >= 30) {
                url = `/api/stocks/${symbol}/data?days=${period}&granularity=daily`;
            } else if (period === 5) {
                url = `/api/stocks/${symbol}/data?days=${period}&interval=15`;
            } else {
                url = `/api/stocks/${symbol}/data?days=${period}`;
            }
            const response = await fetch(url, {
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new Error('Failed to load chart data');
            }

            const data = await response.json();
            const series = data.data || [];

            if (!this.currentChartRequest || this.currentChartRequest.requestToken !== requestToken) {
                return;
            }

            if (series.length === 0) {
                this.chartCache.delete(cacheKey);
                this.showNoChartData();
                return;
            }

            this.chartCache.set(cacheKey, series);
            this.hideChartLoading();
            this.drawCandlestickChart(series, symbol);
            this.updateChartStats(series);
        } catch (error) {
            if (error.name === 'AbortError') {
                return;
            }
            console.error('Failed to load chart data:', error);
            this.showChartError('Failed to load chart data');
        } finally {
            if (
                requestToken &&
                this.currentChartRequest &&
                this.currentChartRequest.requestToken === requestToken
            ) {
                this.setChartControlsDisabled(false);
                this.hideChartLoading();
                this.currentChartRequest = null;
            }
        }
    }

    drawCandlestickChart(data, symbol) {
        const canvas = document.getElementById('candlestickChart');
        const ctx = canvas.getContext('2d');

        // Logical canvas height. Bumped from 400→440 to give the rotated date
        // labels at the bottom enough room — at 400 they were getting clipped
        // off the bottom edge.
        const canvasHeight = 440;

        // Force fill the parent. Without this, the canvas's `width="800"` HTML
        // attribute leaves it at 800 CSS-px wide inside a wider modal, with a
        // big gray strip on the right. CSS now declares width: 100%, but the
        // assignment here is defensive in case styles are reordered.
        canvas.style.width = '100%';
        canvas.style.height = `${canvasHeight}px`;

        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * window.devicePixelRatio;
        canvas.height = canvasHeight * window.devicePixelRatio;
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

        ctx.clearRect(0, 0, rect.width, canvasHeight);

        if (data.length === 0) {
            this._chartLayout = null;
            return;
        }

        const padding = { top: 20, right: 72, bottom: 64, left: 10 };
        const chartWidth = rect.width - padding.left - padding.right;
        const chartHeight = canvasHeight - padding.top - padding.bottom;

        // Calculate price range
        let minPrice = Infinity, maxPrice = -Infinity;
        data.forEach(item => {
            minPrice = Math.min(minPrice, item.low);
            maxPrice = Math.max(maxPrice, item.high);
        });

        // Add some padding to the price range
        const priceRange = maxPrice - minPrice;
        minPrice -= priceRange * 0.05;
        maxPrice += priceRange * 0.05;

        const candleWidth = Math.max(1, (chartWidth / data.length) * 0.6);
        const candleSpacing = (chartWidth / data.length);

        // Check for dark mode
        const isDarkMode = document.documentElement.classList.contains('dark');

        // Draw grid lines
        ctx.strokeStyle = isDarkMode ? '#374151' : '#e5e7eb';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);

        // Horizontal grid lines (price levels)
        for (let i = 0; i <= 5; i++) {
            const y = padding.top + (chartHeight / 5) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + chartWidth, y);
            ctx.stroke();

            // Price labels — left-aligned in the right margin so candles never
            // overlap them (previously textAlign='right' made labels extend
            // ~50px LEFT into the chart area, where the last candles sat on top).
            const price = maxPrice - ((maxPrice - minPrice) / 5) * i;
            ctx.fillStyle = isDarkMode ? '#9ca3af' : '#6b7280';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(this.formatPrice(price), padding.left + chartWidth + 6, y + 4);
        }

        ctx.setLineDash([]);

        // Draw candlesticks
        data.forEach((item, index) => {
            const x = padding.left + candleSpacing * index + candleSpacing / 2;
            const openY = padding.top + chartHeight * ((maxPrice - item.open) / (maxPrice - minPrice));
            const closeY = padding.top + chartHeight * ((maxPrice - item.close) / (maxPrice - minPrice));
            const highY = padding.top + chartHeight * ((maxPrice - item.high) / (maxPrice - minPrice));
            const lowY = padding.top + chartHeight * ((maxPrice - item.low) / (maxPrice - minPrice));

            const isRising = item.close >= item.open;

            // Draw high-low line
            ctx.strokeStyle = isRising ? '#10b981' : '#ef4444';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, highY);
            ctx.lineTo(x, lowY);
            ctx.stroke();

            // Draw candle body
            const bodyTop = Math.min(openY, closeY);
            const bodyHeight = Math.abs(closeY - openY);

            if (isRising) {
                // Rising candle - hollow
                ctx.strokeStyle = '#10b981';
                ctx.lineWidth = 2;
                ctx.strokeRect(x - candleWidth / 2, bodyTop, candleWidth, Math.max(1, bodyHeight));
            } else {
                // Falling candle - filled
                ctx.fillStyle = '#ef4444';
                ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, Math.max(1, bodyHeight));
            }

            // Draw date labels at a regular interval. We deliberately do NOT
            // force-label the very last candle — that used to crowd it right
            // up against the second-to-last regular label. Instead the last
                // few candles' info is reachable via the hover tooltip.
            const labelInterval = Math.max(1, Math.ceil(60 / candleSpacing));
            if (index % labelInterval === 0) {
                ctx.save();
                ctx.translate(x, padding.top + chartHeight + 15);
                ctx.rotate(-Math.PI / 4);
                ctx.fillStyle = isDarkMode ? '#9ca3af' : '#6b7280';
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'right';
                ctx.fillText(this.formatChartDate(item.timestamp, this.currentChartPeriod), 0, 0);
                ctx.restore();
            }
        });

        // Draw title
        ctx.fillStyle = isDarkMode ? '#f3f4f6' : '#111827';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`${symbol} - ${this.currentChartPeriod}D`, padding.left, padding.top - 5);

        // Cache layout for the hover tooltip: maps mouse x → candle index.
        this._chartLayout = {
            data,
            symbol,
            period: this.currentChartPeriod,
            padding,
            chartWidth,
            chartHeight,
            candleSpacing,
            canvasHeight,
        };
    }

    updateChartStats(data) {
        if (!data || data.length === 0) {
            this.resetChartStats();
            return;
        }

        const first = data[0];
        const last = data[data.length - 1];

        // Period change: first candle's open → last candle's close
        const change = last.close - first.open;
        const changePct = first.open > 0 ? (change / first.open) * 100 : 0;
        const isUp = change >= 0;
        const sign = isUp ? '+' : '';
        const trendClass = isUp ? 'chart-stat-up' : 'chart-stat-down';

        // Single pass for high / low / total volume
        let highBar = first;
        let lowBar = first;
        let totalVolume = 0;
        for (const d of data) {
            if (d.high > highBar.high) highBar = d;
            if (d.low < lowBar.low) lowBar = d;
            totalVolume += d.volume;
        }
        const avgVolume = totalVolume / data.length;

        const setStat = (id, text, cls) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.textContent = text;
            el.classList.remove('chart-stat-up', 'chart-stat-down');
            if (cls) el.classList.add(cls);
        };

        setStat('chartChangePct', `${sign}${changePct.toFixed(2)}%`, trendClass);
        setStat('chartChangeAbs', `${sign}${this.formatPrice(change)}`, trendClass);
        setStat('chartPeriodHigh', this.formatPrice(highBar.high));
        setStat('chartPeriodHighDate', this.formatChartDate(highBar.timestamp, this.currentChartPeriod));
        setStat('chartPeriodLow', this.formatPrice(lowBar.low));
        setStat('chartPeriodLowDate', this.formatChartDate(lowBar.timestamp, this.currentChartPeriod));
        setStat('chartAvgVolume', this.formatVolume(avgVolume));
    }

    resetChartStats() {
        const ids = [
            'chartChangePct', 'chartChangeAbs',
            'chartPeriodHigh', 'chartPeriodHighDate',
            'chartPeriodLow', 'chartPeriodLowDate',
            'chartAvgVolume',
        ];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.textContent = '-';
            el.classList.remove('chart-stat-up', 'chart-stat-down');
        });
    }

    showNoChartData() {
        this.hideChartLoading();
        const canvas = document.getElementById('candlestickChart');
        const ctx = canvas.getContext('2d');
        const rect = canvas.getBoundingClientRect();

        ctx.clearRect(0, 0, rect.width, 400);
        ctx.fillStyle = '#6b7280';
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No chart data available', rect.width / 2, 200);

        this.resetChartStats();
    }

    showChartError(message) {
        this.hideChartLoading();
        const canvas = document.getElementById('candlestickChart');
        const ctx = canvas.getContext('2d');
        const rect = canvas.getBoundingClientRect();

        ctx.clearRect(0, 0, rect.width, 400);
        ctx.fillStyle = '#ef4444';
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(message, rect.width / 2, 200);
    }

    showChartLoading() {
        const container = document.querySelector('.chart-canvas-container');
        const canvas = document.getElementById('candlestickChart');
        if (!container || !canvas) return;

        let loadingEl = container.querySelector('.chart-loading');
        if (!loadingEl) {
            loadingEl = document.createElement('div');
            loadingEl.className = 'chart-loading';
            loadingEl.innerHTML = '<div class="chart-loading-spinner"></div>';
            container.appendChild(loadingEl);
        }

        canvas.style.display = 'none';
        loadingEl.classList.remove('hidden');
    }

    hideChartLoading() {
        const container = document.querySelector('.chart-canvas-container');
        const canvas = document.getElementById('candlestickChart');
        if (canvas) {
            canvas.style.display = 'block';
        }
        if (!container) return;

        const loadingEl = container.querySelector('.chart-loading');
        if (loadingEl) {
            loadingEl.remove();
        }
    }

    setChartControlsDisabled(disabled) {
        const periodButtons = document.querySelectorAll('#chartPeriodGroup .chart-period-btn');
        const refreshBtn = document.getElementById('refreshChart');

        periodButtons.forEach((el) => {
            el.disabled = disabled;
            el.classList.toggle('opacity-50', disabled);
        });

        if (refreshBtn) {
            refreshBtn.disabled = disabled;
            refreshBtn.classList.toggle('opacity-50', disabled);
            refreshBtn.setAttribute('aria-busy', disabled);
        }
    }

    abortActiveChartRequest() {
        if (this.currentChartRequest?.controller) {
            this.currentChartRequest.controller.abort();
        }
        this.currentChartRequest = null;
    }

    formatChartDate(timestamp, period) {
        const date = new Date(timestamp);
        const pad = (n) => String(n).padStart(2, '0');

        // 1D: time only (HH:mm) in local time — all candles same day
        if (period <= 1) {
            return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
        }
        // 5D: short intraday — MM.DD HH:mm in local time
        if (period <= 5) {
            return `${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
        }
        // Daily candles: stored as midnight UTC of the ET trading day, so read
        // UTC components — otherwise China-local rendering shifts every label
        // back by one day.
        return `${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())}`;
    }

    // Pinning state lives on the server now (watched_stocks.pinned column).
    // These helpers read from the in-memory mirror populated by /api/stocks.
    getPinnedStocks() {
        return Array.from(this.stocks.values()).filter(s => s && s.pinned).map(s => s.symbol);
    }

    isPinned(symbol) {
        const s = this.stocks.get(symbol);
        return !!(s && s.pinned);
    }

    async togglePin(symbol) {
        const stock = this.stocks.get(symbol);
        if (!stock) return;
        const newPinned = !stock.pinned;
        // Optimistic update so the UI feels snappy; revert on failure.
        stock.pinned = newPinned;
        this.renderStocks();
        try {
            const r = await this._apiFetch(`/api/stocks/${encodeURIComponent(symbol)}/pin`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pinned: newPinned }),
            });
            if (!r.ok) throw new Error('failed');
            this.showSuccess(newPinned ? `Pinned ${symbol}` : `Unpinned ${symbol}`);
        } catch (e) {
            stock.pinned = !newPinned;
            this.renderStocks();
            this.showError(`Pin update failed for ${symbol}`);
        }
    }
}

// Initialize the application
let stockTracker;
document.addEventListener('DOMContentLoaded', () => {
    stockTracker = new StockTracker();
});

// Global functions for onclick handlers
window.showAddStockModal = () => stockTracker.showAddStockModal();
window.hideAddStockModal = () => stockTracker.hideAddStockModal();

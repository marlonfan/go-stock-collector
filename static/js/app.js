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
            const importedCount = await this._importLegacyLocalStocks();
            if (kind === 'register' && data.claimedStocks > 0) {
                this.showSuccess(`已继承 ${data.claimedStocks} 只股票`);
            }
            if (importedCount > 0) {
                this.showSuccess(`从本地导入 ${importedCount} 只股票,正在同步…`);
            }
            await this.loadWatchedStocks();
            // Kick off real data sync for the freshly-imported stocks; renderStocks
            // will re-fire as each completes.
            if (importedCount > 0) {
                this.syncAllStocks();
            }
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

    // Pre-auth, the watchlist actually lived in the server but pin state was
    // localStorage-only. Users who lost their server-side stocks (e.g. after
    // first-user inheritance migrated them to the original account) still
    // have the symbol list in localStorage.pinnedStocks. Treat that list as
    // a starter watchlist for the new account: add each as a watched stock
    // (POST /api/stocks), pin it, then clear the legacy key. Returns count
    // of stocks successfully added so the caller can decide whether to
    // trigger a sync afterwards. Idempotent and per-browser.
    async _importLegacyLocalStocks() {
        let legacy = null;
        try { legacy = localStorage.getItem('pinnedStocks'); } catch (e) { return 0; }
        if (!legacy) return 0;
        let symbols;
        try { symbols = JSON.parse(legacy); } catch (e) { symbols = null; }
        if (!Array.isArray(symbols) || symbols.length === 0) {
            try { localStorage.removeItem('pinnedStocks'); } catch (e) {}
            return 0;
        }

        let imported = 0;
        // Sequential to keep order and avoid hammering auth-protected endpoints.
        // Each request is fast (<100ms server-side) so total cost ≈ 0.1s × N.
        for (const sym of symbols) {
            const symStr = String(sym || '').toUpperCase().trim();
            if (!symStr) continue;
            try {
                const addResp = await fetch('/api/stocks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ symbol: symStr }),
                });
                // Backend's AddWatchedStock uses FirstOrCreate per (user_id, symbol),
                // so re-adding an existing symbol returns 200 too. Either way count.
                if (addResp.ok) {
                    imported++;
                    // Best-effort pin (don't block import on failure)
                    fetch(`/api/stocks/${encodeURIComponent(symStr)}/pin`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'same-origin',
                        body: JSON.stringify({ pinned: true }),
                    }).catch(() => null);
                }
            } catch (e) { /* ignore per-symbol failures */ }
        }
        try { localStorage.removeItem('pinnedStocks'); } catch (e) {}
        return imported;
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
                const mobileDetail = document.getElementById('mobileDetail');
                const chartModal = document.getElementById('chartModal');
                const addModal = document.getElementById('addStockModal');
                if (mobileDetail && !mobileDetail.classList.contains('hidden')) {
                    this.hideMobileDetail();
                    e.preventDefault();
                    return;
                }
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
        container.classList.remove('stocks-grid', 'stocks-list-wrap', 'stocks-history-wrap', 'stocks-mobile-list');
        const isMobile = window.innerWidth <= 640;

        if (this.viewMode === 'list') {
            if (isMobile) {
                container.classList.add('stocks-mobile-list');
                container.innerHTML = this.mobileListHTML(symbols, pinned);
            } else {
                container.classList.add('stocks-list-wrap');
                container.innerHTML = this.listHTML(symbols);
            }
        } else if (this.viewMode === 'grid') {
            container.classList.add('stocks-history-wrap');
            container.innerHTML = this.gridHTML(symbols);
        } else {
            container.classList.add('stocks-grid');
            container.innerHTML = isMobile
                ? this.mobileCardsHTML(symbols, pinned)
                : symbols.map(symbol => this.cardHTML(this.stocks.get(symbol))).join('');
        }

        // Defer sparkline render past the layout the browser is about to do.
        requestAnimationFrame(() => this.renderAllSparklines());
    }

    // Mobile cards view splits into PINNED / WATCHLIST sections so users can
    // visually scan their own picks before the rest. Both sections use the
    // same cardHTML so the visual treatment matches desktop, just denser.
    mobileCardsHTML(symbols, pinnedList) {
        const pinned = symbols.filter(s => pinnedList.includes(s));
        const others = symbols.filter(s => !pinnedList.includes(s));
        const renderSection = (title, sub, syms) => {
            if (syms.length === 0) return '';
            const cards = syms.map(s => this.cardHTML(this.stocks.get(s))).join('');
            return `
                <div class="mobile-section-header">
                    <span class="mobile-section-header-title">${title}</span>
                    <span class="mobile-section-header-sub">${sub}</span>
                </div>
                ${cards}
            `;
        };
        return `
            ${renderSection('📌 Pinned', `${pinned.length} stocks`, pinned)}
            ${renderSection('Watchlist', `${others.length} stocks`, others)}
        `;
    }

    // Mobile list — different layout than the desktop table. Each row is a
    // 2-line stack with symbol/name/vol on the left, sparkline+day-range in
    // the middle, price+pill on the right. Targets ~58px row height so a
    // phone fits 8-10 rows.
    mobileListHTML(symbols, pinnedList) {
        const stocks = symbols.map(s => this.stocks.get(s)).filter(Boolean);
        let upCount = 0, downCount = 0;
        for (const s of stocks) {
            if ((s.change || 0) >= 0) upCount++; else downCount++;
        }
        const total = stocks.length;
        const pinnedCount = pinnedList.length;

        const rows = symbols.map(sym => this.mobileRowHTML(this.stocks.get(sym))).join('');
        return `
            <div class="list-toolbar">
                <button type="button" class="list-toolbar-btn is-active">全部 ${total}</button>
                <button type="button" class="list-toolbar-btn">📌 ${pinnedCount}</button>
                <button type="button" class="list-toolbar-btn">↑ ${upCount}</button>
                <button type="button" class="list-toolbar-btn">↓ ${downCount}</button>
            </div>
            ${rows}
        `;
    }

    mobileRowHTML(stock) {
        if (!stock) return '';
        const symbol = stock.symbol;
        const isPinned = this.isPinned(symbol);
        const change = stock.change || 0;
        const changePct = stock.changePercent || 0;
        const last = stock.dailyData && stock.dailyData[0];
        const prev = this.prevCloseFor(stock);
        const dayRange = last
            ? this.dayRangeBarHTML(last.low, last.high, stock.currentPrice || last.close, prev)
            : '';
        return `
            <div class="mobile-stock-row${isPinned ? ' pinned' : ''}" data-symbol="${symbol}" data-action="open-chart">
                <div class="mobile-stock-row-left">
                    <div class="mobile-stock-row-symbol">${symbol}</div>
                    <div class="mobile-stock-row-name">${this._escape(stock.name || '')}</div>
                    <div class="mobile-stock-row-vol">V ${last ? this.formatVolume(last.volume) : '—'}</div>
                </div>
                <div class="mobile-stock-row-mid">
                    ${this.sparklineCanvasHTML(symbol, { days: 15, height: 22, fill: false })}
                    ${dayRange}
                </div>
                <div class="mobile-stock-row-right">
                    <div class="mobile-stock-row-price">${this.formatPrice(stock.currentPrice || 0)}</div>
                    ${this.trendPillHTML(changePct, { size: 'sm', strong: true })}
                </div>
            </div>
        `;
    }

    listHTML(symbols) {
        const stocks = symbols.map(s => this.stocks.get(s)).filter(Boolean);
        const total = stocks.length;
        let upCount = 0, downCount = 0;
        for (const s of stocks) {
            if ((s.change || 0) >= 0) upCount++; else downCount++;
        }

        // Last-sync from the most recently synced row (max lastSync)
        let mostRecent = null;
        for (const s of stocks) {
            const t = s.lastUpdate || s.lastSync;
            if (!t) continue;
            const tt = new Date(t).getTime();
            if (!mostRecent || tt > mostRecent) mostRecent = tt;
        }
        const subText = mostRecent
            ? `${total} 只 · 上次同步 ${this.formatRelativeTime(mostRecent)}`
            : `${total} 只 · 暂未同步`;

        const rows = symbols.map(s => this.rowHTML(this.stocks.get(s))).join('');
        return `
            <div class="stocks-list-toolbar">
                <div>
                    <div class="stocks-list-toolbar-title">我的关注 · ${total}</div>
                    <div class="stocks-list-toolbar-sub">${subText}</div>
                </div>
                <div class="stocks-list-toolbar-badges">
                    <span class="list-badge-up">↑ ${upCount}</span>
                    <span class="list-badge-down">↓ ${downCount}</span>
                </div>
            </div>
            <table class="stocks-list">
                <thead>
                    <tr>
                        <th class="pin-cell"></th>
                        <th class="col-symbol">Stock</th>
                        <th>Last</th>
                        <th>Chg %</th>
                        <th>Day Range</th>
                        <th>Open</th>
                        <th>High · Low</th>
                        <th class="col-vol">Vol / Avg</th>
                        <th>52W</th>
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
        const sign = isUp ? '+' : '';
        const last = stock.dailyData && stock.dailyData[0];
        const prevClose = this.prevCloseFor(stock);
        const r52 = this.range52WFor(stock);
        const avgVol = this.avgVolumeFor(stock, 30);
        const pinnedRowClass = isPinned ? 'pinned' : '';

        const dayRangeHTML = last
            ? this.dayRangeBarHTML(last.low, last.high, stock.currentPrice || last.close, prevClose, { label: true })
            : '<span class="text-gray-400">—</span>';
        const yearRangeHTML = r52
            ? this.yearRangeBarHTML(r52.low, r52.high, stock.currentPrice || (last ? last.close : 0))
            : '<span class="text-gray-400">—</span>';
        const volRatioHTML = last
            ? this.volumeRatioHTML(last.volume, avgVol || last.volume)
            : '<span class="text-gray-400">—</span>';

        return `
            <tr data-symbol="${symbol}" data-action="open-chart" class="${pinnedRowClass}">
                <td class="pin-cell">
                    <button type="button" class="pin-btn ${isPinned ? 'is-pinned' : ''}"
                        data-action="pin" data-symbol="${symbol}" title="${isPinned ? 'Unpin' : 'Pin'}">
                        <svg class="w-4 h-4" fill="${isPinned ? 'currentColor' : 'none'}" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 2l3.09 6.32L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.05L12 2z"></path>
                        </svg>
                    </button>
                </td>
                <td class="col-symbol">
                    <div class="row-symbol mono">${symbol}</div>
                    <div class="row-name">${this._escape(stock.name || '')}</div>
                </td>
                <td class="col-num-strong mono">
                    ${this.formatPrice(stock.currentPrice || 0)}
                    <div class="row-last-abs ${isUp ? 'up' : 'down'}">${sign}${change.toFixed(2)}</div>
                </td>
                <td>${this.heatCellHTML(changePct, `${sign}${changePct.toFixed(2)}%`)}</td>
                <td>${dayRangeHTML}</td>
                <td class="mono">${last ? this.formatPrice(last.open) : '—'}</td>
                <td>
                    <div class="high-low-stack">
                        <div class="hl-h">${last ? this.formatPrice(last.high) : '—'}</div>
                        <div class="hl-l">${last ? this.formatPrice(last.low) : '—'}</div>
                    </div>
                </td>
                <td class="col-vol">${volRatioHTML}</td>
                <td>${yearRangeHTML}</td>
                <td class="col-spark">
                    ${this.sparklineCanvasHTML(symbol, { days: 30, height: 36 })}
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

    // History grid: rows = stocks, columns = trading days. Cells are now
    // heatmap-tinted by daily change %. The sticky stock column carries a
    // mini 15-day sparkline + current price. Today's column header is
    // highlighted in blue.
    gridHTML(symbols) {
        const MAX_DATES = 30;

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
        const todayKey = sortedDates[0];

        const headerCells = sortedDates.map(d => {
            const cls = d === todayKey ? 'col-day-today' : '';
            const label = d === todayKey ? 'TODAY' : this._formatGridDate(d);
            return `<th class="${cls}">${label}</th>`;
        }).join('');

        const rows = symbols.filter(s => stockData.has(s)).map(sym => {
            const stock = stockData.get(sym);
            const isPinned = this.isPinned(sym);
            const dayMap = new Map();
            stock.dailyData.forEach(d => { if (d && d.date) dayMap.set(String(d.date).split('T')[0], d); });

            const change = stock.change || 0;
            const changePct = stock.changePercent || 0;
            const isUp = change >= 0;
            const sign = isUp ? '+' : '';

            const stockCell = `
                <td class="col-stock">
                    <div class="col-stock-flex">
                        <div class="col-stock-info">
                            <div class="stock-meta-symbol mono" data-action="open-chart" data-symbol="${sym}" title="Open chart">${sym}</div>
                            <div class="stock-meta-name">${this._escape(stock.name || '')}</div>
                            <div class="stock-meta-price mono ${isUp ? 'trend-up' : 'trend-down'}">
                                ${this.formatPrice(stock.currentPrice || 0)}
                                <span style="font-size:10px;opacity:.85;margin-left:4px;">${sign}${changePct.toFixed(2)}%</span>
                            </div>
                        </div>
                        <div class="col-stock-mini-spark">
                            ${this.sparklineCanvasHTML(sym, { days: 15, height: 24, fill: false, classExtra: 'mini-spark' })}
                        </div>
                    </div>
                </td>
            `;

            const dayCells = sortedDates.map((dateStr, idx) => {
                const day = dayMap.get(dateStr);
                if (!day) return '<td class="ohlc-empty">—</td>';

                // Daily change = THIS day's close vs PREVIOUS trading day's close.
                // This matches the card / list 'change %' metric (today's price
                // vs yesterday's close), so the most-recent grid column always
                // agrees with the per-stock summary in cards/list.
                // Falls back to intraday (open → close) only for the oldest
                // visible day where no previous-day row is in the window.
                let prevClose = null;
                if (idx < sortedDates.length - 1) {
                    const prevDay = dayMap.get(sortedDates[idx + 1]);
                    if (prevDay) prevClose = prevDay.close;
                }
                const dayChg = (prevClose != null && prevClose > 0)
                    ? ((day.close - prevClose) / prevClose) * 100
                    : ((day.close - day.open) / day.open) * 100;
                const dayUp = dayChg >= 0;
                const intensity = this.intensityFor(dayChg);
                const heatCls = dayUp ? 'ohlc-cell-heat-up' : 'ohlc-cell-heat-down';

                return `
                    <td class="${heatCls}" style="--intensity:${intensity.toFixed(3)}">
                        <div class="day-chg ${dayUp ? 'up' : 'down'}">${dayUp ? '+' : ''}${dayChg.toFixed(2)}%</div>
                        <div class="day-ohlc mono">
                            <div class="ohlc-row"><span class="lbl">O</span><span class="val">${this._formatCompact(day.open)}</span></div>
                            <div class="ohlc-row"><span class="lbl lbl-up">H</span><span class="val">${this._formatCompact(day.high)}</span></div>
                            <div class="ohlc-row"><span class="lbl lbl-down">L</span><span class="val">${this._formatCompact(day.low)}</span></div>
                            <div class="ohlc-row"><span class="lbl">C</span><span class="val ${dayUp ? 'up' : 'down'}">${this._formatCompact(day.close)}</span></div>
                        </div>
                    </td>
                `;
            }).join('');

            return `<tr data-symbol="${sym}" data-action="open-chart"${isPinned ? ' class="pinned"' : ''}>${stockCell}${dayCells}</tr>`;
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
        const sign = isUp ? '+' : '';
        const last = stock.dailyData && stock.dailyData[0];
        const r52 = this.range52WFor(stock);
        const closeTrend = last ? (last.close >= last.open ? 'up' : 'down') : '';
        const peText = (stock.peRatio != null) ? Number(stock.peRatio).toFixed(1) : '—';
        const mktCap = stock.marketCap || '—';

        const pinnedClass = isPinned ? ' pinned' : '';
        const pinBtnClass = isPinned ? 'is-pinned' : '';
        const pinTitle = isPinned ? 'Unpin' : 'Pin';

        return `
            <div class="stock-card${pinnedClass}" data-symbol="${symbol}" data-action="open-chart">
                <div class="stock-card-trend-stripe ${isUp ? 'up' : 'down'}"></div>
                <div class="stock-card-syncing-overlay"></div>
                <div class="stock-card-head">
                    <div style="min-width: 0;">
                        <div class="stock-card-symbol mono">${symbol}</div>
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
                <div class="stock-card-price-row">
                    <span class="stock-card-price mono">${this.formatPrice(stock.currentPrice || 0)}</span>
                    ${this.trendPillHTML(changePct, { size: 'md' })}
                    <span class="stock-card-abs ${isUp ? 'up' : 'down'}">${sign}${change.toFixed(2)}</span>
                </div>
                <div class="stock-card-ohlc">
                    <div class="stock-card-ohlc-cell">
                        <span class="stock-card-ohlc-label">O</span>
                        <span class="stock-card-ohlc-value">${last ? this.formatPrice(last.open) : '—'}</span>
                    </div>
                    <div class="stock-card-ohlc-cell">
                        <span class="stock-card-ohlc-label">H</span>
                        <span class="stock-card-ohlc-value up">${last ? this.formatPrice(last.high) : '—'}</span>
                    </div>
                    <div class="stock-card-ohlc-cell">
                        <span class="stock-card-ohlc-label">L</span>
                        <span class="stock-card-ohlc-value down">${last ? this.formatPrice(last.low) : '—'}</span>
                    </div>
                    <div class="stock-card-ohlc-cell">
                        <span class="stock-card-ohlc-label">V</span>
                        <span class="stock-card-ohlc-value">${last ? this.formatVolume(last.volume) : '—'}</span>
                    </div>
                </div>
                <div class="stock-card-sparkline-wrap">
                    ${this.sparklineCanvasHTML(symbol, { days: 30, height: 48 })}
                </div>
                <div class="stock-card-footer-grid">
                    <div class="stock-card-footer-left">
                        <span class="stock-card-footer-label">52W Range</span>
                        ${r52 ? this.yearRangeBarHTML(r52.low, r52.high, stock.currentPrice || 0) : '<span class="stock-card-footer-label">—</span>'}
                    </div>
                    <div class="stock-card-footer-right">
                        <div>市值 <span class="fund-value">${this._escape(mktCap)}</span></div>
                        <div>P/E <span class="fund-value">${peText}</span></div>
                    </div>
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
        // Customizable per-instance via data attributes set by the HTML builder.
        const days = parseInt(canvas.dataset.days, 10) || 30;
        const heightAttr = parseInt(canvas.dataset.height, 10);
        const fillMode = canvas.dataset.fill !== 'false';
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(1, rect.width);
        const height = heightAttr || 56;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.height = `${height}px`;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);

        const series = stock && Array.isArray(stock.dailyData) ? stock.dailyData : [];
        const styles = getComputedStyle(document.documentElement);
        if (series.length < 2) {
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

        // dailyData is DESC; reverse to chronological for left-to-right plot
        const closes = series.slice().reverse().slice(-days).map(d => d.close);
        let lo = Infinity, hi = -Infinity;
        for (const c of closes) { if (c < lo) lo = c; if (c > hi) hi = c; }
        const range = hi - lo || 1;
        const padY = 3;
        const stepX = closes.length > 1 ? width / (closes.length - 1) : 0;
        const isUp = closes[closes.length - 1] >= closes[0];
        const color = (isUp
            ? styles.getPropertyValue('--color-up').trim()
            : styles.getPropertyValue('--color-down').trim()) || (isUp ? '#10b981' : '#ef4444');

        const yFor = (c) => padY + (1 - (c - lo) / range) * (height - 2 * padY);

        // Filled area with vertical gradient (fades to transparent at the bottom)
        if (fillMode) {
            const grad = ctx.createLinearGradient(0, 0, 0, height);
            grad.addColorStop(0, color + '33');
            grad.addColorStop(1, color + '00');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.moveTo(0, height - padY);
            closes.forEach((c, i) => ctx.lineTo(i * stepX, yFor(c)));
            ctx.lineTo((closes.length - 1) * stepX, height - padY);
            ctx.closePath();
            ctx.fill();
        }

        // Stroke
        ctx.beginPath();
        closes.forEach((c, i) => {
            const x = i * stepX;
            const y = yFor(c);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();

        // Last-point dot — anchors the eye on the most recent value
        const lastX = (closes.length - 1) * stepX;
        const lastY = yFor(closes[closes.length - 1]);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(Math.max(2, lastX - 1), lastY, 2, 0, Math.PI * 2);
        ctx.fill();
    }

    // ---------- Stock-derived helpers ----------
    // dailyData is DESC (latest first). Use [0] for today, [1] for yesterday's close.

    prevCloseFor(stock) {
        const dd = stock && stock.dailyData;
        if (!dd || dd.length < 2) return null;
        return dd[1].close;
    }

    avgVolumeFor(stock, n = 30) {
        const dd = stock && stock.dailyData;
        if (!dd || dd.length === 0) return 0;
        const slice = dd.slice(0, n);
        let sum = 0;
        for (const d of slice) sum += d.volume || 0;
        return slice.length > 0 ? sum / slice.length : 0;
    }

    range52WFor(stock) {
        const dd = stock && stock.dailyData;
        if (!dd || dd.length === 0) return null;
        const slice = dd.slice(0, 252);
        let lo = Infinity, hi = -Infinity;
        for (const d of slice) {
            if (d.low < lo) lo = d.low;
            if (d.high > hi) hi = d.high;
        }
        if (!isFinite(lo) || !isFinite(hi)) return null;
        return { low: lo, high: hi };
    }

    amplitudeFor(stock) {
        const dd = stock && stock.dailyData;
        if (!dd || dd.length === 0) return null;
        const t = dd[0];
        const prev = this.prevCloseFor(stock);
        if (!prev || prev <= 0) return null;
        return ((t.high - t.low) / prev) * 100;
    }

    rangePct(low, current, high) {
        if (high <= low) return 0;
        return Math.max(0, Math.min(1, (current - low) / (high - low)));
    }

    intensityFor(pct) {
        return Math.min(Math.abs(pct) / 3, 1);
    }

    // ---------- Atomic HTML builders ----------

    sparklineCanvasHTML(symbol, opts = {}) {
        const { days = 30, height = 56, fill = true, classExtra = '' } = opts;
        return `<canvas class="stock-card-sparkline ${classExtra}" data-symbol="${symbol}" data-days="${days}" data-height="${height}" data-fill="${fill}"></canvas>`;
    }

    trendPillHTML(value, opts = {}) {
        const { isPercent = true, size = 'md', strong = false } = opts;
        const isUp = value >= 0;
        const sign = isUp ? '+' : '';
        const text = isPercent ? `${sign}${value.toFixed(2)}%` : `${sign}${value.toFixed(2)}`;
        const cls = `trend-pill mono size-${size} ${isUp ? 'up' : 'down'}${strong ? ' strong' : ''}`;
        return `<span class="${cls}">${text}</span>`;
    }

    heatCellHTML(value, content) {
        const isUp = value >= 0;
        const intensity = this.intensityFor(value);
        return `<span class="heat-cell mono ${isUp ? 'up' : 'down'}" style="--intensity:${intensity.toFixed(3)}">${content}</span>`;
    }

    dayRangeBarHTML(low, high, current, prevClose, opts = {}) {
        const { label = false } = opts;
        const pct = this.rangePct(low, current, high) * 100;
        const prevPct = (prevClose != null && high > low) ? this.rangePct(low, prevClose, high) * 100 : null;
        const labelHTML = label ? `
            <div class="day-range-bar-labels mono">
                <span>L ${this.formatPrice(low)}</span>
                <span>H ${this.formatPrice(high)}</span>
            </div>` : '';
        const prevHTML = prevPct != null
            ? `<div class="day-range-bar-prev" style="left:calc(${prevPct.toFixed(2)}% - 1px)" title="Prev close"></div>`
            : '';
        return `
            <div class="day-range-bar">
                ${labelHTML}
                <div class="day-range-bar-track">
                    <div class="day-range-bar-fill" style="width:${pct.toFixed(2)}%"></div>
                    ${prevHTML}
                    <div class="day-range-bar-current" style="left:calc(${pct.toFixed(2)}% - 4px)"></div>
                </div>
            </div>`;
    }

    yearRangeBarHTML(low, high, current) {
        const pct = this.rangePct(low, current, high) * 100;
        return `
            <div class="year-range-bar">
                <div class="year-range-bar-labels">
                    <span>${this.formatPrice(low)}</span>
                    <span class="label-mid">52W</span>
                    <span>${this.formatPrice(high)}</span>
                </div>
                <div class="year-range-bar-track">
                    <div class="year-range-bar-fill" style="width:${pct.toFixed(2)}%"></div>
                    <div class="year-range-bar-marker" style="left:calc(${pct.toFixed(2)}% - 1px)"></div>
                </div>
            </div>`;
    }

    volumeRatioHTML(volume, avg) {
        const ratio = avg > 0 ? volume / avg : 1;
        const pct = Math.min(ratio, 2) / 2 * 100;
        const cls = ratio >= 1.2 ? 'high' : (ratio < 0.8 ? 'low' : '');
        return `
            <div class="volume-ratio">
                <div class="volume-ratio-value">${this.formatVolume(volume)}</div>
                <div class="volume-ratio-track">
                    <div class="volume-ratio-fill ${cls}" style="width:${pct.toFixed(2)}%"></div>
                    <div class="volume-ratio-mid"></div>
                </div>
            </div>`;
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
        // On phones, route to the dedicated full-screen mobile detail page.
        // The drilldown layout (hero price + period tabs + cards) carries
        // more context than a cramped chart modal.
        if (window.innerWidth <= 640) {
            return this.showMobileDetail(symbol);
        }

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

    // ---------- Mobile detail (full-screen drilldown) ----------

    async showMobileDetail(symbol) {
        const overlay = document.getElementById('mobileDetail');
        if (!overlay) return;

        this.currentMobileSymbol = symbol;
        this.currentChartSymbol = symbol;
        const stock = this.stocks.get(symbol);

        // Header
        document.getElementById('mdSymbol').textContent = symbol;
        document.getElementById('mdName').textContent = (stock && stock.name) || '';
        const pinBtn = document.getElementById('mdPin');
        pinBtn.classList.toggle('is-pinned', this.isPinned(symbol));

        // Wire header actions (idempotent: replaceWith clones to clear stale handlers)
        this._rebindMd('mdBack', () => this.hideMobileDetail());
        this._rebindMd('mdSync', async () => {
            await this.syncStockData(symbol);
            // After sync, re-render with fresh data
            this.populateMobileDetail(symbol);
        });
        this._rebindMd('mdPin', () => {
            this.togglePin(symbol);
            const isPinned = this.isPinned(symbol);
            const newBtn = document.getElementById('mdPin');
            if (newBtn) newBtn.classList.toggle('is-pinned', isPinned);
        });

        // Period tabs — bind once via delegation
        const tabs = document.getElementById('mdPeriodTabs');
        if (tabs && !tabs._bound) {
            tabs.addEventListener('click', (e) => {
                const t = e.target.closest('.md-period-tab');
                if (!t) return;
                const period = parseInt(t.dataset.mdPeriod, 10);
                if (!period) return;
                tabs.querySelectorAll('.md-period-tab').forEach(b =>
                    b.classList.toggle('is-active', b === t));
                this.currentChartPeriod = period;
                this.loadChartData(this.currentMobileSymbol, { forceRefresh: false }).then(() => {
                    this.renderMdChart();
                });
            });
            tabs._bound = true;
        }

        overlay.classList.remove('hidden');

        // Initial population: text fields, then load chart
        this.populateMobileDetail(symbol);
        await this.loadChartData(symbol, { forceRefresh: false });
        this.renderMdChart();
    }

    _rebindMd(id, handler) {
        const el = document.getElementById(id);
        if (!el) return;
        const fresh = el.cloneNode(true);
        el.parentNode.replaceChild(fresh, el);
        fresh.addEventListener('click', handler);
    }

    populateMobileDetail(symbol) {
        const stock = this.stocks.get(symbol);
        if (!stock) return;
        const change = stock.change || 0;
        const changePct = stock.changePercent || 0;
        const isUp = change >= 0;
        const sign = isUp ? '+' : '';
        const last = stock.dailyData && stock.dailyData[0];
        const prev = this.prevCloseFor(stock);
        const r52 = this.range52WFor(stock);
        const avgVol = this.avgVolumeFor(stock, 30);

        document.getElementById('mdPrice').textContent = this.formatPrice(stock.currentPrice || 0);
        const ch = document.getElementById('mdChange');
        ch.textContent = `${sign}${change.toFixed(2)} (${sign}${changePct.toFixed(2)}%)`;
        ch.classList.remove('up', 'down');
        ch.classList.add(isUp ? 'up' : 'down');

        const lastUpdateEl = document.getElementById('mdLastUpdate');
        lastUpdateEl.textContent = stock.lastUpdate
            ? `· ${this.formatRelativeTime(stock.lastUpdate)}` : '';

        // OHLCV grid
        const ohlcGrid = document.getElementById('mdOhlc');
        const items = last ? [
            { l: '开盘', v: this.formatPrice(last.open) },
            { l: '收盘', v: this.formatPrice(last.close), c: last.close >= last.open ? 'up' : 'down' },
            { l: '最高', v: this.formatPrice(last.high), c: 'up' },
            { l: '最低', v: this.formatPrice(last.low), c: 'down' },
            { l: '成交量', v: this.formatVolume(last.volume) },
            { l: '振幅', v: this.amplitudeFor(stock) != null ? this.amplitudeFor(stock).toFixed(2) + '%' : '—' },
        ] : [];
        ohlcGrid.innerHTML = items.map(it => `
            <div class="md-ohlc-item">
                <span class="label">${it.l}</span>
                <span class="value ${it.c || ''}">${it.v}</span>
            </div>
        `).join('');

        // Day range under OHLCV
        document.getElementById('mdRangeText').textContent = last
            ? `${this.formatPrice(last.low)} – ${this.formatPrice(last.high)}` : '—';
        document.getElementById('mdDayRange').innerHTML = last
            ? this.dayRangeBarHTML(last.low, last.high, stock.currentPrice || last.close, prev)
            : '';

        // 52W bar
        document.getElementById('md52W').innerHTML = r52
            ? this.yearRangeBarHTML(r52.low, r52.high, stock.currentPrice || 0)
            : '<div class="md-card-title">52W 数据不足</div>';

        // Fundamentals (market cap / P/E / volume ratio)
        const peText = (stock.peRatio != null) ? Number(stock.peRatio).toFixed(1) : '—';
        const mktCap = stock.marketCap || '—';
        const ratio = (last && avgVol > 0) ? (last.volume / avgVol).toFixed(2) : '—';
        const fund = [
            { l: '市值', v: mktCap },
            { l: 'P/E', v: peText },
            { l: '量比', v: ratio },
        ];
        document.getElementById('mdFundamentals').innerHTML = fund.map(f => `
            <div class="md-fundamentals-cell">
                <div class="label">${f.l}</div>
                <div class="value">${this._escape(String(f.v))}</div>
            </div>
        `).join('');
    }

    // Mobile-detail candlestick render with price + date axes and a touch
    // tooltip. Layout is cached on this._mdLayout for the pointermove handler
    // to map x→candle without re-running layout math.
    renderMdChart() {
        const canvas = document.getElementById('mdChart');
        if (!canvas || !this._chartLayout) {
            this._mdChartPaintPlaceholder();
            this._mdLayout = null;
            return;
        }
        const data = this._chartLayout.data;
        const dpr = window.devicePixelRatio || 1;
        const wrap = canvas.parentElement;
        const fullWidth = wrap.clientWidth;
        const height = 220;
        canvas.width = fullWidth * dpr;
        canvas.height = height * dpr;
        canvas.style.width = '100%';
        canvas.style.height = `${height}px`;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, fullWidth, height);
        if (!data || data.length === 0) return;

        const isDark = document.documentElement.classList.contains('dark');
        // Reserve space for axes: right for Y price labels, bottom for dates.
        const padding = { top: 8, right: 52, bottom: 22, left: 6 };
        const chartWidth = fullWidth - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        let lo = Infinity, hi = -Infinity;
        for (const d of data) {
            if (d.low < lo) lo = d.low;
            if (d.high > hi) hi = d.high;
        }
        // 5% breathing room top/bottom so candles don't touch edges
        const span = hi - lo || 1;
        lo -= span * 0.04;
        hi += span * 0.04;
        const range = hi - lo;
        const stepX = chartWidth / data.length;
        const cw = Math.max(1.5, stepX * 0.6);
        const yFor = (v) => padding.top + ((hi - v) / range) * chartHeight;

        // Horizontal grid lines + Y-axis price labels
        ctx.strokeStyle = isDark ? '#334155' : '#e5e7eb';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.fillStyle = isDark ? '#94a3b8' : '#9ca3af';
        ctx.font = '10px -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        for (let i = 0; i <= 4; i++) {
            const y = padding.top + (chartHeight / 4) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + chartWidth, y);
            ctx.stroke();
            const price = hi - (range / 4) * i;
            ctx.fillText(this.formatPrice(price), padding.left + chartWidth + 6, y);
        }
        ctx.setLineDash([]);

        // X-axis date labels — minimum 70px between labels so YYYY.MM.DD
        // (about 56px wide at 10px) doesn't overlap. Daily formats are wider
        // than intraday HH:mm, so we err on the side of fewer labels.
        const minLabelGapPx = this.currentChartPeriod >= 30 ? 80 : 60;
        const labelInterval = Math.max(1, Math.ceil(minLabelGapPx / stepX));
        ctx.fillStyle = isDark ? '#94a3b8' : '#9ca3af';
        ctx.font = '10px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (let i = 0; i < data.length; i += labelInterval) {
            const x = padding.left + stepX * i + stepX / 2;
            ctx.fillText(
                this.formatChartDate(data[i].timestamp, this.currentChartPeriod),
                x, padding.top + chartHeight + 6
            );
        }

        // Candles
        data.forEach((bar, i) => {
            const x = padding.left + stepX * i + stepX / 2;
            const oY = yFor(bar.open);
            const cY = yFor(bar.close);
            const hY = yFor(bar.high);
            const lY = yFor(bar.low);
            const rising = bar.close >= bar.open;
            const color = rising ? '#10b981' : '#ef4444';
            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, hY);
            ctx.lineTo(x, lY);
            ctx.stroke();
            const top = Math.min(oY, cY);
            const ht = Math.max(1.5, Math.abs(cY - oY));
            if (rising) {
                ctx.lineWidth = 1.5;
                ctx.strokeRect(x - cw / 2, top, cw, ht);
            } else {
                ctx.fillRect(x - cw / 2, top, cw, ht);
            }
        });

        // Cache for tooltip
        this._mdLayout = {
            data, padding, chartWidth, chartHeight, stepX,
            canvasHeight: height, canvasWidth: fullWidth,
        };

        this._setupMdTooltip();
    }

    _setupMdTooltip() {
        const canvas = document.getElementById('mdChart');
        if (!canvas) return;
        if (this._mdHoverHandler) {
            canvas.removeEventListener('pointerdown', this._mdHoverHandler);
            canvas.removeEventListener('pointermove', this._mdHoverHandler);
            canvas.removeEventListener('pointerleave', this._mdLeaveHandler);
            canvas.removeEventListener('pointercancel', this._mdLeaveHandler);
        }
        this._mdHoverHandler = (e) => this._mdShowTooltipAt(e);
        // Mouse leaves the chart (desktop hover) → hide. Touch ends but
        // finger is still on canvas → keep visible (user is reading).
        this._mdLeaveHandler = (e) => {
            if (!e || e.pointerType === 'mouse') this._mdHideTooltip();
        };
        canvas.addEventListener('pointerdown', this._mdHoverHandler);
        canvas.addEventListener('pointermove', this._mdHoverHandler);
        canvas.addEventListener('pointerleave', this._mdLeaveHandler);
        canvas.addEventListener('pointercancel', this._mdLeaveHandler);
    }

    _mdShowTooltipAt(e) {
        const layout = this._mdLayout;
        const canvas = document.getElementById('mdChart');
        const strip = document.getElementById('mdTooltipStrip');
        const crosshair = document.getElementById('mdCrosshair');
        if (!layout || !canvas || !strip || !crosshair) return;
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Hide entirely if pointer is outside the canvas's horizontal range
        // (e.g. dragged into the right margin where price labels live).
        if (mouseX < layout.padding.left || mouseX > layout.padding.left + layout.chartWidth) {
            return;
        }

        // Crosshair always tracks the finger's actual x — not the snapped
        // candle center — so it feels smooth instead of jumping between
        // candles every few pixels.
        const wrapRect = canvas.parentElement.getBoundingClientRect();
        crosshair.style.left = `${mouseX}px`;
        crosshair.style.height = `${wrapRect.height - 56}px`;
        crosshair.classList.remove('hidden');

        // If finger drifts vertically off the plot area but stays within the
        // canvas, keep the crosshair on screen at its new x but don't
        // re-update the tooltip — keeps last-touched candle's data visible.
        if (
            mouseY < layout.padding.top ||
            mouseY > layout.padding.top + layout.chartHeight
        ) {
            return;
        }

        const relX = mouseX - layout.padding.left;
        const index = Math.max(0, Math.min(layout.data.length - 1, Math.floor(relX / layout.stepX)));
        const bar = layout.data[index];
        const isUp = bar.close >= bar.open;
        const trend = isUp ? 'up' : 'down';
        const change = bar.close - bar.open;
        const pct = bar.open > 0 ? (change / bar.open) * 100 : 0;
        const sign = change >= 0 ? '+' : '';

        // Two-row layout fits all 7 fields without horizontal scroll on
        // typical phone widths. Row 1: time + close + Δ%; Row 2: O/H/L/V.
        strip.innerHTML = `
            <div class="ts-line">
                <span class="ts-time">${this.formatTooltipTime(bar.timestamp, this.currentChartPeriod)}</span>
                <span class="ts-spacer"></span>
                <span class="ts-pair"><span class="ts-label">C</span><span class="ts-value ${trend}">${this.formatPrice(bar.close)}</span></span>
                <span class="ts-pair"><span class="ts-value ${trend}">${sign}${pct.toFixed(2)}%</span></span>
            </div>
            <div class="ts-line">
                <span class="ts-pair"><span class="ts-label">O</span><span class="ts-value">${this.formatPrice(bar.open)}</span></span>
                <span class="ts-pair"><span class="ts-label">H</span><span class="ts-value up">${this.formatPrice(bar.high)}</span></span>
                <span class="ts-pair"><span class="ts-label">L</span><span class="ts-value down">${this.formatPrice(bar.low)}</span></span>
                <span class="ts-pair"><span class="ts-label">V</span><span class="ts-value">${this.formatVolume(bar.volume)}</span></span>
            </div>
        `;
        strip.classList.remove('hidden');
    }

    _mdHideTooltip() {
        const strip = document.getElementById('mdTooltipStrip');
        const crosshair = document.getElementById('mdCrosshair');
        if (strip) strip.classList.add('hidden');
        if (crosshair) crosshair.classList.add('hidden');
    }

    _mdChartPaintPlaceholder() {
        const canvas = document.getElementById('mdChart');
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const width = canvas.parentElement.clientWidth;
        const height = 200;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = '100%';
        canvas.style.height = `${height}px`;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);
    }

    hideMobileDetail() {
        const overlay = document.getElementById('mobileDetail');
        if (overlay) overlay.classList.add('hidden');
        this.currentMobileSymbol = null;
        this.abortActiveChartRequest();
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

        // Logical canvas height. On phones drop to 300 so the modal still
        // leaves room for the period buttons + stats grid below the chart;
        // on desktop keep 440 so rotated date labels at the bottom don't clip.
        const canvasHeight = window.innerWidth <= 640 ? 300 : 440;

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

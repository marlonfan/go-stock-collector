// Stock Tracker Frontend Application
class StockTracker {
    constructor() {
        this.stocks = new Map();
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadWatchedStocks();
        this.setupDarkMode();
    }

    setupEventListeners() {
        // Add stock button
        document.getElementById('addStockBtn').addEventListener('click', () => {
            this.showAddStockModal();
        });

        // Add stock form
        document.getElementById('addStockForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addStock();
        });

        // Stock search autocomplete
        const stockSymbolInput = document.getElementById('stockSymbol');
        let searchTimeout;

        stockSymbolInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            const query = e.target.value.trim();

            if (query.length >= 1) {
                searchTimeout = setTimeout(() => {
                    this.searchStocks(query);
                }, 300);
            } else {
                this.hideSearchResults();
            }
        });

        // Hide search results when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#stockSymbol') && !e.target.closest('#stockSearchResults')) {
                this.hideSearchResults();
            }
        });

        // Close modal on backdrop click
        document.getElementById('addStockModal').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) {
                this.hideAddStockModal();
            }
        });
    }

    setupDarkMode() {
        // Check for dark mode preference
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.classList.add('dark');
        }

        // Listen for dark mode changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (e.matches) {
                document.documentElement.classList.add('dark');
            } else {
                document.documentElement.classList.remove('dark');
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

            // Create horizontal grid view
            this.createHorizontalGridView();
            console.log('✨ Grid view created successfully');

            // Hide loading state and show the grid
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

            // Refresh view
            if (this.stocks.size === 0) {
                this.showEmptyState();
            } else {
                this.createHorizontalGridView();
            }
        } catch (error) {
            console.error('Failed to remove stock:', error);
            this.showError('Failed to remove stock');
        }
    }

    async syncStockData(symbol) {
        // Find sync button in table
        const syncBtns = document.querySelectorAll(`[onclick*="${symbol}"]`);
        let syncBtn = null;
        syncBtns.forEach(btn => {
            if (btn.onclick && btn.onclick.toString().includes('syncStockData')) {
                syncBtn = btn;
            }
        });

        if (!syncBtn) return;

        const originalContent = syncBtn.innerHTML;

        // Show loading state
        syncBtn.disabled = true;
        syncBtn.innerHTML = '<div class="animate-spin rounded-full h-4 w-4 border border-blue-600 border-t-transparent"></div>';

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

            // Reload stock data and refresh view
            await this.loadStockData(symbol);
            this.createHorizontalGridView();
        } catch (error) {
            console.error('Failed to sync stock:', error);
            this.showError(error.message);
        } finally {
            // Restore button
            syncBtn.disabled = false;
            syncBtn.innerHTML = originalContent;
        }
    }

    async loadStockData(symbol) {
        try {
            const response = await fetch(`/api/stocks/${symbol}/summary`);
            const data = await response.json();

            this.stocks.set(symbol, data);
            this.createOrUpdateStockCard(data);
        } catch (error) {
            console.error(`Failed to load data for ${symbol}:`, error);
            this.showError(`Failed to load data for ${symbol}`);
        }
    }

    createOrUpdateStockCard(data) {
        // Store stock data, will be used in createHorizontalGridView
        this.stocks.set(data.symbol, data);
    }

    createStockCard(data) {
        const card = document.createElement('div');
        card.className = 'stock-card';
        card.dataset.stock = data.symbol;
        card.innerHTML = this.getStockCardHTML(data);
        return card;
    }

    updateStockCard(card, data) {
        // Update price and change
        const priceElement = card.querySelector('.current-price');
        const changeElement = card.querySelector('.price-change');
        const lastUpdateElement = card.querySelector('.last-update');

        priceElement.textContent = this.formatPrice(data.currentPrice);

        if (data.change !== undefined) {
            const isPositive = data.change >= 0;
            changeElement.className = `price-change ${isPositive ? 'positive' : 'negative'}`;
            changeElement.innerHTML = this.formatPriceChange(data.change, data.changePercent);
        }

        if (data.lastUpdate) {
            lastUpdateElement.textContent = `Last updated: ${this.formatDateTime(data.lastUpdate)}`;
        }

        // Update data table
        this.updateDataTable(card, data.dailyData);
    }

    getStockCardHTML(data) {
        const isPositive = data.change >= 0;
        const changeClass = isPositive ? 'positive' : 'negative';
        const changeHTML = this.formatPriceChange(data.change, data.changePercent);

        return `
            <div class="stock-header">
                <div class="stock-info">
                    <div class="stock-title">
                        <span class="stock-symbol">${data.symbol}</span>
                        ${data.name ? `<span class="stock-name">${data.name}</span>` : ''}
                    </div>
                </div>
                <div class="stock-price-info">
                    <div class="current-price">${this.formatPrice(data.currentPrice)}</div>
                    <div class="price-change ${changeClass}">${changeHTML}</div>
                    ${data.lastUpdate ? `<div class="last-update text-xs text-gray-500 mt-1">Last updated: ${this.formatDateTime(data.lastUpdate)}</div>` : ''}
                </div>
                <div class="stock-actions mt-4">
                    <button class="action-btn toggle-btn" onclick="stockTracker.toggleDataTable('${data.symbol}')">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
                        </svg>
                        <span id="toggle-text-${data.symbol}">Show Data</span>
                    </button>
                    <button class="action-btn sync-btn" onclick="stockTracker.syncStockData('${data.symbol}')">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                        </svg>
                        Sync Data
                    </button>
                    <button class="action-btn remove-btn" onclick="stockTracker.removeStock('${data.symbol}')">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                        Remove
                    </button>
                </div>
            </div>
            <div class="data-content" id="data-${data.symbol}">
                <div class="data-table-container">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Open</th>
                                <th>High</th>
                                <th>Low</th>
                                <th>Close</th>
                                <th>Change</th>
                                <th>Volume</th>
                            </tr>
                        </thead>
                        <tbody id="table-body-${data.symbol}">
                            ${this.generateTableRows(data.dailyData)}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    generateTableRows(dailyData) {
        if (!dailyData || dailyData.length === 0) {
            return '<tr><td colspan="7" class="text-center py-8 text-gray-500">No data available</td></tr>';
        }

        return dailyData.map((day, index) => {
            const change = day.close - day.open;
            const changePercent = day.open > 0 ? (change / day.open) * 100 : 0;
            const changeClass = change >= 0 ? 'positive-change' : 'negative-change';

            return `
                <tr>
                    <td>${this.formatDate(day.date)}</td>
                    <td class="price-col">${this.formatPrice(day.open)}</td>
                    <td class="price-col">${this.formatPrice(day.high)}</td>
                    <td class="price-col">${this.formatPrice(day.low)}</td>
                    <td class="price-col">${this.formatPrice(day.close)}</td>
                    <td class="change-col ${changeClass}">
                        ${this.formatPriceChange(change, changePercent)}
                    </td>
                    <td>${this.formatVolume(day.volume)}</td>
                </tr>
            `;
        }).join('');
    }

    updateDataTable(card, dailyData) {
        const tbody = card.querySelector(`#table-body-${card.dataset.stock}`);
        if (tbody) {
            tbody.innerHTML = this.generateTableRows(dailyData);
        }
    }

    removeStockCard(symbol) {
        const card = document.querySelector(`[data-stock="${symbol}"]`);
        if (card) {
            card.style.opacity = '0';
            card.style.transform = 'translateX(-20px)';
            setTimeout(() => card.remove(), 300);
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

    toggleDataTable(symbol) {
        const dataContent = document.getElementById(`data-${symbol}`);
        const toggleText = document.getElementById(`toggle-text-${symbol}`);

        if (dataContent.classList.contains('expanded')) {
            dataContent.classList.remove('expanded');
            toggleText.textContent = 'Show Data';
        } else {
            dataContent.classList.add('expanded');
            toggleText.textContent = 'Hide Data';
        }
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

    createHorizontalGridView() {
        console.log('🎯 Creating horizontal grid view...');
        const container = document.getElementById('stocksContainer');
        container.innerHTML = '';

        console.log('📊 Stocks in memory:', this.stocks.size);
        if (this.stocks.size === 0) {
            console.log('⚠️ No stocks in memory, returning');
            return;
        }

        // Get all unique dates from all stocks, sorted by date
        const allDates = new Set();
        const stockDataMap = new Map();

        console.log('🔍 Processing stock data...');
        for (const [symbol, data] of this.stocks) {
            console.log(`📈 Processing ${symbol}:`, data);
            if (data.dailyData && data.dailyData.length > 0) {
                stockDataMap.set(symbol, data);
                console.log(`✅ ${symbol} has ${data.dailyData.length} daily data points`);
                data.dailyData.forEach(day => {
                    allDates.add(day.date.split('T')[0]);
                });
            } else {
                console.log(`⚠️ ${symbol} has no daily data`);
            }
        }

        const sortedDates = Array.from(allDates).sort().reverse(); // Most recent first
        const stockSymbols = Array.from(stockDataMap.keys());

        if (sortedDates.length === 0) {
            container.innerHTML = '<div class="text-center text-gray-500 py-8">No daily data available</div>';
            return;
        }

        // Create horizontal grid table
        const gridHTML = `
            <div class="overflow-x-auto bg-white dark:bg-gray-800 rounded-2xl shadow-lg">
                <table class="w-full border-collapse">
                    <thead>
                        <tr class="border-b border-gray-200 dark:border-gray-700">
                            <th class="sticky left-0 bg-white dark:bg-gray-800 p-4 text-left font-semibold text-gray-900 dark:text-gray-100 border-r border-gray-200 dark:border-gray-700">
                                Stock
                            </th>
                            ${sortedDates.map(date => `
                                <th class="p-3 text-center min-w-[140px] font-medium text-gray-700 dark:text-gray-300 text-xs whitespace-nowrap">
                                    <div>${this.formatDateHeader(date)}</div>
                                </th>
                            `).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${stockSymbols.map(symbol => {
                            const stock = stockDataMap.get(symbol);
                            const dailyDataMap = new Map();
                            stock.dailyData.forEach(day => {
                                dailyDataMap.set(day.date.split('T')[0], day);
                            });

                            return `
                                <tr class="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                                    <td class="sticky left-0 bg-white dark:bg-gray-800 p-4 border-r border-gray-200 dark:border-gray-700">
                                        <div class="flex items-center justify-between">
                                            <div>
                                                <div class="font-semibold text-gray-900 dark:text-gray-100">${symbol}</div>
                                                <div class="text-xs text-gray-500 dark:text-gray-400">${stock.name || ''}</div>
                                                <div class="text-sm font-medium mt-1 ${stock.change >= 0 ? 'text-red-600' : 'text-green-600'}">
                                                    ${this.formatPrice(stock.currentPrice)}
                                                    <span class="text-xs ml-1">
                                                        ${stock.change >= 0 ? '+' : ''}${stock.changePercent?.toFixed(2)}%
                                                    </span>
                                                </div>
                                            </div>
                                            <div class="flex space-x-1">
                                                <button onclick="stockTracker.syncStockData('${symbol}')"
                                                    class="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                                                    title="Sync Data">
                                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                                                    </svg>
                                                </button>
                                                <button onclick="stockTracker.removeStock('${symbol}')"
                                                    class="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                                                    title="Remove Stock">
                                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>
                                    </td>
                                    ${sortedDates.map((date, dateIndex) => {
                                        const dayData = dailyDataMap.get(date);
                                        if (dayData) {
                                            // Get previous day's close for comparison
                                            let prevClose = null;
                                            if (dateIndex < sortedDates.length - 1) {
                                                const prevDate = sortedDates[dateIndex + 1];
                                                const prevDayData = dailyDataMap.get(prevDate);
                                                if (prevDayData) {
                                                    prevClose = prevDayData.close;
                                                }
                                            }

                                            // Determine open color: red if higher than prev close, green if lower
                                            let openColorClass = '';
                                            if (prevClose !== null) {
                                                openColorClass = dayData.open >= prevClose ? 'text-red-600' : 'text-green-600';
                                            }

                                            return `
                                                <td class="p-2 text-center">
                                                    <div class="ohlc-cell">
                                                        <div class="ohlc-open ${openColorClass}">O ${this.formatCompactPrice(dayData.open)}</div>
                                                        <div class="ohlc-high">H ${this.formatCompactPrice(dayData.high)}</div>
                                                        <div class="ohlc-low">L ${this.formatCompactPrice(dayData.low)}</div>
                                                        <div class="ohlc-close ${dayData.close >= dayData.open ? 'text-red-600' : 'text-green-600'}">
                                                            C ${this.formatCompactPrice(dayData.close)}
                                                        </div>
                                                        <div class="ohlc-volume text-xs text-gray-500">
                                                            ${this.formatCompactVolume(dayData.volume)}
                                                        </div>
                                                    </div>
                                                </td>
                                            `;
                                        } else {
                                            return `<td class="p-2 text-center text-gray-400">—</td>`;
                                        }
                                    }).join('')}
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = gridHTML;
    }

    formatDateHeader(dateStr) {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
        });
    }

    formatCompactPrice(price) {
        if (price >= 1000) {
            return `${(price / 1000).toFixed(1)}k`;
        }
        return price.toFixed(price < 10 ? 3 : 2);
    }

    formatCompactVolume(volume) {
        if (volume >= 1000000) {
            return `${(volume / 1000000).toFixed(1)}M`;
        } else if (volume >= 1000) {
            return `${(volume / 1000).toFixed(1)}K`;
        }
        return volume.toString();
    }

    // Stock search methods
    async searchStocks(query) {
        try {
            console.log('🔍 Searching stocks for:', query);
            const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
            const data = await response.json();

            if (data.results && data.results.length > 0) {
                this.showSearchResults(data.results);
            } else {
                this.hideSearchResults();
            }
        } catch (error) {
            console.error('❌ Failed to search stocks:', error);
            this.hideSearchResults();
        }
    }

    showSearchResults(results) {
        const resultsContainer = document.getElementById('stockSearchResults');

        if (results.length === 0) {
            this.hideSearchResults();
            return;
        }

        const resultsHTML = results.map(stock => `
            <div class="stock-search-result px-4 py-3 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer border-b border-gray-100 dark:border-gray-600 last:border-b-0"
                 data-symbol="${stock.symbol}"
                 data-name="${stock.name}"
                 onclick="stockTracker.selectStock('${stock.symbol}', '${stock.name}')">
                <div class="flex items-center justify-between">
                    <div class="flex-1">
                        <div class="font-semibold text-gray-900 dark:text-gray-100">
                            ${stock.symbol}
                        </div>
                        <div class="text-sm text-gray-600 dark:text-gray-400">
                            ${stock.fullName}
                        </div>
                    </div>
                    <div class="text-xs text-blue-600 dark:text-blue-400">
                        点击选择
                    </div>
                </div>
            </div>
        `).join('');

        resultsContainer.innerHTML = resultsHTML;
        resultsContainer.classList.remove('hidden');
    }

    hideSearchResults() {
        const resultsContainer = document.getElementById('stockSearchResults');
        resultsContainer.classList.add('hidden');
        resultsContainer.innerHTML = '';
    }

    selectStock(symbol, name) {
        const symbolInput = document.getElementById('stockSymbol');
        const nameInput = document.getElementById('stockName');

        symbolInput.value = symbol;
        nameInput.value = name;

        this.hideSearchResults();
        symbolInput.focus();
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
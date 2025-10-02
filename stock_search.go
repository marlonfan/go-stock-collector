package main

import (
	"encoding/csv"
	"fmt"
	"io"
	"os"
	"strings"
	"unicode"
)

type StockSearchService struct {
	stocks []StockInfo
}

type StockInfo struct {
	Symbol     string
	Name       string
	ChineseName string
	SearchText string // 用于搜索的组合文本
}

func NewStockSearchService() (*StockSearchService, error) {
	service := &StockSearchService{}
	err := service.loadStockData()
	if err != nil {
		return nil, err
	}
	return service, nil
}

func (s *StockSearchService) loadStockData() error {
	file, err := os.Open("stocks.csv")
	if err != nil {
		return fmt.Errorf("failed to open stocks.csv: %v", err)
	}
	defer file.Close()

	reader := csv.NewReader(file)
	var stocks []StockInfo

	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("failed to read CSV record: %v", err)
		}

		if len(record) >= 4 {
			symbol := strings.TrimSpace(record[0])
			name := strings.TrimSpace(record[1])
			chineseName := strings.TrimSpace(record[2])
			code := strings.TrimSpace(record[3])

			// 构建搜索文本，包含所有可能的搜索项
			searchText := fmt.Sprintf("%s %s %s %s",
				strings.ToLower(symbol),
				strings.ToLower(name),
				strings.ToLower(chineseName),
				strings.ToLower(code))

			// 添加拼音搜索支持（简单版本）
			pinyinText := s.generatePinyinSearchText(chineseName, name, symbol)
			searchText += " " + pinyinText

			stock := StockInfo{
				Symbol:     symbol,
				Name:       name,
				ChineseName: chineseName,
				SearchText: searchText,
			}
			stocks = append(stocks, stock)
		}
	}

	s.stocks = stocks
	return nil
}

// 生成拼音搜索文本（简化版本）
func (s *StockSearchService) generatePinyinSearchText(chineseName, name, symbol string) string {
	var pinyin []string

	// 添加英文名称的拼音化（首字母）
	for _, word := range strings.Fields(name) {
		if len(word) > 0 {
			pinyin = append(pinyin, strings.ToLower(string(word[0])))
		}
	}

	// 添加股票代码搜索
	pinyin = append(pinyin, strings.ToLower(symbol))

	// 常见中文词汇的拼音映射
	chineseToPinyin := map[string][]string{
		"苹果": {"pingguo", "apple", "pg"},
		"微软": {"weiruan", "microsoft", "wr", "ms"},
		"谷歌": {"google", "gg", "guge"},
		"亚马逊": {"amazon", "yamaxun", "amz"},
		"特斯拉": {"tesla", "tsla", "tesi"},
		"Meta": {"meta", "facebook", "fb"},
		"英伟达": {"nvidia", "yingweida", "nvda"},
		"奈飞": {"netflix", "naifei", "nfx"},
		"迪士尼": {"disney", "dishini", "dis"},
		"耐克": {"nike", "naike", "nk"},
		"可口可乐": {"coca-cola", "kekoukele", "ko"},
		"百事": {"pepsi", "baishi", "pep"},
		"麦当劳": {"mcdonalds", "maidanglao", "mcd"},
	}

	for chinese, pinyins := range chineseToPinyin {
		if strings.Contains(chineseName, chinese) {
			pinyin = append(pinyin, pinyins...)
		}
	}

	return strings.Join(pinyin, " ")
}

func (s *StockSearchService) Search(query string, limit int) []StockSearchResult {
	if query == "" {
		return []StockSearchResult{}
	}

	query = strings.ToLower(strings.TrimSpace(query))
	var results []StockSearchResult

	for _, stock := range s.stocks {
		if s.matchesQuery(stock, query) {
			result := StockSearchResult{
				Symbol:      stock.Symbol,
				Name:        stock.Name,
				ChineseName: stock.ChineseName,
				FullName:    fmt.Sprintf("%s (%s)", stock.Name, stock.ChineseName),
			}
			results = append(results, result)

			if len(results) >= limit {
				break
			}
		}
	}

	return results
}

func (s *StockSearchService) matchesQuery(stock StockInfo, query string) bool {
	// 完全匹配
	if strings.Contains(stock.SearchText, query) {
		return true
	}

	// 前缀匹配
	if strings.HasPrefix(stock.SearchText, query) {
		return true
	}

	// 模糊匹配（如果查询长度至少为2）
	if len(query) >= 2 {
		// 检查是否是拼音首字母匹配
		queryRunes := []rune(query)
		stockRunes := []rune(stock.SearchText)

		// 拼音首字母匹配
		if s.matchesPinyinInitials(stockRunes, queryRunes) {
			return true
		}

		// 包含匹配
		for i := 0; i <= len(stockRunes)-len(queryRunes); i++ {
			match := true
			for j := 0; j < len(queryRunes); j++ {
				if stockRunes[i+j] != queryRunes[j] {
					match = false
					break
				}
			}
			if match {
				return true
			}
		}
	}

	return false
}

// 拼音首字母匹配
func (s *StockSearchService) matchesPinyinInitials(text, query []rune) bool {
	if len(query) == 0 {
		return false
	}

	textStr := string(text)
	queryStr := string(query)

	// 简单的首字母匹配逻辑
	words := strings.Fields(textStr)
	var initials []rune

	for _, word := range words {
		runes := []rune(word)
		if len(runes) > 0 {
			initials = append(initials, unicode.ToLower(runes[0]))
		}
	}

	initialsStr := string(initials)
	return strings.Contains(initialsStr, queryStr)
}
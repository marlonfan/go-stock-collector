package main

import (
	"crypto/rand"
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"os"
	"strings"

	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

const sessionName = "session"
const sessionUserKey = "userID"
const sessionMaxAgeSec = 60 * 60 * 24 * 30 // 30 days

// loadSessionSecret resolves the cookie-signing secret. Order: SESSION_SECRET
// env var > ./session.key file > newly-generated 32-byte key persisted to
// ./session.key (mode 0600). Persisting means restart doesn't invalidate
// outstanding sessions, which would otherwise log everyone out on each redeploy.
func loadSessionSecret() ([]byte, error) {
	if s := os.Getenv("SESSION_SECRET"); s != "" {
		return []byte(s), nil
	}
	const path = "./session.key"
	if b, err := os.ReadFile(path); err == nil && len(b) >= 16 {
		return b, nil
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return nil, fmt.Errorf("rand: %v", err)
	}
	if err := os.WriteFile(path, b, 0600); err != nil {
		return nil, fmt.Errorf("persist session key: %v", err)
	}
	return b, nil
}

// sessionStore builds the gin-contrib/sessions store with sane cookie defaults.
func sessionStore(secret []byte) cookie.Store {
	store := cookie.NewStore(secret)
	store.Options(sessions.Options{
		Path:     "/",
		MaxAge:   sessionMaxAgeSec,
		HttpOnly: true,
		// SameSite=Lax is right for a same-origin app; cross-site form posts
		// (e.g. login from a phishing site) won't auto-attach the cookie.
	})
	return store
}

// authMiddleware blocks API access without a valid session and stashes the
// user ID under "userID" for downstream handlers.
func authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		sess := sessions.Default(c)
		raw := sess.Get(sessionUserKey)
		if raw == nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		uid, ok := raw.(uint)
		if !ok {
			// gob may decode older sessions as a different type; reject so the
			// client re-authenticates instead of silently impersonating user 0.
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		c.Set("userID", uid)
		c.Next()
	}
}

// register/login request/response shapes
type registerReq struct {
	Email      string `json:"email" binding:"required"`
	Password   string `json:"password" binding:"required"`
	InviteCode string `json:"inviteCode" binding:"required"`
}

type loginReq struct {
	Email    string `json:"email" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type meResp struct {
	ID    uint   `json:"id"`
	Email string `json:"email"`
}

type onboardingResp struct {
	HasAnyUser            bool  `json:"hasAnyUser"`
	UnclaimedStockCount   int64 `json:"unclaimedStockCount"`
}

func (ws *WebServer) handleRegister(c *gin.Context) {
	var req registerReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing fields"})
		return
	}
	if strings.TrimSpace(req.InviteCode) != ws.inviteCode {
		c.JSON(http.StatusForbidden, gin.H{"error": "invalid invite code"})
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if _, err := mail.ParseAddress(email); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid email"})
		return
	}
	if len(req.Password) < 6 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "password must be at least 6 characters"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "hash failure"})
		return
	}

	user := User{Email: email, PasswordHash: string(hash)}
	var claimedCount int64

	err = ws.collector.database.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&user).Error; err != nil {
			// SQLite unique constraint violation surfaces as a generic error;
			// detect by checking for an existing row.
			var existing User
			if e2 := tx.Where("email = ?", email).First(&existing).Error; e2 == nil {
				return errors.New("email already registered")
			}
			return err
		}
		// First-ever user inherits any pre-auth watchlist rows (user_id = 0).
		// On subsequent registrations there will be none and this is a no-op.
		n, err := ws.collector.database.ClaimUnclaimedStocks(tx, user.ID)
		if err != nil {
			return err
		}
		claimedCount = n
		return nil
	})
	if err != nil {
		if err.Error() == "email already registered" {
			c.JSON(http.StatusConflict, gin.H{"error": "email already registered"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if err := setSession(c, user.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "session save failed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id":             user.ID,
		"email":          user.Email,
		"claimedStocks":  claimedCount,
	})
}

func (ws *WebServer) handleLogin(c *gin.Context) {
	var req loginReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing fields"})
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))

	var user User
	if err := ws.collector.database.db.Where("email = ?", email).First(&user).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}
	if err := setSession(c, user.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "session save failed"})
		return
	}
	c.JSON(http.StatusOK, meResp{ID: user.ID, Email: user.Email})
}

func (ws *WebServer) handleLogout(c *gin.Context) {
	sess := sessions.Default(c)
	sess.Clear()
	sess.Options(sessions.Options{Path: "/", MaxAge: -1})
	if err := sess.Save(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "logout failed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (ws *WebServer) handleMe(c *gin.Context) {
	uid := c.MustGet("userID").(uint)
	var user User
	if err := ws.collector.database.db.First(&user, uid).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user not found"})
		return
	}
	c.JSON(http.StatusOK, meResp{ID: user.ID, Email: user.Email})
}

func (ws *WebServer) handleOnboarding(c *gin.Context) {
	users, err := ws.collector.database.CountUsers()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	unclaimed := int64(0)
	if users == 0 {
		// Only show the "you'll inherit X stocks" hint before the first user
		// signs up; after that, unclaimed rows (if any) are an admin concern.
		n, err := ws.collector.database.CountUnclaimedStocks()
		if err == nil {
			unclaimed = n
		}
	}
	c.JSON(http.StatusOK, onboardingResp{
		HasAnyUser:          users > 0,
		UnclaimedStockCount: unclaimed,
	})
}

func setSession(c *gin.Context, userID uint) error {
	sess := sessions.Default(c)
	sess.Set(sessionUserKey, userID)
	return sess.Save()
}

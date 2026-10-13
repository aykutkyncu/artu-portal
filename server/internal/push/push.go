// Package push, tarayıcı/telefon bildirimlerini (Web Push, VAPID) gönderir.
package push

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const (
	keysFile       = "vapid_keys.json"
	sendTimeout    = 15 * time.Second
	messageTTL     = 60 * 60 * 24 // 1 gün
	maxBodyPreview = 180
	sendWorkers    = 8
)

// allowedPushHosts, tarayıcıların gerçek push servisleridir. Başka adrese istek atılmaz
// (aksi halde sunucu, iç ağdaki sistemlere — ör. Logo — istek göndermeye zorlanabilir).
var allowedPushHosts = []string{
	"fcm.googleapis.com",                // Chrome, Edge (Android/masaüstü)
	"updates.push.services.mozilla.com", // Firefox
	".notify.windows.com",               // Edge (Windows)
	".push.apple.com",                   // Safari / iOS
}

// ValidateEndpoint, abonelik adresinin https ve bilinen bir push servisi olduğunu doğrular.
func ValidateEndpoint(endpoint string) error {
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" {
		return errors.New("geçersiz bildirim adresi")
	}
	host := strings.ToLower(u.Hostname())
	for _, allowed := range allowedPushHosts {
		if host == strings.TrimPrefix(allowed, ".") || (strings.HasPrefix(allowed, ".") && strings.HasSuffix(host, allowed)) {
			return nil
		}
	}
	return errors.New("desteklenmeyen bildirim servisi")
}

// publicOnlyDialer, DNS ile iç ağ adresine yönlendirilse bile özel/yerel IP'lere bağlanmayı reddeder.
func publicOnlyDialer() *net.Dialer {
	return &net.Dialer{
		Timeout: sendTimeout,
		Control: func(_, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			ip := net.ParseIP(host)
			if ip == nil || ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() || ip.IsMulticast() {
				return fmt.Errorf("iç ağ adresine push engellendi: %s", host)
			}
			return nil
		},
	}
}

// Payload, service worker'ın gösterdiği bildirim içeriğidir.
type Payload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url"`
	Tag   string `json:"tag,omitempty"`
}

type vapidKeys struct {
	Public  string `json:"public"`
	Private string `json:"private"`
}

// Service, VAPID anahtarlarını tutar ve bildirimleri gönderir.
type Service struct {
	app        core.App
	keys       vapidKeys
	subscriber string
	client     *http.Client
}

// New, anahtarları pb_data içinden yükler; yoksa üretip kaydeder.
func New(app core.App, subscriber string) (*Service, error) {
	keys, err := loadOrCreateKeys(filepath.Join(app.DataDir(), keysFile))
	if err != nil {
		return nil, fmt.Errorf("vapid anahtarları: %w", err)
	}
	return &Service{
		app:        app,
		keys:       keys,
		subscriber: subscriber,
		client: &http.Client{
			Timeout:   sendTimeout,
			Transport: &http.Transport{DialContext: publicOnlyDialer().DialContext, ForceAttemptHTTP2: true, TLSHandshakeTimeout: sendTimeout},
		},
	}, nil
}

// PublicKey, istemcinin abone olurken kullandığı açık anahtardır.
func (s *Service) PublicKey() string { return s.keys.Public }

func loadOrCreateKeys(path string) (vapidKeys, error) {
	var keys vapidKeys
	data, err := os.ReadFile(path)
	if err == nil {
		if err := json.Unmarshal(data, &keys); err != nil {
			return keys, fmt.Errorf("%s okunamadı: %w", path, err)
		}
		return keys, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return keys, err
	}

	priv, pub, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		return keys, err
	}
	keys = vapidKeys{Public: pub, Private: priv}
	data, err = json.Marshal(keys)
	if err != nil {
		return keys, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return keys, err
	}
	return keys, os.WriteFile(path, data, 0o600)
}

// NotifyUsers, verilen kullanıcıların tüm cihazlarına arka planda bildirim gönderir.
// Hata olursa sadece loglanır; asıl işlemi (mesaj kaydı vb.) asla bozmaz.
func (s *Service) NotifyUsers(userIDs []string, p Payload) {
	if len(userIDs) == 0 {
		return
	}
	p.Body = truncate(p.Body, maxBodyPreview)

	go func() {
		defer func() {
			if r := recover(); r != nil {
				s.app.Logger().Error("push panic", "error", r)
			}
		}()
		s.send(userIDs, p)
	}()
}

func (s *Service) send(userIDs []string, p Payload) {
	ids := make([]any, len(userIDs))
	for i, id := range userIDs {
		ids[i] = id
	}
	subs, err := s.app.FindAllRecords("push_subscriptions", dbx.In("user", ids...))
	if err != nil {
		s.app.Logger().Error("push abonelikleri okunamadı", "error", err)
		return
	}

	message, err := json.Marshal(p)
	if err != nil {
		s.app.Logger().Error("push payload", "error", err)
		return
	}

	// Yavaş bir cihaz diğerlerini bekletmesin: sınırlı sayıda paralel gönderim.
	jobs := make(chan *core.Record)
	var wg sync.WaitGroup
	for range min(sendWorkers, len(subs)) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for sub := range jobs {
				s.sendOne(sub, message)
			}
		}()
	}
	for _, sub := range subs {
		jobs <- sub
	}
	close(jobs)
	wg.Wait()
}

func (s *Service) sendOne(sub *core.Record, message []byte) {
	if err := ValidateEndpoint(sub.GetString("endpoint")); err != nil {
		_ = s.app.Delete(sub)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), sendTimeout)
	defer cancel()

	resp, err := webpush.SendNotificationWithContext(ctx, message, &webpush.Subscription{
		Endpoint: sub.GetString("endpoint"),
		Keys:     webpush.Keys{P256dh: sub.GetString("p256dh"), Auth: sub.GetString("auth")},
	}, &webpush.Options{
		HTTPClient:      s.client,
		Subscriber:      s.subscriber,
		VAPIDPublicKey:  s.keys.Public,
		VAPIDPrivateKey: s.keys.Private,
		TTL:             messageTTL,
		Urgency:         webpush.UrgencyHigh,
	})
	if err != nil {
		s.app.Logger().Warn("push gönderilemedi", "error", err, "subscription", sub.Id)
		return
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)

	// Cihaz aboneliği iptal etmişse kaydı temizle.
	if resp.StatusCode == http.StatusGone || resp.StatusCode == http.StatusNotFound {
		if err := s.app.Delete(sub); err != nil {
			s.app.Logger().Warn("eski abonelik silinemedi", "error", err)
		}
		return
	}
	if resp.StatusCode >= 400 {
		s.app.Logger().Warn("push servisi hata döndü", "status", resp.StatusCode, "subscription", sub.Id)
	}
}

func truncate(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max-1]) + "…"
}

const maxSubscriptionsPerUser = 10

// SubscriptionInput, istemcinin PushSubscription.toJSON() çıktısıdır.
type SubscriptionInput struct {
	Endpoint  string `json:"endpoint"`
	P256dh    string `json:"p256dh"`
	Auth      string `json:"auth"`
	UserAgent string `json:"userAgent"`
}

// Subscribe, aboneliği doğrulayıp kullanıcıya kaydeder. Aynı cihaz daha önce başka
// kullanıcıya kayıtlıysa (ortak cihaz), abonelik yeni kullanıcıya devredilir.
func (s *Service) Subscribe(userID string, in SubscriptionInput) error {
	if err := ValidateEndpoint(in.Endpoint); err != nil {
		return err
	}
	if in.P256dh == "" || in.Auth == "" || len(in.P256dh) > 200 || len(in.Auth) > 100 || len(in.Endpoint) > 1000 {
		return errors.New("eksik veya hatalı abonelik anahtarı")
	}

	record, err := s.app.FindFirstRecordByData("push_subscriptions", "endpoint", in.Endpoint)
	if err != nil {
		count, cErr := s.app.CountRecords("push_subscriptions", dbx.HashExp{"user": userID})
		if cErr != nil {
			return cErr
		}
		if count >= maxSubscriptionsPerUser {
			// En eski aboneliği bırak ki yeni cihaz eklenebilsin.
			oldest, _ := s.app.FindRecordsByFilter("push_subscriptions", "user = {:u}", "created", 1, 0, dbx.Params{"u": userID})
			for _, o := range oldest {
				_ = s.app.Delete(o)
			}
		}
		collection, cErr := s.app.FindCollectionByNameOrId("push_subscriptions")
		if cErr != nil {
			return cErr
		}
		record = core.NewRecord(collection)
		record.Set("endpoint", in.Endpoint)
	}
	record.Set("user", userID)
	record.Set("p256dh", in.P256dh)
	record.Set("auth", in.Auth)
	record.Set("userAgent", truncate(in.UserAgent, 300))
	return s.app.Save(record)
}

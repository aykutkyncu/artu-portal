// Artu Portal: şirket içi duyuru, planlama ve mesajlaşma sunucusu.
package main

import (
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	_ "time/tzdata" // Windows'ta Europe/Istanbul için

	"github.com/kardianos/service"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/pocketbase/pocketbase/tools/osutils"

	"artu-portal/internal/cli"
	"artu-portal/internal/hooks"
	"artu-portal/internal/push"
	"artu-portal/internal/routes"
	_ "artu-portal/migrations"
)

// Push servislerine (Apple, Google) iletişim bilgisi olarak gönderilir.
const pushSubscriber = "https://portal.artucikolata.com.tr"

func main() {
	// Windows servisi olarak çalıştırılıyorsa servis döngüsüne gir.
	if !service.Interactive() {
		if err := cli.RunAsService(newApp); err != nil {
			log.Fatal(err)
		}
		return
	}

	app := newApp()
	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}

func newApp() *pocketbase.PocketBase {
	app := pocketbase.NewWithConfig(pocketbase.Config{DefaultDataDir: filepath.Join(baseDir(), "pb_data")})

	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{
		TemplateLang: migratecmd.TemplateLangGo,
		Automigrate:  false,
	})
	cli.RegisterCommands(app)

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.BindFunc(blockAdminFromInternet)
		se.Router.BindFunc(securityHeaders)
		// Oturum anahtarı yüklendikten sonra çalışmalı.
		se.Router.Bind(&hook.Handler[*core.RequestEvent]{Func: rejectInactiveUsers, Priority: apis.DefaultLoadAuthTokenMiddlewarePriority + 1})

		pusher, err := push.New(se.App, pushSubscriber)
		if err != nil {
			return err
		}
		hooks.Register(se.App, pusher)
		routes.Register(se, pusher)
		return se.Next()
	})

	// Web arayüzü (pb_public) en son kayıt edilir ki API rotaları öncelikli olsun.
	app.OnServe().Bind(&hook.Handler[*core.ServeEvent]{
		Func: func(se *core.ServeEvent) error {
			if !se.Router.HasRoute(http.MethodGet, "/{path...}") {
				se.Router.GET("/{path...}", apis.Static(os.DirFS(filepath.Join(baseDir(), "pb_public")), true))
			}
			return se.Next()
		},
		Priority: 999,
	})

	return app
}

// blockAdminFromInternet, teknik yönetim panelini (/_/) ve süper kullanıcı API'sini
// sadece sunucunun kendisinden (127.0.0.1) gelen isteklere açar. İnternetten veya
// şirket ağından gelen isteklere bu adresler hiç yokmuş gibi davranır.
func blockAdminFromInternet(e *core.RequestEvent) error {
	if isLoopback(e.Request.RemoteAddr) || !isAdminPath(e.Request.URL.Path) {
		return e.Next()
	}
	return e.NotFoundError("", nil)
}

func isAdminPath(path string) bool {
	if path == "/_" || strings.HasPrefix(path, "/api/collections/"+core.CollectionNameSuperusers) {
		return true
	}
	for _, prefix := range adminOnlyPrefixes {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}
	return false
}

// isLoopback, TCP bağlantısının gerçekten sunucunun kendisinden geldiğini kontrol eder.
// Başlıklara (X-Forwarded-For vb.) güvenilmez; onlar sahte olabilir.
func isLoopback(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

var adminOnlyPrefixes = []string{"/_/", "/api/settings", "/api/backups", "/api/logs", "/api/crons", "/api/collections/_"}

// rejectInactiveUsers, pasifleştirilmiş kullanıcının elindeki eski oturumla işlem yapmasını engeller.
func rejectInactiveUsers(e *core.RequestEvent) error {
	if e.Auth != nil && e.Auth.Collection().Name == "users" && !e.Auth.GetBool("active") {
		return e.UnauthorizedError("Hesabınız pasif.", nil)
	}
	return e.Next()
}

// securityHeaders, web arayüzü için tarayıcı güvenlik başlıklarını ekler.
// /api/files kendi (daha sıkı) CSP'sini koyar; ona dokunulmaz.
func securityHeaders(e *core.RequestEvent) error {
	if !strings.HasPrefix(e.Request.URL.Path, "/api/") && !strings.HasPrefix(e.Request.URL.Path, "/_/") {
		h := e.Response.Header()
		h.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; "+
			"connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		if e.Request.TLS != nil {
			h.Set("Strict-Transport-Security", "max-age=31536000")
		}
	}
	return e.Next()
}

// baseDir, exe'nin bulunduğu klasördür (go run sırasında çalışma klasörü).
func baseDir() string {
	if osutils.IsProbablyGoRun() {
		wd, _ := os.Getwd()
		return wd
	}
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	return filepath.Dir(exe)
}

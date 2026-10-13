// Package cli, portala özel komutları (admin oluşturma, Windows servisi) içerir.
package cli

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"github.com/kardianos/service"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/spf13/cobra"
)

const (
	serviceName    = "ArtuPortal"
	defaultHTTP    = "127.0.0.1:8090"
	minPasswordLen = 10
)

// RegisterCommands, `admin` ve `service` komutlarını ekler.
func RegisterCommands(app *pocketbase.PocketBase) {
	app.RootCmd.AddCommand(adminCommand(app), serviceCommand())
}

func adminCommand(app *pocketbase.PocketBase) *cobra.Command {
	root := &cobra.Command{Use: "admin", Short: "Portal yöneticisi işlemleri"}
	root.AddCommand(&cobra.Command{
		Use:     "create <kullanici_adi> <sifre> <ad_soyad>",
		Short:   "Portal admin kullanıcısı oluşturur veya şifresini günceller",
		Example: `artu-portal admin create aykut GucluSifre123 "Aykut Koyuncu"`,
		Args:    cobra.ExactArgs(3),
		RunE: func(_ *cobra.Command, args []string) error {
			return upsertAdmin(app, strings.ToLower(args[0]), args[1], args[2])
		},
	})
	return root
}

func upsertAdmin(app core.App, username, password, name string) error {
	if len(password) < minPasswordLen {
		return fmt.Errorf("şifre en az %d karakter olmalı", minPasswordLen)
	}
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return fmt.Errorf("users koleksiyonu bulunamadı (önce sunucuyu bir kez çalıştırın): %w", err)
	}

	record, err := app.FindFirstRecordByData(users, "username", username)
	if err != nil {
		record = core.NewRecord(users)
		record.Set("username", username)
	}
	record.Set("name", name)
	record.Set("role", "admin")
	record.Set("active", true)
	record.SetPassword(password)
	record.SetVerified(true)

	if err := app.Save(record); err != nil {
		return fmt.Errorf("admin kaydedilemedi: %w", err)
	}
	fmt.Printf("✓ Admin hazır: %s (%s)\n", username, name)
	return nil
}

// ---------------------------------------------------------------- Windows servisi

type program struct {
	newApp   func() *pocketbase.PocketBase
	app      *pocketbase.PocketBase
	stopping atomic.Bool
}

// logServiceError, servis modunda görünmeyen hataları exe yanındaki dosyaya yazar.
func logServiceError(err error) {
	exe, _ := os.Executable()
	f, fErr := os.OpenFile(filepath.Join(filepath.Dir(exe), "servis-hata.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if fErr != nil {
		return
	}
	defer f.Close()
	fmt.Fprintf(f, "%s  %v\n", time.Now().Format(time.RFC3339), err)
}

func (p *program) Start(_ service.Service) error {
	p.app = p.newApp()
	go func() {
		// Sunucu beklenmedik şekilde durursa (port dolu, migration hatası vb.) süreç kapanır;
		// Windows servis yöneticisi "OnFailure=restart" ile yeniden başlatır.
		if err := p.app.Start(); err != nil && !p.stopping.Load() {
			logServiceError(err)
			os.Exit(1)
		}
	}()
	return nil
}

func (p *program) Stop(_ service.Service) error {
	p.stopping.Store(true)
	if p.app == nil {
		return nil
	}
	// HTTP sunucusunu düzgünce kapat ve veritabanı bağlantılarını bırak.
	event := &core.TerminateEvent{App: p.app}
	return p.app.OnTerminate().Trigger(event, func(e *core.TerminateEvent) error {
		return e.App.ClearBootstrap()
	})
}

// serviceOptions, servisin hangi adres(ler)de çalışacağını belirler.
type serviceOptions struct {
	// Virgülle ayrılmış alan adları, ör. "portal.artucikolata.com.tr,78-188-21-132.sslip.io".
	// Doluysa otomatik HTTPS (Let's Encrypt); sertifika her alan adı için ilk ziyarette alınır.
	domain    string
	httpAddr  string
	httpsAddr string
}

func (o serviceOptions) domains() []string {
	var out []string
	for _, d := range strings.Split(o.domain, ",") {
		if d = strings.TrimSpace(d); d != "" {
			out = append(out, d)
		}
	}
	return out
}

// args, servis başlarken `serve` komutuna verilecek argümanlardır.
func (o serviceOptions) args() []string {
	domains := o.domains()
	if len(domains) == 0 {
		addr := o.httpAddr
		if addr == "" {
			addr = defaultHTTP
		}
		return []string{"serve", "--http=" + addr}
	}
	// Alan adı verilince PocketBase 80/443'te dinler, sertifikayı kendisi alır ve yeniler.
	args := append([]string{"serve"}, domains...)
	if o.httpAddr != "" {
		args = append(args, "--http="+o.httpAddr)
	}
	if o.httpsAddr != "" {
		args = append(args, "--https="+o.httpsAddr)
	}
	return args
}

func serviceConfig(opts serviceOptions) *service.Config {
	return &service.Config{
		Name:        serviceName,
		DisplayName: "Artu Portal",
		Description: "Artu şirket içi duyuru, planlama ve mesajlaşma portalı",
		Arguments:   opts.args(),
		Option:      service.KeyValue{"StartType": "automatic", "OnFailure": "restart", "OnFailureDelayDuration": "10s"},
	}
}

// RunAsService, uygulamayı Windows servis yöneticisi altında çalıştırır.
func RunAsService(newApp func() *pocketbase.PocketBase) error {
	// SCM, kurulumda kaydedilen argümanlarla başlatır; buradaki yapılandırma sadece servis kimliği içindir.
	s, err := service.New(&program{newApp: newApp}, serviceConfig(serviceOptions{}))
	if err != nil {
		return err
	}
	return s.Run()
}

func serviceCommand() *cobra.Command {
	var opts serviceOptions
	root := &cobra.Command{
		Use:   "service",
		Short: "Windows servisi olarak kur/kaldır/başlat/durdur",
		Example: "  artu-portal service install --domain=portal.artucikolata.com.tr\n" +
			"  artu-portal service install --domain=portal.artucikolata.com.tr --http=0.0.0.0:8080 --https=0.0.0.0:8443\n" +
			"  artu-portal service install   (sadece bu bilgisayardan: 127.0.0.1:8090)",
	}

	actions := map[string]string{
		"install":   "Servisi kurar (otomatik başlar)",
		"uninstall": "Servisi kaldırır",
		"start":     "Servisi başlatır",
		"stop":      "Servisi durdurur",
		"restart":   "Servisi yeniden başlatır",
	}
	for action, short := range actions {
		root.AddCommand(&cobra.Command{
			Use:   action,
			Short: short,
			Args:  cobra.NoArgs,
			RunE: func(_ *cobra.Command, _ []string) error {
				s, err := service.New(&program{}, serviceConfig(opts))
				if err != nil {
					return err
				}
				if err := service.Control(s, action); err != nil {
					return fmt.Errorf("servis %s başarısız (yönetici olarak çalıştırdınız mı?): %w", action, err)
				}
				fmt.Printf("✓ Servis: %s tamam\n", action)
				return nil
			},
		})
	}

	root.AddCommand(&cobra.Command{
		Use:   "status",
		Short: "Servis durumunu gösterir",
		RunE: func(_ *cobra.Command, _ []string) error {
			s, err := service.New(&program{}, serviceConfig(opts))
			if err != nil {
				return err
			}
			st, err := s.Status()
			if err != nil && !errors.Is(err, service.ErrNotInstalled) {
				return err
			}
			labels := map[service.Status]string{
				service.StatusRunning: "çalışıyor", service.StatusStopped: "durdu", service.StatusUnknown: "kurulu değil",
			}
			fmt.Println("Servis durumu:", labels[st])
			return nil
		},
	})

	root.PersistentFlags().StringVar(&opts.domain, "domain", "", "alan ad(lar)ı, virgülle ayrılır; verilirse otomatik HTTPS (install için)")
	root.PersistentFlags().StringVar(&opts.httpAddr, "http", "", "HTTP adresi (varsayılan: alan adıyla 0.0.0.0:80, yoksa 127.0.0.1:8090)")
	root.PersistentFlags().StringVar(&opts.httpsAddr, "https", "", "HTTPS adresi (varsayılan: alan adıyla 0.0.0.0:443)")
	return root
}

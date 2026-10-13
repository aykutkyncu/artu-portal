package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		s := app.Settings()
		s.Meta.AppName = "Artu Portal"
		s.Meta.SenderName = "Artu Portal"

		s.Logs.MaxDays = 14

		// Her gece 03:00'te otomatik yedek, son 14 gün saklanır (pb_data/backups).
		s.Backups.Cron = "0 3 * * *"
		s.Backups.CronMaxKeep = 14

		s.Meta.AppURL = "https://portal.artucikolata.com.tr"

		// Önünde proxy yok (doğrudan port yönlendirme): IP başlıklarına GÜVENİLMEZ,
		// aksi halde saldırgan sahte başlıkla hız sınırını aşabilir.
		s.TrustedProxy.Headers = nil

		// Toplu işlemler (ör. vardiya kopyalama); her alt istek kendi API kuralından geçer.
		s.Batch.Enabled = true
		s.Batch.MaxRequests = 200

		s.RateLimits.Enabled = true
		// Ofisteki herkes aynı dış IP'den çıkabileceği için limitler cömert tutuldu.
		s.RateLimits.Rules = []core.RateLimitRule{
			{Label: "*:authWithPassword", MaxRequests: 30, Duration: 60},
			{Label: "*:create", MaxRequests: 60, Duration: 10},
			{Label: "/api/", MaxRequests: 600, Duration: 10},
		}

		return app.Save(s)
	}, nil)
}

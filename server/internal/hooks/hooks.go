// Package hooks, iş kurallarını ve bildirim tetikleyicilerini PocketBase'e bağlar.
package hooks

import (
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"artu-portal/internal/push"
)

// Notifier, push servisinin hook'ların ihtiyaç duyduğu kısmıdır.
type Notifier interface {
	NotifyUsers(userIDs []string, p push.Payload)
}

// Register tüm hook'ları uygulamaya bağlar.
func Register(app core.App, n Notifier) {
	registerUsers(app)
	registerConversations(app)
	registerMessages(app, n)
	registerAnnouncements(app, n)
	registerTasks(app, n)
	registerEvents(app, n)
}

func isPrivileged(auth *core.Record) bool {
	if auth == nil {
		return false
	}
	if auth.IsSuperuser() {
		return true
	}
	role := auth.GetString("role")
	return role == "admin" || role == "manager"
}

func displayName(app core.App, userID string) string {
	u, err := app.FindRecordById("users", userID)
	if err != nil {
		return "Bir kullanıcı"
	}
	if n := u.GetString("name"); n != "" {
		return n
	}
	return u.GetString("username")
}

func without(ids []string, exclude string) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if id != exclude && id != "" {
			out = append(out, id)
		}
	}
	return out
}

func actorID(e *core.RecordRequestEvent) string {
	if e.Auth == nil {
		return ""
	}
	return e.Auth.Id
}

// canView, isteği yapan kullanıcının bir kaydın "view" kuralını geçip geçmediğini kontrol eder.
func canView(e *core.RecordRequestEvent, record *core.Record) (bool, error) {
	if e.HasSuperuserAuth() {
		return true, nil
	}
	info, err := e.RequestInfo()
	if err != nil {
		return false, err
	}
	return e.App.CanAccessRecord(record, info, record.Collection().ViewRule)
}

// ---------------------------------------------------------------- users

func registerUsers(app core.App) {
	app.OnRecordCreateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		e.Record.Set("username", strings.ToLower(strings.TrimSpace(e.Record.GetString("username"))))
		if e.Record.GetString("role") == "" {
			e.Record.Set("role", "staff")
		}
		return e.Next()
	})

	// Pasifleştirilen kullanıcının tüm oturumları anında geçersiz olur.
	// (Şifre değişikliğinde PocketBase bunu zaten kendisi yapar.)
	app.OnRecordUpdate("users").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.Original().GetBool("active") && !e.Record.GetBool("active") {
			e.Record.RefreshTokenKey()
		}
		return e.Next()
	})
}

// ---------------------------------------------------------------- conversations

// DirectKey, iki kişilik sohbet için sıralı ve benzersiz anahtar üretir.
func DirectKey(a, b string) string {
	ids := []string{a, b}
	sort.Strings(ids)
	return ids[0] + ":" + ids[1]
}

func registerConversations(app core.App) {
	app.OnRecordCreateRequest("conversations").BindFunc(func(e *core.RecordRequestEvent) error {
		members := e.Record.GetStringSlice("members")
		if !e.HasSuperuserAuth() && !slices.Contains(members, actorID(e)) {
			return apis.NewForbiddenError("Sohbete kendinizi eklemelisiniz.", nil)
		}

		switch e.Record.GetString("type") {
		case "direct":
			if len(members) != 2 {
				return apis.NewBadRequestError("Birebir sohbet tam olarak 2 kişi olmalıdır.", nil)
			}
			e.Record.Set("directKey", DirectKey(members[0], members[1]))
			e.Record.Set("name", "")
		case "group":
			if strings.TrimSpace(e.Record.GetString("name")) == "" {
				return apis.NewBadRequestError("Grup adı zorunludur.", nil)
			}
			e.Record.Set("directKey", "")
		}
		e.Record.Set("lastMessageAt", types.NowDateTime())
		return e.Next()
	})
}

// ---------------------------------------------------------------- messages

func registerMessages(app core.App, n Notifier) {
	app.OnRecordCreateRequest("messages").BindFunc(func(e *core.RecordRequestEvent) error {
		conv, err := e.App.FindRecordById("conversations", e.Record.GetString("conversation"))
		if err != nil {
			return apis.NewNotFoundError("Sohbet bulunamadı.", nil)
		}
		if ok, _ := canView(e, conv); !ok {
			return apis.NewForbiddenError("Bu sohbetin üyesi değilsiniz.", nil)
		}

		text := strings.TrimSpace(e.Record.GetString("text"))
		if text == "" && len(e.Record.GetUnsavedFiles("attachments")) == 0 {
			return apis.NewBadRequestError("Boş mesaj gönderilemez.", nil)
		}
		e.Record.Set("text", text)

		if err := e.Next(); err != nil {
			return err
		}

		preview := text
		if preview == "" {
			preview = "📎 Dosya"
		}
		conv.Set("lastMessageAt", e.Record.GetDateTime("created"))
		conv.Set("lastMessageText", truncate(preview, 190))
		if err := e.App.Save(conv); err != nil {
			e.App.Logger().Warn("sohbet özeti güncellenemedi", "error", err)
		}

		if e.Auth != nil && !e.Auth.IsSuperuser() {
			e.Auth.Set("lastSeen", types.NowDateTime())
			_ = e.App.UnsafeWithoutHooks().Save(e.Auth)
		}

		sender := displayName(e.App, actorID(e))
		title := sender
		if conv.GetString("type") == "group" {
			title = sender + " · " + conv.GetString("name")
		}
		n.NotifyUsers(without(conv.GetStringSlice("members"), actorID(e)), push.Payload{
			Title: title,
			Body:  preview,
			URL:   "/mesajlar/" + conv.Id,
			Tag:   "conv-" + conv.Id,
		})
		return nil
	})
}

// ---------------------------------------------------------------- announcements

func registerAnnouncements(app core.App, n Notifier) {
	app.OnRecordCreateRequest("announcements").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.Record.GetString("priority") == "" {
			e.Record.Set("priority", "normal")
		}
		if err := e.Next(); err != nil {
			return err
		}

		recipients, err := announcementAudience(e.App, e.Record.GetStringSlice("departments"))
		if err != nil {
			e.App.Logger().Warn("duyuru alıcıları bulunamadı", "error", err)
			return nil
		}
		prefix := "📢 "
		if e.Record.GetString("priority") == "urgent" {
			prefix = "🚨 ACİL: "
		}
		n.NotifyUsers(without(recipients, actorID(e)), push.Payload{
			Title: prefix + e.Record.GetString("title"),
			Body:  stripHTML(e.Record.GetString("body")),
			URL:   "/duyurular/" + e.Record.Id,
			Tag:   "ann-" + e.Record.Id,
		})
		return nil
	})

	app.OnRecordCreateRequest("announcement_reads").BindFunc(func(e *core.RecordRequestEvent) error {
		ann, err := e.App.FindRecordById("announcements", e.Record.GetString("announcement"))
		if err != nil {
			return apis.NewNotFoundError("Duyuru bulunamadı.", nil)
		}
		if ok, _ := canView(e, ann); !ok {
			return apis.NewForbiddenError("Bu duyuruya erişiminiz yok.", nil)
		}
		return e.Next()
	})
}

func announcementAudience(app core.App, departments []string) ([]string, error) {
	filter := "active = true"
	params := map[string]any{}
	if len(departments) > 0 {
		parts := make([]string, len(departments))
		for i, d := range departments {
			key := fmt.Sprintf("d%d", i)
			parts[i] = "department = {:" + key + "}"
			params[key] = d
		}
		filter += " && (" + strings.Join(parts, " || ") + " || role = 'admin')"
	}
	users, err := app.FindRecordsByFilter("users", filter, "", 0, 0, params)
	if err != nil {
		return nil, err
	}
	ids := make([]string, len(users))
	for i, u := range users {
		ids[i] = u.Id
	}
	return ids, nil
}

// ---------------------------------------------------------------- tasks

// assigneeEditable, atanan (yönetici olmayan) kişinin değiştirebileceği alanlardır.
var assigneeEditable = map[string]bool{"status": true, "completedAt": true, "updated": true}

func registerTasks(app core.App, n Notifier) {
	// Durum "done" olduğunda tamamlanma zamanını işaretle.
	app.OnRecordValidate("tasks").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.GetString("status") == "done" {
			if e.Record.GetDateTime("completedAt").IsZero() {
				e.Record.Set("completedAt", types.NowDateTime())
			}
		} else {
			e.Record.Set("completedAt", "")
		}
		if e.Record.GetString("priority") == "" {
			e.Record.Set("priority", "normal")
		}
		return e.Next()
	})

	app.OnRecordCreateRequest("tasks").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.Record.GetString("status") == "" {
			e.Record.Set("status", "todo")
		}
		if err := e.Next(); err != nil {
			return err
		}
		notifyTaskAssigned(e.App, n, e.Record, without(e.Record.GetStringSlice("assignees"), actorID(e)), actorID(e))
		return nil
	})

	app.OnRecordUpdateRequest("tasks").BindFunc(func(e *core.RecordRequestEvent) error {
		original := e.Record.Original()
		actor := actorID(e)

		if !isPrivileged(e.Auth) && original.GetString("createdBy") != actor {
			for _, f := range e.Record.Collection().Fields {
				name := f.GetName()
				if assigneeEditable[name] {
					continue
				}
				if fmt.Sprint(e.Record.Get(name)) != fmt.Sprint(original.Get(name)) || len(e.Record.GetUnsavedFiles(name)) > 0 {
					return apis.NewForbiddenError("Size atanan görevde sadece durumu değiştirebilirsiniz.", nil)
				}
			}
		}

		if err := e.Next(); err != nil {
			return err
		}

		added := []string{}
		for _, id := range e.Record.GetStringSlice("assignees") {
			if !slices.Contains(original.GetStringSlice("assignees"), id) && id != actor {
				added = append(added, id)
			}
		}
		notifyTaskAssigned(e.App, n, e.Record, added, actor)

		if e.Record.GetString("status") == "done" && original.GetString("status") != "done" {
			n.NotifyUsers(without([]string{e.Record.GetString("createdBy")}, actor), push.Payload{
				Title: "✅ Görev tamamlandı",
				Body:  displayName(e.App, actor) + ": " + e.Record.GetString("title"),
				URL:   "/gorevler?id=" + e.Record.Id,
				Tag:   "task-" + e.Record.Id,
			})
		}
		return nil
	})

	app.OnRecordCreateRequest("task_comments").BindFunc(func(e *core.RecordRequestEvent) error {
		task, err := e.App.FindRecordById("tasks", e.Record.GetString("task"))
		if err != nil {
			return apis.NewNotFoundError("Görev bulunamadı.", nil)
		}
		if ok, _ := canView(e, task); !ok {
			return apis.NewForbiddenError("Bu göreve erişiminiz yok.", nil)
		}
		if err := e.Next(); err != nil {
			return err
		}

		recipients := append(task.GetStringSlice("assignees"), task.GetString("createdBy"))
		n.NotifyUsers(without(slices.Compact(sortedCopy(recipients)), actorID(e)), push.Payload{
			Title: "💬 " + task.GetString("title"),
			Body:  displayName(e.App, actorID(e)) + ": " + e.Record.GetString("text"),
			URL:   "/gorevler?id=" + task.Id,
			Tag:   "task-" + task.Id,
		})
		return nil
	})
}

func notifyTaskAssigned(app core.App, n Notifier, task *core.Record, userIDs []string, actor string) {
	if len(userIDs) == 0 {
		return
	}
	body := task.GetString("title")
	if due := task.GetDateTime("dueDate"); !due.IsZero() {
		body += " · Son tarih: " + due.Time().In(istanbul()).Format("02.01.2006")
	}
	n.NotifyUsers(userIDs, push.Payload{
		Title: "📋 Yeni görev: " + displayName(app, actor),
		Body:  body,
		URL:   "/gorevler?id=" + task.Id,
		Tag:   "task-" + task.Id,
	})
}

// ---------------------------------------------------------------- events

func registerEvents(app core.App, n Notifier) {
	app.OnRecordCreateRequest("events").BindFunc(func(e *core.RecordRequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		start := e.Record.GetDateTime("start").Time().In(istanbul())
		when := start.Format("02.01.2006 15:04")
		if e.Record.GetBool("allDay") {
			when = start.Format("02.01.2006")
		}
		n.NotifyUsers(without(e.Record.GetStringSlice("participants"), actorID(e)), push.Payload{
			Title: "📅 " + e.Record.GetString("title"),
			Body:  when + " · " + e.Record.GetString("location"),
			URL:   "/takvim?id=" + e.Record.Id,
			Tag:   "event-" + e.Record.Id,
		})
		return nil
	})
}

// ---------------------------------------------------------------- helpers

func istanbul() *time.Location {
	loc, err := time.LoadLocation("Europe/Istanbul")
	if err != nil {
		return time.FixedZone("TRT", 3*60*60)
	}
	return loc
}

func sortedCopy(s []string) []string {
	out := slices.Clone(s)
	sort.Strings(out)
	return out
}

func truncate(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max-1]) + "…"
}

// stripHTML, editör içeriğini bildirim için düz metne çevirir.
func stripHTML(s string) string {
	var b strings.Builder
	inTag := false
	for _, r := range s {
		switch {
		case r == '<':
			inTag = true
			b.WriteRune(' ')
		case r == '>':
			inTag = false
		case !inTag:
			b.WriteRune(r)
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

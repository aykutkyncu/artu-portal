package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Ortak kural parçaları.
const (
	ruleAuth      = `@request.auth.id != ""`
	ruleAdmin     = `@request.auth.role = "admin"`
	ruleManager   = `(@request.auth.role = "admin" || @request.auth.role = "manager")`
	maxFileSize   = 10 << 20 // 10 MB; sunucu Logo ile aynı diski paylaşıyor
	maxAttachment = 5
)

// İzin verilen ek türleri: resimler, ofis belgeleri, PDF, metin ve arşiv.
var attachmentMimes = []string{
	"image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif",
	"application/pdf", "text/plain", "text/csv",
	"application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	"application/zip", "application/x-zip-compressed",
}

func init() {
	m.Register(up, down)
}

func up(app core.App) error {
	departments, err := createDepartments(app)
	if err != nil {
		return err
	}

	users, err := extendUsers(app, departments)
	if err != nil {
		return err
	}

	steps := []func(core.App, *core.Collection, *core.Collection) error{
		createAnnouncements,
		createConversations,
		createEvents,
		createTasks,
		createShifts,
		createProductionPlans,
		createPushSubscriptions,
	}
	for _, step := range steps {
		if err := step(app, users, departments); err != nil {
			return err
		}
	}

	return nil
}

func down(app core.App) error {
	names := []string{
		"push_subscriptions", "production_plans", "shifts", "task_comments", "tasks",
		"events", "conversation_reads", "messages", "conversations",
		"announcement_reads", "announcements",
	}
	for _, name := range names {
		c, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			continue
		}
		if err := app.Delete(c); err != nil {
			return err
		}
	}
	return nil
}

func timestamps(c *core.Collection) {
	c.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	c.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
}

func attachments(name string) *core.FileField {
	// Protected: dosyalar sadece geçerli dosya anahtarı (token) ve kaydı görme yetkisiyle indirilebilir.
	return &core.FileField{Name: name, MaxSelect: maxAttachment, MaxSize: maxFileSize, Thumbs: []string{"400x0"}, MimeTypes: attachmentMimes, Protected: true}
}

func userRel(users *core.Collection, name string, required bool, maxSelect int) *core.RelationField {
	return &core.RelationField{Name: name, CollectionId: users.Id, Required: required, MaxSelect: maxSelect}
}

func createDepartments(app core.App) (*core.Collection, error) {
	c := core.NewBaseCollection("departments")
	c.ListRule = types.Pointer(ruleAuth)
	c.ViewRule = types.Pointer(ruleAuth)
	c.CreateRule = types.Pointer(ruleAdmin)
	c.UpdateRule = types.Pointer(ruleAdmin)
	c.DeleteRule = types.Pointer(ruleAdmin)

	c.Fields.Add(&core.TextField{Name: "name", Required: true, Max: 100, Presentable: true})
	c.Fields.Add(&core.TextField{Name: "color", Max: 20})
	c.Fields.Add(&core.TextField{Name: "description", Max: 500})
	timestamps(c)
	c.AddIndex("idx_departments_name", true, "name", "")

	return c, app.Save(c)
}

func extendUsers(app core.App, departments *core.Collection) (*core.Collection, error) {
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return nil, err
	}

	// Kayıt herkese kapalı: kullanıcıları sadece admin açar.
	users.ListRule = types.Pointer(ruleAuth)
	users.ViewRule = types.Pointer(ruleAuth)
	users.CreateRule = types.Pointer(ruleAdmin)
	users.DeleteRule = types.Pointer(ruleAdmin)
	users.ManageRule = types.Pointer(ruleAdmin)
	users.UpdateRule = types.Pointer(ruleAdmin + ` || (id = @request.auth.id` +
		` && @request.body.role:isset = false` +
		` && @request.body.department:isset = false` +
		` && @request.body.active:isset = false` +
		` && @request.body.username:isset = false)`)
	// Pasif kullanıcı giriş yapamaz.
	users.AuthRule = types.Pointer(`active = true`)

	if email, ok := users.Fields.GetByName("email").(*core.EmailField); ok {
		email.Required = false // saha personelinin e-postası olmayabilir
	}
	if name, ok := users.Fields.GetByName("name").(*core.TextField); ok {
		name.Required = true
	}

	users.Fields.Add(&core.TextField{
		Name: "username", Required: true, Min: 3, Max: 50, Pattern: `^[a-z0-9._-]+$`, Presentable: true,
	})
	users.Fields.Add(&core.SelectField{Name: "role", Required: true, MaxSelect: 1, Values: []string{"admin", "manager", "staff"}})
	users.Fields.Add(&core.RelationField{Name: "department", CollectionId: departments.Id, MaxSelect: 1})
	users.Fields.Add(&core.TextField{Name: "title", Max: 100})
	users.Fields.Add(&core.TextField{Name: "phone", Max: 30})
	users.Fields.Add(&core.BoolField{Name: "active"})
	users.Fields.Add(&core.DateField{Name: "lastSeen"})
	users.AddIndex("idx_users_username", true, "username", "")

	users.PasswordAuth.IdentityFields = []string{"username", "email"}
	users.AuthToken.Duration = 60 * 60 * 24 * 14 // 14 gün; uygulama açıldıkça yenilenir

	return users, app.Save(users)
}

func createAnnouncements(app core.App, users, departments *core.Collection) error {
	c := core.NewBaseCollection("announcements")
	audience := `(departments:length = 0 || departments.id ?= @request.auth.department || author = @request.auth.id || ` + ruleAdmin + `)`
	owner := `(author = @request.auth.id || ` + ruleAdmin + `)`
	c.ListRule = types.Pointer(ruleAuth + ` && ` + audience)
	c.ViewRule = c.ListRule
	c.CreateRule = types.Pointer(ruleManager + ` && @request.body.author = @request.auth.id`)
	// Yetkisi düşürülen eski yönetici kendi duyurularını da düzenleyemez.
	c.UpdateRule = types.Pointer(ruleManager + ` && ` + owner + ` && (@request.body.author:isset = false || @request.body.author = author)`)
	c.DeleteRule = types.Pointer(ruleManager + ` && ` + owner)

	c.Fields.Add(&core.TextField{Name: "title", Required: true, Max: 200, Presentable: true})
	c.Fields.Add(&core.EditorField{Name: "body", MaxSize: 200_000})
	c.Fields.Add(userRel(users, "author", true, 1))
	c.Fields.Add(&core.RelationField{Name: "departments", CollectionId: departments.Id, MaxSelect: 50})
	c.Fields.Add(&core.SelectField{Name: "priority", Required: true, MaxSelect: 1, Values: []string{"normal", "important", "urgent"}})
	c.Fields.Add(&core.BoolField{Name: "pinned"})
	c.Fields.Add(&core.BoolField{Name: "requireAck"})
	c.Fields.Add(attachments("attachments"))
	timestamps(c)
	if err := app.Save(c); err != nil {
		return err
	}

	reads := core.NewBaseCollection("announcement_reads")
	reads.ListRule = types.Pointer(`user = @request.auth.id || announcement.author = @request.auth.id || ` + ruleAdmin)
	reads.ViewRule = reads.ListRule
	reads.CreateRule = types.Pointer(ruleAuth + ` && @request.body.user = @request.auth.id`)
	reads.Fields.Add(&core.RelationField{Name: "announcement", CollectionId: c.Id, Required: true, MaxSelect: 1, CascadeDelete: true})
	reads.Fields.Add(&core.RelationField{Name: "user", CollectionId: users.Id, Required: true, MaxSelect: 1, CascadeDelete: true})
	reads.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	reads.AddIndex("idx_announcement_reads_unique", true, "announcement, user", "")
	return app.Save(reads)
}

func createConversations(app core.App, users, _ *core.Collection) error {
	conv := core.NewBaseCollection("conversations")
	member := `members.id ?= @request.auth.id`
	conv.ListRule = types.Pointer(member)
	conv.ViewRule = types.Pointer(member)
	// Üyelik ve tip kontrolleri sunucu hook'unda yapılır.
	conv.CreateRule = types.Pointer(ruleAuth + ` && @request.body.createdBy = @request.auth.id`)
	conv.UpdateRule = types.Pointer(`type = "group" && (createdBy = @request.auth.id || ` + ruleAdmin + `)` +
		` && @request.body.type:isset = false && @request.body.directKey:isset = false && @request.body.createdBy:isset = false`)
	conv.DeleteRule = types.Pointer(`(createdBy = @request.auth.id && ` + member + `) || ` + ruleAdmin)

	conv.Fields.Add(&core.SelectField{Name: "type", Required: true, MaxSelect: 1, Values: []string{"direct", "group"}})
	conv.Fields.Add(&core.TextField{Name: "name", Max: 100})
	conv.Fields.Add(&core.RelationField{Name: "members", CollectionId: users.Id, Required: true, MinSelect: 2, MaxSelect: 200})
	conv.Fields.Add(userRel(users, "createdBy", true, 1))
	conv.Fields.Add(&core.TextField{Name: "directKey", Max: 100, Hidden: true})
	conv.Fields.Add(&core.DateField{Name: "lastMessageAt"})
	conv.Fields.Add(&core.TextField{Name: "lastMessageText", Max: 200})
	timestamps(conv)
	conv.AddIndex("idx_conversations_direct", true, "directKey", "directKey != ''")
	if err := app.Save(conv); err != nil {
		return err
	}

	msg := core.NewBaseCollection("messages")
	msg.ListRule = types.Pointer(`conversation.members.id ?= @request.auth.id`)
	msg.ViewRule = msg.ListRule
	msg.CreateRule = types.Pointer(ruleAuth + ` && @request.body.sender = @request.auth.id`)
	// Gruptan çıkarılan kişi eski mesajlarını da değiştiremez.
	msg.UpdateRule = types.Pointer(`sender = @request.auth.id && conversation.members.id ?= @request.auth.id && @request.body.conversation:isset = false && @request.body.sender:isset = false`)
	msg.DeleteRule = types.Pointer(`sender = @request.auth.id && conversation.members.id ?= @request.auth.id`)
	msg.Fields.Add(&core.RelationField{Name: "conversation", CollectionId: conv.Id, Required: true, MaxSelect: 1, CascadeDelete: true})
	msg.Fields.Add(userRel(users, "sender", true, 1))
	msg.Fields.Add(&core.TextField{Name: "text", Max: 5000})
	msg.Fields.Add(attachments("attachments"))
	timestamps(msg)
	msg.AddIndex("idx_messages_conv_created", false, "conversation, created", "")
	if err := app.Save(msg); err != nil {
		return err
	}

	// Okunma durumu yalnızca sunucu endpoint'i üzerinden yazılır.
	reads := core.NewBaseCollection("conversation_reads")
	reads.ListRule = types.Pointer(`user = @request.auth.id`)
	reads.ViewRule = reads.ListRule
	reads.Fields.Add(&core.RelationField{Name: "conversation", CollectionId: conv.Id, Required: true, MaxSelect: 1, CascadeDelete: true})
	reads.Fields.Add(&core.RelationField{Name: "user", CollectionId: users.Id, Required: true, MaxSelect: 1, CascadeDelete: true})
	reads.Fields.Add(&core.DateField{Name: "lastReadAt"})
	reads.AddIndex("idx_conversation_reads_unique", true, "conversation, user", "")
	return app.Save(reads)
}

func createEvents(app core.App, users, departments *core.Collection) error {
	c := core.NewBaseCollection("events")
	owner := `(createdBy = @request.auth.id || ` + ruleManager + `)`
	c.ListRule = types.Pointer(ruleAuth)
	c.ViewRule = types.Pointer(ruleAuth)
	c.CreateRule = types.Pointer(ruleAuth + ` && @request.body.createdBy = @request.auth.id`)
	c.UpdateRule = types.Pointer(owner + ` && (@request.body.createdBy:isset = false || @request.body.createdBy = createdBy)`)
	c.DeleteRule = types.Pointer(owner)

	c.Fields.Add(&core.TextField{Name: "title", Required: true, Max: 200, Presentable: true})
	c.Fields.Add(&core.TextField{Name: "description", Max: 5000})
	c.Fields.Add(&core.DateField{Name: "start", Required: true})
	c.Fields.Add(&core.DateField{Name: "end"})
	c.Fields.Add(&core.BoolField{Name: "allDay"})
	c.Fields.Add(&core.SelectField{Name: "category", Required: true, MaxSelect: 1,
		Values: []string{"meeting", "shipment", "production", "leave", "training", "visit", "other"}})
	c.Fields.Add(&core.TextField{Name: "location", Max: 200})
	c.Fields.Add(&core.RelationField{Name: "departments", CollectionId: departments.Id, MaxSelect: 50})
	c.Fields.Add(userRel(users, "participants", false, 200))
	c.Fields.Add(userRel(users, "createdBy", true, 1))
	timestamps(c)
	c.AddIndex("idx_events_start", false, "start", "")
	return app.Save(c)
}

func createTasks(app core.App, users, departments *core.Collection) error {
	c := core.NewBaseCollection("tasks")
	visible := `(assignees.id ?= @request.auth.id || createdBy = @request.auth.id || ` + ruleManager + `)`
	c.ListRule = types.Pointer(visible)
	c.ViewRule = types.Pointer(visible)
	c.CreateRule = types.Pointer(ruleAuth + ` && @request.body.createdBy = @request.auth.id`)
	// Atanan kişi yalnızca durumu değiştirebilir (hook ile zorlanır).
	c.UpdateRule = types.Pointer(visible + ` && (@request.body.createdBy:isset = false || @request.body.createdBy = createdBy)`)
	c.DeleteRule = types.Pointer(`createdBy = @request.auth.id || ` + ruleAdmin)

	c.Fields.Add(&core.TextField{Name: "title", Required: true, Max: 200, Presentable: true})
	c.Fields.Add(&core.TextField{Name: "description", Max: 10000})
	c.Fields.Add(&core.SelectField{Name: "status", Required: true, MaxSelect: 1, Values: []string{"todo", "in_progress", "review", "done"}})
	c.Fields.Add(&core.SelectField{Name: "priority", Required: true, MaxSelect: 1, Values: []string{"low", "normal", "high", "urgent"}})
	c.Fields.Add(&core.DateField{Name: "dueDate"})
	c.Fields.Add(userRel(users, "assignees", false, 50))
	c.Fields.Add(&core.RelationField{Name: "department", CollectionId: departments.Id, MaxSelect: 1})
	c.Fields.Add(userRel(users, "createdBy", true, 1))
	c.Fields.Add(&core.DateField{Name: "completedAt"})
	c.Fields.Add(attachments("attachments"))
	timestamps(c)
	if err := app.Save(c); err != nil {
		return err
	}

	comments := core.NewBaseCollection("task_comments")
	taskVisible := `(task.assignees.id ?= @request.auth.id || task.createdBy = @request.auth.id || ` + ruleManager + `)`
	comments.ListRule = types.Pointer(taskVisible)
	comments.ViewRule = types.Pointer(taskVisible)
	comments.CreateRule = types.Pointer(ruleAuth + ` && @request.body.author = @request.auth.id`)
	comments.DeleteRule = types.Pointer(`author = @request.auth.id || ` + ruleAdmin)
	comments.Fields.Add(&core.RelationField{Name: "task", CollectionId: c.Id, Required: true, MaxSelect: 1, CascadeDelete: true})
	comments.Fields.Add(userRel(users, "author", true, 1))
	comments.Fields.Add(&core.TextField{Name: "text", Required: true, Max: 5000})
	timestamps(comments)
	return app.Save(comments)
}

func createShifts(app core.App, users, departments *core.Collection) error {
	c := core.NewBaseCollection("shifts")
	c.ListRule = types.Pointer(ruleAuth)
	c.ViewRule = types.Pointer(ruleAuth)
	c.CreateRule = types.Pointer(ruleManager)
	c.UpdateRule = types.Pointer(ruleManager)
	c.DeleteRule = types.Pointer(ruleManager)

	c.Fields.Add(&core.RelationField{Name: "user", CollectionId: users.Id, Required: true, MaxSelect: 1, CascadeDelete: true})
	c.Fields.Add(&core.TextField{Name: "date", Required: true, Pattern: `^\d{4}-\d{2}-\d{2}$`}) // YYYY-AA-GG, saat dilimi sorunsuz
	c.Fields.Add(&core.SelectField{Name: "kind", Required: true, MaxSelect: 1,
		Values: []string{"morning", "evening", "night", "office", "off", "leave", "sick", "holiday"}})
	c.Fields.Add(&core.TextField{Name: "startTime", Pattern: `^([01]\d|2[0-3]):[0-5]\d$`})
	c.Fields.Add(&core.TextField{Name: "endTime", Pattern: `^([01]\d|2[0-3]):[0-5]\d$`})
	c.Fields.Add(&core.RelationField{Name: "department", CollectionId: departments.Id, MaxSelect: 1})
	c.Fields.Add(&core.TextField{Name: "note", Max: 500})
	timestamps(c)
	c.AddIndex("idx_shifts_user_date", true, "user, date", "")
	c.AddIndex("idx_shifts_date", false, "date", "")
	return app.Save(c)
}

func createProductionPlans(app core.App, users, departments *core.Collection) error {
	c := core.NewBaseCollection("production_plans")
	c.ListRule = types.Pointer(ruleAuth)
	c.ViewRule = types.Pointer(ruleAuth)
	c.CreateRule = types.Pointer(ruleManager + ` && @request.body.createdBy = @request.auth.id`)
	c.UpdateRule = types.Pointer(ruleManager)
	c.DeleteRule = types.Pointer(ruleManager)

	zero := 0.0
	c.Fields.Add(&core.TextField{Name: "date", Required: true, Pattern: `^\d{4}-\d{2}-\d{2}$`})
	c.Fields.Add(&core.TextField{Name: "product", Required: true, Max: 200, Presentable: true})
	c.Fields.Add(&core.TextField{Name: "productCode", Max: 50}) // ileride Logo stok kodu ile eşleşir
	c.Fields.Add(&core.NumberField{Name: "quantity", Min: &zero})
	c.Fields.Add(&core.SelectField{Name: "unit", MaxSelect: 1, Values: []string{"kg", "adet", "koli", "ton", "paket"}})
	c.Fields.Add(&core.NumberField{Name: "producedQuantity", Min: &zero})
	c.Fields.Add(&core.TextField{Name: "line", Max: 100})
	c.Fields.Add(&core.SelectField{Name: "status", Required: true, MaxSelect: 1, Values: []string{"planned", "in_progress", "done", "cancelled"}})
	c.Fields.Add(userRel(users, "responsible", false, 1))
	c.Fields.Add(&core.RelationField{Name: "department", CollectionId: departments.Id, MaxSelect: 1})
	c.Fields.Add(&core.TextField{Name: "notes", Max: 2000})
	c.Fields.Add(userRel(users, "createdBy", true, 1))
	timestamps(c)
	c.AddIndex("idx_production_plans_date", false, "date", "")
	return app.Save(c)
}

func createPushSubscriptions(app core.App, users, _ *core.Collection) error {
	c := core.NewBaseCollection("push_subscriptions")
	own := `user = @request.auth.id`
	c.ListRule = types.Pointer(own)
	c.ViewRule = types.Pointer(own)
	// Kayıt sadece /api/artu/push/subscribe üzerinden (adres doğrulamasıyla) yapılır.
	c.DeleteRule = types.Pointer(own)

	c.Fields.Add(&core.RelationField{Name: "user", CollectionId: users.Id, Required: true, MaxSelect: 1, CascadeDelete: true})
	c.Fields.Add(&core.TextField{Name: "endpoint", Required: true, Max: 1000})
	c.Fields.Add(&core.TextField{Name: "p256dh", Required: true, Max: 200})
	c.Fields.Add(&core.TextField{Name: "auth", Required: true, Max: 100})
	c.Fields.Add(&core.TextField{Name: "userAgent", Max: 300})
	timestamps(c)
	c.AddIndex("idx_push_endpoint", true, "endpoint", "")
	return app.Save(c)
}

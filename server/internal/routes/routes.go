// Package routes, portalın özel API uçlarını (/api/artu/*) tanımlar.
package routes

import (
	"net/http"
	"slices"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"artu-portal/internal/hooks"
	"artu-portal/internal/push"
)

const lastSeenThrottle = 2 * time.Minute

// PushService, push servisinin rotaların ihtiyaç duyduğu kısmıdır.
type PushService interface {
	PublicKey() string
	Subscribe(userID string, in push.SubscriptionInput) error
}

// Register, özel rotaları sunucuya bağlar.
func Register(se *core.ServeEvent, keys PushService) {
	g := se.Router.Group("/api/artu")
	g.Bind(apis.RequireAuth("users"))

	g.GET("/push/key", func(e *core.RequestEvent) error {
		return e.JSON(http.StatusOK, map[string]string{"publicKey": keys.PublicKey()})
	})
	g.POST("/push/subscribe", func(e *core.RequestEvent) error {
		var in push.SubscriptionInput
		if err := e.BindBody(&in); err != nil {
			return e.BadRequestError("Geçersiz istek.", err)
		}
		if err := keys.Subscribe(e.Auth.Id, in); err != nil {
			return e.BadRequestError(err.Error(), nil)
		}
		return e.NoContent(http.StatusNoContent)
	})
	g.GET("/unread", unreadHandler)
	g.POST("/conversations/direct", directConversationHandler)
	g.POST("/conversations/{id}/read", markReadHandler)
	g.POST("/conversations/{id}/leave", leaveHandler)
}

type unreadRow struct {
	ID    string `db:"id"`
	Count int    `db:"n"`
}

// unreadHandler, sohbet bazında okunmamış mesaj ve okunmamış duyuru sayılarını döndürür.
func unreadHandler(e *core.RequestEvent) error {
	uid := e.Auth.Id
	touchLastSeen(e.App, e.Auth)

	rows := []unreadRow{}
	err := e.App.DB().NewQuery(`
		SELECT m.conversation AS id, COUNT(*) AS n
		FROM messages m
		JOIN conversations c ON c.id = m.conversation
		LEFT JOIN conversation_reads r ON r.conversation = m.conversation AND r.user = {:uid}
		WHERE EXISTS (SELECT 1 FROM json_each(c.members) je WHERE je.value = {:uid})
		  AND m.sender != {:uid}
		  AND (r.lastReadAt IS NULL OR r.lastReadAt = '' OR m.created > r.lastReadAt)
		GROUP BY m.conversation`).
		Bind(dbx.Params{"uid": uid}).All(&rows)
	if err != nil {
		return e.InternalServerError("Okunmamış mesajlar hesaplanamadı.", err)
	}

	conversations := make(map[string]int, len(rows))
	for _, r := range rows {
		conversations[r.ID] = r.Count
	}

	var announcements int
	err = e.App.DB().NewQuery(`
		SELECT COUNT(*) FROM announcements a
		WHERE a.author != {:uid}
		  AND a.created >= {:since}
		  AND (
		    json_array_length(COALESCE(NULLIF(a.departments, ''), '[]')) = 0
		    OR {:role} = 'admin'
		    OR EXISTS (SELECT 1 FROM json_each(COALESCE(NULLIF(a.departments, ''), '[]')) d WHERE d.value = {:dept})
		  )
		  AND NOT EXISTS (SELECT 1 FROM announcement_reads r WHERE r.announcement = a.id AND r.user = {:uid})`).
		Bind(dbx.Params{
			"uid":   uid,
			"dept":  e.Auth.GetString("department"),
			"role":  e.Auth.GetString("role"),
			"since": e.Auth.GetDateTime("created").String(),
		}).Row(&announcements)
	if err != nil {
		return e.InternalServerError("Okunmamış duyurular hesaplanamadı.", err)
	}

	return e.JSON(http.StatusOK, map[string]any{
		"conversations": conversations,
		"announcements": announcements,
	})
}

func touchLastSeen(app core.App, user *core.Record) {
	if time.Since(user.GetDateTime("lastSeen").Time()) < lastSeenThrottle {
		return
	}
	fresh, err := app.FindRecordById("users", user.Id)
	if err != nil {
		return
	}
	fresh.Set("lastSeen", types.NowDateTime())
	if err := app.UnsafeWithoutHooks().Save(fresh); err != nil {
		app.Logger().Warn("lastSeen güncellenemedi", "error", err)
	}
}

// directConversationHandler, iki kişi arasındaki sohbeti bulur ya da oluşturur.
func directConversationHandler(e *core.RequestEvent) error {
	var body struct {
		UserID string `json:"userId"`
	}
	if err := e.BindBody(&body); err != nil || body.UserID == "" {
		return e.BadRequestError("userId zorunludur.", err)
	}
	if body.UserID == e.Auth.Id {
		return e.BadRequestError("Kendinizle sohbet başlatamazsınız.", nil)
	}
	other, err := e.App.FindRecordById("users", body.UserID)
	if err != nil || !other.GetBool("active") {
		return e.NotFoundError("Kullanıcı bulunamadı.", err)
	}

	key := hooks.DirectKey(e.Auth.Id, other.Id)
	if existing, err := e.App.FindFirstRecordByData("conversations", "directKey", key); err == nil {
		return e.JSON(http.StatusOK, existing)
	}

	collection, err := e.App.FindCollectionByNameOrId("conversations")
	if err != nil {
		return e.InternalServerError("", err)
	}
	conv := core.NewRecord(collection)
	conv.Set("type", "direct")
	conv.Set("members", []string{e.Auth.Id, other.Id})
	conv.Set("createdBy", e.Auth.Id)
	conv.Set("directKey", key)
	conv.Set("lastMessageAt", types.NowDateTime())
	if err := e.App.Save(conv); err != nil {
		// Aynı anda iki istek gelmişse mevcut kaydı döndür.
		if existing, findErr := e.App.FindFirstRecordByData("conversations", "directKey", key); findErr == nil {
			return e.JSON(http.StatusOK, existing)
		}
		return e.BadRequestError("Sohbet oluşturulamadı.", err)
	}
	return e.JSON(http.StatusOK, conv)
}

func findMemberConversation(e *core.RequestEvent) (*core.Record, error) {
	conv, err := e.App.FindRecordById("conversations", e.Request.PathValue("id"))
	if err != nil || !slices.Contains(conv.GetStringSlice("members"), e.Auth.Id) {
		return nil, e.NotFoundError("Sohbet bulunamadı.", err)
	}
	return conv, nil
}

func markReadHandler(e *core.RequestEvent) error {
	conv, err := findMemberConversation(e)
	if err != nil {
		return err
	}

	read, err := e.App.FindFirstRecordByFilter("conversation_reads",
		"conversation = {:c} && user = {:u}", dbx.Params{"c": conv.Id, "u": e.Auth.Id})
	if err != nil {
		collection, cErr := e.App.FindCollectionByNameOrId("conversation_reads")
		if cErr != nil {
			return e.InternalServerError("", cErr)
		}
		read = core.NewRecord(collection)
		read.Set("conversation", conv.Id)
		read.Set("user", e.Auth.Id)
	}
	read.Set("lastReadAt", types.NowDateTime())
	if err := e.App.Save(read); err != nil {
		return e.InternalServerError("Okundu bilgisi kaydedilemedi.", err)
	}
	return e.NoContent(http.StatusNoContent)
}

func leaveHandler(e *core.RequestEvent) error {
	conv, err := findMemberConversation(e)
	if err != nil {
		return err
	}
	if conv.GetString("type") != "group" {
		return e.BadRequestError("Sadece gruplardan ayrılabilirsiniz.", nil)
	}

	remaining := slices.DeleteFunc(conv.GetStringSlice("members"), func(id string) bool { return id == e.Auth.Id })
	if len(remaining) < 2 {
		if err := e.App.Delete(conv); err != nil {
			return e.InternalServerError("Grup kapatılamadı.", err)
		}
		return e.NoContent(http.StatusNoContent)
	}

	conv.Set("members", remaining)
	if conv.GetString("createdBy") == e.Auth.Id {
		conv.Set("createdBy", remaining[0]) // yönetimi kalan ilk üyeye devret
	}
	if err := e.App.Save(conv); err != nil {
		return e.InternalServerError("Gruptan ayrılınamadı.", err)
	}
	return e.NoContent(http.StatusNoContent)
}

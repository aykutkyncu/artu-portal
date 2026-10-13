package main

import "testing"

func TestIsLoopback(t *testing.T) {
	cases := []struct {
		addr string
		want bool
	}{
		{"127.0.0.1:52344", true},
		{"[::1]:8090", true},
		{"192.168.1.20:5000", false}, // şirket ağı
		{"10.0.0.5:1234", false},
		{"88.230.12.4:44321", false}, // internet
		{"", false},
		{"bozuk", false},
	}
	for _, c := range cases {
		if got := isLoopback(c.addr); got != c.want {
			t.Errorf("isLoopback(%q) = %v, istenen %v", c.addr, got, c.want)
		}
	}
}

func TestIsAdminPath(t *testing.T) {
	cases := map[string]bool{
		"/_/":                true,
		"/_":                 true,
		"/_/images/logo.svg": true,
		"/api/settings":      true,
		"/api/backups/x.zip": true,
		"/api/logs":          true,
		"/api/crons":         true,
		"/api/collections/_superusers/auth-with-password": true,
		"/api/collections/users/auth-with-password":       false,
		"/api/collections/messages/records":               false,
		"/api/artu/unread":                                false,
		"/api/files/token":                                false,
		"/mesajlar":                                       false,
		"/":                                               false,
	}
	for path, want := range cases {
		if got := isAdminPath(path); got != want {
			t.Errorf("isAdminPath(%q) = %v, istenen %v", path, got, want)
		}
	}
}

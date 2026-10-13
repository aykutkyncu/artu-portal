package cli

import (
	"slices"
	"testing"
)

func TestServiceArgs(t *testing.T) {
	cases := []struct {
		name string
		opts serviceOptions
		want []string
	}{
		{"yerel varsayılan", serviceOptions{}, []string{"serve", "--http=127.0.0.1:8090"}},
		{"alan adı", serviceOptions{domain: "portal.artucikolata.com.tr"}, []string{"serve", "portal.artucikolata.com.tr"}},
		{
			"iki alan adı (boşluklu)",
			serviceOptions{domain: "portal.artucikolata.com.tr, 78-188-21-132.sslip.io"},
			[]string{"serve", "portal.artucikolata.com.tr", "78-188-21-132.sslip.io"},
		},
		{"sadece virgül", serviceOptions{domain: " , "}, []string{"serve", "--http=127.0.0.1:8090"}},
		{
			"alan adı + özel port",
			serviceOptions{domain: "portal.artucikolata.com.tr", httpAddr: "0.0.0.0:8080", httpsAddr: "0.0.0.0:8443"},
			[]string{"serve", "portal.artucikolata.com.tr", "--http=0.0.0.0:8080", "--https=0.0.0.0:8443"},
		},
	}
	for _, c := range cases {
		if got := c.opts.args(); !slices.Equal(got, c.want) {
			t.Errorf("%s: %v, istenen %v", c.name, got, c.want)
		}
	}
}

// Copyright 2026 The Gitea Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package auth

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	user_model "gitea.dev/models/user"
	"gitea.dev/modules/json"
)

// The VOS image binds Gitea to loopback; only its validating gateway sets these headers.
func syncVOSUser(req *http.Request, user *user_model.User) error {
	if os.Getenv("VOS_AUTH_ENABLED") != "true" || !strings.HasPrefix(user.Name, "vos-") || req.Header.Get("X-VOS-Subject") == "" {
		return nil
	}
	name, err := url.PathUnescape(req.Header.Get("X-VOS-Display-Name"))
	if err != nil {
		return err
	}
	admin := req.Header.Get("X-VOS-Admin") == "true"
	lang := req.Header.Get("X-VOS-Language")
	subject := "vos:" + req.Header.Get("X-VOS-Subject")
	if user.LoginName != "" && user.LoginName != subject {
		return errors.New("VOS subject binding mismatch")
	}
	if name == user.FullName && admin == user.IsAdmin && (lang == "" || lang == user.Language) && user.LoginName == subject {
		return nil
	}
	user.FullName = name
	user.LoginName = subject
	// VOS owns this role even when the user is Gitea's last administrator.
	user.IsAdmin = admin
	if lang == "en-US" || lang == "zh-CN" || lang == "zh-TW" {
		user.Language = lang
	}
	return user_model.UpdateUserCols(req.Context(), user, "full_name", "is_admin", "language", "login_name")
}

// ValidateVOSUser keeps native PAT and SSH authentication subject to current VOS account state.
func ValidateVOSUser(ctx context.Context, u *user_model.User) error {
	if os.Getenv("VOS_AUTH_ENABLED") != "true" || !user_model.IsVOSUser(u) {
		return nil
	}
	token, endpoint := os.Getenv("VOS_CONTEXT_TOKEN"), os.Getenv("VOS_USERS_URL")
	if token == "" || endpoint == "" {
		return errors.New("VOS account verification is unavailable")
	}
	subject := strings.TrimPrefix(u.LoginName, "vos:")
	target, err := url.Parse(endpoint)
	if err != nil {
		return err
	}
	query := target.Query()
	query.Set("page_num", "1")
	query.Set("page_size", "1")
	query.Set("user_id", subject)
	target.RawQuery = query.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	client := &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		return errors.New("VOS account verification failed")
	}
	defer response.Body.Close()
	var payload struct {
		Code *int `json:"code"`
		Data struct {
			Data []struct {
				ID       string `json:"id"`
				Nickname string `json:"nickname"`
				Username string `json:"username"`
				RoleCode string `json:"role_code"`
				Enable   int    `json:"enable"`
				Delete   int    `json:"delete"`
			} `json:"data"`
		} `json:"data"`
	}
	if response.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(response.Body, 1024*1024)).Decode(&payload) != nil || payload.Code == nil || *payload.Code != 0 || len(payload.Data.Data) != 1 {
		return errors.New("VOS account verification failed")
	}
	profile := payload.Data.Data[0]
	if profile.ID != subject || profile.Enable != 1 || profile.Delete != 0 {
		return errors.New("VOS account is disabled or deleted")
	}
	name := profile.Nickname
	if name == "" {
		name = profile.Username
	}
	admin := profile.RoleCode == "system_admin"
	if name == u.FullName && admin == u.IsAdmin {
		return nil
	}
	u.FullName, u.IsAdmin = name, admin
	return user_model.UpdateUserCols(ctx, u, "full_name", "is_admin")
}

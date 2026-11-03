// Copyright 2026 The Gitea Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package auth

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	audit_model "gitea.dev/models/audit"
	"gitea.dev/models/db"
	user_model "gitea.dev/models/user"
	"gitea.dev/modules/json"
	"gitea.dev/modules/optional"
	"gitea.dev/services/audit"
	user_service "gitea.dev/services/user"

	"xorm.io/builder"
)

// The VOS image binds Gitea to loopback; only its validating gateway sets these headers.
func isVOSProxyRequest(req *http.Request) bool {
	return os.Getenv("VOS_AUTH_ENABLED") == "true" && req.Header.Get("X-VOS-Subject") != ""
}

// The VOS package runs one Gitea process. Serialize enrollment and legacy renames
// so simultaneous requests for the same subject cannot create multiple accounts.
var vosEnrollmentMu sync.Mutex

func (r *ReverseProxy) getVOSUser(req *http.Request) (*user_model.User, error) {
	ctx := req.Context()
	subject := req.Header.Get("X-VOS-Subject")
	binding := "vos:" + subject
	digest := sha256.Sum256([]byte(subject))
	legacy := fmt.Sprintf("vos-%x", digest[:12])
	if r.getUserName(req) != legacy {
		return nil, errors.New("VOS subject binding mismatch")
	}
	preferred, err := url.PathUnescape(req.Header.Get("X-VOS-Username"))
	if err != nil {
		return nil, err
	}
	preferred = strings.TrimSpace(preferred)

	vosEnrollmentMu.Lock()
	defer vosEnrollmentMu.Unlock()

	u, found, err := db.Get[user_model.User](ctx, builder.Eq{"login_name": binding})
	if err != nil {
		return nil, err
	}
	if found && (!u.IsIndividual() || u.LoginName != binding) {
		return nil, errors.New("invalid VOS account binding")
	}
	if !found && !r.isAutoRegisterAllowed() {
		return nil, nil //nolint:nilnil // no registered account for this subject
	}
	if !found || u.LowerName == legacy {
		handle := legacy
		if preferred != "" {
			for _, candidate := range []string{preferred, fmt.Sprintf("%s-%x", preferred, digest[:4])} {
				if user_model.IsUsableUsername(candidate) != nil {
					continue
				}
				taken, err := user_model.IsUserExist(ctx, 0, candidate)
				if err != nil {
					return nil, err
				}
				if taken {
					continue
				}
				if _, err := user_model.LookupUserRedirect(ctx, candidate); err == nil {
					continue
				} else if !user_model.IsErrUserRedirectNotExist(err) {
					return nil, err
				}
				handle = candidate
				break
			}
		}
		if !found {
			u = &user_model.User{Name: handle, LoginName: binding, Email: legacy + "@vos.invalid"}
			options := user_model.CreateUserOverwriteOptions{IsActive: optional.Some(true), KeepEmailPrivate: optional.Some(true)}
			if err := user_model.CreateUser(ctx, u, &user_model.Meta{}, &options); err != nil {
				return nil, err
			}
			audit.RecordAs(ctx, user_model.NewAuthSourceUser(), audit_model.UserCreate, u)
		} else if handle != legacy {
			if err := user_service.RenameVOSUser(ctx, u, handle); err != nil {
				return nil, err
			}
		}
	}
	if err := syncVOSUser(req, u); err != nil {
		return nil, err
	}
	return u, nil
}

func syncVOSUser(req *http.Request, user *user_model.User) error {
	name, err := url.PathUnescape(req.Header.Get("X-VOS-Display-Name"))
	if err != nil {
		return err
	}
	admin := req.Header.Get("X-VOS-Admin") == "true"
	lang := req.Header.Get("X-VOS-Language")
	if name == user.FullName && admin == user.IsAdmin && (lang == "" || lang == user.Language) {
		return nil
	}
	user.FullName = name
	// VOS owns this role even when the user is Gitea's last administrator.
	user.IsAdmin = admin
	if lang == "en-US" || lang == "zh-CN" || lang == "zh-TW" {
		user.Language = lang
	}
	return user_model.UpdateUserCols(req.Context(), user, "full_name", "is_admin", "language")
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

// Copyright 2026 The Gitea Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"gitea.dev/models/unittest"
	user_model "gitea.dev/models/user"

	"github.com/stretchr/testify/require"
)

func TestSyncVOSUserLocale(t *testing.T) {
	require.NoError(t, unittest.PrepareTestDatabase())

	user := unittest.AssertExistsAndLoadBean(t, &user_model.User{ID: 1})
	require.Empty(t, user.Language)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-VOS-Language", "zh-CN")
	req.Header.Set("X-VOS-Display-Name", user.FullName)
	req.Header.Set("X-VOS-Admin", "true")

	require.NoError(t, user_model.SetUserSetting(t.Context(), user.ID, user_model.SettingsKeyFollowVOSLocale, "false"))
	require.NoError(t, syncVOSUser(req, user))
	user = unittest.AssertExistsAndLoadBean(t, &user_model.User{ID: 1})
	require.Empty(t, user.Language, "a fixed language must survive the platform language")

	require.NoError(t, user_model.DeleteUserSetting(t.Context(), user.ID, user_model.SettingsKeyFollowVOSLocale))
	require.NoError(t, syncVOSUser(req, user))
	user = unittest.AssertExistsAndLoadBean(t, &user_model.User{ID: 1})
	require.Equal(t, "zh-CN", user.Language, "the default follows the platform language")
}

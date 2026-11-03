// Copyright 2026 The Gitea Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package user

import "strings"

// IsVOSUser identifies the immutable VOS subject binding, independently of display names.
func IsVOSUser(u *User) bool {
	return strings.HasPrefix(u.LoginName, "vos:")
}

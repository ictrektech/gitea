// Copyright 2026 The Gitea Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package public

import (
	"os"
	"path/filepath"
	"testing"

	"gitea.dev/modules/setting"
	"gitea.dev/modules/test"

	"github.com/stretchr/testify/assert"
)

func TestViteDevBasePath(t *testing.T) {
	defer test.MockVariableValue(&setting.StaticRootPath, t.TempDir())()
	defer test.MockVariableValue(&setting.AppSubURL, "/sub")()
	baseFile := filepath.Join(setting.StaticRootPath, viteDevBaseFile)

	// without the file, assume the site sub path, which is what the dev container passes as "--base"
	assert.Equal(t, "/sub", getViteDevBasePath())

	// the dev server runs at the site root, nothing may be added to the proxied path
	assert.NoError(t, os.MkdirAll(filepath.Dir(baseFile), 0o750))
	assert.NoError(t, os.WriteFile(baseFile, []byte("/"), 0o600))
	assert.Empty(t, getViteDevBasePath())

	// the dev server runs under the sub path
	assert.NoError(t, os.WriteFile(baseFile, []byte("/app/foo/"), 0o600))
	assert.Equal(t, "/app/foo", getViteDevBasePath())
}

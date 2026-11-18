//go:build !cli

/*
 * CloudCord Desktop Installer
 * Copyright (c) 2026 Xohus and CloudCord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

package main

import (
	"context"
	"embed"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	wr "github.com/wailsapp/wails/v2/pkg/runtime"

	"sinlotl/buildinfo"
)

//go:embed all:frontend
var frontendFiles embed.FS

// App is bound to the web UI. Every exported method is callable from JavaScript
// as window.go.main.App.<Method>.
type App struct {
	ctx context.Context

	mu           sync.Mutex
	discords     []any
	busy         bool
	status       string
	releaseReady bool
}

var app = &App{}

func init() {
	LogLevel = LevelDebug
}

func main() {
	InitGithubDownloader()
	app.discords = FindDiscords()

	ui, err := fs.Sub(frontendFiles, "frontend")
	if err != nil {
		panic(err)
	}

	err = wails.Run(&options.App{
		Title:            "CloudCord Setup",
		Width:            860,
		Height:           540,
		MinWidth:         760,
		MinHeight:        500,
		Frameless:        true,
		BackgroundColour: &options.RGBA{R: 14, G: 14, B: 14, A: 255},
		AssetServer:      &assetserver.Options{Assets: ui},
		OnStartup:        app.startup,
		OnBeforeClose: func(ctx context.Context) bool {
			app.mu.Lock()
			defer app.mu.Unlock()
			return app.busy // keep the window open while files are being changed
		},
		Bind: []any{app},
		Windows: &windows.Options{
			Theme:               windows.Dark,
			WebviewUserDataPath: filepath.Join(os.TempDir(), "CloudCordSetup-webview"),
		},
	})
	if err != nil {
		Log.Error("UI failed to start:", err)
		os.Exit(1)
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	go func() {
		<-GithubDoneChan
		a.mu.Lock()
		a.releaseReady = true
		a.mu.Unlock()
		wr.EventsEmit(a.ctx, "state")
	}()
	go func() {
		<-SelfUpdateCheckDoneChan
		wr.EventsEmit(a.ctx, "state")
	}()
}

type InstallView struct {
	Label   string `json:"label"`
	Path    string `json:"path"`
	Branch  string `json:"branch"`
	Patched bool   `json:"patched"`
}

type StateView struct {
	Installs        []InstallView `json:"installs"`
	ReleaseReady    bool          `json:"releaseReady"`
	Busy            bool          `json:"busy"`
	Status          string        `json:"status"`
	Version         string        `json:"version"`
	UpdateAvailable bool          `json:"updateAvailable"`
	DownloadURL     string        `json:"downloadUrl"`
	OS              string        `json:"os"`
}

func (a *App) State() StateView {
	a.mu.Lock()
	defer a.mu.Unlock()
	view := StateView{
		Installs:        []InstallView{},
		ReleaseReady:    a.releaseReady,
		Busy:            a.busy,
		Status:          a.status,
		Version:         buildinfo.InstallerTag,
		UpdateAvailable: IsSelfOutdated,
		DownloadURL:     GetInstallerDownloadLink(),
		OS:              runtime.GOOS,
	}
	for _, candidate := range a.discords {
		di := candidate.(*DiscordInstall)
		view.Installs = append(view.Installs, InstallView{
			Label:   strings.Title(di.branch),
			Path:    di.path,
			Branch:  di.branch,
			Patched: di.isPatched,
		})
	}
	return view
}

func (a *App) Rescan() StateView {
	a.mu.Lock()
	if !a.busy {
		a.discords = FindDiscords()
	}
	a.mu.Unlock()
	return a.State()
}

func (a *App) PickFolder() string {
	dir, err := wr.OpenDirectoryDialog(a.ctx, wr.OpenDialogOptions{Title: "Choose your Discord folder"})
	if err != nil {
		return ""
	}
	return dir
}

func (a *App) OpenURL(url string) {
	if strings.HasPrefix(url, "https://") {
		wr.BrowserOpenURL(a.ctx, url)
	}
}

func (a *App) Minimise() { wr.WindowMinimise(a.ctx) }

func (a *App) Quit() {
	a.mu.Lock()
	busy := a.busy
	a.mu.Unlock()
	if !busy {
		wr.Quit(a.ctx)
	}
}

// chosen resolves either a detected install (index >= 0) or a custom folder.
func (a *App) chosen(index int, customDir string) *DiscordInstall {
	if index >= 0 && index < len(a.discords) {
		return a.discords[index].(*DiscordInstall)
	}
	if customDir == "" {
		return nil
	}
	choice := ParseDiscord(customDir, "")
	if choice == nil {
		choice = ParseDiscordNew(customDir, "", strings.Contains(customDir, "com.discordapp"))
	}
	return choice
}

// Install patches (or repairs) the chosen Discord. Progress and the result
// arrive as "state" and "done" events. A non-empty return is an immediate error.
func (a *App) Install(index int, customDir string, update bool) string {
	return a.run(index, customDir, "install", update)
}

func (a *App) Uninstall(index int, customDir string) string {
	return a.run(index, customDir, "uninstall", false)
}

func (a *App) run(index int, customDir, action string, update bool) string {
	a.mu.Lock()
	if a.busy {
		a.mu.Unlock()
		return "Another action is still running."
	}
	if action == "install" && !a.releaseReady {
		a.mu.Unlock()
		return "Still checking for the latest CloudCord build. Try again in a moment."
	}
	choice := a.chosen(index, customDir)
	if choice == nil {
		a.mu.Unlock()
		return "That folder doesn't look like a Discord installation. Nothing was changed."
	}
	if action == "install" && CheckScuffedInstall() {
		a.mu.Unlock()
		return "" // CheckScuffedInstall already showed the notice
	}
	work := *choice
	a.busy = true
	if action == "install" {
		a.status = "Downloading the latest CloudCord build…"
	} else {
		a.status = "Removing CloudCord…"
	}
	a.mu.Unlock()
	wr.EventsEmit(a.ctx, "state")

	go func() {
		var err error
		if action == "install" {
			err = work.patch()
		} else {
			err = work.unpatch()
		}
		a.mu.Lock()
		*choice = work
		a.busy = false
		a.status = ""
		a.mu.Unlock()
		wr.EventsEmit(a.ctx, "state")

		ok := err == nil
		var title, msg string
		switch {
		case ok && action == "install" && update:
			title, msg = "CloudCord updated", "Open Discord. Your plugins, themes and settings were kept."
		case ok && action == "install":
			title, msg = "CloudCord installed", "Open Discord, then go to Settings → CloudCord."
		case ok:
			title, msg = "CloudCord removed", "Restart Discord to go back to stock."
		case errors.Is(err, ErrAlreadyReported):
			return
		default:
			title = "Couldn't " + action + " CloudCord"
			msg = err.Error()
			if errors.Is(err, os.ErrPermission) {
				if runtime.GOOS == "windows" {
					msg = "Permission denied. Fully close Discord, including from the system tray, then try again."
				} else {
					msg = "Permission denied. Try running the installer as an administrator."
				}
			}
		}
		wr.EventsEmit(a.ctx, "done", map[string]any{"ok": ok, "title": title, "message": msg})
	}()
	return ""
}

func InstallLatestBuilds() (err error) {
	if IsDevInstall {
		return
	}
	return installLatestBuilds()
}

func ShowInstallerNotice(title, desc string) {
	if app.ctx != nil {
		wr.EventsEmit(app.ctx, "done", map[string]any{"ok": false, "title": title, "message": desc})
	}
}

func HandleScuffedInstall() {
	ShowInstallerNotice("Broken Discord install", "You have a broken Discord install in ProgramData. Reinstall Discord before continuing.")
}

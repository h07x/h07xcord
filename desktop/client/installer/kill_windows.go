//go:build windows

package main

import (
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

// killProcessesByName closes Discord so its files can be replaced. It uses the
// Windows process APIs directly instead of shelling out to taskkill.
func killProcessesByName(names ...string) {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return
	}
	defer windows.CloseHandle(snap)

	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	for err = windows.Process32First(snap, &entry); err == nil; err = windows.Process32Next(snap, &entry) {
		exe := windows.UTF16ToString(entry.ExeFile[:])
		for _, name := range names {
			if strings.EqualFold(exe, name) {
				if h, err := windows.OpenProcess(windows.PROCESS_TERMINATE, false, entry.ProcessID); err == nil {
					_ = windows.TerminateProcess(h, 0)
					_ = windows.CloseHandle(h)
				}
			}
		}
	}
}

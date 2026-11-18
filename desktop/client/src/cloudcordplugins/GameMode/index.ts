/*
 * CloudCord Game Mode
 * Copyright (c) 2026 xohus and CloudCord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { RunningGameStore } from "@webpack/common";

// Makes Discord lighter on slow PCs: no animations, blur or shadows, and no animated
// decorations, profile effects or nameplates. By default only while a game is running.
const CLASS = "cc-game-mode";

const settings = definePluginSettings({
    onlyWhileGaming: {
        type: OptionType.BOOLEAN,
        description: "Only while a game is running (turn off to keep Discord light all the time)",
        default: true,
        onChange: () => apply(),
    },
    hideCosmetics: {
        type: OptionType.BOOLEAN,
        description: "Also hide animated avatar decorations, profile effects and nameplates",
        default: true,
        onChange: () => apply(),
    },
    pauseMedia: {
        type: OptionType.BOOLEAN,
        description: "Pause GIFs and looping videos while you're in your game (Discord not focused)",
        default: true,
        onChange: () => apply(),
    },
    freeMemory: {
        type: OptionType.BOOLEAN,
        description: "Free unused memory when a game starts and every 5 minutes while playing (desktop app only)",
        default: true,
        onChange: () => apply(),
    },
});

let gaming = false;
let memoryTimer: ReturnType<typeof setInterval> | null = null;
// Only the videos we paused, so we never resume something the user paused.
const paused = new Set<HTMLVideoElement>();

function purgeMemory() {
    try { (window as any).DiscordNative?.processUtils?.purgeMemory?.(); } catch { }
}
function pauseLooping() {
    if (!active() || !settings.store.pauseMedia || document.hasFocus()) return;
    for (const video of document.querySelectorAll<HTMLVideoElement>("video")) {
        if (!video.paused && (video.loop || video.autoplay)) { video.pause(); paused.add(video); }
    }
}
function resumeLooping() {
    for (const video of paused) if (video.isConnected) video.play().catch(() => { });
    paused.clear();
}
function active() { return !settings.store.onlyWhileGaming || gaming; }

function apply() {
    const on = active();
    document.documentElement.classList.toggle(CLASS, on);
    document.documentElement.classList.toggle(CLASS + "-cosmetics", on && settings.store.hideCosmetics);
    const wantTimer = on && gaming && settings.store.freeMemory;
    if (wantTimer && !memoryTimer) { purgeMemory(); memoryTimer = setInterval(purgeMemory, 5 * 60_000); }
    else if (!wantTimer && memoryTimer) { clearInterval(memoryTimer); memoryTimer = null; }
    if (on && settings.store.pauseMedia) pauseLooping(); else resumeLooping();
}

export default definePlugin({
    name: "GameMode",
    description: "Makes Discord lighter while you play: turns off animations, blur, shadows and animated profile extras, pauses GIFs while you play and frees unused memory so your game gets more of your PC.",
    authors: [Devs.Xohus],
    tags: ["Appearance", "Utility"],
    settings,
    flux: {
        RUNNING_GAMES_CHANGE({ games }: { games: any[]; }) {
            gaming = Array.isArray(games) && games.length > 0;
            apply();
        },
    },
    start() {
        try { gaming = (RunningGameStore?.getRunningGames?.() ?? []).length > 0; } catch { gaming = false; }
        window.addEventListener("blur", pauseLooping);
        window.addEventListener("focus", resumeLooping);
        apply();
    },
    stop() {
        window.removeEventListener("blur", pauseLooping);
        window.removeEventListener("focus", resumeLooping);
        if (memoryTimer) { clearInterval(memoryTimer); memoryTimer = null; }
        resumeLooping();
        document.documentElement.classList.remove(CLASS, CLASS + "-cosmetics");
    },
});

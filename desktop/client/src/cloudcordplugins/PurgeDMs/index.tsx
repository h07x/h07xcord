/*
 * CloudCord Purge DMs
 * Copyright (c) 2026 xohus and CloudCord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Channel } from "@vencord/discord-types";
import { Devs } from "@utils/constants";
import { MIN_DELAY_MS, PURGE_DEFAULTS, purgeOwnMessages, PurgeProgress, PurgeSignal } from "@utils/purgeDm";
import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";
import { Alerts, ChannelStore, Menu, RestAPI, showToast, Toasts, UserStore } from "@webpack/common";

const DM = 1;

const settings = definePluginSettings({
    delaySeconds: {
        type: OptionType.NUMBER,
        description: `Seconds between deletes (at least ${MIN_DELAY_MS / 1000}). Doubles for the rest of a run after Discord rate limits you.`,
        default: PURGE_DEFAULTS.delayMs / 1000,
        isValid: (value: number) => value >= MIN_DELAY_MS / 1000 || `At least ${MIN_DELAY_MS / 1000} seconds.`,
    },
    jitterSeconds: {
        type: OptionType.NUMBER,
        description: "Random extra seconds added to each delay (0 to this)",
        default: PURGE_DEFAULTS.jitterMs / 1000,
        isValid: (value: number) => value >= 0 || "Can't be negative.",
    },
    burstEvery: {
        type: OptionType.NUMBER,
        description: "Take a longer pause after this many deletes (0 = never)",
        default: PURGE_DEFAULTS.burstEvery,
        isValid: (value: number) => (value >= 0 && Number.isInteger(value)) || "A whole number, 0 or more.",
    },
    burstPauseSeconds: {
        type: OptionType.NUMBER,
        description: "Length of that pause in seconds",
        default: PURGE_DEFAULTS.burstPauseMs / 1000,
        isValid: (value: number) => value >= 0 || "Can't be negative.",
    },
    maxPerRun: {
        type: OptionType.NUMBER,
        description: "Most messages to delete in one run (0 = no limit). Run it again to continue.",
        default: PURGE_DEFAULTS.maxPerRun,
        isValid: (value: number) => (value >= 0 && Number.isInteger(value)) || "A whole number, 0 or more.",
    },
});
const seconds = (ms: number) => `${(ms / 1000).toFixed(ms % 1000 ? 1 : 0)}s`;
let running: { channelId: string; signal: PurgeSignal; bar: HTMLElement; } | null = null;

function nameOf(channel: Channel) {
    const user = UserStore.getUser(channel.recipients?.[0]);
    return (user as any)?.globalName || user?.username || "this user";
}

function progressBar(name: string, cancel: () => void) {
    const bar = document.createElement("div");
    bar.className = "cc-purge-bar";
    bar.innerHTML = '<span class="cc-purge-text"></span><button type="button" class="cc-purge-cancel">Cancel</button>';
    bar.querySelector("button")!.addEventListener("click", cancel);
    document.body.appendChild(bar);
    const text = bar.querySelector<HTMLElement>(".cc-purge-text")!;
    return {
        bar, update: ({ deleted, found, delay, nextPauseIn, waiting }: PurgeProgress) => {
            const pace = waiting?.reason === "burst" ? `pausing ${seconds(waiting.ms)}`
                : waiting?.reason === "rateLimit" ? `rate limited, waiting ${seconds(waiting.ms)}`
                    : `delay ${seconds(delay)}${nextPauseIn ? `, pause in ${nextPauseIn}` : ""}`;
            text.textContent = `Purging your messages with ${name}: ${deleted} deleted, ${found} found · ${pace}`;
        }
    };
}

function stopRunning() {
    if (!running) return;
    running.signal.cancelled = true;
    running.bar.remove();
    running = null;
}

async function purge(channel: Channel) {
    const me = UserStore.getCurrentUser()?.id;
    // Only one-to-one DMs: never servers or group chats.
    if (!me || channel.type !== DM || channel.guild_id) return;
    if (running) return showToast("A purge is already running.", Toasts.Type.FAILURE);
    const name = nameOf(channel);
    const signal: PurgeSignal = { cancelled: false };
    const { bar, update } = progressBar(name, () => { signal.cancelled = true; });
    running = { channelId: channel.id, signal, bar };
    update({ deleted: 0, found: 0, delay: Math.max(MIN_DELAY_MS, settings.store.delaySeconds * 1000), nextPauseIn: settings.store.burstEvery });
    try {
        const { delaySeconds, jitterSeconds, burstEvery, burstPauseSeconds, maxPerRun } = settings.store;
        const result = await purgeOwnMessages({
            rest: RestAPI as any, channelId: channel.id, authorId: me, signal, onProgress: update,
            delayMs: Math.max(MIN_DELAY_MS, delaySeconds * 1000), jitterMs: jitterSeconds * 1000,
            burstEvery, burstPauseMs: burstPauseSeconds * 1000, maxPerRun,
        });
        const skipped = result.skipped ? `, ${result.skipped} couldn't be deleted` : "";
        const message = {
            done: `Purge finished: ${result.deleted} deleted${skipped}.`,
            cancelled: `Purge cancelled: ${result.deleted} deleted${skipped}.`,
            limit: `Deleted ${result.deleted}, the most for one run${skipped}. Run again to continue.`,
            rateLimited: `Stopped after ${result.deleted} deleted: Discord rate limited this 3 times in a row. Wait a while, then run again.`,
        }[result.stop];
        showToast(message, result.stop === "done" ? Toasts.Type.SUCCESS : result.stop === "rateLimited" ? Toasts.Type.FAILURE : Toasts.Type.MESSAGE);
    } catch {
        showToast("Purge stopped: Discord didn't return the message history.", Toasts.Type.FAILURE);
    } finally {
        if (running?.signal === signal) { bar.remove(); running = null; }
    }
}

function confirmPurge(channel: Channel) {
    Alerts.show({
        title: "Purge my messages",
        body: `Delete every message you sent in your DM with ${nameOf(channel)}? Their messages stay. This can't be undone, and it runs slowly (about with pauses) to avoid rate limits.`,
        confirmText: "Delete my messages",
        cancelText: "Cancel",
        confirmColor: "red",
        onConfirm: () => void purge(channel),
    });
}

const item = (channel: Channel) => (
    <Menu.MenuGroup>
        <Menu.MenuItem id="cc-purge-dm" label={running?.channelId === channel.id ? "Stop purging my messages" : "Purge my messages"} color="danger"
            action={() => running?.channelId === channel.id ? stopRunning() : confirmPurge(channel)} />
    </Menu.MenuGroup>
);

const ChannelContext: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    if (channel?.type === DM && !channel.guild_id) children.push(item(channel));
};
const UserContext: NavContextMenuPatchCallback = (children, { user }: { user?: { id: string; }; }) => {
    if (!user || user.id === UserStore.getCurrentUser()?.id) return;
    const dmId = ChannelStore.getDMFromUserId(user.id);
    const channel = dmId ? ChannelStore.getChannel(dmId) : null;
    if (channel?.type === DM) children.push(item(channel));
};

export default definePlugin({
    name: "PurgeDMs",
    description: "Adds \"Purge my messages\" to a DM's and a user's right-click menu: deletes every message you sent in that DM, one by one. Warning: bulk deleting is automation that Discord can flag on your account. Use at your own risk.",
    authors: [Devs.Xohus],
    tags: ["Utility", "Chat"],
    settings,
    searchTerms: ["delete", "purge", "clear", "dm", "messages"],
    contextMenus: {
        "channel-context": ChannelContext,
        "user-context": UserContext,
    },
    start() {
        window.addEventListener("beforeunload", stopRunning);
    },
    stop() {
        window.removeEventListener("beforeunload", stopRunning);
        stopRunning();
    },
});

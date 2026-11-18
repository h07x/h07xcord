/*
 * CloudCord Purge DMs
 * Copyright (c) 2026 xohus and CloudCord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Deletes the current user's own messages in one DM, newest to oldest, one at a time.
// Kept free of Discord imports so the paging and filtering can be tested on their own.

export interface PurgeRest {
    get(request: { url: string; query?: Record<string, any>; }): Promise<{ body: any; }>;
    del(request: { url: string; }): Promise<unknown>;
}
export interface PurgeSignal { cancelled: boolean; }
export interface PurgeProgress {
    deleted: number;
    found: number;
    /** Current base delay between deletes in ms (doubles after a rate limit). */
    delay: number;
    /** Deletes left before the next burst pause, or 0 when burst pauses are off. */
    nextPauseIn: number;
    /** Set while sitting in a burst pause or a rate-limit wait. */
    waiting?: { reason: "burst" | "rateLimit"; ms: number; };
}
export interface PurgeOptions {
    rest: PurgeRest;
    channelId: string;
    authorId: string;
    signal?: PurgeSignal;
    /** Base gap between deletes in ms; never below MIN_DELAY_MS unless 0 (tests only). */
    delayMs?: number;
    /** Random extra 0..jitterMs added to each gap. */
    jitterMs?: number;
    /** Pause for burstPauseMs after this many deletes; 0 turns it off. */
    burstEvery?: number;
    burstPauseMs?: number;
    /** Stop after this many deletes in one run; 0 means no limit. */
    maxPerRun?: number;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
    onProgress?: (progress: PurgeProgress) => void;
}
export type PurgeStop = "done" | "cancelled" | "limit" | "rateLimited";
export interface PurgeResult { deleted: number; found: number; skipped: number; cancelled: boolean; stop: PurgeStop; delay: number; }

export const MIN_DELAY_MS = 800;
export const PURGE_DEFAULTS = { delayMs: 1200, jitterMs: 500, burstEvery: 25, burstPauseMs: 30_000, maxPerRun: 500 };
/** Consecutive 429s that end a run. */
export const MAX_RATE_LIMITS_IN_A_ROW = 3;

// Normal messages, replies and app command messages; everything else is a system message.
const DELETABLE_TYPES = new Set([0, 19, 20, 23]);

export function isOwnDeletable(message: any, authorId: string) {
    return !!message && message.author?.id === authorId && DELETABLE_TYPES.has(Number(message.type ?? 0));
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function retryAfterMs(error: any) {
    const seconds = Number(error?.body?.retry_after ?? error?.retry_after ?? error?.headers?.["retry-after"]);
    return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : 5000;
}

class RateLimited extends Error { }

/** Walks history with `before` paging and yields the user's own deletable messages, newest first. */
export async function* ownMessages(rest: PurgeRest, channelId: string, authorId: string, signal?: PurgeSignal, onRateLimit: (error: any) => Promise<void> = async error => wait(retryAfterMs(error))) {
    let before: string | undefined;
    while (!signal?.cancelled) {
        let page: any[];
        try {
            const response = await rest.get({ url: `/channels/${channelId}/messages`, query: { limit: 100, ...(before ? { before } : {}) } });
            page = Array.isArray(response?.body) ? response.body : [];
        } catch (error: any) {
            if (error?.status === 429) { await onRateLimit(error); continue; }
            throw error;
        }
        if (!page.length) return;
        for (const message of page) if (isOwnDeletable(message, authorId)) yield message;
        before = page[page.length - 1].id;
        if (page.length < 100) return;
    }
}

export async function purgeOwnMessages(options: PurgeOptions): Promise<PurgeResult> {
    const { rest, channelId, authorId, signal, sleep = wait, random = Math.random, onProgress } = options;
    const jitterMs = Math.max(0, options.jitterMs ?? PURGE_DEFAULTS.jitterMs);
    const burstEvery = Math.max(0, Math.floor(options.burstEvery ?? PURGE_DEFAULTS.burstEvery));
    const burstPauseMs = Math.max(0, options.burstPauseMs ?? PURGE_DEFAULTS.burstPauseMs);
    const maxPerRun = Math.max(0, Math.floor(options.maxPerRun ?? PURGE_DEFAULTS.maxPerRun));
    const requested = options.delayMs ?? PURGE_DEFAULTS.delayMs;
    let delay = requested === 0 ? 0 : Math.max(MIN_DELAY_MS, requested);
    let limitedInARow = 0;
    const result: PurgeResult = { deleted: 0, found: 0, skipped: 0, cancelled: false, stop: "done", delay };
    const progress = (waiting?: PurgeProgress["waiting"]) => onProgress?.({
        deleted: result.deleted, found: result.found, delay,
        nextPauseIn: burstEvery ? burstEvery - (result.deleted % burstEvery) : 0, waiting,
    });
    // Waits out a 429, then doubles the delay for the rest of the run; too many in a row ends it.
    const onRateLimit = async (error: any) => {
        limitedInARow++;
        if (limitedInARow >= MAX_RATE_LIMITS_IN_A_ROW) throw new RateLimited();
        const ms = retryAfterMs(error);
        progress({ reason: "rateLimit", ms });
        await sleep(ms);
        delay = Math.max(delay * 2, MIN_DELAY_MS);
    };

    try {
        for await (const message of ownMessages(rest, channelId, authorId, signal, onRateLimit)) {
            if (signal?.cancelled) break;
            result.found++;
            progress();
            while (!signal?.cancelled) {
                try {
                    await rest.del({ url: `/channels/${channelId}/messages/${message.id}` });
                    result.deleted++;
                    limitedInARow = 0;
                    break;
                } catch (error: any) {
                    if (error?.status === 429) { await onRateLimit(error); continue; }
                    limitedInARow = 0;
                    result.skipped++; // already gone, too old for the API, or not allowed
                    break;
                }
            }
            progress();
            if (signal?.cancelled) break;
            if (maxPerRun && result.deleted >= maxPerRun) { result.stop = "limit"; break; }
            if (burstEvery && burstPauseMs && result.deleted > 0 && result.deleted % burstEvery === 0) {
                progress({ reason: "burst", ms: burstPauseMs });
                await sleep(burstPauseMs);
            } else if (delay > 0) {
                await sleep(delay + random() * jitterMs);
            }
        }
    } catch (error) {
        if (!(error instanceof RateLimited)) throw error;
        result.stop = "rateLimited";
    }
    if (signal?.cancelled) { result.cancelled = true; result.stop = "cancelled"; }
    result.delay = delay;
    return result;
}

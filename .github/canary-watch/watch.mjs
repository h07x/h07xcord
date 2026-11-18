// Discord Canary early warning.
// Checks Discord's Canary builds, compares them with the last run and alerts a
// Discord webhook when something changes, so CloudCord can be fixed before the
// change reaches Stable. Node 20+, no dependencies.
//
// Usage: node watch.mjs <state.json>
// Env:   CANARY_WEBHOOK_URL (optional; without it, changes are only printed)

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const statePath = process.argv[2] ?? "canary-state.json";
const webhook = process.env.CANARY_WEBHOOK_URL;
const UA = "CloudCord-CanaryWatch/1.0";

async function get(url, as = "json") {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    return as === "json" ? res.json() : res.text();
}

async function desktopVersion(platform) {
    try {
        return (await get(`https://discord.com/api/updates/canary?platform=${platform}`)).name ?? "unknown";
    } catch (e) {
        return `error: ${e.message}`;
    }
}

// Signals that CloudCord's injection approach still works. If Discord's client stops
// shipping a webpack JS bundle (for example a native Rust UI), these go false.
const MARKERS = {
    webpackChunks: /webpackChunkdiscord_app/,
    react: /__SECRET_INTERNALS|createElement\(|jsx\)?\(/,
};

async function webBuild() {
    const html = await get("https://canary.discord.com/app", "text");
    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map(m => m[1]);
    const out = { scripts: scripts.length, buildId: null, markers: {} };
    for (const k of Object.keys(MARKERS)) out.markers[k] = false;

    for (const src of scripts) {
        const url = src.startsWith("http") ? src : `https://canary.discord.com${src}`;
        let js;
        try { js = await get(url, "text"); } catch { continue; }
        const id = js.match(/buildNumber["']?\s*[:=]\s*["']?(\d{5,})/) ?? js.match(/build_number["']?\s*[:=]\s*["']?(\d{5,})/);
        if (id && !out.buildId) out.buildId = id[1];
        for (const [k, re] of Object.entries(MARKERS)) if (re.test(js)) out.markers[k] = true;
    }
    // Rust/WASM pieces of Discord's client (e.g. libdiscore-wasm). New ones mean more of
    // the client moved to Rust, where CloudCord can't patch JS.
    out.wasmChunks = scripts.map(s => s.split("/").pop().replace(/\.[0-9a-f]{8,}\.js$/, "")).filter(n => /wasm|discore|rust/i.test(n)).sort();
    return out;
}

const now = {
    checkedAt: new Date().toISOString(),
    desktop: {
        win: await desktopVersion("win"),
        osx: await desktopVersion("osx"),
        linux: await desktopVersion("linux"),
    },
    web: await webBuild().catch(e => ({ error: e.message })),
};

const prev = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : null;
const alerts = [];
let urgent = false;

if (prev) {
    for (const p of ["win", "osx", "linux"]) {
        if (prev.desktop?.[p] !== now.desktop[p]) alerts.push(`Desktop Canary (${p}): \`${prev.desktop?.[p]}\` → \`${now.desktop[p]}\``);
    }
    if (prev.web?.buildId !== now.web.buildId) alerts.push(`Web Canary build: \`${prev.web?.buildId}\` → \`${now.web.buildId}\``);
    const added = (now.web.wasmChunks ?? []).filter(n => !(prev.web?.wasmChunks ?? []).includes(n));
    if (added.length) {
        urgent = true;
        alerts.push(`**New Rust/WASM module(s):** ${added.map(n => `\`${n}\``).join(", ")}. More of Discord's client moved to Rust; check what it replaced.`);
    }
    for (const [k, was] of Object.entries(prev.web?.markers ?? {})) {
        if (was && now.web.markers?.[k] === false) {
            urgent = true;
            alerts.push(`**${k} marker is gone.** Discord's client may no longer be a webpack/React bundle (Rust rewrite?). CloudCord injection will likely break.`);
        }
    }
} else {
    alerts.push("Canary watch started. Baseline recorded.");
}
if (now.web.error) { urgent = true; alerts.push(`Couldn't read Web Canary: ${now.web.error}`); }

console.log(JSON.stringify(now, null, 2));
console.log(alerts.length ? alerts.join("\n") : "No changes.");
writeFileSync(statePath, JSON.stringify(now, null, 2) + "\n");

if (alerts.length && webhook) {
    const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA },
        body: JSON.stringify({
            username: "Canary Watch",
            allowed_mentions: { parse: [] },
            embeds: [{
                title: urgent ? "⚠️ Discord Canary: possible breaking change" : "Discord Canary updated",
                description: alerts.join("\n").slice(0, 4000),
                color: urgent ? 0xef4444 : 0x38bdf8,
                footer: { text: "Test CloudCord on Canary before this reaches Stable." },
                timestamp: now.checkedAt,
            }],
        }),
    });
    if (!res.ok) console.error("Webhook failed:", res.status, await res.text());
}

if (urgent) process.exitCode = 1;

/*
 * CloudCord Set as avatar / banner
 * Copyright (c) 2026 xohus and CloudCord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { setCloudCordBanner } from "@sincordplugins/fakeProfile";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { FluxDispatcher, Menu, SettingsRouter, showToast, Toasts, UserStore } from "@webpack/common";

type Kind = "AVATAR" | "BANNER";

function hasNitro() {
    return Number((UserStore.getCurrentUser() as any)?.premiumType ?? 0) > 0;
}

// Discord's CDN serves a static copy unless asked for the animated one.
function bestUrl(url: string) {
    try {
        const parsed = new URL(url);
        if (/\.(gif)$/i.test(parsed.pathname) || parsed.pathname.includes("/a_")) parsed.searchParams.set("animated", "true");
        return parsed.toString();
    } catch { return url; }
}

function toDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

// First frame as a PNG, for avatars without Nitro (animated avatars need Nitro).
async function firstFrame(blob: Blob) {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas.toDataURL("image/png");
}

async function load(url: string) {
    const response = await fetch(bestUrl(url));
    if (!response.ok) throw new Error(String(response.status));
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) throw new Error("not an image");
    return blob;
}

// Opens Edit Profile and Discord's own crop step with the image loaded; the user still confirms and saves.
function openDiscordEditor(kind: Kind, imageUri: string) {
    try { SettingsRouter.openUserSettings("profile_panel"); } catch { }
    setTimeout(() => FluxDispatcher.dispatch({
        type: "PROFILE_CUSTOMIZATION_OPEN_PREVIEW_MODAL",
        image: { imageUri, assetOrigin: "NEW_ASSET", description: kind === "AVATAR" ? "avatar" : "banner" },
        file: {},
        uploadType: kind,
        analyticsSource: "user settings user profile",
        isTryItOut: false,
    }), 400);
}

async function setAs(kind: Kind, url: string) {
    try {
        const blob = await load(url);
        const animated = blob.type === "image/gif" || (blob.type === "image/webp" && bestUrl(url).includes("animated=true"));
        const nitro = hasNitro();
        if (kind === "AVATAR") return openDiscordEditor(kind, animated && !nitro ? await firstFrame(blob) : await toDataUrl(blob));
        if (nitro) return openDiscordEditor(kind, await toDataUrl(blob));
        // No Nitro: Discord won't take a banner, so use the CloudCord banner (animation kept).
        if (setCloudCordBanner(await toDataUrl(blob))) showToast("Set as your CloudCord banner. Only CloudCord users can see it.", Toasts.Type.SUCCESS);
        else showToast("Turn on Fake Profile to use a banner without Nitro.", Toasts.Type.FAILURE);
    } catch {
        showToast("Couldn't load that image.", Toasts.Type.FAILURE);
    }
}

const imageMenu: NavContextMenuPatchCallback = (children, props: { src?: string; itemSrc?: string; }) => {
    const src = props?.src ?? props?.itemSrc;
    if (!src || !/^https:\/\//.test(src)) return;
    const group = findGroupChildrenByChildId("copy-native-link", children) ?? findGroupChildrenByChildId("open-native-link", children) ?? children;
    group.push(
        <Menu.MenuItem id="cc-set-avatar" label="Set as avatar" action={() => void setAs("AVATAR", src)} />,
        <Menu.MenuItem id="cc-set-banner" label={hasNitro() ? "Set as banner" : "Set as banner (CloudCord)"} action={() => void setAs("BANNER", src)} />
    );
};

// Avatars: the user menu's "View avatar" image isn't an image-context menu, so add the items there too.
const userMenu: NavContextMenuPatchCallback = (children, { user }: { user?: any; }) => {
    if (!user?.getAvatarURL) return;
    const src = user.getAvatarURL(undefined, 1024, true);
    children.push(<Menu.MenuGroup>
        <Menu.MenuItem id="cc-set-avatar-from-user" label="Set their avatar as mine" action={() => void setAs("AVATAR", src)} />
        <Menu.MenuItem id="cc-set-banner-from-user" label="Set their avatar as my banner" action={() => void setAs("BANNER", src)} />
    </Menu.MenuGroup>);
};

export default definePlugin({
    name: "SetAsProfileImage",
    description: "Right-click any image or user to set it as your avatar or banner. Opens Discord's Edit Profile with the crop step so you confirm and save. Without Nitro, banners use your CloudCord banner, which only CloudCord users see.",
    authors: [Devs.Xohus],
    tags: ["Media", "Utility"],
    searchTerms: ["pfp", "avatar", "banner", "profile picture"],
    contextMenus: {
        "image-context": imageMenu,
        "user-context": userMenu,
    },
});

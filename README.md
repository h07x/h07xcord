# CloudCord
**Your Discord, your way.**

Customize your profile, make Discord look the way you want, and add tools to the client you already use.

Download · Releases · Status · Report a bug

Windows · macOS · Android · iOS / iPadOS · Browser

## What you get
* **Fake Profile** lets you customize your name, avatar, banner, bio, badges, and profile effects. Keep your changes on your device or publish a profile that other compatible CloudCord clients can display. Nitro and badge previews are cosmetic.
* **Add-ons** brings plugins, themes, fonts, and interface tweaks into Discord settings. On desktop, you can also use compatible BetterDiscord themes.
* **CX** is CloudCord’s `.cx` format for permission-reviewed plugins and themes. Supported CX add-ons can run on desktop and mobile, including themes with chat backgrounds. The catalog is still growing. (CX catalog)
* **BotCord** gives desktop users a separate interface for Discord bot accounts they manage.
* **CloudSync** backs up and syncs supported CloudCord settings through StoreCloud.

CloudCord plugin browser · CloudCord desktop theme store

## Install

| Platform | Get CloudCord | Setup |
| :--- | :--- | :--- |
| **Windows** | Installer | Open the installer, choose Discord Stable, PTB, or Canary, and install CloudCord. The installer can also repair or uninstall it. |
| **macOS** | Apple Silicon · Intel | Check About This Mac for your chip or processor, then choose the matching preview DMG. |
| **Android** | CloudCord Manager | Install and open Manager, then follow its prompts to patch and install Discord. |
| **iOS / iPadOS** | IPA | Sign and sideload the IPA with a compatible tool. |
| **Browser** | Chrome / Brave · Firefox · Userscript | Follow the browser instructions on the download page. |

After installing, open **Discord Settings → CloudCord**. Start with Profile to change how your profile looks or Add-ons to browse extensions.

Features and build availability vary by platform. If something breaks, include your platform, Discord version, CloudCord build, and the exact error or steps to reproduce it. (Status page · GitHub issues)

## Source and builds

| Repository | What lives there |
| :--- | :--- |
| **Release Hub** | Official downloads, release workflows, and shared build inputs |
| **Desktop** | Windows installer, desktop client, browser extensions, and userscript |
| **macOS** | Apple Silicon and Intel DMG packaging |
| **Android** | CloudCord Manager, patcher, and Android loader integration |
| **iOS** | Native iOS and iPadOS loader and shared mobile runtime |

## Contributing
Make platform changes in the corresponding repository. To integrate a reviewed change into an official release, create a branch in Release Hub, import the reviewed platform directory, and open a pull request. The following commands import Android from its platform repository:

```bash
git fetch https://github.com/cloudcord-mod/android.git main
git restore --source=FETCH_HEAD --staged --worktree -- android
git diff --cached --stat
```

For shared runtime and build information, see the workflow directory. (Project and citation guide)

## Credits
CloudCord is maintained by Xohus, with contributions from the people who build, test, translate, and support it.

* Desktop foundations and plugins come from Sincord, Vencord, Equicord, and Endcord and their contributors. Sincord contributors also helped lay the groundwork for Fake Profile. (Desktop credits)
* Mobile runtime and loaders build on Vendetta, Bunny, Kettu, and RainTweak. The Android Manager builds on work from Aliucord, Vendetta, and Raincord Manager, with KettuXposed used in the Android build. (Mobile credits · RainTweak notice)
* Community add-ons credit their original plugin and theme authors. Thanks to BetterDiscord and its community for add-ons, theme compatibility, and inspiration for the add-on cards and theme store. (CX author notices)
* README layout takes inspiration from Foldcord by folded and Xohus.

## License
This project and all its components are licensed under the **GPL-3.0** license.

---

*An independent community project for Discord.*

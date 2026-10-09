# Joseki Dojo

Joseki Dojo helps you practise joseki (standard corner sequences in Go). You play out a corner against KataGo that plays like a human of the rank you choose, so it makes human mistakes. Afterwards the app shows how many points each move cost, how you should have played, and whether you punished your opponent's mistakes.

**The app is in Russian for now.** Buttons and messages are in Russian; this guide uses the Russian button names, with a translation in brackets.

## Install on Windows

1. Open the [latest release](https://github.com/EternalEclipse999/joseki-dojo/releases/latest). Scroll down to **Assets** and click `Joseki-Dojo-Setup-X.Y.Z.exe` (X.Y.Z is the version number, for example 0.1.0). Ignore the other files. The file lands in your **Downloads** folder; double-click it there.
2. Your browser may say the file is "not commonly downloaded". This happens because the app is new and not signed with a paid certificate. Open the browser's download list, click **Keep**, then **Keep anyway**.
3. Windows may show **"Windows protected your PC"**. Click **More info**, then **Run anyway**. You will not see this again when you update from inside the app.
4. The app installs for your Windows user only (no administrator password needed), adds shortcuts to the Start menu and the desktop, and opens.
5. On the first launch the app says **«Нужно скачать движок KataGo»** (KataGo needs to be downloaded). Click **«Установить»** (Install). The app downloads about 210 MB (two KataGo builds and two neural networks), checks every file, and finds out whether your processor or your graphics card runs KataGo faster. The download takes a few minutes, and setting up a graphics card can take a few more: the first start can take 5-10 minutes in total. Keep the window open. When it is done, the start screen opens and you can play.

## Install on Linux

1. Open the [latest release](https://github.com/EternalEclipse999/joseki-dojo/releases/latest), scroll down to **Assets** and download `Joseki-Dojo-X.Y.Z.AppImage`.
2. Allow it to run: right-click the file, choose **Properties → Permissions**, and tick **Allow executing file as program**. Or in a terminal: `chmod +x Joseki-Dojo-*.AppImage`
3. Double-click the file to start the app.
4. On the first launch the app says **«Нужно скачать движок KataGo»** (KataGo needs to be downloaded). Click **«Установить»** (Install). The app downloads about 280 MB, checks every file, and finds out whether your processor or your graphics card runs KataGo faster. The download takes a few minutes: the first start can take 5-10 minutes in total. Keep the window open. When it is done, the start screen opens and you can play.

## Updating

When a new version is out, a bar appears at the top of the window: **«Доступна версия X.Y.Z»** (version X.Y.Z is available). Click **«Обновить»** (Update). The app downloads the update, shows the progress, and restarts in the new version. Your settings, training history and KataGo stay as they were.

Sometimes a new version also brings a newer tested KataGo. Then the bar says **«Доступна новая проверенная версия KataGo»** (a new tested KataGo version is available); click **«Обновить движок»** (Update engine).

## Uninstall

- **Windows:** open **Settings → Apps** (Windows 10: **Apps & features**), find **Joseki Dojo**, and choose **Uninstall**.
- **Linux:** delete the AppImage file.

Uninstalling keeps your data (KataGo, settings, training history). To remove it as well, delete this folder:

- Windows: `%APPDATA%\Joseki Dojo` (paste this into the File Explorer address bar)
- Linux: `~/.config/Joseki Dojo`

## Troubleshooting

- **The analysis after a game is slow.** Open **«Настройки»** (Settings) and lower **«Визиты на позицию в разборе»** (visits per position in the review), for example to 100: the analysis gets faster and a little less precise. To use your graphics card, press **«Подобрать движок заново»** (Pick the engine again): the app measures the processor and the graphics card once more and keeps the faster one. If your graphics card could not run KataGo (often an old graphics driver without OpenCL), the processor is used.
- **"Install" fails.** The screen says why. Most often it is the internet connection: check it and click **«Попробовать снова»** (Try again). Files that were already downloaded and checked are not downloaded again.
- **The AppImage does not start on Linux.** Some distributions need FUSE 2 for AppImages, e.g. on Ubuntu: `sudo apt install libfuse2t64` (Ubuntu 24.04) or `sudo apt install libfuse2` (22.04).
- **Double-clicking the AppImage does nothing (Ubuntu 24.04 or newer).** If it does not start, open a terminal in the folder with the file and run `./Joseki-Dojo-X.Y.Z.AppImage --no-sandbox`. Newer Ubuntu releases restrict the sandbox that Electron apps use; this option turns it off for this app.
- **The engine screen says KataGo does not work.** Press **«Подобрать движок заново»** (Pick the engine again): the app repairs the setup by itself.
- **Logs** are in the data folder (see [Uninstall](#uninstall)): `data/joseki-dojo.log` for the app, `data/katago-logs/` for KataGo.

## For developers

### Requirements

- Node.js 22.12 or newer (CI uses Node 24)
- Windows or Linux x64. On macOS the app runs from sources, but you have to install KataGo yourself and enter its paths on the settings screen.

### Run from sources

```bash
npm install
npm start          # builds the web UI and serves it at http://127.0.0.1:5179
```

On the first start the page offers to install KataGo, exactly like the desktop app. Developers can also run `npm run setup` in a terminal: it asks which KataGo build to download (or takes the path of one you have), checks the files and measures the speed. In both cases everything lives in the repository: `config.local.json`, `data/`, `engines/`.

Other settings live in `config.local.json` (defaults: `config.example.json`):

| Field | Meaning |
|---|---|
| `analysis.reviewVisits` / `endVisits` | analysis depth for the review / for the Tenuki button |
| `thresholds` | inaccuracy / mistake / blunder limits and the "punished" limit, in points |
| `bot.defaultRank`, `bot.temperature` | the bot's default rank and the spread of its moves |
| `maxSessionMoves` | safety limit: after this many moves the game goes to the review |

### Commands

```bash
npm run dev          # server and Vite with hot reload: http://127.0.0.1:5173
npm test             # unit tests
npm run typecheck
npm run e2e          # browser tests with a fake KataGo (once: npx playwright install chromium)
npm run test:katago  # checks against a real KataGo (needs config.local.json)
npm run desktop      # the desktop app from sources; it uses the same data folder as the installed app (see Uninstall)
npm run dist         # the installer for this OS in packages/desktop/release/
```

### Project layout

- `packages/shared`: types, coordinates, the corner zone, Go rules
- `packages/server`: Fastify server, KataGo process, bot, review, SQLite, the built-in KataGo installer (`src/install/`); `startServer()` in `src/start.ts` is used by `npm start` and by the desktop app
- `packages/web`: Preact UI
- `packages/desktop`: Electron main process and preload, bundled with esbuild and packaged with electron-builder
- `katago.lock.json`: the tested KataGo version and networks with their SHA-256. Changing them is a separate PR that passes `npm run test:katago`. The installer offers the new KataGo to players once an app update brings a new lock file.

### Releasing

The version is the `version` field of the root `package.json`. `main` is protected, so the version bump goes through a pull request:

```bash
git switch main && git pull
git switch -c release-0.1.1
npm version patch                    # or minor / major: bumps the version, commits "0.1.1" and tags v0.1.1
git push -u origin release-0.1.1 --follow-tags
```

`npm version` creates an annotated tag, and `--follow-tags` pushes it together with the commit.

1. The tag starts the **Release** workflow: tests, then the Windows installer and the Linux AppImage are built and uploaded to a **draft** release `v0.1.1`.
2. Open a pull request from `release-0.1.1` and merge it with **Create a merge commit** (so the tagged commit is on `main`).
3. Wait for the **Release** run on the **Actions** tab to turn green. Install the draft's `.exe` and start it once to check that it works. Then press **Publish** on the draft. Only then do players see the update: the updater ignores drafts.

Every pull request to `main` runs the **CI** workflow (unit tests, type check, the desktop bundle, e2e).

## License

MIT. KataGo and its networks are not part of this repository: the app downloads them from GitHub and katagotraining.org, and they come with their own licenses.

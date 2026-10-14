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

## Variations in the review

In the review you can try your own moves instead of the game. Click a point on the board, or press **«Сыграть»** (Play) next to one of KataGo's suggestions: this starts a variation from that position. With **«Отвечает KataGo»** (KataGo replies) on, KataGo answers your move; the answer comes once its analysis reaches the review's visits, or at once when you press **«Ответить сейчас»** (Reply now). The positions of the variation keep being analysed deeper while you look at them, and **«Глубже»** (Deeper) does the same for a move of the game. Use the arrows to step through the variation and **«Вернуться к партии»** (Back to the game) to leave it.

## Troubleshooting

- **The analysis after a game is slow.** Open **«Настройки»** (Settings) and lower **«Визиты на позицию в разборе»** (visits per position in the review), for example to 100: the analysis gets faster and a little less precise. If variations in the review are slow, lower **«Предел визитов в вариантах»** (visits limit for variations) or press **«Ответить сейчас»** (Reply now) instead of waiting for KataGo. To use your graphics card, press **«Подобрать движок заново»** (Pick the engine again): the app measures the processor and the graphics card once more and keeps the faster one. If your graphics card could not run KataGo (often an old graphics driver without OpenCL), the processor is used.
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
| `analysis.variationVisits` | visits limit of one variation position in the review (default: 10 × `reviewVisits`) |
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

### Trap base

The traps mode reads `packages/server/bases/traps.jdb`, a compact binary move base (`JDB1`: a header with the kind, a verified flag, the node count and a CRC32, then the move tree in depth-first order). Every path is stored in canonical form: top-right corner, Black first. A trap is a node of category `trap`; its children are the answers, marked `good` or `caught`, with the point loss measured by KataGo when it is known. The trap id (shown by the dump) is the first 8 hex characters of the SHA-1 of the canonical path. If the file is missing or unreadable, only the traps mode is unavailable.

Look at a base as text, or export it as SGF (19×19, one game tree; trap and caught answers get `BM[1]`, good answers `TE[1]`, a stored loss goes to the comment):

```bash
npm run jdb:dump -- packages/server/bases/traps.jdb
npm run jdb:dump -- packages/server/bases/traps.jdb --sgf traps.sgf
```

Verify the base with KataGo on a machine with a strong GPU (it needs `config.local.json`; the check is slow, because every trap takes several searches):

```bash
npm run traps:check -- --visits 1600 --good-max 1 --caught-gap 2
```

For each trap the tool searches the position before the answer (answers restricted to the corner zone) and after each stored answer. It writes the losses into the answer nodes and keeps a trap when its best good answer loses at most `--good-max` points and its best caught answer loses at least `--caught-gap` points more than that. A kept trap loses its good answers that lose more than `--good-max` (the way to a trap nested below one stays); the report lists them. A tenuki answer is measured as the best move outside the zone. Traps nested below an answer, including a trap that is itself an answer of another trap, are checked too, each with its own path. Failing traps are dropped, branches left without traps are pruned, and the file is rewritten with the verified flag set. Illegal data (a path or an answer that is not a legal move) is dropped, too. A query that KataGo rejects leaves its trap unchecked and the verified flag off. A query that fails because the engine hung is retried once; if the retry fails as well, the run stops and nothing is written. The check is meant to run once on the owner's machine: the base that ships in the repository is not verified yet.

The trap candidates (`scripts/traps/candidates.jdb`) are tricks whose answers are incomplete. One command on a machine with a strong GPU checks the base, completes the candidates and commits both files:

```
npm run traps:gpu -- --visits 8000
```

It refuses to start on `main`, on a detached HEAD or with uncommitted changes in the two base files, and checks that KataGo answers with the human net before any work. A candidate's good answers must lose at most `--good-max`: weaker ones from the file are dropped and reported, and a candidate without good answers tries KataGo's three best zone moves. The human net then names the natural moves at each rank of `--ranks` (default `20k,15k,10k,5k,3k,1k`; a move is natural from `--natural 0.1` of the policy, a tenuki sums everything outside the zone), and a natural move that loses at least `--caught-gap` more than the best good answer becomes a caught answer. Accepted candidates move into `traps.jdb`; the rest stay in the candidates file. The commit holds only the two files, is authored as the last commit of the branch, and carries the report; push it afterwards.

The one-time run on the GPU machine:

1. Clone the repository (or pull).
2. `git switch feat/traps-gpu` (the pull request branch; if it was already merged, create a branch for the result instead, e.g. `git switch -c traps-gpu-run`).
3. `npm ci`
4. `npm run setup` and pick a GPU build of KataGo (the CPU build is far too slow for 8000 visits).
5. `npm run traps:gpu` (roughly 20-90 minutes depending on the GPU; keep the machine awake).
6. `git push` (`git push -u origin HEAD` for a new branch).

### Start positions base

The start modes read `packages/server/bases/starts.jdb`, a JDB base of kind `starts`. A node of category `start` is a start position: its path, in canonical form, is the moves put on the board. A node of category `dubious` is a start that ends with the opponent's dubious move; it is used only by «Случайно» (about one pick in ten), with the colours swapped so that the user answers that move. The ids are the same as for traps (the first 8 hex characters of the SHA-1 of the canonical path).

`packages/server/bases/starts-list.json` is the named list for «Из списка»: a JSON object with `positions` — `{ group, name, short, moves, rare }` in chapter order, with the groups `4-4`, `3-4`, `3-3`, `5-4` and `5-3`, canonical moves in GTP, the caption `short` for the tree and `rare: true` for positions pros rarely play — and `branches` — `{ moves, name }`, the names of tree nodes that are not positions (an approach, say). A position whose path is not a normal start of the base, or a branch with no positions under it, is skipped with a log line. A missing or broken base turns both start modes off; a missing or broken list turns off only «Из списка».

```bash
npm run jdb:dump -- packages/server/bases/starts.jdb
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

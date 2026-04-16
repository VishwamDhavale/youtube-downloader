# YouTube Downloader

A local YouTube downloader with a React/Vite frontend and an Express API. Paste a YouTube URL, fetch available metadata and formats, choose an output folder, then start, pause, resume, or remove download tasks from the dashboard.

## Features

- Fetch video or playlist metadata with `yt-dlp`
- Choose quality or format before downloading
- Track download progress with server-sent events
- Pause and resume active downloads
- Pick an output folder with the native system folder dialog
- Save download tasks in a visible `ytdl-session.json` file inside the selected output folder
- Load previous tasks from the saved session file

## Project Structure

```text
.
├── client/   # React + Vite frontend
└── server/   # Express API and yt-dlp download runner
```

## Requirements

- Node.js
- pnpm
- Internet access for fetching YouTube metadata and media
- Linux folder picker support requires `zenity` or `kdialog`

The server uses `youtube-dl-exec`, which runs `yt-dlp` under the hood.

## Install

Install dependencies for the root workspace, server, and client:

```bash
pnpm install:all
```

## Run

Start both the API server and the Vite client:

```bash
pnpm dev
```

Default local URLs:

- Client: `http://localhost:5173`
- Server: `http://localhost:3001`

## Usage

1. Paste a YouTube video or playlist URL.
2. Click `Fetch Info`.
3. Click `Browse` to choose an output folder, or enter the path manually.
4. Choose a format or quality preset.
5. Click `Start Download`.
6. Use the `Downloads` view to pause, resume, or remove tasks.

## Session File

The app saves task history in this visible file inside the selected output folder:

```text
ytdl-session.json
```

Click `Scan for Sessions` after entering an output folder to load saved tasks from that file.

## Scripts

```bash
pnpm dev           # Run client and server together
pnpm install:all   # Install root, server, and client dependencies
```

Server-only commands:

```bash
cd server
pnpm dev
pnpm start
```

Client-only commands:

```bash
cd client
pnpm dev
pnpm build
pnpm lint
```

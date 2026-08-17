# Video Looper

A web application that creates seamless video loops from uploaded videos. Deployed on Vercel: a static React frontend plus serverless functions that run ffmpeg, with Vercel Blob for file transfer (uploads and results bypass the ~4.5 MB serverless body limit).

## Project Structure

```
video-looper/
├─ api/                  # Vercel serverless functions
│  ├─ upload.ts          # Issues Vercel Blob client-upload tokens
│  ├─ loop.ts            # Downloads upload, runs ffmpeg, stores result (also DELETE cleanup)
│  └─ _lib/
│     └─ video-processor.js  # Pure-Node ffmpeg pipeline (reverse / crossfade loops)
├─ client/               # React + Vite frontend
│  └─ src/
│     ├─ LoopMakerUploader.tsx      # Upload component
│     └─ LoopMakerUploader.test.tsx # Component tests
├─ vercel.json           # Function memory/duration config + SPA rewrite
└─ package.json          # Root package (npm workspaces: client)
```

## How it works

1. The browser uploads the video **directly to Vercel Blob** via `@vercel/blob/client` (token issued by `/api/upload`; capped at 200 MB, video content types only).
2. The browser POSTs `{ blobUrl, technique, fadeDuration, startSecond, filename }` to `/api/loop`. The function downloads the blob to `/tmp`, runs ffmpeg (`ffmpeg-static` + `@ffprobe-installer/ffprobe` — real binaries, no bash), uploads the result to Blob, and returns its URL. The input blob is deleted afterwards.
3. The browser downloads the result and fires a best-effort `DELETE /api/loop` to remove the result blob.

Techniques: `reverse` (forward then reversed) and `crossfade` (with `fade_duration` and `start_second` parameters).

## Setup

```bash
npm install
npm i -g vercel          # Vercel CLI
vercel link              # link to your Vercel project
```

Then in the Vercel dashboard, create a **Blob store** and connect it to the project (this auto-injects `BLOB_READ_WRITE_TOKEN` — the only env var needed), and pull it locally:

```bash
vercel env pull .env.local
```

No system ffmpeg is required — binaries install with `npm install` (the right platform is picked automatically, including Windows for local dev).

## Development

```bash
npm run dev   # vercel dev: serves the Vite client + api/ functions on one origin
```

Note: the `onUploadCompleted` webhook warning on localhost is expected and harmless (Blob can't call back into a local URL).

## Testing

```bash
npm test      # client component tests (vitest)
```

## Deployment

```bash
vercel        # preview deploy
vercel --prod # production
```

`vercel.json` sets `api/loop.ts` to `maxDuration: 300` and `memory: 2048` (the Hobby plan maximum; on Pro, raise it — the reverse technique buffers all decoded frames in RAM).

## Limits

- Uploads capped at 200 MB (`api/upload.ts`); very long/high-res videos can still exceed the 300 s function duration or `/tmp` space.
- The **reverse** technique on very high-resolution sources (~4K) exceeds the 2 GB Hobby memory limit and fails; 1080p is verified working. Crossfade works even at 4K. Fixes: upgrade to Pro and raise `memory`, or rework `createReverseLoop` to reverse in segments.
- Any container ffmpeg can read is accepted (mp4, mov, avi, webm, mkv, …); output is always mp4.
- Processing is synchronous — the browser keeps a single request open while the function works.

## Future ideas

- Allow to upload image sequences into video (gif, avif, mp4, etc.)
- Speed up or slow down video files
- Process video to allow transparent background
- Process video to allow to add a watermark / AI no-index tag to avoid crawlers.

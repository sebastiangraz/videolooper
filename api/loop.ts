import type { VercelRequest, VercelResponse } from "@vercel/node";
import { put, del } from "@vercel/blob";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import os from "os";
import { nanoid } from "nanoid";

const ffmpegPath: string = require("ffmpeg-static");
const ffprobePath: string = require("@ffprobe-installer/ffprobe").path;
const VideoProcessor = require("./_lib/video-processor");

const VALID_TECHNIQUES = ["crossfade", "reverse"];
const BLOB_HOST_RE = /\.public\.blob\.vercel-storage\.com$/;

function isBlobUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    return BLOB_HOST_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "DELETE") {
    const { url } = req.body ?? {};
    if (isBlobUrl(url)) {
      await del(url).catch(() => {});
    }
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    blobUrl,
    technique: rawTechnique,
    fadeDuration = "0.5",
    startSecond = "0",
    filename = "video",
  } = req.body ?? {};

  if (!isBlobUrl(blobUrl)) {
    return res.status(400).json({ error: "Invalid blob URL" });
  }
  const technique = VALID_TECHNIQUES.includes(rawTechnique) ? rawTechnique : "reverse";

  const workDir = path.join(os.tmpdir(), `videolooper-${nanoid(8)}`);
  const inputPath = path.join(workDir, "input.mp4");

  try {
    await fsp.mkdir(workDir, { recursive: true });

    const download = await fetch(blobUrl);
    if (!download.ok || !download.body) {
      throw new Error(`Failed to fetch uploaded video (${download.status})`);
    }
    await pipeline(
      Readable.fromWeb(download.body as import("stream/web").ReadableStream),
      fs.createWriteStream(inputPath)
    );

    const processor = new VideoProcessor(ffmpegPath, ffprobePath);
    const outputPath: string = await processor.createLoop(
      inputPath,
      technique,
      String(fadeDuration),
      String(startSecond)
    );

    const base = String(filename)
      .replace(/\.[^.]+$/, "")
      .replace(/[^\w.-]/g, "_");
    const result = await put(`results/${base}_loop.mp4`, fs.createReadStream(outputPath), {
      access: "public",
      contentType: "video/mp4",
      addRandomSuffix: true,
    });

    return res.status(200).json({ url: result.url, downloadUrl: result.downloadUrl });
  } catch (err) {
    console.error("Processing error:", err);
    return res
      .status(500)
      .json({ error: err instanceof Error ? err.message : "Processing failed" });
  } finally {
    await del(blobUrl).catch(() => {});
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

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

// Mirrored in client/src/VideoToolUploader.tsx (TOOLS / FORMATS)
const VALID_TOOLS = ["crossfade", "reverse", "image-sequence"];
const VALID_FORMATS = ["mp4", "gif", "avif"];
const CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  gif: "image/gif",
  avif: "image/avif",
};
const MAX_IMAGES = 100;
const BLOB_HOST_RE = /\.public\.blob\.vercel-storage\.com$/;

function isBlobUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    return BLOB_HOST_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

async function downloadBlob(url: string, destPath: string): Promise<void> {
  const download = await fetch(url);
  if (!download.ok || !download.body) {
    throw new Error(`Failed to fetch uploaded file (${download.status})`);
  }
  await pipeline(
    Readable.fromWeb(download.body as import("stream/web").ReadableStream),
    fs.createWriteStream(destPath)
  );
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
    tool,
    filename = "video",
    blobUrl,
    blobUrls,
    options = {},
  } = req.body ?? {};

  if (!VALID_TOOLS.includes(tool)) {
    return res.status(400).json({ error: "Unknown tool" });
  }

  let inputBlobUrls: string[];
  if (tool === "image-sequence") {
    if (
      !Array.isArray(blobUrls) ||
      blobUrls.length < 1 ||
      blobUrls.length > MAX_IMAGES ||
      !blobUrls.every(isBlobUrl)
    ) {
      return res
        .status(400)
        .json({ error: `Expected 1–${MAX_IMAGES} valid blob URLs` });
    }
    inputBlobUrls = blobUrls;
  } else {
    if (!isBlobUrl(blobUrl)) {
      return res.status(400).json({ error: "Invalid blob URL" });
    }
    inputBlobUrls = [blobUrl];
  }

  const workDir = path.join(os.tmpdir(), `videotools-${nanoid(8)}`);

  try {
    await fsp.mkdir(workDir, { recursive: true });

    const processor = new VideoProcessor(ffmpegPath, ffprobePath);
    const base = String(filename)
      .replace(/\.[^.]+$/, "")
      .replace(/[^\w.-]/g, "_");

    let outputPath: string;
    let outputName: string;
    let contentType: string;

    if (tool === "image-sequence") {
      const frameDuration = clamp(options.frameDuration, 0.02, 10, 1);
      const format = VALID_FORMATS.includes(options.format) ? options.format : "mp4";

      const imagePaths: string[] = [];
      for (let i = 0; i < inputBlobUrls.length; i++) {
        // Keep the original extension for readability; ffmpeg sniffs the
        // actual codec from content, so a wrong/missing extension is fine.
        const urlExt = path.posix.extname(new URL(inputBlobUrls[i]).pathname);
        const ext = /^\.\w+$/.test(urlExt) ? urlExt : ".png";
        const imagePath = path.join(
          workDir,
          `src_${String(i + 1).padStart(4, "0")}${ext}`
        );
        await downloadBlob(inputBlobUrls[i], imagePath);
        imagePaths.push(imagePath);
      }

      outputPath = await processor.createImageSequenceVideo(
        imagePaths,
        workDir,
        frameDuration,
        format
      );
      outputName = `${base}_video.${format}`;
      contentType = CONTENT_TYPES[format];
    } else {
      const fadeDuration = clamp(options.fadeDuration, 0, 10, 0.5);
      const startSecond = clamp(options.startSecond, 0, Number.MAX_SAFE_INTEGER, 0);

      const inputPath = path.join(workDir, "input.mp4");
      await downloadBlob(inputBlobUrls[0], inputPath);

      outputPath = await processor.createLoop(
        inputPath,
        tool,
        String(fadeDuration),
        String(startSecond)
      );
      outputName = `${base}_loop.mp4`;
      contentType = "video/mp4";
    }

    const result = await put(`results/${outputName}`, fs.createReadStream(outputPath), {
      access: "public",
      contentType,
      addRandomSuffix: true,
    });

    return res.status(200).json({
      url: result.url,
      downloadUrl: result.downloadUrl,
      filename: outputName,
    });
  } catch (err) {
    console.error("Processing error:", err);
    return res
      .status(500)
      .json({ error: err instanceof Error ? err.message : "Processing failed" });
  } finally {
    for (const url of inputBlobUrls) {
      await del(url).catch(() => {});
    }
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/* eslint-disable @typescript-eslint/no-var-requires */
// CommonJS keeps setup simple; swap to ESM if your project already uses it.
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");
const { nanoid } = require("nanoid");
// Add ffmpeg and ffprobe static imports to use bundled binaries
const ffmpegPath = require("ffmpeg-static");
const ffprobePath = require("ffprobe-static").path;
const VideoProcessor = require("./video-processor");

// Import types
import { Request, Response } from "express";

// Ensure tmp dirs exist (multer will not create them)
fsSync.mkdirSync("tmp/uploads", { recursive: true });

const app = express();
const upload = multer({ dest: "tmp/uploads" });

// Valid looping techniques
const VALID_TECHNIQUES = ["crossfade", "reverse"];

// Error handling middleware
app.use(express.json());

app.post(
  "/api/loop",
  upload.single("video"),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    // Get and validate the technique parameter
    const technique =
      req.body.technique && VALID_TECHNIQUES.includes(req.body.technique)
        ? req.body.technique
        : "reverse"; // Default to reverse if invalid

    const tmpIn = req.file.path; // tmp/uploads/<id>
    const tmpOut = `${tmpIn}_loop.mp4`; // produced by video processor

    try {
      console.log("Processing video:", tmpIn);
      console.log("Using technique:", technique);
      console.log("ffmpeg path:", ffmpegPath);
      console.log("ffprobe path:", ffprobePath);

      // Get fade duration and start second parameters (for crossfade technique)
      const fadeDuration = req.body.fade_duration || "0.5";
      const startSecond = req.body.start_second || "0";

      if (technique === "crossfade") {
        console.log("Fade duration:", fadeDuration, "seconds");
        console.log("Start second:", startSecond, "seconds");
      }

      // ── Create video processor and process the video ─────────────────────────
      const processor = new VideoProcessor(ffmpegPath, ffprobePath);

      console.log("Processing video with cross-platform video processor");

      await processor.createLoop(tmpIn, technique, fadeDuration, startSecond);

      // validate output exists
      try {
        await fs.access(tmpOut);
        console.log("Output file found:", tmpOut);
      } catch (err: any) {
        console.error("Output file not found:", tmpOut);
        throw new Error(
          "Failed to generate output file. The conversion process did not produce an output file."
        );
      }

      // ── stream the video back ──────────────────────────────────────────────
      res.download(
        tmpOut,
        req.file.originalname.replace(/\.[^.]+$/, "") + "_loop.mp4",
        async (err: Error | null) => {
          // always clean up temp files
          await Promise.all([
            fs
              .unlink(tmpIn)
              .catch((e: Error) =>
                console.warn("Failed to remove input file:", e.message)
              ),
            fs
              .unlink(tmpOut)
              .catch((e: Error) =>
                console.warn("Failed to remove output file:", e.message)
              ),
          ]);
          if (err) {
            console.error("Download error:", err);
            // Don't send another response if headers already sent
            if (!res.headersSent) {
              res.status(500).json({ error: "Failed to send file" });
            }
          }
        }
      );
    } catch (e: any) {
      console.error("Processing error:", e);

      // Ensure tmp files are cleaned up
      try {
        await Promise.all([
          fs.unlink(tmpIn).catch(() => {}),
          fs.unlink(tmpOut).catch(() => {}),
        ]);
      } catch (cleanupError) {
        console.error("Cleanup error:", cleanupError);
      }

      // Set content type explicitly to avoid clients having to catch JSON parse errors
      res.setHeader("Content-Type", "application/json");
      res.status(500).json({
        error: e instanceof Error ? e.message : "Processing failed",
        detail: e instanceof Error ? e.stack : undefined,
      });
    }
  }
);

// Global error handler
app.use((err: any, req: Request, res: Response, next: any) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Server error", detail: err.message });
});

// Start the server if this is the main module
if (require.main === module) {
  app.listen(3001, () => console.log("Loop‑Maker API ▶ http://localhost:3001"));
}

// Export for testing
module.exports = app;

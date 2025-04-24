/* eslint-disable @typescript-eslint/no-var-requires */
// CommonJS keeps setup simple; swap to ESM if your project already uses it.
const express = require("express");
const multer = require("multer");
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");
const { nanoid } = require("nanoid");
// Add ffmpeg and ffprobe static imports to use bundled binaries
const ffmpegPath = require("ffmpeg-static");
const ffprobePath = require("ffprobe-static").path;

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
    const outId = nanoid(8);
    const tmpOut = `${tmpIn}_loop.mp4`; // produced by loop‑maker.sh

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

      // ── run the Bash wrapper ───────────────────────────────────────────────
      const scriptPath = path.resolve(__dirname, "loop-maker.sh");
      console.log("Script path:", scriptPath);

      // Verify the script exists and is executable
      try {
        const scriptStats = await fs.stat(scriptPath);
        console.log("Script exists:", scriptStats.isFile());

        // Make script executable if it's not already
        await fs.chmod(scriptPath, 0o755).catch((err: Error) => {
          console.warn("Could not change script permissions:", err.message);
        });
      } catch (err: any) {
        console.error("Error checking script:", err);
        throw new Error(`Script not found or not accessible: ${scriptPath}`);
      }

      await new Promise<void>((resolve, reject) => {
        // Set FFMPEG_PATH and FFPROBE_PATH environment variables for the subprocess
        const env = {
          ...process.env,
          FFMPEG_PATH: ffmpegPath,
          FFPROBE_PATH: ffprobePath,
        };

        console.log("Executing script with environment:", {
          FFMPEG_PATH: ffmpegPath,
          FFPROBE_PATH: ffprobePath,
        });

        execFile(
          scriptPath,
          [tmpIn, technique, fadeDuration, startSecond], // Pass all parameters
          { shell: true, env }, // Pass the updated environment
          (err: Error | null, stdout: string, stderr: string) => {
            if (stdout) console.log("Script output:", stdout);
            if (stderr) console.error("Script error:", stderr);
            if (err) {
              console.error("Execution error:", err);
              reject(new Error(`FFMPEG error: ${err.message}`));
            } else {
              resolve();
            }
          }
        );
      });

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

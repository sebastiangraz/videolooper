/* eslint-disable @typescript-eslint/no-var-requires */
// CommonJS keeps setup simple; swap to ESM if your project already uses it.
const express = require("express");
const multer = require("multer");
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");
const { nanoid } = require("nanoid");

// Import types
import { Request, Response } from "express";

// Ensure tmp dirs exist (multer will not create them)
fsSync.mkdirSync("tmp/uploads", { recursive: true });

const app = express();
const upload = multer({ dest: "tmp/uploads" });

// Valid looping techniques
const VALID_TECHNIQUES = ["crossfade", "reverse"];

app.post(
  "/api/loop",
  upload.single("video"),
  async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

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

      await new Promise<void>((resolve, reject) => {
        execFile(
          scriptPath,
          [tmpIn, technique, fadeDuration, startSecond], // Pass all parameters
          { shell: true },
          (err: Error | null, stdout: string, stderr: string) => {
            if (stdout) console.log("Script output:", stdout);
            if (stderr) console.error("Script error:", stderr);
            if (err) {
              console.error("Execution error:", err);
              reject(err);
            } else {
              resolve();
            }
          }
        );
      });

      // validate output exists
      await fs.access(tmpOut);
      console.log("Output file found:", tmpOut);

      // ── stream the video back ──────────────────────────────────────────────
      res.download(
        tmpOut,
        req.file.originalname.replace(/\.[^.]+$/, "") + "_loop.mp4",
        async (err: Error | null) => {
          // always clean up temp files
          await Promise.all([
            fs.unlink(tmpIn).catch(() => {}),
            fs.unlink(tmpOut).catch(() => {}),
          ]);
          if (err) console.error(err);
        }
      );
    } catch (e) {
      console.error("Processing error:", e);
      await Promise.all([
        fs.unlink(tmpIn).catch(() => {}),
        fs.unlink(tmpOut).catch(() => {}),
      ]);
      res.status(500).json({ error: "Processing failed" });
    }
  }
);

// Start the server if this is the main module
if (require.main === module) {
  app.listen(3001, () => console.log("Loop‑Maker API ▶ http://localhost:3001"));
}

// Export for testing
module.exports = app;

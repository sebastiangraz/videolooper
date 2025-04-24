const express = require("express");
const multer = require("multer");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const { nanoid } = require("nanoid");
const ffmpegStatic = require("ffmpeg-static");
const ffprobeStatic = require("ffprobe-static").path;
const os = require("os");

// Create the Express app
const app = express();

// Configure multer for memory storage instead of disk
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Valid looping techniques
const VALID_TECHNIQUES = ["crossfade", "reverse"];

// Create temp directory
const getTempDir = () => {
  return path.join(os.tmpdir(), "videolooper-" + nanoid(6));
};

// Utility to run an ffmpeg command and return a promise
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegStatic, args);
    let stdout = "";
    let stderr = "";

    ffmpeg.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
      }
    });

    ffmpeg.on("error", (err) => {
      reject(err);
    });
  });
}

// Function to create a reverse loop
async function createReverseLoop(inputPath, outputPath) {
  // First step: Create reversed video
  const reversePath = inputPath + "_reverse.mp4";

  try {
    // Create the reversed video
    await runFfmpeg([
      "-i",
      inputPath,
      "-vf",
      "reverse",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      reversePath,
    ]);

    // Concatenate original and reversed
    await runFfmpeg([
      "-i",
      inputPath,
      "-i",
      reversePath,
      "-filter_complex",
      "[0:v][1:v]concat=n=2:v=1:a=0",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "22",
      "-pix_fmt",
      "yuv420p",
      outputPath,
    ]);

    // Clean up reverse file
    fs.unlinkSync(reversePath);

    return outputPath;
  } catch (error) {
    // Clean up any temporary files
    try {
      if (fs.existsSync(reversePath)) fs.unlinkSync(reversePath);
    } catch (e) {}

    throw error;
  }
}

// Function to create a crossfade loop
async function createCrossfadeLoop(
  inputPath,
  outputPath,
  fadeDuration,
  startSecond
) {
  // Fallback to defaults if params are invalid
  fadeDuration = parseFloat(fadeDuration) || 0.5;
  startSecond = parseFloat(startSecond) || 0;

  // Get video info
  const getInfo = spawn(ffprobeStatic, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    inputPath,
  ]);

  let duration = "";

  await new Promise((resolve, reject) => {
    getInfo.stdout.on("data", (data) => {
      duration += data.toString();
    });

    getInfo.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error("Failed to get video duration"));
      }
    });
  });

  // Parse duration
  const videoDuration = parseFloat(duration.trim());
  if (isNaN(videoDuration)) {
    throw new Error("Could not determine video duration");
  }

  // Validate fade duration isn't too long
  if (fadeDuration >= videoDuration / 2) {
    fadeDuration = videoDuration / 4; // Use 1/4 of video as fallback
  }

  // Temp directory for intermediate files
  const tempDir = getTempDir();
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    // Extract start and end segments for crossfade
    const startClip = path.join(tempDir, "start.mp4");
    const endClip = path.join(tempDir, "end.mp4");
    const crossfadeClip = path.join(tempDir, "crossfade.mp4");

    // Extract first part for crossfade
    await runFfmpeg([
      "-i",
      inputPath,
      "-t",
      fadeDuration.toString(),
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-pix_fmt",
      "yuv420p",
      startClip,
    ]);

    // Extract end part for crossfade
    const endStart = videoDuration - fadeDuration;
    await runFfmpeg([
      "-i",
      inputPath,
      "-ss",
      endStart.toString(),
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-pix_fmt",
      "yuv420p",
      endClip,
    ]);

    // Create crossfade between end and start
    await runFfmpeg([
      "-i",
      endClip,
      "-i",
      startClip,
      "-filter_complex",
      `[0:v][1:v]xfade=transition=fade:duration=${fadeDuration}:offset=0[out]`,
      "-map",
      "[out]",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-pix_fmt",
      "yuv420p",
      crossfadeClip,
    ]);

    // Handle simple case (start = 0)
    if (startSecond === 0) {
      const mainClip = path.join(tempDir, "main.mp4");

      // Extract main body
      const mainStart = fadeDuration;
      const mainDuration = videoDuration - 2 * fadeDuration;

      await runFfmpeg([
        "-i",
        inputPath,
        "-ss",
        mainStart.toString(),
        "-t",
        mainDuration.toString(),
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-pix_fmt",
        "yuv420p",
        mainClip,
      ]);

      // Final concatenation
      const concatFile = path.join(tempDir, "concat.txt");
      fs.writeFileSync(
        concatFile,
        `file '${mainClip.replace(/'/g, "'\\''")}'
file '${crossfadeClip.replace(/'/g, "'\\''")}'`
      );

      await runFfmpeg([
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatFile,
        "-c",
        "copy",
        outputPath,
      ]);
    } else {
      // Custom start time
      const seg1 = path.join(tempDir, "seg1.mp4");
      const seg3 = path.join(tempDir, "seg3.mp4");

      // Handle segments based on custom start time
      if (
        startSecond > fadeDuration &&
        startSecond < videoDuration - fadeDuration
      ) {
        // Extract segment 1: startSecond to (end - fadeDuration)
        const seg1Duration = videoDuration - fadeDuration - startSecond;

        await runFfmpeg([
          "-i",
          inputPath,
          "-ss",
          startSecond.toString(),
          "-t",
          seg1Duration.toString(),
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-pix_fmt",
          "yuv420p",
          seg1,
        ]);

        // Extract segment 3: fadeDuration to startSecond
        const seg3Duration = startSecond - fadeDuration;

        if (seg3Duration > 0) {
          await runFfmpeg([
            "-i",
            inputPath,
            "-ss",
            fadeDuration.toString(),
            "-t",
            seg3Duration.toString(),
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-pix_fmt",
            "yuv420p",
            seg3,
          ]);

          // Final concatenation with 3 segments
          const concatFile = path.join(tempDir, "concat.txt");
          fs.writeFileSync(
            concatFile,
            `file '${seg1.replace(/'/g, "'\\''")}'
file '${crossfadeClip.replace(/'/g, "'\\''")}'
file '${seg3.replace(/'/g, "'\\''")}'`
          );

          await runFfmpeg([
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            concatFile,
            "-c",
            "copy",
            outputPath,
          ]);
        } else {
          // Only use seg1 and crossfade
          const concatFile = path.join(tempDir, "concat.txt");
          fs.writeFileSync(
            concatFile,
            `file '${seg1.replace(/'/g, "'\\''")}'
file '${crossfadeClip.replace(/'/g, "'\\''")}'`
          );

          await runFfmpeg([
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            concatFile,
            "-c",
            "copy",
            outputPath,
          ]);
        }
      } else {
        // Fallback for invalid start second - just use original and crossfade
        const concatFile = path.join(tempDir, "concat.txt");
        fs.writeFileSync(
          concatFile,
          `file '${crossfadeClip.replace(/'/g, "'\\''")}'`
        );

        await runFfmpeg([
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          concatFile,
          "-c",
          "copy",
          outputPath,
        ]);
      }
    }

    return outputPath;
  } catch (error) {
    throw error;
  } finally {
    // Clean up temp directory
    try {
      fs.readdirSync(tempDir).forEach((file) => {
        fs.unlinkSync(path.join(tempDir, file));
      });
      fs.rmdirSync(tempDir);
    } catch (e) {
      console.error("Error cleaning up:", e);
    }
  }
}

// API endpoint
app.post("/api/loop", upload.single("video"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  // Get and validate technique
  const technique =
    req.body.technique && VALID_TECHNIQUES.includes(req.body.technique)
      ? req.body.technique
      : "reverse";

  // Get fade duration and start second for crossfade technique
  const fadeDuration = req.body.fade_duration || "0.5";
  const startSecond = req.body.start_second || "0";

  try {
    // Create temp directory
    const tempDir = getTempDir();
    fs.mkdirSync(tempDir, { recursive: true });

    // Save uploaded file to temp dir
    const inputPath = path.join(tempDir, `input-${nanoid(6)}.mp4`);
    fs.writeFileSync(inputPath, req.file.buffer);

    // Output file path
    const outputPath = path.join(tempDir, `output-${nanoid(6)}.mp4`);

    // Process the video based on technique
    if (technique === "crossfade") {
      await createCrossfadeLoop(
        inputPath,
        outputPath,
        fadeDuration,
        startSecond
      );
    } else {
      await createReverseLoop(inputPath, outputPath);
    }

    // Check if output exists
    if (!fs.existsSync(outputPath)) {
      throw new Error("Failed to generate output file");
    }

    // Set appropriate headers
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${req.file.originalname.replace(
        /\.[^.]+$/,
        ""
      )}_loop.mp4"`
    );
    res.setHeader("Content-Type", "video/mp4");

    // Send the file
    const fileData = fs.readFileSync(outputPath);
    res.send(fileData);

    // Clean up
    try {
      fs.unlinkSync(inputPath);
      fs.unlinkSync(outputPath);
      fs.rmdirSync(tempDir);
    } catch (e) {
      console.error("Error cleaning up:", e);
    }
  } catch (error) {
    console.error("Processing error:", error);
    res.status(500).json({
      error: error.message || "Processing failed",
    });
  }
});

// Export for Vercel serverless function
module.exports = app;

const multer = require("multer");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const { nanoid } = require("nanoid");
const ffmpegStatic = require("ffmpeg-static");
const ffprobeStatic = require("ffprobe-static").path;
const os = require("os");

// Configure multer for memory storage instead of disk
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Valid looping techniques
const VALID_TECHNIQUES = ["crossfade", "reverse"];

// Create temp directory
const getTempDir = () => {
  return path.join(os.tmpdir(), "videolooper-" + nanoid(6));
};

// Import the runFfmpeg function and other processing logic from the main API file
const {
  runFfmpeg,
  createReverseLoop,
  createCrossfadeLoop,
} = require("../loop");

// For Vercel serverless function
module.exports = async (req, res) => {
  // Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Process the uploaded file with multer
    await new Promise((resolve, reject) => {
      upload.single("video")(req, res, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

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
};

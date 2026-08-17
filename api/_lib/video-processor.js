const { spawn } = require("child_process");
const fs = require("fs").promises;
const path = require("path");

/**
 * Cross-platform video tools: seamless loops (reverse / crossfade) and
 * image-sequence assembly (mp4 / gif / avif), all pure-Node ffmpeg.
 */
class VideoProcessor {
  constructor(ffmpegPath, ffprobePath) {
    this.ffmpeg = ffmpegPath;
    this.ffprobe = ffprobePath;
  }

  async createLoop(
    inputFile,
    technique = "reverse",
    fadeDuration = "0.5",
    startSecond = "0"
  ) {
    const outputFile = `${inputFile}_loop.mp4`;

    console.log(`Processing video: ${inputFile}`);
    console.log(`Output will be saved to: ${outputFile}`);
    console.log(`Using technique: ${technique}`);

    try {
      // Check if input file exists
      await fs.access(inputFile);

      if (technique === "crossfade") {
        await this.createCrossfadeLoop(
          inputFile,
          outputFile,
          fadeDuration,
          startSecond
        );
      } else {
        // Default to reverse technique
        await this.createReverseLoop(inputFile, outputFile);
      }

      // Verify output file was created
      await fs.access(outputFile);
      console.log(`Success! Seamless loop created at: ${outputFile}`);

      return outputFile;
    } catch (error) {
      console.error("Processing error:", error);
      throw error;
    }
  }

  async createReverseLoop(inputFile, outputFile) {
    console.log("Creating simple reversed loop...");

    const tempDir = path.join(
      path.dirname(inputFile),
      `tmp_loop_${Date.now()}`
    );
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const reverseFile = path.join(tempDir, "reverse.mp4");

      // Create reversed video
      await this.runFFmpeg([
        "-y",
        "-i",
        inputFile,
        "-vf",
        "reverse",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        reverseFile,
      ]);

      // Concatenate original and reversed
      await this.runFFmpeg([
        "-y",
        "-i",
        inputFile,
        "-i",
        reverseFile,
        "-filter_complex",
        // Normalize SAR on both inputs: re-encoding can round a source's
        // pixel aspect ratio differently, and concat rejects mismatched SARs.
        "[0:v]setsar=1[v0];[1:v]setsar=1[v1];[v0][v1]concat=n=2:v=1:a=0",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "22",
        "-pix_fmt",
        "yuv420p",
        outputFile,
      ]);
    } finally {
      // Clean up temp directory
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async createCrossfadeLoop(inputFile, outputFile, fadeDuration, startSecond) {
    console.log("Creating seamless loop with crossfade technique...");
    console.log(`Using fade duration: ${fadeDuration} seconds`);
    console.log(`Starting from: ${startSecond} seconds`);

    // Get video info
    const duration = await this.getVideoDuration(inputFile);
    const fps = await this.getVideoFPS(inputFile);

    console.log(`Video duration: ${duration} seconds, FPS: ${fps}`);

    // Validate fade duration
    if (parseFloat(fadeDuration) >= duration / 2) {
      throw new Error(
        `Fade duration (${fadeDuration}) must be less than half the video duration (${
          duration / 2
        })`
      );
    }

    if (parseFloat(fadeDuration) === 0) {
      // No fade, just copy or reorder
      if (parseFloat(startSecond) === 0) {
        console.log("No fade, no reorder: copying original file");
        await fs.copyFile(inputFile, outputFile);
      } else {
        console.log("No fade, reordering segments...");
        await this.reorderSegments(
          inputFile,
          outputFile,
          startSecond,
          duration
        );
      }
      return;
    }

    // Create crossfade loop
    const tempDir = path.join(
      path.dirname(inputFile),
      `tmp_loop_${Date.now()}`
    );
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const startClip = path.join(tempDir, "start.mp4");
      const endClip = path.join(tempDir, "end.mp4");
      const crossfadeClip = path.join(tempDir, "crossfade.mp4");

      // Extract start and end segments
      const endStartTime = duration - parseFloat(fadeDuration);

      await this.runFFmpeg([
        "-y",
        "-i",
        inputFile,
        "-t",
        fadeDuration,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-r",
        fps.toString(),
        "-pix_fmt",
        "yuv420p",
        startClip,
      ]);

      await this.runFFmpeg([
        "-y",
        "-i",
        inputFile,
        "-ss",
        endStartTime.toString(),
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-r",
        fps.toString(),
        "-pix_fmt",
        "yuv420p",
        endClip,
      ]);

      // Create crossfade
      await this.runFFmpeg([
        "-y",
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
        "-r",
        fps.toString(),
        "-pix_fmt",
        "yuv420p",
        crossfadeClip,
      ]);

      // Create final video based on start second
      if (parseFloat(startSecond) === 0) {
        // Standard loop: main body + crossfade
        const mainClip = path.join(tempDir, "main.mp4");
        const mainStart = parseFloat(fadeDuration);
        const mainDuration = duration - 2 * parseFloat(fadeDuration);

        await this.runFFmpeg([
          "-y",
          "-i",
          inputFile,
          "-ss",
          mainStart.toString(),
          "-t",
          mainDuration.toString(),
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-r",
          fps.toString(),
          "-pix_fmt",
          "yuv420p",
          mainClip,
        ]);

        await this.concatenateVideos(
          [mainClip, crossfadeClip],
          outputFile,
          tempDir
        );
      } else {
        // Custom start: segment after start + crossfade + segment before start
        const seg1 = path.join(tempDir, "seg1.mp4");
        const seg3 = path.join(tempDir, "seg3.mp4");

        const seg1Duration = endStartTime - parseFloat(startSecond);
        const seg3Duration = parseFloat(startSecond) - parseFloat(fadeDuration);

        const segments = [];

        if (seg1Duration > 0) {
          await this.runFFmpeg([
            "-y",
            "-i",
            inputFile,
            "-ss",
            startSecond,
            "-t",
            seg1Duration.toString(),
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-r",
            fps.toString(),
            "-pix_fmt",
            "yuv420p",
            seg1,
          ]);
          segments.push(seg1);
        }

        segments.push(crossfadeClip);

        if (seg3Duration > 0) {
          await this.runFFmpeg([
            "-y",
            "-i",
            inputFile,
            "-ss",
            fadeDuration,
            "-t",
            seg3Duration.toString(),
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-r",
            fps.toString(),
            "-pix_fmt",
            "yuv420p",
            seg3,
          ]);
          segments.push(seg3);
        }

        await this.concatenateVideos(segments, outputFile, tempDir);
      }
    } finally {
      // Clean up temp directory
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async createImageSequenceVideo(imagePaths, workDir, frameDuration, format, quality = 75) {
    console.log(
      `Assembling ${imagePaths.length} images into ${format} (quality ${quality})...`
    );

    const outputFile = path.join(workDir, `output.${format}`);

    // Target frame size: first image's dimensions, capped at 1920 on the
    // longest side (bounds gif/avif encode cost), floored to even for
    // yuv420p/x264.
    const probe = await this.runFFprobe([
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=s=x:p=0",
      imagePaths[0],
    ]);
    const [w, h] = probe.trim().split("x").map(Number);
    if (!w || !h) {
      throw new Error("Could not read dimensions of first image");
    }
    const scaleFactor = Math.min(1, 1920 / Math.max(w, h));
    const W = Math.max(2, Math.floor((w * scaleFactor) / 2) * 2);
    const H = Math.max(2, Math.floor((h * scaleFactor) / 2) * 2);

    // Normalize every image to a uniform PNG frame (mixed formats and
    // dimensions are the norm for user uploads; the sequence demuxer
    // needs identical frames).
    const framesDir = path.join(workDir, "frames");
    await fs.mkdir(framesDir, { recursive: true });
    for (let i = 0; i < imagePaths.length; i++) {
      const framePath = path.join(
        framesDir,
        `norm_${String(i + 1).padStart(4, "0")}.png`
      );
      await this.runFFmpeg([
        "-y",
        "-i",
        imagePaths[i],
        "-vf",
        `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`,
        "-frames:v",
        "1",
        framePath,
      ]);
    }

    const framerate = (1 / frameDuration).toString();
    const pattern = path.join(framesDir, "norm_%04d.png");

    if (format === "gif") {
      // Quality drives the palette size; at high quality use a fresh
      // palette per frame (much better color, larger file).
      const colors = Math.max(16, Math.min(256, Math.round((quality / 100) * 256)));
      const perFrame = quality >= 80;
      const vf = perFrame
        ? `split[a][b];[a]palettegen=stats_mode=single:max_colors=${colors}[p];[b][p]paletteuse=new=1:dither=sierra2_4a`
        : `split[a][b];[a]palettegen=stats_mode=diff:max_colors=${colors}[p];[b][p]paletteuse=dither=sierra2_4a`;
      await this.runFFmpeg([
        "-y",
        "-framerate",
        framerate,
        "-i",
        pattern,
        "-vf",
        vf,
        "-loop",
        "0",
        outputFile,
      ]);
    } else if (format === "avif") {
      // libaom crf: 0 best – 63 worst; quality 100 → 10, quality 1 → ~55.
      // Slow the encoder down a notch at high quality.
      const crf = Math.round(55 - (quality / 100) * 45);
      const cpuUsed = quality >= 80 ? "6" : "8";
      await this.runFFmpeg([
        "-y",
        "-framerate",
        framerate,
        "-i",
        pattern,
        "-c:v",
        "libaom-av1",
        "-crf",
        String(crf),
        "-b:v",
        "0",
        "-cpu-used",
        cpuUsed,
        "-row-mt",
        "1",
        "-threads",
        "0",
        "-pix_fmt",
        "yuv420p",
        "-f",
        "avif",
        outputFile,
      ]);
    } else {
      // mp4: constant 30fps output (frames duplicated by the fps filter)
      // so every player handles very low source frame rates.
      // x264 crf: 0 best – 51 worst; quality 100 → 12, quality 1 → ~35.
      const crf = Math.round(35 - (quality / 100) * 23);
      await this.runFFmpeg([
        "-y",
        "-framerate",
        framerate,
        "-i",
        pattern,
        "-vf",
        "fps=30,format=yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        String(crf),
        "-movflags",
        "+faststart",
        outputFile,
      ]);
    }

    return outputFile;
  }

  async changeSpeed(inputFile, multiplier) {
    console.log(`Changing playback speed by ${multiplier}x...`);

    const outputFile = `${inputFile}_speed.mp4`;
    const fps = await this.getVideoFPS(inputFile);

    // setpts rescales frame timestamps; keeping the source frame rate via
    // -r makes speed-ups drop frames (instead of raising the output fps)
    // and slow-downs duplicate frames. Audio is dropped like in the other
    // tools.
    await this.runFFmpeg([
      "-y",
      "-i",
      inputFile,
      "-vf",
      `setpts=PTS/${multiplier}`,
      "-r",
      fps.toString(),
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "22",
      "-pix_fmt",
      "yuv420p",
      outputFile,
    ]);

    return outputFile;
  }

  async reorderSegments(inputFile, outputFile, startSecond, duration) {
    const tempDir = path.join(
      path.dirname(inputFile),
      `tmp_loop_${Date.now()}`
    );
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const afterPart = path.join(tempDir, "after.mp4");
      const beforePart = path.join(tempDir, "before.mp4");

      // Extract segment after start second
      await this.runFFmpeg([
        "-y",
        "-i",
        inputFile,
        "-ss",
        startSecond,
        "-c",
        "copy",
        afterPart,
      ]);

      // Extract segment before start second
      await this.runFFmpeg([
        "-y",
        "-i",
        inputFile,
        "-to",
        startSecond,
        "-c",
        "copy",
        beforePart,
      ]);

      await this.concatenateVideos(
        [afterPart, beforePart],
        outputFile,
        tempDir
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async concatenateVideos(videoFiles, outputFile, tempDir) {
    const listFile = path.join(tempDir, "concat_list.txt");
    const listContent = videoFiles
      .map((f) => `file '${path.basename(f)}'`)
      .join("\n");

    await fs.writeFile(listFile, listContent);

    console.log(`Created concat list at: ${listFile}`);
    console.log(`List content:\n${listContent}`);

    // Try fast copy first, fallback to re-encoding
    try {
      await this.runFFmpeg(
        [
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          path.basename(listFile), // Use relative path within temp directory
          "-c",
          "copy",
          path.resolve(outputFile), // Use absolute path for output
        ],
        { cwd: tempDir }
      );
    } catch (error) {
      console.log("Fast concatenation failed, trying with re-encoding...");
      await this.runFFmpeg(
        [
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          path.basename(listFile), // Use relative path within temp directory
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-pix_fmt",
          "yuv420p",
          path.resolve(outputFile), // Use absolute path for output
        ],
        { cwd: tempDir }
      );
    }
  }

  async getVideoDuration(inputFile) {
    const output = await this.runFFprobe([
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      inputFile,
    ]);
    return parseFloat(output.trim());
  }

  async getVideoFPS(inputFile) {
    const output = await this.runFFprobe([
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=r_frame_rate",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      inputFile,
    ]);

    const fpsStr = output.trim();
    if (fpsStr.includes("/")) {
      const [num, den] = fpsStr.split("/").map(parseFloat);
      return num / den;
    }
    return parseFloat(fpsStr) || 30; // fallback to 30 fps
  }

  runFFmpeg(args, options = {}) {
    return this.runCommand(this.ffmpeg, args, options);
  }

  runFFprobe(args, options = {}) {
    return this.runCommand(this.ffprobe, args, options);
  }

  runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      console.log(`Running: ${command} ${args.join(" ")}`);
      if (options.cwd) {
        console.log(`Working directory: ${options.cwd}`);
      }

      const process = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        ...options,
      });

      let stdout = "";
      let stderr = "";

      process.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      process.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      process.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          console.error(`Command failed with code ${code}`);
          console.error(`Command: ${command} ${args.join(" ")}`);
          if (options.cwd) {
            console.error(`Working directory: ${options.cwd}`);
          }
          console.error(`stderr: ${stderr}`);
          reject(new Error(`Command failed: ${stderr || `Exit code ${code}`}`));
        }
      });

      process.on("error", (error) => {
        console.error(`Failed to start command: ${command} ${args.join(" ")}`);
        console.error(`Error: ${error.message}`);
        reject(new Error(`Failed to start command: ${error.message}`));
      });
    });
  }
}

module.exports = VideoProcessor;

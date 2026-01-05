const { spawn } = require("child_process");
const fs = require("fs").promises;
const path = require("path");

/**
 * Cross-platform video loop maker
 * Replicates the functionality of loop-maker.sh in Node.js
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
    startSecond = "0",
    lossless = false
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
          startSecond,
          lossless
        );
      } else {
        // Default to reverse technique
        await this.createReverseLoop(inputFile, outputFile, lossless);
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

  async createReverseLoop(inputFile, outputFile, lossless = false) {
    console.log("Creating simple reversed loop...");
    if (lossless) {
      console.log(
        "Using lossless encoding to preserve quality and color profile"
      );
    }

    const tempDir = path.join(
      path.dirname(inputFile),
      `tmp_loop_${Date.now()}`
    );
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const reverseFile = path.join(tempDir, "reverse.mp4");

      // Get video codec and color info for lossless mode
      let codecArgs = [];
      if (lossless) {
        const videoCodec = await this.getVideoCodec(inputFile);
        const colorInfo = await this.getColorInfo(inputFile);
        console.log("Color info detected:", JSON.stringify(colorInfo, null, 2));
        codecArgs = this.getLosslessCodecArgs(videoCodec, colorInfo);
        console.log("Lossless codec args:", codecArgs.join(" "));
      } else {
        codecArgs = ["-c:v", "libx264", "-preset", "fast"];
      }

      // Create reversed video
      await this.runFFmpeg([
        "-y",
        "-i",
        inputFile,
        "-vf",
        "reverse",
        ...codecArgs,
        reverseFile,
      ]);

      // Concatenate original and reversed
      if (lossless) {
        // For lossless, use the same codec args
        await this.runFFmpeg([
          "-y",
          "-i",
          inputFile,
          "-i",
          reverseFile,
          "-filter_complex",
          "[0:v][1:v]concat=n=2:v=1:a=0",
          ...codecArgs,
          outputFile,
        ]);
      } else {
        await this.runFFmpeg([
          "-y",
          "-i",
          inputFile,
          "-i",
          reverseFile,
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
          outputFile,
        ]);
      }
    } finally {
      // Clean up temp directory
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async createCrossfadeLoop(
    inputFile,
    outputFile,
    fadeDuration,
    startSecond,
    lossless = false
  ) {
    console.log("Creating seamless loop with crossfade technique...");
    console.log(`Using fade duration: ${fadeDuration} seconds`);
    console.log(`Starting from: ${startSecond} seconds`);
    if (lossless) {
      console.log(
        "Using lossless encoding to preserve quality and color profile"
      );
    }

    // Get video info
    const duration = await this.getVideoDuration(inputFile);
    const fps = await this.getVideoFPS(inputFile);

    console.log(`Video duration: ${duration} seconds, FPS: ${fps}`);

    // Get codec and color info for lossless mode
    let losslessCodecArgs = [];
    if (lossless) {
      const videoCodec = await this.getVideoCodec(inputFile);
      const colorInfo = await this.getColorInfo(inputFile);
      console.log("Color info detected:", JSON.stringify(colorInfo, null, 2));
      losslessCodecArgs = this.getLosslessCodecArgs(videoCodec, colorInfo);
      console.log("Lossless codec args:", losslessCodecArgs.join(" "));
    }

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
          duration,
          lossless
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

      // Build codec args for start/end clips
      const clipCodecArgs = lossless
        ? [...losslessCodecArgs, "-r", fps.toString()]
        : [
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-r",
            fps.toString(),
            "-pix_fmt",
            "yuv420p",
          ];

      await this.runFFmpeg([
        "-y",
        "-i",
        inputFile,
        "-t",
        fadeDuration,
        ...clipCodecArgs,
        startClip,
      ]);

      await this.runFFmpeg([
        "-y",
        "-i",
        inputFile,
        "-ss",
        endStartTime.toString(),
        ...clipCodecArgs,
        endClip,
      ]);

      // Create crossfade
      const crossfadeCodecArgs = lossless
        ? [...losslessCodecArgs, "-r", fps.toString()]
        : [
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-r",
            fps.toString(),
            "-pix_fmt",
            "yuv420p",
          ];

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
        ...crossfadeCodecArgs,
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
          ...clipCodecArgs,
          mainClip,
        ]);

        await this.concatenateVideos(
          [mainClip, crossfadeClip],
          outputFile,
          tempDir,
          lossless,
          losslessCodecArgs
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
            ...clipCodecArgs,
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
            ...clipCodecArgs,
            seg3,
          ]);
          segments.push(seg3);
        }

        await this.concatenateVideos(
          segments,
          outputFile,
          tempDir,
          lossless,
          losslessCodecArgs
        );
      }
    } finally {
      // Clean up temp directory
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async reorderSegments(
    inputFile,
    outputFile,
    startSecond,
    duration,
    lossless = false
  ) {
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

      // Get codec and color info for lossless mode if needed
      let losslessCodecArgs = [];
      if (lossless) {
        const videoCodec = await this.getVideoCodec(inputFile);
        const colorInfo = await this.getColorInfo(inputFile);
        console.log("Color info detected:", JSON.stringify(colorInfo, null, 2));
        losslessCodecArgs = this.getLosslessCodecArgs(videoCodec, colorInfo);
        console.log("Lossless codec args:", losslessCodecArgs.join(" "));
      }

      await this.concatenateVideos(
        [afterPart, beforePart],
        outputFile,
        tempDir,
        lossless,
        losslessCodecArgs
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async concatenateVideos(
    videoFiles,
    outputFile,
    tempDir,
    lossless = false,
    losslessCodecArgs = []
  ) {
    const listFile = path.join(tempDir, "concat_list.txt");
    const listContent = videoFiles
      .map((f) => `file '${path.basename(f)}'`)
      .join("\n");

    await fs.writeFile(listFile, listContent);

    console.log(`Created concat list at: ${listFile}`);
    console.log(`List content:\n${listContent}`);

    // If lossless is enabled, we need to re-encode to ensure hvc1 tag for HEVC
    // Skip fast copy to guarantee we get the correct tag
    const shouldSkipFastCopy = lossless && losslessCodecArgs.length > 0;

    // Try fast copy first (unless we need to re-encode for tag), fallback to re-encoding
    if (!shouldSkipFastCopy) {
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
        return; // Success with fast copy
      } catch (error) {
        console.log("Fast concatenation failed, trying with re-encoding...");
      }
    } else {
      console.log("Skipping fast copy to ensure correct HEVC tag (hvc1)...");
    }

    // Re-encode with appropriate codec args
    const reencodeArgs = lossless
      ? losslessCodecArgs
      : ["-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p"];

    await this.runFFmpeg(
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        path.basename(listFile), // Use relative path within temp directory
        ...reencodeArgs,
        path.resolve(outputFile), // Use absolute path for output
      ],
      { cwd: tempDir }
    );
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

  async getVideoCodec(inputFile) {
    try {
      const output = await this.runFFprobe([
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        inputFile,
      ]);
      return output.trim();
    } catch (error) {
      console.warn("Could not get video codec:", error);
      return null;
    }
  }

  async getColorInfo(inputFile) {
    try {
      // Query all stream info to get color metadata
      const output = await this.runFFprobe([
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=color_primaries,color_transfer,colorspace,color_range,pix_fmt,bit_depth",
        "-of",
        "json",
        inputFile,
      ]);
      const info = JSON.parse(output);
      const stream = info.streams?.[0];

      // Also try to get HDR metadata from format tags
      let hdrMetadata = {};
      try {
        const formatOutput = await this.runFFprobe([
          "-v",
          "error",
          "-show_entries",
          "format_tags",
          "-of",
          "json",
          inputFile,
        ]);
        const formatInfo = JSON.parse(formatOutput);
        const tags = formatInfo.format?.tags || {};
        hdrMetadata = {
          masterDisplay:
            tags.master_display || tags.MasteringDisplayColorPrimaries || null,
          maxCll: tags.max_cll || tags.MaxCLL || null,
          maxFall: tags.max_fall || tags.MaxFALL || null,
        };
      } catch (e) {
        // HDR metadata might not be present, that's okay
        console.log("No HDR metadata found in format tags");
      }

      // Infer colorspace if missing but we have HDR indicators
      let colorSpace = stream?.colorspace || null;
      if (
        !colorSpace &&
        stream?.color_primaries === "bt2020" &&
        stream?.color_transfer === "smpte2084"
      ) {
        // HDR10 with BT.2020 should use bt2020nc (non-constant luminance)
        colorSpace = "bt2020nc";
        console.log("Inferred colorspace bt2020nc for HDR10 video");
      }

      return {
        colorPrimaries: stream?.color_primaries || null,
        colorTrc: stream?.color_transfer || null,
        colorSpace: colorSpace,
        colorRange: stream?.color_range || null,
        pixFmt: stream?.pix_fmt || null,
        bitDepth: stream?.bit_depth || null,
        ...hdrMetadata,
      };
    } catch (error) {
      console.warn("Could not get color info:", error);
      return {
        colorPrimaries: null,
        colorTrc: null,
        colorSpace: null,
        colorRange: null,
        pixFmt: null,
        bitDepth: null,
        masterDisplay: null,
        maxCll: null,
        maxFall: null,
      };
    }
  }

  getLosslessCodecArgs(videoCodec, colorInfo) {
    let codecArgs = [];

    // Use lossless encoding with original codec or H.264 lossless
    if (videoCodec && videoCodec.includes("hevc")) {
      // Use hvc1 tag for macOS compatibility (instead of default hev1)
      codecArgs = [
        "-c:v",
        "libx265",
        "-crf",
        "0",
        "-preset",
        "slow",
        "-tag:v",
        "hvc1",
      ];

      // Build x265 parameters for HDR preservation
      const x265Params = [];

      // Preserve color metadata in x265
      if (colorInfo.colorPrimaries) {
        x265Params.push(`colorprim=${colorInfo.colorPrimaries}`);
      }
      if (colorInfo.colorTrc) {
        x265Params.push(`transfer=${colorInfo.colorTrc}`);
      }
      if (colorInfo.colorSpace) {
        x265Params.push(`colormatrix=${colorInfo.colorSpace}`);
      } else if (
        colorInfo.colorPrimaries === "bt2020" &&
        colorInfo.colorTrc === "smpte2084"
      ) {
        // Ensure bt2020nc is set for HDR10 even if not detected
        x265Params.push(`colormatrix=bt2020nc`);
      }
      if (colorInfo.colorRange) {
        x265Params.push(
          `range=${colorInfo.colorRange === "tv" ? "limited" : "full"}`
        );
      }

      // Preserve HDR metadata
      if (colorInfo.masterDisplay) {
        x265Params.push(`master-display=${colorInfo.masterDisplay}`);
      }
      if (colorInfo.maxCll) {
        x265Params.push(`max-cll=${colorInfo.maxCll}`);
      }
      if (colorInfo.maxFall) {
        // max-fall is part of max-cll in format "max_cll,max_fall"
        // If we have both, combine them
        if (colorInfo.maxCll) {
          x265Params[
            x265Params.length - 1
          ] = `max-cll=${colorInfo.maxCll},${colorInfo.maxFall}`;
        } else {
          // If we only have maxFall, we still need maxCll, so skip this
          console.warn("maxFall found without maxCll, skipping");
        }
      }

      // Preserve bit depth if it's 10-bit
      if (colorInfo.bitDepth && parseInt(colorInfo.bitDepth) === 10) {
        x265Params.push("input-depth=10");
        x265Params.push("output-depth=10");
      }

      if (x265Params.length > 0) {
        codecArgs.push("-x265-params", x265Params.join(":"));
      }
    } else {
      codecArgs = ["-c:v", "libx264", "-crf", "0", "-preset", "slow"];
    }

    // Preserve color metadata (FFmpeg level)
    if (colorInfo.colorPrimaries) {
      codecArgs.push("-color_primaries", colorInfo.colorPrimaries);
    }
    if (colorInfo.colorTrc) {
      codecArgs.push("-color_trc", colorInfo.colorTrc);
    }
    if (colorInfo.colorSpace) {
      codecArgs.push("-colorspace", colorInfo.colorSpace);
    } else if (
      colorInfo.colorPrimaries === "bt2020" &&
      colorInfo.colorTrc === "smpte2084"
    ) {
      // Ensure bt2020nc is set for HDR10 even if not detected
      codecArgs.push("-colorspace", "bt2020nc");
    }
    if (colorInfo.colorRange) {
      codecArgs.push("-color_range", colorInfo.colorRange);
    }

    // Preserve pixel format - important for HDR (e.g., yuv420p10le for 10-bit HDR)
    // Always preserve the original pixel format if it exists
    if (colorInfo.pixFmt) {
      codecArgs.push("-pix_fmt", colorInfo.pixFmt);
    } else if (!videoCodec?.includes("hevc")) {
      // Only default to yuv420p for non-HEVC if no format was detected
      codecArgs.push("-pix_fmt", "yuv420p");
    }

    // Copy all metadata from input
    codecArgs.push("-map_metadata", "0");

    // Also copy stream metadata
    codecArgs.push("-map_metadata:s:v:0", "0:s:v:0");

    return codecArgs;
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

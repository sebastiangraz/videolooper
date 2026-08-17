import { useState, ChangeEvent } from "react";
import { upload } from "@vercel/blob/client";
import styles from "./VideoToolUploader.module.css";

const VIDEO_ACCEPT =
  "video/*,.avi,.mkv,.mov,.webm,.m4v,.wmv,.mpg,.mpeg,.3gp,.ts";

// Available tools. Mirrored in api/process.ts (VALID_TOOLS); each tool's
// extra options are the conditional blocks in the JSX below.
const TOOLS = [
  {
    value: "reverse",
    label: "Loop – reverse (forward then reversed)",
    input: {
      accept: VIDEO_ACCEPT,
      multiple: false,
      pickerLabel: "choose video",
    },
    actionLabel: "Loop",
  },
  {
    value: "crossfade",
    label: "Loop – crossfade (smooth transition)",
    input: {
      accept: VIDEO_ACCEPT,
      multiple: false,
      pickerLabel: "choose video",
    },
    actionLabel: "Loop",
  },
  {
    value: "image-sequence",
    label: "Image sequence → video",
    input: { accept: "image/*", multiple: true, pickerLabel: "choose images" },
    actionLabel: "Create video",
  },
];

// Mirrored in api/process.ts (VALID_FORMATS)
const FORMATS = [
  { value: "mp4", label: "MP4" },
  { value: "gif", label: "GIF" },
  { value: "avif", label: "AVIF" },
];

// Rough output-size model: bytes per pixel per frame at quality 0 → 100.
// Real encoders vary wildly with content, so this is an order-of-magnitude
// estimate only.
const SIZE_BPP: Record<string, { min: number; max: number }> = {
  mp4: { min: 0.01, max: 0.15 },
  gif: { min: 0.05, max: 0.5 },
  avif: { min: 0.004, max: 0.1 },
};

function estimateOutputBytes(
  w: number,
  h: number,
  frames: number,
  format: string,
  quality: number,
): number {
  const bpp = SIZE_BPP[format] ?? SIZE_BPP.mp4;
  const t = quality / 100;
  // The server caps the longest side at 1920
  const scale = Math.min(1, 1920 / Math.max(w, h));
  const pixels = Math.round(w * scale) * Math.round(h * scale);
  // Quality affects size superlinearly
  return pixels * frames * (bpp.min + (bpp.max - bpp.min) * t * t);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const VideoToolUploader = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setMsg] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<string>("reverse");
  const [fadeDuration, setFadeDuration] = useState<number>(0.5);
  const [startSecond, setStartSecond] = useState<number>(0);
  const [frameDuration, setFrameDuration] = useState<number>(1);
  const [format, setFormat] = useState<string>("mp4");
  const [quality, setQuality] = useState<number>(75);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [imageDims, setImageDims] = useState<{ w: number; h: number } | null>(
    null,
  );

  const currentTool = TOOLS.find((t) => t.value === tool) ?? TOOLS[0];

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (!picked.length) return;

    // Frame order for image sequences follows the filenames (natural sort,
    // so img2 sorts before img10).
    const sorted = [...picked].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
    setFiles(sorted);
    setVideoDuration(0);
    setImageDims(null);

    const first = sorted[0];
    if (!currentTool.input.multiple && first.type.startsWith("video/")) {
      // Get video duration when a single video is selected
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        setVideoDuration(Math.floor(video.duration));
      };
      video.src = URL.createObjectURL(first);
    } else if (first.type.startsWith("image/")) {
      // First image's dimensions drive the output frame size (and the
      // size estimate)
      const img = new Image();
      img.onload = () => {
        setImageDims({ w: img.naturalWidth, h: img.naturalHeight });
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(first);
    }
  };

  const handleToolChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setTool(e.target.value);
    // A file picked for one tool is rarely valid for another
    setFiles([]);
    setVideoDuration(0);
    setImageDims(null);
  };

  const handleFadeDurationChange = (e: ChangeEvent<HTMLInputElement>) => {
    setFadeDuration(parseFloat(e.target.value));
  };

  const handleStartSecondChange = (e: ChangeEvent<HTMLInputElement>) => {
    setStartSecond(parseFloat(e.target.value));
  };

  const handleFrameDurationChange = (e: ChangeEvent<HTMLInputElement>) => {
    setFrameDuration(parseFloat(e.target.value));
  };

  const handleFormatChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setFormat(e.target.value);
  };

  const handleQualityChange = (e: ChangeEvent<HTMLInputElement>) => {
    setQuality(parseInt(e.target.value, 10));
  };

  const submit = async () => {
    if (!files.length) return;
    setBusy(true);

    try {
      const blobUrls: string[] = [];
      for (let i = 0; i < files.length; i++) {
        setMsg(
          files.length > 1
            ? `Uploading ${i + 1}/${files.length} …`
            : "Uploading …",
        );
        const blob = await upload(files[i].name, files[i], {
          access: "public",
          handleUploadUrl: "/api/upload",
          // Browsers report no type for some containers (.avi, .mkv on
          // certain systems); fall back so the upload token isn't refused.
          contentType: files[i].type || "application/octet-stream",
        });
        blobUrls.push(blob.url);
      }

      setMsg("Processing … this can take a minute");
      const isSequence = tool === "image-sequence";
      const res = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool,
          filename: files[0].name,
          ...(isSequence
            ? { blobUrls, options: { frameDuration, format, quality } }
            : { blobUrl: blobUrls[0], options: { fadeDuration, startSecond } }),
        }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(
          errorData?.error || `Server error (${res.status}): Unable to process`,
        );
      }
      const { url, filename: resultName } = await res.json();
      const downloadName =
        resultName || files[0].name.replace(/\.[^.]+$/, "") + "_loop.mp4";

      setMsg("Downloading result …");
      // Result lives on Blob storage (cross-origin), where the anchor
      // `download` attribute is ignored — fetch to an object URL instead.
      const fileRes = await fetch(url);
      if (!fileRes.ok)
        throw new Error(`Failed to download result (${fileRes.status})`);
      const objectUrl = URL.createObjectURL(await fileRes.blob());
      const a = Object.assign(document.createElement("a"), {
        href: objectUrl,
        download: downloadName,
      });
      a.click();
      URL.revokeObjectURL(objectUrl);

      fetch("/api/process", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      }).catch(() => {});

      setMsg(`Done – ${downloadName} downloaded`);
    } catch (err: unknown) {
      console.error(err);
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.container}>
      <input
        // Remount on tool change so the browser's file display resets
        key={tool}
        aria-label={currentTool.input.pickerLabel}
        type="file"
        accept={currentTool.input.accept}
        multiple={currentTool.input.multiple}
        onChange={pick}
        className={styles.fileInput}
      />

      <div className={styles.formGroup}>
        <label htmlFor="tool" className={styles.label}>
          Video Tool
        </label>
        <select
          id="tool"
          value={tool}
          onChange={handleToolChange}
          className={styles.select}
          disabled={busy}
        >
          {TOOLS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {tool === "crossfade" && (
        <>
          <div className={styles.formGroup}>
            <label htmlFor="fadeDuration" className={styles.label}>
              Fade Duration (seconds)
            </label>
            <input
              id="fadeDuration"
              type="number"
              min="0.1"
              max="5"
              step="0.1"
              value={fadeDuration}
              onChange={handleFadeDurationChange}
              className={styles.input}
              disabled={busy}
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="startSecond" className={styles.label}>
              Start Second (for thumbnail/social media)
            </label>
            <input
              id="startSecond"
              type="number"
              min="0"
              max={videoDuration > 0 ? videoDuration - fadeDuration : 30}
              step="0.5"
              value={startSecond}
              onChange={handleStartSecondChange}
              className={styles.input}
              disabled={busy}
            />
          </div>
        </>
      )}

      {tool === "image-sequence" && (
        <>
          <div className={styles.formGroup}>
            <label htmlFor="frameDuration" className={styles.label}>
              Time per frame (seconds)
            </label>
            <input
              id="frameDuration"
              type="number"
              min="0.02"
              max="10"
              step="0.1"
              value={frameDuration}
              onChange={handleFrameDurationChange}
              className={styles.input}
              disabled={busy}
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="format" className={styles.label}>
              Output format
            </label>
            <select
              id="format"
              value={format}
              onChange={handleFormatChange}
              className={styles.select}
              disabled={busy}
            >
              {FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="quality" className={styles.label}>
              Quality
              {files.length > 0 &&
                imageDims &&
                ` ~${formatBytes(
                  estimateOutputBytes(
                    imageDims.w,
                    imageDims.h,
                    files.length,
                    format,
                    quality,
                  ),
                )}`}
            </label>
            <input
              id="quality"
              type="range"
              min="1"
              max="100"
              step="1"
              value={quality}
              onChange={handleQualityChange}
              className={styles.input}
              disabled={busy}
            />
          </div>
        </>
      )}

      {videoDuration > 0 && (
        <small className={styles.label}>
          Video length: {videoDuration} seconds
        </small>
      )}
      <button
        onClick={submit}
        disabled={!files.length || busy}
        className={styles.button}
      >
        {busy ? "Working …" : currentTool.actionLabel}
      </button>
      {status && <p className={styles.status}>{status}</p>}
    </div>
  );
};

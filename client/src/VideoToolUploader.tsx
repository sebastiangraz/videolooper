import { useState, ChangeEvent, CSSProperties } from "react";
import { upload } from "@vercel/blob/client";
import styles from "./VideoToolUploader.module.css";

const VIDEO_ACCEPT =
  "video/*,.avi,.mkv,.mov,.webm,.m4v,.wmv,.mpg,.mpeg,.3gp,.ts";

// Available tools. Mirrored in api/process.ts (VALID_TOOLS); each tool's
// extra options are the conditional blocks in the JSX below. Also drives
// the routes and tab navigation in App.tsx.
export const TOOLS = [
  {
    value: "loop",
    label: "Loop",
    input: {
      accept: VIDEO_ACCEPT,
      multiple: false,
      pickerLabel: "choose video",
    },
    actionLabel: "Loop",
  },
  {
    value: "sequence",
    label: "Sequence",
    input: { accept: "image/*", multiple: true, pickerLabel: "choose images" },
    actionLabel: "Create video",
  },
  {
    value: "speed",
    label: "Speed",
    input: {
      accept: VIDEO_ACCEPT,
      multiple: false,
      pickerLabel: "choose video",
    },
    actionLabel: "Change speed",
  },
];

// Looping techniques for the "loop" tool. Mirrored in api/process.ts
// (VALID_TECHNIQUES)
const TECHNIQUES = [
  { value: "crossfade", label: "Crossfade" },
  { value: "reverse", label: "Forward & reverse" },
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

// Accept both "0.5" and "0,5". <input type="number"> rejects one or the
// other depending on the browser locale (and reports "" for the rejected
// one, which parsed to NaN), so decimal fields are text inputs parsed here.
function parseDecimal(value: string): number {
  return parseFloat(value.trim().replace(",", "."));
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// The route remounts this component (keyed by tool) on tab change, so all
// state — picked files included — resets, like the old dropdown reset did.
export const VideoToolUploader = ({ tool }: { tool: string }) => {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setMsg] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [technique, setTechnique] = useState<string>("crossfade");
  // Decimal fields keep the raw text while typing ("0," is a valid prefix);
  // parseDecimal converts them on submit.
  const [fadeDuration, setFadeDuration] = useState<string>("0.5");
  const [startSecond, setStartSecond] = useState<string>("0");
  const [frameDuration, setFrameDuration] = useState<string>("1");
  const [format, setFormat] = useState<string>("mp4");
  const [quality, setQuality] = useState<number>(75);
  const [speed, setSpeed] = useState<number>(0);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [imageDims, setImageDims] = useState<{ w: number; h: number } | null>(
    null,
  );

  const currentTool = TOOLS.find((t) => t.value === tool) ?? TOOLS[0];

  // Signed speed ratio → playback multiplier: ±1 → 2× faster/slower,
  // ±3 → 4×. Mirrored in api/process.ts.
  const speedMultiplier = speed >= 0 ? 1 + speed : 1 / (1 - speed);

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

  const handleTechniqueChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setTechnique(e.target.value);
  };

  const handleFadeDurationChange = (e: ChangeEvent<HTMLInputElement>) => {
    setFadeDuration(e.target.value);
  };

  const handleStartSecondChange = (e: ChangeEvent<HTMLInputElement>) => {
    setStartSecond(e.target.value);
  };

  const handleFrameDurationChange = (e: ChangeEvent<HTMLInputElement>) => {
    setFrameDuration(e.target.value);
  };

  const handleFormatChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setFormat(e.target.value);
  };

  const handleQualityChange = (e: ChangeEvent<HTMLInputElement>) => {
    setQuality(parseInt(e.target.value, 10));
  };

  const handleSpeedChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSpeed(parseFloat(e.target.value));
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

      setMsg("Processing …");
      const payload =
        tool === "sequence"
          ? {
              blobUrls,
              options: {
                frameDuration: parseDecimal(frameDuration),
                format,
                quality,
              },
            }
          : tool === "speed"
            ? { blobUrl: blobUrls[0], options: { speed } }
            : {
                blobUrl: blobUrls[0],
                options: {
                  technique,
                  fadeDuration: parseDecimal(fadeDuration),
                  startSecond: parseDecimal(startSecond),
                  quality,
                },
              };
      const res = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool,
          filename: files[0].name,
          ...payload,
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

      setMsg(`Downloading ${downloadName}`);
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
    } catch (err: unknown) {
      console.error(err);
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className={styles.container}>
        <input
          aria-label={currentTool.input.pickerLabel}
          type="file"
          accept={currentTool.input.accept}
          multiple={currentTool.input.multiple}
          onChange={pick}
          className={styles.fileInput}
        />
      </div>

      <div className={styles.container}>
        {tool === "loop" && (
          <>
            <div className={styles.formGroup}>
              <label htmlFor="technique" className={styles.label}>
                Looping Technique
              </label>
              <select
                id="technique"
                value={technique}
                onChange={handleTechniqueChange}
                className={styles.select}
                disabled={busy}
              >
                {TECHNIQUES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            {technique === "crossfade" && (
              <>
                <div className={styles.formGroup}>
                  <label htmlFor="fadeDuration" className={styles.label}>
                    Fade Duration (seconds)
                  </label>
                  <input
                    id="fadeDuration"
                    type="text"
                    inputMode="decimal"
                    value={fadeDuration}
                    onChange={handleFadeDurationChange}
                    className={styles.input}
                    disabled={busy}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="startSecond" className={styles.label}>
                    Start Second (for thumbnails)
                  </label>
                  <input
                    id="startSecond"
                    type="text"
                    inputMode="decimal"
                    value={startSecond}
                    onChange={handleStartSecondChange}
                    className={styles.input}
                    disabled={busy}
                  />
                </div>
              </>
            )}

            <div className={styles.formGroup}>
              <label htmlFor="quality" className={styles.label}>
                Quality
              </label>
              <input
                id="quality"
                type="range"
                min={1}
                max={100}
                step="1"
                value={quality}
                onChange={handleQualityChange}
                className={styles.input}
                disabled={busy}
                style={
                  {
                    "--ratio": (quality - 1) / (100 - 1),
                  } as CSSProperties
                }
              />
            </div>
          </>
        )}

        {tool === "speed" && (
          <div className={styles.formGroup}>
            <label htmlFor="speed" className={styles.label}>
              Speed (
              {speed === 0
                ? "unchanged"
                : speed > 0
                  ? `${(1 + speed).toFixed(1)}× faster`
                  : `${(1 - speed).toFixed(1)}× slower`}
              {videoDuration > 0 &&
                ` – ~${(videoDuration / speedMultiplier).toFixed(1)}s`}
              )
            </label>
            <div className={styles.sliderTicks}>
              <input
                id="speed"
                type="range"
                min={-3}
                max={3}
                step="0.1"
                value={speed}
                onChange={handleSpeedChange}
                className={styles.input}
                disabled={busy}
                style={
                  {
                    "--ratio": (speed + 3) / 6,
                    "--fill-origin": "50%",
                  } as CSSProperties
                }
              />
            </div>
          </div>
        )}

        {tool === "sequence" && (
          <>
            <div className={styles.formGroup}>
              <label htmlFor="frameDuration" className={styles.label}>
                Time per frame (seconds)
              </label>
              <input
                id="frameDuration"
                type="text"
                inputMode="decimal"
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
                {format === "avif" && quality === 100
                  ? " (lossless)"
                  : files.length > 0 &&
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
                min={1}
                max={100}
                step="1"
                value={quality}
                onChange={handleQualityChange}
                className={styles.input}
                disabled={busy}
                style={
                  {
                    "--ratio": (quality - 1) / (100 - 1),
                  } as CSSProperties
                }
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
          {busy ? status && status : currentTool.actionLabel}
        </button>
        {/* {status && <p className={styles.status}>{status}</p>} */}
      </div>
    </>
  );
};

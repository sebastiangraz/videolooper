import { useState, ChangeEvent, CSSProperties } from "react";
import { upload } from "@vercel/blob/client";
import { Menu } from "@base-ui/react/menu";
import { NumberField } from "@base-ui/react/number-field";
import { Slider } from "@base-ui/react/slider";
import styles from "./VideoToolUploader.module.css";

const VIDEO_ACCEPT =
  "video/*,.avi,.mkv,.mov,.webm,.m4v,.wmv,.mpg,.mpeg,.3gp,.ts";

// Available tools. Mirrored in api/process.ts (VALID_TOOLS); each tool's
// extra options are the conditional blocks in the JSX below. Also drives
// the routes and tab navigation in App.tsx, where `description` fills the
// tab's preview card (keep it under 100 characters).
export const TOOLS = [
  {
    value: "loop",
    label: "Loop",
    description: "Seamlessly loop a video.",
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
    description:
      "Builds an MP4, GIF, or AVIF video from a set of images, one frame per image.",
    input: { accept: "image/*", multiple: true, pickerLabel: "choose images" },
    actionLabel: "Create video",
  },
  {
    value: "speed",
    label: "Speed",
    description:
      "Speeds up or slows down a video by up to 4× in either direction.",
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

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

type Option = { value: string; label: string };

// Select-style dropdown on Base UI's Menu: a trigger showing the current
// choice, radio items in the popup. The trigger takes the id so an external
// <label htmlFor> keeps working.
const OptionMenu = ({
  id,
  options,
  value,
  onValueChange,
  disabled,
}: {
  id: string;
  options: Option[];
  value: string;
  onValueChange: (value: string) => void;
  disabled: boolean;
}) => (
  <Menu.Root>
    <Menu.Trigger
      id={id}
      disabled={disabled}
      className={`${styles.select} ${styles.menuTrigger}`}
    >
      {options.find((o) => o.value === value)?.label}
    </Menu.Trigger>
    <Menu.Portal>
      <Menu.Positioner
        className={styles.menuPositioner}
        align="start"
        sideOffset={4}
      >
        <Menu.Popup className={styles.menuPopup}>
          <Menu.RadioGroup value={value} onValueChange={onValueChange}>
            {options.map((o) => (
              <Menu.RadioItem
                key={o.value}
                value={o.value}
                closeOnClick
                className={styles.menuItem}
              >
                <Menu.RadioItemIndicator
                  keepMounted
                  className={styles.menuItemIndicator}
                />
                {o.label}
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  </Menu.Root>
);

// Every field here is a duration, so values render with a seconds unit
// ("2.1s"). Base UI derives the unit label from the format options, so it also
// strips it back off when parsing typed input.
const SECONDS_FORMAT: Intl.NumberFormatOptions = {
  style: "unit",
  unit: "second",
  unitDisplay: "narrow",
};

// Decimal entry on Base UI's NumberField. Typed values are parsed with the
// browser locale ("0,5" and "0.5" both work where the locale allows),
// replacing the old manual comma handling.
const DecimalField = ({
  id,
  value,
  onValueChange,
  min,
  step,
  disabled,
}: {
  id: string;
  value: number | null;
  onValueChange: (value: number | null) => void;
  min?: number;
  step?: number;
  disabled: boolean;
}) => (
  <NumberField.Root
    id={id}
    value={value}
    onValueChange={onValueChange}
    min={min}
    step={step}
    format={SECONDS_FORMAT}
    disabled={disabled}
  >
    <NumberField.Group className={styles.numberGroup}>
      <NumberField.Decrement className={styles.numberButton}>
        −
      </NumberField.Decrement>
      <NumberField.Input className={styles.numberInput} />
      <NumberField.Increment className={styles.numberButton}>
        +
      </NumberField.Increment>
    </NumberField.Group>
  </NumberField.Root>
);

// The route remounts this component (keyed by tool) on tab change, so all
// state — picked files included — resets, like the old dropdown reset did.
export const VideoToolUploader = ({ tool }: { tool: string }) => {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setMsg] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [technique, setTechnique] = useState<string>("crossfade");
  // NumberField reports null while its input is empty; submit falls back to
  // each field's default.
  const [fadeDuration, setFadeDuration] = useState<number | null>(0.5);
  const [startSecond, setStartSecond] = useState<number | null>(0);
  const [frameDuration, setFrameDuration] = useState<number | null>(1);
  const [format, setFormat] = useState<string>("mp4");
  const [quality, setQuality] = useState<number>(100);
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
                frameDuration: frameDuration ?? 1,
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
                  fadeDuration: fadeDuration ?? 0.5,
                  startSecond: startSecond ?? 0,
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
                Technique
              </label>
              <OptionMenu
                id="technique"
                options={TECHNIQUES}
                value={technique}
                onValueChange={setTechnique}
                disabled={busy}
              />
            </div>

            {technique === "crossfade" && (
              <>
                <div className={styles.formGroup}>
                  <label htmlFor="fadeDuration" className={styles.label}>
                    Fade Duration
                  </label>
                  <DecimalField
                    id="fadeDuration"
                    value={fadeDuration}
                    onValueChange={setFadeDuration}
                    min={0}
                    step={0.1}
                    disabled={busy}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="startSecond" className={styles.label}>
                    Start Second
                  </label>
                  <DecimalField
                    id="startSecond"
                    value={startSecond}
                    onValueChange={setStartSecond}
                    min={0}
                    step={0.5}
                    disabled={busy}
                  />
                </div>
              </>
            )}

            <div className={styles.formGroup}>
              <Slider.Root
                value={quality}
                onValueChange={(value) => setQuality(value as number)}
                min={1}
                max={100}
                step={1}
                disabled={busy}
                thumbAlignment="edge"
                className={styles.slider}
              >
                <Slider.Label className={styles.label}>Quality</Slider.Label>
                <Slider.Control
                  className={styles.sliderControl}
                  style={
                    {
                      "--ratio": (quality - 1) / (100 - 1),
                    } as CSSProperties
                  }
                >
                  <Slider.Track className={styles.sliderTrack}>
                    <Slider.Thumb className={styles.sliderThumb} />
                  </Slider.Track>
                </Slider.Control>
              </Slider.Root>
            </div>
          </>
        )}

        {tool === "speed" && (
          <div className={styles.formGroup}>
            <Slider.Root
              value={speed}
              onValueChange={(value) => setSpeed(value as number)}
              min={-3}
              max={3}
              step={0.1}
              disabled={busy}
              thumbAlignment="edge"
              className={styles.slider}
            >
              <Slider.Label className={styles.label}>
                Speed (
                {speed === 0
                  ? "unchanged"
                  : speed > 0
                    ? `${(1 + speed).toFixed(1)}× faster`
                    : `${(1 - speed).toFixed(1)}× slower`}
                {videoDuration > 0 &&
                  ` – ~${(videoDuration / speedMultiplier).toFixed(1)}s`}
                )
              </Slider.Label>
              <div className={styles.sliderTicks}>
                <Slider.Control
                  className={styles.sliderControl}
                  style={
                    {
                      "--ratio": (speed + 3) / 6,
                      "--fill-origin": "50%",
                    } as CSSProperties
                  }
                >
                  <Slider.Track className={styles.sliderTrack}>
                    <Slider.Thumb className={styles.sliderThumb} />
                  </Slider.Track>
                </Slider.Control>
              </div>
            </Slider.Root>
          </div>
        )}

        {tool === "sequence" && (
          <>
            <div className={styles.formGroup}>
              <label htmlFor="frameDuration" className={styles.label}>
                Time per frame
              </label>
              <DecimalField
                id="frameDuration"
                value={frameDuration}
                onValueChange={setFrameDuration}
                min={0.1}
                step={0.1}
                disabled={busy}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="format" className={styles.label}>
                Output format
              </label>
              <OptionMenu
                id="format"
                options={FORMATS}
                value={format}
                onValueChange={setFormat}
                disabled={busy}
              />
            </div>

            <div className={styles.formGroup}>
              <Slider.Root
                value={quality}
                onValueChange={(value) => setQuality(value as number)}
                min={1}
                max={100}
                step={1}
                disabled={busy}
                thumbAlignment="edge"
                className={styles.slider}
              >
                <Slider.Label className={styles.label}>
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
                </Slider.Label>
                <Slider.Control
                  className={styles.sliderControl}
                  style={
                    {
                      "--ratio": (quality - 1) / (100 - 1),
                    } as CSSProperties
                  }
                >
                  <Slider.Track className={styles.sliderTrack}>
                    <Slider.Thumb className={styles.sliderThumb} />
                  </Slider.Track>
                </Slider.Control>
              </Slider.Root>
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

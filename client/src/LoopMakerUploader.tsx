import React from "react";
import { useState, ChangeEvent } from "react";
import styles from "./LoopMakerUploader.module.css";

// Available loop techniques
const TECHNIQUES = [
  { value: "reverse", label: "Reverse (play forward then reversed)" },
  { value: "crossfade", label: "Crossfade (smooth transition)" },
];

export const LoopMakerUploader = () => {
  const [file, setFile] = useState<File | null>(null);
  const [status, setMsg] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [technique, setTechnique] = useState<string>("reverse");
  const [fadeDuration, setFadeDuration] = useState<number>(0.5);
  const [startSecond, setStartSecond] = useState<number>(0);
  const [videoDuration, setVideoDuration] = useState<number>(0);

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);

      // Get video duration when file is selected
      if (selectedFile && selectedFile.type.startsWith("video/")) {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.onloadedmetadata = () => {
          setVideoDuration(Math.floor(video.duration));
        };
        video.src = URL.createObjectURL(selectedFile);
      }
    }
  };

  const handleTechniqueChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setTechnique(e.target.value);
  };

  const handleFadeDurationChange = (e: ChangeEvent<HTMLInputElement>) => {
    setFadeDuration(parseFloat(e.target.value));
  };

  const handleStartSecondChange = (e: ChangeEvent<HTMLInputElement>) => {
    setStartSecond(parseFloat(e.target.value));
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setMsg("Uploading and processing …");

    const form = new FormData();
    form.append("video", file);
    form.append("technique", technique);

    // Add fade duration if using crossfade technique
    if (technique === "crossfade") {
      form.append("fade_duration", fadeDuration.toString());
      form.append("start_second", startSecond.toString());
    }

    try {
      const res = await fetch("/api/loop", { method: "POST", body: form });
      if (!res.ok) {
        // backend now returns JSON on error
        const { error } = await res.json();
        throw new Error(error ?? `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), {
        href: url,
        download: file.name.replace(/\.[^.]+$/, "") + "_loop.mp4",
      });
      a.click();
      URL.revokeObjectURL(url);
      setMsg(`✅ Done – ${technique} loop downloaded`);
    } catch (err: unknown) {
      console.error(err);
      setMsg("❌ " + (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.container}>
      <input
        aria-label="choose video"
        type="file"
        accept="video/*"
        onChange={pick}
        className={styles.fileInput}
      />

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
          {TECHNIQUES.map((tech) => (
            <option key={tech.value} value={tech.value}>
              {tech.label}
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
            {videoDuration > 0 && (
              <small className={styles.helpText}>
                Video length: {videoDuration} seconds
              </small>
            )}
          </div>
        </>
      )}

      <button
        onClick={submit}
        disabled={!file || busy}
        className={styles.button}
      >
        {busy ? "Working…" : "Make seamless loop"}
      </button>
      {status && <p className={styles.status}>{status}</p>}
    </div>
  );
};

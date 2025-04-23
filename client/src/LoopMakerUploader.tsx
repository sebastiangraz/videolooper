import React from "react";
import { useState, ChangeEvent } from "react";
import styles from "./LoopMakerUploader.module.css";

export const LoopMakerUploader = () => {
  const [file, setFile] = useState<File | null>(null);
  const [status, setMsg] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) setFile(e.target.files[0]);
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setMsg("Uploading and processing …");

    const form = new FormData();
    form.append("video", file);

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
      setMsg("✅ Done – file downloaded");
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

import React from "react";
import ReactDOM from "react-dom/client";
import { LoopMakerUploader } from "./LoopMakerUploader";
import styles from "./index.module.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <div className={styles.app}>
      <header className={styles.header}>
        <h1 className={styles.title}>Video Looper</h1>
        <p className={styles.subtitle}>Create seamless looping videos</p>
      </header>

      <main className={styles.main}>
        <LoopMakerUploader />
      </main>

      <footer className={styles.footer}>
        Video Looper &copy; {new Date().getFullYear()}
      </footer>
    </div>
  </React.StrictMode>
);

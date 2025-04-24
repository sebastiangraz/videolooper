import React from "react";
import ReactDOM from "react-dom/client";
import { LoopMakerUploader } from "./LoopMakerUploader";
import styles from "./index.module.css";
import "./index.css";

const Logo = () => {
  return (
    <div className={styles.logo}>
      <svg
        viewBox="0 0 176 111"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid meet"
      >
        <path
          fill-rule="evenodd"
          clip-rule="evenodd"
          d="M0 74V110.711L49.4873 61.2234C52.6123 58.0994 57.6768 58.0994 60.8018 61.2236L90.2881 90.7104C109.814 110.237 141.473 110.237 160.999 90.7104C180.524 71.1843 180.524 39.5261 160.999 20C141.473 0.473633 109.814 0.473633 90.2881 20L60.8018 49.4871C57.6768 52.6111 52.6123 52.6111 49.4873 49.4871L0 0V37L52.7051 54.5229C54.4668 55.1089 56.3789 55.0635 58.1113 54.3943L85.8447 43.6841C104.411 37.1582 134.511 37.1582 153.076 43.6841C171.642 50.2097 171.642 60.79 153.076 67.3159C134.511 73.8416 104.411 73.8416 85.8447 67.3159L58.1113 56.6055C56.3789 55.9365 54.4668 55.8911 52.7051 56.4771L0 74Z"
          fill="currentColor"
        />
      </svg>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <Logo />
          <h1 className={styles.title}>Seamless video looper</h1>
        </div>
      </header>

      <main className={styles.main}>
        <LoopMakerUploader />
      </main>
    </div>
  </React.StrictMode>
);

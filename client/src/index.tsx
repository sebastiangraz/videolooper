import React from "react";
import ReactDOM from "react-dom/client";
import { LoopMakerUploader } from "./LoopMakerUploader";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-black text-white p-4 shadow-md">
        <h1 className="text-xl font-bold">Video Looper</h1>
        <p className="text-sm text-gray-300">Create seamless looping videos</p>
      </header>

      <main className="flex-grow py-8">
        <LoopMakerUploader />
      </main>

      <footer className="bg-gray-100 p-4 text-center text-gray-500 text-sm">
        Video Looper &copy; {new Date().getFullYear()}
      </footer>
    </div>
  </React.StrictMode>
);

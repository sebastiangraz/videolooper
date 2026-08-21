# Vendored gifski binaries

Version: **1.34.0** — from
https://github.com/ImageOptim/gifski/releases/download/1.34.0/gifski-1.34.0.tar.xz

- `linux/gifski` — static-pie linked (no glibc dependency), runs on the Vercel
  function runtime. The exec bit is set at runtime before spawning, so git
  file-mode quirks on Windows checkouts don't matter.
- `win/gifski.exe` — used by `vercel dev` on Windows.

gifski is AGPL-3.0 (see LICENSE). It runs as an unmodified, separate
subprocess, which is aggregation — it does not affect this repo's licensing.

To update: download the newer release tarball, replace the two binaries, and
bump the version above.

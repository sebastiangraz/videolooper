// Example edit for server/index.js to support fade_duration and start_second parameters
// This assumes the server is using Express with multer for file uploads

app.post("/api/loop", upload.single("video"), (req, res) => {
  const inputPath = req.file.path;
  const technique = req.body.technique || "reverse";
  const fadeDuration = req.body.fade_duration || "0.5";
  const startSecond = req.body.start_second || "0";

  // Construct command with all parameters
  const cmd = `${__dirname}/loop-maker.sh "${inputPath}" ${technique} ${fadeDuration} ${startSecond}`;

  exec(cmd, (error, stdout, stderr) => {
    // Handle the response
    if (error) {
      console.error(`Loop generation failed: ${error}`);
      return res
        .status(500)
        .json({ error: stderr || "Video processing failed" });
    }

    // Send the generated file
    const outputPath = `${inputPath}_loop.mp4`;
    res.sendFile(outputPath, (err) => {
      if (err) {
        console.error(`Failed to send file: ${err}`);
      }

      // Clean up temporary files after sending
      try {
        fs.unlinkSync(inputPath);
        fs.unlinkSync(outputPath);
      } catch (e) {
        console.error(`Cleanup error: ${e.message}`);
      }
    });
  });
});

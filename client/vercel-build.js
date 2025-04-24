// This is a helper script for Vercel builds
// It prints out information about the environment

console.log("Vercel client build helper");
console.log("Node version:", process.version);
console.log("Current directory:", process.cwd());
console.log("Directory contents:", require("fs").readdirSync("."));

// Run the actual build
const { execSync } = require("child_process");
try {
  console.log("Installing dependencies...");
  execSync("npm install", { stdio: "inherit" });

  console.log("Building client...");
  execSync("npm run build", { stdio: "inherit" });

  console.log("Build completed successfully!");
} catch (error) {
  console.error("Build failed:", error.message);
  process.exit(1);
}

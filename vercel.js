// This file helps Vercel understand the project structure
console.log("Vercel deployment helper");
console.log("Current directory:", process.cwd());
console.log("Directory contents:", require("fs").readdirSync("."));

// This is just a helper file to provide information during deployment
module.exports = {
  version: require("./package.json").version,
  projectStructure: {
    client: "./client",
    api: "./api",
  },
};

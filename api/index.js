// Export the Express app for standard Node.js usage
const app = require("./loop");

// For Vercel serverless function
module.exports = (req, res) => {
  // Handle the request with the Express app
  return app(req, res);
};

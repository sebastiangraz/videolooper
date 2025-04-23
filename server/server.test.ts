import request from "supertest";
import fs from "fs";
import path from "path";
import { jest } from "@jest/globals";

// Mock child_process execFile
jest.mock("child_process", () => ({
  execFile: jest.fn((file, args, callback) => {
    // Create a fake output file to simulate the bash script working
    const inputFile = args[0];
    const outputFile = `${inputFile}_loop.mp4`;

    // Create a simple file to simulate the output
    fs.writeFileSync(outputFile, "test content");

    // Call the callback with no error
    callback(null);
  }),
}));

// Import the Express app - for testing, server.ts should export the app
// We need to import it after mocking child_process
import app from "./server";

describe("Video Loop API", () => {
  const testFilePath = path.join(__dirname, "test-video.mp4");

  // Create a test file before tests
  beforeAll(() => {
    fs.writeFileSync(testFilePath, "test video content");
  });

  // Clean up test files after tests
  afterAll(() => {
    try {
      fs.unlinkSync(testFilePath);
    } catch (e) {
      // Ignore errors if file doesn't exist
    }
  });

  it("rejects when no file is sent", async () => {
    await request(app).post("/api/loop").expect(400);
  });

  it("returns mp4 when a video is uploaded", async () => {
    const res = await request(app)
      .post("/api/loop")
      .attach("video", testFilePath)
      .expect(200);
    expect(res.headers["content-type"]).toContain("video/mp4");
  });
});

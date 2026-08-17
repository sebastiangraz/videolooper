import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VideoToolUploader } from "./VideoToolUploader";
import { vi, it, expect, describe, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";

const uploadMock = vi.hoisted(() => vi.fn());
vi.mock("@vercel/blob/client", () => ({ upload: uploadMock }));

beforeEach(() => {
  vi.restoreAllMocks();
  uploadMock.mockReset();
  // jsdom implements neither of these
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
});

describe("VideoToolUploader", () => {
  it("disables the button until a file is chosen", () => {
    render(<VideoToolUploader />);
    const btn = screen.getByRole("button", { name: /loop/i });
    expect(btn).toBeDisabled();
  });

  it("enables the button after picking a file", async () => {
    const user = userEvent.setup();
    const file = new File(["00"], "tiny.mp4", { type: "video/mp4" });
    render(<VideoToolUploader />);

    const input = screen.getByLabelText(/choose video/i);
    await user.upload(input, file);

    expect(screen.getByRole("button", { name: /loop/i })).toBeEnabled();
  });

  it("clears the picked file when the tool changes", async () => {
    const user = userEvent.setup();
    const file = new File(["00"], "tiny.mp4", { type: "video/mp4" });
    render(<VideoToolUploader />);

    await user.upload(screen.getByLabelText(/choose video/i), file);
    expect(screen.getByRole("button", { name: /loop/i })).toBeEnabled();

    await user.selectOptions(screen.getByLabelText(/video tool/i), "image-sequence");
    expect(screen.getByRole("button", { name: /create video/i })).toBeDisabled();
  });

  it("uploads to blob storage, requests processing, and downloads the result", async () => {
    const user = userEvent.setup();
    const file = new File(["00"], "tiny.mp4", { type: "video/mp4" });

    uploadMock.mockResolvedValue({
      url: "https://store.public.blob.vercel-storage.com/tiny-abc.mp4",
    });
    const resultUrl = "https://store.public.blob.vercel-storage.com/results/tiny_loop-xyz.mp4";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === "/api/process" && init?.method === "POST") {
        return new Response(
          JSON.stringify({ url: resultUrl, filename: "tiny_loop.mp4" }),
          { status: 200 }
        );
      }
      if (input === resultUrl) {
        return new Response(new Blob(["video"], { type: "video/mp4" }), { status: 200 });
      }
      if (input === "/api/process" && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected fetch: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<VideoToolUploader />);
    await user.upload(screen.getByLabelText(/choose video/i), file);
    await user.click(screen.getByRole("button", { name: /loop/i }));

    await waitFor(() =>
      expect(screen.getByText(/done – tiny_loop\.mp4 downloaded/i)).toBeInTheDocument()
    );
    expect(uploadMock).toHaveBeenCalledWith(
      "tiny.mp4",
      file,
      expect.objectContaining({ handleUploadUrl: "/api/upload" })
    );
    const processBody = JSON.parse(
      (fetchMock.mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.body as string) ?? "{}"
    );
    expect(processBody).toMatchObject({
      blobUrl: "https://store.public.blob.vercel-storage.com/tiny-abc.mp4",
      tool: "reverse",
      filename: "tiny.mp4",
      options: { fadeDuration: 0.5, startSecond: 0 },
    });
  });

  it("uploads images in filename order and requests an image sequence", async () => {
    const user = userEvent.setup();
    const fileB = new File(["00"], "b.png", { type: "image/png" });
    const fileA = new File(["00"], "a.png", { type: "image/png" });

    uploadMock.mockImplementation(async (name: string) => ({
      url: `https://store.public.blob.vercel-storage.com/${name}`,
    }));
    const resultUrl = "https://store.public.blob.vercel-storage.com/results/a_video-xyz.gif";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === "/api/process" && init?.method === "POST") {
        return new Response(
          JSON.stringify({ url: resultUrl, filename: "a_video.gif" }),
          { status: 200 }
        );
      }
      if (input === resultUrl) {
        return new Response(new Blob(["gif"], { type: "image/gif" }), { status: 200 });
      }
      if (input === "/api/process" && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected fetch: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<VideoToolUploader />);
    await user.selectOptions(screen.getByLabelText(/video tool/i), "image-sequence");
    await user.upload(screen.getByLabelText(/choose images/i), [fileB, fileA]);
    await user.selectOptions(screen.getByLabelText(/output format/i), "gif");
    await user.click(screen.getByRole("button", { name: /create video/i }));

    await waitFor(() =>
      expect(screen.getByText(/done – a_video\.gif downloaded/i)).toBeInTheDocument()
    );
    expect(uploadMock).toHaveBeenCalledTimes(2);
    expect(uploadMock).toHaveBeenNthCalledWith(1, "a.png", fileA, expect.anything());
    expect(uploadMock).toHaveBeenNthCalledWith(2, "b.png", fileB, expect.anything());
    const processBody = JSON.parse(
      (fetchMock.mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.body as string) ?? "{}"
    );
    expect(processBody).toMatchObject({
      tool: "image-sequence",
      filename: "a.png",
      blobUrls: [
        "https://store.public.blob.vercel-storage.com/a.png",
        "https://store.public.blob.vercel-storage.com/b.png",
      ],
      options: { frameDuration: 1, format: "gif", quality: 75 },
    });
  });
});

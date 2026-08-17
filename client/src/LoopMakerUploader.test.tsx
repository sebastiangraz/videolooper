import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoopMakerUploader } from "./LoopMakerUploader";
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

describe("LoopMakerUploader", () => {
  it("disables the button until a file is chosen", () => {
    render(<LoopMakerUploader />);
    const btn = screen.getByRole("button", { name: /loop/i });
    expect(btn).toBeDisabled();
  });

  it("enables the button after picking a file", async () => {
    const user = userEvent.setup();
    const file = new File(["00"], "tiny.mp4", { type: "video/mp4" });
    render(<LoopMakerUploader />);

    const input = screen.getByLabelText(/choose video/i);
    await user.upload(input, file);

    expect(screen.getByRole("button", { name: /loop/i })).toBeEnabled();
  });

  it("uploads to blob storage, requests processing, and downloads the result", async () => {
    const user = userEvent.setup();
    const file = new File(["00"], "tiny.mp4", { type: "video/mp4" });

    uploadMock.mockResolvedValue({
      url: "https://store.public.blob.vercel-storage.com/tiny-abc.mp4",
    });
    const resultUrl = "https://store.public.blob.vercel-storage.com/results/tiny_loop-xyz.mp4";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === "/api/loop" && init?.method === "POST") {
        return new Response(JSON.stringify({ url: resultUrl }), { status: 200 });
      }
      if (input === resultUrl) {
        return new Response(new Blob(["video"], { type: "video/mp4" }), { status: 200 });
      }
      if (input === "/api/loop" && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected fetch: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<LoopMakerUploader />);
    await user.upload(screen.getByLabelText(/choose video/i), file);
    await user.click(screen.getByRole("button", { name: /loop/i }));

    await waitFor(() =>
      expect(screen.getByText(/done – reverse loop downloaded/i)).toBeInTheDocument()
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
      technique: "reverse",
      filename: "tiny.mp4",
    });
  });
});

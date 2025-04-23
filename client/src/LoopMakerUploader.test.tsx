import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoopMakerUploader } from "./LoopMakerUploader";
import { vi } from "vitest";
import { it, expect, describe } from "vitest";
import "@testing-library/jest-dom";

describe("LoopMakerUploader", () => {
  it("disables the button until a file is chosen", () => {
    render(<LoopMakerUploader />);
    const btn = screen.getByRole("button", { name: /make seamless loop/i });
    expect(btn).toBeDisabled();
  });

  it("enables the button after picking a file", async () => {
    const user = userEvent.setup();
    const file = new File(["00"], "tiny.mp4", { type: "video/mp4" });
    render(<LoopMakerUploader />);

    const input = screen.getByLabelText(/choose video/i);
    await user.upload(input, file);

    expect(
      screen.getByRole("button", { name: /make seamless loop/i })
    ).toBeEnabled();
  });
});

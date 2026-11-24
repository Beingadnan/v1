import { describe, expect, it } from "vitest";

import { uploadFailure } from "./upload-message";

describe("why an upload failed", () => {
  it("passes on the server's own reason", () => {
    expect(uploadFailure(422, "PR-02.exe is not an allowed type.", "PR-02.exe")).toBe(
      "PR-02.exe is not an allowed type.",
    );
  });

  it("says the server failed, with its status, when there is no reason", () => {
    expect(uploadFailure(500, undefined, "PR-02 Data.xlsx")).toBe(
      "The server failed while storing PR-02 Data.xlsx (error 500). Check the app is running, then choose the file again. If it happens again, send the server's log.",
    );
    expect(uploadFailure(404, undefined, "PR-02 Data.xlsx")).toBe(
      "PR-02 Data.xlsx wasn't uploaded (error 404). Choose the file again.",
    );
  });
});

import { defineConfig } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Chrome can play a .y4m file as the webcam. Build one from the real-person fixture with ffmpeg (once).
const FAKE_CAMERA = join(tmpdir(), "deeppulse-fake-camera.y4m");
export const HAS_FAKE_CAMERA = (() => {
  if (existsSync(FAKE_CAMERA)) return true;
  try {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", "e2e/fixtures/real-person.mp4", "-vf", "fps=30", "-pix_fmt", "yuv420p", FAKE_CAMERA]);
    return true;
  } catch {
    return false; // no ffmpeg: camera tests skip, everything else still runs
  }
})();
process.env.DPZ_FAKE_CAMERA = HAS_FAKE_CAMERA ? "1" : "";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  fullyParallel: false, // one fake camera, one dev server
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    channel: "chrome", // the installed Chrome, so no browser download is needed
    permissions: ["camera"],
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        // software WebGL: headless GPU contexts crashed MediaPipe after a few tests
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        ...(HAS_FAKE_CAMERA ? [`--use-file-for-fake-video-capture=${FAKE_CAMERA}`] : []),
      ],
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

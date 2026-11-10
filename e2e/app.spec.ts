import { expect, test, type Page } from "@playwright/test";

const camera = !!process.env.DPZ_FAKE_CAMERA;
const verdict = (page: Page) => page.getByRole("status").filter({ hasText: "Verdict" });

/** Fail the test on any uncaught page error (crashes, not warnings). */
function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test.describe("scanner page", () => {
  test("loads with its controls and no page errors", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /blood.*behind the face/i })).toBeVisible();
    for (const name of ["Live", "Meeting"]) await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
    await expect(page.getByText("Upload", { exact: true })).toBeVisible();
    await expect(page.getByText("Photo", { exact: true })).toBeVisible();
    await expect(page.getByRole("switch", { name: /synthetic feed/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /ask the heart/i })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("live camera: a real person is verified alive while frames stream", async ({ page }) => {
    test.skip(!camera, "needs ffmpeg to build the fake camera");
    const errors = trackErrors(page);
    await page.goto("/");
    await expect(verdict(page)).toContainText("Alive.", { timeout: 60_000 });
    // BPM may read "––" until the peak is sharp enough, so prove liveness of the pipeline via the frame rate
    await expect(page.locator("div").filter({ hasText: /^Throughput/ }).last()).toHaveText(/[1-9]\d*\s*fps/i);
    expect(errors).toEqual([]);
  });

  test("red-team switch: a frozen feed is flagged synthetic, then recovers", async ({ page }) => {
    test.skip(!camera, "needs ffmpeg to build the fake camera");
    await page.goto("/");
    await expect(verdict(page)).toContainText("Alive.", { timeout: 60_000 });
    const sw = page.getByRole("switch", { name: /synthetic feed/i });
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await expect(verdict(page)).toContainText("Synthetic.", { timeout: 15_000 });
    await sw.click();
    await expect(verdict(page)).not.toContainText("Synthetic.", { timeout: 15_000 });
  });

  test("breath challenge: cues start, count and can be stopped", async ({ page }) => {
    test.skip(!camera, "needs ffmpeg to build the fake camera");
    await page.goto("/");
    await expect(verdict(page)).toContainText("Alive.", { timeout: 60_000 });
    await page.getByRole("button", { name: /ask the heart/i }).click();
    await expect(page.getByText("Get ready")).toBeVisible();
    await expect(page.getByText(/Breathe (in|out)/)).toBeVisible({ timeout: 6_000 });
    await expect(page.getByText(/\d+s · 1\/8/)).toBeVisible();
    await page.getByRole("button", { name: /stop the challenge/i }).click();
    await expect(page.getByText(/Breathe (in|out)/)).toHaveCount(0);
  });

  test("live mode still starts after an upload (both face engines in one page)", async ({ page }) => {
    test.skip(!camera, "needs ffmpeg to build the fake camera");
    const errors = trackErrors(page);
    await page.goto("/");
    await page.locator('input[accept="video/*"]').setInputFiles("e2e/fixtures/real-person.mp4");
    await expect(page.getByRole("progressbar", { name: "Video analysed" })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Live", exact: true }).click();
    // a crashed engine leaves the verdict on Standby with a Retry button
    await expect(verdict(page)).toContainText(/Alive|Listening|Synthetic/, { timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("a face model that never starts shows an error instead of hanging", async ({ page }) => {
    // regression: a MediaPipe/WebGL crash used to leave the scanner on "Standby" forever
    // block both engines: upload mode uses the original Face Mesh, live mode the Tasks landmarker
    await page.route(/face_landmarker.task|face_mesh_solution_packed_assets.data/, (route) => route.abort());
    await page.goto("/");
    await page.locator('input[accept="video/*"]').setInputFiles("e2e/fixtures/real-person.mp4");
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Loading face mesh")).toHaveCount(0);
  });

  test("meeting mode: switches over and waits for a window to share", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Meeting", exact: true }).click();
    await expect(page.getByRole("button", { name: "Meeting", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/In this meeting/i)).toBeVisible();
    await expect(page.getByText(/consent first/i)).toBeVisible();
    // headless Chrome never answers the screen-share picker, so the app must keep waiting rather than error out
    await expect(page.getByText("Pick the meeting window")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("switch", { name: /synthetic feed/i })).toHaveCount(0); // red-team is camera-only
    await page.getByRole("button", { name: "Live", exact: true }).click();
    await expect(page.getByText(/In this meeting/i)).toHaveCount(0);
  });
});

test.describe("upload", () => {
  test("a real person's video gets a report", async ({ playwright, baseURL }) => {
    test.setTimeout(240_000); // software WebGL analyses ~3 frames/s, so a 13.6 s clip takes ~2 min
    // own browser: headless Chrome's WebGL wears out after several MediaPipe pages share one browser
    const browser = await playwright.chromium.launch({ channel: "chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
    const page = await browser.newPage({ baseURL });
    const errors = trackErrors(page);
    await page.goto("/");
    await page.locator('input[accept="video/*"]').setInputFiles("e2e/fixtures/real-person.mp4");
    await expect(page.getByText("real-person.mp4")).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Video analysed" })).toBeVisible({ timeout: 60_000 });
    const report = page.getByRole("status").filter({ hasText: "Upload report" });
    await expect(report).toBeVisible({ timeout: 210_000 });
    await expect(report).toContainText("Likely alive.");
    await expect(report).toContainText(/\d+ bpm/);
    expect(errors).toEqual([]);
    await browser.close();
  });
});

test.describe("photo mode", () => {
  const photoReport = (page: Page) => page.getByRole("status").filter({ hasText: /photo report/i });

  test("a camera photo is scored by the in-browser AI-image model", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/");
    await page.locator('input[accept="image/*"]').setInputFiles("e2e/fixtures/real-person.jpg");
    await expect(page.getByText("No pulse in a photo.")).toBeVisible();
    await expect(page.getByRole("switch", { name: /synthetic feed/i })).toHaveCount(0);
    const report = photoReport(page);
    await expect(report).toContainText(/AI score\s*\d+%/i, { timeout: 60_000 }); // model downloaded and ran
    await expect(report).toContainText(/No AI signs found\.|Uncertain\.|Likely AI-generated\./);
    await expect(report).not.toContainText("Likely a real photo"); // never claims a photo is real
    expect(errors).toEqual([]);
  });

  test("a file that declares an AI generator is flagged from its metadata", async ({ page }) => {
    await page.goto("/");
    await page.locator('input[accept="image/*"]').setInputFiles("e2e/fixtures/sd-declared.png");
    const report = photoReport(page);
    await expect(report).toContainText("Declared AI-generated.", { timeout: 60_000 });
    await expect(report).toContainText("Stable Diffusion");
  });

  test("switching back to Live leaves photo mode", async ({ page }) => {
    await page.goto("/");
    await page.locator('input[accept="image/*"]').setInputFiles("e2e/fixtures/real-person.jpg");
    await expect(page.getByText("No pulse in a photo.")).toBeVisible();
    await page.getByRole("button", { name: "Live", exact: true }).click();
    await expect(page.getByText("No pulse in a photo.")).toHaveCount(0);
    await expect(page.getByRole("switch", { name: /synthetic feed/i })).toBeVisible();
  });
});

test.describe("proctor room", () => {
  test("starts empty and shows a live scanner within seconds", async ({ page, context }) => {
    await page.goto("/proctor");
    await expect(page.getByText("RELAY CONNECTED", { exact: false })).toBeVisible({ timeout: 10_000 });
    test.skip(!camera, "needs ffmpeg to build the fake camera");
    const scanner = await context.newPage();
    await scanner.goto("/");
    await expect(page.getByText(/live camera · \d+ fps/)).toBeVisible({ timeout: 60_000 });
    await scanner.close();
    await expect(page.getByText(/signal lost/)).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("proof-of-pulse certificates", () => {
  const claims = { session: "CAND-E2E1", diff: 5.1, p: 0.004, beats: 44, cues: 8, startedAt: Date.now() - 45_000, endedAt: Date.now() - 2_000 };

  test("a real certificate verifies; an edited one does not", async ({ page, request }) => {
    const res = await request.post("/api/certificate", { data: claims });
    expect(res.status()).toBe(200);
    const { token } = await res.json();

    await page.goto(`/verify?t=${encodeURIComponent(token)}`);
    await expect(page.getByRole("heading", { name: "Verified." })).toBeVisible();
    await expect(page.getByText("CAND-E2E1")).toBeVisible();
    await expect(page.getByText("+5.1 bpm on inhale")).toBeVisible();

    const [body, sig] = token.split(".");
    const cert = JSON.parse(Buffer.from(body, "base64url").toString());
    const forged = `${Buffer.from(JSON.stringify({ ...cert, diff: 99 })).toString("base64url")}.${sig}`;
    await page.goto(`/verify?t=${encodeURIComponent(forged)}`);
    await expect(page.getByRole("heading", { name: "Not valid." })).toBeVisible();
  });

  test("a failed challenge cannot get a certificate", async ({ request }) => {
    expect((await request.post("/api/certificate", { data: { ...claims, p: 0.6 } })).status()).toBe(400);
  });
});

test.describe("phone layout", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  for (const path of ["/", "/proctor", "/verify?t=x"]) {
    test(`${path} has no sideways scrolling`, async ({ page }) => {
      await page.goto(path);
      // these pages keep live connections open, so wait for content instead of network idle
      await expect(page.locator("main")).toBeVisible();
      await page.waitForTimeout(1500);
      const [scroll, inner] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      expect(scroll).toBeLessThanOrEqual(inner);
    });
  }
});

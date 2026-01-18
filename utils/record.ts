import { mkdir, readdir, writeFile } from "fs/promises";
import { resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";

type DirEntry = { name: string; isDirectory(): boolean };

const RESOURCES_ROOT = new URL("../data/staging/resources/", import.meta.url);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function listResourceBusinessDirs(): Promise<string[]> {
  const entries = (await readdir(RESOURCES_ROOT, {
    withFileTypes: true,
  })) as unknown as DirEntry[];

  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => !n.startsWith("."))
    .sort((a, b) => a.localeCompare(b));
}

async function recordOneBusinessFolder(folderName: string) {
  const businessDirUrl = new URL(`${folderName}/`, RESOURCES_ROOT);
  const indexUrl = new URL("index.html", businessDirUrl);
  const recordingUrl = new URL("recording.mp4", businessDirUrl);
  const recordingPath = fileURLToPath(recordingUrl);
  const userDataDirUrl = new URL(
    `../data/staging/.puppeteer_profile/${folderName}/`,
    import.meta.url,
  );
  const userDataDirPath = fileURLToPath(userDataDirUrl);

  // @ts-ignore - runtime dependency, may not be installed in editor environment
  const puppeteerMod: any = await import("puppeteer");
  // @ts-ignore - runtime dependency, may not be installed in editor environment
  const recorderMod: any = await import("puppeteer-screen-recorder");
  const PuppeteerScreenRecorder: any = recorderMod.PuppeteerScreenRecorder;

  // Keep Chromium profile inside the workspace (avoids macOS perms under ~/Library).
  await mkdir(userDataDirUrl, { recursive: true });

  const browser = await puppeteerMod.default.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 720 },
    userDataDir: userDataDirPath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--allow-file-access-from-files",
      "--autoplay-policy=no-user-gesture-required",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-crash-reporter",
    ],
  });

  const page = await browser.newPage();

  // Make interactions feel snappy (and keep file size lower).
  page.setDefaultTimeout(60_000);

  const recorder = new PuppeteerScreenRecorder(page, {
    // High-ish quality but not huge: 720p + lower fps.
    fps: 15,
    videoFrame: { width: 1280, height: 720 },
    videoBitrate: 2500,
    autopad: { color: "black" },
  });

  // Ensure output dir exists (should, but safe).
  await mkdir(businessDirUrl, { recursive: true });

  let started = false;
  try {
    await page.goto(indexUrl.href, { waitUntil: "domcontentloaded" });
    await sleep(250);

    await recorder.start(recordingPath);
    started = true;

    // Hover every element within nav/section/footer (including descendants).
    const elements = await page.$$(
      "nav, nav * , section, section * , footer, footer *",
    );

    for (const el of elements) {
      if ((page as any).isClosed?.() || (page as any).closed) break;
      try {
        const box = await el.boundingBox();
        if (!box) continue;
        if (box.width < 2 || box.height < 2) continue;

        await el.evaluate((node) =>
          node.scrollIntoView({ block: "center", inline: "center" }),
        );
        // small wait to allow scroll layout
        await sleep(10);

        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
          steps: 1,
        });
        await sleep(10);
      } catch {
        // ignore detached nodes / transient layout issues
      }
    }

    if (!(page as any).isClosed?.() && !(page as any).closed) {
      // Scroll to top quickly.
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(200);

      // Click the 3rd link in the nav "navlinks" section.
      let navLinks = await page.$$("nav .nav-links a");
      if (navLinks.length < 3) navLinks = await page.$$("nav #navLinks a");
      if (navLinks.length < 3) navLinks = await page.$$("nav a");

      if (navLinks.length >= 3) {
        try {
          await navLinks[2].click({ delay: 10 });
          await sleep(500);
        } catch {
          // ignore if not clickable
        }
      }
    }
  } finally {
    if (started) {
      try {
        await recorder.stop();
      } catch {
        // ignore stop errors if target closed
      }
    }
    try {
      await page.close();
    } catch {
      // ignore
    }
    try {
      await browser.close();
    } catch {
      // ignore
    }
  }

  // Write a tiny metadata file for traceability.
  const metaUrl = new URL("recording.json", businessDirUrl);
  await writeFile(
    metaUrl,
    JSON.stringify(
      {
        business_folder: folderName,
        index_html: indexUrl.href,
        recording: recordingUrl.href,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

export async function recordAllBusinessesFromResources() {
  const folders = await listResourceBusinessDirs();
  if (folders.length === 0) {
    console.log("No business folders found under data/staging/resources/");
    return;
  }

  const failures: Array<{ folder: string; error: string }> = [];

  for (const folder of folders) {
    console.log(`Recording: ${folder}`);
    try {
      await recordOneBusinessFolder(folder);
      console.log(`Saved: data/staging/resources/${folder}/recording.mp4`);
    } catch (err: any) {
      failures.push({ folder, error: String(err?.message ?? err) });
      console.error(`Failed: ${folder}\n${String(err?.message ?? err)}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\nRecording finished with ${failures.length} failures.`);
    process.exitCode = 1;
  }
}

// CLI entrypoint:
//   npm run record
const isMain =
  !!process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  recordAllBusinessesFromResources().catch((err) => {
    console.error("Recording failed:", err);
    process.exitCode = 1;
  });
}


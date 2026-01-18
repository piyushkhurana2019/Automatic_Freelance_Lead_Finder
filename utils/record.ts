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

async function smoothMouseMove(page: any, fromX: number, fromY: number, toX: number, toY: number, duration = 300) {
  const steps = Math.ceil(duration / 16); // ~60fps
  for (let i = 0; i <= steps; i++) {
    const progress = i / steps;
    // Ease-in-out for more natural movement
    const eased = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    
    const x = fromX + (toX - fromX) * eased;
    const y = fromY + (toY - fromY) * eased;
    
    await page.mouse.move(x, y);
    await sleep(16);
  }
}

async function smoothScroll(page: any, targetY: number, duration = 800) {
  const startY = await page.evaluate(() => window.scrollY);
  const distance = targetY - startY;
  const steps = Math.ceil(duration / 16);
  
  for (let i = 0; i <= steps; i++) {
    const progress = i / steps;
    // Ease-in-out
    const eased = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    
    const currentY = startY + distance * eased;
    await page.evaluate((y: number) => window.scrollTo(0, y), currentY);
    await sleep(16);
  }
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
      "--force-device-scale-factor=1",
    ],
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(60_000);

  const recorder = new PuppeteerScreenRecorder(page, {
    fps: 30,
    videoFrame: { width: 1280, height: 720 },
    videoBitrate: 3000,
    autopad: { color: "black" },
  });

  await mkdir(businessDirUrl, { recursive: true });

  let started = false;
  let currentX = 640;
  let currentY = 100;

  try {
    await page.goto(indexUrl.href, { waitUntil: "domcontentloaded" });
    
    // Inject visible cursor AFTER page load
    await page.evaluate(() => {
      // Create cursor element
      const cursor = document.createElement('div');
      cursor.id = 'custom-cursor';
      cursor.style.cssText = `
        position: fixed;
        width: 20px;
        height: 20px;
        pointer-events: none;
        z-index: 999999;
        transition: none;
      `;
      cursor.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
          <path d="M0 0 L0 16 L5 11 L8 18 L10 17 L7 10 L14 10 Z" 
                fill="white" stroke="black" stroke-width="1"/>
        </svg>
      `;
      document.body.appendChild(cursor);

      // Hide default cursor
      const style = document.createElement('style');
      style.textContent = '* { cursor: none !important; }';
      document.head.appendChild(style);

      // Track mouse movement
      (window as any).updateCursor = (x: number, y: number) => {
        const cursorEl = document.getElementById('custom-cursor');
        if (cursorEl) {
          cursorEl.style.left = x + 'px';
          cursorEl.style.top = y + 'px';
        }
      };
    });

    await sleep(500);

    await recorder.start(recordingPath);
    started = true;

    // Initial cursor position
    await page.mouse.move(currentX, currentY);
    await page.evaluate((x: number, y: number) => {
      (window as any).updateCursor?.(x, y);
    }, currentX, currentY);
    await sleep(300);

    // Get all sections in order
    const sections = await page.$$("nav, section, footer");

    for (const section of sections) {
      if ((page as any).isClosed?.() || (page as any).closed) break;

      try {
        // Scroll section into view smoothly
        const targetScrollY = await section.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return window.scrollY + rect.top - 100;
        });

        await smoothScroll(page, Math.max(0, targetScrollY), 600);
        await sleep(200);

        // Get key elements within this section (limit to important ones)
        const elements = await section.$$("a, button, h1, h2, h3, img[alt]");
        
        type HoverTarget = {
          el: any;
          box: { x: number; y: number; width: number; height: number };
        };
        const elementData: HoverTarget[] = [];
        
        for (const el of elements) {
          try {
            const box = await el.boundingBox();
            if (!box || box.width < 10 || box.height < 10) continue;
            
            const isVisible = await el.evaluate((node) => {
              const style = window.getComputedStyle(node);
              const rect = node.getBoundingClientRect();
              return (
                style.display !== 'none' && 
                style.visibility !== 'hidden' && 
                style.opacity !== '0' &&
                rect.width > 0 &&
                rect.height > 0
              );
            });
            
            if (!isVisible) continue;
            elementData.push({ el, box });
          } catch {
            continue;
          }
        }

        // Sort by position (top to bottom, then left to right)
        elementData.sort((a, b) => {
          const yDiff = a.box.y - b.box.y;
          if (Math.abs(yDiff) > 40) return yDiff;
          return a.box.x - b.box.x;
        });

        // Limit to max 5 elements per section for even timing
        const limitedElements = elementData.slice(0, 5);

        // Hover over elements in order
        for (const { box } of limitedElements) {
          if ((page as any).isClosed?.() || (page as any).closed) break;

          try {
            const centerX = box.x + box.width / 2;
            const centerY = box.y + box.height / 2;

            // Smooth move from current position
            const distance = Math.sqrt(Math.pow(centerX - currentX, 2) + Math.pow(centerY - currentY, 2));
            const duration = Math.min(400, Math.max(200, distance / 2));

            // Move mouse and update cursor position smoothly
            const steps = Math.ceil(duration / 16);
            for (let i = 0; i <= steps; i++) {
              const progress = i / steps;
              const eased = progress < 0.5
                ? 2 * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 2) / 2;
              
              const x = currentX + (centerX - currentX) * eased;
              const y = currentY + (centerY - currentY) * eased;
              
              await page.mouse.move(x, y);
              await page.evaluate((mx: number, my: number) => {
                (window as any).updateCursor?.(mx, my);
              }, x, y);
              await sleep(16);
            }

            currentX = centerX;
            currentY = centerY;

            await sleep(100); // Brief pause on element
          } catch {
            // Ignore detached elements
          }
        }

        await sleep(150); // Brief pause after each section
      } catch {
        continue;
      }
    }

    // Scroll to top smoothly
    if (!(page as any).isClosed?.() && !(page as any).closed) {
      await smoothScroll(page, 0, 800);
      await sleep(300);

      // Click the 3rd nav link
      let navLinks = await page.$$("nav .nav-links a");
      if (navLinks.length < 3) navLinks = await page.$$("nav #navLinks a");
      if (navLinks.length < 3) navLinks = await page.$$("nav a");

      if (navLinks.length >= 3) {
        try {
          const linkBox = await navLinks[2].boundingBox();
          if (linkBox) {
            const linkX = linkBox.x + linkBox.width / 2;
            const linkY = linkBox.y + linkBox.height / 2;
            
            // Smooth move to link
            const steps = 20;
            for (let i = 0; i <= steps; i++) {
              const progress = i / steps;
              const eased = progress < 0.5
                ? 2 * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 2) / 2;
              
              const x = currentX + (linkX - currentX) * eased;
              const y = currentY + (linkY - currentY) * eased;
              
              await page.mouse.move(x, y);
              await page.evaluate((mx: number, my: number) => {
                (window as any).updateCursor?.(mx, my);
              }, x, y);
              await sleep(16);
            }
            
            await sleep(150);
            await navLinks[2].click({ delay: 50 });
            await sleep(600);

            // Smooth scroll to linked section
            const targetSection = await page.evaluate(() => {
              const hash = window.location.hash;
              if (hash) {
                const el = document.querySelector(hash);
                if (el) {
                  const rect = el.getBoundingClientRect();
                  return window.scrollY + rect.top - 100;
                }
              }
              return null;
            });

            if (targetSection !== null) {
              await smoothScroll(page, targetSection, 800);
              await sleep(400);
            }
          }
        } catch {
          // Ignore if not clickable
        }
      }

      await sleep(300);
    }
  } finally {
    if (started) {
      try {
        await recorder.stop();
      } catch {
        // Ignore stop errors
      }
    }
    try {
      await page.close();
    } catch {
      // Ignore
    }
    try {
      await browser.close();
    } catch {
      // Ignore
    }
  }

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

const isMain =
  !!process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  recordAllBusinessesFromResources().catch((err) => {
    console.error("Recording failed:", err);
    process.exitCode = 1;
  });
}
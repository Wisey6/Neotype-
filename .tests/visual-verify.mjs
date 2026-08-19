import { chromium } from "playwright-core";
const OUT = process.argv[2], B = "http://127.0.0.1:8901";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  ok ? pass++ : fail++;
};

async function page(path, w = 1440, h = 900) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", e => errs.push(e.message));
  await p.goto(B + path, { waitUntil: "networkidle" });
  await p.waitForTimeout(400);
  return { p, ctx, errs };
}

// ---- 1. logo doubled, header sized to fit ----
{
  const { p, ctx, errs } = await page("/index.html");
  const m = await p.evaluate(() => {
    const l = document.querySelector(".brand-logo"), n = document.querySelector(".nav");
    const lb = l.getBoundingClientRect(), nb = n.getBoundingClientRect();
    return { logoH: Math.round(lb.height), navH: Math.round(nb.height), fits: lb.height < nb.height };
  });
  console.log("\n[ logo x2 ]");
  check("logo is 116px (was 58)", m.logoH === 116, `${m.logoH}px`);
  check("nav taller than logo", m.fits, `nav ${m.navH}px`);
  check("no JS errors", errs.length === 0, errs.join("; "));
  await ctx.close();
}

// ---- 2. newsletter gone, footer is 3 columns ----
{
  const { p, ctx } = await page("/index.html");
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(1200);
  const m = await p.evaluate(() => ({
    form: !!document.getElementById("newsForm"),
    brand: !!document.querySelector(".footer-brand"),
    cols: [...document.querySelectorAll(".footer-grid h4")].map(h => h.textContent),
    fifteen: document.body.innerText.includes("15% off"),
    cssCols: getComputedStyle(document.querySelector(".footer-grid")).gridTemplateColumns.split(" ").length,
  }));
  console.log("\n[ newsletter removed ]");
  check("signup form gone", !m.form);
  check("brand block gone", !m.brand);
  check('no "15% off" anywhere', !m.fifteen);
  check("footer has 3 columns", m.cols.length === 3 && m.cssCols === 3, m.cols.join(", "));
  await p.screenshot({ path: `${OUT}/03-footer.png` });
  await ctx.close();
}

// ---- 3. upload control exists and opens a picker ----
{
  const { p, ctx } = await page("/customizer.html");
  const m = await p.evaluate(() => {
    const dz = document.getElementById("dropzone"), fi = document.getElementById("fileInput");
    return { dz: !!dz, input: !!fi, visible: dz ? dz.getBoundingClientRect().height > 0 : false,
             label: dz ? dz.innerText.replace(/\s+/g, " ").trim().slice(0, 60) : "" };
  });
  console.log("\n[ upload control ]");
  check("dropzone present and visible", m.dz && m.visible);
  check("file input present", m.input);
  check("copy still says 'Drop your file or browse'", /Drop your file or browse/.test(m.label), m.label);
  await ctx.close();
}

// ---- 4. mobile: header still sane ----
{
  const { p, ctx } = await page("/index.html", 390, 760);
  const m = await p.evaluate(() => {
    const l = document.querySelector(".brand-logo"), n = document.querySelector(".nav");
    return { logoH: Math.round(l.getBoundingClientRect().height),
             navH: Math.round(n.getBoundingClientRect().height),
             pctOfScreen: Math.round(n.getBoundingClientRect().height / window.innerHeight * 100) };
  });
  console.log("\n[ mobile header ]");
  check("logo is 72px on mobile", m.logoH === 72, `${m.logoH}px`);
  check("header under 20% of the screen", m.pctOfScreen < 20, `${m.navH}px = ${m.pctOfScreen}% of viewport`);
  await p.screenshot({ path: `${OUT}/02-home-header-mobile.png` });
  await ctx.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);

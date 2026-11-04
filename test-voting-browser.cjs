"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium, firefox, webkit } = require("playwright");
const browserName = process.env.TEST_BROWSER || "chromium";
const engines = { chromium, firefox, webkit };
if (!Object.hasOwn(engines, browserName)) throw new Error(`Unsupported TEST_BROWSER: ${browserName}`);

const source = path.resolve(process.cwd(), "voting-2026-2027.js");
if (!fs.existsSync(source)) throw new Error("Missing voting-2026-2027.js in repository root");
const script = fs.readFileSync(source);
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<form id="voteForm" style="display:none"><select id="seminar"><option value="">Choose</option><option value="Seminar 1">Seminar 1</option><option value="Seminar 2">Seminar 2</option></select><div id="presentations"></div><button type="submit">Submit evaluation</button></form>
<div id="votingWindowStatus"></div><div id="message"></div><script src="/voting-2026-2027.js"></script><script>window.updateVotingAccess();</script></body></html>`;
const server = http.createServer((req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.url === "/voting-2026-2027.js") { res.setHeader("Content-Type", "text/javascript; charset=utf-8"); res.end(script); }
  else { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(html); }
});

const mock = () => {
  Date.now = () => new Date("2026-11-13T12:00:00Z").getTime();
  const user = { uid: "test-user-1", email: "student@natur.cuni.cz", emailVerified: true };
  window.__mock = { writes: [], mode: "resolve", user, resolvePending: null };
  window.SEMINARS = {
    "Seminar 1": { presenters: ["Botond Bolgár", "Tereza Kárníková", "Deepak Kumar Bhuyan", "Aparna Vijayalekshmi Muraleedharan"] },
    "Seminar 2": { presenters: ["Amálie Amiot Vanoušková", "Paritosh Dey", "Laura Juliana Prieto Pabon", "Jan Jurica"] }
  };
  const auth = { currentUser: user };
  const db = { collection(name) {
    if (name !== "votes_2026_2027") throw Error("Unexpected collection");
    return { doc(id) { return { set(data) {
      window.__mock.writes.push({ id, data });
      if (window.__mock.mode === "reject") return Promise.reject(Object.assign(new Error("Rejected by test"), { code: "permission-denied" }));
      if (window.__mock.mode === "pending") return new Promise(resolve => { window.__mock.resolvePending = resolve; });
      return Promise.resolve();
    } }; } };
  } };
  window.firebase = { auth: () => auth, firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => "SERVER_TIMESTAMP_MOCK" } }) };
};

(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error("This browser test must not use Firebase credentials or emulator");
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await engines[browserName].launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript(mock);
  const url = `http://127.0.0.1:${server.address().port}/`;
  let page;
  const open = async () => { page = await context.newPage(); await page.goto(url); await page.selectOption("#seminar", "Seminar 1"); };
  const fill = async () => {
    for (let i = 1; i <= 4; i++) { await page.selectOption(`#pres${i}`, String(i + 5)); await page.fill(`#comment${i}`, `Comment ${i}`); }
  };
  const check = async () => {
    for (let i = 1; i <= 4; i++) { assert.equal(await page.locator(`#pres${i}`).inputValue(), String(i + 5)); assert.equal(await page.locator(`#comment${i}`).inputValue(), `Comment ${i}`); }
  };
  try {
    await open();
    await fill();
    await page.reload();
    await page.selectOption("#seminar", "Seminar 1");
    await check();
    console.log("PASS 1: scores and comments restored after reload");

    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.reload();
    await page.selectOption("#seminar", "Seminar 1");
    await check();
    console.log("PASS 2: draft retained after offline event and reload");

    await page.selectOption("#seminar", "Seminar 2");
    assert.equal(await page.locator("#pres1").inputValue(), "");
    await page.selectOption("#seminar", "Seminar 1");
    await check();
    console.log("PASS 3: drafts separated by seminar");

    await page.evaluate(() => { window.__mock.mode = "reject"; });
    await page.locator('#voteForm button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector("#message").textContent.includes("rejected"));
    await check();
    console.log("PASS 4: rejected submission preserves draft and fields");

    await page.evaluate(() => { window.__mock.mode = "pending"; });
    await page.locator('#voteForm button[type="submit"]').click();
    await page.waitForFunction(() => window.__mock.writes.length === 2);
    assert.equal(await page.locator('#voteForm button[type="submit"]').isDisabled(), true);
    await page.evaluate(() => document.getElementById("voteForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(await page.evaluate(() => window.__mock.writes.length), 2);
    console.log("PASS 5: pending submission blocks duplicate attempts");

    await page.evaluate(() => window.__mock.resolvePending());
    await page.waitForFunction(() => document.querySelector("#message").textContent.includes("successfully"));
    assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(k => k.includes("Seminar%201")).length), 0);
    assert.equal(await page.locator('#voteForm button[type="submit"]').isDisabled(), true);
    console.log("PASS 6: confirmed submission clears draft and disables resubmission");

    console.log(`ALL 6 BROWSER TESTS PASSED (${browserName}, mock Firebase, real voting JS)`);
  } finally {
    await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });

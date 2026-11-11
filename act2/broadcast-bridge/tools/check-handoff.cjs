/**
 * 黑板报 → 广播室过场自检。
 *
 * 覆盖两件事：
 *   1. 既有分镜：递稿姿态（girlHandoff）能显示，然后进 girlSit（原断言保留）；
 *   2. 设计文档 §1.6：分镜 03 走廊段的风吹稿纸小游戏——
 *      三张稿纸按种子抛物线落下、走过去按 E 能接、接住数写进
 *      `our-story-bridge-papers-v1`、小游戏不拦路；没写过这个键时缺省读 3。
 *   另外 §1.5 的回响：广播桥开场会引用第二幕的主题 + 一句结算评价（读
 *   `our-story-act2-board-eval-v1` 里的 evalIds / evals；旧档没有该键就不加这句）。
 *
 * 跑：node act2/broadcast-bridge/tools/check-handoff.cjs
 */
const { chromium } = require("../../../game/dust-corridor/node_modules/playwright-core");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const fs = require("node:fs");

const URL_BRIDGE = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
// 生成物统一落在 act2/tools/out/（.gitignore 里的 **/out/），不进仓库改动清单
const OUT_DIR = path.join(__dirname, "..", "..", "tools", "out");
const OUTPUT = path.join(OUT_DIR, "handoff-preview.png");
const PAPERS_SHOT = path.join(OUT_DIR, "bridge-papers.png");
const PAPERS_KEY = "our-story-bridge-papers-v1";
const EVAL_KEY = "our-story-act2-board-eval-v1";

const failures = [];
const fail = (m) => failures.push(m);

async function dismissLines(page) {
  // 对白打字机：E 先补完当前行，再 E 换下一行
  for (let i = 0; i < 12; i++) {
    const hidden = await page.evaluate(() => window.__broadcastBridge.dialogHidden);
    if (hidden) return;
    await page.keyboard.press("KeyE");
    await page.waitForTimeout(90);
  }
}

/** 一行一行读完当前对白，返回完整的行文本（等打字机走完再读，避免只读到半句）。 */
async function collectLines(page) {
  const out = [];
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(1300);
    const info = await page.evaluate(() => ({
      hidden: document.getElementById("dialog").hidden,
      line: document.getElementById("line").textContent
    }));
    if (info.hidden) break;
    if (info.line && out[out.length - 1] !== info.line) out.push(info.line);
    await page.keyboard.press("KeyE");
    await page.waitForTimeout(160);
  }
  return out;
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    // ---------------------------------------------------------------- 页面一：全流程
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(URL_BRIDGE);
    await page.waitForFunction(() => window.__broadcastBridge?.scene !== "loading");

    // ---- 既有断言：递稿姿态 → girlSit（这一段和改动前一致）
    await page.evaluate(() => {
      window.__broadcastBridge.enter("ready");
      window.__broadcastBridge.enter("girlHandoff");
    });
    await page.waitForTimeout(250);
    if ((await page.evaluate(() => window.__broadcastBridge.scene)) !== "girlHandoff") {
      fail("稿纸交接姿态未显示");
    }
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    await page.screenshot({ path: OUTPUT });
    await page.waitForFunction(() => window.__broadcastBridge.scene === "girlSit", null, { timeout: 6000 });

    // ---- §1.5 回响：写一份第二幕结算存档，刷新后开场对白要引用主题 + 一句评价
    const evalPayload = {
      theme: "reading",
      themeName: "读书周",
      evalIds: ["color-many", "fill-low"],
      evals: [
        { id: "color-many", text: "用了三种粉笔色，比我一个人画的时候热闹。" },
        { id: "fill-low", text: "中间留白不少，反而透气。" }
      ]
    };
    await page.evaluate((d) => localStorage.setItem("our-story-act2-board-eval-v1", JSON.stringify(d)), evalPayload);
    await page.reload();
    await page.waitForFunction(() => window.__broadcastBridge?.scene !== "loading");
    await page.evaluate(() => window.__broadcastBridge.enter("board"));
    const echoLines = await collectLines(page);
    const echo = echoLines.join(" / ");
    if (!echo.includes("读书周")) fail(`广播桥开场没有引用第二幕主题：${echo}`);
    // 引用句会包在「」里再接「来着。」——句末标点先去掉，免得出现「……。」来着。
    const quoted = evalPayload.evals[0].text.replace(/[。！？!?]$/, "");
    if (!echo.includes(quoted)) fail(`广播桥开场没有引用第二幕的结算评价句：${echo}`);

    // ---- §1.6 风吹稿纸：进入走廊分镜，走到中段触发
    await page.evaluate(() => window.__broadcastBridge.enter("corridor"));
    await page.waitForTimeout(120);
    await dismissLines(page);
    const corridorStart = await page.evaluate(() => ({
      scene: window.__broadcastBridge.scene,
      boyX: window.__broadcastBridge.boyX,
      spawned: window.__broadcastBridge.papersSpawned,
      stored: window.__broadcastBridge.papersStored
    }));
    if (corridorStart.scene !== "corridor") fail(`进走廊之后 scene=${corridorStart.scene}`);
    // 缺省语义 = 3（全接住）：还没玩的时候读不到键，getter 要回 3
    if (corridorStart.stored !== 3) fail(`稿纸键缺省值应该是 3（全接住），实际 ${corridorStart.stored}`);
    if (corridorStart.spawned) fail("还没走到触发位置，稿纸就已经被吹散了");

    // 按住 D 走：触发 + 走位不被拦
    await page.keyboard.down("KeyD");
    await page.waitForFunction(() => window.__broadcastBridge.papersSpawned, null, { timeout: 8000 });
    const spawned = await page.evaluate(() => ({
      papers: window.__broadcastBridge.papers,
      boyX: window.__broadcastBridge.boyX,
      scene: window.__broadcastBridge.scene
    }));
    if (spawned.scene !== "corridor") fail("触发稿纸时走出了走廊段");
    if (spawned.papers.length !== 3) fail(`风吹稿纸应该 3 张，实际 ${spawned.papers.length} 张`);
    if (!spawned.papers.some((p) => !p.landed && !p.caught)) fail("稿纸没有在飘（都已经是落地/接住状态）");
    for (const p of spawned.papers) {
      if (!(p.targetX >= 140 && p.targetX <= 390)) fail(`稿纸落点 ${p.targetX} 不在走廊可走到的范围`);
    }
    // 不拦路：继续按 D，横向位置还在涨
    await page.waitForTimeout(420);
    const walked = await page.evaluate(() => window.__broadcastBridge.boyX);
    if (!(walked > spawned.boyX + 5)) fail(`稿纸在飘的时候走不动了（${spawned.boyX} → ${walked}）`);
    await page.keyboard.up("KeyD");

    // 接一张：走到当前纸的正下方按 E
    const first = await page.evaluate(() => {
      const p = window.__broadcastBridge.papers.find((q) => !q.caught && !q.gone);
      return p ? { x: p.x } : null;
    });
    if (!first) fail("三张稿纸还没接就都没了，测不到「接住」");
    else {
      await page.evaluate((x) => window.__broadcastBridge.setBoyX(x), first.x);
      await page.keyboard.press("KeyE");
      await page.waitForTimeout(220);
      const caught = await page.evaluate(() => ({
        caught: window.__broadcastBridge.papersCaught,
        stored: window.__broadcastBridge.papersStored
      }));
      if (caught.caught < 1) fail("站在稿纸下面按 E 没有接住");
      if (caught.stored !== caught.caught) {
        fail(`接住数没有立刻写进 ${PAPERS_KEY}（${caught.caught} / ${caught.stored}）`);
      }
    }

    // 等三张都落定（接住或落地消失），存档值应该等于最终接住数
    await page.waitForFunction(
      () => window.__broadcastBridge.papers.every((p) => p.caught || p.gone),
      null,
      { timeout: 10000 }
    );
    const resolved = await page.evaluate(() => ({
      caught: window.__broadcastBridge.papersCaught,
      stored: window.__broadcastBridge.papersStored,
      raw: localStorage.getItem("our-story-bridge-papers-v1")
    }));
    if (!/^[0-3]$/.test(resolved.raw || "")) fail(`papers 键应该是 0–3 的整数，实际 ${resolved.raw}`);
    if (resolved.stored !== resolved.caught) {
      fail(`最终接住数 ${resolved.caught} 和存档 ${resolved.stored} 不一致`);
    }
    // 接完继续走：小游戏不拦路，能到门口
    await page.keyboard.down("KeyD");
    await page.waitForFunction(() => window.__broadcastBridge.boyX >= 387, null, { timeout: 10000 });
    await page.keyboard.up("KeyD");
    if ((await page.evaluate(() => window.__broadcastBridge.scene)) !== "corridor") {
      fail("走到广播室门口时场景已经不是走廊");
    }
    await page.screenshot({ path: PAPERS_SHOT });

    // ---------------------------------------------------------------- 页面二：落点确定性
    const page2 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page2.goto(URL_BRIDGE);
    await page2.waitForFunction(() => window.__broadcastBridge?.scene !== "loading");
    const stored2 = await page2.evaluate(() => window.__broadcastBridge.papersStored);
    if (stored2 !== 3) fail(`新页面（无稿纸存档）缺省值应该是 3，实际 ${stored2}`);
    await page2.evaluate(() => window.__broadcastBridge.enter("corridor"));
    await page2.waitForTimeout(120);
    await dismissLines(page2);
    await page2.evaluate(() => window.__broadcastBridge.setBoyX(200));
    await page2.waitForFunction(() => window.__broadcastBridge.papersSpawned, null, { timeout: 6000 });
    const targets2 = await page2.evaluate(() => window.__broadcastBridge.papers.map((p) => p.targetX));
    const targets1 = spawned.papers.map((p) => p.targetX);
    if (JSON.stringify(targets1.map((v) => v.toFixed(2))) !== JSON.stringify(targets2.map((v) => v.toFixed(2)))) {
      fail(`同一份种子下稿纸落点不一致（${targets1} vs ${targets2}）`);
    }
    // 旧档没有第二幕结算键时，开场对白不能凭空多出一句
    await page2.evaluate(() => {
      localStorage.removeItem("our-story-act2-board-eval-v1");
      window.__broadcastBridge.enter("board");
    });
    const noEvalLines = await collectLines(page2);
    if (noEvalLines.some((l) => l.includes("那块板"))) {
      fail(`没有第二幕结算存档时开场多出了回响台词：${noEvalLines.join(" / ")}`);
    }

    if (errors.length) fail(...errors.slice(0, 4));
    if (failures.length) throw new Error(failures.join("\n"));
    console.log(JSON.stringify({
      ok: true,
      screenshot: OUTPUT,
      papers: { caught: resolved.caught, stored: resolved.stored, targets: targets1.map((v) => +v.toFixed(1)) },
      echo: echo.slice(0, 48)
    }));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

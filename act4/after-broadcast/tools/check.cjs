const { chromium } = require("../../../game/dust-corridor/node_modules/playwright-core");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const url = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
  const shot = (name) => page.screenshot({ path: path.join(__dirname, "..", "previews", name + ".png") });
  const at = (state) => page.waitForFunction((s) => window.__afterBroadcast?.scene === s, state, { timeout: 60000 });
  const advance = async (times) => {
    for (let i = 0; i < times; i++) {
      const before = await page.evaluate(() => ({ scene: window.__afterBroadcast.scene, index: window.__afterBroadcast.dialogIndex }));
      for (let attempt = 0; attempt < 3; attempt++) {
        await page.keyboard.press("KeyE");
        await page.waitForTimeout(60);
        const after = await page.evaluate(() => ({ scene: window.__afterBroadcast.scene, index: window.__afterBroadcast.dialogIndex }));
        if (after.scene !== before.scene || after.index > before.index) break;
      }
    }
  };
  try {
    await page.goto(url);
    await at("exit");
    await shot("01-door-exit");
    await at("firstWords");
    await advance(6);
    await at("doorWalk");
    await page.waitForFunction(() => !document.getElementById("narration").hidden);
    const doorNarration = await page.locator("#hint").textContent();
    if (!doorNarration.includes("脚步声")) throw new Error("走廊提示没有改成旁白");
    await page.locator("#auto").click();
    await page.waitForFunction(() => window.__afterBroadcast.boyX < 142);
    await page.locator("#auto").click();
    await page.locator("#inspect").click();
    await advance(3);
    await page.locator("#auto").click();
    await at("railingWalk");
    await page.waitForTimeout(600);
    await shot("02-railing-walk");
    const gap = await page.evaluate(() => window.__afterBroadcast.girlX - window.__afterBroadcast.boyX);
    if (gap > 43) throw new Error(`两人走路距离过大：${gap.toFixed(1)}`);
    await at("railPause");
    await shot("02b-railing-talk");
    await page.locator("#inspect").click();
    await at("railTalk");
    await page.waitForFunction(() => document.getElementById("narration").hidden);
    if (!(await page.locator("#narration").evaluate((el) => el.hidden))) throw new Error("人物对白时仍叠着旁白");
    await advance(6);
    await at("railingWalk");
    await page.locator("#auto").click();
    await at("paperWalk");
    await page.waitForTimeout(1100);
    await shot("02c-paper-falling");
    await at("paperAlert");
    await advance(2);
    await at("paperChase");
    await page.waitForFunction(() => window.__afterBroadcast.boyX <= 175);
    await shot("03-paper");
    await page.locator("#inspect").click();
    await at("paperPick");
    await shot("03b-paper-pickup");
    await at("paperFound");
    await advance(6);
    await at("lullWalk");
    await page.locator("#auto").click();
    await at("snackTurn");
    await page.waitForTimeout(850);
    await shot("04a-snack-turn");
    if (!(await page.locator("#cg").evaluate((el) => el.hidden))) throw new Error("和臣转身前就切入递零食 CG");
    const turnGap = await page.evaluate(() => window.__afterBroadcast.girlX - window.__afterBroadcast.boyX);
    if (turnGap < 55) throw new Error(`转身时两人小人重叠：${turnGap.toFixed(1)}`);
    await at("snack");
    await shot("04-snack-offer");
    await advance(5);
    await page.waitForTimeout(850);
    if (await page.evaluate(() => window.__afterBroadcast.scene) !== "snack") throw new Error("停下时递零食画面没有等玩家");
    await page.locator("#auto").click();
    await at("afterSnack");
    await at("stairWalk");
    await page.waitForTimeout(600);
    await shot("05-stairwell");
    await at("stairPause");
    await page.locator("#inspect").click();
    await at("stairWords");
    await advance(8);
    await at("final");
    await shot("06-final-railing");
    await at("memory");
    await advance(1);
    await page.keyboard.press("KeyE");
    await page.waitForTimeout(400);
    if (await page.locator("#memoryMontage").evaluate((el) => el.hidden)) throw new Error("回忆拼贴没有出现");
    if (!(await page.locator(".shard-door").evaluate((el) => el.classList.contains("is-shown")))) throw new Error("门口回忆碎片没有进入");
    await shot("06b-memory-doorway");
    await advance(4);
    await page.keyboard.press("KeyE");
    if (!(await page.locator("#memoryPortrait").evaluate((el) => el.classList.contains("is-shown")))) throw new Error("朱里特写没有出现");
    await page.waitForTimeout(1100);
    await shot("06c-memory-collage");
    await advance(1);
    await page.keyboard.press("KeyE");
    await shot("06d-memory-confession");
    if (!(await page.locator("#line").textContent()).includes("喜欢上了朱里")) throw new Error("和臣的心声没有说出感情变化");
    await advance(1);
    await at("blush");
    await advance(1);
    await page.keyboard.press("KeyE");
    await page.waitForTimeout(450);
    await shot("06e-kazuomi-blush");
    if (await page.locator("#blushCut").evaluate((el) => el.hidden)) throw new Error("脸红特写没有出现");
    await advance(3);
    await at("hurryAway");
    await shot("06f-hurry-away");
    await at("girlAlone");
    await shot("06g-zhuli-alone");
    if (await page.evaluate(() => window.__afterBroadcast.boyX >= 0)) throw new Error("和臣没有离开画面");
    await advance(1);
    await at("ending");
    await shot("07-ending");
    const dialogSize = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById("line")).fontSize));
    if (dialogSize < 28) throw new Error(`对白字号仍偏小：${dialogSize}px`);
    const captionSize = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById("captionLine")).fontSize));
    if (captionSize < 28) throw new Error(`行走字幕字号仍偏小：${captionSize}px`);
    const narrationSize = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById("hint")).fontSize));
    if (narrationSize < 28) throw new Error(`旁白字号仍偏小：${narrationSize}px`);
    // ---- 前两幕的回响：第二幕主题/评价 + 第三幕三档开场变体（只读存档）
    const withSaves = async (seed) => {
      const ctx = await browser.newContext();
      const p = await ctx.newPage({ viewport: { width: 1280, height: 720 } });
      await p.goto(url);
      await p.evaluate(seed);
      await p.reload();
      await p.waitForFunction(() => window.__afterBroadcast?.scene === "exit", null, { timeout: 60000 });
      const got = await p.evaluate(() => ({
        variant: window.__afterBroadcast.act3Variant,
        memory: window.__afterBroadcast.boardMemoryText,
        first: window.__afterBroadcast.firstWordsLines
      }));
      await ctx.close();
      return got;
    };

    const sync = await withSaves(() => {
      localStorage.clear();
      localStorage.setItem("our-story-act2-board-eval-v1", JSON.stringify({
        theme: "sports", themeName: "运动会", evalIds: ["e1"],
        evals: [{ id: "e1", text: "左边留白多，反而透气" }]
      }));
      localStorage.setItem("act3-result-v1", JSON.stringify({
        difficulty: "演播", relaysCaught: 4, relaysTotal: 4, rescues: 0, maxNoise: 30, syncBoth: true
      }));
    });
    if (sync.variant !== "sync") throw new Error(`接力全接住时 act3 回响档位是 ${sync.variant}`);
    if (!sync.first[3][1].includes("一次也没让我替你")) throw new Error("接力全接住时开场台词没有换成对应变体");
    if (!sync.memory.includes("运动会") || !sync.memory.includes("左边留白多")) {
      throw new Error("boardMemory 没有引用第二幕的主题与评价句");
    }

    const rescued = await withSaves(() => {
      localStorage.clear();
      localStorage.setItem("act3-result-v1", JSON.stringify({
        difficulty: "电台", relaysCaught: 1, relaysTotal: 4, rescues: 3, maxNoise: 85, syncBoth: false
      }));
    });
    if (rescued.variant !== "rescued") throw new Error(`被补位时 act3 回响档位是 ${rescued.variant}`);
    if (!rescued.first[1][1].includes("替你补上")) throw new Error("被补位时开场台词没有换成对应变体");
    if (!rescued.memory.includes("黑板报")) throw new Error("没有第二幕存档时 boardMemory 没有回退旧台词");

    const fallback = await withSaves(() => { localStorage.clear(); });
    if (fallback.variant !== "normal") throw new Error(`没有存档时 act3 回响档位是 ${fallback.variant}`);
    if (fallback.memory !== "画黑板报的时候，她把粉笔递给我，自己留下来补那些细细的边。") {
      throw new Error("没有存档时 boardMemory 没有回退旧台词");
    }

    if (errors.length) throw new Error(errors.join("\n"));
    console.log(JSON.stringify({ ok: true, scene: await page.evaluate(() => window.__afterBroadcast.scene), errors }));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

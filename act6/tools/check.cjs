/**
 * 第四幕 · 日常小游戏与主线玩法的自检。
 *
 * 从 act6/index.html?daily=1 进目录，一场一场跑：传话、人流、照片、值日表、
 * 传纸条、雨伞、课堂笔记、毽子；再验异常兜底与 Esc 取消，最后回剧情页验：
 * 自由走动 → 按 E 开场、事件 02 的课间时机 → 人流、事件 03 的打听、
 * 事件 04 的公告栏（四材料四槽 / 放错建议 / 8 秒只帮一次 / 板边错带笑话）、
 * 事件 05 的信息卡、事件 07 的纸飞机（三折法 / 角度力度 / 三人回合 / 照片里的飞机）、
 * 事件 09 的记忆滑块、一周目只留三场日常、通关后的「日常」入口。
 * 只验「能不能走完、存档写没写对、按键有没有反应」，好看不好看去看 shots/。
 *
 * 跑法（仓库根目录）：
 *   node act6/tools/check.cjs
 */
const { chromium } = require("../../game/dust-corridor/node_modules/playwright-core");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..", "..");
const DAILY = pathToFileURL(path.join(ROOT, "act6", "index.html")).href + "?daily=1";
const STORY = pathToFileURL(path.join(ROOT, "act6", "index.html")).href;
const SHOTS = path.join(__dirname, "shots");

const failures = [];

function fail(msg) { failures.push(msg); console.log("  FAIL " + msg); }
function ok(msg) { console.log("  ok " + msg); }

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  // 这一套要跑十几分钟、反复 file:// 跳转：给导航多留一点时间，
  // 渲染进程真的卡死时依然会超时报错，不会把问题藏起来。
  page.setDefaultNavigationTimeout(60000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("crash", () => errors.push("渲染进程崩溃"));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  // ---------------------------------------------------------------- 工具

  const shot = (name) => page.screenshot({ path: path.join(SHOTS, name + ".png") });

  /**
   * 校园页是自由走动：不用菜单，走到当前事件所在的区域和地点，再按 E 开场。
   * 这里走真实方向键，不直接改坐标。__act6.campus 只用来读位置。
   */
  const campus = () => page.evaluate(() => window.__act6.campus);

  const walkToEvent = async () => {
    for (let i = 0; i < 70; i++) {
      const c = await campus();
      if (!c || !c.open) return c;
      if (c.area === c.target && c.nearby) return c;
      let key;
      if (c.target >= 0 && c.area < c.target) key = "ArrowRight";
      else if (c.target >= 0 && c.area > c.target) key = "ArrowLeft";
      else key = c.x < 55 ? "ArrowRight" : "ArrowLeft";
      await page.keyboard.down(key);
      await page.waitForTimeout(280);
      await page.keyboard.up(key);
      await page.waitForTimeout(110);
    }
    fail("走不到当前事件的地点：" + JSON.stringify(await campus()));
    return await campus();
  };

  /** 走到地点并按 E 开场。 */
  const openEvent = async () => {
    await walkToEvent();
    await page.keyboard.press("e");
    await page.waitForTimeout(450);
  };

  /** 选项面板开着就按数字键选一个，直到面板收起。 */
  const answerChoice = async (index = 1) => {
    for (let i = 0; i < 40; i++) {
      const open = await page.evaluate(() => !document.getElementById("interaction").hidden);
      if (!open) return true;
      await page.keyboard.press(String(index));
      await page.waitForTimeout(180);
    }
    return false;
  };


  const dialogOpen = () => page.evaluate(() => !document.getElementById("dialog").hidden);

  /** 点掉所有对白。走 story.js 自己的 advance()。 */
  const advance = async (max = 80) => {
    for (let i = 0; i < max; i++) {
      if (!(await dialogOpen())) return;
      await page.evaluate(() => window.ACT6 && window.ACT6.advance());
      await page.waitForTimeout(70);
    }
    fail("对白没有走完");
  };

  const store = () => page.evaluate(() => window.ACT6Mini.store());

  const current = () => page.evaluate(() => {
    const g = window.ACT6Mini.current;
    if (!g) return null;
    const out = { id: g.id, state: g.state };
    for (const key of ["phase", "scene", "x", "y", "tier", "hop", "teacher", "caught", "combo", "rounds", "zoom", "wet", "partner", "route", "people", "window", "target", "askedFriendA", "askedFriendB"]) {
      try { out[key] = g[key]; } catch (e) { /* getter 可能不存在 */ }
    }
    return out;
  });

  const timingState = () => page.evaluate(() => window.ACT6Flow.timingState());
  const timingNote = () => page.evaluate(() => {
    const el = document.getElementById("timingNote");
    return el ? el.textContent : "";
  });
  const storyState = () => page.evaluate(() => window.__act6.state);
  const campusOpen = () => page.evaluate(() => !!window.__act6.campus.open);

  /** 事件 02 的面板：点一个时间点，再点一个行动。 */
  const pickTiming = async (slot, action) => {
    if (slot) {
      await page.click('#timingSlots [data-slot="' + slot + '"]');
      await page.waitForTimeout(160);
    }
    if (action) {
      await page.click('#timingActions [data-act="' + action + '"]');
      await page.waitForTimeout(260);
    }
  };

  /** 等剧情把字段写下来。 */
  const waitStory = async (predicate, tries = 80) => {
    for (let i = 0; i < tries; i++) {
      const s = await storyState();
      if (predicate(s)) return s;
      await page.waitForTimeout(100);
    }
    return null;
  };

  /** 一边点掉对白，一边等回到校园地图。 */
  const backToCampus = async (label) => {
    for (let i = 0; i < 220; i++) {
      if (await dialogOpen()) {
        await page.evaluate(() => window.ACT6.advance());
        await page.waitForTimeout(70);
        continue;
      }
      if (await campusOpen()) return true;
      if (await page.evaluate(() => window.ACT6Mini.busy)) { await page.waitForTimeout(150); continue; }
      await page.waitForTimeout(120);
    }
    fail("没有回到校园：" + (label || ""));
    return false;
  };

  /** 在打听场景里按住一个方向走到某个条件成立。 */
  const walkUntil = async (predicate, key, tries) => {
    for (let i = 0; i < (tries || 80); i++) {
      const c = await current();
      if (!c || c.id !== "inquiry") return null;
      if (predicate(c)) return c;
      await page.keyboard.down(key || "ArrowRight");
      await page.waitForTimeout(140);
      await page.keyboard.up(key || "ArrowRight");
    }
    return await current();
  };

  const panelShown = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    return !!el && !el.hidden && el.classList.contains("show");
  }, sel);

  /** 一边点掉对白，一边等某个面板亮起来。 */
  const waitPanel = async (sel, label) => {
    for (let i = 0; i < 160; i++) {
      if (await dialogOpen()) {
        await page.evaluate(() => window.ACT6.advance());
        await page.waitForTimeout(80);
        continue;
      }
      if (await panelShown(sel)) return true;
      await page.waitForTimeout(100);
    }
    fail("等不到面板：" + (label || sel));
    return false;
  };

  /** 开始一场；不要 await 这个 promise，evaluate 会一直等到整场结束。 */
  const startGame = async (id) => {
    await page.evaluate((gid) => {
      if (window.ACT6Mini.closeHub) window.ACT6Mini.closeHub();
      window.ACT6Mini.play(gid);
    }, id);
    for (let i = 0; i < 80; i++) {
      const c = await current();
      if (c && c.id === id) { await page.waitForTimeout(500); return true; }
      await page.waitForTimeout(100);
    }
    fail("开始不了 " + id);
    return false;
  };

  /** 等这一场收工：期间把对白点掉。 */
  const finishGame = async (label) => {
    for (let i = 0; i < 260; i++) {
      if (await dialogOpen()) {
        await page.evaluate(() => window.ACT6.advance());
        await page.waitForTimeout(70);
        continue;
      }
      const busy = await page.evaluate(() => window.ACT6Mini.busy);
      if (!busy) { await page.waitForTimeout(400); return true; }
      await page.waitForTimeout(120);
    }
    fail("收不了场：" + (label || ""));
    const dump = await page.evaluate(() => {
      const g = window.ACT6Mini.current;
      return { busy: window.ACT6Mini.busy, id: g && g.id, state: g && g.state, dialog: !document.getElementById("dialog").hidden };
    });
    console.log("    现场 " + JSON.stringify(dump));
    return false;
  };

  // ---------------------------------------------------------------- 主线两场（05 分类 / 09 滑块）

  /** 直接把剧情存档种到某个事件（可带字段 / 日常存档），只验那一场。 */
  const startEventAt = async (index, patch, dailyStore) => {
    await page.goto(STORY + "?t=" + Date.now());
    await page.waitForFunction(() => !!window.__act6, null, { timeout: 15000 });
    await page.evaluate(({ i, p, d }) => {
      localStorage.clear();
      localStorage.setItem("our-story-act6-v1", JSON.stringify(Object.assign({ event: i }, p || {})));
      if (d) localStorage.setItem("our-story-act6-daily-v1", JSON.stringify(d));
    }, { i: index, p: patch || null, d: dailyStore || null });
    await page.reload();
    await page.waitForFunction(() => !!window.__act6, null, { timeout: 15000 });
    await page.waitForTimeout(900);
  };

  /** 等到某个小游戏真的跑起来。 */
  const waitMini = async (id, tries = 140) => {
    for (let i = 0; i < tries; i++) {
      if (await dialogOpen()) { await page.evaluate(() => window.ACT6.advance()); await page.waitForTimeout(60); continue; }
      const c = await current();
      if (c && c.id === id) return true;
      await page.waitForTimeout(120);
    }
    return false;
  };

  /** 进一场日常就按 Esc 取消，再选「先跳过」——只为了快速走到后面的对白。 */
  const skipMini = async (id) => {
    if (!(await waitMini(id))) { fail("没等到小游戏 " + id); return false; }
    await advance();
    await page.keyboard.press("Escape");
    let panel = false;
    for (let i = 0; i < 60; i++) {
      const text = await page.evaluate(() => {
        const box = document.getElementById("interaction");
        return box && !box.hidden ? box.textContent : "";
      });
      if (text.indexOf("先跳过") >= 0) { panel = true; break; }
      await page.waitForTimeout(100);
    }
    if (!panel) { fail(id + " 取消后没有出现「重试 / 先跳过」"); return false; }
    await answerChoice(2);
    await page.waitForTimeout(350);
    return true;
  };

  /** 一边推进对白，一边等某一句出现；找到就停在那一句上。 */
  const waitLine = async (re, tries = 220) => {
    for (let i = 0; i < tries; i++) {
      if (await dialogOpen()) {
        const text = await page.evaluate(() => document.getElementById("line").textContent);
        if (re.test(text)) return text;
        await page.evaluate(() => window.ACT6.advance());
        await page.waitForTimeout(70);
        continue;
      }
      await page.waitForTimeout(120);
    }
    return null;
  };

  /** 信息卡：键盘 / 点击 / 拖动 / 触屏四条路都要能放。 */
  const placeCard = async (id, col, how) => {
    const cardSel = '.card-chip[data-id="' + id + '"]';
    const colSel = '.cards-col[data-col="' + col + '"]';
    if (how === "key") {
      await page.evaluate((s) => document.querySelector(s).focus(), cardSel);
      await page.keyboard.press({ heard: "1", guessed: "2", unknown: "3" }[col]);
    } else if (how === "click") {
      await page.click(cardSel);
      await page.click(colSel + " .col-head");
    } else if (how === "drag") {
      const a = await page.locator(cardSel).boundingBox();
      const b = await page.locator(colSel + " .col-head").boundingBox();
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(a.x + a.width / 2 + 16, a.y + a.height / 2 + 10, { steps: 3 });
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
      await page.mouse.up();
    } else if (how === "touch") {
      // 触屏就是同一套 pointer 事件，这里用 pointerType=touch 的合成事件走一遍。
      await page.evaluate(({ c, t }) => {
        const card = document.querySelector(c);
        const col = document.querySelector(t);
        if (!card || !col) return;
        const a = card.getBoundingClientRect();
        const b = col.getBoundingClientRect();
        const at = (x, y) => ({
          bubbles: true, cancelable: true, pointerId: 9, pointerType: "touch",
          isPrimary: true, button: 0, clientX: x, clientY: y
        });
        card.dispatchEvent(new PointerEvent("pointerdown", at(a.left + a.width / 2, a.top + a.height / 2)));
        window.dispatchEvent(new PointerEvent("pointermove", at(a.left + a.width / 2 + 12, a.top + a.height / 2 + 8)));
        window.dispatchEvent(new PointerEvent("pointermove", at(b.left + b.width / 2, b.top + b.height / 2)));
        window.dispatchEvent(new PointerEvent("pointerup", at(b.left + b.width / 2, b.top + b.height / 2)));
      }, { c: cardSel, t: colSel + " .col-head" });
    }
    await page.waitForTimeout(150);
  };

  const memoryState = () => page.evaluate(() => window.ACT6Flow.memoryState());

  /** 鼠标拖动：从材料拖到槽位。 */
  const dragTo = async (fromSel, toSel) => {
    const a = await page.locator(fromSel).boundingBox();
    const b = await page.locator(toSel).boundingBox();
    if (!a || !b) { fail("拖拽找不到元素：" + fromSel + " → " + toSel); return; }
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 14, a.y + a.height / 2 + 8, { steps: 3 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(240);
  };

  /** 触屏：同一套 pointer 事件，pointerType=touch。 */
  const touchTo = async (fromSel, toSel) => {
    await page.evaluate(({ c, t }) => {
      const item = document.querySelector(c);
      const slot = document.querySelector(t);
      if (!item || !slot) return;
      const a = item.getBoundingClientRect();
      const b = slot.getBoundingClientRect();
      const at = (x, y) => ({
        bubbles: true, cancelable: true, pointerId: 11, pointerType: "touch",
        isPrimary: true, button: 0, clientX: x, clientY: y
      });
      item.dispatchEvent(new PointerEvent("pointerdown", at(a.left + a.width / 2, a.top + a.height / 2)));
      window.dispatchEvent(new PointerEvent("pointermove", at(a.left + a.width / 2 + 12, a.top + a.height / 2 + 8)));
      window.dispatchEvent(new PointerEvent("pointermove", at(b.left + b.width / 2, b.top + b.height / 2)));
      window.dispatchEvent(new PointerEvent("pointerup", at(b.left + b.width / 2, b.top + b.height / 2)));
    }, { c: fromSel, t: toSel });
    await page.waitForTimeout(260);
  };

  const waitSegment = async (n, tries = 90) => {
    for (let i = 0; i < tries; i++) {
      const st = await memoryState();
      if (st && st.segment === n) return st;
      await page.waitForTimeout(120);
    }
    return null;
  };

  /** 在滑块上按比例点一下：0 = 那时，1 = 后来。 */
  const slideTo = async (frac) => {
    const box = await page.locator("#memoryRange").boundingBox();
    if (!box) return false;
    const x = box.x + Math.max(1, Math.min(box.width - 2, box.width * frac));
    await page.mouse.click(x, box.y + box.height / 2);
    await page.waitForTimeout(340);
    return true;
  };

  const captionText = () => page.evaluate(() => document.getElementById("memoryCaption").textContent);

  try {
    // ------------------------------------------------------------ 目录
    console.log("\n[目录]");
    await page.goto(DAILY);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => !!window.ACT6Mini, null, { timeout: 15000 });
    await page.waitForTimeout(1200);

    const count = await page.locator("#mgHubList li").count();
    if (count !== 8) fail("目录里应该有 8 个日常，实际 " + count);
    else ok("目录 8 个日常");
    await shot("00-hub");

    const names = await page.locator("#mgHubList li .name").allTextContents();
    for (const want of ["一句话经过三个人", "穿过课间的人流", "留一张照片", "值日表", "传纸条", "雨里的伞", "课堂笔记", "踢毽子"]) {
      if (!names.includes(want)) fail("目录缺 " + want);
    }
    const wheres = await page.locator("#mgHubList li .where").allTextContents();
    if (wheres.filter((w) => w.indexOf("一周目") >= 0).length !== 3) {
      fail("目录里一周目的日常应该标 3 场：" + JSON.stringify(wheres));
    } else ok("目录标出一周目 3 场、其余 5 场进目录");

    // ------------------------------------------------------------ 第四幕第三批美术
    // 这一批换的是：举伞帧 + 分层伞、老师 12 帧表、操场背景。
    // file:// 下画布被本地图片污染，getImageData 会抛 SecurityError，所以这里不采像素：
    // 验素材尺寸与路径、运行时握点与绘制顺序、帧映射是否和 manifest 对得上；
    // 好看不好看去看 shots/ 里的游戏内截图。
    console.log("\n[新美术：雨伞 / 老师 / 操场]");

    const ART = {
      boyUmb: { w: 240, h: 72, file: "boy_umbrella_right_sheet.png" },
      girlUmb: { w: 240, h: 72, file: "girl_umbrella_right_sheet.png" },
      boyUmbHand: { w: 240, h: 72, file: "boy_umbrella_hand_front_sheet.png" },
      girlUmbHand: { w: 240, h: 72, file: "girl_umbrella_hand_front_sheet.png" },
      umbBack: { w: 480, h: 96, file: "prop_umbrella_held_back_sheet.png" },
      umbFront: { w: 480, h: 96, file: "prop_umbrella_held_front_sheet.png" },
      teacher: { w: 576, h: 72, file: "teacher_act6_sheet.png" },
      field: { w: 512, h: 288, file: "school_playground_512.png" },
      exterior: { w: 1672, h: 941, file: "school_exterior_pixel.png" }
    };

    const artLoaded = await page.evaluate((keys) => {
      const D = window.DAILY;
      const out = { failBox: !document.getElementById("mgAssets").hidden };
      for (const k of keys) {
        const im = D.img[k];
        out[k] = im ? { w: im.naturalWidth, h: im.naturalHeight, src: im.src } : null;
      }
      return out;
    }, Object.keys(ART));

    const missingArt = Object.keys(ART).filter((k) => !artLoaded[k]);
    if (missingArt.length) fail("新素材没加载上：" + missingArt.join("、"));
    else {
      const wrong = Object.keys(ART).filter((k) => {
        const got = artLoaded[k];
        return got.w !== ART[k].w || got.h !== ART[k].h || !got.src.endsWith(ART[k].file);
      });
      if (wrong.length) {
        fail("素材尺寸 / 路径不对：" + wrong.map((k) => k + "=" + artLoaded[k].w + "×" + artLoaded[k].h + " " + artLoaded[k].src.split("/").pop()).join("；"));
      } else ok("新素材 9 个全部加载、尺寸与路径正确（无 404）");
    }
    if (artLoaded.failBox) fail("画面上还挂着素材加载失败的提示");
    if (artLoaded.teacher && /npc_generated/.test(artLoaded.teacher.src)) fail("老师还在引用 npc_generated/teacher_sheet.png");
    else ok("老师不再引用旧占位图");
    if (artLoaded.field && artLoaded.exterior && artLoaded.field.src === artLoaded.exterior.src) {
      fail("field 和 exterior 还指向同一张图");
    } else ok("field 指向操场、exterior 仍是教学楼正面");

    // manifest 是这一批美术的契约；代码里的数字必须和它对得上。
    const umbMan = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/minigame/act6/manifest.json"), "utf8"));
    const boyMan = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/characters/boy/v2/umbrella/manifest.json"), "utf8"));
    const teacherMan = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/characters/act6/teacher/manifest.json"), "utf8"));

    if (umbMan.frameWidth !== 96 || umbMan.frames !== 5) fail("伞 manifest 不是 5 帧 ×96：" + umbMan.frameWidth + "×" + umbMan.frames);
    else if (!umbMan.grip.every((g) => g[0] === 48 && g[1] === 68)) fail("伞 manifest 的握点不是每帧 (48,68)：" + JSON.stringify(umbMan.grip));
    else ok("伞 manifest：5 帧 ×96，握点每帧 (48,68)");

    const runtimeTeacher = await page.evaluate(() => window.DAILY.FRAMES.teacher);
    const wantTeacher = {
      idleDown: teacherMan.animations.idleDown,
      poseDown: teacherMan.animations.poseDown,
      poseScan: teacherMan.animations.poseScan,
      poseTurn: teacherMan.animations.poseTurn,
      walkLeft: teacherMan.animations.walkLeft,
      walkRight: teacherMan.animations.walkRight
    };
    const badFrames = Object.keys(wantTeacher).filter(
      (k) => JSON.stringify(runtimeTeacher[k]) !== JSON.stringify(wantTeacher[k]));
    if (badFrames.length) {
      fail("老师的帧映射和 manifest 不一致：" + badFrames.map((k) => k + "=" + JSON.stringify(runtimeTeacher[k])).join("；"));
    } else if (runtimeTeacher.walkLeft[0] === 0) {
      fail("老师走路还在用「三个姿势 + 第 4 帧」的旧映射");
    } else ok("老师 12 帧：站立 0 / 低头 1 / 扫视 2 / 转身 3 / 左走 4–7 / 右走 8–11");

    const umbSrc = fs.readFileSync(path.join(ROOT, "act6/games/umbrella.js"), "utf8");
    if (/ctx\.rotate/.test(umbSrc)) fail("umbrella.js 还在旋转伞（倾斜应该直接切帧）");
    else if (/#b4514c/.test(umbSrc)) fail("umbrella.js 还在用代码画伞面的颜色");
    else if (/prop_umbrella_held\.json/.test(umbSrc)) fail("umbrella.js 还在读旧的 prop_umbrella_held.json");
    else ok("伞：不 code-draw、不 rotate、不读旧 json");

    const crowdSrc = fs.readFileSync(path.join(ROOT, "act6/games/crowdrun.js"), "utf8");
    const passSrc = fs.readFileSync(path.join(ROOT, "act6/games/passnote.js"), "utf8");
    if (/m\.papers/.test(crowdSrc)) fail("crowdrun.js 还在代码画老师怀里的作业（新帧里已经画了）");
    else if (/#efe2cd/.test(passSrc)) fail("passnote.js 还在代码画讲台上的作业本（新帧里已经画了）");
    else ok("老师怀里的作业 / 讲台上的本子都交给帧，代码没再补画");

    const planeSrc = fs.readFileSync(path.join(ROOT, "act6/games/paperplane.js"), "utf8");
    const shuttleSrc = fs.readFileSync(path.join(ROOT, "act6/games/shuttlecock.js"), "utf8");
    const photoSrc = fs.readFileSync(path.join(ROOT, "act6/games/photo.js"), "utf8");
    const storyText = fs.readFileSync(path.join(ROOT, "act6/story.js"), "utf8");
    if (!/D\.img\.field/.test(planeSrc)) fail("paperplane.js 没有用操场背景");
    else if (!/D\.img\.field \|\| D\.img\.exterior/.test(shuttleSrc)) fail("shuttlecock.js 没有优先用操场背景");
    else if (photoSrc.indexOf("school_playground_512.png") < 0) fail("photo.js 的取景框背景不是操场");
    else if (!/周四 · 最后一节课前 · 操场/.test(storyText)) fail("story.js 纸飞机的场景名没改成「操场」");
    else ok("操场接进拍照 / 毽子 / 纸飞机，story.js 改成「操场」");

    // ------------------------------------------------------------ D01 传话
    console.log("\n[D01 一句话经过三个人]");
    await startGame("relay");
    await shot("01-relay-intro");
    await waitPanel("#relay", "传话面板");
    await page.waitForTimeout(250);
    await shot("01-relay-pick");

    for (let hop = 0; hop < 3; hop++) {
      await page.click('.relay-block[data-id="time"]');
      await page.click('.relay-block[data-id="place"]');
      if (await page.evaluate(() => document.getElementById("relayConfirm").disabled)) {
        fail("选了两块，确认键还是灰的");
      }
      await page.click("#relayConfirm");
      await page.waitForTimeout(950);
      if (hop === 0) await shot("01-relay-mutated");
      await waitPanel(hop < 2 ? "#relay" : "#relayCompare", hop < 2 ? "下一棒面板" : "原句对照层");
      if (hop < 2) await page.waitForTimeout(250);
    }

    await page.waitForTimeout(250);
    await shot("01-relay-compare");
    await page.click("#relayCompare");
    await page.waitForTimeout(400);
    await finishGame("relay");

    let s = await store();
    if (!s.relayCompleted) fail("relayCompleted 没写进存档");
    else if (!Array.isArray(s.relayLost) || s.relayLost.length !== 1) fail("relayLost 应该只有 1 块：" + JSON.stringify(s.relayLost));
    else ok("relayCompleted / relayLost = " + JSON.stringify(s.relayLost));
    if (s.relayFinal && s.relayFinal.indexOf("胶带") >= 0) fail("最后传到的版本不该还带着「胶带」");

    // ------------------------------------------------------------ D02 人流
    console.log("\n[D02 穿过课间的人流]");
    await startGame("crowdrun");
    await advance();
    await shot("02-crowd-run");
    const crowdDbg = await page.evaluate(() => window.ACT6Mini.current.debug);
    if (!crowdDbg || !crowdDbg.teacher) fail("人流里没有老师");
    else if (crowdDbg.teacher.face !== "left") fail("抱作业的老师应该朝左走：" + JSON.stringify(crowdDbg.teacher));
    else ok("老师朝左走（帧 4–7），作业画在帧里");
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(1200);
    await shot("02-crowd-mid");

    let arrived = false;
    for (let i = 0; i < 130; i++) {
      const c = await current();
      if (!c || c.state !== "run") { arrived = true; break; }
      await page.waitForTimeout(400);
    }
    await page.keyboard.up("ArrowRight");
    if (!arrived) fail("五十秒还没走出走廊");
    else ok("走到了二班（" + (await current()).tier + "）");
    await page.waitForTimeout(400);
    await shot("02-crowd-arrive");
    await finishGame("crowdrun");

    s = await store();
    if (!s.crowdRunCompleted) fail("crowdRunCompleted 没写进存档");
    else if (["early", "middle", "late"].indexOf(s.crowdRunTier) < 0) fail("crowdRunTier 不对：" + s.crowdRunTier);
    else ok("crowdRunTier = " + s.crowdRunTier + " / 剩 " + s.crowdRunTimeLeft + " 秒");

    // ------------------------------------------------------------ D03 照片
    console.log("\n[D03 留一张照片]");
    await startGame("photo");
    await shot("03-photo-frame");
    await waitPanel("#photo", "取景框");
    await page.waitForTimeout(350);
    const photoBg = await page.evaluate(() => {
      const el = document.querySelector("#photoStage .photo-bg");
      return el ? el.style.backgroundImage : "";
    });
    if (photoBg.indexOf("school_playground_512.png") < 0) fail("拍照取景框的背景不是操场：" + photoBg);
    else ok("拍照取景框用操场背景");
    if (await page.evaluate(() => !!document.querySelector("#photoStage .photo-plane"))) {
      fail("没扔过纸飞机，照片里却出现了飞机");
    } else ok("目录里的照片没有多出纸飞机");

    const box = await page.locator('.photo-actor[data-who="girl"]').boundingBox();
    if (!box) fail("取景框里没有朱里");
    else {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 6 });
      await page.mouse.up();
      const x = await page.evaluate(() => parseFloat(document.querySelector('.photo-actor[data-who="girl"]').style.left));
      if (!(x > 50)) fail("拖动之后位置没变：" + x);
      else ok("拖动生效，朱里 left = " + x.toFixed(1) + "%");
    }
    await shot("03-photo-drag");

    await page.click('[data-zoom="near"]');
    await page.waitForTimeout(200);
    if ((await current()).zoom !== "near") fail("近景没切过去");
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press(" ");
      await page.waitForTimeout(350);
    }
    await page.waitForTimeout(900);
    await shot("03-photo-shots");
    await waitPanel("#photoPick", "挑照片");
    await page.waitForTimeout(300);
    await shot("03-photo-pick");
    await page.click("#photoPickList button:nth-child(2)");
    await page.click("#photoKeep");
    await finishGame("photo");

    s = await store();
    if (!s.photoCompleted) fail("photoCompleted 没写进存档");
    else if (!s.photoPicked || !s.photoPicked.event) fail("photoPicked 没有内容");
    else if (s.photoShots !== 3) fail("应该拍满 3 张，实际 " + s.photoShots);
    else ok("photoShots = 3 / picked.event = " + s.photoPicked.event);

    // ------------------------------------------------------------ D04 值日表
    console.log("\n[D04 值日表]");
    await startGame("roster");
    await waitPanel("#roster", "值日表面板");
    await page.waitForTimeout(300);
    await shot("04-roster-empty");

    // 先故意排错：把朱里排到周三
    await page.click('.roster-card[data-who="jurie"]');
    await page.click('.roster-cell[data-key="wed:board"]');
    await page.click("#rosterCheck");
    await page.waitForTimeout(500);
    if (!(await page.locator(".roster-cell.warn").count())) fail("排错了没标出冲突格");
    else ok("冲突被指出来");
    await shot("04-roster-warn");
    await page.click('.roster-cell[data-key="wed:board"]');

    const solution = {
      "tue:board": "jurie",
      "tue:floor": "classmateB",
      "wed:board": "classmateB",
      "wed:trash": "yuno",
      "thu:board": "yuno",
      "thu:floor": "jurie",
      "thu:trash": "classmateA"
    };
    const order = ["jurie", "yuno", "classmateA", "classmateB"];
    for (const key of Object.keys(solution)) {
      // 用数字键选人：再点一次同一张卡会取消选中
      await page.keyboard.press(String(order.indexOf(solution[key]) + 1));
      await page.waitForTimeout(40);
      await page.click('.roster-cell[data-key="' + key + '"]');
      await page.waitForTimeout(60);
    }
    await page.click("#rosterCheck");
    await page.waitForTimeout(500);
    await shot("04-roster-done");
    await finishGame("roster");

    s = await store();
    if (!s.rosterCompleted) fail("rosterCompleted 没写进存档");
    else if (!s.rosterSolution || Object.keys(s.rosterSolution).length < 6) fail("rosterSolution 不完整");
    else ok("rosterSolution 记了 " + Object.keys(s.rosterSolution).length + " 格");

    // ------------------------------------------------------------ D05 传纸条
    console.log("\n[D05 传纸条]");
    await startGame("passnote");
    await shot("05-passnote-intro");
    await advance();
    for (let i = 0; i < 60; i++) {
      const c = await current();
      if (c && c.state === "pass") break;
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(300);
    await shot("05-passnote-play");

    // 老师在扫视：传一次，应该被抓
    await page.evaluate(() => window.ACT6Mini.current && window.ACT6Mini.current.force && window.ACT6Mini.current.force("scan"));
    await page.waitForTimeout(120);
    const poseScan = await page.evaluate(() => window.ACT6Mini.current.pose);
    if (poseScan !== "poseScan") fail("抬头扫视没有用 poseScan 那一帧：" + poseScan);
    else ok("抬头扫视 → poseScan（帧 2）");
    await page.keyboard.press(" ");
    await page.waitForTimeout(400);
    const caught = (await current()).caught;
    if (caught !== 1) fail("老师抬头时传出去没被抓，caught = " + caught);
    else ok("抬头时传纸条会被抓");
    await shot("05-passnote-caught");
    await advance();
    for (let i = 0; i < 60; i++) {
      const c = await current();
      if (c && c.state === "pass") break;
      await page.waitForTimeout(100);
    }

    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.ACT6Mini.current && window.ACT6Mini.current.force && window.ACT6Mini.current.force("down"));
      await page.waitForTimeout(90);
      await page.keyboard.press(" ");
      await page.waitForTimeout(330);
    }
    await page.evaluate(() => window.ACT6Mini.current.force("turn"));
    await page.waitForTimeout(150);
    const poseTurn = await page.evaluate(() => window.ACT6Mini.current.pose);
    if (poseTurn !== "poseTurn") fail("转身写黑板没有用 poseTurn 那一帧：" + poseTurn);
    else ok("三态各用一帧：poseDown / poseScan / poseTurn");
    await page.evaluate(() => window.ACT6Mini.current.force("down"));
    await page.waitForTimeout(200);
    await shot("05-passnote-done");
    await finishGame("passnote");

    s = await store();
    if (!s.passNoteCompleted) fail("passNoteCompleted 没写进存档");
    else if (!s.passNoteContent) fail("passNoteContent 没有内容");
    else ok("passNoteCaught = " + s.passNoteCaught + " / 内容 " + s.passNoteContent);

    // ------------------------------------------------------------ D06 雨伞
    console.log("\n[D06 雨里的伞]");
    await startGame("umbrella");
    await shot("06-umbrella-intro");
    await waitPanel("#choice", "共伞选择");
    await shot("06-umbrella-choose");
    await page.click("#choiceBtns button:nth-child(1)");
    await page.waitForTimeout(400);
    await waitPanel("#choice", "路线选择");
    await page.click("#choiceBtns button:nth-child(2)");
    await page.waitForTimeout(300);
    await advance();
    for (let i = 0; i < 60; i++) {
      const c = await current();
      if (c && c.state === "walk") break;
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(600);
    await shot("06-umbrella-walk");

    // 握点 / 层顺序 / 间距：伞柄反算回画布应该落回拳心
    const umbDbg = await page.evaluate(() => window.ACT6Mini.current.debug);
    if (!umbDbg) fail("雨伞没有 debug 信息，查不了握点");
    else {
      if (umbDbg.order.join(">") !== umbDbg.layerOrder.join(">")) {
        fail("伞的绘制顺序不对：" + umbDbg.order.join(">") + "（manifest 是 " + umbDbg.layerOrder.join(">") + "）");
      } else ok("绘制顺序：" + umbDbg.order.join(" → "));

      if (umbDbg.holderKey !== "boyUmb") fail("两人共伞时撑伞的不是和臣：" + umbDbg.holderKey);
      else if (!(umbDbg.partnerX > umbDbg.holderX)) fail("撑伞的人应该在同伴左边：" + JSON.stringify(umbDbg));
      else if (umbDbg.spacing < 40 || umbDbg.spacing > 46) fail("两人的间距应在 40–46，实际 " + umbDbg.spacing);
      else ok("两人：和臣举伞在左（x=" + umbDbg.holderX + "），同伴 x=" + umbDbg.partnerX + "，间距 " + umbDbg.spacing);

      const umbX = umbDbg.umbrella[0] + umbDbg.grip[0] * umbDbg.umbrella[2] / 96;
      const umbY = umbDbg.umbrella[1] + umbDbg.grip[1] * umbDbg.umbrella[2] / 96;
      const off = Math.hypot(umbX - umbDbg.hand[0], umbY - umbDbg.hand[1]);
      if (off > 0.6) fail("伞柄没对准拳头，偏了 " + off.toFixed(2) + "px");
      else ok("伞柄落在拳心（偏 " + off.toFixed(2) + "px）");

      if (JSON.stringify(umbDbg.holderGrip) !== JSON.stringify(boyMan.grip[umbDbg.holderFrame])) {
        fail("第 " + umbDbg.holderFrame + " 帧的握点和 manifest 不一致：" + JSON.stringify(umbDbg.holderGrip));
      } else ok("逐帧握点来自 manifest（帧 " + umbDbg.holderFrame + " → " + JSON.stringify(umbDbg.holderGrip) + "）");

      if (!(umbDbg.tiltFrame >= 0 && umbDbg.tiltFrame <= 4)) fail("倾斜帧越界：" + umbDbg.tiltFrame);
      else ok("风向切到倾斜帧 " + umbDbg.tiltFrame + "/4");
    }

    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(2600);
    await page.keyboard.up("ArrowRight");
    const wet = (await current()).wet;
    if (!(wet > 0.01)) fail("伞歪着走，wet 还是 0");
    else ok("伞歪着走，湿了 " + wet.toFixed(2));
    await shot("06-umbrella-wet");

    await page.evaluate(() => window.ACT6Mini.current.finishWalk());
    await page.waitForTimeout(500);
    await finishGame("umbrella");

    s = await store();
    if (!s.umbrellaCompleted) fail("umbrellaCompleted 没写进存档");
    else if (s.umbrellaPartner !== "jurie") fail("共伞对象应该是朱里，实际 " + s.umbrellaPartner);
    else if (s.umbrellaRoute !== "far") fail("路线应该是远路，实际 " + s.umbrellaRoute);
    else ok("伞：朱里 / 远路 / 湿 " + s.umbrellaWet);

    // 三人共伞：朱里撑伞、由乃在伞下、和臣在伞外（站位按 manifest 的三人布局）
    await startGame("umbrella");
    await advance();
    await waitPanel("#choice", "共伞选择（三人）");
    await page.click("#choiceBtns button:nth-child(3)");
    await page.waitForTimeout(400);
    await advance();
    await waitPanel("#choice", "路线选择（三人）");
    await page.click("#choiceBtns button:nth-child(2)");
    await page.waitForTimeout(300);
    for (let i = 0; i < 160; i++) {
      if (await dialogOpen()) {
        await page.evaluate(() => window.ACT6.advance());
        await page.waitForTimeout(70);
        continue;
      }
      const c = await current();
      if (c && c.state === "walk") break;
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(700);
    await shot("06-umbrella-three");
    const threeDbg = await page.evaluate(() => window.ACT6Mini.current.debug);
    if (!threeDbg) fail("三人共伞没有 debug 信息");
    else {
      const boySpot = threeDbg.spots.filter((p) => p.key === "boy")[0];
      const canopyRight = threeDbg.umbrella[0] + threeDbg.umbrella[2];
      if (threeDbg.people !== 3) fail("三人模式应该有三个人：" + threeDbg.people);
      else if (threeDbg.holderKey !== "girlUmb") fail("三人时应该由朱里撑伞：" + threeDbg.holderKey);
      else if (threeDbg.spacing < 40 || threeDbg.spacing > 46) fail("朱里和由乃的间距应在 40–46：" + threeDbg.spacing);
      else if (!boySpot) fail("三人模式里找不到和臣");
      else if (!(boySpot.x > canopyRight)) fail("和臣应该站在伞面外：" + boySpot.x + " vs 伞沿 " + canopyRight.toFixed(1));
      else ok("三人：朱里举伞在左、由乃在伞下、和臣在伞外（x=" + boySpot.x + "）");
      if (threeDbg.order.join(">") !== threeDbg.layerOrder.join(">")) {
        // 三条人时 "companion" 会出现两次，先合并相邻同名再比
        const seq = threeDbg.order.filter((v, i) => i === 0 || v !== threeDbg.order[i - 1]);
        if (seq.join(">") !== threeDbg.layerOrder.join(">")) fail("三人共伞的绘制顺序不对：" + threeDbg.order.join(">"));
        else ok("三个人时顺序仍是：" + threeDbg.order.join(" → "));
      } else ok("三个人时顺序仍是：" + threeDbg.order.join(" → "));
    }
    await page.evaluate(() => window.ACT6Mini.current.finishWalk());
    await page.waitForTimeout(500);
    await finishGame("umbrella");
    s = await store();
    if (s.umbrellaPartner !== "both") fail("三人共伞应该存 both，实际 " + s.umbrellaPartner);
    else ok("三人共伞存档 umbrellaPartner = both");

    // ------------------------------------------------------------ D07 课堂笔记
    console.log("\n[D07 课堂笔记]");
    await startGame("classnotes");
    await waitPanel("#notes", "笔记面板");
    await page.waitForTimeout(600);
    await shot("07-notes-listen");
    // 要点随广播逐条出现：等卡片亮出来再点，不提前泄露。
    const pickedNotes = [];
    for (let i = 0; i < 120 && pickedNotes.length < 4; i++) {
      const cards = await page.evaluate(() => [...document.querySelectorAll(".note-card")].map((b) => b.dataset.id));
      for (const id of cards) {
        if (pickedNotes.length >= 4) break;
        if (pickedNotes.indexOf(id) >= 0) continue;
        await page.click('.note-card[data-id="' + id + '"]');
        pickedNotes.push(id);
        await page.waitForTimeout(140);
      }
      await page.waitForTimeout(120);
    }
    if (pickedNotes.length !== 4) fail("广播没把四条要点放出来：" + JSON.stringify(pickedNotes));
    await page.waitForTimeout(900);
    await shot("07-notes-book");
    await finishGame("classnotes");

    s = await store();
    if (!s.classNotesCompleted) fail("classNotesCompleted 没写进存档");
    else if (!Array.isArray(s.classNotesPicked) || s.classNotesPicked.length !== 4) fail("应该记 4 条：" + JSON.stringify(s.classNotesPicked));
    else ok("记了 4 条：" + s.classNotesPicked.join(","));

    // ------------------------------------------------------------ D08 毽子
    console.log("\n[D08 踢毽子]");
    await startGame("shuttlecock");
    for (let i = 0; i < 60; i++) {
      const c = await current();
      if (c && c.state === "play") break;
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(600);
    await shot("08-shuttle-play");

    for (let i = 0; i < 40; i++) {
      await page.keyboard.press(" ");
      await page.waitForTimeout(110);
    }
    const sc = await current();
    if (!(sc.rounds > 2)) fail("四十次空格之后回合数还很少：" + JSON.stringify(sc));
    else ok("回合 " + sc.rounds + " / 连击 " + sc.combo);
    await shot("08-shuttle-combo");

    await page.click("#shuttleStop");
    await page.waitForTimeout(500);
    await finishGame("shuttlecock");

    s = await store();
    if (!s.shuttlecockCompleted) fail("shuttlecockCompleted 没写进存档");
    else ok("毽子：最好连击 " + s.shuttlecockBest + " / " + s.shuttlecockRounds + " 回合");

    // ------------------------------------------------------------ 退出与异常兜底
    console.log("\n[退出与异常兜底]");

    // 工厂抛异常：play() 要返回 {completed:false,error}，running / 画布 / 退出按钮都收干净
    const broken = await page.evaluate(async () => {
      const original = window.DAILY.games.relay;
      window.DAILY.games.relay = function () { throw new Error("自检：工厂异常"); };
      let result;
      try { result = await window.ACT6Mini.play("relay"); }
      finally { window.DAILY.games.relay = original; }
      return {
        result: result,
        busy: window.ACT6Mini.busy,
        rootOn: document.getElementById("mgRoot").classList.contains("on"),
        exitHidden: document.getElementById("mgExit").hidden
      };
    });
    if (!broken.result || broken.result.completed !== false || !broken.result.error) {
      fail("工厂异常没有返回 {completed:false,error}：" + JSON.stringify(broken.result));
    } else if (broken.busy || broken.rootOn || !broken.exitHidden) {
      fail("工厂异常后没收干净：" + JSON.stringify(broken));
    } else ok("工厂异常后 running / 画布 / 退出按钮都复位");

    // 异常之后下一局还能进；Esc 取消要返回 cancelled 并复位
    await page.evaluate(() => {
      window.__lastResult = null;
      window.ACT6Mini.play("roster").then((r) => { window.__lastResult = r; });
    });
    let rosterStarted = false;
    for (let i = 0; i < 80; i++) {
      const c = await current();
      if (c && c.id === "roster") { rosterStarted = true; break; }
      await page.waitForTimeout(100);
    }
    if (!rosterStarted) fail("工厂异常之后下一局进不去");
    else {
      await page.waitForTimeout(300);
      await advance();
      await page.keyboard.press("Escape");
      await page.waitForTimeout(800);
      const exitResult = await page.evaluate(() => window.__lastResult);
      if (!exitResult || exitResult.cancelled !== true || exitResult.completed !== false) {
        fail("Esc 退出没有返回 {completed:false,cancelled:true}：" + JSON.stringify(exitResult));
      } else if (await page.evaluate(() => window.ACT6Mini.busy)) fail("Esc 退出后 busy 还是 true");
      else if (await page.evaluate(() => !document.getElementById("mgExit").hidden)) fail("Esc 退出后「退出」按钮没收起");
      else ok("Esc 退出返回 cancelled，running / 退出按钮复位");
    }

    // 取消之后还能再开一局（同一局重进）
    await startGame("relay");
    await advance();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(700);
    await finishGame("relay");

    // ------------------------------------------------------------ 键盘 / 触屏 / 数字键
    console.log("\n[键盘 / 触屏 / 数字键]");
    await page.goto(STORY);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => !!window.__act6, null, { timeout: 15000 });
    await page.setViewportSize({ width: 700, height: 900 });
    await page.waitForTimeout(600);
    if (!(await page.evaluate(() => document.getElementById("mgEntry").hidden))) fail("通关前就出现了「日常」入口");
    else ok("通关前不显示「日常」入口");
    for (let i = 0; i < 80; i++) {
      const st = await page.evaluate(() => ({
        open: window.__act6.campus.open,
        dialog: !document.getElementById("dialog").hidden
      }));
      if (st.open) break;
      if (st.dialog) await page.evaluate(() => window.ACT6.advance());
      await page.waitForTimeout(100);
    }
    const touchUi = await page.evaluate(() => ({
      pad: !document.getElementById("campusPad").hidden,
      interact: !document.getElementById("campusInteract").hidden,
      label: document.getElementById("campusInteract").textContent
    }));
    if (!touchUi.pad) fail("窄屏没有出现虚拟方向键");
    else if (!touchUi.interact) fail("站在事件点上没有出现互动按钮");
    else ok("窄屏出现方向键与互动按钮：" + touchUi.label);
    await shot("11-touch-campus");
    await page.click("#campusInteract");
    await page.waitForTimeout(600);
    await page.setViewportSize({ width: 1280, height: 720 });

    let panelReady = false;
    for (let i = 0; i < 120; i++) {
      if (await page.evaluate(() => !document.getElementById("interaction").hidden)) { panelReady = true; break; }
      if (await dialogOpen()) {
        await page.evaluate(() => window.ACT6.advance());
        await page.waitForTimeout(70);
        continue;
      }
      await page.waitForTimeout(100);
    }
    if (!panelReady) fail("event01 没有出现选项面板");
    else {
      const numbers = await page.evaluate(() => [...document.querySelectorAll("#interaction .option")].map((b) => ({
        no: b.querySelector(".option-no") ? b.querySelector(".option-no").textContent : "",
        text: b.textContent
      })));
      if (numbers.length !== 3 || numbers.map((n) => n.no).join("") !== "123") {
        fail("选项没有 1/2/3 编号：" + JSON.stringify(numbers));
      } else ok("选项带 1/2/3 编号");

      let focused = false;
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press("Tab");
        focused = await page.evaluate(() => {
          const el = document.activeElement;
          return !!el && !!el.closest && !!el.closest("#interaction") && el.classList.contains("option");
        });
        if (focused) break;
      }
      if (!focused) fail("Tab 不能聚焦到选项按钮");
      else ok("Tab 能聚焦到选项按钮");
      await shot("12-choice-keys");

      await page.keyboard.press("2");
      await page.waitForTimeout(400);
      if (await page.evaluate(() => !document.getElementById("interaction").hidden)) fail("数字键 2 没有选中选项");
      else ok("数字键 2 选中第二项");
    }

    await advance();
    let eventAdvanced = false;
    for (let i = 0; i < 100; i++) {
      if (await page.evaluate(() => window.__act6.state.event === 1)) { eventAdvanced = true; break; }
      if (await dialogOpen()) {
        await page.evaluate(() => window.ACT6.advance());
        await page.waitForTimeout(70);
        continue;
      }
      await page.waitForTimeout(120);
    }
    if (!eventAdvanced) fail("数字键选择之后 event01 没有推进到 event 1");
    else ok("数字键选择后事件照常推进");

    // ------------------------------------------------------------ 事件 02 → 人流 → 事件 03
    console.log("\n[事件 02 课间时机 → 人流]");
    await page.goto(STORY);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => !!window.__act6, null, { timeout: 15000 });
    await page.evaluate(() => window.__act6.startAt(1));            // 从 event02 开始
    await page.waitForTimeout(1200);
    await openEvent();

    if (await waitPanel("#mgTiming", "课间时机面板")) {
      await page.waitForTimeout(250);
      const t0 = await timingState();
      if (!t0 || t0.window !== "early" || t0.actions) {
        fail("时机面板应该先选时间点、从「刚下课」开始：" + JSON.stringify(t0));
      } else ok("时机面板先选时间点，行动后出现");
      const ticks0 = await page.evaluate(() => ({
        n: document.querySelectorAll("#timingTicks i").length,
        now: document.querySelectorAll("#timingTicks i.now").length
      }));
      if (ticks0.n !== 3 || ticks0.now !== 1) fail("右上角课间刻度不是三格：" + JSON.stringify(ticks0));
      else ok("右上角三格课间刻度");
      const slots = await page.locator("#timingSlots [data-slot]").allTextContents();
      if (slots.length !== 3 || !/刚下课/.test(slots[0]) || !/快上课/.test(slots[2])) {
        fail("三个时间点不对：" + JSON.stringify(slots));
      } else ok("三个时间点：刚下课 / 课间中段 / 快上课了");
      if (!(await timingNote())) fail("时间点没有提示语");
      await shot("15-timing-slots");

      await pickTiming("middle");
      const t1 = await timingState();
      if (!t1 || !t1.actions || t1.window !== "middle") fail("点「课间中段」后没有出现四个行动：" + JSON.stringify(t1));
      else ok("选时间点后出现四个行动");
      await shot("16-timing-actions");

      await pickTiming(null, "wait");
      const t2 = await timingState();
      if (!t2 || t2.window !== "late" || t2.waits !== 1) fail("等一会儿没有把时间点往前推一格：" + JSON.stringify(t2));
      else ok("等一会儿 → 快上课了（第三次会打铃）");

      // 回到「刚下课」再现在过去：走人流，密度应该跟着时间窗走（早=6 人）
      await pickTiming("early", "now");
      if (!(await waitMini("crowdrun"))) fail("「现在过去」没有接上人流");
      else {
        const c = await current();
        if (c.people !== 6) fail("时间窗 early 的人流密度应为 6，实际 " + c.people);
        else ok("时间窗只改人流密度（early = " + c.people + " 人）");
      }

      // Esc 取消这一局 → 剧情给「重试这一段 / 先跳过」→ 点重试后仍能进同一局
      await advance();
      await page.keyboard.press("Escape");
      let retryPanel = false;
      for (let i = 0; i < 50; i++) {
        const text = await page.evaluate(() => {
          const box = document.getElementById("interaction");
          return box && !box.hidden ? box.textContent : "";
        });
        if (text.indexOf("重试这一段") >= 0 && text.indexOf("先跳过") >= 0) { retryPanel = true; break; }
        await page.waitForTimeout(120);
      }
      if (!retryPanel) fail("Esc 取消后剧情没有给「重试这一段 / 先跳过」");
      else ok("Esc 取消后剧情给重试 / 跳过");
      await shot("10-story-cancelled");
      await answerChoice(1);
      if (!(await waitMini("crowdrun"))) fail("取消后点「重试这一段」没有重新进入人流");
      else ok("取消后重试仍能进入人流");

      await page.waitForTimeout(400);
      await shot("09-story-crowdrun");

      await advance();
      await page.keyboard.down("ArrowRight");
      for (let i = 0; i < 130; i++) {
        const c = await current();
        if (!c || c.state !== "run") break;
        await page.waitForTimeout(400);
      }
      await page.keyboard.up("ArrowRight");
      await advance();
      if (!(await backToCampus("人流之后"))) fail("人流演完没有回到剧情");
      else ok("演完回到剧情");
      await shot("09-story-back");

      // 事件 03：时间窗早，走廊人多；开场白只用一句说明，不换信息。
      await openEvent();
      if (!(await waitLine(/刚下课/))) fail("事件 03 没有按时间窗换开场白（early）");
      else ok("事件 03 开场白读到了时间窗（early）");
      if (!(await waitMini("inquiry"))) fail("事件 03 没有进入打听场景");
      else {
        const c = await current();
        if (c.window !== "early" || c.people !== 5) fail("打听的走廊密度没有跟着 early 走：" + JSON.stringify(c));
        else ok("打听场景密度跟着时间窗（early = " + c.people + " 人）");

        // 键盘：走到朋友甲，问「还有别的吗」，再按 F 先回去。
        const nearA = await walkUntil((g) => g.target === "friendA", "ArrowRight", 60);
        if (!nearA || nearA.target !== "friendA") fail("走不到朋友甲身边：" + JSON.stringify(nearA));
        else ok("走到朋友甲身边出现 E");
        await page.keyboard.press("e");
        await page.waitForTimeout(400);
        await waitPanel("#choice", "朋友甲怎么开口");
        await page.keyboard.press("2");
        await page.waitForTimeout(250);
        for (let i = 0; i < 60; i++) {
          if (await dialogOpen()) {
            await page.evaluate(() => window.ACT6.advance());
            await page.waitForTimeout(70);
            continue;
          }
          const c2 = await current();
          if (c2 && c2.state === "explore") break;
          await page.waitForTimeout(100);
        }
        const sA = await storyState();
        if (sA.askedFriendA !== "partial") fail("朋友甲「还有别的吗」应写 partial，实际 " + sA.askedFriendA);
        else if (sA.bAndAClose !== "reported") fail("问到之后 bAndAClose 应为 reported，实际 " + sA.bAndAClose);
        else if (sA.bHasCrush !== null) fail("没问朋友乙却写了 bHasCrush：" + sA.bHasCrush);
        else if (sA.aAndBDating !== null) fail("打听把 reported 升成了事实");
        else if (!Array.isArray(sA.knowledgeEvents) || !sA.knowledgeEvents.some((e) => e.factId === "b_and_a_close" && e.confidence === "reported")) {
          fail("没有记下 b_and_a_close 的知识事件");
        } else ok("问甲：partial + bAndAClose = reported，bHasCrush 没写");
        await shot("17-inquiry-askA");

        // 问到之后 05 的卡片池应该多一张「听到的」
        const deckAfterA = await page.evaluate(() => {
          const s = window.__act6.state;
          return window.ACT6Flow.deckFor(s).map((c) => ({ id: c.id, truth: c.truth }));
        });
        if (deckAfterA.filter((c) => c.truth === "heard").length !== 1) fail("问甲之后卡片池不是 1 张听到的：" + JSON.stringify(deckAfterA));
        else if (deckAfterA.find((c) => c.id === "b_crush").truth !== "unknown") fail("没问到的「喜欢的人」不该出现在听到的里");
        else ok("05 卡片池跟着事件 03 的字段走");

        await page.keyboard.press("f");
        if (!(await backToCampus("打听之后"))) fail("按 F 没有结束打听");
        else {
          const sEnd = await storyState();
          if (!sEnd.inquiryCompleted) fail("inquiryCompleted 没写");
          else if (sEnd.event !== 3) fail("打听之后没有推进到事件 04，实际 event = " + sEnd.event);
          else ok("按 F 先回去，事件 03 收尾");
        }
      }
    }

    // ------------------------------------------------------------ 事件 02 打铃
    console.log("\n[事件 02 等太久打铃]");
    await startEventAt(1);
    await openEvent();
    if (await waitPanel("#mgTiming", "课间时机面板")) {
      await pickTiming("middle");
      await pickTiming(null, "wait");
      await pickTiming(null, "wait");     // 已经快上课了还等 → 铃响
      const sBell = await waitStory((s) => s.timingCompleted === true);
      if (!sBell || sBell.timingWindow !== "late" || sBell.timingChoice !== "wait" || sBell.timingDeferred !== true) {
        fail("打铃后字段不对：" + JSON.stringify(sBell && {
          window: sBell.timingWindow, choice: sBell.timingChoice, deferred: sBell.timingDeferred
        }));
      } else ok("打铃：timingWindow = late / timingDeferred = true");
      if (await page.evaluate(() => window.ACT6Mini.busy)) fail("打铃之后还开了人流");
      else ok("打铃之后没有强行开人流");
      if (!(await backToCampus("打铃之后"))) fail("打铃之后没有回到校园");
      await openEvent();
      if (await waitLine(/想好了吗/)) ok("下一次课间第一句换成「想好了吗」");
      else fail("打铃之后没有换成「想好了吗」");
      if (await waitMini("inquiry")) {
        const c = await current();
        if (c.people !== 1) fail("打铃之后打听密度应按 late 走，实际 " + c.people);
        else ok("打铃之后打听密度 late = 1 人");
      }
      await skipMini("inquiry");
      await advance();
    }

    // ------------------------------------------------------------ 事件 02 今天算了
    console.log("\n[事件 02 今天算了]");
    await startEventAt(1);
    await openEvent();
    if (await waitPanel("#mgTiming", "课间时机面板")) {
      await pickTiming("early", "giveUp");
      const sGive = await waitStory((s) => s.timingDeferred === true);
      if (!sGive || sGive.timingChoice !== "giveUp") fail("「今天算了」没有写成 giveUp：" + JSON.stringify(sGive && sGive.timingChoice));
      else ok("今天算了 → timingChoice = giveUp，委托留到下一次课间");
      if (await waitLine(/可以。那我去/)) ok("由乃说「可以。那我去。」");
      else fail("「今天算了」之后没有由乃先走的那句");
      if (!(await backToCampus("今天算了之后"))) fail("今天算了之后没有回到校园");
      await openEvent();
      if (await waitLine(/想好了吗/)) ok("今天算了之后下一次课间重开");
      else fail("今天算了之后没有重开成「想好了吗」");
      await skipMini("inquiry");
      await advance();
    }

    // ------------------------------------------------------------ 事件 02 先去找朋友
    console.log("\n[事件 02 先去找朋友]");
    await startEventAt(1);
    await openEvent();
    if (await waitPanel("#mgTiming", "课间时机面板")) {
      await pickTiming("middle", "friends");
      const sF = await waitStory((s) => s.timingCompleted === true);
      if (!sF || sF.timingChoice !== "friends" || sF.timingDeferred !== false || sF.timingWindow !== "middle") {
        fail("先去找朋友的字段不对：" + JSON.stringify(sF && {
          choice: sF.timingChoice, window: sF.timingWindow, deferred: sF.timingDeferred
        }));
      } else ok("先去找朋友 → timingChoice = friends，不打铃、不放弃");
      if (await page.evaluate(() => window.ACT6Mini.busy)) fail("先去找朋友不该先开人流");
      else ok("先去找朋友直接走朋友线，不挤走廊");
      await backToCampus("找朋友之后");
      await openEvent();
      if (await waitLine(/先回四班门口/)) ok("朋友线的开场白换成先回四班门口");
      else fail("先去找朋友之后开场白没变");
      if (await waitMini("inquiry")) {
        const c = await current();
        if (c.window !== "middle" || c.people !== 3) fail("朋友线的打听场景不对：" + JSON.stringify(c));
        else ok("朋友线还是同一个打听场景（密度 middle = 3）");
      }
      await skipMini("inquiry");
      await advance();
    }

    // ------------------------------------------------------------ 事件 03 问乙、宋遥、触屏与鼠标
    console.log("\n[事件 03 问朋友乙 / 宋遥 / 触屏 / 鼠标]");
    await startEventAt(1);
    await openEvent();
    if (await waitPanel("#mgTiming", "课间时机面板")) {
      await pickTiming("early", "giveUp");   // 只为快速走到事件 03 的下一次课间
      await waitStory((s) => s.timingDeferred === true);
      await backToCampus("问乙之前");
      await openEvent();
      await waitLine(/想好了吗/);
      if (await waitMini("inquiry")) {
        const c0 = await current();
        if (c0.people !== 5) fail("giveUp 之后打听的密度应按 early 走：" + c0.people);

        // 触屏：窄屏出现屏幕方向键，按住能走。
        await page.setViewportSize({ width: 700, height: 900 });
        await page.waitForTimeout(500);
        const padOn = await page.evaluate(() => !document.getElementById("inqPad").hidden);
        if (!padOn) fail("窄屏没有出现打听的屏幕方向键");
        else {
          const before = (await current()).x;
          const box = await page.locator('#inqPad [data-dir="ArrowRight"]').boundingBox();
          if (!box) fail("触屏方向键没有可点的位置");
          else {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            await page.waitForTimeout(900);
            await page.mouse.up();
            await page.waitForTimeout(200);
            const after = (await current()).x;
            if (!(after > before + 8)) fail("按住屏幕方向键没有走动：" + before + " → " + after);
            else ok("触屏方向键能走（" + before.toFixed(0) + " → " + after.toFixed(0) + "）");
          }
        }
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.waitForTimeout(300);

        // 走到走廊：宋遥左向路过，60px 内被老师叫走；她没有 E、不对白。
        let song = null;
        for (let i = 0; i < 140; i++) {
          song = await page.evaluate(() => window.ACT6Mini.current && window.ACT6Mini.current.songyaoState);
          if (song && song.called) break;
          await page.keyboard.down("ArrowRight");
          await page.waitForTimeout(150);
          await page.keyboard.up("ArrowRight");
        }
        if (!song || !song.called) fail("走近宋遥 60px 内没有被老师叫走：" + JSON.stringify(song));
        else ok("宋遥路过 → 60px 内被老师叫走");
        await shot("18-inquiry-songyao");
        await page.keyboard.press("e");
        await page.waitForTimeout(350);
        const stillExplore = await page.evaluate(() => {
          const g = window.ACT6Mini.current;
          return { state: g && g.state, dialog: !document.getElementById("dialog").hidden, target: g && g.target };
        });
        if (stillExplore.state !== "explore") fail("宋遥被按 E 触发了对白：" + JSON.stringify(stillExplore));
        else if (stillExplore.target === "songyao" || stillExplore.dialog) fail("宋遥不该有 E 提示或对白：" + JSON.stringify(stillExplore));
        else ok("宋遥永远没有 E 提示、不进对白");

        // 鼠标：走到朋友乙身边，直接点他说话。
        const nearB = await walkUntil((g) => g.target === "friendB", "ArrowRight", 80);
        if (!nearB || nearB.target !== "friendB") fail("走不到朋友乙身边：" + JSON.stringify(nearB));
        else {
          const rect = await page.locator("#mg").boundingBox();
          const px = rect.x + (362 / 512) * rect.width;
          const py = rect.y + (192 / 288) * rect.height;
          await page.mouse.click(px, py);
          let talked = false;
          for (let i = 0; i < 40; i++) {
            const g = await current();
            if (g && g.state === "talk") { talked = true; break; }
            await page.waitForTimeout(100);
          }
          if (!talked) fail("点朋友乙没有开始说话（鼠标）");
          else ok("鼠标点朋友乙能开始说话");
        }
        await waitPanel("#choice", "朋友乙怎么开口");
        await page.keyboard.press("1");
        await page.waitForTimeout(250);
        await waitPanel("#choice", "要不要帮带一句");
        await page.keyboard.press("2");
        await page.waitForTimeout(250);
        for (let i = 0; i < 80; i++) {
          if (await dialogOpen()) {
            await page.evaluate(() => window.ACT6.advance());
            await page.waitForTimeout(70);
            continue;
          }
          const c2 = await current();
          if (c2 && c2.state === "explore") break;
          await page.waitForTimeout(100);
        }
        const sB = await storyState();
        if (sB.askedFriendB !== "full") fail("朋友乙帮带一句应写 full，实际 " + sB.askedFriendB);
        else if (sB.bHasCrush !== "reported") fail("问到之后 bHasCrush 应为 reported，实际 " + sB.bHasCrush);
        else if (sB.bAndAClose !== null) fail("只问了「忙不忙」却写了 bAndAClose：" + sB.bAndAClose);
        else if (sB.aAndBDating !== null) fail("打听把 reported 升成了事实");
        else ok("问乙：full + bHasCrush = reported，aAndBDating 仍是 null");
        const deckAfterB = await page.evaluate(() => {
          const s = window.__act6.state;
          return window.ACT6Flow.deckFor(s).map((c) => ({ id: c.id, truth: c.truth }));
        });
        if (deckAfterB.filter((c) => c.truth === "heard").length !== 1) fail("只问到 bHasCrush 时卡片池应只有 1 张听到的：" + JSON.stringify(deckAfterB));
        else if (deckAfterB.find((c) => c.id === "b_crush").truth !== "heard") fail("bHasCrush 没有变成听到的卡");
        else ok("bHasCrush 写进来后卡片池多一张「可能有喜欢的人」");
        await shot("19-inquiry-askB");

        await page.keyboard.press("f");
        await backToCampus("问乙之后");
      }
    }

    // ------------------------------------------------------------ 事件 03 没问到
    console.log("\n[事件 03 没问到]");
    await startEventAt(2, { timingWindow: "middle", timingCompleted: true, timingChoice: "now", timingDeferred: false });
    await openEvent();
    if (await waitMini("inquiry")) {
      const c = await current();
      if (c.people !== 3) fail("时间窗 middle 的打听密度应为 3，实际 " + c.people);
      else ok("时间窗只改密度（middle = 3 人）");
      await walkUntil((g) => g.target === "friendA", "ArrowRight", 60);
      await page.keyboard.press("e");
      await page.waitForTimeout(350);
      await waitPanel("#choice", "朋友甲怎么开口");
      await page.keyboard.press("3");       // 算了，没事
      await page.waitForTimeout(250);
      for (let i = 0; i < 60; i++) {
        if (await dialogOpen()) {
          await page.evaluate(() => window.ACT6.advance());
          await page.waitForTimeout(70);
          continue;
        }
        const c2 = await current();
        if (c2 && c2.state === "explore") break;
        await page.waitForTimeout(100);
      }
      const s = await storyState();
      if (s.askedFriendA !== "none") fail("「算了，没事」应写 askedFriendA = none，实际 " + s.askedFriendA);
      else if (s.bAndAClose !== null || s.bHasCrush !== null) fail("没问到却写了事实：" + JSON.stringify({ close: s.bAndAClose, crush: s.bHasCrush }));
      else {
        const deck = await page.evaluate(() => {
          const st = window.__act6.state;
          return window.ACT6Flow.deckFor(st).map((c) => ({ id: c.id, truth: c.truth }));
        });
        if (deck.filter((c) => c.truth === "heard").length !== 0) fail("没问到时不该有「听到的」卡：" + JSON.stringify(deck));
        else ok("没问到 → askedFriendA = none，没有冒充听来的卡");
      }
      await page.keyboard.press("f");
    }

    // ------------------------------------------------------------ 事件 05 读事件 03 的结果
    console.log("\n[事件 05 读事件 03 的结果链]");
    await startEventAt(4, {
      inquiryCompleted: true, timingWindow: "middle",
      askedFriendA: null, askedFriendB: "full",
      bAndAClose: "reported", bHasCrush: "reported"
    });
    await openEvent();
    if (await waitPanel("#mgCards", "信息卡面板")) {
      await page.waitForTimeout(300);
      const deck = await page.evaluate(() => window.ACT6Flow.cardState().deck);
      const heard = deck.filter((c) => c.truth === "heard");
      if (heard.length !== 2) fail("03 问到的两条应该都在「听到的」，实际 " + heard.length + "：" + JSON.stringify(deck));
      else if (!heard.some((c) => c.id === "b_crush")) fail("bHasCrush 那张没有进「听到的」");
      else ok("05 卡片池按 03 真的问到的内容增减（听到的 2 张）");
      const note = await page.evaluate(() => {
        const el = document.querySelector('.card-chip[data-id="a_close"] .chip-note');
        return el ? el.textContent : "";
      });
      if (note.indexOf("朋友甲") >= 0) fail("没问过甲，卡片却写着「朋友甲说的」：" + note);
      else if (note.indexOf("朋友") < 0) fail("卡片没有标明是朋友说的：" + note);
      else ok("没问过甲时只写「朋友说的」，不改判定");
      await page.keyboard.press("Escape");
      for (let i = 0; i < 40; i++) {
        const text = await page.evaluate(() => {
          const box = document.getElementById("interaction");
          return box && !box.hidden ? box.textContent : "";
        });
        if (text.indexOf("重试这一段") >= 0) break;
        await page.waitForTimeout(120);
      }
      await answerChoice(2);
      await page.waitForTimeout(300);
    }

    // ------------------------------------------------------------ 事件 04 公告栏
    console.log("\n[事件 04 公告栏]");
    const bulletinState = () => page.evaluate(() => window.ACT6Flow.bulletinState());

    // 没玩过传话：板边不该有朋友甲。
    await startEventAt(3);
    await openEvent();
    if (await waitPanel("#mgBulletin", "公告栏面板")) {
      await page.waitForTimeout(350);
      const shape = await page.evaluate(() => ({
        slots: document.querySelectorAll("#mgBulletin .bulletin-slot").length,
        items: document.querySelectorAll("#mgBulletin .bulletin-item").length,
        joke: !!document.querySelector("#mgBulletin .bulletin-joke")
      }));
      if (shape.slots !== 4 || shape.items !== 4) fail("公告栏不是四槽四材料：" + JSON.stringify(shape));
      else ok("四材料四槽");
      if (shape.joke) fail("没玩过传话，板边却出现了朋友甲");
      else ok("没玩过传话 → 板边没有朋友甲");
      await shot("31-bulletin-empty");

      // 放错：材料留在托盘，只给一句建议，不弹错误框
      await page.click('.bulletin-item[data-id="time"]');
      await page.click('.bulletin-slot[data-slot="photo"]');
      await page.waitForTimeout(300);
      const wrong = await page.evaluate(() => ({
        tray: !!document.querySelector('#bulletinItems .bulletin-item[data-id="time"]'),
        say: document.getElementById("bulletinSay").textContent,
        placed: window.ACT6Flow.bulletinState().placed
      }));
      if (!wrong.tray) fail("放错之后材料没有留在托盘：" + JSON.stringify(wrong));
      else if (wrong.placed.length) fail("放错也算放上了：" + JSON.stringify(wrong));
      else if (!wrong.say) fail("放错没有给建议");
      else ok("放错只给一句建议：" + wrong.say);
      await shot("32-bulletin-wrong");

      // 鼠标拖动标题
      await dragTo('.bulletin-item[data-id="title"]', '.bulletin-slot[data-slot="title"]');
      // 键盘：聚焦材料后按数字键放照片
      await page.evaluate(() => document.querySelector('.bulletin-item[data-id="photo"]').focus());
      await page.keyboard.press("2");
      await page.waitForTimeout(220);
      // 点击：先点材料再点格子
      await page.click('.bulletin-item[data-id="time"]');
      await page.click('.bulletin-slot[data-slot="time"]');
      await page.waitForTimeout(220);
      // 触屏：pointerType=touch 把参加方式拖进去
      await touchTo('.bulletin-item[data-id="join"]', '.bulletin-slot[data-slot="join"]');

      const st4 = await bulletinState();
      if (!st4 || st4.placed.length !== 4) fail("四条操作路径没把四样放完：" + JSON.stringify(st4));
      else {
        const tilts = Object.values(st4.tilts);
        if (!tilts.every((v) => Math.abs(v) <= 1)) fail("歪的角度超过 1 度：" + JSON.stringify(tilts));
        else ok("鼠标 / 键盘 / 点击 / 触屏都能放，吸附歪角 " + JSON.stringify(tilts));
      }
      await page.waitForTimeout(300);
      await shot("33-bulletin-done");
      await page.click("#bulletinDone");
      await page.waitForTimeout(400);

      if (!(await waitLine(/上次那个事/, 140))) fail("4/4 之后没有由乃那句「上次那个事……」");
      else ok("4/4 之后由乃说「上次那个事……」，只说一次");
      await backToCampus("公告栏之后");
      const s04 = await storyState();
      if (!s04.bulletinCompleted) fail("bulletinCompleted 没写");
      else if (!s04.bulletinPlacements || Object.keys(s04.bulletinPlacements).length !== 4) fail("bulletinPlacements 不完整");
      else if (s04.bulletinYunoEcho !== true) fail("bulletinYunoEcho 没写");
      else if (s04.bulletinLostItem !== null) fail("没玩过传话却写了 bulletinLostItem");
      else if (s04.aAndBDating !== null || s04.jurieLikedABeforeTransfer !== null) fail("公告栏写了关系事实");
      else ok("bulletinCompleted / placements / tilts 写好，事实字段没动");
    }

    // 玩过传话、传丢了物品：朋友甲错带剪刀和水到板边，只当一句笑话。
    await startEventAt(3, {}, { relayCompleted: true, relayLost: ["items"], relayFinal: "放学后，公告栏，带剪刀和水。" });
    await openEvent();
    if (await waitPanel("#mgBulletin", "公告栏面板")) {
      await page.waitForTimeout(300);
      await page.evaluate(() => document.querySelector('.bulletin-item[data-id="title"]').focus());
      await page.keyboard.press("1");
      await page.waitForTimeout(500);
      const joke = await page.evaluate(() => {
        const el = document.querySelector("#mgBulletin .bulletin-joke");
        return el ? { shown: el.classList.contains("show"), text: el.textContent } : null;
      });
      if (!joke || !joke.shown) fail("传话传丢物品，板边没有出现朋友甲：" + JSON.stringify(joke));
      else if (!/剪刀/.test(joke.text)) fail("错带的不是剪刀和水：" + joke.text);
      else ok("传话传丢物品 → 朋友甲错带剪刀和水出现在板边");
      await shot("34-bulletin-joke");

      for (const pair of [["photo", "2"], ["time", "3"], ["join", "4"]]) {
        await page.evaluate((sel) => document.querySelector(sel).focus(), '.bulletin-item[data-id="' + pair[0] + '"]');
        await page.keyboard.press(pair[1]);
        await page.waitForTimeout(180);
      }
      await page.click("#bulletinDone");
      await page.waitForTimeout(400);
      const s04b = await waitStory((x) => x.bulletinCompleted === true);
      if (!s04b || s04b.bulletinLostItem !== "scissors-and-water") fail("bulletinLostItem 没记下来：" + (s04b && s04b.bulletinLostItem));
      else ok("bulletinLostItem = scissors-and-water");
      if (!(await waitLine(/拿错/, 120))) fail("板边笑话没有接一句对白");
      else ok("板边笑话只接一句对白");
      await backToCampus("公告栏笑话之后");
    }

    // 8 秒没动：只帮忙放一样，不会继续代打。
    await startEventAt(3);
    await openEvent();
    if (await waitPanel("#mgBulletin", "公告栏面板")) {
      const t0 = Date.now();
      let helped = null;
      for (let i = 0; i < 40; i++) {
        const st = await bulletinState();
        if (st && st.helped) { helped = { st, ms: Date.now() - t0 }; break; }
        await page.waitForTimeout(350);
      }
      if (!helped) fail("8 秒无操作没有帮忙放一次");
      else if (helped.st.placed.length !== 1) fail("帮忙一次却放了 " + helped.st.placed.length + " 样");
      else ok("8 秒无操作只帮一次（放了 1 样，用时 " + helped.ms + "ms）");

      await page.waitForTimeout(9500);
      const st2 = await bulletinState();
      if (!st2 || st2.placed.length !== 1) fail("帮忙之后还在继续代打：" + (st2 && st2.placed.length));
      else if (!st2.helped) fail("helped 标记没留住");
      else ok("再等 9 秒也不会再帮第二次");

      await page.keyboard.press("Escape");
      for (let i = 0; i < 50; i++) {
        const text = await page.evaluate(() => {
          const box = document.getElementById("interaction");
          return box && !box.hidden ? box.textContent : "";
        });
        if (text.indexOf("先跳过") >= 0) break;
        await page.waitForTimeout(120);
      }
      await answerChoice(2);
      await backToCampus("公告栏放弃之后");
    }

    // ------------------------------------------------------------ 事件 07 纸飞机
    console.log("\n[事件 07 纸飞机 → 照片]");
    const planeState = () => page.evaluate(() => {
      const g = window.ACT6Mini.current;
      if (!g || g.id !== "paperplane") return null;
      return {
        phase: g.phase, turn: g.turn, styleId: g.styleId,
        angle: g.angle, force: g.force, turns: g.turns, best: g.best
      };
    });

    await startEventAt(6);
    await openEvent();
    if (await waitMini("paperplane")) {
      await page.waitForTimeout(400);
      await shot("35-plane-yuno");
      let fold = null;
      for (let i = 0; i < 240; i++) {
        const st = await planeState();
        if (st && st.phase === "fold") { fold = st; break; }
        if (await dialogOpen()) {
          await page.evaluate(() => window.ACT6.advance());
          await page.waitForTimeout(70);
          continue;
        }
        await page.waitForTimeout(120);
      }
      if (!fold) fail("由乃扔完没有回到玩家的折法选择");
      else ok("由乃先扔一回合，然后轮到玩家");

      const styles = await page.locator("#planeStyles [data-style]").allTextContents();
      if (styles.length !== 3) fail("折法不是三张卡：" + JSON.stringify(styles));
      else if (!/尖头/.test(styles[0]) || !/宽翼/.test(styles[1]) || !/方头/.test(styles[2])) fail("三种折法不对：" + JSON.stringify(styles));
      else ok("三种折法：尖头 / 宽翼 / 方头");
      await shot("36-plane-fold");

      await page.keyboard.press("1");
      await page.waitForTimeout(250);
      const angle0 = (await planeState()).angle;
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(220);
      const aim1 = await planeState();
      if (!(aim1.angle > angle0)) fail("← → 没有调角度：" + angle0 + " → " + aim1.angle);
      else ok("角度可调（" + angle0 + "° → " + aim1.angle + "°）");
      await page.keyboard.press("ArrowUp");
      await page.waitForTimeout(180);
      const aim2 = await planeState();
      if (!(aim2.force > 60)) fail("↑ 没有调力度：" + aim2.force);
      else ok("力度可调（" + aim2.force + "）");
      await shot("37-plane-aim");

      await page.keyboard.down(" ");
      await page.waitForTimeout(700);
      await page.keyboard.up(" ");
      let landed = false;
      let lastTurns = [];
      for (let i = 0; i < 200; i++) {
        const st = await planeState();
        if (st && st.turns.length) lastTurns = st.turns;
        if (st && st.turns.some((x) => x.who === "me")) { landed = true; break; }
        if (await dialogOpen()) {
          await page.evaluate(() => window.ACT6.advance());
          await page.waitForTimeout(70);
          continue;
        }
        await page.waitForTimeout(130);
      }
      if (!landed) fail("玩家的飞机没有落地");
      else {
        const mine = lastTurns.find((x) => x.who === "me");
        if (!mine || !isFinite(mine.distance) || !(mine.distance > 0)) fail("玩家的飞行距离不对：" + JSON.stringify(mine));
        else ok("按住空格蓄力松开投出，飞了 " + mine.distance + " 米（" + mine.style + "）");
      }
      await shot("38-plane-fly");

      let s07 = null;
      for (let i = 0; i < 300; i++) {
        const st = await planeState();
        if (st && st.turns.length) lastTurns = st.turns;
        const story = await storyState();
        if (story.paperPlaneCompleted) { s07 = story; break; }
        if (await dialogOpen()) {
          await page.evaluate(() => window.ACT6.advance());
          await page.waitForTimeout(70);
          continue;
        }
        await page.waitForTimeout(120);
      }
      if (!s07) fail("paperPlaneCompleted 没写");
      else if (!(s07.paperPlaneBest > 0)) fail("paperPlaneBest 不对：" + s07.paperPlaneBest);
      else if (s07.paperPlaneStyle !== "dart") fail("paperPlaneStyle 应为 dart，实际 " + s07.paperPlaneStyle);
      else if (["me", "yuno", "jurie", "tie"].indexOf(s07.paperPlaneWinner) < 0) fail("paperPlaneWinner 不在约定里：" + s07.paperPlaneWinner);
      else if (!s07.paperPlaneLanded || !(s07.paperPlaneLanded.x >= 0.07 && s07.paperPlaneLanded.x <= 0.93)) fail("paperPlaneLanded 不完整：" + JSON.stringify(s07.paperPlaneLanded));
      else if (s07.aAndBDating !== null || s07.jurieLikedABeforeTransfer !== null) fail("纸飞机写了关系事实");
      else ok("纸飞机：best " + s07.paperPlaneBest + " / " + s07.paperPlaneStyle + " / winner " + s07.paperPlaneWinner + " / 落点 " + s07.paperPlaneLanded.x);

      const whoSet = lastTurns.map((x) => x.who).sort().join(",");
      if (whoSet !== "jurie,me,yuno") fail("三个人的回合不齐：" + whoSet + " " + JSON.stringify(lastTurns));
      else ok("三个人各扔一回合（" + lastTurns.map((x) => x.who + " " + x.distance + "m").join(" / ") + "）");

      // 紧接着的照片：楼前地上还留着那架飞机。
      if (await waitMini("photo")) {
        await page.waitForTimeout(450);
        const hasPlane = await page.evaluate(() => !!document.querySelector("#photoStage .photo-plane"));
        if (!hasPlane) fail("照片取景框里没有那架落地的飞机");
        else ok("照片取景框里留着事件 07 落地的飞机");
        await shot("39-photo-plane");

        await waitPanel("#photo", "取景框");
        for (let i = 0; i < 3; i++) {
          await page.keyboard.press(" ");
          await page.waitForTimeout(360);
        }
        await waitPanel("#photoPick", "挑照片");
        await page.waitForTimeout(280);
        await page.click("#photoPickList button:nth-child(1)");
        await page.click("#photoKeep");
        await finishGame("photo");
        const sPhoto = await store();
        if (!sPhoto.photoPicked || !sPhoto.photoPicked.plane) fail("挑中的照片没有记下地上的飞机");
        else ok("photoPicked.plane 记下 " + JSON.stringify(sPhoto.photoPicked.plane));
      } else fail("事件 07 之后没有接上「留一张照片」");
    }

    // Esc 只取消这一场：剧情给「重试这一段 / 先跳过」。
    await startEventAt(6);
    await openEvent();
    if (await waitMini("paperplane")) {
      let fold2 = false;
      for (let i = 0; i < 200; i++) {
        const st = await planeState();
        if (st && st.phase === "fold") { fold2 = true; break; }
        if (await dialogOpen()) {
          await page.evaluate(() => window.ACT6.advance());
          await page.waitForTimeout(70);
          continue;
        }
        await page.waitForTimeout(120);
      }
      if (!fold2) fail("第二次进纸飞机没走到折法选择");
      await page.keyboard.press("Escape");
      let planeCancelled = false;
      for (let i = 0; i < 50; i++) {
        const text = await page.evaluate(() => {
          const box = document.getElementById("interaction");
          return box && !box.hidden ? box.textContent : "";
        });
        if (text.indexOf("重试这一段") >= 0) { planeCancelled = true; break; }
        await page.waitForTimeout(120);
      }
      if (!planeCancelled) fail("纸飞机里按 Esc 没有给「重试这一段 / 先跳过」");
      else ok("Esc 取消纸飞机，走剧情的重试 / 跳过");
      await answerChoice(2);
      await page.waitForTimeout(400);
      if (await waitMini("photo")) await skipMini("photo");
      await backToCampus("纸飞机取消之后");
    }

    // ------------------------------------------------------------ 一周目只留三场日常
    console.log("\n[一周目只留三场日常]");
    const storySrc = fs.readFileSync(path.join(ROOT, "act6/story.js"), "utf8");
    const called = [...storySrc.matchAll(/playDaily\('([a-z]+)'/g)].map((m) => m[1]);
    const keptDaily = ["crowdrun", "photo", "passnote"];
    const extra = called.filter((id) => keptDaily.indexOf(id) < 0);
    if (extra.length) fail("主线里还挂着目录里的日常：" + extra.join(","));
    else if (keptDaily.some((id) => called.indexOf(id) < 0)) fail("一周目的三场日常不全：" + called.join(","));
    else ok("主线只接 人流 / 照片 / 传纸条（" + called.join(" / ") + "）");

    // 事件 05 不再先排值日表
    await startEventAt(4);
    await openEvent();
    if (await waitPanel("#mgCards", "信息卡面板")) {
      const c = await current();
      if (c && c.id === "roster") fail("事件 05 还在先开值日表");
      else ok("事件 05 直接进信息卡");
      await page.keyboard.press("Escape");
      for (let i = 0; i < 40; i++) {
        const text = await page.evaluate(() => {
          const box = document.getElementById("interaction");
          return box && !box.hidden ? box.textContent : "";
        });
        if (text.indexOf("先跳过") >= 0) break;
        await page.waitForTimeout(120);
      }
      await answerChoice(2);
      await page.waitForTimeout(300);
    }

    // 事件 08 只接传纸条，不再接课堂笔记 / 雨伞
    await startEventAt(7);
    await openEvent();
    if (await waitMini("passnote")) {
      const c = await current();
      if (!c || c.id !== "passnote") fail("事件 08 先接的不是传纸条：" + JSON.stringify(c));
      else ok("事件 08 只接传纸条");
    } else fail("事件 08 没有接上传纸条");
    await skipMini("passnote");
    await advance();
    const d08 = await store();
    if (d08.classNotesCompleted || d08.umbrellaCompleted) {
      fail("一周目还写了课堂笔记 / 雨伞：" + JSON.stringify({ notes: d08.classNotesCompleted, umbrella: d08.umbrellaCompleted }));
    } else ok("一周目不再写课堂笔记 / 雨伞");

    // 事件 10 不再强制踢毽子
    await startEventAt(9);
    await openEvent();
    let sawShuttle = false;
    let done10 = false;
    for (let i = 0; i < 200; i++) {
      const c = await current();
      if (c && c.id === "shuttlecock") sawShuttle = true;
      const story = await storyState();
      if (story.chapter04Completed) { done10 = true; break; }
      if (await dialogOpen()) {
        await page.evaluate(() => window.ACT6.advance());
        await page.waitForTimeout(70);
        continue;
      }
      await page.waitForTimeout(120);
    }
    if (sawShuttle) fail("事件 10 还强制踢毽子");
    else if (!done10) fail("事件 10 没有收尾");
    else ok("事件 10 不再强制踢毽子，直接并肩走");
    const d10 = await store();
    if (d10.shuttlecockCompleted) fail("毽子写进了日常存档");
    else ok("毽子只在目录里");

    // 通关后右上角的「日常」入口：可见、能打开、能逐个进
    console.log("\n[通关后的日常目录]");
    await startEventAt(9, { chapter04Completed: true });
    await page.waitForTimeout(1400);
    const entryState = await page.evaluate(() => {
      const e = document.getElementById("mgEntry");
      return { hidden: e.hidden, label: e.textContent };
    });
    if (entryState.hidden) fail("通关后右上角没有「日常」入口");
    else ok("通关后「" + entryState.label + "」入口可见");
    await page.click("#mgEntry");
    await page.waitForTimeout(600);
    if (!(await page.evaluate(() => !document.querySelector(".mg-hub").hidden))) fail("点「日常」没有打开目录");
    else ok("通关后可以打开「日常」目录");
    await page.click("#mgHubList li:nth-child(7)");   // 课堂笔记
    if (await waitMini("classnotes")) {
      await advance();
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1000);
      if (!(await page.evaluate(() => !document.querySelector(".mg-hub").hidden))) fail("从目录进课堂笔记之后回不到目录");
      else ok("通关后可以逐个进目录里的日常");
    }
    await page.evaluate(() => window.ACT6Mini.closeHub());

    // ------------------------------------------------------------ 文案与结构
    console.log("\n[文案与结构]");
    const files = [
      "act6/index.html", "act6/story.js", "act6/minigames.js", "act6/minigames.css",
      "act6/events.js", "act6/events.css",
      "act6/games/relay.js", "act6/games/crowdrun.js", "act6/games/inquiry.js", "act6/games/photo.js",
      "act6/games/roster.js", "act6/games/passnote.js", "act6/games/umbrella.js",
      "act6/games/classnotes.js", "act6/games/shuttlecock.js", "act6/games/paperplane.js"
    ];
    const banned = ["好感度", "心动值", "认可度", "她喜欢的人是谁", "喜欢你", "三角恋", "情敌", "正确率"];
    for (const f of files) {
      const text = fs.readFileSync(path.join(ROOT, f), "utf8");
      for (const word of banned) {
        if (text.indexOf(word) >= 0) fail(f + " 里出现了「" + word + "」");
      }
    }
    ok("文案红线");

    s = await store();
    if (s.jurieLikedABeforeTransfer || s.aAndBDating || s.yunoMotive) fail("日常存档里混进了主线事实字段");
    else ok("日常存档只有日常字段");

    const story = await page.evaluate(() => window.__act6.state);
    // 这一段只走到 event03，事件 08 才写 jurieLikedABeforeTransfer；日常不该替它写。
    if (story.jurieLikedABeforeTransfer !== null || story.aAndBDating !== null) fail("剧情里的关键事实被日常提前写了");
    else if (typeof story.relayCompleted !== "undefined" || typeof story.crowdRunCompleted !== "undefined") fail("日常字段写进了剧情存档");
    else ok("剧情事实没被日常改动");

    // ------------------------------------------------------------ 事件 05 卡片分类
    console.log("\n[事件 05 听来的，与猜到的]");

    // 卡片池要先跟着事件 03 的结果走；这一步不用真的开场。
    const decks = await page.evaluate(() => {
      const flow = window.ACT6Flow;
      const count = (list, truth) => list.filter((c) => c.truth === truth).length;
      const full = flow.deckFor({ inquiryCompleted: true, askedFriendA: "full", askedFriendB: "partial", bAndAClose: "reported", bHasCrush: null });
      const crush = flow.deckFor({ inquiryCompleted: true, askedFriendA: "full", askedFriendB: "partial", bAndAClose: "reported", bHasCrush: "reported" });
      const empty = flow.deckFor({});
      const accurate = {};
      full.forEach((c) => { accurate[c.id] = c.truth; });
      const mixed = Object.assign({}, accurate);
      const guess = full.find((c) => c.truth === "guessed");
      mixed[guess.id] = "heard";
      return {
        full: { size: full.length, heard: count(full, "heard"), guessed: count(full, "guessed"), unknown: count(full, "unknown") },
        crush: { heard: count(crush, "heard") },
        empty: { size: empty.length, heard: count(empty, "heard"), heardText: empty[0].text },
        accurate: flow.judge(full, accurate),
        mixed: flow.judge(full, mixed)
      };
    });
    if (decks.full.size !== 5) fail("信息卡应该固定五张，实际 " + decks.full.size);
    else if (decks.full.heard !== 1 || decks.full.guessed !== 2) fail("事件 03 只问到 A 那条时，池子不对：" + JSON.stringify(decks.full));
    else ok("卡片池跟着事件 03 走（听到的 1 / 我猜的 2）");
    if (decks.crush.heard !== 2) fail("bHasCrush 有了之后应该多一张听到的，实际 " + decks.crush.heard);
    else ok("bHasCrush 写进来后多一张「可能有喜欢的人」");
    if (decks.empty.size !== 5 || decks.empty.heard !== 1) fail("没打过事件 03 时没有走默认卡组：" + JSON.stringify(decks.empty));
    else ok("字段都不在时用默认卡组兜底");
    if (decks.accurate.accuracy !== "accurate") fail("全放对却没判成 accurate：" + JSON.stringify(decks.accurate));
    else if (decks.mixed.accuracy !== "mixed" || decks.mixed.guessesAsHeard !== 1) fail("把猜测放进听到的没判成 mixed：" + JSON.stringify(decks.mixed));
    else ok("分类结果只落到 accurate / mixed");

    // 真的开一场：键盘 / 点击 / 拖动 / 触屏各放一张。
    await startEventAt(4);
    await openEvent();
    if (await waitPanel("#mgCards", "信息卡面板")) {
      await page.waitForTimeout(350);
      await shot("22-cards-intro");
      const deck = await page.evaluate(() => window.ACT6Flow.cardState().deck);
      if (deck.length !== 5) fail("面板里不是五张卡：" + deck.length);
      const how = ["key", "click", "drag", "touch", "key"];
      for (let i = 0; i < deck.length; i++) {
        await placeCard(deck[i].id, deck[i].truth, how[i % how.length]);
      }
      const cs = await page.evaluate(() => window.ACT6Flow.cardState());
      const bad = deck.filter((c) => cs.placement[c.id] !== c.truth);
      if (bad.length) fail("四条操作路径没把卡放对：" + JSON.stringify(cs.placement));
      else ok("键盘 / 点击 / 拖动 / 触屏都能分类");
      await page.waitForTimeout(250);
      await shot("23-cards-sorted");

      // 拖回「还没放的」也认
      const cardSel = '.card-chip[data-id="' + deck[0].id + '"]';
      const from = await page.locator(cardSel).boundingBox();
      const bank = await page.locator(".cards-bank").boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(bank.x + bank.width / 2, bank.y + bank.height / 2, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      const back = await page.evaluate(() => window.ACT6Flow.cardState());
      if (back.placement[deck[0].id]) fail("拖回「还没放的」没有拿回来");
      else ok("拖回「还没放的」可以重放");
      await placeCard(deck[0].id, deck[0].truth, "key");

      await page.click("#cardsDone");
      await page.waitForTimeout(300);
      await advance();
      const s05 = await page.evaluate(() => window.__act6.state);
      if (s05.reportAccuracy !== "accurate") fail("准确分类后 reportAccuracy 应为 accurate，实际 " + s05.reportAccuracy);
      else if (!s05.reportCompleted) fail("reportCompleted 没写");
      else if (s05.aAndBDating !== null) fail("卡片分类把 reported 升成了事实");
      else ok("准确分类 → reportAccuracy = accurate，事实字段没动");
    }

    // 「其实，我没问到」单独一条：不进分类也照样收场。
    await startEventAt(4);
    await openEvent();
    if (await waitPanel("#mgCards", "信息卡面板")) {
      await page.waitForTimeout(300);
      await page.evaluate(() => document.querySelector(".card-chip").focus());
      await page.keyboard.press("1");
      await page.waitForTimeout(150);
      await page.click("#cardsSilent");
      await page.waitForTimeout(300);
      await advance();
      const s05b = await page.evaluate(() => window.__act6.state);
      if (s05b.reportAccuracy !== "silent") fail("点「其实我没问到」后应为 silent，实际 " + s05b.reportAccuracy);
      else ok("「其实，我没问到」→ reportAccuracy = silent");
    }

    // Esc 只取消这一场：给「重试这一段 / 先跳过」，不是异常兜底。
    await startEventAt(4);
    await openEvent();
    if (await waitPanel("#mgCards", "信息卡面板")) {
      await page.waitForTimeout(300);
      await page.keyboard.press("Escape");
      let cancelled = false;
      for (let i = 0; i < 40; i++) {
        const text = await page.evaluate(() => {
          const box = document.getElementById("interaction");
          return box && !box.hidden ? box.textContent : "";
        });
        if (text.indexOf("重试这一段") >= 0) { cancelled = true; break; }
        await page.waitForTimeout(120);
      }
      if (!cancelled) fail("信息卡里按 Esc 没有给「重试这一段 / 先跳过」");
      else ok("Esc 取消卡片分类，走剧情的重试 / 跳过");
      await answerChoice(2);
      await page.waitForTimeout(300);
    }

    // ------------------------------------------------------------ 事件 08 的一句语气
    console.log("\n[事件 08 的开场语气]");
    await startEventAt(7, { reportAccuracy: "accurate", reportCompleted: true });
    await openEvent();
    await skipMini("passnote");
    if (await waitLine(/不用替他们编/)) {
      await shot("24-tone-accurate");
      ok("reportAccuracy = accurate → 由乃开场改了一句");
    } else fail("event08 没读 reportAccuracy（accurate）");

    await startEventAt(7, { reportAccuracy: "silent", reportCompleted: true });
    await openEvent();
    await skipMini("passnote");
    if (await waitLine(/周三你说没问到/)) ok("reportAccuracy = silent → 开场更短更轻");
    else fail("event08 没读 reportAccuracy（silent）");
    await advance();

    // ------------------------------------------------------------ 事件 09 记忆滑块
    console.log("\n[事件 09 原来在那之前]");
    await startEventAt(8);
    await openEvent();
    if (await waitPanel("#mgMemory", "记忆滑块")) {
      await page.waitForTimeout(300);
      let st = await memoryState();
      if (!st || st.segment !== 0) fail("记忆滑块没有从第一段开始：" + JSON.stringify(st));
      else ok("三段从第一段开始");
      await shot("25-memory-past");

      // 鼠标：滑到后来，旁白换了、四周压暗、继续出现
      await slideTo(1);
      st = await memoryState();
      if (!st.unlocked || st.value < 90) fail("鼠标滑到右端没解锁：" + JSON.stringify(st));
      if (!/后来我才知道/.test(await captionText())) fail("滑到后来没换旁白");
      const vig = await page.evaluate(() => Number(getComputedStyle(document.querySelector(".memory-vignette")).opacity));
      if (!(vig > 0.1)) fail("滑到后来四周没有压暗：" + vig);
      else ok("滑到后来：换旁白、四周压暗（" + vig.toFixed(2) + "）");
      await shot("26-memory-later");

      // 拖回 0 重读
      await slideTo(0);
      if (!/邀请我一起玩/.test(await captionText())) fail("拖回左边没有回到那时的旁白");
      else ok("可以拖回 0 重读");

      // 键盘：End 滑到底；E / 空格不能跳过滑块
      await page.evaluate(() => document.getElementById("memoryRange").focus());
      await page.keyboard.press("End");
      await page.waitForTimeout(300);
      st = await memoryState();
      if (!(st.value >= 99)) fail("键盘 End 没把滑块滑到最右：" + JSON.stringify(st));
      else ok("键盘可以滑到底");
      await page.evaluate(() => document.activeElement.blur());
      await page.keyboard.press("e");
      await page.keyboard.press(" ");
      await page.waitForTimeout(250);
      const stillOpen = await page.evaluate(() => !!window.ACT6Flow.memoryState());
      if (!stillOpen) fail("E / 空格把滑块跳过去了");
      else ok("E / 空格跳不过滑块");

      await page.click("#memoryNext");
      if (!(await waitSegment(1))) fail("没有走到第二段");
      else ok("继续 → 第二段");
      await page.evaluate(() => document.getElementById("memoryRange").focus());
      await page.keyboard.press("End");
      await page.waitForTimeout(250);
      await page.click("#memoryNext");
      if (!(await waitSegment(2))) fail("没有走到第三段");
      const step3 = await page.evaluate(() => document.getElementById("memoryStep").textContent);
      const bg3 = await page.evaluate(() => document.getElementById("background").src);
      const actors3 = await page.evaluate(() => document.querySelectorAll("#actors img").length);
      if (!/第三段/.test(step3)) fail("第三段的台阶标签不对：" + step3);
      if (!/dusk/.test(bg3)) fail("第三段没有回到空走廊：" + bg3.split("/").pop());
      else if (actors3) fail("空走廊上还有 " + actors3 + " 个人");
      else ok("第三段落在没人的走廊（" + bg3.split("/").pop() + "）");
      await shot("27-memory-corridor");

      await page.evaluate(() => document.getElementById("memoryRange").focus());
      await page.keyboard.press("End");
      await page.waitForTimeout(250);
      await page.click("#memoryNext");
      await page.waitForTimeout(600);
      await advance();
      await page.waitForTimeout(400);
      const s09 = await page.evaluate(() => window.__act6.state);
      if (!s09.memoryRevisitCompleted) fail("memoryRevisitCompleted 没写");
      else if (s09.memorySegmentsSeen !== 3) fail("memorySegmentsSeen 应该是 3，实际 " + s09.memorySegmentsSeen);
      else if (s09.aAndBDating !== null) fail("记忆重访把 reported 升成了事实");
      else ok("memoryRevisitCompleted / memorySegmentsSeen = 3");
      const noPhoto = await page.evaluate(() => !!document.querySelector(".memory-photo"));
      if (noPhoto) fail("没拍过照片却也复现了合照");
      else ok("没有照片时跳过复现");
    }

    // 有照片 + 从第三段续看：只滑一段，复现合照后收掉。
    console.log("\n[事件 09 复现合照]");
    await startEventAt(8, { memorySegmentsSeen: 2 }, {
      photoCompleted: true, photoShots: 3,
      photoPicked: {
        event: "normal", zoom: "far",
        plane: { x: 0.62, y: 0.93, style: "dart" },
        positions: [{ who: "boy", x: 0.3, y: 0.93 }, { who: "girl", x: 0.5, y: 0.93 }, { who: "friend", x: 0.71, y: 0.93 }]
      }
    });
    await openEvent();
    if (await waitPanel("#mgMemory", "记忆滑块")) {
      const st = await memoryState();
      if (!st || st.segment !== 2) fail("memorySegmentsSeen=2 时没有从第三段续看：" + JSON.stringify(st));
      else ok("中途存下的 memorySegmentsSeen 能续看");
      await page.evaluate(() => document.getElementById("memoryRange").focus());
      await page.keyboard.press("End");
      await page.waitForTimeout(300);
      await page.click("#memoryNext");
      let shown = null;
      for (let i = 0; i < 120; i++) {
        if (await page.evaluate(() => !!document.querySelector(".memory-photo.show"))) {
          shown = await page.evaluate(() => ({
            actors: document.querySelectorAll(".memory-photo .photo-actor").length,
            paper: !!document.querySelector(".memory-polaroid"),
            planes: document.querySelectorAll(".memory-photo .photo-plane").length
          }));
          break;
        }
        if (await dialogOpen()) await page.evaluate(() => window.ACT6.advance());
        await page.waitForTimeout(80);
      }
      if (!shown || shown.actors !== 3 || !shown.paper) fail("photoPicked 没有按构图复现：" + JSON.stringify(shown));
      else if (shown.planes !== 1) fail("拍到的纸飞机没有一起复现：" + JSON.stringify(shown));
      else ok("photoPicked 用相纸复现了三个人和地上那架飞机");
      await shot("28-memory-photo");
      let gone = false;
      for (let i = 0; i < 60; i++) {
        if (!(await page.evaluate(() => !!document.querySelector(".memory-photo")))) { gone = true; break; }
        await page.waitForTimeout(100);
      }
      if (!gone) fail("合照复现之后没有收掉");
      else ok("合照一两秒后收掉");
      await advance();
      const s09b = await page.evaluate(() => window.__act6.state);
      if (!s09b.memoryRevisitCompleted) fail("复现合照这一场没有收尾");
      else ok("复现之后照常收尾");
    }

    // 「自检：工厂异常」是这条用例故意制造的异常，不算页面缺陷。
    const realErrors = errors.filter((m) => m.indexOf("自检") < 0);
    if (realErrors.length) fail("页面报错 " + realErrors.length + " 条：" + realErrors.slice(0, 4).join(" | "));
    else ok("没有页面报错");
  } finally {
    await browser.close();
  }

  console.log("\n================ 结果 ================");
  if (failures.length) {
    console.log("失败 " + failures.length + " 条：");
    failures.forEach((f) => console.log(" - " + f));
    process.exitCode = 1;
  } else {
    console.log("全部通过。截图在 act6/tools/shots/");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});







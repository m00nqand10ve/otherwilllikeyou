/* 第三幕 · 校园日常 — 自检
 *
 * 前半是静态检查：资源尺寸、题库自洽、场景连线对称、线索分类齐全、文案不越界。
 * 后半开浏览器把六个日常各走一遍，断言状态机、存档和画面几何。
 * 《校园寻物》走两遍：一遍一句话不问直接找到（设计稿要求允许），一遍看全了再找。
 *
 * 第三幕现在是「自由走动」章节壳（shell.js + shared/campus-route.js）：
 *   默认进入不开目录，WASD 在五个校园区域间走动，走到下一件事的区域按 E 开演；
 *   目录（?hub=1）只是调试层，列表不响应点击；?auto=1 才是自动时间线。
 *   所以导航改成：校园走动 + E 进 G01，其余用 __daily.play(id) 直接开演；
 *   每场结束不再等目录弹出，而是等 __daily.current 释放且 busy 落下。
 *   六个全部完成后章节壳会跳转 narrative/index.html?phase=after，单独断言。
 *
 * 用法：node act5/tools/check.cjs
 * 截图落在 act5/tools/shots/。
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require(path.resolve(__dirname, "../../game/dust-corridor/node_modules/playwright-core"));

const ROOT = path.resolve(__dirname, "../..");
const DIR = path.join(ROOT, "act5");
const OUT = path.join(__dirname, "shots");
const PAGE = "file:///" + path.join(DIR, "daily.html").replace(/\\/g, "/");
const PAGE_HUB = PAGE + "?hub=1";
const PAGE_AUTO = PAGE + "?auto=1";

const fails = [];
const oks = [];
const fail = (m) => fails.push(m);
const ok = (m) => oks.push(m);
// 进度打到 stderr：整份报告是跑完才一次性 console.log 的，
// 没有阶段标记的话，卡住和「球赛本来就慢」从日志上分不出来。
const stage = (m) => console.error(`[stage ${new Date().toISOString().slice(11, 19)}] ${m}`);

function read(f) { return fs.readFileSync(path.join(DIR, f), "utf8"); }

// ---------------------------------------------------------------- 1. 静态

function checkStatic() {
  // 1.1 三人 v2 精灵表：48×72 一帧，宽度 = 帧数 × 48
  const sheets = { boy: 31, girl: 33, friend: 36 };
  const frames = {};
  for (const who of Object.keys(sheets)) {
    const file = path.join(ROOT, `assets/characters/${who}/v2/${who}_sheet_v2.png`);
    if (!fs.existsSync(file)) { fail(`没有 ${who}_sheet_v2.png`); continue; }
    const data = fs.readFileSync(file);
    if (data.readUInt32BE(0) !== 0x89504e47) fail(`${who}_sheet_v2.png 不是 PNG`);
    const w = data.readUInt32BE(16), h = data.readUInt32BE(20);
    if (h !== 72) fail(`${who}_sheet_v2.png 高 ${h}，应该是 72`);
    if (w % 48 !== 0) fail(`${who}_sheet_v2.png 宽 ${w} 不是 48 的整数倍`);
    frames[who] = w / 48;
    if (frames[who] !== sheets[who]) {
      fail(`${who}_sheet_v2.png 有 ${frames[who]} 帧，帧位表按 ${sheets[who]} 帧写的`);
    }
  }

  // 1.1b 头像裁切的宽度必须跟着帧数走。换了精灵表却忘了改这里，
  //      浏览器会把整张表缩放，每帧被压窄，取出来的窗口跨到隔壁帧——
  //      头像就变成两个小人的拼贴（v2 换图时就踩过这个坑）。
  const css = read("daily.css");
  const FACE = 54;      // 48 × 1.125
  for (const who of Object.keys(frames)) {
    const cls = "f-" + who;
    const m = css.match(new RegExp("\\." + cls + "\\s*\\{[^}]*background-size:\\s*(\\d+)px"));
    if (!m) { fail(`daily.css 里找不到 .${cls} 的 background-size`); continue; }
    const want = frames[who] * FACE;
    if (Number(m[1]) !== want) {
      fail(`.${cls} 的 background-size 宽是 ${m[1]}px，${frames[who]} 帧应该是 ${want}px`);
    }
  }

  // 1.2 所有脚本都在，且没有明显的 ES module 语法（file:// 下不能用）
  const scripts = ["core.js", "trio.js", "explore.js", "errand.js", "search.js",
                   "solo.js", "wordgame.js", "ball.js", "shell.js"];
  for (const f of scripts) {
    if (!fs.existsSync(path.join(DIR, f))) { fail(`缺少 ${f}`); continue; }
    const src = read(f);
    if (/^\s*(import|export)\s/m.test(src)) fail(`${f} 用了 ES module 语法，file:// 下会挂`);
  }

  // 1.2b 背景路人：四向行走表，每张 4 帧、48×72
  for (const who of ["boy", "girl"]) {
    for (const dir of ["down", "up", "left", "right"]) {
      const file = path.join(ROOT, `assets/characters/npc_generated/${who}_walk_${dir}_sheet.png`);
      if (!fs.existsSync(file)) { fail(`缺少 ${who}_walk_${dir}_sheet.png`); continue; }
      const b = fs.readFileSync(file);
      const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
      if (w !== 4 * 48 || h !== 72) fail(`${who}_walk_${dir}_sheet.png 是 ${w}×${h}，应该是 192×72`);
    }
  }
  for (const icon of ["mon", "tue", "wed", "thu", "fri", "nextmon"]) {
    if (!fs.existsSync(path.join(ROOT, `assets/minigame/icon_day_${icon}.png`))) {
      fail(`缺少 icon_day_${icon}.png`);
    }
  }

  // 1.3 题库自洽
  const wg = read("wordgame.js");
  const qBlock = wg.slice(wg.indexOf("const QUESTIONS = ["), wg.indexOf("const WHO ="));
  const answers = [...qBlock.matchAll(/answer:\s*"([^"]+)"/g)].map((m) => m[1]);
  const optionSets = [...qBlock.matchAll(/options:\s*\[([^\]]+)\]/g)].map((m) =>
    m[1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")));
  if (answers.length < 5) fail(`题库只有 ${answers.length} 题，太短了（六个回合起）`);
  if (optionSets.length !== answers.length) fail("有题目没有选项");
  const ansAt = [];
  optionSets.forEach((opts, i) => {
    if (opts.length !== 4) fail(`第 ${i + 1} 题选项 ${opts.length} 个，应该是 4 个`);
    const at = opts.indexOf(answers[i]);
    if (at < 0) fail(`第 ${i + 1} 题的答案「${answers[i]}」不在选项里`);
    ansAt.push(at);
  });
  // 正确答案不许全放第一个：闭眼点第一个就全对，题面再有意思也白搭
  if (ansAt.length > 1 && ansAt.every((n) => n === 0)) {
    fail("所有题的正确答案都在第一个选项，闭眼点第一个就全对了");
  }
  if (wg.indexOf('dataset.ans = "1"') < 0) {
    fail("猜词选项没有标出正确答案，自动化脚本只能靠硬编码答案数组");
  }
  const clueCount = [...qBlock.matchAll(/clues:\s*\[([\s\S]*?)\]/g)]
    .map((m) => (m[1].match(/"/g) || []).length / 2);
  clueCount.forEach((n, i) => {
    if (n < 2) fail(`第 ${i + 1} 题只有 ${n} 条线索，太少了`);
  });

  // 1.3b G03 §5.1/§5.5：剪影改程序化（WGMask），题库扩到 18 题，且不再新增图片素材。
  //      防回归：assets/silhouettes/ 一直只能是原来那 9 张 PNG；新题一律走 fig 数据。
  const figBlocks = [...qBlock.matchAll(/fig:\s*\{([^{}]*)\}/g)].map((m) => m[1]);
  const silPaths = [...qBlock.matchAll(/\bsil:\s*"([^"]+)"/g)].map((m) => m[1]);
  const bodyBlock = wg.slice(wg.indexOf("const BODIES = {"), wg.indexOf("const PROPS = {"));
  const bodyKeys = [...bodyBlock.matchAll(/(\w+):\s*function\s*\(ctx\)/g)].map((m) => m[1]);
  const propBlock = wg.slice(wg.indexOf("const PROPS = {"), wg.indexOf("const QUESTIONS = ["));
  const propKeys = [...propBlock.matchAll(/(\w+):\s*function\s*\(ctx\)/g)].map((m) => m[1]);
  if (answers.length !== 18) fail(`G03 题库是 ${answers.length} 题，§5.5 要求 18 题（三类各 6 道）`);
  if (figBlocks.length !== 9) fail(`G03 用 fig 的新题是 ${figBlocks.length} 道，应该是 9 道`);
  if (silPaths.length !== 9) fail(`G03 保留 PNG 的老题是 ${silPaths.length} 道，应该是 9 道`);
  if (bodyKeys.length !== 4) fail(`WGMask 体型应该有 4 种，现在有 ${bodyKeys.length} 种`);
  if (propKeys.length < 20) fail(`WGMask 道具表只有 ${propKeys.length} 件，§5.1 要求约 20 件`);
  figBlocks.forEach((body, i) => {
    const propsM = body.match(/props:\s*\[([^\]]*)\]/);
    const props = propsM
      ? propsM[1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean) : [];
    if (!props.length) fail(`G03 第 ${i + 1} 道 fig 题没有道具`);
    props.forEach((p) => {
      if (propKeys.indexOf(p) < 0) fail(`G03 有题目的 fig.props 用了道具表里没有的「${p}」`);
    });
    const bodyM = body.match(/body:\s*"(\w+)"/);
    if (!bodyM || bodyKeys.indexOf(bodyM[1]) < 0) {
      fail(`G03 有题目的 fig.body 不在体型表里：${bodyM ? bodyM[1] : "?"}`);
    }
  });
  {
    const silDir = path.join(ROOT, "assets/silhouettes");
    const silFiles = fs.existsSync(silDir)
      ? fs.readdirSync(silDir).filter((f) => /\.png$/i.test(f)) : [];
    if (silFiles.length !== 9) {
      fail(`assets/silhouettes/ 里有 ${silFiles.length} 张图，扩题前后都该是 9 张（§5.1 不许新增图片素材）`);
    }
  }
  // 每条线索都要带类别 k（look / story / quote），一题里至少两类，玩家才有的挑。
  // 注意 qBlock 里还跟着「换你出题」的 SWAP_ROUNDS（那三组也带 clues），只看前 18 组。
  const clueBlocks = [...qBlock.matchAll(/clues:\s*\[([\s\S]*?)\]/g)].map((m) => m[1])
    .slice(0, answers.length);
  clueBlocks.forEach((body, i) => {
    const kinds = [...body.matchAll(/k:\s*"(\w+)"/g)].map((m) => m[1]);
    if (kinds.length !== 3) fail(`G03 第 ${i + 1} 题有 ${kinds.length} 条线索带类别，应该是 3 条`);
    kinds.forEach((k) => {
      if (["look", "story", "quote"].indexOf(k) < 0) {
        fail(`G03 第 ${i + 1} 题线索类别「${k}」不在 look/story/quote 里`);
      }
    });
    if (new Set(kinds).size < 2) fail(`G03 第 ${i + 1} 题的线索只有一类，玩家没得挑`);
  });
  // 抽题按类别各取 2 道，三个类别都得凑得出来
  const catList = [...qBlock.matchAll(/cat:\s*"(anime|game|movie)"/g)].map((m) => m[1]);
  if (catList.length !== answers.length) fail(`G03 有 ${catList.length} 道题标了类别，题库是 ${answers.length} 道`);
  for (const c of ["anime", "game", "movie"]) {
    const n = catList.filter((x) => x === c).length;
    if (n < 2) fail(`G03 的 ${c} 题库只有 ${n} 道，抽不出 2 道`);
  }
  // §5.2 / §5.4 / §5.5 的机制得真的在代码里
  if (!/BUZZ_MS\s*=\s*2200/.test(wg)) fail("G03 抢答窗不是 2.2 秒（BUZZ_MS）");
  if (wg.indexOf("wordRuns") < 0 || wg.indexOf("function pickQuestions(") < 0) {
    fail("G03 没有按游玩次抽题（D.store.wordRuns / pickQuestions）");
  }
  if (wg.indexOf("learnedCats") < 0) fail("G03「换你出题」第二轮没有记下她俩猜错过的词（learnedCats）");
  const maskBlock = wg.slice(wg.indexOf("const WGMask ="), wg.indexOf("const QUESTIONS = ["));
  for (const fn of ["function render(", "function clear(", "function cellFor(",
                    "function prepare(", "function animate("]) {
    if (maskBlock.indexOf(fn) < 0) fail(`G03 的 WGMask 缺少 ${fn}`);
  }
  if (maskBlock.indexOf("applyMask") < 0) fail("G03 的 WGMask 没有蒙版这一层（applyMask）");
  const htmlWg = read("daily.html");
  for (const id of ["wgSilCv", "wgBuzz", "wgPick"]) {
    if (htmlWg.indexOf('id="' + id + '"') < 0) fail(`daily.html 缺少 #${id}（剪影 canvas / 抢答窗 / 类别选择）`);
  }
  const cssWg = read("daily.css");
  if (!/#wgSilCv\s*\{/.test(cssWg)) fail("daily.css 没有 #wgSilCv 的尺寸样式");
  if (!/#wgSil\s*\{[^}]*display:\s*none/.test(cssWg)) {
    fail("#wgSil 还在直接显示，它只该做 PNG 加载中转");
  }

  // 1.4 场景连线必须对称，不然会走进死路（两个探索型小游戏都要查）
  const er = read("errand.js");
  const se = read("search.js");
  const parseScenes = (src, stopAt) => {
    const out = {};
    const from = src.indexOf("const SCENES = {");
    if (from < 0) return out;
    const to = src.indexOf(stopAt, from);
    const block = src.slice(from, to < 0 ? src.length : to);
    for (const m of block.matchAll(/(\w+):\s*\{([^}]*)\}/g)) {
      const body = m[2];
      const get = (k) => { const r = body.match(new RegExp(k + ':\\s*"([^"]+)"')); return r ? r[1] : null; };
      out[m[1]] = { left: get("left"), right: get("right") };
    }
    return out;
  };
  const checkSymmetry = (scenes, who) => {
    for (const name of Object.keys(scenes)) {
      const s = scenes[name];
      if (s.left && scenes[s.left] && scenes[s.left].right !== name) {
        fail(`${who}：${name} 往左通到 ${s.left}，但 ${s.left} 往右不通回 ${name}`);
      }
      if (s.right && scenes[s.right] && scenes[s.right].left !== name) {
        fail(`${who}：${name} 往右通到 ${s.right}，但 ${s.right} 往左不通回 ${name}`);
      }
    }
  };
  const scenes = parseScenes(er, "const BOX =");
  const searchScenes = parseScenes(se, "// 卡在楼梯口窗台上");
  checkSymmetry(scenes, "G01");
  checkSymmetry(searchScenes, "G02");
  if (Object.keys(searchScenes).length < 2) fail("G02 只解析出不到两个场景");

  // 1.4b S3：G01 从「三个场景来回走」改成「一个场景 + 三个站位」。
  //      三个人原地做事，切人靠 active / switchTo，三件事各自一个函数、都能重来。
  if (Object.keys(scenes).length !== 1) {
    fail(`G01 应该只剩一个场景（一个场景 + 三个站位），现在有 ${Object.keys(scenes).length} 个`);
  }
  if (!/let active\s*=\s*"girl"/.test(er)) fail("G01 没有 active 变量（现在是哪个人在做事）");
  for (const fn of ["switchTo", "postNotice", "countPapers", "carryBox"]) {
    if (er.indexOf("function " + fn + "(") < 0) fail(`G01 没有 ${fn}()`);
  }
  // 三个人一起抬箱子：按住空格抬、A / D 扶正；歪了就放下重来，没有失败态。
  for (const fn of ["startCarry", "updateCarry", "dropCarry", "syncCarryTrio"]) {
    if (er.indexOf("function " + fn + "(") < 0) fail(`G01 没有一起抬箱子的 ${fn}()`);
  }
  if (er.indexOf("CARRY") < 0) fail("G01 没有抬箱子用的 CARRY 参数");
  if (er.indexOf("carry.misses++") < 0) fail("G01 抬箱子歪倒没有记下重试");
  // 抬箱动画用的是已有的弯腰 / 抬箱帧：先 pickup，抬起来再换 carry。
  if (er.indexOf("function setCarryPose(") < 0 || er.indexOf("function clearCarryPose(") < 0) {
    fail("G01 没有把已有的弯腰 / 抬箱帧接进来（setCarryPose / clearCarryPose）");
  }
  if (er.indexOf("carry.rise") < 0) fail("G01 抬箱子没有起手 / 放下的抬升动画");
  if (er.indexOf('setCarryPose("carry")') < 0 ||
      er.indexOf('"pickup"') < 0 || er.indexOf('"carry"') < 0) {
    fail("G01 抬箱子没有用 pickup / carry 帧");
  }
  if (er.indexOf("trio.girl.flip") < 0) fail("G01 朱里弯腰时没有转向箱子");
  const coreSrc = read("core.js");
  if (coreSrc.indexOf("a.pose") < 0 || coreSrc.indexOf("a.flip") < 0) {
    fail("core.js 的 drawActor 没接剧情动作帧（pose）和翻转（flip）");
  }
  for (const range of ["carry: [43, 46]", "carry: [50, 53]", "carry: [56, 59]"]) {
    if (coreSrc.indexOf(range) < 0) fail(`core.js 缺少三人的抬箱帧段 ${range}`);
  }
  const carryShell = read("shell.js");
  for (const sheet of ["boy_sheet_act5.png", "girl_sheet_act5_carry.png",
                       "friend_sheet_act5_carry.png"]) {
    if (carryShell.indexOf(sheet) < 0) fail(`章节壳没有加载抬箱用的精灵表 ${sheet}`);
  }
  if (er.indexOf("Tab") < 0) fail("G01 没有 Tab 换人");
  const doneAt = (er.match(/host\.done\(/g) || []).length;
  if (doneAt !== 1) fail(`G01 有 ${doneAt} 个收尾点；做错只该重来，不该结束这一场`);
  for (const k of ["notice.misses++", "papers.misses++", "box.misses++"]) {
    if (er.indexOf(k) < 0) fail(`G01 少了一处「做错重来」的记录（${k}）`);
  }
  const htmlTags = read("daily.html");
  if (htmlTags.indexOf('id="erTags"') < 0) fail("daily.html 缺少 G01 换人条 #erTags");
  for (const who of ["girl", "friend", "boy"]) {
    if (htmlTags.indexOf('data-who="' + who + '"') < 0) fail(`G01 换人条缺少 ${who}`);
  }
  const cssTags = read("daily.css");
  if (cssTags.indexOf(".er-tags") < 0) fail("daily.css 没有换人条样式 .er-tags");

  // 1.4c G01 §3：重玩参数种子化 + 站位联动 + 抬箱走一段路。
  //      首通（游玩次 0）必须还是现行参数：材料 [2,3,1]、虚线框 y=88、
  //      推箱不镜像。重玩才洗牌，而且材料顺序不会和上一次一样。
  if (!/function planForRun\(/.test(er)) fail("G01 没有 planForRun()（本场第几次游玩 → 参数组）");
  if (!/function makeRnd\(/.test(er)) fail("G01 没有种子伪随机 makeRnd()");
  if (er.indexOf("D.games.errand.planForRun") < 0) fail("G01 没把 planForRun 暴露给自检");
  if (!/order:\s*\[2,\s*3,\s*1\]/.test(er)) fail("G01 首通材料顺序不是现行的 [2,3,1]");
  if (!/cys:\s*\[88,\s*76,\s*100\]/.test(er)) fail("G01 虚线框没有 3 个候选位（88/76/100）");
  if (er.indexOf("const BOX_MIRROR") < 0) fail("G01 没有镜像推箱路线 BOX_MIRROR");
  for (const k of ["errandRuns", "noticeLinkOn", "notice.jx", "carry.swayScale"]) {
    if (er.indexOf(k) < 0) fail(`G01 缺少联动 / 游玩次相关的「${k}」`);
  }
  for (const k of ["const WALK", "beginCarryWalk", "updateCarryWalk", "carry.bumps",
                   "carry.walkOn", "carry.lane", "carry.bumpedNpc"]) {
    if (er.indexOf(k) < 0) fail(`G01 抬箱走路那一段缺少「${k}」`);
  }
  // 碰到路人只是停一下，不记做错重来：走路段里不许出现 misses++
  {
    const walkBlock = er.slice(er.indexOf("function updateCarryWalk("),
                               er.indexOf("function updateCarry("));
    if (/carry\.misses\+\+/.test(walkBlock)) fail("G01 碰到路人被记成了失误（走路段不该有 misses++）");
    if (walkBlock.indexOf("carry.bumps++") < 0) fail("G01 走路段没有记录「碰到路人」的停顿");
  }
  // 联动只给正反馈：材料全对 / 推箱没回滚时才有加成，条件里不许反过来加难度
  if (er.indexOf("papers.misses === 0") < 0 || er.indexOf("box.misses === 0 ? 0.7 : 1") < 0) {
    fail("G01 的联动条件不是「全对 / 没回滚才加成」");
  }

  // 1.5 文案红线：不许出现好感度 / 提前点名「她喜欢谁」
  //     先把注释剥掉——代码里写着「不要存她有多喜欢你」这种注释是正常的
  const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const allText = scripts.map((f) => stripComments(read(f))).join("\n");
  const banned = ["好感度", "心动值", "认可度", "她喜欢的人是谁", "喜欢你"];
  for (const w of banned) {
    if (allText.indexOf(w) >= 0) fail(`文案里出现了「${w}」，设计稿第 5.11 / 8.3 节明确不要`);
  }

  // 1.6 由乃的台词不能占满全场（她不该每次都起哄、每次都说话）
  const lines = [...er.matchAll(/\["(旁白|我|朱里|由乃)",\s*"([^"]+)"\]/g)];
  const friendLines = lines.filter((m) => m[1] === "由乃").length;
  if (!lines.length) fail("没找到任何对白");
  else if (friendLines / lines.length > 0.5) {
    fail(`由乃说了 ${friendLines}/${lines.length} 句，超过一半，重心跑偏了`);
  }

  // 1.7 三种线索齐全，而且「猜的」那条必须在对话里说破——
  //     只在笔记本上贴个标签、嘴上却说得跟亲眼看见一样，等于没分开
  for (const k of ["see", "remember", "guess"]) {
    if (se.indexOf('kind: "' + k + '"') < 0) fail(`G02 里没有 ${k} 类线索`);
  }
  if (se.indexOf("这是猜的") < 0) fail("G02 里那条猜出来的线索，对话没有说破「这是猜的」");

  const pBlock = se.slice(se.indexOf("const POINTS = {"), se.indexOf("// 三级提示"));
  const points = (pBlock.match(/\bid:\s*"/g) || []).length;
  if (points < 6 || points > 8) fail(`G02 有 ${points} 个可看的东西，设计稿要求 6–8 个`);

  // 1.7b G02 解谜：平面图上的地点、每轮候选路线、每条线索钉在哪儿
  const spotBlock = se.slice(se.indexOf("const SPOTS = {"), se.indexOf("const FIRST_ROUTE ="));
  const spotIds = [...spotBlock.matchAll(/^\s{4}(\w+):\s*\{/gm)].map((m) => m[1]);
  if (spotIds.length < 6) fail(`G02 平面图只有 ${spotIds.length} 个地点，至少要 6 个`);
  // §4.1 四个候选落点：每个落点一条三站路线，路线里的地点都得在 SPOTS 里
  const spotDataBlock = se.slice(se.indexOf("const CARD_SPOTS = ["), se.indexOf("const SPOT_TEXT ="));
  if (!spotDataBlock) fail("G02 没有 CARD_SPOTS 候选落点表");
  const spotIdMs = [...spotDataBlock.matchAll(/id:\s*"(\w+)",\s*name:/g)].map((m) => m[1]);
  if (spotIdMs.length !== 4) fail(`G02 有 ${spotIdMs.length} 个候选落点，设计稿要求 4 个`);
  const routeMs = [...spotDataBlock.matchAll(/route:\s*\[([^\]]+)\]/g)].map((m) =>
    m[1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")));
  if (routeMs.length !== 4) fail(`G02 候选落点里有 ${routeMs.length} 条路线，应该 4 条`);
  routeMs.forEach((r, i) => {
    if (r.length !== 3) fail(`G02 第 ${i + 1} 个落点的路线有 ${r.length} 站，应该是 3 站`);
    r.forEach((id) => {
      if (spotIds.indexOf(id) < 0) fail(`G02 第 ${i + 1} 个落点路线里的「${id}」不在 SPOTS 里`);
    });
  });
  const route = routeMs[0] || [];          // 首通（游玩次 0）走的就是这一条
  if (route.length !== 3) fail(`G02 首通答案路线有 ${route.length} 站，应该是 3 站`);
  const tpMs = [...spotDataBlock.matchAll(/truePoints:\s*\[([^\]]*)\]/g)].map((m) =>
    m[1].split(",").map((s) => s.trim()).filter(Boolean));
  if (tpMs.length !== 4) fail(`G02 只有 ${tpMs.length} 个落点标了「哪四处产真线索」，应该 4 个`);
  tpMs.forEach((a, i) => {
    if (a.length !== 4) fail(`G02 第 ${i + 1} 个落点的真线索点有 ${a.length} 个，应该是 4 个`);
  });
  for (const k of ['dest:', 'variants:', 'answers:', 'confirms:', 'hint3:']) {
    const n = spotDataBlock.split(k).length - 1;
    if (n < 4) fail(`G02 候选落点的「${k}」只写了 ${n} 处，四个落点都要有`);
  }
  const orderM = se.match(/const SPOT_ORDER = \[([^\]]+)\]/);
  const spotOrder = orderM ? orderM[1].split(",").map((s) => Number(s.trim())) : [];
  if (spotOrder.length !== 4) fail("G02 没有 4 个落点的轮换顺序 SPOT_ORDER");
  else if (spotOrder[0] !== 0) fail("G02 首通没轮到楼梯口窗台（SPOT_ORDER[0] 应该是 0）");
  // §4.2 问人：每人 3 个问题、ask 是第四类线索，关键问题能换印证版
  const askBlock = se.slice(se.indexOf("const ASK = {"), se.indexOf("const ASK_NAME"));
  const askCounts = ["girl", "friend"].map((who) => {
    const m = askBlock.match(new RegExp(who + ":\\s*\\[([\\s\\S]*?)\\]"));
    return m ? (m[1].match(/"/g) || []).length / 2 : 0;
  });
  askCounts.forEach((n, i) => {
    if (n !== 3) fail(`G02 问人：${i === 0 ? "朱里" : "由乃"}有 ${n} 个问题，应该是 3 个`);
  });
  if (se.indexOf('kind: "ask"') < 0) fail("G02 没有第四类线索 kind: \"ask\"");
  for (const k of ["function askQuestion(", "function renderAsk(", "function openAsk(",
                   "function applyConfirm(", "round.confirms", "askBox", "searchRuns",
                   "function makeRnd(", "function spotIndexForRun(",
                   "function roundInfo(", "function stepVerdict(", "D.games.search.roundInfo"]) {
    if (se.indexOf(k) < 0) fail(`G02 缺少问人 / 候选落点 / 步数相关的「${k}」`);
  }
  if (se.indexOf("steps += 1") < 0) fail("G02 没有记录跨场景步数");
  // §4.3 收尾评价只改措辞：stepVerdict 的两句口径必须都在，且不进存档
  if (se.indexOf("你心里有谱") < 0 || se.indexOf("腿都跑细了") < 0) {
    fail("G02 收尾缺少「少步数 / 多步数」两种评价口径");
  }
  const closeBlock = se.slice(se.indexOf("function closing()"), se.indexOf("// ---------------------------------------------------------------- 换场景"));
  if (closeBlock.indexOf("stepVerdict(steps)") < 0) fail("G02 收尾没有按步数加评价");
  if (/D\.persist\([^)]*steps/.test(se)) fail("G02 把步数写进了存档（只该影响措辞）");
  const pins = [...se.matchAll(/pin:\s*"(\w+)"/g)].map((m) => m[1]);
  if (pins.length < 6) fail(`G02 只有 ${pins.length} 条线索标了地点，地图上没得钉`);
  pins.forEach((id) => {
    if (spotIds.indexOf(id) < 0) fail(`G02 有线索钉到了不存在的地点「${id}」`);
  });
  // 首通那条「我猜的」必须指向首通路线之外，不然去掉它路线也不会变
  const gAt = se.indexOf('kind: "guess"');
  const gPin = gAt < 0 ? null : (se.slice(gAt, gAt + 260).match(/pin:\s*"(\w+)"/) || [])[1];
  if (!gPin) fail("G02「我猜的」那条线索没有属地，谜题的核心就没了");
  else if (route.indexOf(gPin) >= 0) fail(`G02「我猜的」那条钉在「${gPin}」，可它就在答案路线上`);
  if (se.indexOf("function verifyRoute") < 0) fail("G02 没有 verifyRoute()，拼完路线没人判定");
  if (se.indexOf("pins[i] !== ROUTE[i]") < 0) fail("G02 的 verifyRoute() 只比集合不比顺序，路线就只是选点");
  if (se.indexOf('className = "ord"') < 0) fail("G02 钉上的站没有先后编号");
  if (se.indexOf('classList.toggle("drawing"') < 0) fail("G02 钉站的时候没有把玩家画的线露出来");
  if (se.indexOf("function availableClues") < 0) fail("G02 钉地点之前没有挑证据的步骤");
  if (se.indexOf("c.pin !== id") < 0) fail("G02 挑证据时没有校验这句线索属于那个地点");
  if (se.indexOf("searchRouteSolved") < 0) fail("G02 没有 searchRouteSolved 存档位");
  const htmlSrc = read("daily.html");
  for (const id of ["map", "mapWrap", "mapRoute", "mapCheck", "mapClose", "mapSaid",
                    "mapPick", "mapPickList", "mapPickLead", "mapPickClose", "nbMap"]) {
    if (htmlSrc.indexOf('id="' + id + '"') < 0) fail(`daily.html 里缺少 #${id}`);
  }
  const mapPng = path.join(ROOT, "assets/minigame/map_floor2.png");
  if (!fs.existsSync(mapPng)) fail("缺少 assets/minigame/map_floor2.png");
  else {
    const b = fs.readFileSync(mapPng);
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    if (w !== 256 || h !== 160) fail(`map_floor2.png 是 ${w}×${h}，面板坐标按 256×160 写的`);
  }

  // 1.8 由乃在 G02 里人不在场（她在教室门口等她），只发消息，不该抢戏
  const seLines = [...se.matchAll(/\["(旁白|我|朱里|由乃)",\s*"([^"]+)"\]/g)];
  const seFriend = seLines.filter((m) => m[1] === "由乃").length;
  if (!seLines.length) fail("G02 没有对白");
  else if (seFriend / seLines.length > 0.34) {
    fail(`G02 里由乃说了 ${seFriend}/${seLines.length} 句，她人不在场，不该这么多`);
  }

  // 1.9 G04 体育活动：俯视 2.5D 球场，玩家一个人对由乃和朱里，先进三个球
  //     纵深跑位、抢断圈上/下博弈、蓄力时 A/D 转角度 + W/S 调高度；比分只活在这一场里。
  const bg = read("ball.js");
  if (!/goalsToWin:\s*3\b/.test(bg)) fail("G04 的终局条件不是「先进三个球」");
  if (/CFG\.target|target:\s*9\b/.test(bg)) fail("G04 还留着旧的「传接 9 次」目标");
  for (const k of ["playerSpeed", "yunoSpeed", "jurieSpeed", "feintWindow", "stumble", "tackleRange"]) {
    if (bg.indexOf(k + ":") < 0) fail(`G04 缺少 ${k} 这项判定`);
  }
  if (!/playerSpeed:\s*96\b/.test(bg) || !/yunoSpeed:\s*70\b/.test(bg)) {
    fail("G04 的跑速不是玩家 96 / 由乃 70");
  }
  if (!/jurieSpeed:\s*58\b/.test(bg)) fail("G04 朱里不是玩家 0.6 倍速（58 / 96）");
  // 俯视梯形：远近两端的宽度和屏幕位置决定纵深，缺一个人物就不会按远近缩放
  for (const k of ["nearY:", "farY:", "nearW:", "farW:"]) {
    if (bg.indexOf(k) < 0) fail(`G04 缺少俯视球场的 ${k}`);
  }
  for (const fn of ["sxAt", "syAt", "scaleAt"]) {
    if (bg.indexOf("function " + fn) < 0) fail(`G04 缺少 ${fn} 这条纵深投影`);
  }
  if (bg.indexOf("D.axisY()") < 0) fail("G04 没有读 W / S 的纵深轴");
  for (const k of ["aimAng", "aimX", "aimZ", "aimRateA", "aimRateZ"]) {
    if (bg.indexOf(k) < 0) fail(`G04 的射门方向缺少 ${k}`);
  }
  if (bg.indexOf("function aimXFor(") < 0 || bg.indexOf("function aimAngFor(") < 0) {
    fail("G04 的 A/D 没有把角度换算成门线落点");
  }
  // 电脑抢断要有一拍抬手，不能贴上来就立刻得手；开球也要给玩家留距离
  if (bg.indexOf("function updateAiSteal(") < 0) fail("G04 的电脑抢断没有抬手判定");
  if (!/aiStealWindup:\s*0\.\d+/.test(bg)) fail("G04 的电脑抢断没有抬手时间");
  if (!/aiStealRange:\s*\d+/.test(bg)) fail("G04 的电脑抢断没有距离上限");
  // §6.4 开球改成有纵深的阵型：中路不再是一条空道
  if (!/place\("me",\s*0\.50,\s*0\.30/.test(bg)) fail("G04 玩家开球的站位不是新的纵深阵型（0.50, 0.30）");
  if (!/place\("yuno",\s*0\.56,\s*0\.55/.test(bg)) fail("G04 开球时由乃不在上抢位（0.56, 0.55）");
  if (!/place\("jurie",\s*0\.44,\s*0\.80/.test(bg)) fail("G04 开球时朱里不在守线位（0.44, 0.80）");
  // 抢断圈：靠近持球人后开圈，护上/护下，玩家用 W / S 打另一边
  for (const fn of ["startDuel", "resolveDuel", "updateDuel"]) {
    if (bg.indexOf("function " + fn + "(") < 0) fail(`G04 缺少抢断圈的 ${fn}()`);
  }
  if (bg.indexOf("duel.guard") < 0) fail("G04 的抢断圈没有护上/护下的判定");
  for (const w of ["W · 上", "S · 下"]) {
    if (bg.indexOf(w) < 0) fail(`G04 的抢断圈没有画出「${w}」`);
  }
  if (bg.indexOf("duelFails") < 0) fail("G04 抢断圈打错边没有反馈统计");
  if (bg.indexOf("startFeint") < 0 || bg.indexOf("feintT") < 0) fail("G04 由乃没有假动作状态");
  if (bg.indexOf("stumbleT = CFG.stumble") < 0) fail("G04 在假动作窗口里抢断没有「被晃」的后果");
  if (bg.indexOf("scoreThem >= 2") < 0) fail("G04 由乃赢到两球后没有改给朱里做球");
  if (bg.indexOf('passTo("jurie"') < 0) fail("G04 朱里没有接球/做球的路线");
  if (bg.indexOf("airKicks") < 0) fail("G04 朱里没有「踢空」这条反馈");
  // 1.9b §6 改造：防守分工、守门、触球、开球保护、射门三把锁、比分起伏。
  //       这些参数是设计文档第六节逐项落位的，缺一个对应的手感就不成立。
  for (const k of ["roleHysteresis", "pressLead", "pressLeadAhead", "coverDepth",
                   "keeperTriggerD", "keeperLag", "keeperErr", "keeperErrLead",
                   "keeperReach", "keeperLowZ", "keeperBiasTrail",
                   "touchFollow", "turnSlip", "dashDepth", "dashCd",
                   "kickoffProtect", "spreadBase", "spreadPower", "spreadPressure",
                   "pressureRange", "postTol"]) {
    if (bg.indexOf(k + ":") < 0) fail(`G04 §6 缺少参数 ${k}`);
  }
  if (!/dribbleSpeed:\s*0\.78\b/.test(bg)) fail("G04 §6.3 带球速度系数不是 0.78");
  if (!/pressLead:\s*0\.35\b/.test(bg) || !/pressLeadAhead:\s*0\.45\b/.test(bg)) {
    fail("G04 §6.1/6.6 上抢提前量不是 0.35 / 领先时 0.45");
  }
  if (!/keeperLag:\s*0\.12\b/.test(bg) || !/keeperReach:\s*0\.11\b/.test(bg)) {
    fail("G04 §6.2 守门的反应延迟 / 扑程不是 120ms / 0.11");
  }
  if (!/postTol:\s*0\.008\b/.test(bg)) fail("G04 §6.5 门柱判定不是 0.008");
  if (!/goalX:\s*\[0\.355,\s*0\.645\]/.test(bg)) fail("G04 的球门宽度被改了（不做清单：不缩小球门）");
  for (const fn of ["updateRoles", "pressSpot", "coverSpot", "updateKeeperAI",
                    "keeperInfo", "updateTouch", "tryDash",
                    "spreadLanding", "shotSpread", "drawSpreadFan"]) {
    if (bg.indexOf("function " + fn + "(") < 0) fail(`G04 §6 缺少 ${fn}()`);
  }
  if (bg.indexOf("roles.press") < 0 || bg.indexOf("roles.cover") < 0) {
    fail("G04 §6.1 没有把上抢 / 守线分工写进 roles");
  }
  if (bg.indexOf("keeperOn") < 0 || bg.indexOf("keeperLunge") < 0) fail("G04 §6.2 没有守门状态与横扑");
  // giveBall 得区分来源：只有抢断才有 2.2/2.4 秒保护，开球只留 0.6 秒
  if (!/function giveBall\(who,\s*src\)/.test(bg)) fail("G04 §6.4 giveBall 没有来源参数");
  for (const w of ['from === "steal"', 'from === "kickoff"', "CFG.kickoffProtect"]) {
    if (bg.indexOf(w) < 0) fail(`G04 §6.4 开球 / 抢断保护没有按来源区分（缺 ${w}）`);
  }
  if (bg.indexOf('goalSide === "me" ? "yuno" : "me"') < 0) {
    fail("G04 §6.4 进球后没有让失球方开球");
  }
  // §6.8 确定性自检入口：固定步进、无渲染，正常对战仍走 rAF
  for (const w of ["window.__ball", "testRoute", "testKeeper", "testTouch", "testDash",
                   "testSpread", "testScore", "simMode", "simSnap", "__simTackle", "__simDuel"]) {
    if (bg.indexOf(w) < 0) fail(`G04 §6.8 缺少确定性测试入口 ${w}`);
  }
  // 不做清单：act5 不加失败态
  if (/gameOver|Game Over|YOU LOSE/.test(bg)) fail("G04 加了失败态");
  // §6.6 比分起伏是隐性平衡：不许出现提示文本（注释里说明设计意图不算）
  {
    const bgCode = stripComments(bg);
    if (bgCode.indexOf("领先") >= 0 || bgCode.indexOf("落后") >= 0) {
      fail("G04 把「领先 / 落后」写进了场上文本，隐性平衡不该说破");
    }
  }

  // 比分不许写进存档，也不许漏进结果卡
  const persists = [...bg.matchAll(/D\.persist\(([^)]*)\)/g)].map((m) => m[1]);
  if (!persists.length) fail("G04 结束时没有写 ballGameCompleted");
  persists.forEach((p) => {
    if (p.indexOf("ballGameCompleted") < 0) fail("G04 的存档里写了别的东西：" + p.trim());
    if (/score|goal|win|lose/i.test(p)) fail("G04 把比分/胜负写进了存档：" + p.trim());
  });
  if (bg.indexOf("localStorage") >= 0) fail("G04 直接碰了 localStorage");
  const shellSrc = read("shell.js");
  if (shellSrc.indexOf("scoreMe") >= 0 || shellSrc.indexOf("scoreThem") >= 0) {
    fail("G04 的比分漏进了章节壳/结果卡");
  }
  // HUD 只留记分牌和一颗按钮
  if (htmlSrc.indexOf('id="bgBoard"') < 0) fail("daily.html 里没有 #bgBoard 记分牌");
  for (const gone of ["bgCount", "bgToGirl", "bgToFriend", "bg-pick"]) {
    if (htmlSrc.indexOf(gone) >= 0) fail(`daily.html 里还留着旧的 G04 控件「${gone}」`);
  }
  const hudStart = htmlSrc.indexOf('id="bgHud"');
  const hudEnd = htmlSrc.indexOf('id="bgCtl"', hudStart);
  const hudBlock = hudStart < 0 ? "" : htmlSrc.slice(hudStart, hudEnd < 0 ? hudStart + 900 : hudEnd);
  if (hudBlock.indexOf('id="bgBoard"') < 0) fail("记分牌不在 #bgHud 里，比分就会跑到画面别处");
  if (hudBlock.indexOf("她们") < 0) fail("记分牌没有右侧的「她们」标签");
  for (const w of ["传接", "传球"]) {
    if (bg.indexOf(w) >= 0) fail(`G04 里还留着旧的「${w}」说法`);
  }
  for (const w of ["好球", "太棒", "干得漂亮"]) {
    if (bg.indexOf(w) >= 0) fail(`G04 出现了庆祝用词「${w}」，这场收尾不庆祝`);
  }
  const mgDir = path.join(ROOT, "assets/minigame");
  for (let a = 0; a <= 3; a++) {
    for (let b = 0; b <= 3; b++) {
      if (!fs.existsSync(path.join(mgDir, `scoreboard_${a}_${b}.png`))) {
        fail(`缺少记分牌 scoreboard_${a}_${b}.png`);
      }
    }
  }
  // 俯视球场是程序画的，只留球本身这张精灵表
  {
    const f = "ball_sheet.png";
    const p = path.join(mgDir, f);
    if (!fs.existsSync(p)) fail("缺少 assets/minigame/" + f);
    else {
      const b = fs.readFileSync(p);
      if (b.readUInt32BE(16) !== 64 || b.readUInt32BE(20) !== 16) {
        fail(`assets/minigame/${f} 是 ${b.readUInt32BE(16)}×${b.readUInt32BE(20)}，代码按 64×16 画的`);
      }
    }
  }

  // 1.10 章节壳必须在 host.done() 时收掉小游戏自己的面板 / HUD
  if (read("shell.js").indexOf("game.dispose") < 0) {
    fail("章节壳没有调用 dispose()，退回目录后 G04 的 HUD 会一直挂着");
  }

  // 1.11 角色显示名统一为「由乃」，不许再把「闺蜜」写进对白 / 按钮 / 注释
  const nameSources = ["daily.html", "daily.css", "core.js", "trio.js", "errand.js",
                       "search.js", "wordgame.js", "ball.js", "shell.js"]
    .map((f) => read(f)).join("\n");
  if (nameSources.indexOf("闺蜜") >= 0) fail("游戏内还留着「闺蜜」当显示名，这个角色现在叫由乃");
  if (nameSources.indexOf('["由乃"') < 0 && nameSources.indexOf("由乃") < 0) {
    fail("找不到由乃这个名字");
  }

  // 1.12 三人同行不许再用 boy.dir 直接翻转跟随位，也不许两人对推
  const trioSrc = read("trio.js");
  if (trioSrc.indexOf("boy.x - boy.dir * cfg.slots") >= 0) {
    fail("三人同行又用回「目标位随朝向瞬间翻转」的写法了，会重现躲着主角走");
  }
  if (trioSrc.indexOf("crossing") < 0 || trioSrc.indexOf("lagRatio") < 0) {
    fail("三人同行缺少「不横穿主角 / 慢半拍同向跟着」的保护");
  }

  // 1.13 共用互动层：四个游戏都能主动发起，短反应不弹对白框、不冻结走位。
  //      「更有互动性」这条需求的落脚点是「玩家自己能起个头 + 角色马上回应」，
  //      如果把回应做成 D.lines()，就又变回「走到点按 E 读一段」了。
  const core = read("core.js");
  for (const api of ["D.react =", "D.clearReact =", "D.onPoke =", "D.poke =",
                     "D.reactHint =", "D.reactStats ="]) {
    if (core.indexOf(api) < 0) fail(`core.js 缺少 ${api}`);
  }
  const shell = read("shell.js");
  if (shell.indexOf("D.poke()") < 0 || shell.indexOf('key.toLowerCase() === "f"') < 0) {
    fail("章节壳没有把 F 统一路由到 D.poke()");
  }
  const html = read("daily.html");
  for (const id of ["react", "reactBtn", "wgSwap", "giveBack"]) {
    if (html.indexOf('id="' + id + '"') < 0) fail(`daily.html 缺少 #${id}`);
  }
  const reactBlock = core.slice(core.indexOf("D.initReact ="),
                                core.indexOf("// ---------------------------------------------------------------- 小工具"));
  if (/D\.lines\s*\(/.test(reactBlock) || /freeze\s*\(/.test(reactBlock)) {
    fail("D.react 弹了完整对白框或冻结了走位，短反应必须是「说完就散」");
  }
  if (reactBlock.indexOf("dialog:start") < 0 && reactBlock.indexOf("dlg") < 0) {
    fail("D.react 没有避开对白系统，会和正在读的对白抢 E");
  }

  // 1.14 四个游戏都得注册 / 清理 / 给胶囊换文案 / 换场时清干净。
  //      漏了 dispose 里的 onPoke(null)，从 G01 退回目录再进 G02 按 F 会串场。
  const gameFiles = ["errand.js", "search.js", "wordgame.js", "ball.js"];
  for (const f of gameFiles) {
    const src = read(f);
    if (src.indexOf("D.onPoke(") < 0) fail(`${f} 没有注册主动发起`);
    if (src.indexOf("D.onPoke(null)") < 0) fail(`${f} 的 dispose 没清掉 onPoke，会串到下一场`);
    if (src.indexOf("D.react(") < 0) fail(`${f} 没有任何即时反应`);
    if (src.indexOf("D.reactHint(") < 0) fail(`${f} 没给左下角胶囊换文案`);
    if (src.indexOf("D.clearReact()") < 0) fail(`${f} 换场 / 收尾时没清短反应`);
  }

  // 1.15 G02 的「自言自语」不能吃掉「问问由乃」那三级提示的次数。
  //      这两件事看起来像，做混了就会变成按 F 白嫖提示。
  const pokeSe = stripComments(se.slice(se.indexOf("function poke()"),
                                        se.indexOf("/** 找到卡之后")));
  if (pokeSe.indexOf("hints") >= 0 || pokeSe.indexOf("toast(") >= 0 ||
      pokeSe.indexOf("askFriend") >= 0) {
    fail("G02 的 F 自言自语动到了三级提示的次数 / 消息条");
  }
  const giveBlock = stripComments(se.slice(se.indexOf("function chooseReturn()"),
                                           se.indexOf("// ---------------------------------------------------------------- 看东西")));
  if (giveBlock.indexOf("finish(-1)") < 0 || giveBlock.indexOf("setTimeout") < 0) {
    fail("G02「怎么还给她」没有超时放行，不选就会拦关");
  }
  if (se.indexOf("returnChoice") < 0) fail("G02 没有把「怎么还」的选择记下来");

  // 1.16 G03「换你出题」是插曲：不计分、不写存档、不改结局。
  const swapBlock = stripComments(wg.slice(wg.indexOf("function swapRound()"),
                                           wg.indexOf("function submitText()")));
  if (swapBlock.indexOf('state = "swap"') < 0) fail("G03 没有「换你出题」这一段");
  if (/correct|hints|D\.persist|wordGame/.test(swapBlock)) {
    fail("G03 的「换你出题」动了成绩或存档，插曲不该变成第四题");
  }

  // 1.17 G04 的 F 是纯互动：只让场上有人接话，不改球权、不改比分。
  //      这一场真正的玩法是带球/射门/抢断，F 不该再偷偷改球路。
  const callBlock = bg.slice(bg.indexOf("function callOut()"), bg.indexOf("function spaceHeld()"));
  if (bg.indexOf("function callOut()") < 0 || callBlock.indexOf("calls++") < 0) {
    fail("G04 的 F 没有接住玩家主动发起");
  }
  if (/ball\.owner\s*=(?!=)|score(Me|Them)\s*[+\-]?=(?!=)|D\.persist/.test(callBlock)) {
    fail("G04 的 F 改到了球权或比分，它应该只是让人接话");
  }

  // 1.18 校园自由走动壳：默认进来是手动走动（auto!==1），事件由走到对应区域按 E 触发，
  //      目录只在 ?hub=1 时压出来；全部做完直接跳 narrative 收尾。
  if (!/MANUAL_HUB\s*=\s*new URLSearchParams\(location\.search\)\.get\("auto"\)\s*!==\s*"1"/.test(shell)) {
    fail("shell.js 的默认模式不是手动自由走动（auto=1 才是自动时间线）");
  }
  if (shell.indexOf("new CampusRoute(") < 0) fail("shell.js 没有用 CampusRoute 做跨场景走动");
  for (const token of ["eventArea", "campusTargets", "nearCampusTarget", "campusNarration"]) {
    if (shell.indexOf(token) < 0) fail(`shell.js 缺少自由走动结构 ${token}`);
  }
  if (shell.indexOf("narrative/index.html?phase=after") < 0) {
    fail("shell.js 全部日常做完后没有跳 narrative 收尾");
  }
  const campusFile = path.join(ROOT, "shared/campus-route.js");
  if (!fs.existsSync(campusFile)) fail("缺少 shared/campus-route.js");
  else {
    const cr = fs.readFileSync(campusFile, "utf8");
    if (/^\s*(import|export)\s/m.test(cr)) fail("campus-route.js 用了 ES module 语法，file:// 下会挂");
    if (cr.indexOf("window.CampusRoute") < 0) fail("campus-route.js 没有挂 window.CampusRoute");
  }
  if (html.indexOf("../shared/campus-route.js") < 0) fail("daily.html 没有引 shared/campus-route.js");
  for (const id of ["campusNarration", "hubStart", "hubReset", "afterStoryHub"]) {
    if (html.indexOf('id="' + id + '"') < 0) fail(`daily.html 缺少 #${id}`);
  }

  ok(`静态：男 ${frames.boy} / 女 ${frames.girl} / 由乃 ${frames.friend} 帧、题库 ${answers.length} 题、` +
     `场景 G01 ${Object.keys(scenes).length} 个（一个场景 + 三个站位）/ G02 ${Object.keys(searchScenes).length} 个、` +
     `G01 三个可重来的操作、` +
     `G02 可看点 ${points} 处、对白 ${lines.length + seLines.length} 句（由乃 ${friendLines + seFriend} 句）、` +
     `G04 俯视 2.5D 三球终局 / 抢断圈上·下博弈 / 蓄力 A·D 角度 + W·S 高度 / 电脑抢断有抬手 / 朱里 0.6 倍速、` +
     `四场都接了 F 主动发起与短反应`);
}

// ---------------------------------------------------------------- 2. 浏览器

const S = (page) => page.evaluate(() => {
  const g = window.__daily.current;
  const px = g ? (g.trio ? g.trio.boy.x : g.x) : null;
  return {
    has: !!g,
    state: g && g.state,
    scene: g && g.scene,
    boy: px == null ? null : px,
    py: g && g.y != null ? g.y : (g && g.trio ? g.trio.boy.y : null),
    girl: g && g.trio ? g.trio.girl.x : null,
    fr: g && g.trio ? g.trio.friend.x : null,
    soloTarget: g && g.target ? { x: g.target.x, y: g.target.y } : null,
    soloNear: g && g.near,
    soloChoice: !document.getElementById("soloChoice").hidden,
    // G01 三个站位 / 三件可重来的操作
    active: g && g.active,
    noticeDone: g && g.noticeDone,
    noticeMisses: g && g.noticeMisses,
    noticeT: g && g.noticeT,
    noticeBand: g && g.noticeBand ? g.noticeBand.slice() : null,
    paperOrder: g && g.paperOrder ? g.paperOrder.slice() : null,
    paperSel: g && g.paperSel,
    paperPicked: g && g.paperPicked,
    paperDone: g && g.paperDone,
    paperMisses: g && g.paperMisses,
    alpha: g && g.trio && g.active ? {
      girl: g.trio.girl.alpha, friend: g.trio.friend.alpha, boy: g.trio.boy.alpha
    } : null,
    boxX: g && g.boxX,
    boxLifted: g && g.boxLifted,
    boxDone: g && g.boxDone,
    boxMisses: g && g.boxMisses,
    boxDrop: g && g.boxDrop ? g.boxDrop.slice() : null,
    boxThr: g && g.boxThr,
    carry: g && g.carry,
    dlg: window.DAILY.dialogOpen(),
    hint: document.getElementById("hint").classList.contains("show")
      ? document.getElementById("hint").textContent : null,
    obj: document.getElementById("obj").classList.contains("show")
      ? document.getElementById("objSub").textContent : null,
    objTitle: document.getElementById("obj").classList.contains("show")
      ? document.querySelector("#obj b").textContent : null
  };
});

/** 等一会儿，如果这期间弹出了对白（换场景的 onEnter 要等淡入结束才出来），把它读完。 */
async function settle(page, ms = 1600) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(() => window.DAILY.dialogOpen())) {
      await advanceAll(page);
      return true;
    }
    await page.waitForTimeout(90);
  }
  return false;
}

async function advanceAll(page, max = 60) {
  for (let i = 0; i < max; i++) {
    const d = await page.evaluate(() => window.DAILY.dialogOpen());
    if (!d) return true;
    await page.keyboard.press("KeyE");
    await page.waitForTimeout(80);
  }
  return false;
}

/** 按住方向键，直到场景变了 / 弹出对白 / 到目标 x。 */
async function walk(page, key, opt = {}) {
  const start = await S(page);
  await page.keyboard.down(key);
  const t0 = Date.now();
  let out = start;
  while (Date.now() - t0 < (opt.timeout || 15000)) {
    out = await S(page);
    if (out.dlg) break;
    if (opt.untilScene && out.scene !== start.scene) break;
    if (opt.untilX != null && Math.abs(out.boy - opt.untilX) < 8) break;
    await page.waitForTimeout(50);
  }
  await page.keyboard.up(key);
  return out;
}

/** 走到本场景里的某个 x。方向自己判断，被打断就补一次。
 *
 *  必须这么写的原因：换场景之后那句旁白不是立刻弹出来的（要等淡入结束），
 *  而 settle 只等 1.6 秒。旁白要是晚到，人物就被冻在原地，
 *  walk 第一圈就看见 dlg 直接退出，位置一步没动，后面的断言全部对不上。 */
async function approach(page, targetX, timeout = 14000) {
  for (let i = 0; i < 6; i++) {
    if ((await S(page)).dlg) await settle(page);
    const a = await S(page);
    if (a.boy == null) return a;
    if (Math.abs(a.boy - targetX) < 10) return a;
    const b = await walk(page, a.boy < targetX ? "KeyD" : "KeyA", { untilX: targetX, timeout });
    if (b.scene !== a.scene) return b;
    if (Math.abs(b.boy - targetX) < 10) return b;
    // 一步都没挪：多半是换场景那句旁白正好在 keydown 之后才弹，
    // walk 第一圈看见 dlg 就退出了。等它浮出来读完，再重按一次。
    if (Math.abs(b.boy - a.boy) < 2) await page.waitForTimeout(220);
  }
  return await S(page);
}

/** 走到指定场景，走不到就再试两次。每次重试前先把挡路的对白读完——
 *  换场景那句旁白要等淡入结束才弹，撞上它人物就动不了。 */
async function ensureScene(page, want, key, ms = 16000) {
  for (let i = 0; i < 3; i++) {
    if ((await S(page)).dlg) await settle(page);
    const a = await S(page);
    if (a.scene === want) return a;
    await walk(page, key, { untilScene: true, timeout: ms });
    await settle(page);
    await page.waitForTimeout(220);
  }
  const s = await S(page);
  if (s.scene !== want) fail(`应该走到 ${want}，实际在 ${s.scene}`);
  return s;
}

/** 等提示条出现并且写的是某段字。提示每帧都在刷，但可能被对白挡住，
 *  所以给它一点时间，而不是 sleep 一下就看。 */
async function waitHint(page, text, ms = 6000) {
  await page.waitForFunction(function (want) {
    const h = document.getElementById("hint");
    return h.classList.contains("show") && h.textContent.indexOf(want) >= 0;
  }, text, { timeout: ms }).catch(function () { /* 交给调用方报错 */ });
  const s = await S(page);
  if (!s.hint || s.hint.indexOf(text) < 0) fail(`提示条应该是「${text}」，实际是「${s.hint}」`);
  return s;
}

/** 两个绝对定位的元素不许互相压住。新加的 F 胶囊和短反应条盖在画面上，
 *  最容易挡住猜词输入框、线索本按钮、球赛的触控球。 */
async function noOverlap(page, a, b, label) {
  const hit = await page.evaluate(function (sels) {
    const A = document.querySelector(sels[0]), B = document.querySelector(sels[1]);
    if (!A || !B || A.hidden || B.hidden) return false;
    const x = A.getBoundingClientRect(), y = B.getBoundingClientRect();
    return !(x.right <= y.left || x.left >= y.right || x.bottom <= y.top || x.top >= y.bottom);
  }, [a, b]);
  if (hit) fail(`${label}：${a} 压住了 ${b}`);
}

/** 按 F 主动发起：出「我一句 + 她一句」的短反应、胶囊文案对、
 *  不开对白框、不改游戏状态。这是「更有互动性」最核心的一条——
 *  不能又变成弹一段对白让人读完。
 *
 *  expect 是「必听到的台词组」，每组给几个候选（球在谁脚下决定喊哪句）。
 *  短反应是排队的：上一条（掉头 / 站久了的自言自语）还没散时，
 *  新的一来一回会排在后面，所以不能要求按下后 200ms 内就冒出来。 */
async function pokeOnce(page, label, id, key, want, expect) {
  const snap = (k) => page.evaluate(function (kk) {
    const g = window.__daily.current;
    const btn = document.getElementById("reactBtn");
    return {
      id: g && g.id, state: g && g.state, count: g && g[kk],
      btn: btn.hidden ? null : btn.textContent,
      reacts: window.DAILY.reactStats().count,
      dlg: window.DAILY.dialogOpen()
    };
  }, k);

  const before = await snap(key);
  if (before.id !== id) { fail(`${label}：当前不是 ${id}，是 ${before.id}`); return; }
  if (!before.btn || before.btn.indexOf("F") < 0) {
    fail(`${label}：左下角没有 F 提示（${before.btn}）`);
  }
  if (want && before.btn.indexOf(want) < 0) {
    fail(`${label}：胶囊写的是「${before.btn}」，应该含「${want}」`);
  }
  const log0 = await page.evaluate(() => window.__reactLog.length);
  await page.keyboard.press("KeyF");
  let fresh = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 6500) {
    await page.waitForTimeout(160);
    fresh = (await page.evaluate(() => window.__reactLog.slice())).slice(log0);
    if (expect.every((group) => group.some((t) => fresh.some((x) => x.indexOf(t) >= 0)))) break;
  }
  for (const group of expect) {
    if (!group.some((t) => fresh.some((x) => x.indexOf(t) >= 0))) {
      fail(`${label}：按 F 之后没听到「${group.join(" / ")}」（实际：${fresh.join("、") || "无"}）`);
    }
  }
  const after = await snap(key);
  if (after.count !== before.count + 1) {
    fail(`${label}：按 F 之后 ${key} 是 ${before.count} → ${after.count}，没接住这次主动发起`);
  }
  if (after.reacts <= before.reacts) fail(`${label}：按 F 之后没有出现短反应`);
  if (after.dlg) fail(`${label}：按 F 弹出了完整对白框`);
  if (after.state !== before.state &&
      !(label === "G04" && before.state === "play" && after.state === "goalPause")) {
    fail(`${label}：按 F 把状态从 ${before.state} 改成了 ${after.state}`);
  }
  return after;
}

/** 等到「怎么还给她」这块出现；这段时间里对白还要照常用 E 读完。 */
async function drainToGiveBack(page, ms = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const st = await page.evaluate(() => ({
      box: !document.getElementById("giveBack").hidden,
      dlg: window.DAILY.dialogOpen()
    }));
    if (st.box) return true;
    if (st.dlg) await page.keyboard.press("KeyE");
    await page.waitForTimeout(100);
  }
  return false;
}

// ---------------------------------------------------------------- 校园壳导航

/** 读目录 / 自由走动壳的状态。新目录的 li 没有点击事件，
 *  事件只能靠「走到区域按 E」、hubStart（贴近时可点）或 __daily.play 进。 */
const hubState = (page) => page.evaluate(() => {
  const items = [...document.querySelectorAll("#hubList li")].map((li) => ({
    id: li.dataset.id, cls: li.className,
    day: li.querySelector(".day").textContent,
    name: li.querySelector(".name").textContent,
    tag: li.querySelector(".tag").textContent
  }));
  const start = document.getElementById("hubStart");
  return {
    chapter: document.getElementById("chapter").textContent,
    narration: document.getElementById("campusNarration").hidden
      ? null : document.getElementById("campusNarration").textContent,
    hubHidden: document.getElementById("hub").hidden,
    hubShow: document.getElementById("hub").classList.contains("show"),
    startDisabled: start.disabled,
    startText: start.textContent,
    items: items,
    playable: items.filter((i) => i.cls === "playable").length,
    locked: items.filter((i) => i.cls === "locked").length,
    done: items.filter((i) => i.cls === "done").length,
    afterStoryHub: !document.getElementById("afterStoryHub").hidden,
    over: !window.__daily.current && !window.__daily.busy
  };
});

/** 用调试口进事件（等价于走到区域按 E）。等小游戏真正挂上来。
 *  注意：play() 返回的是整场演完才 resolve 的 Promise，evaluate 不能把它 return 出去，
 *  否则 Playwright 会一直等这场演完——而这场正等着脚本操作，死锁。 */
async function startEvent(page, playId, gameId, ms = 12000) {
  await page.evaluate((id) => { window.__daily.play(id); }, playId);
  await page.waitForFunction((want) => {
    const g = window.__daily.current;
    return !!g && g.id === want;
  }, gameId, { timeout: ms }).catch(() => {});
  const id = await page.evaluate(() => {
    const g = window.__daily.current;
    return g ? g.id : null;
  });
  if (id !== gameId) fail(`__daily.play("${playId}") 进的不是 ${gameId}，是 ${id}`);
  return id === gameId;
}

/** 等一场事件彻底结束：小游戏释放 + 壳的淡出 / 日期卡都走完（busy 落回 false）。 */
async function waitEventOver(page, ms = 25000) {
  await page.waitForFunction(() => !window.__daily.current && !window.__daily.busy,
    null, { timeout: ms }).catch(() => {});
  return page.evaluate(() => !window.__daily.current && !window.__daily.busy);
}

/** 用 E 把结尾对白读完，直到事件彻底结束。collect 传入数组时顺手记下每句「谁：台词」。 */
async function drainToEnd(page, ms = 25000, collect = null) {
  const t0 = Date.now();
  let lastLine = null;
  while (Date.now() - t0 < ms) {
    const st = await page.evaluate(() => ({
      dlg: window.DAILY.dialogOpen(),
      who: document.getElementById("who").textContent,
      line: document.getElementById("line").textContent,
      over: !window.__daily.current && !window.__daily.busy
    }));
    if (st.over) return true;
    if (st.dlg) {
      if (collect && st.line && st.line !== lastLine) {
        collect.push(st.who + "：" + st.line);
        lastLine = st.line;
      }
      await page.keyboard.press("KeyE");
    }
    await page.waitForTimeout(90);
  }
  return false;
}

/** 把开场对白一路读到做事阶段。G01 开场是「淡入 680ms → 8 句 → 走位 0.9s → 3 句 → work」，
 *  两段对白被走位动画隔开：固定 sleep + advanceAll 很容易在走位那段提前返回，漏掉第二段。
 *  这里轮询：有对白就按 E，没对白就等，直到 state===work，不靠猜时间。 */
async function advanceToWork(page, ms = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const st = await page.evaluate(() => {
      const g = window.__daily.current;
      return { state: g ? g.state : null, dlg: window.DAILY.dialogOpen() };
    });
    if (st.state === "work") return true;
    if (st.dlg) await page.keyboard.press("KeyE");
    await page.waitForTimeout(90);
  }
  return false;
}

/** 按住方向键直到壳状态满足条件（换场景 / 贴近目标），超时松手返回 false。 */
async function campusHold(page, key, want, ms = 6000) {
  await page.keyboard.down(key);
  const t0 = Date.now();
  let hit = false;
  while (Date.now() - t0 < ms) {
    await page.waitForTimeout(60);
    if (want(await hubState(page))) { hit = true; break; }
  }
  await page.keyboard.up(key);
  return hit;
}

/** 默认进入（不带参数）就是校园自由走动：WASD 四向走、左右边缘换场景、
 *  走到事件区域按 E 开场。这一段的结尾已经把 G01 开起来了。 */
async function runCampus(page) {
  await page.waitForFunction(() => window.__daily && window.__daily.events, null, { timeout: 30000 });
  // showHub 跑完才会把旁白露出来；等资源加载 + 开场淡入都结束，别按固定 sleep 猜。
  await page.waitForFunction(() => !document.getElementById("campusNarration").hidden,
    null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);

  let st = await hubState(page);
  if (st.chapter.indexOf("四班门口") < 0) fail(`开局不在四班门口（${st.chapter}）`);
  if (!st.hubHidden) fail("默认自由走动不该压出调试目录（?hub=1 才压）");
  if (!st.narration || st.narration.indexOf("公告栏") < 0) {
    fail(`开局旁白没指向公告栏（${st.narration}）`);
  }
  if (!st.startDisabled) fail("开局离公告栏还远，「按 E」按钮不该能点");
  if (st.startText.indexOf("公告栏") < 0) fail(`开局按钮文案是「${st.startText}」`);
  if (st.playable !== 1 || st.locked !== 5 || st.done !== 0) {
    fail(`新存档目录应该是 1 可玩 / 5 锁定 / 0 完成，实际 ${st.playable}/${st.locked}/${st.done}`);
  }
  if (!st.items.length || st.items[0].id !== "errand" || st.items[0].cls !== "playable") {
    fail("目录第一项应该是可玩的 errand");
  }
  if (st.afterStoryHub) fail("没做完日常不该出现收尾入口");
  await page.screenshot({ path: path.join(OUT, "c0-campus-start.png") });

  // 右边缘换场景：四班门口 → 公告栏
  let moved = await campusHold(page, "ArrowRight", (s) => s.chapter.indexOf("公告栏") >= 0);
  if (!moved) fail("按住 → 没有从四班门口跨到公告栏");
  // 左边缘换回来：公告栏 → 四班门口
  moved = await campusHold(page, "KeyA", (s) => s.chapter.indexOf("四班门口") >= 0);
  if (!moved) fail("按住 A 没有从公告栏跨回四班门口");
  // 再往右进公告栏后一直按住：朱里 / 由乃站在目标旁会挡住去路。
  // 没有这层阻挡的话 3.6 秒足够从 x=6 冲到右边缘跨进楼梯口。
  moved = await campusHold(page, "KeyD", (s) => s.chapter.indexOf("公告栏") >= 0);
  if (!moved) fail("第二次往右没有跨到公告栏");
  await page.keyboard.down("KeyD");
  await page.waitForTimeout(3600);
  await page.keyboard.up("KeyD");
  st = await hubState(page);
  if (st.chapter.indexOf("公告栏") < 0) {
    fail(`公告栏里站着人却没挡住去路，走到了「${st.chapter}」`);
  }
  await page.screenshot({ path: path.join(OUT, "c1-campus-board.png") });

  // 纵深轴：W 往远处走（y<214 不算贴近），这时按 E 不该开演；S 走回近处才开演。
  // 注意：hubStart.disabled 只在换场景时刷新（shell.js renderHub←showHub←换场景），
  // 同一场景内走动不刷新，所以「贴没贴近」要用 E 的实际行为验，不能读那个按钮。
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(650);
  await page.keyboard.up("KeyW");
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(400);
  const farCur = await page.evaluate(() => window.__daily.current && window.__daily.current.id);
  if (farCur) fail(`W 走到远处（y<214）按 E 居然开演了（${farCur}）`);
  await page.keyboard.down("KeyS");
  await page.waitForTimeout(650);
  await page.keyboard.up("KeyS");

  // 贴近目标按 E → 进 G01
  await page.keyboard.press("KeyE");
  await page.waitForFunction(() => {
    const g = window.__daily.current;
    return !!g && g.id === "errand";
  }, null, { timeout: 8000 }).catch(() => {});
  const started = await page.evaluate(() => {
    const g = window.__daily.current;
    return g ? g.id : null;
  });
  if (started !== "errand") fail(`在公告栏按 E 进的是 ${started}，应该是 errand`);
  ok("校园自由走动：左右边缘换场景、人物挡路贴近目标、W/S 纵深门槛、按 E 进事件");
}

async function runErrand(page) {
  // G01 已由 runCampus 走到公告栏按 E 触发，这里只等它挂上来。
  await page.waitForFunction(() => {
    const g = window.__daily.current;
    return !!g && g.id === "errand";
  }, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1100);
  let s = await S(page);
  if (s.state !== "intro") fail(`进「一起去办事」后状态是 ${s.state}`);
  await page.screenshot({ path: path.join(OUT, "d1-corridor.png") });

  // 对白期间：换人条还没出来，人物也不许动
  const tagsHidden = await page.evaluate(() => document.getElementById("erTags").hidden);
  if (!tagsHidden) fail("开场对白还没读完，换人条就出现了");
  const before = (await S(page)).boy;
  await page.keyboard.down("KeyD");
  await page.waitForTimeout(320);
  await page.keyboard.up("KeyD");
  const during = (await S(page)).boy;
  if (Math.abs(during - before) > 1) fail("对白打开的时候人物还能走");

  if (!(await advanceToWork(page))) {
    fail(`开场对白没读到做事阶段（state=${(await S(page)).state}）`);
  }

  s = await S(page);
  if (s.state !== "work") fail(`开场对白读完之后状态是 ${s.state}，应该是 work`);
  if (!s.objTitle || s.objTitle.indexOf("分头") < 0) {
    fail(`目标卡标题应该提「分头」，实际「${s.objTitle}」`);
  }
  if (!s.obj || s.obj.indexOf("还剩") < 0) fail(`目标卡应该列出还没做完的事，实际「${s.obj}」`);

  // §3.1 首通（游玩次 0）恒定用现行参数：材料 [2,3,1]、虚线框 y=88、不镜像。
  //      重玩才按「本场第几次游玩」洗牌，材料顺序不会连着两次一样。
  const plans = await page.evaluate(() => [0, 1, 2, 3, 4, 5].map((n) => {
    const p = window.DAILY.games.errand.planForRun(n);
    return { n: p.n, order: p.papersOrder, cy: p.noticeCy, band: p.noticeBand, mirror: p.mirror, box: p.box };
  }));
  if (plans[0].order.join("") !== "231") fail("G01 首通计划里的材料顺序不是 [2,3,1]: " + plans[0].order);
  if (plans[0].cy !== 88) fail("G01 首通计划里的虚线框 y 不是 88");
  if (Math.abs(plans[0].band[0] - 0.7083) > 0.002) fail("G01 首通计划里的判定区间变了");
  if (plans[0].mirror) fail("G01 首通计划里推箱镜像了");
  if (plans[0].box.start !== 418 || plans[0].box.thr !== 438) fail("G01 首通计划里的箱子参数变了");
  for (let i = 1; i < plans.length; i++) {
    if (plans[i].order.join("") === plans[i - 1].order.join("")) {
      fail(`G01 第 ${i} 次重玩的材料顺序和上一次一样：${plans[i].order}`);
    }
    if ((i === 1 || i === 2) && plans[i].cy === 88) fail(`G01 第 ${i} 次重玩的虚线框还在首通位置`);
  }
  if (!plans[1].mirror || plans[1].box.start !== 94 || plans[1].box.thr !== 74) {
    fail("G01 第 1 次重玩没有镜像出「左侧楼梯口」路线");
  }
  const runNow = await page.evaluate(() => window.__daily.current.run);
  if (!runNow || runNow.n !== 0) fail(`G01 首通 run.n 不是 0：${runNow && runNow.n}`);
  if (runNow && runNow.mirror) fail("G01 首通运行时推箱镜像了");
  const errandRunsDuring = await page.evaluate(() => window.__daily.store().errandRuns || 0);
  if (errandRunsDuring !== 0) {
    fail(`G01 首通还没完成就把 errandRuns 写成了 ${errandRunsDuring}（中途刷新会消耗一轮参数）`);
  }
  const tags = await page.evaluate(() => {
    const el = document.getElementById("erTags");
    const on = el.querySelector("button.on");
    return {
      hidden: el.hidden,
      n: el.querySelectorAll("button[data-who]").length,
      on: on ? on.dataset.who : null
    };
  });
  if (tags.hidden) fail("做事阶段没有出现换人条");
  if (tags.n !== 3) fail(`换人条有 ${tags.n} 个按钮，应该是 3 个`);
  if (!s.active || s.active !== tags.on) {
    fail(`换人条的亮项和 active 不一致（${tags.on} / ${s.active}）`);
  }
  // 亮着的人不暗，另外两个变暗但还在场上
  if (s.alpha) {
    if (s.alpha[s.active] !== 1) fail(`当前角色 ${s.active} 被变暗了（alpha ${s.alpha[s.active]}）`);
    for (const k of ["girl", "friend", "boy"]) {
      if (k !== s.active && s.alpha[k] >= 1) fail(`${k} 没有被变暗（alpha ${s.alpha[k]}）`);
    }
  } else {
    fail("G01 没有暴露三个人的 alpha，验不了「高亮当前 / 变暗其余」");
  }
  await noOverlap(page, "#erTags", "#hint", "G01 换人条");
  await noOverlap(page, "#erTags", "#reactBtn", "G01 换人条");
  await page.screenshot({ path: path.join(OUT, "d2-stations.png") });

  // 点换人条：三个人都切得动
  for (const who of ["girl", "friend", "boy"]) {
    await page.click(`#erTags button[data-who="${who}"]`);
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => {
      const el = document.querySelector("#erTags button.on");
      return { active: window.__daily.current.active, on: el ? el.dataset.who : null };
    });
    if (r.active !== who) fail(`点「${who}」之后 active 是 ${r.active}`);
    if (r.on !== who) fail(`点「${who}」之后亮着的是 ${r.on}`);
  }
  // Tab 轮换：现在在「我」，Tab 应该轮到朱里
  await page.keyboard.press("Tab");
  await page.waitForTimeout(150);
  s = await S(page);
  if (s.active !== "girl") fail(`Tab 没有轮换到下一个人（${s.active}）`);
  await page.screenshot({ path: path.join(OUT, "d2b-switch.png") });

  // F 主动发起：原地做事的时候也能搭一句，不弹对白、不改状态
  await pokeOnce(page, "G01", "errand", "pokeCount", "搭话",
    [["这些都得今天弄完"], ["嗯。弄完就走"]]);
  await page.screenshot({ path: path.join(OUT, "d2c-poke.png") });

  // ---- 朱里：先松手太早（翘一角掉回手里），再在虚线框里松手
  s = await S(page);
  if (!s.noticeBand || !s.noticeBand.length) fail("G01 没给出布告栏虚线框的判定区间");
  await page.keyboard.down("Space");
  await page.waitForTimeout(300);
  await page.keyboard.up("Space");
  await page.waitForTimeout(750);
  s = await S(page);
  if (s.noticeDone) fail("纸还没到框里，却算贴好了");
  if (s.noticeMisses !== 1) fail(`纸歪了一次，noticeMisses 是 ${s.noticeMisses}`);
  await page.screenshot({ path: path.join(OUT, "d3-notice-miss.png") });

  const band = (await S(page)).noticeBand;
  await page.keyboard.down("Space");
  await page.waitForFunction((lo) => {
    const g = window.__daily.current;
    return !!g && g.noticeT >= lo;
  }, band[0] + 0.03, { timeout: 5000 });
  await page.keyboard.up("Space");
  await page.waitForTimeout(350);
  s = await S(page);
  if (!s.noticeDone) fail("在虚线框里松手却没有贴好");
  // §3.2 由乃还没数材料 → 朱里这边不联动：抖动倍率 1，也没有「有人扶着」的短反应。
  const linkBase = await page.evaluate(() => ({
    link: window.__daily.current.noticeLink,
    jitter: window.__daily.current.noticeJitterScale,
    react: (window.__reactLog || []).slice()
  }));
  if (linkBase.link) fail("由乃还没数材料，贴通知却联动上了");
  if (linkBase.jitter !== 1) fail(`没联动时抖动倍率应该是 1，实际 ${linkBase.jitter}`);
  if (linkBase.react.some((x) => x.indexOf("有人扶着") >= 0)) {
    fail("由乃还没做，却出现了「有人扶着」的联动台词");
  }
  await page.screenshot({ path: path.join(OUT, "d3b-notice.png") });

  // ---- 由乃：先拿错一摞（顺序回到第一摞），再按纸上的号拿
  await page.click('#erTags button[data-who="friend"]');
  await page.waitForTimeout(150);
  const order = (await S(page)).paperOrder;
  if (!order || order.length !== 3) fail("G01 没有三摞材料");
  const wrong = order.findIndex((n) => n !== 1);
  const stackPoint = (i) => page.evaluate((idx) => {
    const g = window.__daily.current;
    const r = document.getElementById("scene").getBoundingClientRect();
    const xs = g.paperXs;
    return {
      x: r.left + xs[idx] / 512 * r.width,
      y: r.top + g.paperY / 288 * r.height
    };
  }, i);

  let p = await stackPoint(wrong);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(300);
  s = await S(page);
  if (s.paperPicked !== 0) fail(`先拿了第 ${wrong + 1} 摞，picked 却是 ${s.paperPicked}`);
  if (s.paperMisses !== 1) fail(`拿错一次，paperMisses 是 ${s.paperMisses}`);
  await page.screenshot({ path: path.join(OUT, "d4-paper-miss.png") });

  for (let n = 1; n <= 3; n++) {
    p = await stackPoint(order.indexOf(n));
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(260);
  }
  s = await S(page);
  if (!s.paperDone) fail("按号拿完三摞却没有算完成");
  if (s.paperPicked !== 3) fail(`拿完三摞，picked 是 ${s.paperPicked}`);
  await page.screenshot({ path: path.join(OUT, "d4b-paper.png") });

  // ---- 我：门槛没抬推不过去 → 抬起来推过头滚回来 → 再推到落点
  await page.click('#erTags button[data-who="boy"]');
  await page.waitForTimeout(150);
  s = await S(page);
  const drop = s.boxDrop;
  const thr = s.boxThr;
  if (!drop) fail("G01 没给出箱子的落点区间");

  await page.keyboard.down("Space");
  await page.waitForTimeout(900);
  await page.keyboard.up("Space");
  s = await S(page);
  if (s.boxLifted) fail("还没按 E，箱子就抬起来了");
  if (s.boxX >= drop[0]) fail(`没抬箱子却把箱子推到了落点（x=${s.boxX}）`);
  if (s.boxX < thr - 6) fail(`按住空格推，箱子却没到门槛前（x=${s.boxX}）`);
  await page.screenshot({ path: path.join(OUT, "d5-box-block.png") });

  await page.keyboard.press("KeyE");
  await page.waitForTimeout(150);
  s = await S(page);
  if (!s.boxLifted) fail("按 E 没有把箱子抬起来");

  await page.keyboard.down("Space");
  await page.waitForFunction((hi) => {
    const g = window.__daily.current;
    return !!g && g.boxX > hi;
  }, drop[1] + 2, { timeout: 6000 });
  await page.keyboard.up("Space");
  // 等箱子自己滚回门槛前，再验「推过头」
  await page.waitForFunction(() => {
    const g = window.__daily.current;
    return !!g && g.boxX <= g.boxThr - 6;
  }, null, { timeout: 5000 }).catch(() => {});
  s = await S(page);
  if (s.boxDone) fail("箱子推过头了，却算搬好了");
  if (s.boxMisses !== 1) fail(`推过头一次，boxMisses 是 ${s.boxMisses}`);
  if (s.boxX > thr - 4) fail(`推过头之后箱子没有滚回来（x=${s.boxX}）`);
  await page.screenshot({ path: path.join(OUT, "d5b-box-roll.png") });

  // 再来一次：推到门槛、抬、推到落点松手
  await page.keyboard.down("Space");
  await page.waitForTimeout(600);
  await page.keyboard.up("Space");
  s = await S(page);
  if (s.boxX >= thr - 2) fail(`重新推的时候箱子没卡在门槛前（x=${s.boxX}）`);
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(150);
  await page.keyboard.down("Space");
  await page.waitForFunction((lo) => {
    const g = window.__daily.current;
    return !!g && g.boxX >= lo;
  }, drop[0] + 2, { timeout: 6000 });
  await page.keyboard.up("Space");
  await page.waitForTimeout(450);
  s = await S(page);
  if (!s.boxDone) fail("推到落点松手却没算搬好");
  const boxX = s.boxX;
  await page.screenshot({ path: path.join(OUT, "d5c-box.png") });

  // ---- 结尾：三个人做完 → 围到箱子边 → 一起抬（先晃倒一次，再扶正）→ 对白 → 回目录
  await page.waitForFunction(() => {
    const g = window.__daily.current;
    return !!g && (g.state === "ending" || g.state === "walkout" ||
                   g.state === "carry" || g.state === "handover");
  }, null, { timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => {
    const g = window.__daily.current;
    return !!g && g.state === "carry";
  }, null, { timeout: 8000 }).catch(() => {});
  s = await S(page);
  if (s.state !== "carry") fail(`三个人走到箱子边之后状态是 ${s.state}，应该是 carry`);
  if (!s.carry) fail("G01 没有暴露一起抬箱子的状态");
  else {
    if (s.carry.lift > 0.01) fail(`刚围到箱子边，箱子就被抬起来了（lift ${s.carry.lift}）`);
    if (s.carry.misses !== 0) fail(`还没开始抬就记了 ${s.carry.misses} 次歪倒`);
    // §3.2 推箱全程回滚过一次 → 抬箱段不联动，晃动保持原力度
    if (s.carry.swayScale !== 1) {
      fail(`推箱回过滚，抬箱 swayScale 应该是 1（不加难也不减），实际 ${s.carry.swayScale}`);
    }
  }
  await page.screenshot({ path: path.join(OUT, "d5d-carry.png") });

  // 抬箱动画：按住空格先蹲下抓住箱子（pickup），再切到抬箱循环（carry）。
  await page.keyboard.down("Space");
  await page.waitForFunction(() => {
    const g = window.__daily.current;
    return !!g && g.carry && g.carry.rise > 0.12;
  }, null, { timeout: 2500 }).catch(() => {});
  s = await S(page);
  if (!s.carry || s.carry.rise <= 0.12) fail("G01 按住空格后没有起手的抬箱动画");
  if (s.carry.poses.boy !== "pickup" || s.carry.poses.girl !== "pickup" ||
      s.carry.poses.friend !== "pickup") {
    fail(`G01 起手时没有切到弯腰帧（${JSON.stringify(s.carry.poses)}）`);
  }
  if (!s.carry.flipGirl) fail("G01 朱里站在箱子左边，弯腰帧却没有翻向箱子");
  await page.screenshot({ path: path.join(OUT, "d5d0-carry-pickup.png") });
  await page.waitForFunction(() => {
    const g = window.__daily.current;
    return !!g && g.carry && g.carry.rise >= 0.99;
  }, null, { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(80);
  s = await S(page);
  if (s.carry.poses.boy !== "carry" || s.carry.poses.girl !== "carry" ||
      s.carry.poses.friend !== "carry") {
    fail(`G01 抬起来之后没有切到抬箱帧（${JSON.stringify(s.carry.poses)}）`);
  }
  await page.screenshot({ path: path.join(OUT, "d5d1-carry-lift.png") });
  await page.keyboard.up("Space");
  await page.waitForFunction(() => {
    const g = window.__daily.current;
    return !!g && g.carry && g.carry.rise <= 0.04;
  }, null, { timeout: 2500 }).catch(() => {});

  // 按住空格，再故意一直往一边推：箱子会晃过界，放下重来（没有失败，只是重试）
  await page.keyboard.down("Space");
  await page.keyboard.down("KeyD");
  await page.waitForFunction(() => {
    const g = window.__daily.current;
    return !!g && g.carry && g.carry.misses >= 1;
  }, null, { timeout: 9000 }).catch(() => {});
  await page.keyboard.up("KeyD");
  await page.keyboard.up("Space");
  s = await S(page);
  if (!s.carry || s.carry.misses < 1) fail("G01 抬箱子时一直往一边推，箱子却没有歪倒重来");
  if (s.carry && s.carry.lift > 0.01) fail("G01 箱子歪倒之后抬升进度没有复位");
  await page.screenshot({ path: path.join(OUT, "d5e-carry-fail.png") });
  await page.waitForFunction(() => {
    const g = window.__daily.current;
    return !!g && g.carry && g.carry.dropT <= 0;
  }, null, { timeout: 4000 }).catch(() => {});

  // 按住空格，按倾角反方向按 A / D，把箱子扶正抬起来
  await page.keyboard.down("Space");
  let holdA = false, holdD = false, carryOk = false;
  const carryT0 = Date.now();
  while (Date.now() - carryT0 < 18000) {
    const c = await page.evaluate(() => {
      const g = window.__daily.current;
      return g && g.carry ? g.carry : null;
    });
    if (!c) break;
    if (c.done) { carryOk = true; break; }
    const wantA = c.tilt > 0.06;
    const wantD = c.tilt < -0.06;
    if (wantA !== holdA) {
      holdA = wantA;
      await page.keyboard[wantA ? "down" : "up"]("KeyA");
    }
    if (wantD !== holdD) {
      holdD = wantD;
      await page.keyboard[wantD ? "down" : "up"]("KeyD");
    }
    await page.waitForTimeout(50);
  }
  await page.keyboard.up("Space");
  if (holdA) await page.keyboard.up("KeyA");
  if (holdD) await page.keyboard.up("KeyD");
  s = await S(page);
  if (!carryOk || !s.carry || !s.carry.done) {
    fail(`G01 扶正之后箱子没有抬起来（tilt ${s.carry ? s.carry.tilt.toFixed(2) : "?"}）`);
  }
  await page.screenshot({ path: path.join(OUT, "d5f-carry-done.png") });

  // §3.3 抬起来之后还要往楼梯口走约 120px：路上迎面一个路人，
  //      玩家用 W / S 换纵深线让开；碰到只是停一下，不失败。
  const walkA = await page.evaluate(() => {
    const g = window.__daily.current;
    const c = g.carry;
    return { walkOn: c.walkOn, walkDir: c.walkDir, walkFrom: c.walkFrom, walkTo: c.walkTo,
             lane: c.lane, bumps: c.bumps, misses: c.misses, boxX: g.boxX };
  });
  if (!walkA.walkOn) fail("G01 抬起来之后没有进入「往楼梯口走」那一段");
  if (walkA.walkDir !== 1) fail(`G01 首通向楼梯口的方向应该是 +1，实际 ${walkA.walkDir}`);
  if (Math.abs(walkA.lane - 238) > 1) fail(`G01 走路段的起始纵深线不是 238（${walkA.lane}）`);
  if (Math.abs((walkA.walkTo - walkA.walkFrom) - 120) > 2) fail("G01 走路段的目标距离不是约 120px");
  const liftX = walkA.walkFrom;
  // 碰到迎面路人只停一下：bumps 记一次，misses 不动
  await page.waitForFunction(() => {
    const g = window.__daily.current;
    return !!g && g.carry && g.carry.bumps >= 1;
  }, null, { timeout: 12000 }).catch(() => {});
  let walkB = await page.evaluate(() => {
    const g = window.__daily.current;
    const c = g.carry;
    return { walkOn: c.walkOn, lane: c.lane, bumps: c.bumps, misses: c.misses };
  });
  if (walkB.bumps < 1) fail("G01 走路段一路没碰到迎面路人");
  if (walkB.misses !== walkA.misses) fail(`G01 碰到路人被记成了失误（misses ${walkA.misses} → ${walkB.misses}）`);
  await page.screenshot({ path: path.join(OUT, "d5g-walk-bump.png") });
  // W / S 微调纵深：按 W 站远一点让开
  const lane0 = walkB.lane;
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(600);
  await page.keyboard.up("KeyW");
  walkB = await page.evaluate(() => {
    const g = window.__daily.current;
    return { lane: g.carry.lane };
  });
  if (!(walkB.lane < lane0 - 6)) fail(`G01 按 W 没有把纵深线往远处挪（${lane0} → ${walkB.lane}）`);
  await page.waitForFunction(() => {
    const g = window.__daily.current;
    return !!g && g.carry && !g.carry.walkOn;
  }, null, { timeout: 16000 }).catch(() => {});
  const walkC = await page.evaluate(() => {
    const g = window.__daily.current;
    const c = g.carry;
    return { walkOn: c.walkOn, boxX: g.boxX, misses: c.misses, bumps: c.bumps };
  });
  if (walkC.walkOn) fail("G01 走路段没有走到终点");
  if (Math.abs(walkC.boxX - (liftX + 120)) > 2) {
    fail(`G01 走路段终点不是约 120px（${liftX} → ${walkC.boxX}）`);
  }
  if (walkC.misses !== walkA.misses) fail(`G01 走路段结束时不该多出失误（misses ${walkA.misses} → ${walkC.misses}）`);
  await page.screenshot({ path: path.join(OUT, "d5h-walk-end.png") });

  await page.waitForFunction(() => window.DAILY.dialogOpen(), null, { timeout: 20000 }).catch(() => {});
  s = await S(page);
  if (!s.dlg) fail("一起把箱子抬起来之后没有进入结尾对白");
  if (s.state !== "handover") fail(`结尾对白时状态是 ${s.state}，应该是 handover`);
  if (s.girl == null || s.fr == null) fail("结尾读不到朱里和由乃的位置");
  else {
    // 抬箱走了 120px，三个人是跟着箱子一起走的：用走完之后的箱子位置比。
    if (Math.abs(s.girl - s.boxX) > 60) fail(`朱里没有跟着走到箱子边（${s.girl} vs ${s.boxX}）`);
    if (Math.abs(s.fr - s.boxX) > 60) fail(`由乃没有跟着走到箱子边（${s.fr} vs ${s.boxX}）`);
  }
  const tagsEnd = await page.evaluate(() => document.getElementById("erTags").hidden);
  if (!tagsEnd) fail("结尾了换人条还挂着");
  await page.screenshot({ path: path.join(OUT, "d6-end.png") });

  // 首通做完 → 壳切日期卡（周二）→ 回到自由走动。默认模式不压目录。
  let dayShot = false;
  let over = false;
  const tEnd = Date.now();
  while (Date.now() - tEnd < 20000) {
    const st = await page.evaluate(() => ({
      dlg: window.DAILY.dialogOpen(),
      day: document.getElementById("dayCard").hidden
        ? null : document.getElementById("dayName").textContent,
      over: !window.__daily.current && !window.__daily.busy
    }));
    if (st.day && !dayShot) {
      dayShot = true;
      if (st.day !== "周二") fail(`G01 做完后的日期卡是「${st.day}」，应该是周二`);
      await page.waitForTimeout(340);   // 等日期卡淡入完再拍
      await page.screenshot({ path: path.join(OUT, "d6b-day-tue.png") });
    }
    if (st.over) { over = true; break; }
    if (st.dlg) await page.keyboard.press("KeyE");
    await page.waitForTimeout(100);
  }
  if (!over) fail("G01 首通结束后壳没有回到自由走动（busy 一直没落）");
  if (!dayShot) fail("G01 首通做完后没有切周二的日期卡");

  const done = await page.evaluate(() => ({
    saved: window.__daily.store().errandCompleted === true,
    cur: !!window.__daily.current,
    hubHidden: document.getElementById("hub").hidden
  }));
  if (!done.saved) fail("搬完箱子没有存下 errandCompleted");
  if (done.cur) fail("搬完箱子之后小游戏还没释放");
  if (!done.hubHidden) fail("默认自由走动模式不该压出调试目录");

  // ================= 重玩一遍（§3.1 参数种子化 + §3.2 联动正反馈） =================
  // 首通完成后存下 errandRuns=1，再进一次就是第 2 次游玩：材料洗牌、虚线框换位、
  // 推箱镜像到左侧楼梯口。这一遍三个人一次做对，验「只给正反馈」的联动加成。
  // 重访已完成的 G01 走调试口：此时按 E 只会进「下一个没做完的」（周二朱里）。
  await startEvent(page, "errand", "errand");
  if (!(await advanceToWork(page))) {
    const r0 = await S(page);
    fail(`G01 重玩开场对白没读到做事阶段（state=${r0.state}）`);
  }
  let r = await S(page);
  if (r.state !== "work") fail(`G01 重玩时状态是 ${r.state}，应该是 work`);
  const plan1 = await page.evaluate(() => {
    const p = window.DAILY.games.errand.planForRun(1);
    return { order: p.papersOrder, band: p.noticeBand, mirror: p.mirror, box: p.box };
  });
  r = await page.evaluate(() => {
    const g = window.__daily.current;
    return {
      run: g.run, paperOrder: g.paperOrder, noticeBand: g.noticeBand,
      boxX: g.boxX, boxDrop: g.boxDrop, boxThr: g.boxThr, boy: g.trio.boy.x
    };
  });
  if (!r.run || r.run.n !== 1) fail(`G01 重玩 run.n 不是 1：${r.run && r.run.n}`);
  const replayOrder = (r.paperOrder || []);
  if (replayOrder.join("") === "231") fail("G01 重玩材料顺序还是首通那三摞");
  if (replayOrder.join("") !== plan1.order.join("")) fail("G01 重玩材料顺序和计划对不上");
  if (!r.run.mirror) fail("G01 重玩没有镜像推箱路线");
  if (Math.abs(r.boxX - plan1.box.start) > 1) fail(`G01 镜像路线箱子起点不对（${r.boxX}）`);
  if (Math.abs(r.boxThr - plan1.box.thr) > 1) fail(`G01 镜像路线门槛点没跟着镜像（${r.boxThr}）`);
  if (Math.abs(r.boxDrop[0] - plan1.box.drop[0]) > 1) fail("G01 镜像路线落点没跟着镜像");
  if (Math.abs(r.noticeBand[0] - plan1.band[0]) > 0.002) fail("G01 重玩虚线框没换位");
  if (Math.abs(r.boy - 120) > 1) fail(`G01 镜像时「我」的站位没跟着换边（${r.boy}）`);
  await page.screenshot({ path: path.join(OUT, "d7-replay-start.png") });

  // 由乃：一次不拿错（材料全对 → 后面朱里那边会联动）
  await page.click('#erTags button[data-who="friend"]');
  await page.waitForTimeout(150);
  const stackPoint2 = (i) => page.evaluate((idx) => {
    const g = window.__daily.current;
    const rc = document.getElementById("scene").getBoundingClientRect();
    return { x: rc.left + g.paperXs[idx] / 512 * rc.width, y: rc.top + g.paperY / 288 * rc.height };
  }, i);
  for (let n = 1; n <= 3; n++) {
    const pp = await stackPoint2(r.paperOrder.indexOf(n));
    await page.mouse.click(pp.x, pp.y);
    await page.waitForTimeout(230);
  }
  let rr = await page.evaluate(() => ({
    done: window.__daily.current.paperDone, misses: window.__daily.current.paperMisses
  }));
  if (!rr.done) fail("G01 重玩：按号拿完三摞却没完成");
  if (rr.misses !== 0) fail(`G01 重玩：这次一次没拿错，paperMisses 却是 ${rr.misses}`);

  // 朱里：材料全对 → rise 抖动减半 + 一句「有人扶着就是不一样」
  await page.click('#erTags button[data-who="girl"]');
  await page.waitForTimeout(150);
  await page.keyboard.down("Space");
  await page.waitForFunction((lo) => {
    const g = window.__daily.current;
    return !!g && g.noticeT >= lo;
  }, r.noticeBand[0] + 0.03, { timeout: 6000 });
  rr = await page.evaluate(() => ({
    link: window.__daily.current.noticeLink,
    jitter: window.__daily.current.noticeJitterScale
  }));
  if (!rr.link) fail("G01 重玩：由乃材料全对，贴通知却没联动");
  if (rr.jitter !== 0.5) fail(`G01 重玩：联动时抖动倍率应该是 0.5，实际 ${rr.jitter}`);
  await page.keyboard.up("Space");
  await page.waitForTimeout(400);
  rr = await page.evaluate(() => ({ done: window.__daily.current.noticeDone }));
  if (!rr.done) fail("G01 重玩：在新的虚线框位置松手却没贴好");
  const replayReacts = await page.evaluate(() => (window.__reactLog || []).slice());
  if (!replayReacts.some((x) => x.indexOf("有人扶着") >= 0)) {
    fail("G01 重玩：联动没走现有 #react 条说「有人扶着就是不一样」");
  }
  await page.screenshot({ path: path.join(OUT, "d7-replay-link.png") });

  // 我：镜像推箱，一次到位（不回滚）
  await page.click('#erTags button[data-who="boy"]');
  await page.waitForTimeout(150);
  await page.keyboard.down("Space");
  await page.waitForFunction((lo) => {
    const g = window.__daily.current;
    return !!g && g.boxX <= lo;
  }, plan1.box.thr + 3, { timeout: 6000 });
  await page.keyboard.up("Space");
  let bx = await S(page);
  if (bx.boxX <= bx.boxDrop[1] + 2) fail(`G01 镜像推箱没被门槛挡住（x=${bx.boxX}）`);
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(150);
  await page.keyboard.down("Space");
  await page.waitForFunction((lo) => {
    const g = window.__daily.current;
    return !!g && g.boxX <= lo;
  }, plan1.box.drop[1] - 2, { timeout: 6000 });
  await page.keyboard.up("Space");
  await page.waitForTimeout(420);
  bx = await page.evaluate(() => ({
    done: window.__daily.current.boxDone, misses: window.__daily.current.boxMisses
  }));
  if (!bx.done) fail("G01 重玩：镜像推到落点松手却没算搬好");
  if (bx.misses !== 0) fail(`G01 重玩：这次没推过头，boxMisses 却是 ${bx.misses}`);

  // 抬箱：推箱没回滚 → sway ×0.7；抬满之后按 W 让开路人，走到终点
  await page.waitForFunction(() => {
    const g = window.__daily.current;
    return !!g && g.state === "carry";
  }, null, { timeout: 12000 }).catch(() => {});
  let rc = await page.evaluate(() => {
    const g = window.__daily.current;
    return { state: g.state, carry: g.carry, boxX: g.boxX };
  });
  if (rc.state !== "carry") fail(`G01 重玩：没进入抬箱（${rc.state}）`);
  if (rc.carry.swayScale !== 0.7) {
    fail(`G01 重玩：推箱没回滚，抬箱 swayScale 应该是 0.7，实际 ${rc.carry.swayScale}`);
  }
  await page.keyboard.down("Space");
  let rHoldA = false, rHoldD = false;
  const rT0 = Date.now();
  while (Date.now() - rT0 < 12000) {
    const c = await page.evaluate(() => window.__daily.current.carry);
    if (!c || c.done) break;
    const wantA = c.tilt > 0.06, wantD = c.tilt < -0.06;
    if (wantA !== rHoldA) { rHoldA = wantA; await page.keyboard[wantA ? "down" : "up"]("KeyA"); }
    if (wantD !== rHoldD) { rHoldD = wantD; await page.keyboard[wantD ? "down" : "up"]("KeyD"); }
    await page.waitForTimeout(50);
  }
  if (rHoldA) await page.keyboard.up("KeyA");
  if (rHoldD) await page.keyboard.up("KeyD");
  rc = await page.evaluate(() => {
    const g = window.__daily.current;
    return { done: g.carry.done, walkOn: g.carry.walkOn, walkDir: g.carry.walkDir,
             boxX: g.boxX, walkTo: g.carry.walkTo, walkFrom: g.carry.walkFrom };
  });
  if (!rc.done || !rc.walkOn) fail("G01 重玩：抬满之后没进入走路段");
  if (rc.walkDir !== -1) fail(`G01 重玩：镜像路线应该往左走，实际 ${rc.walkDir}`);
  const rLiftX = rc.walkFrom;
  // 一上来就按 W 让开，应该一次都撞不到
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(500);
  await page.keyboard.up("KeyW");
  await page.waitForFunction(() => {
    const g = window.__daily.current;
    return !!g && g.carry && !g.carry.walkOn;
  }, null, { timeout: 16000 }).catch(() => {});
  rc = await page.evaluate(() => {
    const g = window.__daily.current;
    return { walkOn: g.carry.walkOn, boxX: g.boxX, bumps: g.carry.bumps, misses: g.carry.misses };
  });
  await page.keyboard.up("Space");
  if (rc.walkOn) fail("G01 重玩：镜像走路段没到终点");
  if (Math.abs(rc.boxX - (rLiftX - 120)) > 3) {
    fail(`G01 重玩：镜像走路段终点不是约 -120px（${rLiftX} → ${rc.boxX}）`);
  }
  if (rc.bumps !== 0) fail(`G01 重玩：提前让开了还是撞到路人（bumps ${rc.bumps}）`);
  await page.screenshot({ path: path.join(OUT, "d7-replay-walk.png") });

  await page.waitForFunction(() => window.DAILY.dialogOpen(), null, { timeout: 20000 }).catch(() => {});
  const rEnd = await page.evaluate(() => ({
    dlg: window.DAILY.dialogOpen(), state: window.__daily.current.state
  }));
  if (!rEnd.dlg || rEnd.state !== "handover") fail(`G01 重玩：收尾没进 handover 对白（${rEnd.state}）`);
  const rOver = await drainToEnd(page, 20000);
  if (!rOver) fail("G01 重玩：结束后壳没有回到自由走动");
  const rDone = await page.evaluate(() => ({
    runs: window.__daily.store().errandRuns,
    saved: window.__daily.store().errandCompleted === true
  }));
  if (rDone.runs !== 2) fail(`G01 重玩：errandRuns 应该是 2，实际 ${rDone.runs}`);
  if (!rDone.saved) fail("G01 重玩：errandCompleted 没保留");
  ok("G01 重玩：参数种子化（材料/框位/镜像路线）与联动加成（通知更稳、抬箱 sway×0.7）都生效");
  return done;
}

/** 等单人日常的选择面板出现；对白还要照常用 E 读完。 */
async function drainToSoloChoice(page, ms = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const st = await page.evaluate(() => ({
      box: !document.getElementById("soloChoice").hidden,
      dlg: window.DAILY.dialogOpen()
    }));
    if (st.box) return true;
    if (st.dlg) await page.keyboard.press("KeyE");
    await page.waitForTimeout(100);
  }
  return false;
}

async function runSolo(page, id, want, viaE) {
  if (viaE) {
    // 上一段做完人没挪窝，仍站在公告栏目标旁：按 E 直接进下一个未完成的日常。
    await page.keyboard.press("KeyE");
    await page.waitForFunction((wantId) => {
      const g = window.__daily.current;
      return !!g && g.id === wantId;
    }, "solo_" + id, { timeout: 8000 }).catch(() => {});
    const got = await page.evaluate(() => window.__daily.current && window.__daily.current.id);
    if (got !== "solo_" + id) fail(`${id}：在目标旁按 E 进的是 ${got}`);
  } else {
    await startEvent(page, id, "solo_" + id);
  }
  await page.waitForTimeout(700);
  let s = await S(page);
  if (s.state !== "intro") fail(`${id}：进场状态是 ${s.state}`);
  await advanceAll(page);
  await page.waitForTimeout(300);

  s = await S(page);
  if (s.state !== "approach") { fail(`${id}：开场对白读完后状态是 ${s.state}`); return; }
  if (!s.soloTarget) { fail(`${id}：没有暴露可以走近的目标`); return; }

  // 双轴：W 往墙根走，S 往镜头前走
  const y0 = s.py;
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(340);
  await page.keyboard.up("KeyW");
  const yUp = (await S(page)).py;
  if (!(yUp < y0 - 3)) fail(`${id}：按 W 没有往墙根走（${y0} → ${yUp}）`);
  await page.keyboard.down("KeyS");
  await page.waitForTimeout(520);
  await page.keyboard.up("KeyS");
  const yDown = (await S(page)).py;
  if (!(yDown > yUp + 3)) fail(`${id}：按 S 没有往镜头前走（${yUp} → ${yDown}）`);

  // 走过去：左右 + 前后一起按
  for (let i = 0; i < 60; i++) {
    s = await S(page);
    if (s.dlg) { await advanceAll(page); continue; }
    const t = s.soloTarget;
    if (Math.abs(s.boy - t.x) <= 46 && Math.abs(s.py - t.y) <= 18) break;
    const keys = [];
    if (s.boy < t.x - 46) keys.push("KeyD");
    else if (s.boy > t.x + 46) keys.push("KeyA");
    if (s.py < t.y - 8) keys.push("KeyS");
    else if (s.py > t.y + 8) keys.push("KeyW");
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(150);
    for (const k of keys) await page.keyboard.up(k);
  }
  s = await S(page);
  if (!s.soloNear) fail(`${id}：走到她身边没有出现 E 提示`);
  await page.screenshot({ path: path.join(OUT, `e1-${id}.png`) });

  await page.keyboard.press("KeyE");
  if (!(await drainToSoloChoice(page))) { fail(`${id}：对话读完没有出选择面板`); return; }
  await page.screenshot({ path: path.join(OUT, `e2-${id}-choice.png`) });
  await page.click("#soloChoiceBtns button:nth-child(2)");

  const over = await drainToEnd(page, 20000);
  if (!over) fail(`${id}：结束后壳没有回到自由走动`);

  const st = await page.evaluate(() => ({
    store: window.__daily.store(),
    box: document.getElementById("soloChoice").hidden
  }));
  if (st.store[want.key] !== true) fail(`${id}：没有存下 ${want.key}`);
  if (st.store[want.reply] !== want.value) {
    fail(`${id}：选第二项后 ${want.reply} 是 ${st.store[want.reply]}，应该是 ${want.value}`);
  }
  if (!st.box) fail(`${id}：结束后选择面板还挂着`);
  ok(`${id}：双轴走位、走近说话、选择与存档都成立`);
}

/** G03《课间猜人物》§5：程序化蒙版扩题 + 抢答窗 + 自选线索类别 + 两轮出题 + 抽题。
 *
 *  旧流程（固定 9 题、逐题点 data-ans、一次「换你出题」）已经整体作废，这里按新机制重写：
 *    - 抽题：6 题、每类 2 题、不重复、和「游玩次」种子算出来的一致；
 *    - 蒙版：fig 题同一种子渲染两次像素哈希一致、格长 16/10/5/0 单调递减、老 PNG 也画在 canvas 上；
 *    - 抢答：窗内答对满分；窗过她俩按线索类别先猜，玩家再答半分；「再给点提示」只算半拍；
 *    - 类别：第二条线索前让玩家挑「先听哪类」，选中的类别先展开；
 *    - 两轮出题：第二轮排除上一轮出过的词和猜错的词，同样的误导只让她们犹豫半拍。
 *  分数只影响收尾措辞，存档仍是 wordGameCompleted / wordGameCorrect / wordGameHints 三个旧字段。
 */
async function runWord(page) {
  const clickSel = (sel) => page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return false;
    e.click();
    return true;
  }, sel);
  const skipSay = async () => {
    await page.evaluate(() => {
      const h = document.getElementById("wgHost");
      if (h) h.click();
      const s = document.getElementById("wgSay");
      if (s) s.click();
    });
    await page.waitForTimeout(110);
  };
  const waitRound = async (i, ms = 45000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const st = await page.evaluate(() => {
        const g = window.__daily.current;
        return {
          ri: g && g.roundIndex, state: g && g.state,
          wg: !document.getElementById("wg").hidden,
          hub: document.getElementById("hub").classList.contains("show")
        };
      });
      if (!st || st.hub) return false;
      if (st.ri === i && st.state === "ask") return true;
      await skipSay();
    }
    return false;
  };
  const skipSaysUntil = async (pred, ms = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await page.evaluate(pred)) return true;
      await skipSay();
    }
    return await page.evaluate(pred);
  };
  /** 跳过她俩的猜测 / 类别选择，直到重新开抢答窗。返回过程中是否出现过类别选择。 */
  const advanceToBuzz = async (ms = 25000) => {
    const t0 = Date.now();
    let sawPick = false;
    while (Date.now() - t0 < ms) {
      const st = await page.evaluate(() => {
        const g = window.__daily.current;
        return {
          pick: !document.getElementById("wgPick").hidden,
          buzz: !!(g && g.buzzActive),
          wg: !document.getElementById("wg").hidden,
          swap: !document.getElementById("wgSwap").hidden
        };
      });
      if (st.pick) {
        sawPick = true;
        await clickSel("#wgPick button");
        await page.waitForTimeout(180);
        continue;
      }
      if (st.buzz) return { ok: true, sawPick: sawPick };
      if (!st.wg || st.swap) return { ok: false, sawPick: sawPick };
      await skipSay();
    }
    return { ok: false, sawPick: sawPick };
  };

  const runsBefore = await page.evaluate(() => window.__daily.store().wordRuns || 0);
  await startEvent(page, "word", "word_guess");
  await page.waitForFunction(() => !document.getElementById("wg").hidden, null, { timeout: 15000 });
  await page.waitForTimeout(300);

  const panel = await page.evaluate(() => ({
    open: !document.getElementById("wg").hidden,
    chips: document.querySelectorAll("#wg .chip").length,
    canvas: !!document.getElementById("wgSilCv"),
    buzz: !!document.getElementById("wgBuzz"),
    pick: !!document.getElementById("wgPick")
  }));
  if (!panel.open) fail("猜词面板没打开");
  if (panel.chips !== 3) fail(`猜词面板上有 ${panel.chips} 个人，应该是 3 个`);
  if (!panel.canvas) fail("猜词面板没有 #wgSilCv，剪影还挂在 <img> 上");
  if (!panel.buzz) fail("猜词面板没有抢答窗 #wgBuzz");
  if (!panel.pick) fail("猜词面板没有线索类别选择 #wgPick");

  // ---- §5.5 抽题：6 题、每类 2 题、不重复、可复现 ----
  const draw = await page.evaluate((seed) => {
    const W = window.DAILY.games.wordgame;
    const g = window.__daily.current;
    const expected = W.pickQuestions(seed).map((q) => q.id);
    const meta = g.drawn.map((q) => ({ id: q.id, cat: q.cat, fig: !!q.fig }));
    const byCat = {};
    meta.forEach((m) => { byCat[m.cat] = (byCat[m.cat] || 0) + 1; });
    const qs = W.QUESTIONS;
    const npcBad = [];
    let overrides = 0;
    qs.forEach((q) => {
      if (!q.npcByClue) return;
      overrides++;
      let differs = false;
      Object.keys(q.npcByClue).forEach((k) => {
        if (["look", "story", "quote"].indexOf(k) < 0) npcBad.push(q.id + ":k:" + k);
        if (W.npcGuess(q, k).text !== q.npcByClue[k].text) npcBad.push(q.id + ":wiring:" + k);
        if (W.npcGuess(q, k).text !== q.npc.text) differs = true;
      });
      if (!differs) npcBad.push(q.id + ":override-same-as-default");
    });
    return {
      seed: seed, rounds: g.rounds, meta: meta, expected: expected,
      byCat: byCat, npcBad: npcBad, overrides: overrides,
      stored: window.DAILY.store.wordRuns
    };
  }, runsBefore);
  // 游玩次在「本场完成时」才 +1：开场就写盘的话，中途刷新会被当成下一轮
  if (draw.seed !== runsBefore) fail(`游玩次种子应该是本场完成数 ${runsBefore}，实际 ${draw.seed}`);
  // 没写过 wordRuns 时 store() 里就是 undefined，等价于 0 —— 不能因此在开场落一个键。
  if ((draw.stored || 0) !== runsBefore) fail(`G03 开场就把 wordRuns 写成了 ${draw.stored}（完成前应保持 ${runsBefore}）`);
  if (draw.rounds !== 6) fail(`每轮不是 6 题，是 ${draw.rounds}`);
  if (draw.meta.length !== 6) fail(`抽到 ${draw.meta.length} 题，应该是 6 题`);
  if (new Set(draw.meta.map((m) => m.id)).size !== 6) {
    fail("抽题有重复：" + draw.meta.map((m) => m.id).join(","));
  }
  ["anime", "game", "movie"].forEach((c) => {
    if (draw.byCat[c] !== 2) fail(`类别 ${c} 抽了 ${draw.byCat[c]} 题，应该是 2 题`);
  });
  if (JSON.stringify(draw.meta.map((m) => m.id)) !== JSON.stringify(draw.expected)) {
    fail(`抽到的题和种子算出来的不一致：${draw.meta.map((m) => m.id)} vs ${draw.expected}`);
  } else {
    ok(`G03 抽题：种子 ${draw.seed} 抽出 6 题，每类 2 题、不重复、可复现` +
       `（其中 fig 题 ${draw.meta.filter((m) => m.fig).length} 道）`);
  }
  if (draw.npcBad.length) fail("npcByClue 接线有问题：" + draw.npcBad.join(", "));
  else ok(`G03 线索类别会改变她俩的猜测方向（${draw.overrides} 道题带 npcByClue）`);

  // ---- §5.1 蒙版：像素哈希可复现、格长单调递减、老 PNG 也走 canvas ----
  const mask = await page.evaluate(async () => {
    const W = window.DAILY.games.wordgame;
    const M = W.WGMask;
    const qs = W.QUESTIONS;
    const fig = qs.filter((q) => q.fig)[0];
    const old = qs.filter((q) => q.sil)[0];
    const mk = () => {
      const c = document.createElement("canvas");
      c.width = 96;
      c.height = 96;
      return c;
    };
    const opaque = (c) => {
      const d = c.getContext("2d").getImageData(0, 0, 96, 96).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      return n;
    };
    await M.prepare(fig);
    const a = mk(), b = mk(), c1 = mk(), c2 = mk(), c3 = mk(), c4 = mk();
    M.render(a, fig, 1);
    M.render(b, fig, 1);
    M.render(c1, fig, 1);
    M.render(c2, fig, 2);
    M.render(c3, fig, 3);
    M.render(c4, fig, 4);
    // 老题：PNG 也画到 canvas 上。file:// 下这种画布被浏览器标成跨源脏画布，
    // 读不了像素，只能验「确实画上去了」；能读像素的只有纯矢量的 fig 题。
    await M.prepare(old);
    const oldCv = mk();
    const oldDrew = M.render(oldCv, old, 1);
    const propNames = Object.keys(M.PROPS);
    const bodyNames = Object.keys(M.BODIES);
    const bad = [];
    qs.forEach((q) => {
      if (q.fig) {
        if (bodyNames.indexOf(q.fig.body) < 0) bad.push(q.id + ":body:" + q.fig.body);
        (q.fig.props || []).forEach((p) => {
          if (propNames.indexOf(p) < 0) bad.push(q.id + ":prop:" + p);
        });
      } else if (!q.sil) bad.push(q.id + ":no-fig-no-sil");
      (q.clues || []).forEach((c) => {
        if (["look", "story", "quote"].indexOf(c.k) < 0) bad.push(q.id + ":k");
      });
    });
    return {
      n: qs.length,
      figN: qs.filter((q) => q.fig).length,
      silN: qs.filter((q) => q.sil).length,
      props: propNames.length,
      bodies: bodyNames.length,
      bad: bad,
      cell: [M.cellFor(1), M.cellFor(2), M.cellFor(3), M.cellFor(4)],
      seedStable: M.seedOf(fig.id) === M.seedOf(fig.id),
      seeds: qs.map((q) => ({ id: q.id, seed: M.seedOf(q.id) })),
      hashA: M.pixelHash(a),
      hashB: M.pixelHash(b),
      revealHashes: [M.pixelHash(c1), M.pixelHash(c2), M.pixelHash(c3), M.pixelHash(c4)],
      figPixels: opaque(a),
      oldDrew: oldDrew
    };
  });
  if (mask.n !== 18) fail(`G03 题库 ${mask.n} 题，应该是 18 题`);
  if (mask.figN !== 9 || mask.silN !== 9) fail(`G03 fig/sil 题数 ${mask.figN}/${mask.silN}，应该是 9/9`);
  if (mask.props < 20) fail(`WGMask 道具表只有 ${mask.props} 件，应该约 20 件`);
  if (mask.bodies !== 4) fail(`WGMask 体型有 ${mask.bodies} 种，应该是 4 种`);
  if (mask.bad.length) fail("G03 题库数据有问题：" + mask.bad.slice(0, 6).join(", "));
  const cells = mask.cell;
  if (!(cells[0] === 16 && cells[1] === 10 && cells[2] === 5 && cells[3] === 0)) {
    fail(`G03 马赛克格长不是 16/10/5/0：${cells.join("/")}`);
  } else if (!(cells[0] > cells[1] && cells[1] > cells[2] && cells[2] > cells[3])) {
    fail("G03 马赛克格长没有随线索数单调递减");
  } else {
    ok("G03 马赛克格长随线索数单调递减：1条 16px → 2条 10px → 3条 5px → 公布答案全清");
  }
  if (!mask.seedStable) fail("G03 题 id 的蒙版种子不稳定");
  // 种子必须真的等于「题 id 的哈希」：这里用同一套 FNV-1a 在 Node 侧独立算一遍。
  const fnv = (s) => {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  };
  const seedBad = mask.seeds.filter((s) => s.seed !== fnv(s.id));
  if (seedBad.length) {
    fail("G03 蒙版种子不是题目 id 的哈希：" + seedBad.slice(0, 3).map((s) => s.id).join(", "));
  } else {
    ok(`G03 蒙版种子 = 题目 id 哈希（${mask.seeds.length} 道题都对得上）`);
  }
  if (mask.hashA === 0 || mask.hashA !== mask.hashB) {
    fail(`G03 fig 题渲染像素哈希不可复现（${mask.hashA} / ${mask.hashB}）`);
  } else {
    ok(`G03 fig 题（${mask.figN ? "9 道" : "?"}）同一种子两次渲染像素哈希一致`);
  }
  if (new Set(mask.revealHashes).size !== 4) {
    fail("G03 线索推进时蒙版画面没有逐级变化：" + mask.revealHashes.join(","));
  } else {
    ok("G03 四档蒙版（16/10/5/0）画面互不相同");
  }
  if (mask.figPixels < 120) fail(`G03 fig 剪影像素太少（${mask.figPixels} 个不透明像素）`);
  if (!mask.oldDrew) fail("G03 老题的 PNG 没有画到 canvas 上");

  // ---- R0：窗过 → 她俩按类别猜 → 用提示 → 新窗答对只算半拍 ----
  if (!(await waitRound(0))) fail("等不到第 1 回合的抢答窗");
  let st = await page.evaluate(() => {
    const g = window.__daily.current;
    return {
      buzz: !!(g && g.buzzActive),
      state: g && g.state,
      reveal: g && g.maskReveal,
      cell: g && g.maskCell,
      clues: document.getElementById("wgClues").children.length,
      buzzBar: !document.getElementById("wgBuzz").hidden,
      round: document.getElementById("wgRound").textContent
    };
  });
  if (!st.buzz || !st.buzzBar) fail("第 1 回合没有开抢答窗（进度条不可见）");
  else ok("G03 每条线索展示后开 2.2 秒抢答窗（细条可见）");
  if (st.clues !== 1) fail(`第 1 回合一开始有 ${st.clues} 条线索`);
  if (st.reveal !== 1 || st.cell !== 16) {
    fail(`1 条线索时蒙版不是 16px：reveal=${st.reveal} cell=${st.cell}`);
  }
  if (st.round.indexOf("第 1 / 6") < 0) fail(`回合标题是「${st.round}」`);
  await page.screenshot({ path: path.join(OUT, "d6-word.png") });
  await noOverlap(page, "#reactBtn", "#wgInput", "G03");
  await noOverlap(page, "#reactBtn", "#wgOpts", "G03");
  await pokeOnce(page, "G03", "word_guess", "pokeCount", "抢答",
    [["我猜到了，能说了吗"], ["那就说啊"]]);
  await page.screenshot({ path: path.join(OUT, "d6a-poke.png") });

  await page.waitForFunction(() => !window.__daily.current.buzzActive, null, { timeout: 6000 });
  const npcExpect = await page.evaluate(() => {
    const W = window.DAILY.games.wordgame;
    const g = window.__daily.current;
    const q = g.drawn[g.roundIndex];
    const guess = W.npcGuess(q, q.clues[0].k);
    return {
      text: guess.text,
      override: !!(q.npcByClue && q.npcByClue[q.clues[0].k]),
      base: q.npc.text
    };
  });
  await page.waitForFunction((t) => document.getElementById("wgSay").textContent.indexOf(t) >= 0,
    npcExpect.text, { timeout: 8000 })
    .catch(() => fail(`抢答窗走完她俩没有开口（没听到「${npcExpect.text}」）`));
  if (npcExpect.override && npcExpect.text === npcExpect.base) {
    fail("这条线索的类别没有改变她俩的猜测方向");
  }
  await skipSaysUntil(() => {
    const g = window.__daily.current;
    return g.state === "ask" && !g.buzzActive;
  });
  st = await page.evaluate(() => {
    const g = window.__daily.current;
    return { state: g && g.state, buzz: !!(g && g.buzzActive) };
  });
  if (st.state !== "ask" || st.buzz) fail(`窗过之后没有轮到玩家再答（state=${st.state}）`);

  const pickedKind = await page.evaluate(() => {
    const b = document.querySelector("#wgPick button");
    return b ? b.dataset.kind : null;
  });
  await page.evaluate(() => document.getElementById("wgHint").click());
  await page.waitForTimeout(400);
  const pick = await page.evaluate(() => ({
    shown: !document.getElementById("wgPick").hidden,
    kinds: [...document.querySelectorAll("#wgPick button")].map((b) => b.dataset.kind)
  }));
  if (!pick.shown) {
    fail("两条线索类别不同，却没有让玩家挑先听哪类");
  } else {
    if (pick.kinds.length !== 2) fail(`类别选择给了 ${pick.kinds.length} 个按钮`);
    await page.screenshot({ path: path.join(OUT, "d7b-pick.png") });
    await clickSel("#wgPick button");
  }
  await page.waitForFunction(() => document.getElementById("wgClues").children.length === 2,
    null, { timeout: 8000 }).catch(() => fail("用了提示之后没有揭出第 2 条线索"));
  await page.waitForTimeout(300);
  const afterHint = await page.evaluate(() => {
    const g = window.__daily.current;
    return {
      reveal: g && g.maskReveal,
      cell: g && g.maskCell,
      kinds: [...document.querySelectorAll("#wgClues li")].map((li) => li.dataset.k),
      buzz: !!(g && g.buzzActive)
    };
  });
  if (afterHint.reveal !== 2 || afterHint.cell !== 10) {
    fail(`2 条线索时蒙版不是 10px：reveal=${afterHint.reveal} cell=${afterHint.cell}`);
  }
  if (pick.shown && pickedKind) {
    if (afterHint.kinds.length !== 2) fail("线索列表不是 2 条");
    else if (afterHint.kinds[1] !== pickedKind) {
      fail(`点选的类别是 ${pickedKind}，展开的第 2 条却是 ${afterHint.kinds[1]}`);
    }
  }
  await page.waitForFunction(() => !!(window.__daily.current && window.__daily.current.buzzActive),
    null, { timeout: 6000 }).catch(() => fail("揭出新线索后没有再开抢答窗"));
  await page.waitForTimeout(240);
  await clickSel('#wgOpts button[data-ans="1"]:not(:disabled)');
  await page.waitForTimeout(1500);
  st = await page.evaluate(() => {
    const g = window.__daily.current;
    return { full: g && g.fullWins, half: g && g.halfWins, score: g && g.score };
  });
  if (st.full !== 0 || st.half !== 1) {
    fail(`用提示之后答对应该只算半分：full=${st.full} half=${st.half}`);
  }
  if (Math.abs(st.score - 0.5) > 1e-6) fail(`第 1 回合分数应该是 0.5，是 ${st.score}`);
  ok("G03 窗过她俩先猜、玩家再答半分；「再给点提示」只算半拍");

  // ---- R1：窗内答对 = 满分 ----
  if (!(await waitRound(1))) fail("等不到第 2 回合");
  await clickSel('#wgOpts button[data-ans="1"]:not(:disabled)');
  await page.waitForTimeout(1300);
  st = await page.evaluate(() => ({
    full: window.__daily.current.fullWins,
    score: window.__daily.current.score
  }));
  if (st.full !== 1) fail(`窗内答对没记满分（fullWins=${st.full}）`);
  if (Math.abs(st.score - 1.5) > 1e-6) fail(`第 2 回合之后分数应该是 1.5，是 ${st.score}`);
  ok("G03 抢答窗内答对得满分");

  // ---- R2：窗过 → 她俩猜 → 玩家再答半分（第二种半分路径） ----
  if (!(await waitRound(2))) fail("等不到第 3 回合");
  await page.waitForFunction(() => !window.__daily.current.buzzActive, null, { timeout: 6000 });
  if (!(await skipSaysUntil(() => {
    const g = window.__daily.current;
    return g.state === "ask" && !g.buzzActive;
  }))) fail("第 3 回合窗过之后没有轮到玩家再答");
  await clickSel('#wgOpts button[data-ans="1"]:not(:disabled)');
  await page.waitForTimeout(1300);
  st = await page.evaluate(() => ({
    half: window.__daily.current.halfWins,
    score: window.__daily.current.score
  }));
  if (st.half !== 2) fail(`窗过之后答对没记半拍（halfWins=${st.half}）`);
  if (Math.abs(st.score - 2.0) > 1e-6) fail(`第 3 回合之后分数应该是 2.0，是 ${st.score}`);

  // ---- R3：满分第二例（半场闲聊之后） ----
  if (!(await waitRound(3))) fail("等不到第 4 回合（半场闲聊之后）");
  await clickSel('#wgOpts button[data-ans="1"]:not(:disabled)');
  await page.waitForTimeout(1300);
  st = await page.evaluate(() => ({ full: window.__daily.current.fullWins }));
  if (st.full !== 2) fail(`窗内答对没记满分（fullWins=${st.full}）`);

  // ---- R4：三条线索都答错 → 格长 16/10/5 → 公布答案全清 ----
  if (!(await waitRound(4))) fail("等不到第 5 回合");
  await clickSel('#wgOpts button:not([data-ans]):not(:disabled)');
  let adv = await advanceToBuzz();
  if (!adv.sawPick) fail("第 5 回合揭第 2 条线索前没有出现类别选择");
  await page.waitForTimeout(300);
  st = await page.evaluate(() => {
    const g = window.__daily.current;
    return {
      clues: document.getElementById("wgClues").children.length,
      reveal: g && g.maskReveal,
      cell: g && g.maskCell
    };
  });
  if (st.clues !== 2) fail(`第 5 回合第 2 条线索没出来（clues=${st.clues}）`);
  if (st.reveal !== 2 || st.cell !== 10) {
    fail(`第 2 条线索时蒙版不是 10px：reveal=${st.reveal} cell=${st.cell}`);
  }
  await clickSel('#wgOpts button:not([data-ans]):not(:disabled)');
  adv = await advanceToBuzz();
  if (!adv.ok) fail("第 5 回合答错第 2 条线索之后没有进下一条");
  await page.waitForTimeout(320);
  st = await page.evaluate(() => {
    const g = window.__daily.current;
    return {
      clues: document.getElementById("wgClues").children.length,
      reveal: g && g.maskReveal,
      cell: g && g.maskCell
    };
  });
  if (st.clues !== 3) fail(`第 5 回合第 3 条线索没出来（clues=${st.clues}）`);
  if (st.reveal !== 3 || st.cell !== 5) {
    fail(`第 3 条线索时蒙版不是 5px：reveal=${st.reveal} cell=${st.cell}`);
  }
  await page.screenshot({ path: path.join(OUT, "d7-clue.png") });
  await clickSel('#wgOpts button:not([data-ans]):not(:disabled)');
  await page.waitForFunction(() => window.__daily.current && window.__daily.current.maskReveal === 4,
    null, { timeout: 15000 }).catch(() => fail("三条线索都答错之后没有公布答案（蒙版没全清）"));
  await page.waitForTimeout(320);
  st = await page.evaluate(() => ({ cell: window.__daily.current.maskCell }));
  if (st.cell !== 0) fail(`公布答案之后蒙版还剩 ${st.cell}px`);
  else ok("G03 三条线索答错 → 公布答案，蒙版全清");
  await page.screenshot({ path: path.join(OUT, "d7a-answer.png") });

  // ---- R5：最后一条线索窗内答对 ----
  if (!(await waitRound(5))) fail("等不到第 6 回合");
  await clickSel('#wgOpts button[data-ans="1"]:not(:disabled)');
  await page.waitForTimeout(1300);
  const stats = await page.evaluate(() => window.__daily.current.stats);
  if (stats.correct !== 5) fail(`答对回合数应该是 5，是 ${stats.correct}`);
  if (Math.abs(stats.score - 4.0) > 1e-6) fail(`总分应该是 4.0，是 ${stats.score}`);
  if (stats.fullWins !== 3) fail(`满分抢答应该是 3 次，是 ${stats.fullWins}`);
  if (stats.halfWins !== 2) fail(`半分应该是 2 次，是 ${stats.halfWins}`);
  if (stats.hints !== 1) fail(`提示次数应该是 1，是 ${stats.hints}`);
  ok("G03 6 回合分数 4.0（满分 3 次 / 半分 2 次、答对 5 回合、用提示 1 次）");

  // ---- §5.4 换你出题两轮：第二轮排除上一轮出过的词和猜错的词 ----
  await page.waitForFunction(() => {
    const g = window.__daily.current;
    return g && g.state === "swap" && g.swapState === "pick" &&
      document.querySelectorAll("#wgSwapOpts button").length === 3;
  }, null, { timeout: 25000 }).catch(() => fail("六题之后没有出现「换你出题」"));
  const swapPanel = await page.evaluate(() => ({
    round: document.getElementById("wgRound").textContent,
    optsHidden: document.getElementById("wgOpts").hidden,
    cluesHidden: document.getElementById("wgClues").hidden,
    state: window.__daily.current.swapState,
    data: window.__daily.current.swapData
  }));
  if (swapPanel.round.indexOf("换你出题") < 0) fail(`G03 插曲标题是「${swapPanel.round}」`);
  if (!swapPanel.optsHidden || !swapPanel.cluesHidden) fail("G03「换你出题」时原来的题面还挂着");
  if (swapPanel.data.round !== 0) fail(`「换你出题」第一轮 round 是 ${swapPanel.data.round}`);
  if (swapPanel.data.options.length !== 3) fail(`第一轮词卡 ${swapPanel.data.options.length} 个`);
  await noOverlap(page, "#reactBtn", "#wgSwapOpts", "G03 插曲");
  await page.screenshot({ path: path.join(OUT, "d6b-swap.png") });

  await page.evaluate(() => document.querySelector('#wgSwapOpts button[data-word="1"]').click());
  await page.waitForFunction(() => window.__daily.current.swapState === "clues", null, { timeout: 5000 });
  const clues1 = await page.evaluate(() => window.__daily.current.swapData);
  const misfit = clues1.clues.findIndex((c) => !c.fits);
  const fits = clues1.clues.map((c, i) => (c.fits ? i : -1)).filter((i) => i >= 0);
  const mislead = misfit >= 0 ? clues1.clues[misfit].mislead : null;
  if (misfit < 0 || !mislead) fail("「剧透」这组没有误导线索，自检没法验「猜偏」");
  await page.screenshot({ path: path.join(OUT, "d6b2-swap-clues.png") });
  await page.evaluate((i) => {
    const b = document.querySelector('#wgSwapClues button[data-clue="' + i + '"]');
    if (b) b.click();
  }, misfit);
  await page.waitForFunction((t) => document.getElementById("wgSwapSay").textContent.indexOf(t) >= 0,
    mislead, { timeout: 6000 }).catch(() => fail("G03 第一轮误导线索没有让她俩猜偏"));
  let learned = await page.evaluate(() => window.__daily.current.learnedCats);
  if (learned.indexOf(mislead) < 0) {
    fail("G03 第一轮猜错的方向没有记进主持人状态 learnedCats：" + JSON.stringify(learned));
  } else {
    ok(`G03 第一轮她俩被误导线索带偏（learnedCats=${JSON.stringify(learned)}）`);
  }
  await page.screenshot({ path: path.join(OUT, "d6c-swap-wrong.png") });
  for (const i of fits) {
    await page.waitForTimeout(1100);
    await page.evaluate((j) => {
      const b = document.querySelector('#wgSwapClues button[data-clue="' + j + '"]');
      if (b && !b.disabled) b.click();
    }, i);
  }
  await page.waitForFunction(() => {
    const g = window.__daily.current;
    return g && g.swapRoundIdx === 1 && document.querySelectorAll("#wgSwapOpts button").length === 3;
  }, null, { timeout: 20000 }).catch(() => fail("第一轮出题之后没有进第二轮"));
  const round2 = await page.evaluate(() => window.__daily.current.swapData);
  if (round2.round !== 1) fail(`第二轮 round 是 ${round2.round}`);
  const enabled = round2.options.filter((o) => !o.disabled);
  const disabled = round2.options.filter((o) => o.disabled);
  if (enabled.length !== 1) {
    fail(`第二轮能选的词有 ${enabled.length} 个，应该只剩没出过、也没被排除的那一个：` +
      JSON.stringify(round2.options));
  }
  if (disabled.length !== 2) fail(`第二轮排除的词有 ${disabled.length} 个，应该是 2 个`);
  const disText = disabled.map((o) => o.text).join(" / ");
  if (disText.indexOf("剧透") < 0) fail("G03 第二轮没有排除第一轮出过的词：" + disText);
  if (disText.indexOf(mislead) < 0) fail("G03 第二轮没有排除第一轮猜错的词：" + disText);
  else ok(`G03 第二轮排除出过的词 + 第一轮猜错的词，只剩「${enabled[0] ? enabled[0].text : "?"}」`);
  await page.screenshot({ path: path.join(OUT, "d6d-swap2.png") });

  await page.evaluate(() => document.querySelector("#wgSwapOpts button:not(:disabled)").click());
  await page.waitForFunction(() => window.__daily.current.swapState === "clues", null, { timeout: 5000 });
  const clues2 = await page.evaluate(() => window.__daily.current.swapData);
  const misfit2 = clues2.clues.findIndex((c) => !c.fits);
  const fits2 = clues2.clues.map((c, i) => (c.fits ? i : -1)).filter((i) => i >= 0);
  await page.evaluate((i) => {
    const b = document.querySelector('#wgSwapClues button[data-clue="' + i + '"]');
    if (b && !b.disabled) b.click();
  }, misfit2);
  await page.waitForFunction(() => document.getElementById("wgSwapSay").textContent.indexOf("上一轮") >= 0,
    null, { timeout: 6000 })
    .catch(() => fail("G03 第二轮遇到同样的误导，她俩没有说出「上一轮就栽在这儿」"));
  learned = await page.evaluate(() => window.__daily.current.learnedCats);
  if (learned.length !== 1) fail("G03 第二轮把已经学过的词又记了一遍：" + JSON.stringify(learned));
  else ok("G03 第二轮同样的误导只让她们犹豫半拍（台词里明说上一轮猜错过）");
  await page.screenshot({ path: path.join(OUT, "d6e-swap2-wrong.png") });
  for (const i of fits2) {
    await page.waitForTimeout(1100);
    await page.evaluate((j) => {
      const b = document.querySelector('#wgSwapClues button[data-clue="' + j + '"]');
      if (b && !b.disabled) b.click();
    }, i);
  }
  await page.waitForFunction(() => document.getElementById("wg").hidden, null, { timeout: 25000 })
    .catch(() => fail("两轮出题之后猜词面板没有关掉"));

  // ---- 收尾：G03 是最后一场。对白读完 → 壳直接跳 narrative 收尾，不再回目录。 ----
  const tEnd = Date.now();
  let navigated = false;
  while (Date.now() - tEnd < 25000) {
    try {
      const stt = await page.evaluate(() => ({
        url: location.href,
        dlg: window.DAILY ? window.DAILY.dialogOpen() : false
      }));
      if (stt.url.indexOf("narrative/index.html") >= 0) { navigated = true; break; }
      if (stt.dlg) await page.keyboard.press("KeyE");
    } catch (e) {
      // G03 是最后一场：读完对白壳就 location.href 跳 narrative，
      // 正好把这一帧的执行上下文销毁。这不是故障，等导航落定再读 URL。
      if (page.url().indexOf("narrative/index.html") >= 0) { navigated = true; break; }
    }
    await page.waitForTimeout(120);
  }
  if (!navigated) fail("猜词（最后一场）结束后没有跳 narrative 收尾");
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  // file:// 同源，localStorage 在 narrative 页上照样读得到
  const done = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("our-story-act5-daily-v1") || "{}");
    return {
      url: location.href,
      saved: s.wordGameCompleted === true,
      correct: s.wordGameCorrect,
      hints: s.wordGameHints,
      runs: s.wordRuns,
      chapterDone: s.chapterDailyDone === true
    };
  });
  if (done.url.indexOf("phase=after") < 0) fail(`收尾跳转的地址是 ${done.url}`);
  if (!done.saved) fail("猜词结束没有存下 wordGameCompleted");
  if (done.correct !== 5) fail(`存档 wordGameCorrect 是 ${done.correct}，应该是 5（6 题里错 1 题）`);
  if (done.hints !== 1) fail(`存档 wordGameHints 是 ${done.hints}，应该是 1`);
  if (done.runs !== runsBefore + 1) fail(`游玩次 wordRuns 是 ${done.runs}，应该是 ${runsBefore + 1}`);
  if (!done.chapterDone) fail("全部日常做完没有存下 chapterDailyDone");
  else ok("G03 收尾跳 narrative：wordGameCompleted / correct=5 / hints=1 / wordRuns+1 / chapterDailyDone 都对");
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, "d6f-narrative.png") });
  return done;
}

/** G02 第一条路：一句话都不问，直接走到楼梯口把卡捡起来。
 *  设计稿明确要求「允许提前找到物品，不能因为没听完线索就禁止拾取」。 */
async function runSearchEarly(page) {
  const searchRunsBefore = await page.evaluate(() => window.__daily.store().searchRuns || 0);
  await startEvent(page, "search", "search");
  await page.waitForTimeout(700);
  await advanceAll(page);
  await page.waitForTimeout(300);

  let s = await S(page);
  if (s.state !== "search") fail(`G02 开场读完状态是 ${s.state}，应该是 search`);
  if (!s.obj) fail("G02 开始后没有目标卡");
  // §4.1 首通（游玩次 0）仍然固定在楼梯口窗台，落点/路线/提示第三句都不变。
  const firstRound = await page.evaluate(() => {
    const g = window.__daily.current;
    return {
      runs: g.runs, spot: g.cardSpot, route: g.route, steps: g.steps,
      savedRuns: window.__daily.store().searchRuns
    };
  });
  if (firstRound.runs !== 0) fail(`G02 首通 runs 不是 0：${firstRound.runs}`);
  // 游玩次在完成时才 +1：开场写盘会让「没打完刷新」消耗掉一轮参数。
  // 没写过 searchRuns 时 store() 里就是 undefined，等价于 0。
  if ((firstRound.savedRuns || 0) !== searchRunsBefore) {
    fail(`G02 开场就写了 searchRuns（${searchRunsBefore} → ${firstRound.savedRuns}，完成前不该变）`);
  }
  if (firstRound.spot.id !== "stairSill" || firstRound.spot.x !== 300) {
    fail(`G02 首通落点不是楼梯口窗台：${firstRound.spot.id} @ ${firstRound.spot.x}`);
  }
  if (firstRound.route.join(",") !== "classroom,cooler,windowsill") {
    fail(`G02 首通路线变了：${firstRound.route}`);
  }
  if (firstRound.steps !== 0) fail(`G02 刚开场 steps 不是 0：${firstRound.steps}`);

  // F 自言自语：不能顺手把「问问由乃」的三级提示次数吃掉
  const beforePoke = await page.evaluate(() => window.__daily.current.hints);
  await pokeOnce(page, "G02", "search", "pokeCount", "自言自语",
    [["她上午到底去哪儿了"], ["我哪能一直盯着她"]]);
  const afterPoke = await page.evaluate(() => ({
    hints: window.__daily.current.hints,
    clues: window.__daily.current.clues.length,
    btn: document.getElementById("nbHint").disabled
  }));
  if (afterPoke.hints !== beforePoke || afterPoke.hints !== 0) {
    fail(`G02 按 F 之后提示次数从 ${beforePoke} 变成 ${afterPoke.hints}`);
  }
  if (afterPoke.clues !== 0) fail("G02 按 F 自言自语居然记出了一条线索");
  if (afterPoke.btn) fail("G02 按 F 之后「问问由乃」被禁用了");
  await page.screenshot({ path: path.join(OUT, "s1a-poke.png") });

  await ensureScene(page, "stair", "KeyA");
  await page.waitForTimeout(200);
  // §4.3 步数：自动走一次换场，steps 应该正好 +1（onScene 在淡入之后才计）
  await page.waitForFunction(() => {
    const g = window.__daily.current;
    return !!g && g.steps >= 1;
  }, null, { timeout: 8000 }).catch(() => {});
  const walked = await page.evaluate(() => window.__daily.current.steps);
  if (walked !== 1) fail(`G02 走一次换场，steps 应该是 1，实际 ${walked}`);

  await approach(page, 300);
  await waitHint(page, "窗台");
  // 她俩只在走廊门口等，不该跟着上楼
  const who = await page.evaluate(() => window.__daily.current.girlVisible);
  if (who) fail("到了楼梯口，朱里和由乃还画在画面上——她们没跟过来");
  await page.screenshot({ path: path.join(OUT, "s1-card.png") });

  await page.keyboard.press("KeyE");
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "s2-found.png") });

  // 找到卡之后多了一步「怎么还给她」。第一条路真的选一次，
  // 另外那条路（runSearch）故意不选，用来验「不选也不拦关」。
  if (!(await drainToGiveBack(page))) fail("G02 找到卡之后没有出现「怎么还给她」");
  const give = await page.evaluate(() => ({
    shown: !document.getElementById("giveBack").hidden,
    buttons: document.querySelectorAll("#giveBack button[data-i]").length,
    dlg: window.DAILY.dialogOpen()
  }));
  if (!give.shown) fail("G02「怎么还给她」没显示出来");
  if (give.buttons !== 3) fail(`G02「怎么还给她」有 ${give.buttons} 个选项，应该是 3 个`);
  if (give.dlg) fail("G02「怎么还给她」和完整对白框同时挂着");
  await noOverlap(page, "#reactBtn", "#giveBack", "G02 还卡");
  await page.screenshot({ path: path.join(OUT, "s2b-return.png") });
  await page.click('#giveBack button[data-i="2"]');
  await page.waitForFunction(() => {
    const g = window.__daily.current;
    return g && g.returnChoice === 2;
  }, null, { timeout: 5000 }).catch(() => fail("G02 选了「先喊她一声」，returnChoice 没记上"));
  // 一边读收尾一边把台词记下来：§4.3 的步数评价只在措辞里，得看真的说了。
  const earlyLines = [];
  const earlyOver = await drainToEnd(page, 20000, earlyLines);
  if (!earlyOver) fail("G02 提前找到之后壳没有回到自由走动");
  if (!earlyLines.some((x) => x.indexOf("心里有谱") >= 0)) {
    fail(`G02 首通只走了 1 次换场，收尾没有少步数口径（实际：${earlyLines.join(" | ")}）`);
  }
  if (!earlyLines.some((x) => x.indexOf("在楼梯口，窗台上") >= 0)) {
    fail("G02 首通收尾的地点文案变了（应该还是楼梯口窗台）");
  }

  const done = await page.evaluate(() => ({
    saved: window.__daily.store().searchCompleted === true,
    clues: window.__daily.store().searchClues
  }));
  if (!done.saved) fail("G02 没有存下 searchCompleted");
  if (done.clues !== 0) fail(`G02 一条线索都没看，存档里却是 ${done.clues} 条`);
  return done;
}

/** G02 第二条路：先验四轮卡位的数据能唯一求解，再正经玩一遍第二轮的落点
 *  （问人 → 看线索 → 拼平面图 → 捡卡），最后验一件旧存档读进来不报错。 */
async function runSearch(page) {
  const trace = [];
  const mark = async (tag) => {
    const s = await S(page);
    trace.push(tag + " scene=" + s.scene + " x=" + (s.boy == null ? "-" : Math.round(s.boy)) + " dlg=" + s.dlg);
  };
  const G2 = () => page.evaluate(() => {
    const g = window.__daily.current;
    if (!g) return null;
    return {
      state: g.state, scene: g.scene, x: g.x, y: g.y, dlg: window.DAILY.dialogOpen(),
      steps: g.steps, runs: g.runs, round: g.round, cardSpot: g.cardSpot,
      clues: g.clues.slice(), hints: g.hints, askOpen: g.askOpen,
      pins: g.pins.slice(), routeSolved: g.routeSolved, routeTries: g.routeTries,
      mapOpen: g.mapOpen, nearPoint: g.nearPoint, returnChoice: g.returnChoice,
      store: (function () { const s = window.__daily.store(); return JSON.parse(JSON.stringify(s)); })()
    };
  });

  // ================= §4.1 四个落点的线索链：数据层自动求解 =================
  // 只拿「这一轮的四处真线索」，按 step 归位，必须恰好指向路线三站；
  // 四轮的顺序路线两两不同，所以仅凭真线索就能唯一确定落点。
  const rounds = await page.evaluate(() =>
    [0, 1, 2, 3].map((n) => window.DAILY.games.search.roundInfo(n)));
  const routeSigs = [];
  const destSigs = [];
  for (const rd of rounds) {
    if (rd.truePoints.length !== 4) fail(`G02 第 ${rd.n} 轮真线索点不是 4 个：${rd.truePoints}`);
    const byStep = {};
    for (const pid of Object.keys(rd.variants)) {
      if (rd.truePoints.indexOf(pid) < 0) fail(`G02 第 ${rd.n} 轮把变体线索挂在非真线索点 ${pid} 上`);
      for (const c of rd.variants[pid]) {
        const st = c.step | 0;
        if (st < 1 || st > 3) fail(`G02 第 ${rd.n} 轮《${pid}》的线索 step=${c.step}，应为 1..3`);
        (byStep[st] || (byStep[st] = [])).push(c);
        if (!rd.spots[c.pin]) fail(`G02 第 ${rd.n} 轮线索钉到不存在的地点 ${c.pin}`);
        if (!c.text) fail(`G02 第 ${rd.n} 轮有空白线索文本`);
      }
    }
    for (let st = 1; st <= 3; st++) {
      const arr = byStep[st];
      if (!arr || !arr.length) { fail(`G02 第 ${rd.n} 轮第 ${st} 站没有真线索（死路）`); continue; }
      const pinsAt = [...new Set(arr.map((c) => c.pin))];
      if (pinsAt.length !== 1) fail(`G02 第 ${rd.n} 轮第 ${st} 站的线索指向 ${pinsAt}，有歧义`);
      if (pinsAt[0] !== rd.route[st - 1]) {
        fail(`G02 第 ${rd.n} 轮第 ${st} 站线索指向 ${pinsAt[0]}，路线却是 ${rd.route[st - 1]}`);
      }
    }
    if (rd.route.length !== 3) fail(`G02 第 ${rd.n} 轮路线不是 3 站`);
    if (rd.dest !== rd.route[2]) fail(`G02 第 ${rd.n} 轮落点和路线最后一站不一致`);
    routeSigs.push(rd.route.join(">"));
    destSigs.push(rd.dest);
    for (const who of ["girl", "friend"]) {
      if (!rd.answers[who] || rd.answers[who].length !== 3) {
        fail(`G02 第 ${rd.n} 轮 ${who} 的问题答案不是 3 条`);
      }
    }
    if (rd.confirms.length !== 2) fail(`G02 第 ${rd.n} 轮关键问题不是 2 个`);
    for (const c of rd.confirms) {
      const vs = rd.variants[c.point] || [];
      if (!vs.some((x) => x.pin === c.pin)) {
        fail(`G02 第 ${rd.n} 轮印证版指向不存在的线索 ${c.point}/${c.pin}`);
      }
    }
    if (!rd.answers.girl.some((a) => a.pin === "cctv")) fail(`G02 第 ${rd.n} 轮缺监控这个干扰线索`);
  }
  if (new Set(routeSigs).size !== 4) fail("G02 有两轮的顺序路线完全一样，仅凭线索分不出落点");
  if (new Set(destSigs).size !== 4) fail("G02 有两轮的落点一样");
  const firstRd = rounds[0];
  if (firstRd.spot.id !== "stairSill" || firstRd.route.join(",") !== "classroom,cooler,windowsill") {
    fail("G02 首通落点 / 路线不再和旧版一致（游玩次 0 应该恒定为楼梯口窗台）");
  }
  if (firstRd.hint3.indexOf("楼梯口那个窗台") < 0) fail("G02 首通第三条提示变了");
  ok("G02 四轮卡位：每轮 4 处真线索、三站各 1 个唯一指向、落点两两不同");

  // §4.3 步数评价：少 / 多两种口径都在，只影响措辞，不进存档。
  const verdicts = await page.evaluate(() => ({
    low: window.DAILY.games.search.stepVerdict(2),
    mid: window.DAILY.games.search.stepVerdict(5),
    high: window.DAILY.games.search.stepVerdict(8)
  }));
  if (verdicts.low.join("").indexOf("心里有谱") < 0) fail("G02 步数少的时候没有「心里有谱」口径");
  if (verdicts.high.join("").indexOf("腿都跑细了") < 0) fail("G02 步数多的时候没有「腿都跑细了」口径");
  if (!verdicts.mid.length) fail("G02 中等步数没有说话");

  // ================= 第二遍：游玩次 1 → 楼梯拐角台阶 =================
  await startEvent(page, "search", "search");
  await page.waitForTimeout(700);
  await advanceAll(page);
  await page.waitForTimeout(300);

  let s = await S(page);
  if (s.state !== "search") fail(`G02 重玩时状态是 ${s.state}`);
  let g = await G2();
  if (g.runs !== 1) fail(`G02 第二遍 runs 应该是 1，实际 ${g.runs}`);
  if (g.round.spot.id !== "stairSteps") fail(`G02 第二遍抽到的不是楼梯拐角台阶：${g.round.spot.id}`);
  if (g.round.route.join(",") !== "classroom,cooler,stair") fail(`G02 第二遍路线不对：${g.round.route}`);
  if (g.steps !== 0) fail(`G02 第二遍刚开场 steps 不是 0：${g.steps}`);
  ok(`G02 第二遍抽到新落点：${g.round.spot.name}（${g.round.routeNames.join(" → ")}）`);
  const round = g.round;
  const P = round.points;
  let stepMark = g.steps;
  await page.screenshot({ path: path.join(OUT, "s3-start.png") });

  // ---- 先看门缝、门牌：她俩就在这一片等，观察点看完之后 E 才轮到「问人」
  //      （观察点优先，问话不能把想看的门缝 / 牌子抢掉）
  await approach(page, P.door.x);
  await waitHint(page, "门缝");
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(300);
  await advanceAll(page);
  await page.waitForTimeout(250);
  await approach(page, P.plate.x);
  await waitHint(page, "门边的牌子");
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(300);
  await advanceAll(page);
  await page.waitForTimeout(250);
  await mark("看完门缝/门牌");

  // ---- 问朱里：每人 3 个问题；关键问题先问（这时还没看到窗台 → 验「问在看见之前」）
  await approach(page, 238);
  await waitHint(page, "问问朱里");
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(300);
  let ask = await page.evaluate(() => ({
    open: !document.getElementById("askBox").hidden,
    people: document.querySelectorAll("#askBtns button[data-who]").length,
    dlg: window.DAILY.dialogOpen()
  }));
  if (!ask.open) fail("G02 站在朱里跟前按 E 没打开问人面板");
  if (ask.people !== 2) fail(`G02 问人面板应该有两个人可选，实际 ${ask.people}`);
  if (ask.dlg) fail("G02 问人面板和完整对白框同时挂着");
  await noOverlap(page, "#askBox", "#reactBtn", "G02 问人");
  const bx = (await S(page)).boy;
  await page.keyboard.down("KeyD");
  await page.waitForTimeout(340);
  await page.keyboard.up("KeyD");
  if (Math.abs((await S(page)).boy - bx) > 1) fail("G02 问人面板打开的时候人物还能走");
  await page.click('#askBtns button[data-who="girl"]');
  await page.waitForTimeout(150);
  const qn = await page.evaluate(() => document.querySelectorAll("#askBtns button[data-q]").length);
  if (qn !== 3) fail(`G02 朱里应该有 3 个问题，实际 ${qn} 个`);
  await page.click('#askBtns button[data-q="1"]');   // 关键问题：上午去过开水房吗
  await page.waitForTimeout(250);
  g = await G2();
  const askClues = g.clues.filter((c) => c.kind === "ask");
  if (askClues.length !== 1) fail(`G02 问了一句，ask 类线索应该有 1 条，实际 ${askClues.length}`);
  else if (!askClues[0].from || askClues[0].from.indexOf("朱里") < 0) fail("G02 的 ask 线索没标明问的是谁");
  const said = await page.evaluate(() => document.getElementById("askSaid").textContent);
  if (!said) fail("G02 问了之后没有答案文本");
  // 再问一句卡套颜色：答案钉在监控，是地图上的干扰项
  await page.click('#askBtns button[data-q="2"]');
  await page.waitForTimeout(200);
  await page.click('#askBtns button[data-close="1"]');
  await page.waitForTimeout(300);
  // 再问由乃：问一个非关键问题（牌子看过了，E 直接是「问人」）
  await approach(page, 186);
  await waitHint(page, "问问由乃");
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(300);
  await page.click('#askBtns button[data-who="friend"]');
  await page.waitForTimeout(150);
  await page.click('#askBtns button[data-q="0"]');
  await page.waitForTimeout(200);
  await page.click('#askBtns button[data-close="1"]');
  await page.waitForTimeout(300);
  g = await G2();
  if (g.askOpen) fail("G02 点「先不问」之后问人面板没关");
  if (g.clues.filter((c) => c.kind === "ask").length !== 3) fail("G02 问了三句，ask 线索应该有 3 条");
  if (g.steps !== stepMark) fail("G02 在教室门口问人不该算跨场景步数");
  ok("G02 问人：两个人各 3 个问题，答案产出 ask 类线索，不限次数、不扣分");

  // ---- 看窗台：朱里的印证版应该已经生效（问在看见之前）
  await approach(page, P.sill.x);
  await waitHint(page, "窗台");
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(300);
  await advanceAll(page);
  await page.waitForTimeout(250);
  g = await G2();
  const confGirl = round.confirms.find((c) => c.who === "girl");
  const tGirl = g.clues.find((c) => c.point === confGirl.point && c.pin === confGirl.pin && c.kind !== "ask");
  if (!tGirl) fail(`G02 没收集到朱里印证版对应的线索 ${confGirl.point}/${confGirl.pin}`);
  else if (tGirl.text !== confGirl.text) fail("G02 问过关键问题后，观察点线索没有换成印证版");
  else ok("G02 问在看见之前 → 对应观察点线索直接是印证版");

  // ---- 去楼梯口看扶手（这一轮的真线索点），步数 +1
  await ensureScene(page, "stair", "KeyA");
  await page.waitForFunction((want) => {
    const x = window.__daily.current;
    return !!x && x.steps >= want;
  }, stepMark + 1, { timeout: 8000 }).catch(() => {});
  g = await G2();
  if (g.steps !== stepMark + 1) fail(`G02 换场一次 steps 应从 ${stepMark} 到 ${stepMark + 1}，实际 ${g.steps}`);
  stepMark = g.steps;
  await mark("到楼梯口");
  await approach(page, 120);
  await waitHint(page, "扶手");
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(300);
  await advanceAll(page);
  await page.waitForTimeout(250);

  // ---- 回走廊问由乃的关键问题（先看到、后问到 → 已有线索要换成印证版）
  await ensureScene(page, "corridor", "KeyD");
  await page.waitForFunction((want) => {
    const x = window.__daily.current;
    return !!x && x.steps >= want;
  }, stepMark + 1, { timeout: 8000 }).catch(() => {});
  g = await G2();
  if (g.steps !== stepMark + 1) fail(`G02 换回走廊 steps 不对：${g.steps} vs ${stepMark + 1}`);
  stepMark = g.steps;
  await approach(page, 186);
  await waitHint(page, "问问由乃");
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(300);
  await page.click('#askBtns button[data-who="friend"]');
  await page.waitForTimeout(150);
  const confFriend = round.confirms.find((c) => c.who === "friend");
  await page.click(`#askBtns button[data-q="${confFriend.q}"]`);
  await page.waitForTimeout(250);
  g = await G2();
  const tFriend = g.clues.find((c) => c.point === confFriend.point && c.pin === confFriend.pin && c.kind !== "ask");
  if (!tFriend) fail(`G02 没找到由乃印证版对应的线索 ${confFriend.point}/${confFriend.pin}`);
  else if (tFriend.text !== confFriend.text) fail("G02 看到之后再问关键问题，已有线索没有换成印证版");
  else ok("G02 问在看见之后 → 已收集的线索也换成印证版");
  await page.click('#askBtns button[data-close="1"]');
  await page.waitForTimeout(300);

  // ---- 线索本：四类线索齐全（ask 是第四类），三级提示也按这一轮改口
  await page.keyboard.press("Tab");
  await page.waitForTimeout(320);
  const nb = await page.evaluate(() => ({
    open: !document.getElementById("nb").hidden && document.getElementById("nb").classList.contains("show"),
    n: document.querySelectorAll("#nbList li").length,
    see: document.querySelectorAll("#nbList li.k-see").length,
    rem: document.querySelectorAll("#nbList li.k-rem").length,
    gue: document.querySelectorAll("#nbList li.k-gue").length,
    ask: document.querySelectorAll("#nbList li.k-ask").length,
    legend: document.querySelector("#nb .nb-legend").textContent,
    badge: document.getElementById("nbBtn").textContent
  }));
  if (!nb.open) fail("G02 按 Tab 没打开线索本");
  g = await G2();
  if (nb.n !== g.clues.length) fail(`G02 线索本里 ${nb.n} 条，实际收集 ${g.clues.length} 条`);
  if (nb.see !== 2 || nb.rem !== 1 || nb.gue !== 1) {
    fail(`G02 线索分类数量不对：see ${nb.see} / rem ${nb.rem} / gue ${nb.gue}`);
  }
  if (nb.ask !== 4) fail(`G02 线索本里「问到的」${nb.ask} 条，应该是 4 条`);
  if (nb.legend.indexOf("问到的") < 0) fail("G02 线索本图例里没有「问到的」");
  if (nb.badge.indexOf(String(g.clues.length)) < 0) fail(`G02 线索本入口上的数字不对：${nb.badge.trim()}`);
  await page.screenshot({ path: path.join(OUT, "s4-notebook.png") });

  // 线索本打开的时候人不能走
  const bx2 = (await S(page)).boy;
  await page.keyboard.down("KeyD");
  await page.waitForTimeout(340);
  await page.keyboard.up("KeyD");
  if (Math.abs((await S(page)).boy - bx2) > 1) fail("G02 线索本打开的时候人物还能走");

  // 三级提示：前两条不变，第三条按这一轮落点改口；问完之后按钮禁用
  await page.click("#nbHint");
  await page.waitForTimeout(280);
  const m1 = await page.evaluate(() => document.getElementById("msg").textContent);
  if (!m1 || m1.indexOf("出去过一次") < 0) fail(`G02 第一次问由乃，消息是「${m1}」`);
  if (!(await page.evaluate(() => document.getElementById("msg").classList.contains("show")))) {
    fail("G02 问了由乃，消息条没显示出来");
  }
  await page.screenshot({ path: path.join(OUT, "s6-msg.png") });
  await page.click("#nbHint");
  await page.waitForTimeout(280);
  const m2 = await page.evaluate(() => document.getElementById("msg").textContent);
  if (!m2 || m2 === m1) fail("G02 第二次问由乃，消息没变");
  await page.click("#nbHint");
  await page.waitForTimeout(280);
  const m3 = await page.evaluate(() => document.getElementById("msg").textContent);
  if (m3 !== "由乃" + round.hint3) {
    fail(`G02 第三条提示没有按落点改口：「${round.hint3}」，实际「${m3}」`);
  }
  const asked = await page.evaluate(() => document.getElementById("nbHint").disabled);
  if (!asked) fail("G02 三级提示都问完了，按钮还可以按");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(280);

  // ---- 在地图上想想：挑证据、站号、多一站、顺序、拼对
  await page.keyboard.press("Tab");
  await page.waitForTimeout(280);
  await page.click("#nbMap");
  await page.waitForTimeout(320);
  const map0 = await page.evaluate(() => ({
    open: !document.getElementById("map").hidden && document.getElementById("map").classList.contains("show"),
    spots: document.querySelectorAll("#map .spot").length,
    badges: document.querySelectorAll("#map .spot .cnt:not([hidden])").length,
    nbHidden: document.getElementById("nb").hidden
  }));
  if (!map0.open) fail("G02 线索本里点「在地图上想想」没打开平面图");
  if (map0.spots !== 7) fail(`G02 平面图上有 ${map0.spots} 个可点地点，应该是 7 个`);
  if (map0.badges < 3) fail(`G02 平面图上只有 ${map0.badges} 个地点挂着线索角标`);
  if (!map0.nbHidden) fail("G02 打开平面图时线索本还挂在上头");
  await page.screenshot({ path: path.join(OUT, "s7-map.png") });

  // 地图打开时人不能走
  const mx = (await S(page)).boy;
  await page.keyboard.down("KeyD");
  await page.waitForTimeout(340);
  await page.keyboard.up("KeyD");
  if (Math.abs((await S(page)).boy - mx) > 1) fail("G02 平面图打开的时候人物还能走");

  // 钉地点之前先挑一句证据；证据和地点对不上就钉不上，面板也不关。
  async function pinSpot(spot, wantText) {
    await page.click(`#map .spot[data-spot="${spot}"]`);
    await page.waitForTimeout(150);
    const picked = await page.evaluate((want) => {
      const b = [...document.querySelectorAll("#mapPickList button")]
        .find((x) => x.textContent.indexOf(want) >= 0);
      if (!b) return false;
      b.click();
      return true;
    }, wantText);
    await page.waitForTimeout(180);
    if (!picked) fail(`G02 钉「${spot}」的时候，线索里找不到「${wantText}」`);
  }
  const clueWithPin = (pin) => g.clues.find((c) => c.pin === pin && c.kind !== "ask");
  const c1 = clueWithPin(round.route[0]);
  const c2 = clueWithPin(round.route[1]);
  const c3 = clueWithPin(round.route[2]);
  const decoy = g.clues.find((c) => c.pin === "cctv");
  if (!c1 || !c2 || !c3) fail("G02 路线上三站的线索没有都收集到");
  if (!decoy) fail("G02 没有监控那条干扰线索");

  // 先拿监控那条 ask 线索去钉教室：不该钉上，线索也不能被吃掉
  await page.click('#map .spot[data-spot="classroom"]');
  await page.waitForTimeout(150);
  const pickOpen = await page.evaluate(() => ({
    open: !document.getElementById("mapPick").hidden,
    n: document.querySelectorAll("#mapPickList button").length
  }));
  if (!pickOpen.open) fail("G02 点地点之后没有摊出线索让你挑");
  if (pickOpen.n < 3) fail(`G02 挑证据的列表里只有 ${pickOpen.n} 条线索`);
  await page.screenshot({ path: path.join(OUT, "s7a-map-pick.png") });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("#mapPickList button")]
      .find((x) => x.textContent.indexOf("监控") >= 0);
    if (b) b.click();
  });
  await page.waitForTimeout(200);
  const wrongEv = await page.evaluate(() => ({
    pins: window.__daily.current.pins.length,
    pick: window.__daily.current.pickFor,
    said: document.getElementById("mapSaid").textContent,
    open: !document.getElementById("mapPick").hidden
  }));
  if (wrongEv.pins !== 0) fail("G02 证据和地点对不上，地点却钉上了");
  if (wrongEv.pick !== "classroom" || !wrongEv.open) fail("G02 证据挑错之后挑证据的面板关了");
  if (wrongEv.said.indexOf("别的地方") < 0) fail(`G02 证据挑错之后地图说「${wrongEv.said}」`);
  await page.screenshot({ path: path.join(OUT, "s7a2-map-wrong-clue.png") });
  await page.click("#mapPickClose");
  await page.waitForTimeout(160);

  // 钉到第二站：线先按钉的先后画出来，站号也跟着编
  await pinSpot(round.route[0], c1.text);
  await pinSpot(round.route[1], c2.text);
  const sketch = await page.evaluate(() => ({
    pts: document.getElementById("mapRoute").getAttribute("points"),
    drawing: document.getElementById("map").classList.contains("drawing"),
    ords: [...document.querySelectorAll("#map .spot .ord:not([hidden])")].map((o) => o.textContent),
    pins: window.__daily.current.pins.join(",")
  }));
  if (!sketch.pts || !sketch.drawing) fail("G02 钉到第二站，地图上没有先连一条线");
  if (sketch.ords.join(",") !== "1,2") fail(`G02 钉了两站，站号是 ${sketch.ords.join(",")}，应该是 1,2`);
  if (sketch.pins !== round.route.slice(0, 2).join(",")) fail(`G02 钉了两站，实际钉的是 ${sketch.pins}`);

  // 多钉一站（监控）→ 只提示「多了一站」，不拦路
  await pinSpot("cctv", decoy.text);
  await pinSpot(round.route[2], c3.text);
  await page.click("#mapCheck");
  await page.waitForTimeout(250);
  const over = await page.evaluate(() => ({
    said: document.getElementById("mapSaid").textContent,
    solved: window.__daily.current.routeSolved,
    tries: window.__daily.current.routeTries,
    line: document.getElementById("mapRoute").getAttribute("points"),
    drawn: document.getElementById("map").classList.contains("solved")
  }));
  if (over.solved) fail("G02 钉了四站（含监控）居然判成拼对了");
  if (over.said.indexOf("多了一站") < 0) fail(`G02 多钉一站之后地图说「${over.said}」`);
  if (over.tries !== 1) fail(`G02 拼错一次，routeTries 是 ${over.tries}`);
  if (!over.line) fail("G02 钉了四站，玩家连的线却没画出来");
  if (over.drawn) fail("G02 拼错的时候地图却亮成拼对的样子");
  await page.screenshot({ path: path.join(OUT, "s7b-map-wrong.png") });
  await page.click('#map .spot[data-spot="cctv"]');       // 去掉多出来的一站

  // 打乱顺序：前两站互换 → 只提示「顺序不对」
  for (const id of round.route) {
    await page.click(`#map .spot[data-spot="${id}"]`);
    await page.waitForTimeout(80);
  }
  await pinSpot(round.route[1], c2.text);
  await pinSpot(round.route[0], c1.text);
  await pinSpot(round.route[2], c3.text);
  await page.click("#mapCheck");
  await page.waitForTimeout(250);
  const wrongOrder = await page.evaluate(() => ({
    said: document.getElementById("mapSaid").textContent,
    solved: window.__daily.current.routeSolved,
    pins: window.__daily.current.pins.join(","),
    saved: window.__daily.store().searchRouteSolved === true
  }));
  if (wrongOrder.solved) fail("G02 三站集合一样、顺序反了，居然判成拼对了");
  if (wrongOrder.said.indexOf("顺序") < 0) fail(`G02 顺序错的时候地图说「${wrongOrder.said}」`);
  if (wrongOrder.pins !== [round.route[1], round.route[0], round.route[2]].join(",")) {
    fail(`G02 打乱之后的钉子是 ${wrongOrder.pins}`);
  }
  if (wrongOrder.saved) fail("G02 顺序错了也存下了 searchRouteSolved");
  await page.screenshot({ path: path.join(OUT, "s7b2-map-order.png") });

  // 全部取消，再按她走过的先后钉：教室 → 饮水机 → 楼梯
  for (const id of [round.route[1], round.route[0], round.route[2]]) {
    await page.click(`#map .spot[data-spot="${id}"]`);
    await page.waitForTimeout(80);
  }
  await pinSpot(round.route[0], c1.text);
  await pinSpot(round.route[1], c2.text);
  await pinSpot(round.route[2], c3.text);
  await page.click("#mapCheck");
  await page.waitForTimeout(300);
  const right = await page.evaluate(() => ({
    said: document.getElementById("mapSaid").textContent,
    solved: window.__daily.current.routeSolved,
    pins: window.__daily.current.pins.join(","),
    saved: window.__daily.store().searchRouteSolved === true,
    line: document.getElementById("mapRoute").getAttribute("points"),
    drawn: document.getElementById("map").classList.contains("solved"),
    check: document.getElementById("mapCheck").disabled,
    obj: document.getElementById("objSub").textContent
  }));
  const wantLine = round.route.map((id) => round.spots[id].x + "," + round.spots[id].y).join(" ");
  if (!right.solved) fail("G02 三站按顺序钉对了，routeSolved 还是 false");
  if (right.said.indexOf("那就是这条") < 0) fail(`G02 拼对之后地图说「${right.said}」`);
  if (right.pins !== round.route.join(",")) fail(`G02 拼对的钉子和顺序是 ${right.pins}`);
  if (!right.saved) fail("G02 拼对之后没有存下 searchRouteSolved");
  if (!right.line || right.line !== wantLine) fail(`G02 拼对之后地图上的线是「${right.line}」`);
  if (!right.drawn) fail("G02 拼对之后地图上的线没亮");
  if (!right.check) fail("G02 拼对之后「看看这条线」还能再按");
  if (right.obj.indexOf(round.destName) < 0) fail(`G02 拼对之后目标卡没改口：「${right.obj}」`);
  await page.screenshot({ path: path.join(OUT, "s7c-map-solved.png") });

  await page.click("#mapClose");
  await page.waitForTimeout(320);
  const closed = await page.evaluate(() => ({
    open: !document.getElementById("map").hidden,
    state: window.__daily.current.state
  }));
  if (closed.open) fail("G02 点「合上」之后平面图还挂着");
  if (closed.state !== "search") fail(`G02 合上平面图之后状态是 ${closed.state}`);

  // ---- 去楼梯口把卡捡起来（这一轮卡在台阶上，拼对过路线 → 第二句「果然」）
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  g = await G2();
  const clueN = g.clues.length;
  const hintN = g.hints;
  await ensureScene(page, "stair", "KeyA");
  await page.waitForFunction((want) => {
    const x = window.__daily.current;
    return !!x && x.steps >= want;
  }, stepMark + 1, { timeout: 8000 }).catch(() => {});
  g = await G2();
  if (g.steps !== stepMark + 1) fail(`G02 去楼梯口捡卡 steps 应从 ${stepMark} 到 ${stepMark + 1}，实际 ${g.steps}`);
  else ok(`G02 步数统计与自动行走一致（累计 ${g.steps} 次换场）`);
  stepMark = g.steps;
  await mark("去捡卡");
  await approach(page, g.cardSpot.x);
  await waitHint(page, g.cardSpot.findHint.replace("E · ", "").slice(0, 3));
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(500);
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(260);
  const foundLine = await page.evaluate(() => document.getElementById("line").textContent);
  if (foundLine.indexOf("果然") < 0) fail(`G02 拼对之后捡卡，第二句是「${foundLine}」，没有「果然」`);
  await page.screenshot({ path: path.join(OUT, "s2-found.png") });

  // 这一遍故意不选「怎么还给她」：6 秒后要自己往下走，不能拦关。
  if (!(await drainToGiveBack(page))) fail("G02 第二遍没有出现「怎么还给她」");
  await page.screenshot({ path: path.join(OUT, "s2b-return.png") });
  await page.waitForFunction(() => document.getElementById("giveBack").hidden,
    null, { timeout: 9000 }).catch(() => fail("G02 不选「怎么还」时卡住了"));
  const rc2 = await page.evaluate(() => {
    const x = window.__daily.current;
    return x ? x.returnChoice : null;
  });
  if (rc2 !== null && rc2 !== -1) fail(`G02 故意不选，returnChoice 却是 ${rc2}`);
  // 一边读收尾一边记台词：步数评价只在措辞里。
  const tailLines = [];
  const tailOver = await drainToEnd(page, 20000, tailLines);
  if (!tailOver) fail("G02 第二遍结束后壳没有回到自由走动");
  if (!tailLines.some((x) => x.indexOf("心里有谱") >= 0)) {
    fail(`G02 这一遍只走了 ${stepMark} 次换场，收尾应该是少步数口径（实际：${tailLines.join(" | ")}）`);
  }

  const done = await page.evaluate(() => ({
    saved: window.__daily.store().searchCompleted === true,
    clues: window.__daily.store().searchClues,
    hints: window.__daily.store().searchHints,
    runs: window.__daily.store().searchRuns,
    routeSolved: window.__daily.store().searchRouteSolved
  }));
  if (!done.saved) fail("G02 找完没有存下 searchCompleted");
  if (done.clues !== clueN) {
    fail(`G02 存档里的线索数 ${done.clues} 和线索本 ${clueN} 不一致 ｜ 轨迹：${trace.join(" → ")}`);
  }
  if (done.hints !== 3) fail(`G02 问了三次提示，存档里是 ${done.hints}`);
  if (done.hints !== hintN) fail("G02 存档里的提示次数和游戏内对不上");
  if (done.runs !== 2) fail(`G02 第二次通关后 searchRuns 应该是 2，实际 ${done.runs}`);
  if (done.routeSolved !== true) fail("G02 拼对路线没落盘");
  await page.screenshot({ path: path.join(OUT, "s8-hub.png") });

  // ================= 旧存档兼容：searchClues 等旧键读入不报错 =================
  // 单开一个浏览器上下文来装旧存档，不污染主页面已经跑出来的存档。
  // 全通存档 + ?hub=1：壳不跳转，压整章结果卡；「回到目录」后才露出调试目录。
  const oldSave = {
    errandCompleted: true, soloJurieCompleted: true,
    searchCompleted: true, searchClues: 4, searchHints: 2, searchRouteSolved: false,
    soloYunoCompleted: true, wordGameCompleted: true, wordGameCorrect: 7, wordGameHints: 2,
    ballGameCompleted: true, chapterDailyDone: true
  };
  const oldBrowser = await chromium.launch({ channel: "chrome" });
  const p2 = await oldBrowser.newPage({ viewport: { width: 1280, height: 720 } });
  const p2errors = [];
  p2.on("pageerror", (e) => p2errors.push("pageerror: " + e.message));
  p2.on("console", (m) => { if (m.type() === "error") p2errors.push("console: " + m.text()); });
  await p2.addInitScript((data) => {
    localStorage.setItem("our-story-act5-daily-v1", JSON.stringify(data));
  }, oldSave);
  await p2.goto(PAGE_HUB, { waitUntil: "load", timeout: 60000 });
  await p2.waitForFunction(() => window.__daily && window.__daily.events, null, { timeout: 30000 });
  await p2.waitForTimeout(1200);
  const oldOk = await p2.evaluate(() => {
    const st = window.__daily.store();
    return {
      url: location.href,
      card: !document.getElementById("card").hidden,
      clues: st.searchClues, hints: st.searchHints,
      runs: st.searchRuns, errandRuns: st.errandRuns, words: st.wordGameCorrect
    };
  });
  if (oldOk.url.indexOf("narrative") >= 0) fail("G02 旧存档 + ?hub=1 不该跳收尾");
  if (!oldOk.card) fail("G02 旧存档读入后整章结果卡没出来");
  if (oldOk.clues !== 4 || oldOk.hints !== 2) fail("G02 旧存档的 searchClues / searchHints 没保留");
  if (oldOk.words !== 7) fail("G02 旧存档的 wordGameCorrect 没保留");
  if (oldOk.runs !== undefined || oldOk.errandRuns !== undefined) {
    fail("G02 旧存档没有新的游玩次计数，读进来应该是缺省（不写脏值）");
  }
  // 结果卡 → 回到目录 → 调试目录露出来，六个都是「可重访」
  await p2.click("#cardBack");
  await p2.waitForTimeout(400);
  const oldHub = await p2.evaluate(() => ({
    show: document.getElementById("hub").classList.contains("show"),
    done: document.querySelectorAll("#hubList li.done").length
  }));
  if (!oldHub.show) fail("G02 旧存档：结果卡「回到目录」没把目录压出来");
  if (oldHub.done !== 6) fail(`G02 旧存档：目录里「可重访」是 ${oldHub.done} 项，应该是 6`);
  // 旧存档下再进一次：游玩次从 0 起，首通参数不报错（play 的 Promise 不能 return，会死锁）
  await p2.evaluate(() => { window.__daily.play("search"); });
  await p2.waitForFunction(() => {
    const g = window.__daily.current;
    return !!g && g.id === "search";
  }, null, { timeout: 10000 }).catch(() => {});
  await p2.waitForTimeout(900);
  const p2start = await p2.evaluate(() => {
    const x = window.__daily.current;
    return x ? { state: x.state, runs: x.runs, spot: x.round.spot.id } : null;
  });
  if (!p2start || (p2start.state !== "intro" && p2start.state !== "search")) {
    fail("G02 旧存档下再进游戏起不来");
  } else if (p2start.runs !== 0 || p2start.spot !== "stairSill") {
    fail(`G02 旧存档下第一次游玩不是首通参数：runs ${p2start.runs} / ${p2start.spot}`);
  }
  if (p2errors.length) fail("G02 旧存档读入报错：" + p2errors.slice(0, 3).join(" | "));
  else ok("G02 旧存档（searchClues / searchHints 等）读入不报错，首通参数从 0 起");
  await oldBrowser.close();
  return done;
}

/** G04：俯视 2.5D 球场 —— 二维跑位、抢断圈上/下博弈、蓄力调左右与高度射门。
 *  先验抢断圈打错边会被晃、打空档能断球；再验蓄力时 W/S 改高度；最后站桩输一场、重开赢一场。 */
async function runBall(page) {
  // 一场球从开球到收尾。开局对白不是点完就有的：章节壳先淡出 220ms，
  // start 再淡入 420ms + 200ms。固定 sleep 会扑空，advanceAll 直接返回。
  const openMatch = async () => {
    await startEvent(page, "ball", "ball_match");
    await page.waitForFunction(() => {
      const g = window.__daily.current;
      return g && (g.state === "play" || window.DAILY.dialogOpen());
    }, null, { timeout: 15000 });
    await advanceAll(page);
    await page.waitForFunction(() => {
      const g = window.__daily.current;
      return g && g.state === "play";
    }, null, { timeout: 10000 }).catch(() => { });
  };

  const B = () => page.evaluate(() => {
    const g = window.__daily.current;
    const act = document.getElementById("bgAct");
    const board = document.getElementById("bgBoard");
    const pos = (k) => {
      const a = g && g.actors ? g.actors[k] : null;
      return a ? {
        x: a.x, d: a.d, sx: a.sx, sy: a.sy, face: a.face, moving: a.moving
      } : null;
    };
    return {
      id: g && g.id, state: g && g.state, mode: g && g.mode,
      holder: g && g.holder, windup: g && g.windup, winner: g && g.winner,
      me: pos("me"), yuno: pos("yuno"), jurie: pos("jurie"),
      ball: g && g.ball ? {
        x: g.ball.x, d: g.ball.d, z: g.ball.z, sx: g.ball.sx, sy: g.ball.sy
      } : null,
      scoreMe: g && g.scoreMe, scoreThem: g && g.scoreThem,
      feint: g && g.feint, stumbleT: g && g.stumbleT,
      duel: g && g.duel, duelGuard: g && g.duelGuard, duelT: g && g.duelT,
      charging: g && g.charging, power: g && g.power,
      aimAng: g && g.aimAng, aimX: g && g.aimX, aimZ: g && g.aimZ,
      aiSteal: g && g.aiSteal,
      keeper: g && g.keeper, roles: g && g.roles, ballOffFoot: g && g.ballOffFoot,
      stats: g && g.stats, calls: g && g.calls,
      keys: Object.keys(window.DAILY.keys).filter((k) => window.DAILY.keys[k]),
      config: g && g.config,
      dlg: window.DAILY.dialogOpen(),
      hud: document.getElementById("bgHud").classList.contains("show"),
      tip: document.getElementById("bgTip").textContent,
      ctl: !document.getElementById("bgCtl").hidden,
      act: act ? act.textContent : "",
      actSize: act ? act.getBoundingClientRect().width : 0,
      board: board ? board.getAttribute("src") : "",
      hub: document.getElementById("hub").classList.contains("show"),
      over: !window.__daily.current && !window.__daily.busy,
      obj: document.getElementById("objSub").textContent
    };
  });

  // 方向键的按下/松开只在变化时发，不然 30ms 一次 keydown 会把操作排队。
  function keyHolder() {
    const held = new Set();
    const apply = async (keys) => {
      for (const k of [...held]) {
        if (!keys.includes(k)) { await page.keyboard.up(k); held.delete(k); }
      }
      for (const k of keys) {
        if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
      }
    };
    return {
      set: apply,
      clear: () => apply([])
    };
  }

  function towardKeys(q, target, dead = 4) {
    const keys = [];
    if (target.sx < q.me.sx - dead) keys.push("KeyA");
    else if (target.sx > q.me.sx + dead) keys.push("KeyD");
    if (target.sy < q.me.sy - dead) keys.push("KeyW");
    else if (target.sy > q.me.sy + dead) keys.push("KeyS");
    return keys;
  }

  /** 追上持球人并把抢断圈打开；顺便处理开球、散球和过场对白。 */
  async function openDuel(limitMs) {
    const h = keyHolder();
    const t0 = Date.now();
    try {
      while (Date.now() - t0 < limitMs) {
        const q = await B();
        if (!q.id) return null;
        if (q.dlg) { await h.clear(); await advanceAll(page); continue; }
        if (q.state === "goalPause" || q.state === "rest") {
          await h.clear(); await page.waitForTimeout(80); continue;
        }
        if (q.state !== "play") { await h.clear(); await page.waitForTimeout(60); continue; }
        if (q.duel) return q;
        if (q.stumbleT > 0) { await h.clear(); await page.waitForTimeout(60); continue; }
        if (q.holder === "me") {
          // 要验抢断，先站着把球让回给她
          await h.clear();
          await page.waitForTimeout(90);
          continue;
        }
        if (q.holder) {
          if (q.feint) { await h.clear(); await page.waitForTimeout(30); continue; }
          const target = q.holder === "yuno" ? q.yuno : q.jurie;
          if (Math.hypot(q.me.sx - target.sx, q.me.sy - target.sy) > 22) {
            await h.set(towardKeys(q, target));
            await page.waitForTimeout(35);
            continue;
          }
          await h.clear();
          await page.keyboard.press("KeyE");
          await page.waitForTimeout(90);
          const dq = await B();
          if (dq.duel) return dq;
          continue;
        }
        const target = q.ball;
        if (Math.hypot(q.me.sx - target.sx, q.me.sy - target.sy) > 20) {
          await h.set(towardKeys(q, target));
          await page.waitForTimeout(35);
        } else {
          await h.clear();
          await page.keyboard.press("KeyE");
          await page.waitForTimeout(100);
        }
      }
    } finally {
      await h.clear();
    }
    return null;
  }

  /** 在抢断圈里选边。side = "open" 打死角，side = "guard" 故意撞她护住的一边。 */
  async function pickDuel(side) {
    let q = await B();
    if (!q.duel) return false;
    if (q.duelT < 0.5) {
      await page.waitForTimeout(Math.ceil((0.5 - q.duelT) * 1000) + 40);
      q = await B();
    }
    if (!q.duel) return false;
    const guard = q.duelGuard;
    const key = side === "open"
      ? (guard === "up" ? "KeyS" : "KeyW")
      : (guard === "up" ? "KeyW" : "KeyS");
    await page.keyboard.press(key);
    await page.waitForTimeout(140);
    return true;
  }

  /** 循环抢断，直到球在玩家脚下。 */
  async function winBall(limitMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < limitMs) {
      const q = await openDuel(8000);
      if (!q) return null;
      await pickDuel("open");
      const r = await B();
      if (r.holder === "me") return r;
      await page.waitForTimeout(450);
    }
    return null;
  }

  // 玩家的进攻脚本：断球后往远处带；到射程里蓄高球（§6.5 三把锁下的正解——
  // 守门员只扑 z1 < 0.50 的低球，高球从她头上过去）。顺带记下守门状态机。
  async function playWin(timeoutMs) {
    const h = keyHolder();
    let last = null;
    let goalsSeen = 0;
    let sawKeeper = false, keeperAt = null, sawRoles = null;
    let shotTries = 0;
    const t0 = Date.now();
    try {
      while (Date.now() - t0 < timeoutMs) {
        const q = await B();
        if (q.id) last = q;
        if (!q.id) break;
        if (q.keeper && q.keeper.active) {
          sawKeeper = true;
          if (keeperAt == null) keeperAt = { d: q.me.d, who: q.keeper.who };
        }
        if (q.roles) sawRoles = q.roles;
        if (q.state === "rest" || q.state === "done") break;
        if (q.dlg) { await h.clear(); await advanceAll(page); continue; }
        if (q.state === "goalPause") {
          await h.clear();
          const goals = (q.scoreMe || 0) + (q.scoreThem || 0);
          if (goals > goalsSeen) {
            goalsSeen = goals;
            await page.waitForTimeout(40);
            const g2 = await B();
            const want = `scoreboard_${g2.scoreMe}_${g2.scoreThem}.png`;
            if (!g2.board || g2.board.indexOf(want) < 0) {
              fail(`G04 记分牌没有跟着比分变成 ${g2.scoreMe}:${g2.scoreThem}`);
            }
            if (goals === 1) {
              await page.screenshot({ path: path.join(OUT, "b2b-goal.png") }).catch(() => { });
            }
          }
          await page.waitForTimeout(80);
          continue;
        }
        if (q.state !== "play") { await h.clear(); await page.waitForTimeout(60); continue; }

        if (q.holder === "me") {
          if (q.stumbleT > 0) { await h.clear(); await page.waitForTimeout(50); continue; }
          if (q.me.d < 0.84) {
            const keys = ["KeyW"];
            if (q.me.x < 0.44) keys.push("KeyD");
            else if (q.me.x > 0.56) keys.push("KeyA");
            await h.set(keys);
            await page.waitForTimeout(40);
            continue;
          }
          await h.clear();
          await page.keyboard.down("Space");
          await page.keyboard.down("KeyW");
          // 一直抬到 aimZ ≥ 0.54（高过 keeperLowZ 0.50）再松手；被贴身时蓄力慢，所以看高度不看时间
          let charged = false;
          const tShot = Date.now();
          while (Date.now() - tShot < 2600) {
            await page.waitForTimeout(60);
            const c = await B();
            if (c.holder !== "me" || !c.charging) break;
            if (c.aimZ >= 0.54) { charged = true; break; }
          }
          await page.keyboard.up("KeyW");
          await page.keyboard.up("Space");
          shotTries++;
          await page.waitForTimeout(150);
          continue;
        }

        if (q.holder) {
          if (q.feint) { await h.clear(); await page.waitForTimeout(40); continue; }
          const target = q.holder === "yuno" ? q.yuno : q.jurie;
          if (Math.hypot(q.me.sx - target.sx, q.me.sy - target.sy) > 22) {
            await h.set(towardKeys(q, target));
            await page.waitForTimeout(35);
            continue;
          }
          await h.clear();
          await page.keyboard.press("KeyE");
          await page.waitForTimeout(90);
          await pickDuel("open");
          continue;
        }

        if (q.ball) {
          if (Math.hypot(q.me.sx - q.ball.sx, q.me.sy - q.ball.sy) > 20) {
            await h.set(towardKeys(q, q.ball));
            await page.waitForTimeout(35);
          } else {
            await h.clear();
            await page.keyboard.press("KeyE");
            await page.waitForTimeout(110);
          }
          continue;
        }
        await h.clear();
        await page.waitForTimeout(80);
      }
    } finally {
      await h.clear();
    }
    return Object.assign({}, last, { sawKeeper: sawKeeper, keeperAt: keeperAt, sawRoles: sawRoles, shotTries: shotTries });
  }

  // 站桩：不碰键，由乃会来把球抢走，再打反击。
  async function playLose(timeoutMs) {
    let last = null;
    let shot = false;
    let sawWindup = false;
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const q = await B();
      if (q.id) last = q;
      if (!q.id) break;
      if (q.aiSteal) sawWindup = true;
      if (q.state === "rest" || q.state === "done") break;
      if (q.dlg) { await advanceAll(page); continue; }
      if (q.state === "goalPause" && q.scoreThem >= 1 && !shot) {
        shot = true;
        await page.screenshot({ path: path.join(OUT, "b5-lose-play.png") }).catch(() => { });
      }
      await page.waitForTimeout(90);
    }
    return last ? Object.assign({}, last, { sawWindup: sawWindup }) : null;
  }

  // 跟着由乃找她的假动作窗口；窗口里按 E 会被晃。
  async function followFeint(ms) {
    const h = keyHolder();
    let found = null;
    const t0 = Date.now();
    try {
      while (Date.now() - t0 < ms) {
        const q = await B();
        if (!q.id) break;
        if (q.state === "rest" || q.state === "done") break;
        if (q.dlg) { await h.clear(); await advanceAll(page); continue; }
        if (q.state !== "play") { await h.clear(); await page.waitForTimeout(60); continue; }
        if (q.holder === "yuno") {
          if (q.feint && Math.hypot(q.me.sx - q.yuno.sx, q.me.sy - q.yuno.sy) <= 26) {
            found = q;
            break;
          }
          await h.set(towardKeys(q, q.yuno, 6));
          await page.waitForTimeout(28);
          continue;
        }
        await h.clear();
        await page.waitForTimeout(60);
      }
    } finally {
      await h.clear();
    }
    return found;
  }

  await openMatch();

  let s = await B();
  if (s.id !== "ball_match") fail(`点「体育活动」，进的是 ${s.id}`);
  if (s.state !== "play") fail(`G04 开场对白读完，状态是 ${s.state}`);
  if (!s.hud || !s.ctl) fail("G04 的记分牌或触控区没显示");
  if (s.actSize < 70) fail(`G04 触控按钮只有 ${s.actSize}px，手指按不住`);
  if (s.obj.indexOf("三个球") < 0) fail(`G04 目标卡写的是「${s.obj}」`);
  if (s.scoreMe !== 0 || s.scoreThem !== 0) fail(`G04 开球比分不是 0:0，是 ${s.scoreMe}:${s.scoreThem}`);
  if (!s.board || s.board.indexOf("scoreboard_0_0.png") < 0) {
    fail(`G04 开局记分牌不是 0:0（src=${s.board}）`);
  }
  // 玩家必须是最快的，而且要能往纵深跑
  const cfg = s.config || {};
  if (!(cfg.playerSpeed > cfg.yunoSpeed && cfg.yunoSpeed > cfg.jurieSpeed)) {
    fail(`G04 跑速不是玩家最快：${cfg.playerSpeed}/${cfg.yunoSpeed}/${cfg.jurieSpeed}`);
  }
  if (!cfg.farY || !cfg.nearY || !cfg.nearW || !cfg.farW) {
    fail("G04 没有俯视球场的纵深参数（nearY/farY/nearW/farW）");
  }
  await page.waitForTimeout(320);        // 等对白框淡完，不然拍到半透明的上一句
  await page.screenshot({ path: path.join(OUT, "b0-start.png") });
  await noOverlap(page, "#reactBtn", "#bgAct", "G04");
  await noOverlap(page, "#react", "#bgHud", "G04");

  // F 喊一声：不改球权、不改比分，只是一句来回
  await pokeOnce(page, "G04", "ball_match", "calls", "喊一声",
    [["这边——", "看好了", "球给我"],
     ["你自己来拿", "看着呢", "自己来抢"]]);
  await page.screenshot({ path: path.join(OUT, "b0b-call.png") });

  // 一、二维跑位：W 往远处、D 往右，两个方向都要真的动。
  //     开球后电脑很快会进球，所以要挑「play」的窗口重试，别把一次进球误判成按键失灵。
  const hm = keyHolder();
  // 开球后电脑几秒就能打进一球，进球会切 1.5s 的 goalPause。
  // 所以按键探针要在「play」窗口里采样：先等 play，再按住并每 60ms 取一次快照，
  // 只拿 play 状态的快照做判断——被进球打断不算按键失灵。
  async function probeMove(key, ms, check) {
    let best = null;
    for (let i = 0; i < 14; i++) {
      let q0 = await B();
      const t0 = Date.now();
      while ((q0.dlg || q0.state !== "play") && Date.now() - t0 < 3200) {
        if (q0.dlg) await advanceAll(page);
        await page.waitForTimeout(80);
        q0 = await B();
      }
      if (q0.dlg || q0.state !== "play") { await page.waitForTimeout(120); continue; }
      await hm.set([key]);
      const steps = Math.max(3, Math.round(ms / 60));
      for (let t = 0; t < steps; t++) {
        await page.waitForTimeout(Math.round(ms / steps));
        const q = await B();
        if (q.state !== "play" || q.duel || q.stumbleT > 0) break;
        if (!best || check(q0, q)) best = { q0: q0, q1: q };
        if (check(q0, q)) { await hm.clear(); return { q0: q0, q1: q, ok: true }; }
      }
      await hm.clear();
      await page.waitForTimeout(160);
    }
    return Object.assign({ ok: false }, best || {});
  }

  const wMove = await probeMove("KeyW", 300, (a, b) => b.me.d > a.me.d + 0.10);
  if (!wMove.ok) {
    if (!wMove.q0) fail("G04 读不到玩家的位置");
    else {
      fail(`G04 按 W 没有往远处走（d ${wMove.q0.me.d.toFixed(2)} → ${wMove.q1.me.d.toFixed(2)}）`);
      if (!(wMove.q1.me.sy < wMove.q0.me.sy - 6)) {
        fail(`G04 往远处走，屏幕上的脚没有上移（sy ${wMove.q0.me.sy.toFixed(1)} → ${wMove.q1.me.sy.toFixed(1)}）`);
      }
    }
  } else if (!(wMove.q1.me.sy < wMove.q0.me.sy - 4)) {
    fail(`G04 往远处走，屏幕上的脚没有上移（sy ${wMove.q0.me.sy.toFixed(1)} → ${wMove.q1.me.sy.toFixed(1)}）`);
  }

  const dMove = await probeMove("KeyD", 240, (a, b) => b.me.x > a.me.x + 0.025);
  if (!dMove.ok) {
    if (dMove.q0) {
      fail(`G04 按 D 没有往右走（x ${dMove.q0.me.x.toFixed(2)} → ${dMove.q1.me.x.toFixed(2)}）`);
    } else fail("G04 读不到玩家的位置");
  }
  await page.screenshot({ path: path.join(OUT, "b0c-move.png") });

  // 二、抢断圈：先故意打她护住的一边，必须被晃、球还在她脚下
  let duelQ = await openDuel(14000);
  if (!duelQ) fail("G04 近不了持球人的身，抢断圈打不开");
  else {
    await page.screenshot({ path: path.join(OUT, "b1-duel.png") });
    await pickDuel("guard");
    s = await B();
    if (s.holder !== "yuno" && s.holder !== "jurie") {
      fail("G04 在抢断圈里撞她护住的一边，居然把球断下来了");
    }
    if (!(s.stumbleT > 0)) {
      fail("G04 在抢断圈里撞她护住的一边，玩家没有「被晃」的停顿");
    }
    if (!s.stats || s.stats.duelFails < 1) fail("G04 抢断圈打错边却没记下反馈");
    await page.screenshot({ path: path.join(OUT, "b1b-duel-fail.png") });
  }

  // 三、抢断圈打空档：W / S 绕开她护住的那一半，球必须断下来
  s = await winBall(16000);
  if (!s) fail("G04 抢断圈打空档，16 秒都没把球断下来");
  else {
    if (s.holder !== "me") fail("G04 抢断圈打空档，球还是没到玩家脚下");
    if (!s.stats || s.stats.tackles < 1) fail("G04 断球成功却没记下抢断");
    if (!s.act || s.act.indexOf("蓄力") < 0) fail("G04 拿到球之后按钮没换成蓄力射门");
    if (s.tip.indexOf("带球") < 0) fail(`G04 拿到球之后提示还是「${s.tip}」`);
    await page.screenshot({ path: path.join(OUT, "b2-tackle.png") });
  }

  // 四、蓄力时 A/D 转射门角度、W/S 调高度，松手出脚
  let shotStats = null;
  const hs = keyHolder();
  const tShoot = Date.now();
  try {
    while (Date.now() - tShoot < 12000) {
      let q = await B();
      if (q.dlg) { await hs.clear(); await advanceAll(page); continue; }
      if (q.state !== "play") { await hs.clear(); await page.waitForTimeout(70); continue; }
      if (q.holder !== "me") {
        if (q.holder) {
          const target = q.holder === "yuno" ? q.yuno : q.jurie;
          if (Math.hypot(q.me.sx - target.sx, q.me.sy - target.sy) > 22) {
            await hs.set(towardKeys(q, target));
            await page.waitForTimeout(35);
            continue;
          }
          await hs.clear();
          await page.keyboard.press("KeyE");
          await page.waitForTimeout(90);
          await pickDuel("open");
        } else if (q.ball) {
          await hs.set(towardKeys(q, q.ball));
          await page.waitForTimeout(35);
        }
        continue;
      }
      if (q.me.d < 0.74) {
        await hs.set(["KeyW"]);
        await page.waitForTimeout(35);
        continue;
      }
      await hs.clear();
      await page.keyboard.down("Space");
      await page.waitForTimeout(60);
      const c0 = await B();
      await page.keyboard.down("KeyW");
      await page.waitForTimeout(300);
      await page.keyboard.up("KeyW");
      await page.keyboard.down("KeyA");
      await page.waitForTimeout(220);
      await page.keyboard.up("KeyA");
      const c1 = await B();
      if (!c1.charging) {
        await page.keyboard.up("Space");
        await page.waitForTimeout(300);
        continue;
      }
      if (!(c1.aimZ > c0.aimZ + 0.08)) {
        fail(`G04 蓄力时按 W，射门高度没有抬高（${c0.aimZ.toFixed(2)} → ${c1.aimZ.toFixed(2)}）`);
      }
      if (!(c1.aimAng < c0.aimAng - 0.15)) {
        fail(`G04 蓄力时按 A，射门角度没有往左转（${c0.aimAng.toFixed(2)} → ${c1.aimAng.toFixed(2)} 弧度）`);
      }
      if (!(c1.aimX < c0.aimX - 0.008)) {
        fail(`G04 蓄力时按 A，射门落点没有跟着角度往左（${c0.aimX.toFixed(2)} → ${c1.aimX.toFixed(2)}）`);
      }
      if (!(c1.power > 0.3 && c1.power < 1)) {
        fail(`G04 蓄力 0.58 秒，力度是 ${c1.power.toFixed(2)}，不在正常区间`);
      }
      if (c1.tip.indexOf("角度") < 0) {
        fail(`G04 蓄力时提示没有说 A/D 调角度：「${c1.tip}」`);
      }
      await page.screenshot({ path: path.join(OUT, "b3-aim.png") });
      // 截图可能花掉几百毫秒；这期间电脑可能把球偷走。松手前再确认一次球还在脚下。
      const cPre = await B();
      if (cPre.holder !== "me" || !cPre.charging) {
        await page.keyboard.up("Space");
        await page.waitForTimeout(250);
        continue;
      }
      const beforeShots = cPre.stats.shots;
      await page.keyboard.up("Space");
      await page.waitForTimeout(250);
      const c2 = await B();
      shotStats = c2.stats;
      if (!c2.stats || c2.stats.shots <= beforeShots) {
        fail("G04 松手之后没有记下这一脚射门");
      }
      if (c2.mode !== "shot" && c2.state !== "goalPause" && c2.mode !== "loose" &&
          c2.holder !== "yuno" && c2.holder !== "jurie" && c2.holder !== "me") {
        fail(`G04 松手之后球的状态是 ${c2.mode}`);
      }
      await page.screenshot({ path: path.join(OUT, "b3b-shot.png") });
      break;
    }
  } finally {
    await hs.clear();
  }
  if (!shotStats) fail("G04 12 秒都没能拿住球完成一次蓄力射门");

  // 五、假动作窗口：她做动作时按 E 会被晃过去，球还在她脚下
  let feinted = null;
  for (let i = 0; i < 5 && !feinted; i++) {
    const q = await followFeint(9000);
    if (!q) break;
    await page.keyboard.press("KeyE");
    await page.waitForTimeout(90);
    const r = await B();
    if (r.stumbleT > 0 && r.holder === "yuno") {
      feinted = r;
      break;
    }
    if (r.duel) await pickDuel("open");
    await page.waitForTimeout(500);
  }
  if (!feinted) fail("G04 由乃带球 9 秒都没做出一次假动作，窗口根本没法验");
  else {
    if (feinted.holder !== "yuno") fail("G04 在假动作窗口里按 E，居然把球断下来了");
    if (!(feinted.stumbleT > 0)) fail("G04 在假动作窗口里按 E，玩家没有「被晃」的停顿");
    if (!feinted.stats || feinted.stats.stumbles < 1) fail("G04 被晃了却没记下反馈");
    await page.screenshot({ path: path.join(OUT, "b4-stumble.png") });
  }

  // 六、这一场不再做动作，站着让它打完 —— 这一场专门验「能输」。
  const loseEnd = await playLose(60000);
  if (!loseEnd) fail("G04 站桩局没有可读的收尾快照");
  if (loseEnd.state !== "rest" && loseEnd.state !== "done") {
    fail(`G04 玩家站着不动，60 秒都没打完（${loseEnd.scoreMe}:${loseEnd.scoreThem}）`);
  }
  if (loseEnd.scoreThem !== 3) fail(`G04 玩家站着不动，对面只进了 ${loseEnd.scoreThem} 球，没打完`);
  if (loseEnd.scoreMe >= 3) fail("G04 玩家站着不动还赢了，不可能");
  if (loseEnd.winner !== "them") fail(`G04 站桩局的赢家是 ${loseEnd.winner}，应该是对面`);
  // 抬手预警：90ms 轮询可能正好错开 0.32 秒的窗口，所以以整场累计计数为准（sawWindup 也接受）
  if (!loseEnd.sawWindup && !(loseEnd.stats && loseEnd.stats.aiWindups > 0)) {
    fail("G04 电脑断球前没有抬手预警（一次都没看到 aiSteal）");
  }
  const loseBoard = `scoreboard_${loseEnd.scoreMe}_${loseEnd.scoreThem}.png`;
  if (!loseEnd.board || loseEnd.board.indexOf(loseBoard) < 0) {
    fail(`G04 站桩局收尾记分牌不是 ${loseEnd.scoreMe}:${loseEnd.scoreThem}`);
  }
  await page.screenshot({ path: path.join(OUT, "b6-lose-rest.png") });
  await advanceAll(page);
  if (!(await waitEventOver(page, 20000))) fail("G04 站桩局结束后壳没有回到自由走动");
  s = await B();
  if (!s.over) fail("G04 站桩局结束后小游戏还没释放");
  if (s.hud) fail("G04 站桩局散场后记分牌还挂着");

  const store1 = await page.evaluate(() => window.__daily.store());
  if (store1.ballGameCompleted !== true) fail("G04 站桩局后没写 ballGameCompleted");
  let dirty = Object.keys(store1).filter((k) => /score|goal|win|lose/i.test(k));
  if (dirty.length) fail("G04 把比分/胜负写进了存档：" + dirty.join(","));

  // 七、重新开一场，从 0:0 开始让玩家赢
  await openMatch();
  s = await B();
  if (s.id !== "ball_match" || s.state !== "play") fail("G04 第二场没开起来");
  if (s.scoreMe !== 0 || s.scoreThem !== 0) fail("G04 第二场没有从 0:0 重新开球");
  if (!s.board || s.board.indexOf("scoreboard_0_0.png") < 0) fail("G04 第二场记分牌没有回到 0:0");

  const winEnd = await playWin(160000);
  if (!winEnd) fail("G04 第二场没有可读的收尾快照");
  if (winEnd.state !== "rest" && winEnd.state !== "done") {
    fail(`G04 第二场没在 160 秒内打完（${winEnd.scoreMe}:${winEnd.scoreThem}，${winEnd.state}）`);
  }
  if (winEnd.scoreMe !== 3) fail(`G04 第二场玩家进了 ${winEnd.scoreMe} 球，不是 3`);
  if (winEnd.scoreThem >= 3) fail(`G04 玩家先到 3 球，对面却也到了 ${winEnd.scoreThem}`);
  if (winEnd.winner !== "me") fail(`G04 第二场结算赢家是 ${winEnd.winner}，不是玩家`);
  const wantBoard = `scoreboard_${winEnd.scoreMe}_${winEnd.scoreThem}.png`;
  if (!winEnd.board || winEnd.board.indexOf(wantBoard) < 0) {
    fail(`G04 第二场收尾记分牌不是 ${winEnd.scoreMe}:${winEnd.scoreThem}`);
  }
  await advanceAll(page);
  if (!(await waitEventOver(page, 20000))) fail("G04 第二场结束后壳没有回到自由走动");
  s = await B();
  if (!s.over) fail("G04 第二场结束后小游戏还没释放");
  if (s.hud) fail("G04 第二场散场后记分牌还挂着");
  await page.waitForTimeout(380);
  await page.screenshot({ path: path.join(OUT, "b4-hub.png") });

  const store2 = await page.evaluate(() => window.__daily.store());
  if (store2.ballGameCompleted !== true) fail("G04 第二场后 ballGameCompleted 丢了");
  dirty = Object.keys(store2).filter((k) => /score|goal|win|lose/i.test(k));
  if (dirty.length) fail("G04 第二场把比分/胜负写进了存档：" + dirty.join(","));

  // 八、§6.8 确定性自检：__ball 的固定步进、无渲染，20 个种子几秒钟跑完。
  //     改前基线（同一脚本、改造前的 ball.js）是 20/20 = 100%，所以这条断言就是「一条龙被堵死」。
  if (!winEnd.sawKeeper) fail("G04 玩家带球进射程后，守门员一次都没进 keeper 态");
  else if (!winEnd.keeperAt || winEnd.keeperAt.d < 0.61) {
    fail(`G04 守门员进 keeper 态的时机不对（玩家 d=${winEnd.keeperAt && winEnd.keeperAt.d.toFixed(2)}）`);
  }
  if (!winEnd.sawRoles || !winEnd.sawRoles.press || !winEnd.sawRoles.cover) {
    fail("G04 场上没有防守分工（roles.press / roles.cover）");
  }

  const simT0 = Date.now();
  const sim = await page.evaluate(() => {
    if (!window.__ball || !window.__ball.testRoute) return null;
    const routes = [];
    for (let seed = 1; seed <= 20; seed++) routes.push(window.__ball.testRoute(seed));
    // P1-3：一条龙不能只测最弱的中路低球。死角 / 高球按同样的 20 个种子跑一遍，
    // 路线会像真实玩家一样抢回球权再起脚（见 ball.js simRoute 注释）。
    const variants = {};
    for (const v of ["corner-left", "corner-right", "high"]) {
      variants[v] = [];
      for (let seed = 1; seed <= 20; seed++) variants[v].push(window.__ball.testRoute(seed, v));
    }
    const detA = JSON.stringify(window.__ball.testRoute(7));
    const detB = JSON.stringify(window.__ball.testRoute(7));
    const detVA = JSON.stringify(window.__ball.testRoute(7, "high"));
    const detVB = JSON.stringify(window.__ball.testRoute(7, "high"));
    return {
      routes: routes,
      variants: variants,
      det: detA === detB && detVA === detVB,
      keeper: window.__ball.testKeeper(7),
      touch: window.__ball.testTouch(3),
      dash: window.__ball.testDash(3),
      spread: window.__ball.testSpread(11),
      scoreLead: window.__ball.testScore(1, 2, 0),
      scoreTrail: window.__ball.testScore(1, 0, 2),
      scoreTie: window.__ball.testScore(1, 0, 0)
    };
  });
  const simMs = Date.now() - simT0;
  if (!sim) fail("G04 没有 window.__ball 确定性测试入口（§6.8 要求固定步进、无渲染）");
  else {
    const routes = sim.routes;
    const goals = routes.filter((r) => r.goal).length;
    const stuck = routes.filter((r) => r.result === "timeout" || r.result.indexOf("state:") === 0);
    if (goals / routes.length > 0.30) {
      fail(`G04 一条龙 20 个种子进了 ${goals} 球（${Math.round(goals / routes.length * 100)}%），应该 ≤30%`);
    }
    if (stuck.length) fail(`G04 一条龙自检有 ${stuck.length} 个种子 8 秒都没结果`);
    // P1-3：死角 / 高球变体各跑 20 个种子，口径同样是进球率 ≤30%。
    // 每个种子都必须真的完成一次射门，否则变体名存实亡（只测到了被上抢）。
    const variantGoals = {};
    for (const v of ["corner-left", "corner-right", "high"]) {
      const list = sim.variants[v] || [];
      if (list.length !== 20) fail(`G04 变体路线 ${v} 没有跑满 20 个种子`);
      const vg = list.filter((r) => r.goal).length;
      variantGoals[v] = vg;
      if (vg / list.length > 0.30) {
        fail(`G04 变体路线 ${v} 20 个种子进了 ${vg} 球（${Math.round(vg / list.length * 100)}%），应该 ≤30%`);
      }
      if (!list.every((r) => r.aim)) {
        fail(`G04 变体路线 ${v} 有种子没走到射门，${v} 的球路没被真正测到`);
      }
      if (!list.every((r) => r.keeperSeen)) {
        fail(`G04 变体路线 ${v} 里守门员没有每次都进入 keeper 态`);
      }
      const vStuck = list.filter((r) => r.result === "timeout" || r.result.indexOf("state:") === 0);
      if (vStuck.length) fail(`G04 变体路线 ${v} 有 ${vStuck.length} 个种子 8 秒都没结果`);
    }
    // 变体的落点必须真的拨到死角 / 高球上，不能拨到一半就出脚。
    if (!sim.variants["corner-left"].every((r) => r.aim && r.aim.x >= 0.35 && r.aim.x <= 0.39)) {
      fail("G04 死角路线没有把落点拨到左侧门框内（x≈0.37）");
    }
    if (!sim.variants["corner-right"].every((r) => r.aim && r.aim.x >= 0.61 && r.aim.x <= 0.65)) {
      fail("G04 死角路线没有把落点拨到右侧门框内（x≈0.63）");
    }
    if (!sim.variants.high.every((r) => r.aim && r.aim.z >= 0.54)) {
      fail("G04 高球路线没有把落点抬过守门员的扑救线（z ≥ 0.54）");
    }
    if (!sim.det) fail("G04 同一个种子跑两次结果不一致，随机没走本局种子");
    if (!routes.every((r) => r.keeperSeen)) {
      fail("G04 一条龙路线里守门员没有每次都进入 keeper 态");
    }
    if (!sim.keeper.reached) fail("G04 带球过中线到 d ≥ 0.62 的自检没走到");
    if (sim.keeper.reached && !sim.keeper.keeperActive) {
      fail("G04 玩家过中线进入射程后，守线的 cover 没有进 keeper 态");
    }
    if (sim.keeper.keeperBefore) fail("G04 玩家还没过中线，守门员就先进门了");
    if (sim.keeper.roles && (sim.keeper.roles.press !== "yuno" || sim.keeper.roles.cover !== "jurie")) {
      fail(`G04 防守分工不对：${JSON.stringify(sim.keeper.roles)}`);
    }
    const sp = sim.spread;
    if (sp.zero.x !== 0.42 || sp.zero.z !== 0.31 || sp.zero2.x !== 0.638 || sp.zero2.z !== 0.55) {
      fail(`G04 σ=0 时射门落点没有严格等于瞄准点（${JSON.stringify(sp.zero)} / ${JSON.stringify(sp.zero2)}）`);
    }
    if (!sp.moved) fail("G04 打开散布后出手落点没变，σ 公式没生效");
    if (!(sp.sigma.high > sp.sigma.low && sp.sigma.far > sp.sigma.low &&
          sp.sigma.pressed > sp.sigma.low && sp.sigma.high > 0.06)) {
      fail(`G04 散布公式不随力度 / 距离 / 压迫变化：${JSON.stringify(sp.sigma)}`);
    }
    if (!(sim.touch.offFootStill > 0.03) || !sim.touch.stillAhead || sim.touch.sticky) {
      fail(`G04 球还粘在脚上 / 没停在朝向 0.05 前方：${JSON.stringify(sim.touch)}`);
    }
    if (!(sim.touch.turnSlips > 0)) fail("G04 急转 >100°/0.2s 时球没有往外多滑 0.02");
    if (!sim.dash.loose || !(sim.dash.depth > 0.14 && sim.dash.depth < 0.18) ||
        !(sim.dash.dashT > 0.3) || !(sim.dash.dashCd > 2.3)) {
      fail(`G04 Shift 拨球参数不对：${JSON.stringify(sim.dash)}`);
    }
    if (sim.scoreLead.pressLead !== 0.45 || sim.scoreLead.keeperErr !== 0.02 ||
        sim.scoreLead.coverBias !== 0) {
      fail(`G04 领先两球时没有加强上抢 / 收小守门误差：${JSON.stringify(sim.scoreLead)}`);
    }
    if (sim.scoreTrail.coverBias !== 0.04 || sim.scoreTrail.pressLead !== 0.35) {
      fail(`G04 落后两球时朱里没有偏一侧：${JSON.stringify(sim.scoreTrail)}`);
    }
    if (sim.scoreTie.pressLead !== 0.35 || sim.scoreTie.keeperErr !== 0.03 ||
        sim.scoreTie.coverBias !== 0) {
      fail(`G04 0:0 时比分起伏参数不是默认值：${JSON.stringify(sim.scoreTie)}`);
    }
    if (simMs > 5000) fail(`G04 20 个种子的确定性自检用了 ${simMs}ms，太慢（不能跑真实时间比赛）`);
    const afterSim = await page.evaluate(() => ({
      cur: window.__daily.current,
      ctl: document.getElementById("bgCtl").hidden,
      hud: document.getElementById("bgHud").classList.contains("show")
    }));
    if (afterSim.cur || !afterSim.ctl || afterSim.hud) {
      fail("G04 确定性自检把正常游戏的状态 / HUD 弄乱了");
    }
    const storeSim = await page.evaluate(() => window.__daily.store());
    if (Object.keys(storeSim).length !== Object.keys(store2).length) {
      fail("G04 确定性自检往存档里写了东西");
    }
    ok(`G04 §6.8 确定性自检：一条龙 20 种子进 ${goals} 球（${Math.round(goals / routes.length * 100)}%，` +
       `改前基线 100%）/ 死角左·右 ${variantGoals["corner-left"]}·${variantGoals["corner-right"]}/20、` +
       `高球 ${variantGoals.high}/20（高球是设计正解：守门员只扑 z<0.50 的低球，` +
       `代价是起脚前要站定拨高约 0.9 秒，上抢和封堵都在这窗口里）/ ` +
       `守线·守门前置 / σ=0 落点严格等于瞄准点 / 触球与拨球 / 比分起伏参数，` +
       `headless ${simMs}ms`);
  }

  ok(`G04：俯视 2.5D 球场 1 对 2 先进三球 —— 二维跑位、抢断圈上/下博弈（打错边被晃、` +
     `打空档断球）、蓄力 A/D 转角度 + W/S 调高度、电脑抢断有抬手都成立；` +
     `站桩输 ${loseEnd.scoreMe}:${loseEnd.scoreThem}，重开一场赢 ` +
     `${winEnd.scoreMe}:${winEnd.scoreThem}，比分不进存档`);
  return { win: [winEnd.scoreMe, winEnd.scoreThem],
           lose: [loseEnd.scoreMe, loseEnd.scoreThem] };
}

async function runBrowser() {
  const browser = await chromium.launch({
    channel: "chrome",
    args: ["--autoplay-policy=no-user-gesture-required"]
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  await page.goto(PAGE, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__daily && window.__daily.events, null, { timeout: 30000 });
  await page.evaluate(() => {
    window.__reactLog = [];
    window.DAILY.on("react", (r) => window.__reactLog.push(r.who + "：" + r.text));
  });

  // 默认进入 = 校园自由走动。runCampus 验完走动 / 换场景 / 贴近目标，结尾按 E 把 G01 开起来。
  stage("校园自由走动");
  await runCampus(page);
  stage("G01 一起去办事（首通 + 重玩）");
  const er = await runErrand(page);
  // G01 做完人还站在公告栏旁，按 E 直接进周二朱里；其余各场用调试口进。
  stage("周二 朱里（单人）");
  await runSolo(page, "jurie", { key: "soloJurieCompleted", reply: "soloJurieReply", value: "direct" }, true);
  // 先走「一句话不问直接找到」，再走「看全了再找」——两种都要成立
  stage("G02 校园寻物（提前找到）");
  const seEarly = await runSearchEarly(page);
  stage("G02 校园寻物（看全再找 + 旧存档）");
  const se = await runSearch(page);
  stage("周四 由乃（单人）");
  await runSolo(page, "yuno", { key: "soloYunoCompleted", reply: "soloYunoReply", value: "secret" }, false);
  // G04 不能压轴：它一完成，若日常全齐壳就直接跳收尾，第二场就开不了了。
  stage("G04 体育活动（站桩输 + 重开赢 + 确定性自检）");
  const bl = await runBall(page);
  stage("G04 散场残留检查");

  // G04 散场后（不刷新页面）：各游戏的面板 / 胶囊不许留在自由走动画面上，
  // 按 F 也不该再触发任何一场的主动发起（onPoke 必须在 dispose 里清掉）。
  const left = await page.evaluate(() => ({
    btn: document.getElementById("reactBtn").hidden,
    react: document.getElementById("react").hidden,
    give: document.getElementById("giveBack").hidden,
    swap: document.getElementById("wgSwap").hidden,
    solo: document.getElementById("soloChoice").hidden
  }));
  for (const k of Object.keys(left)) {
    if (!left[k]) fail(`G04 散场后，自由走动画面上还留着 ${k}`);
  }
  const n0 = await page.evaluate(() => window.DAILY.reactStats().count);
  await page.keyboard.press("KeyF");
  await page.waitForTimeout(300);
  const n1 = await page.evaluate(() => window.DAILY.reactStats().count);
  if (n1 !== n0) fail("散场后按 F 还能触发上一场的主动发起");
  ok("G04 散场后画面无残留，F 不再串场");

  // G03 压轴：它是最后一个没做完的日常，做完壳直接跳 narrative 收尾。
  stage("G03 课间猜人物（压轴，做完跳收尾）");
  const wd = await runWord(page);

  // ---- 全通之后：?hub=1 不跳转，压整章结果卡；「回到目录」露出调试目录 ----
  stage("全通结果卡 / 目录 / 清存档");
  await page.goto(PAGE_HUB, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__daily && window.__daily.events, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  const card = await page.evaluate(() => ({
    url: location.href,
    shown: !document.getElementById("card").hidden &&
      document.getElementById("card").classList.contains("show"),
    title: document.getElementById("cardTitle").textContent,
    back: !document.getElementById("cardBack").hidden,
    after: !document.getElementById("afterStoryCard").hidden,
    afterHref: document.getElementById("afterStoryCard").getAttribute("href")
  }));
  if (card.url.indexOf("narrative") >= 0) fail("全通存档 + ?hub=1 不该跳收尾（调试目录要留着）");
  if (!card.shown) fail("全通存档 + ?hub=1 没有压出整章结果卡");
  if (card.title.indexOf("那几个日常") < 0) fail(`结果卡标题是「${card.title}」`);
  if (!card.back) fail("手动模式下结果卡没有「回到目录」");
  if (!card.after || card.afterHref !== "narrative/index.html?phase=after") {
    fail(`结果卡上的收尾入口不对（${card.afterHref}）`);
  }
  await page.screenshot({ path: path.join(OUT, "d8-chapter-card.png") });

  await page.click("#cardBack");
  await page.waitForTimeout(400);
  let hub = await hubState(page);
  if (!hub.hubShow) fail("结果卡「回到目录」没有把目录压出来");
  if (hub.done !== 6 || hub.locked !== 0 || hub.playable !== 0) {
    fail(`全通目录应该 6 完成 / 0 锁定 / 0 可玩，实际 ${hub.done}/${hub.locked}/${hub.playable}`);
  }
  if (!hub.afterStoryHub) fail("全通后目录上没有收尾入口");
  await page.screenshot({ path: path.join(OUT, "d8-hub-done.png") });

  // 清存档：回到 1 可玩 / 5 锁定，收尾入口收掉
  await page.click("#hubReset");
  await page.waitForTimeout(300);
  hub = await hubState(page);
  const keys = await page.evaluate(() => Object.keys(window.__daily.store()));
  if (keys.length) fail("清存档后 store 里还有 " + keys.join(","));
  if (hub.playable !== 1 || hub.locked !== 5 || hub.done !== 0) {
    fail(`清存档后目录应该 1 可玩 / 5 锁定 / 0 完成，实际 ${hub.playable}/${hub.locked}/${hub.done}`);
  }
  if (hub.afterStoryHub) fail("清存档后收尾入口还挂着");
  await page.screenshot({ path: path.join(OUT, "d9-hub-reset.png") });
  ok("全通结果卡 → 回到目录（6 可重访）→ 清存档（1 可玩 / 5 锁定）都成立");

  // ---- 自动时间线冒烟：?auto=1 自己从周一日期卡开始推进 ----
  // browser.newPage 是新 context，localStorage 干净，正好是全新进度。
  stage("?auto=1 自动时间线冒烟");
  const auto = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const autoErrors = [];
  auto.on("pageerror", (e) => autoErrors.push("pageerror: " + e.message));
  auto.on("console", (m) => { if (m.type() === "error") autoErrors.push("console: " + m.text()); });
  await auto.goto(PAGE_AUTO, { waitUntil: "load", timeout: 60000 });
  await auto.waitForFunction(() => window.__daily && window.__daily.events, null, { timeout: 30000 });
  await auto.waitForFunction(() => !document.getElementById("dayCard").hidden,
    null, { timeout: 10000 }).catch(() => { });
  const day0 = await auto.evaluate(() => ({
    day: document.getElementById("dayCard").hidden
      ? null : document.getElementById("dayName").textContent,
    busy: window.__daily.busy,
    hub: document.getElementById("hub").classList.contains("show")
  }));
  if (day0.day !== "周一") fail(`?auto=1 开场日期卡是「${day0.day}」，应该是周一`);
  if (!day0.busy) fail("?auto=1 没有自己开始推进时间线");
  if (day0.hub) fail("?auto=1 不该压出单场目录");
  await auto.waitForTimeout(340);
  await auto.screenshot({ path: path.join(OUT, "p0-auto-mon.png") });
  // 读完周一旁白 → G01 自己开起来
  const autoT0 = Date.now();
  let autoGame = null;
  while (Date.now() - autoT0 < 15000) {
    const st = await auto.evaluate(() => ({
      dlg: window.DAILY.dialogOpen(),
      id: window.__daily.current && window.__daily.current.id
    }));
    if (st.id) { autoGame = st.id; break; }
    if (st.dlg) await auto.keyboard.press("KeyE");
    await auto.waitForTimeout(100);
  }
  if (autoGame !== "errand") fail(`?auto=1 开场进的是 ${autoGame}，应该是 errand`);
  const autoDays = await auto.evaluate(() => window.__daily.daysShown);
  if (autoDays[0] !== "周一") fail("?auto=1 的 daysShown 第一项不是周一");
  if (autoErrors.length) fails.push(...autoErrors.slice(0, 3));
  else ok("?auto=1 自动时间线：周一日期卡 → 旁白 → G01 自己开场");
  await auto.close();

  if (errors.length) fails.push(...errors.slice(0, 6));
  else ok("浏览器无报错");

  await browser.close();
  return { seEarly, se, er, wd, bl };
}

// ---------------------------------------------------------------- 跑

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  checkStatic();

  let br = null;
  try {
    br = await runBrowser();
  } catch (e) {
    fail("浏览器部分抛异常：" + e.message);
  }

  const report = { ok: oks, failures: fails, browser: br };
  console.log(JSON.stringify(report, null, 2));
  console.log(fails.length ? "\n✗ " + fails.length + " 条没过" : "\n✓ 全部通过（" + oks.length + " 项）");
  process.exit(fails.length ? 1 : 0);
})();

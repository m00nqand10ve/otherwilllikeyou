/* 第三幕 · 广播室 — 画面与流程
 *
 * 流程：承接第二幕双人就座（单独打开时演出进门）→ 试音 → 3、2、1 → ON AIR
 *      → 按谱面念完 → 灯灭，镜头推近她 → 完成卡
 *
 * 场景图与第二幕共用；角色夹在背景椅背和桌面前板之间。
 * 轨道置于人物右侧的空区，避免遮住两人的神态。
 */
(function (global) {
  "use strict";

  const W = 512, H = 288;
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  const el = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- 版面
  // 两人沿用第二幕的左／右座位，轨道放在右侧空区。
  const HIT_Y = 228;          // 判定线
  const LANE_TOP = 34;        // 音符从这里生出来
  const FINAL_APPROACH = 1.25; // 末段（收尾）的下落提前量，跟 chart 一致
  // 玩家轨在判定线上分上下两格：上格 = 高音（J），下格 = 低音（F）。
  const HIT_ROW = { hi: -4, lo: 4, both: 0, grace: 0 };

  const LANE = {
    her: { x: 358, w: 38, main: "#f2a8b8", dim: "#8d5a66", name: "朱里" },
    me: { x: 420, w: 38, main: "#9acbdf", dim: "#4f7181", name: "和臣" }
  };
  const LANE_MID = { her: LANE.her.x + LANE.her.w / 2, me: LANE.me.x + LANE.me.w / 2 };

  // 脚点沿用第二幕：桌沿只挡下半身，椅背在人物后方。
  const GIRL_AT = { x: 275, y: 211, s: 1.2 };
  const BOY_AT = { x: 166, y: 211, s: 1.25 };

  const FW = 48, FH = 72;

  // ---------------------------------------------------------------- 资源

  const IMG = {
    girl: "../assets/characters/girl/girl_sheet.png",
    girlSit: "../assets/characters/girl/girl_sit_down.png",
    boySit: "../assets/characters/boy/boy_sit_down.png",
    room: "../act2/broadcast-bridge/assets/broadcast_room_single_desk.png",
    roomOpen: "../act2/broadcast-bridge/assets/broadcast_room_single_desk_open.png"
  };
  const img = {};
  let loaded = 0;
  for (const k in IMG) {
    const im = new Image();
    im.onload = () => { loaded++; };
    im.onerror = () => { loaded++; };
    im.src = IMG[k];
    img[k] = im;
  }

  // ---------------------------------------------------------------- 声音与谱面

  const audio = global.ACT3.createAudio();

  const SAVE_KEY = "our-story-act3-broadcast-v1";
  const DIFF_KEY = "act3-difficulty-v1";
  const RESULT_KEY = "act3-result-v1";
  const PAPERS_KEY = "our-story-bridge-papers-v1";

  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null") || null; }
    catch (e) { return null; }
  }
  function loadSave() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY) || "null") || {}; }
    catch (e) { return {}; }
  }
  function writeSave(patch) {
    try {
      const s = Object.assign(loadSave(), patch);
      localStorage.setItem(SAVE_KEY, JSON.stringify(s));
    } catch (e) { /* 无痕模式写不进去，不影响玩 */ }
  }
  const SAVE = loadSave();

  /** 难度档：新键只有「演播」「电台」；旧档、乱写、读不到一律按「演播」。 */
  function loadDifficulty() {
    try {
      const v = localStorage.getItem(DIFF_KEY);
      return v === "电台" ? "电台" : "演播";
    } catch (e) { return "演播"; }
  }
  function saveDifficulty(name) {
    try { localStorage.setItem(DIFF_KEY, name === "电台" ? "电台" : "演播"); }
    catch (e) { /* 无痕模式写不进去，不影响玩 */ }
  }

  /** 过场接住几张稿纸：0–3，缺省按 3（旧体验 = 一张没掉）。只改念稿前的小动作字幕。 */
  function papersCaught() {
    try {
      const v = parseInt(localStorage.getItem(PAPERS_KEY), 10);
      return (v >= 0 && v <= 3) ? v : 3;
    } catch (e) { return 3; }
  }

  const BACK = (() => {
    try { return new URLSearchParams(location.search).get("back") || "../school-preview.html"; }
    catch (e) { return "../school-preview.html"; }
  })();
  const FRESH = /(\?|&)fresh=1/.test(location.search);
  const FROM_BRIDGE = new URLSearchParams(location.search).get("from") === "bridge";
  // 自检用：?seed=N 把谱面种子钉死，突发段每次落在同四小节
  const FIXED_SEED = (() => {
    try {
      const v = new URLSearchParams(location.search).get("seed");
      return v == null || v === "" ? null : (parseInt(v, 10) >>> 0);
    } catch (e) { return null; }
  })();

  const DIFFS = global.ACT3.DIFFS;
  const NOISE = global.ACT3.NOISE;
  const DEFAULT_DIFF = global.ACT3.DEFAULT_DIFF || "演播";

  let difficulty = "演播";
  let chart = null;
  let rhythm = null;
  let noteById = new Map();
  let runNo = 0;
  const runSalt = (Date.now() & 0xffff) >>> 0;   // 只有老玩家的重录才用得到，首通必触发

  function nextSeed() {
    if (FIXED_SEED != null) return FIXED_SEED;
    runNo++;
    const base = ((SAVE.best || 0) + (SAVE.offset || 0) + runSalt) >>> 0;
    return global.ACT3.mixSeed(runNo * 2654435761, base);
  }

  // ---------------------------------------------------------------- 状态

  const sc = {
    state: "intro",     // intro | check | diff | ready | play | finale | done | leave
    t: 0,
    cam: { x: 256, y: 150, z: 1.55, tx: 256, ty: 150, tz: 1 },
    walk: 0,            // 她走进来的进度 0..1
    doorOpen: 0,
    onAir: 0,           // 灯亮到几分
    laneFade: 0,        // 轨道区压暗的淡入
    veil: 1,            // 从黑场淡入
    readyT: 0,
    finaleT: 0,
    byeShown: false,
    finished: false,
    everCleared: !!SAVE.cleared,
    paperVariant: false,
    noisyShown: false,
    burstToast: false
  };

  const vu = { her: 0, me: 0 };
  const fx = [];

  /** 判定回调。每局重建 rhythm 时重新挂一份。 */
  function makeHooks() {
    return {
      onJudge(tier, note, delta) {
        vu.me = Math.min(1, vu.me + 0.55);
        fx.push({
          kind: "ring", lane: "me", t0: audio.songTime(),
          tier, color: tier === "wrong" ? "#ff8f86" : LANE.me.main
        });
        if (tier === "miss" || tier === "wrong") flashLane("me");
      },
      onHerNote(n) {
        vu.her = Math.min(1, vu.her + 0.5);
        fx.push({ kind: "ring", lane: "her", t0: audio.songTime(), tier: "auto", color: LANE.her.main });
      },
      onCover(n) {
        vu.her = 1;
        // 这里**不画圈**。空心的圆环读起来像准星，不像「她开口了」；
        // 换成粉轨底下一道更宽更亮的横扫，和补位那一刻同一种语言。
        fx.push({ kind: "sweep", t0: audio.songTime(), color: "#ffd9e2", big: true });
      },
      onRescue(n, cov) {
        // 她接住了。**画面不写字**：她的音色换了人、粉轨上多一个「托」的音符、
        // 字幕那半句变成她的颜色——三样加起来比一行「她救了你」有说服力，
        // 也不会和判定字挤在同一条线上。
        fx.push({ kind: "sweep", t0: audio.songTime(), color: LANE.her.main });
      },
      onCue() {
        fx.push({ kind: "cue", t0: audio.songTime(), color: "#f4ecdd" });
      },
      onGrace(g) {
        fx.push({ kind: "grace", t0: audio.songTime(), color: "#ffe9a8" });
      },
      onBothPress(n) {
        fx.push({ kind: "both", t0: audio.songTime(), color: LANE.me.main });
      },
      onSync(ev) {
        fx.push({ kind: "sync", t0: audio.songTime(), color: "#ffe9a8" });
      },
      onHoldBreak() { flashLane("me"); },
      onFinish(st) {
        sc.finished = true;
        sc.finishStats = st;
      }
    };
  }

  /**
   * 造一局：谱面按种子重建（突发段落在哪四小节由种子决定），判定按当前难度档。
   * 首通（没 cleared）必触发突发段，之后 50%。所有随机都在 chart.js 的纯函数里。
   */
  function createRun() {
    chart = global.ACT3.buildChart(global.ACT3.Script, {
      seed: nextSeed(),
      firstRun: !SAVE.cleared
    });
    if (chart.segmentError) {
      try { console.warn("act3 谱面五段表有问题：" + chart.segmentError); } catch (e) { }
    }
    rhythm = global.ACT3.createRhythm(chart, audio, Object.assign({ difficulty }, makeHooks()));
    // 字幕查判定状态要查 rhythm 手里那份**副本**：
    // chart.notes 是谱面原件，judged / result 是写在副本上的，
    // 第一版查错了对象，结果漏掉的半句永远不会变成她的颜色。
    noteById = new Map();
    for (const n of rhythm.mine) noteById.set(n.id, n);
    for (const n of rhythm.hers) noteById.set(n.id, n);
    audio.setBeatMap(chart);
    sc.burstToast = false;
    return chart;
  }

  /** 当前档位、以及每个音符的下落提前量：末段（收尾）固定 1.25s，其余按档位。 */
  const BASE_APPROACH = () => (DIFFS[difficulty] || DIFFS[DEFAULT_DIFF]).approach;
  function approachOf(n) {
    return (n && n.seg === chart.segments.length - 1) ? FINAL_APPROACH : BASE_APPROACH();
  }
  function speedOf(n) {
    return (HIT_Y - LANE_TOP) / approachOf(n);
  }

  // ---------------------------------------------------------------- 提示条

  let toastText = "", toastColor = "#f4ecdd", toastT = 0;
  function toast(text, color) {
    toastText = text;
    toastColor = color || "#f4ecdd";
    toastT = 2.2;
  }

  let flashT = 0;
  function flashLane() { flashT = 0.22; }

  // ---------------------------------------------------------------- 对白

  const dlgEl = el("dlg");
  const dlgWho = el("dlgWho");
  const dlgLine = el("dlgLine");
  let dlg = null;

  function say(who, text, done) {
    dlg = { who, text, shown: 0, t: 0, done };
    dlgWho.textContent = who;
    dlgLine.textContent = "";
    dlgEl.classList.add("show");
  }
  function advance() {
    if (!dlg) return false;
    if (dlg.shown < dlg.text.length) {
      dlg.shown = dlg.text.length;
      dlgLine.textContent = dlg.text;
      return true;
    }
    const d = dlg.done;
    dlg = null;
    dlgEl.classList.remove("show");
    if (d) d();
    return true;
  }
  function lines(items, done) {
    let i = 0;
    const step = () => {
      if (i >= items.length) { if (done) done(); return; }
      const it = items[i++];
      say(it[0], it[1], step);
    };
    step();
  }

  // ---------------------------------------------------------------- 场景素材
  // 与第二幕广播室共用同一张背景；桌面前板单独盖在人物下半身前。
  const DESK = { x: 70, y: 188, w: 269, h: 75 };
  function roomImage() {
    return sc.doorOpen > 0.5 ? img.roomOpen : img.room;
  }

  // ---------------------------------------------------------------- 人物

  const ready = (im) => im && im.complete && im.naturalWidth > 0;

  function drawGirl(k) {
    if (!ready(img.girl) || !ready(img.girlSit)) return;
    // k = 走进来的进度；1 就是坐好了
    const s = GIRL_AT.s;
    if (k < 1) {
      const x = 438 + (GIRL_AT.x - 438) * k;
      const feet = 233 + (GIRL_AT.y - 233) * k;
      const step = Math.floor(sc.t * 7) % 2 ? 11 : 12;
      ctx.drawImage(img.girl, step * FW, 0, FW, FH,
        Math.round(x - FW * s / 2), Math.round(feet - FH * s), FW * s, FH * s);
      return;
    }
    const bob = Math.sin(sc.t * 1.6) * 0.6;
    ctx.drawImage(img.girlSit, 0, 0, FW, FH,
      Math.round(GIRL_AT.x - FW * s / 2), Math.round(GIRL_AT.y - FH * s + bob), FW * s, FH * s);
  }

  function drawBoy() {
    if (!ready(img.boySit)) return;
    const s = BOY_AT.s;
    const bob = Math.sin(sc.t * 1.5 + 1.2) * 0.6;
    ctx.drawImage(img.boySit, 0, 0, FW, FH,
      Math.round(BOY_AT.x - FW * s / 2), Math.round(BOY_AT.y - FH * s + bob), FW * s, FH * s);
  }

  // ---------------------------------------------------------------- 动态房间

  function drawVU() {
    // 两块电平表：左她右你，跟着各自最近一次发声跳
    const rows = [
      { y: 44, v: vu.her, color: LANE.her.main, label: "她" },
      { y: 54, v: vu.me, color: LANE.me.main, label: "我" }
    ];
    for (const r of rows) {
      for (let i = 0; i < 12; i++) {
        const lit = r.v * 12 > i;
        ctx.fillStyle = lit ? r.color : "rgba(255,255,255,.07)";
        ctx.globalAlpha = lit ? 0.85 : 1;
        ctx.fillRect(20 + i * 4, r.y, 3, 5);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawOnAir() {
    const on = sc.onAir;
    const x = 20, y = 14, w = 62, h = 19;
    ctx.fillStyle = "#0d1214";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    // 灯
    const lx = x + 10, ly = y + h / 2;
    if (on > 0.02) {
      const gg = ctx.createRadialGradient(lx, ly, 0, lx, ly, 16);
      gg.addColorStop(0, "rgba(255,86,72," + (0.55 * on) + ")");
      gg.addColorStop(1, "rgba(255,86,72,0)");
      ctx.fillStyle = gg;
      ctx.fillRect(lx - 16, ly - 16, 32, 32);
    }
    ctx.fillStyle = on > 0.5 ? "#ff5a48" : "#4a2320";
    ctx.beginPath();
    ctx.arc(lx, ly, 4, 0, 7);
    ctx.fill();
    if (on > 0.5) {
      ctx.fillStyle = "rgba(255,200,190,.9)";
      ctx.beginPath();
      ctx.arc(lx - 1, ly - 1, 1.6, 0, 7);
      ctx.fill();
    }

    ctx.fillStyle = on > 0.5 ? "#ffd9d2" : "rgba(242,233,218,.32)";
    ctx.font = 'bold 8px "Microsoft YaHei",sans-serif';
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("ON AIR", x + 20, ly + 0.5);
    ctx.textAlign = "left";
  }

  // ---------------------------------------------------------------- 轨道

  /** 一个音符现在该画在多高。末段的下落更快（1.25s），所以每颗音符各算各的。 */
  function laneY(n, atTime) {
    const t = atTime == null ? n.time : atTime;
    return HIT_Y - (t - audio.songTime()) * speedOf(n);
  }

  function drawLanes() {
    // 轨道区的压暗：隔音棉的花纹在这里必须让路，不然音符读不清。
    // 只在演奏时出现，跟着 laneFade 淡进来。
    if (sc.laneFade > 0.01) {
      const vg = ctx.createLinearGradient(345, 0, 471, 0);
      vg.addColorStop(0, "rgba(8,11,12,0)");
      vg.addColorStop(0.18, "rgba(8,11,12," + (0.67 * sc.laneFade) + ")");
      vg.addColorStop(0.82, "rgba(8,11,12," + (0.67 * sc.laneFade) + ")");
      vg.addColorStop(1, "rgba(8,11,12,0)");
      ctx.fillStyle = vg;
      ctx.fillRect(345, 22, 126, HIT_Y - 17);
    }
    // 轨道底
    for (const k of ["her", "me"]) {
      const L = LANE[k];
      const g = ctx.createLinearGradient(0, LANE_TOP, 0, HIT_Y);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.65, "rgba(255,255,255,.05)");
      g.addColorStop(1, "rgba(255,255,255,.13)");
      ctx.fillStyle = g;
      ctx.fillRect(L.x, LANE_TOP, L.w, HIT_Y - LANE_TOP);
      const eg = ctx.createLinearGradient(0, LANE_TOP, 0, HIT_Y);
      eg.addColorStop(0, "rgba(255,255,255,0)");
      eg.addColorStop(0.45, "rgba(255,255,255,.06)");
      eg.addColorStop(1, "rgba(255,255,255,.20)");
      ctx.fillStyle = eg;
      ctx.fillRect(L.x, LANE_TOP, 1, HIT_Y - LANE_TOP);
      ctx.fillRect(L.x + L.w - 1, LANE_TOP, 1, HIT_Y - LANE_TOP);
    }

    // 判定线：一条实线压一条散光，看着像一条真的横在桌上的线
    const lw = LANE.me.x + LANE.me.w - LANE.her.x;
    const lg = ctx.createLinearGradient(LANE.her.x, 0, LANE.her.x + lw, 0);
    lg.addColorStop(0, "rgba(255,255,255,.10)");
    lg.addColorStop(0.2, "rgba(255,255,255,.55)");
    lg.addColorStop(0.8, "rgba(255,255,255,.55)");
    lg.addColorStop(1, "rgba(255,255,255,.10)");
    ctx.fillStyle = lg;
    ctx.fillRect(LANE.her.x, HIT_Y, lw, 1);
    ctx.fillStyle = "rgba(255,255,255,.12)";
    ctx.fillRect(LANE.her.x, HIT_Y + 1, lw, 1);
    ctx.fillRect(LANE.her.x, HIT_Y - 2, lw, 1);

    // 接收器：她一条；你两条——上格高音（J）、下格低音（F）
    {
      const L = LANE.her;
      ctx.fillStyle = "rgba(10,14,16,.55)";
      ctx.fillRect(L.x + 2, HIT_Y - 5, L.w - 4, 10);
      ctx.strokeStyle = hexA(L.main, 0.55);
      ctx.lineWidth = 1;
      ctx.strokeRect(L.x + 2.5, HIT_Y - 4.5, L.w - 5, 9);
    }
    for (const [k, off, label] of [["hi", HIT_ROW.hi, "J"], ["me-lo", HIT_ROW.lo, "F"]]) {
      const L = LANE.me;
      const y = HIT_Y + off - 2;
      ctx.fillStyle = "rgba(10,14,16,.55)";
      ctx.fillRect(L.x + 2, y - 2, L.w - 4, 5);
      ctx.strokeStyle = flashT > 0 && k === "hi"
        ? "rgba(255,120,110,.95)"
        : hexA(L.main, 0.5);
      ctx.lineWidth = 1;
      ctx.strokeRect(L.x + 2.5, y - 1.5, L.w - 5, 4);
      // 键位小字放在两条轨道之间的缝里，不挡音符本体
      ctx.font = 'bold 7px "Microsoft YaHei",sans-serif';
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(0,0,0,.65)";
      ctx.fillText(label, LANE.me.x - 2, HIT_Y + off + 0.5);
      ctx.fillStyle = hexA(L.main, 0.62);
      ctx.fillText(label, LANE.me.x - 3, HIT_Y + off);
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    // 中间的接缝：两条轨道是一条话的两半，缝上画一列小点
    ctx.fillStyle = "rgba(255,255,255,.10)";
    const seam = Math.floor((LANE.her.x + LANE.her.w + LANE.me.x) / 2);
    for (let y = LANE_TOP + 6; y < HIT_Y; y += 8) ctx.fillRect(seam, y, 2, 2);

    drawNoiseBar();
  }

  /** 判定线右端的细噪音条。没有新图片，全是矩形。 */
  function drawNoiseBar() {
    if (!rhythm) return;
    const n = rhythm.state.noise;
    const x = LANE.me.x + LANE.me.w + 5;
    const w = 4;
    const h = 42;
    const y0 = HIT_Y - h - 3;
    // 深色底板：这条是 HUD，不能和后面亮着的大门混在一起
    ctx.fillStyle = "rgba(8,11,12,.66)";
    ctx.fillRect(x - 2, y0 - 2, w + 4, h + 4);
    ctx.strokeStyle = "rgba(242,233,218,.14)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 1.5, y0 - 1.5, w + 3, h + 3);
    ctx.fillStyle = "rgba(255,255,255,.06)";
    ctx.fillRect(x, y0, w, h);
    const k = Math.max(0, Math.min(1, n / NOISE.max));
    const col = n >= NOISE.rescue ? "#ff6b5f" : n >= NOISE.grey ? "#e0b45a" : "#7fb4c4";
    ctx.fillStyle = hexA(col, 0.95);
    ctx.fillRect(x, y0 + h * (1 - k), w, h * k);
    for (const th of [NOISE.grey, NOISE.rescue]) {
      const yy = Math.round(y0 + h * (1 - th / NOISE.max));
      ctx.fillStyle = "rgba(242,233,218,.40)";
      ctx.fillRect(x - 2, yy, w + 4, 1);
    }
  }

  function drawNotes() {
    const t = audio.songTime();
    const live = rhythm.live();
    // 噪音大了，她那边的下一行音符变灰——演出层的事，判定照常自动
    const loud = live.noise >= NOISE.grey;

    // 先画她的（在下层），再画你的（在上层）——你的音符永远不被压住
    for (const n of live.hers) {
      if (n.judged) continue;
      const y = laneY(n);
      if (y < LANE_TOP - 20 || y > HIT_Y + 30) continue;
      drawNote(n, y, "her", loud);
    }
    for (const g of live.graces || []) {
      if (g.judged) continue;
      const y = laneY(g);
      if (y < LANE_TOP - 20 || y > HIT_Y + 30) continue;
      drawGraceNote(g, y);
    }
    for (const n of live.mine) {
      if (n.judged) continue;
      const y = laneY(n);
      if (y < LANE_TOP - 20 || y > HIT_Y + 30) continue;
      drawNote(n, y, "me", loud);
    }

    // 按住中的长音：尾巴缩短，像被吸进去了
    const hd = live.hold;
    if (hd) {
      const n = hd.note;
      const y = laneY(n) + noteRow(n, "me");
      const tailY = laneY(n, n.time + n.dur) + noteRow(n, "me");
      const k = Math.max(0, Math.min(1, (t - n.time) / Math.max(0.01, n.dur)));
      const top = tailY + (y - tailY) * k;
      ctx.fillStyle = hexA(LANE.me.main, 0.28);
      ctx.fillRect(LANE_MID.me - 5, top, 10, Math.max(0, y - top));
      ctx.fillStyle = hexA(LANE.me.main, 0.9);
      ctx.fillRect(LANE_MID.me - 5, y - 3, 10, 6);
    }

    // 双人长按：两人一起按住的这段时间，两条轨道中间横一道金线；
    // 快到她的松手点时收紧成一个圈——那就是要「一起松手」的窗口。
    const bothState = live.both;
    if (bothState && bothState.event) {
      const ev = bothState.event;
      const left = ev.time + ev.dur - t;
      const a = left <= 0.6 ? 0.65 + 0.3 * Math.sin(t * 18) : 0.42;
      const x0 = LANE_MID.her - 14;
      const x1 = LANE_MID.me + 14;
      // 先压一道深色底，再画金线：门和墙都是亮的，细线会直接消失
      ctx.strokeStyle = "rgba(8,11,12,.6)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x0, HIT_Y + 12);
      ctx.lineTo(x1, HIT_Y + 12);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,233,168," + a.toFixed(3) + ")";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, HIT_Y + 12);
      ctx.lineTo(x1, HIT_Y + 12);
      ctx.stroke();
      if (left >= 0 && left <= 0.6) {
        const r = 6 + (left / 0.6) * 16;
        ctx.strokeStyle = "rgba(255,233,168," + (0.3 + 0.5 * (1 - left / 0.6)).toFixed(3) + ")";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(LANE_MID.me, HIT_Y + 12, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // 提示音符：她敲稿子之后，接下来四五个你的音符外面套一层虚线
    if (live.cue) {
      const id = live.cue.noteId;
      for (const n of live.mine) {
        if (n.judged) continue;
        if (n.id < id || n.id > id + live.cue.len) continue;
        const y = laneY(n);
        if (y < LANE_TOP || y > HIT_Y) continue;
        const a = 0.30 + 0.30 * Math.sin(t * 12);
        ctx.strokeStyle = "rgba(244,236,221," + a.toFixed(3) + ")";
        ctx.lineWidth = 1;
        ctx.strokeRect(LANE.me.x + 2.5, y - 8.5, LANE.me.w - 5, 17);
      }
    }
  }

  /** 玩家轨上下两格的偏移。both 块站在中间。 */
  function noteRow(n, laneKey) {
    if (laneKey !== "me") return 0;
    if (n.p === "hi") return HIT_ROW.hi;
    if (n.p === "lo") return HIT_ROW.lo;
    return 0;
  }

  /** 装饰音：小菱形，不抢正常音符的视线；可打可不打。 */
  function drawGraceNote(n, y) {
    const fade = Math.min(1, Math.max(0, (y - LANE_TOP) / 26));
    const yy = y + noteRow(n, "me");
    ctx.globalAlpha = fade * 0.9;
    ctx.fillStyle = hexA("#ffe9a8", 0.9);
    ctx.beginPath();
    ctx.moveTo(LANE_MID.me, yy - 4);
    ctx.lineTo(LANE_MID.me + 3, yy);
    ctx.lineTo(LANE_MID.me, yy + 4);
    ctx.lineTo(LANE_MID.me - 3, yy);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawNote(n, y, laneKey, loud) {
    const L = LANE[laneKey];
    const cx = LANE_MID[laneKey];
    const row = noteRow(n, laneKey);
    y += row;
    const fade = Math.min(1, Math.max(0, (y - LANE_TOP) / 26));
    const isCover = n.cover;
    const isRelay = n.type === "relay";
    const isBoth = !!n.both;
    // 噪音 ≥50 时她的音符变灰：玩家能一眼看出「这一段电流不干净」
    const greyed = laneKey === "her" && loud && !isCover;
    const col = greyed ? "#9aa6aa" : isCover ? "#ffd9e2" : L.main;
    const alpha = (n.type === "hold" ? 0.95 : 1) * fade;

    // 长音的身子
    if (n.type === "hold") {
      const tailY = y - n.dur * speedOf(n);
      const top = Math.max(LANE_TOP, tailY);
      ctx.fillStyle = hexA(col, 0.30);
      ctx.fillRect(cx - 5, top, 10, Math.max(0, y - top));
      ctx.fillStyle = hexA(col, 0.55);
      ctx.fillRect(cx - 1, top, 2, Math.max(0, y - top));
    }

    // 接力：从她那条轨道伸一条桥过来。
    // 一开始只画了 2px 的线，扫一眼根本看不出「这句是从她那边过来的」——
    // 桥要够粗，而且靠近她的一头是粉的、靠近你的一头是蓝的：
    // 颜色渐变本身就是箭头，不用再写一个字。
    if (isRelay) {
      const x0 = LANE.her.x + LANE.her.w - 2;   // 她轨道的右边缘
      const x1 = LANE.me.x - 1;                 // 你轨道的左边缘
      ctx.globalAlpha = fade;
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, hexA(LANE.her.main, 0.05));
      g.addColorStop(0.4, hexA(LANE.her.main, 0.62));
      g.addColorStop(1, hexA(LANE.me.main, 0.92));
      ctx.fillStyle = g;
      ctx.fillRect(x0, y - 2, x1 - x0, 5);
      ctx.fillStyle = "rgba(255,255,255,.40)";
      ctx.fillRect(x0 + 8, y, x1 - x0 - 11, 1);
      // 箭头，戳在你轨道上
      ctx.fillStyle = hexA(LANE.me.main, 0.95);
      ctx.beginPath();
      ctx.moveTo(x1 + 1, y);
      ctx.lineTo(x1 - 4, y - 4);
      ctx.lineTo(x1 - 4, y + 4);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // 音符本体。底下垫一层半透明的大方块当发光——
    // 深色墙上只靠 8px 高的实心块，扫一眼是看不见的。
    const half = isRelay ? 19 : 16;   // 接力音符比普通音符宽一圈
    ctx.globalAlpha = alpha;
    ctx.fillStyle = hexA(col, 0.20);
    rrect(cx - half - 3, y - 7, (half + 3) * 2, 14, 4);
    ctx.fillStyle = hexA(col, 0.95);
    rrect(cx - half, y - 5, half * 2, 10, 2);
    ctx.fillStyle = "rgba(255,255,255,.92)";
    ctx.fillRect(cx - half + 2, y - 4, half * 2 - 4, 3);
    ctx.fillStyle = "rgba(0,0,0,.22)";
    ctx.fillRect(cx - half + 2, y + 3, half * 2 - 4, 2);
    if (isRelay) {
      // 左端窄窄一截粉色是「她起的头」，一道暗缝之后右半边才是你的。
      // 粉色不能画宽——画宽了就像两个音符并排，反而和最后那句和弦撞脸。
      ctx.fillStyle = hexA(LANE.her.main, 0.98);
      ctx.fillRect(cx - half, y - 5, 6, 10);
      ctx.fillStyle = hexA(LANE.her.main, 0.55);
      ctx.fillRect(cx - half, y - 5, 6, 2);
      ctx.fillStyle = "rgba(12,16,18,.55)";
      ctx.fillRect(cx - half + 6, y - 5, 2, 10);
    }
    // both 块：白边，两条轨道一起按住的那一下
    if (isBoth) {
      ctx.strokeStyle = "rgba(255,233,168,.95)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cx - half - 1, y - 7, half * 2 + 2, 14);
    }
    ctx.globalAlpha = 1;
    if (fade < 1) return;

    if (isCover) {
      ctx.strokeStyle = "rgba(255,255,255,.9)";
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - 17.5, y - 5.5, 35, 11);
    }
  }

  function rrect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + a + ")";
  }

  // ---------------------------------------------------------------- 特效

  function drawFx() {
    const t = audio.songTime();
    for (let i = fx.length - 1; i >= 0; i--) {
      const e = fx[i];
      // age 卡在 0 以上：时钟一旦倒退（跳段、停歌），特效的时间差会变成负数，
      // 半径跟着变成负数，Canvas 会直接抛异常，整个画面黑掉。
      const age = Math.max(0, t - e.t0);
      if (age > 0.6) { fx.splice(i, 1); continue; }
      const k = age / 0.6;
      if (e.kind === "ring") {
        const mid = e.lane === "her" ? LANE_MID.her : LANE_MID.me;
        const r = 5 + k * 15;
        ctx.strokeStyle = hexA(e.color, (1 - k) * 0.6);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(mid, HIT_Y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (e.kind === "sweep") {
        // 她替你把话接过去：粉轨底部横着扫一道光。
        // 补位那一下用更宽的一道（big），让「她开口了」比「她准备开口了」更响。
        const w = (e.big ? 46 : 20) + k * (e.big ? 66 : 34);
        const hh = e.big ? 8 : 6;
        ctx.fillStyle = hexA(e.color, (1 - k) * (e.big ? 0.62 : 0.45));
        ctx.fillRect(LANE_MID.her - w / 2, HIT_Y - hh / 2, w, hh);
      } else if (e.kind === "cue") {
        const mid = LANE_MID.me;
        ctx.strokeStyle = "rgba(244,236,221," + ((1 - k) * 0.6).toFixed(3) + ")";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(mid - 24, HIT_Y - 30 - k * 20);
        ctx.lineTo(mid + 24, HIT_Y - 30 - k * 20);
        ctx.stroke();
      } else if (e.kind === "grace") {
        // 装饰音命中：一圈很小的金色光圈，不抢判定字
        ctx.strokeStyle = hexA(e.color, (1 - k) * 0.7);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(LANE_MID.me, HIT_Y, 4 + k * 9, 0, Math.PI * 2);
        ctx.stroke();
      } else if (e.kind === "both") {
        ctx.strokeStyle = hexA(e.color, (1 - k) * 0.55);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(LANE_MID.her, HIT_Y - 14 - k * 10);
        ctx.lineTo(LANE_MID.me, HIT_Y - 14 - k * 10);
        ctx.stroke();
      } else if (e.kind === "sync") {
        // 收尾同步：两道金色横线从两条轨道中间向外扩散
        const w = 26 + k * 50;
        ctx.fillStyle = hexA(e.color, (1 - k) * 0.55);
        ctx.fillRect((LANE_MID.her + LANE_MID.me) / 2 - w / 2, HIT_Y - 18 - k * 8, w, 2);
      }
    }

    // 判定字
    const last = rhythm.state.last;
    if (last) {
      const age = t - last.at;
      if (age < 0.55) {
        const k = age / 0.55;
        const txt = last.tier === "perfect" ? "PERFECT"
          : last.tier === "good" ? "GOOD"
            : last.tier === "ok" ? "OK"
              : last.tier === "wrong" ? "错键"
                : last.tier === "grace" ? "＋50" : "MISS";
        const col = last.tier === "perfect" ? "#ffe9a8"
          : last.tier === "good" ? "#cfead8"
            : last.tier === "ok" ? "#b9cbd8"
              : last.tier === "grace" ? "#ffe9a8"
                : last.tier === "wrong" ? "#ffb36b" : "#ff8f86";
        ctx.save();
        ctx.globalAlpha = 1 - k * k;
        ctx.font = 'bold 10px "Microsoft YaHei",sans-serif';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(0,0,0,.55)";
        ctx.fillText(txt, LANE_MID.me + 1, HIT_Y - 34 - k * 6);
        ctx.fillStyle = col;
        ctx.fillText(txt, LANE_MID.me, HIT_Y - 35 - k * 6);
        ctx.restore();
      }
    }

    // 提示条（试音那一句）。放画面上部，离判定线远一点。
    if (toastT > 0) {
      const a = Math.min(1, toastT / 0.5);
      ctx.save();
      ctx.globalAlpha = a * 0.85;
      ctx.font = '10px "Microsoft YaHei",sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = toastColor;
      ctx.fillText(toastText, (LANE_MID.her + LANE_MID.me) / 2, 105);
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- HUD

  function drawHud() {
    const t = audio.songTime();
    const total = chart.duration;
    const k = Math.max(0, Math.min(1, t / total));

    // 进度条贴在画面最上面
    ctx.fillStyle = "rgba(255,255,255,.08)";
    ctx.fillRect(0, 0, W, 2);
    ctx.fillStyle = "rgba(244,236,221,.55)";
    ctx.fillRect(0, 0, W * k, 2);

    // 连击
    const st = rhythm.state;
    if (st.combo >= 3) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "rgba(0,0,0,.5)";
      ctx.font = 'bold 13px "Microsoft YaHei",sans-serif';
      ctx.fillText(String(st.combo), 257, 27);
      ctx.fillStyle = "#f4ecdd";
      ctx.fillText(String(st.combo), 256, 26);
      ctx.font = '7px "Microsoft YaHei",sans-serif';
      ctx.fillStyle = "rgba(242,233,218,.45)";
      ctx.fillText("COMBO", 256, 33);
      ctx.restore();
    }

    // 分数：放在桌面上，像控制台上的一块小表
    ctx.save();
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.font = 'bold 9px "Microsoft YaHei",sans-serif';
    ctx.fillStyle = "rgba(242,233,218,.42)";
    ctx.fillText(String(st.score).padStart(6, "0"), 498, 252);
    ctx.restore();

    // 头几秒给一句操作提示，之后自己淡掉
    if (sc.state === "play" && sc.playElapsed < 8) {
      const a = Math.min(1, Math.max(0, (8 - sc.playElapsed) / 1.6)) * 0.55;
      const teaching = chart.teaching && sc.state === "play" &&
        audio.songTime() < chart.teaching.until;
      ctx.save();
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.font = '9px "Microsoft YaHei",sans-serif';
      ctx.fillStyle = "rgba(242,233,218," + a.toFixed(3) + ")";
      ctx.fillText(teaching
        ? "J 高音 · F 低音（这段空格也行）"
        : "J 高音 · F 低音", 14, 252);
      ctx.restore();
    }

    // 档位：小字放在左下角，不抢音符的视线
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = '7px "Microsoft YaHei",sans-serif';
    ctx.fillStyle = "rgba(242,233,218,.30)";
    ctx.fillText(difficulty + " · 电流 " + Math.round(st.noise), 14, 268);
    ctx.restore();

    // 倒计时
    if (sc.state === "ready") {
      const left = Math.max(0, 3 - Math.floor(sc.readyT));
      const frac = sc.readyT % 1;
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.globalAlpha = 1 - frac * 0.5;
      ctx.fillStyle = "rgba(0,0,0,.45)";
      ctx.font = 'bold 44px "Microsoft YaHei",sans-serif';
      ctx.fillText(left > 0 ? String(left) : "ON", 258, 130);
      ctx.fillStyle = "#f4ecdd";
      ctx.fillText(left > 0 ? String(left) : "ON", 256, 128);
      ctx.restore();
    }

    // 试音的拍点
    if (sc.state === "check" && sc.check) {
      const c = sc.check;
      const beat = Math.floor((audio.now() - c.start) / audio.SPB);
      const on = beat >= 0 && beat < c.total;
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (on) {
        const phase = ((audio.now() - c.start) / audio.SPB) % 1;
        const r = 9 + (1 - phase) * 12;
        ctx.strokeStyle = "rgba(244,236,221," + (0.85 * (1 - phase) + 0.1).toFixed(3) + ")";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(256, 150, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      // 已经按了几下
      for (let i = 0; i < c.need; i++) {
        ctx.fillStyle = i < c.taps.length ? "#ffe9a8" : "rgba(255,255,255,.18)";
        ctx.fillRect(256 - c.need * 6 + i * 12, 178, 8, 4);
      }
      ctx.font = '9px "Microsoft YaHei",sans-serif';
      ctx.fillStyle = "rgba(242,233,218,.6)";
      ctx.fillText("跟着滴答按空格", 256, 196);
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- 噪音演出

  /** 噪音 ≥50：画面蒙一层灰、飘雪花点；≥80 再叠一层红色闪烁。
   *  全用矩形和确定性伪随机画，不新增图片。 */
  function drawNoiseLayer() {
    if (!rhythm) return;
    const n = rhythm.state.noise;
    if (n < NOISE.grey) return;
    const hot = Math.max(0, (n - NOISE.grey) / (NOISE.rescue - NOISE.grey));
    ctx.save();
    ctx.globalAlpha = 0.15 + 0.14 * hot;
    ctx.fillStyle = "#8f9ba1";
    ctx.fillRect(0, 0, W, H);
    // 雪花点：种子按 1/12 秒取整，点位固定一段时间再换，不是逐帧乱跳
    const seed = Math.floor(sc.t * 12) * 2654435761 >>> 0;
    ctx.globalAlpha = 0.32 + 0.26 * hot;
    for (let i = 0; i < 64; i++) {
      const s = (Math.imul((seed + i * 374761393) >>> 0, 668265263) >>> 0);
      const x = s & 0x1ff;
      const y = ((s >>> 9) & 0xff) * (H / 255);
      const w = 1 + ((s >>> 17) & 1);
      ctx.fillStyle = i % 3 ? "rgba(248,240,228,.9)" : "rgba(130,150,158,.9)";
      ctx.fillRect(x, y, w, w);
    }
    ctx.restore();
    if (n >= NOISE.rescue) {
      ctx.save();
      ctx.globalAlpha = 0.06 + 0.06 * (0.5 + 0.5 * Math.sin(sc.t * 9));
      ctx.fillStyle = "#ff6b5f";
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- 主绘制

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // 镜头
    const c = sc.cam;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(c.z, c.z);
    ctx.translate(-c.x, -c.y);

    const room = roomImage();
    if (ready(room)) ctx.drawImage(room, 0, 0, W, H);
    drawVU();
    drawOnAir();

    if (sc.state !== "intro" || sc.walk > 0) drawGirl(sc.walk);
    drawBoy();

    if (ready(room)) ctx.drawImage(room, DESK.x, DESK.y, DESK.w, DESK.h,
      DESK.x, DESK.y, DESK.w, DESK.h);
    ctx.restore();

    // 噪音大了，整个屋子蒙灰、飘雪花点。只在演奏/收尾两段出现。
    if (sc.state === "play" || sc.state === "finale") drawNoiseLayer();

    // 轨道和音符不吃镜头：它们是界面，不是屋子里的东西
    if (sc.laneFade > 0.01) {
      drawLanes();
      drawNotes();
      drawFx();
    }

    drawHud();

    // 黑场
    if (sc.veil > 0.002) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, sc.veil);
      ctx.fillStyle = "#07090a";
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // 收尾压暗
    if (sc.state === "finale" && sc.finaleT > 2.4) {
      const k = Math.min(1, (sc.finaleT - 2.4) / 1.6);
      ctx.save();
      ctx.globalAlpha = k * 0.55;
      ctx.fillStyle = "#07090a";
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- 字幕条

  const scrWho = el("scrWho");
  const scrLine = el("scrLine");
  let scrIdx = -1;
  let scrSpans = [];

  function activeDisplay(t) {
    let idx = -1;
    // 末段 108 BPM，字幕行不能再用「拍 × 固定秒数」算，改读谱面给的绝对时间
    for (let i = 0; i < chart.display.length; i++) {
      if (chart.display[i].startTime <= t + 0.05) idx = i;
      else break;
    }
    return idx;
  }

  function buildScript(idx) {
    scrSpans = [];
    scrLine.innerHTML = "";
    scrLine.classList.remove("burst");
    if (idx < 0) { scrWho.textContent = ""; return; }
    const d = chart.display[idx];
    scrWho.textContent = d.who === "both" ? "两人" : (d.who === "her" ? "朱里" : "和臣");
    scrWho.dataset.who = d.who;
    // 突发段：词块顺序按谱面给的乱序摆，整行标红——但一个字都没改
    scrLine.classList.toggle("burst", !!d.burst);
    for (const c of d.chunks) {
      const s = document.createElement("span");
      s.textContent = c.text;
      s.dataset.note = c.noteId;
      s.dataset.lane = c.lane;
      if (d.burst) s.classList.add("burst");
      scrLine.appendChild(s);
      scrSpans.push({ el: s, note: c.noteId, lane: c.lane, cls: "" });
    }
  }

  function syncScript(t) {
    const idx = activeDisplay(t);
    if (idx !== scrIdx) { scrIdx = idx; buildScript(idx); }
    if (idx < 0) return;
    const d = chart.display[idx];
    const rescued = rhythm.state.rescued;
    // 噪音 ≥50：字幕条带雪花点（CSS 负责画点，这里只切类名）
    const loud = rhythm.state.noise >= NOISE.grey;
    if (loud !== sc.noisyShown) {
      sc.noisyShown = loud;
      el("script").classList.toggle("noisy", loud);
    }
    for (const sp of scrSpans) {
      const n = noteById.get(sp.note);
      let cls;
      if (!n) cls = "";
      else if (n.judged) {
        if (n.result === "miss" || n.result === "wrong" || n.result === "covered") {
          cls = rescued.indexOf(n.id) >= 0 ? "covered" : (n.result === "wrong" ? "wronged" : "missed");
        } else {
          cls = (n.heldRatio != null && n.heldRatio < 0.85) ? "partial" : "done";
        }
      } else if (n.time <= t) {
        cls = "now";
      } else {
        cls = "wait";
      }
      if (cls !== sp.cls) {
        if (sp.cls) sp.el.classList.remove(sp.cls);
        if (cls) sp.el.classList.add(cls);
        sp.cls = cls;
      }
    }
    // 当前这一行说完了，把整行压暗一点，视线才会往下走
    scrLine.classList.toggle("past", d.endTime < t - 0.2);
  }

  // ---------------------------------------------------------------- 流程

  function startIntro() {
    sc.state = "intro";
    sc.t = 0;
    sc.walk = 0;
    sc.everCleared = !!SAVE.cleared;
    sc.cam.z = 1.55;
    sc.cam.x = 256;
    sc.cam.y = 150;
    el("loading").classList.remove("show");
    el("script").classList.remove("show");
    el("hud").classList.remove("show");
    el("card").classList.remove("show");
    el("bye").classList.remove("show");
    el("diff").classList.remove("show");

    // 过场接住几张稿纸只改念稿前的这句小动作字幕：不碰谱面，也不碰判定。
    // 缺省 3 = 一张没掉 = 旧体验，所以老档不会多出一句话。
    const papers = papersCaught();
    sc.paperVariant = papers < 3;
    const paperLine = papers >= 3 ? null
      : papers === 2 ? "路上风大，有一张差点飞了，我按顺序理好了。"
        : papers === 1 ? "路上掉了两张，我捡回来了，就是顺序有点乱。"
          : "稿子都捡回来了。顺序我理过了。";

    if (FROM_BRIDGE) {
      sc.walk = 1;
      sc.doorOpen = 1;
      sc.veil = 0;
      sc.cam.z = 1;
      sc.cam.tz = 1;
      sc.cam.x = sc.cam.tx = 256;
      sc.cam.y = sc.cam.ty = 144;
      setTimeout(() => {
        const items = [["朱里", "先试试声音吧。"], ["和臣", "好。"]];
        if (paperLine) items.push(["朱里", paperLine]);
        lines(items, startCheck);
      }, 180);
      return;
    }
    setTimeout(() => {
      sc.doorOpen = 1;
      sc.walk = 0.001;
    }, 700);
    setTimeout(() => {
      const items = [
        ["旁白", "我坐在左边的麦克风前。门开了，朱里拿着稿子走进来。"],
        ["朱里", "你先到了啊。稿子我带来了。"],
        ["和臣", "嗯，先试试声音？"]
      ];
      if (paperLine) items.push(["朱里", paperLine]);
      items.push(["朱里", "好，跟着滴答声来。"]);
      lines(items, startCheck);
    }, 1500);
  }

  function startCheck() {
    sc.state = "check";
    audio.unlock().then(() => {
      sc.check = {
        start: audio.now() + 1.1,
        need: 8,
        total: 12,
        taps: []
      };
      // 节拍器：只在试音这一段响，一拍一下，第一下重音
      const c = sc.check;
      for (let i = 0; i < c.total; i++) {
        audio.metronome(c.start + i * audio.SPB, i % 4 === 0);
      }
      toast("跟着滴答按空格", "#f4ecdd");
    });
  }

  function tapCheck() {
    const c = sc.check;
    if (!c) return;
    const t = audio.now() - c.start;
    if (t < -0.3) return;
    const phase = ((t % audio.SPB) + audio.SPB) % audio.SPB;
    const delta = phase > audio.SPB / 2 ? phase - audio.SPB : phase;
    c.taps.push(delta);
    audio.click(audio.now());
    if (c.taps.length >= c.need) finishCheck(false);
  }

  /** 试音结束。auto = 自检/演示：直接按存档档位进倒计时；否则弹出档位选择。 */
  function finishCheck(auto) {
    const c = sc.check;
    sc.check = null;
    if (c && c.taps.length >= 4) {
      const sorted = c.taps.slice().sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)];
      audio.setOffsetMs(Math.round(med * 1000));
      writeSave({ offset: audio.offsetMs() });
    }
    if (auto) applyDifficulty(difficulty, true);
    else showDiff();
  }

  /** 试音之后、正式录之前选档位。两档共用同一次校准出来的 offsetMs。 */
  function showDiff() {
    sc.state = "diff";
    dlg = null;
    dlgEl.classList.remove("show");
    el("script").classList.remove("show");
    const box = el("diff");
    box.classList.add("show");
    const note = el("diffNote");
    if (note) note.textContent = (DIFFS[difficulty] || DIFFS[DEFAULT_DIFF]).note;
    for (const b of box.querySelectorAll("[data-d]")) {
      b.classList.toggle("on", b.dataset.d === difficulty);
    }
  }

  function applyDifficulty(name, silent) {
    difficulty = name === "电台" ? "电台" : "演播";
    saveDifficulty(difficulty);
    el("diff").classList.remove("show");
    if (!silent) audio.click(audio.now());
    startReady();
  }

  function startReady() {
    sc.state = "ready";
    sc.walk = 1;
    dlg = null;
    dlgEl.classList.remove("show");
    sc.readyT = 0;
    sc.finished = false;
    sc.playEndT = 0;
    sc.onAir = 0;
    sc.finishStats = null;
    sc.burstToast = false;
    sc.noisyShown = false;
    sc.cam.tz = 1;
    sc.cam.tx = 256;
    sc.cam.ty = 144;
    // 每录一遍都重新生成谱面：突发段落在哪四小节由这一局的种子决定
    createRun();
    scrIdx = -1;
    scrSpans = [];
    scrLine.innerHTML = "";
    scrLine.classList.remove("burst", "past");
    el("script").classList.remove("noisy");
    audio.setMusic(true);      // 上一遍收尾时把 BGM 压掉了，重录要还回来
    audio.startSong(3.15);
    el("hud").classList.add("show");
    el("script").classList.add("show");
    setTimeout(() => { sc.onAir = 1; audio.click(audio.now()); }, 300);
  }

  function startPlay() {
    sc.state = "play";
    sc.playElapsed = 0;
    global.dispatchEvent(new CustomEvent("broadcast:start", { detail: { chart, difficulty } }));
  }

  function startFinale() {
    sc.state = "finale";
    sc.finaleT = 0;
    fx.length = 0;
    audio.setMusic(false);
    el("script").classList.remove("noisy");
    sc.noisyShown = false;
    setTimeout(() => {
      audio.stopSong();
      sc.onAir = 0;
      audio.click(audio.now());
    }, 500);
    // 镜头推近她：她放下稿纸，看向你
    sc.cam.tz = 1.9;
    sc.cam.tx = GIRL_AT.x;
    sc.cam.ty = 165;
    setTimeout(() => {
      const st = sc.finishStats || rhythm.stats();
      lines([
        ["朱里", "……完了。"],
        ["我", "完了。"],
        ["朱里", "中间你漏了一句。"],
        ["我", "你补上了。"],
        ["朱里", "我补上了。"],
        ["朱里", "下次别漏。"]
      ], () => showCard(st));
    }, 1600);
  }

  /** 完成卡：总评级 + 五段结算 + 收尾同步，并写 act3-result-v1（第四幕读它做回响）。 */
  function showCard(st) {
    sc.state = "done";
    const card = el("card");
    el("rank").textContent = st.rank;
    el("stat").textContent =
      "准确率 " + Math.round(st.accuracy * 100) + "%　最高连击 " + st.combo +
      "　她补位 " + st.rescues + " 次";
    el("score2").textContent = String(st.score);
    if (el("meta")) {
      el("meta").textContent = st.difficulty + "　电流最高 " + st.maxNoise +
        "　装饰音 " + st.graces.hit + "/" + st.graces.total;
    }
    if (el("syncLine")) {
      el("syncLine").textContent = st.syncBoth
        ? "收尾同步 · 两个人在同一个窗口里松了手"
        : "收尾同步 · 没对上";
      el("syncLine").classList.toggle("on", !!st.syncBoth);
    }
    // 五段结算表：准确率 / 接力接住数 / 该段最高连击（评级规则不变，仍看总准确率）
    const rows = el("segRows");
    if (rows) {
      rows.innerHTML = "";
      for (const seg of st.segments) {
        const tr = document.createElement("tr");
        const acc = seg.total ? Math.round(seg.accuracy * 100) + "%" : "—";
        tr.innerHTML =
          "<td>" + seg.name + "</td>" +
          "<td>" + acc + "</td>" +
          "<td>" + seg.relaysCaught + "/" + seg.relaysTotal + "</td>" +
          "<td>" + seg.maxCombo + "</td>";
        rows.appendChild(tr);
      }
    }
    card.classList.add("show");
    el("script").classList.remove("show");
    el("script").classList.remove("noisy");

    // 存档：旧键只存 offset / cleared / best，语义一点没变；
    // 分段成绩单独放在新键里，第四幕按它换开场台词。
    const result = {
      difficulty: st.difficulty,
      rank: st.rank,
      accuracy: +st.accuracy.toFixed(4),
      score: st.score,
      maxCombo: st.combo,
      relaysCaught: st.relaysCaught,
      relaysTotal: st.relaysTotal,
      syncBoth: !!st.syncBoth,
      maxNoise: st.maxNoise,
      rescues: st.rescues,
      segments: st.segments.map((s) => ({
        name: s.name,
        accuracy: +s.accuracy.toFixed(4),
        relaysCaught: s.relaysCaught,
        relaysTotal: s.relaysTotal,
        maxCombo: s.maxCombo
      })),
      graces: { hit: st.graces.hit, total: st.graces.total },
      counts: st.counts,
      burst: !!(chart && chart.burst && chart.burst.on)
    };
    try { localStorage.setItem(RESULT_KEY, JSON.stringify(result)); } catch (e) { }
    const prev = SAVE.best || 0;
    if (st.score > prev) writeSave({ best: st.score });
    writeSave({ cleared: true });
    SAVE.cleared = true;                          // 重录时不再强制触发突发段
    SAVE.best = Math.max(prev, st.score);
    sc.everCleared = true;
    global.dispatchEvent(new CustomEvent("broadcast:finish", {
      detail: Object.assign({}, st, { result })
    }));
  }

  function startLeave() {
    if (sc.state === "leave" || sc.state === "done") return;
    sc.state = "leave";
    sc.leaveT = 0;
    audio.stopSong();
    el("diff").classList.remove("show");
    el("script").classList.remove("show");
    el("script").classList.remove("noisy");
    el("dlg").classList.remove("show");
    dlg = null;
    setTimeout(() => {
      el("bye").classList.add("show");
      sc.byeShown = true;
    }, 700);
    global.dispatchEvent(new CustomEvent("broadcast:leave", {}));
  }

  /** 接着听 = 从头重录一遍。音游没法从半句中间接上：
   *  谱面是按音频时钟排的，中途插进去只能把前面全判成漏，
   *  而「漏了半场」的结算比「重来一次」更难看。 */
  function resumePlay() {
    el("bye").classList.remove("show");
    sc.byeShown = false;
    if (sc.finished) { showCard(sc.finishStats || rhythm.stats()); return; }
    sc.playEndT = 0;
    sc.cam.tz = 1; sc.cam.tx = 256; sc.cam.ty = 144;
    startReady();
  }

  // ---------------------------------------------------------------- 输入

  let holding = false;

  /** key = "hi"（J）| "lo"（F）| "any"（空格）| "auto"（点画面，自动对音高）。 */
  function press(key) {
    if (sc.state === "check") { tapCheck(); return; }
    if (sc.state !== "play") return;
    rhythm.press(audio.songTime(), key == null ? "auto" : key);
  }
  function release() {
    if (sc.state !== "play") return;
    rhythm.release(audio.songTime());
  }

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (e.key === "Escape") {
      e.preventDefault();
      if (sc.state === "done") return;
      startLeave();
      return;
    }
    // 试音之后的档位选择：F/1 = 演播，J/2 = 电台，Enter = 用存过的档
    if (sc.state === "diff") {
      if (k === "f" || e.key === "1") { e.preventDefault(); applyDifficulty("演播"); return; }
      if (k === "j" || e.key === "2") { e.preventDefault(); applyDifficulty("电台"); return; }
      if (e.key === "Enter") { e.preventDefault(); applyDifficulty(difficulty); return; }
    }
    if (dlg && (e.key === "Enter" || e.key === " " || k === "e")) {
      e.preventDefault();
      advance();
      return;
    }
    if (sc.state === "check" && (e.key === "Enter")) {
      e.preventDefault();
      finishCheck(false);
      return;
    }
    if (e.key === " " || k === "f" || k === "j") {
      e.preventDefault();
      if (e.repeat) return;
      if (!holding) {
        holding = true;
        press(k === "f" ? "lo" : k === "j" ? "hi" : "any");
      }
      return;
    }
  });

  window.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    if (e.key === " " || k === "f" || k === "j") {
      holding = false;
      release();
    }
  });

  canvas.addEventListener("pointerdown", () => {
    if (sc.state === "intro" && dlg) { advance(); return; }
    if (sc.state === "check") { tapCheck(); return; }
    if (sc.state === "play") { press("auto"); }
  });
  canvas.addEventListener("pointerup", () => { if (sc.state === "play") release(); });

  // ---------------------------------------------------------------- 循环

  let last = 0;

  function update(dt) {
    sc.t += dt;

    if (sc.veil > 0) sc.veil = Math.max(0, sc.veil - dt * 1.6);
    if (flashT > 0) flashT = Math.max(0, flashT - dt);
    if (toastT > 0) toastT = Math.max(0, toastT - dt);
    vu.her = Math.max(0, vu.her - dt * 2.6);
    vu.me = Math.max(0, vu.me - dt * 2.6);
    if (sc.state === "play") {
      sc.laneFade = Math.min(1, sc.laneFade + dt * 2.2);
    } else if (sc.state === "finale" || sc.state === "done") {
      // 灯灭了，轨道就该收掉——不然两条半透明的柱子会从她身上穿过去
      sc.laneFade = Math.max(0, sc.laneFade - dt * 1.6);
    }

    // 她走进来
    if (sc.state === "intro" && sc.walk > 0 && sc.walk < 1) {
      sc.walk = Math.min(1, sc.walk + dt / 1.7);
    }
    // 镜头缓动
    const c = sc.cam;
    const k = 1 - Math.pow(0.0025, dt);
    c.z += (c.tz - c.z) * k;
    c.x += (c.tx - c.x) * k;
    c.y += (c.ty - c.y) * k;

    // 对白打字
    if (dlg) {
      dlg.t += dt;
      const target = Math.min(dlg.text.length, Math.floor(dlg.t * 28));
      if (target > dlg.shown) {
        dlg.shown = target;
        dlgLine.textContent = dlg.text.slice(0, dlg.shown);
      }
    }

    if (sc.state === "ready") {
      sc.readyT += dt;
      if (sc.readyT >= 3.05) startPlay();
    }

    // 试音：节拍器走完还没按满 8 下，就拿现有的几下算。
    // 不这么兜底的话，少按一下会永远卡在试音这一步。
    if (sc.state === "check" && sc.check) {
      const c = sc.check;
      if (audio.now() > c.start + c.total * audio.SPB + 1.2) finishCheck(false);
    }

    if (sc.state === "play") {
      const t = audio.songTime();
      sc.playElapsed = (sc.playElapsed || 0) + dt;
      rhythm.update(t);
      syncScript(t);
      // 突发段开始：只在画面上提示一句「稿纸乱了」，台词一个字没改
      if (!sc.burstToast && chart.burst && chart.burst.on && t >= chart.burst.startTime) {
        sc.burstToast = true;
        toast("稿纸被碰乱了", "#ff8f86");
        audio.tapPaper(audio.now());
      }
      if (rhythm.state.finished) {
        sc.playEndT = (sc.playEndT || 0) + dt;
        if (sc.playEndT > 1.1) startFinale();
      }
    }

    if (sc.state === "finale") sc.finaleT += dt;
  }

  function loop(ts) {
    const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0;
    last = ts;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- 对外

  el("leave").onclick = () => startLeave();
  el("quit").onclick = () => { writeSave({ cleared: !!sc.finished }); location.href = BACK; };
  el("resume").onclick = () => resumePlay();
  el("again").onclick = () => {
    el("card").classList.remove("show");
    sc.finished = false;
    sc.playEndT = 0;
    sc.cam.tz = 1; sc.cam.tx = 256; sc.cam.ty = 144;
    startReady();
  };
  el("out").onclick = () => { location.href = new URL("../act4/after-broadcast/index.html?from=broadcast", location.href).href; };

  // 档位选择层：点按钮，或者用键盘 F/J
  {
    const box = el("diff");
    if (box) {
      for (const b of box.querySelectorAll("[data-d]")) {
        b.onclick = () => applyDifficulty(b.dataset.d);
      }
    }
  }

  global.__bc = {
    audio, scene: sc,
    get chart() { return chart; },
    get rhythm() { return rhythm; },
    get difficulty() { return difficulty; },
    state: () => ({
      state: sc.state,
      t: audio.songTime(),
      onAir: sc.onAir,
      walk: sc.walk,
      score: rhythm.state.score,
      combo: rhythm.state.combo,
      counts: rhythm.state.counts,
      rescues: rhythm.state.rescues,
      finished: rhythm.state.finished,
      offsetMs: audio.offsetMs(),
      noise: Math.round(rhythm.state.noise),
      maxNoise: Math.round(rhythm.state.maxNoise),
      difficulty,
      syncBoth: !!rhythm.state.syncBoth,
      burst: !!(chart && chart.burst && chart.burst.on),
      paperVariant: sc.paperVariant,
      cam: { x: +sc.cam.x.toFixed(1), y: +sc.cam.y.toFixed(1), z: +sc.cam.z.toFixed(3) }
    }),
    press, release, advance, startLeave, resumePlay, chooseDifficulty: applyDifficulty,
    papersCaught,
    stats: () => rhythm.stats(),
    // 自检用：直接跳到某个状态
    _skipToPlay() { sc.walk = 1; sc.veil = 0; sc.onAir = 1; startReady(); sc.readyT = 3.05; },
    _finishCheck() { finishCheck(true); },
    _finishCheckUI() { finishCheck(false); },
    // 跳到某一秒（演示和截图用）
    _seek(t) { audio.seek(t); rhythm.skipTo(t); sc.playElapsed = 30; }
  };

  if (FRESH) {
    try {
      localStorage.removeItem(SAVE_KEY);
      localStorage.removeItem(DIFF_KEY);
      localStorage.removeItem(RESULT_KEY);
    } catch (e) { }
    SAVE.cleared = false;
    SAVE.offset = 0;
    SAVE.best = 0;
  }
  difficulty = loadDifficulty();
  audio.setOffsetMs(SAVE.offset || 0);
  createRun();

  requestAnimationFrame(loop);
  startIntro();
})(window);

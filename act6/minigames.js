/* 第四幕 · 八个小游戏 — 接入层
 *
 * 故事页（story.js）只负责对白和站位，这里把八个日常接上来：
 *   · 在 #stage 里加一张 512×288 的画布，尺寸和 #art 完全重合，切进切出不会跳；
 *   · 把 act5/core.js 那套画角色、走位、生成人群的引擎接到这张画布上；
 *   · 对白仍然用 story.js 的 #dialog，一个页面里只有一套推进方式；
 *   · 存档单独一个键，清第三幕的档不会顺手清掉这一章的日常。
 *
 * 对外只有两件事：
 *   ACT6Mini.play(id)    演一个小游戏，await 到结束
 *   ACT6Mini.hub()       打开八个日常的目录
 */
(function (global) {
  "use strict";

  const D = global.DAILY;
  if (!D) {
    console.error("第四幕日常：core.js 没加载上");
    return;
  }

  // 第四幕的选项和按钮要能被 Tab 到（core.js 默认拦截 Tab 是给第三幕的
  // G01 换人 / G02 线索本用的）。这里只关掉本章的全局拦截，
  // 单个游戏如果要自己吃 Tab，仍然在 press() 里收得到。
  D.tabCapture = false;

  // ---------------------------------------------------------------- 资源
  // 键名就是小游戏里 D.img[key] 用的名字。

  const ASSETS = {
    corridor: "../assets/scenes/school_corridor_door_pixel.png",
    board: "../assets/scenes/school_corridor_board_lowered_512.png",
    boardBlank: "../assets/minigame/act6/prop_bulletin_blank.png",
    activityPhoto: "../assets/minigame/act6/prop_activity_photo.png",
    planeSheet: "../assets/minigame/act6/prop_paper_plane.png",
    cup: "../assets/minigame/prop_cup.png",
    classroom: "../assets/scenes/school_classroom_open_pixel.png",
    exterior: "../assets/scenes/school_exterior_pixel.png",
    rain: "../assets/scenes/act6/school_corridor_door_rain_512.png",
    dusk: "../assets/scenes/act6/school_corridor_door_dusk_512.png",
    // field 只给拍照 / 毽子 / 纸飞机用；exterior 还是教学楼正面，别的场景照旧。
    field: "../assets/scenes/act6/school_playground_512.png",

    // 雨伞：举伞帧（5 帧）+ 手前景层 + 伞的伞杆 / 伞面两层。
    // 握点、层顺序都以 assets/minigame/act6/manifest.json 为准，见 games/umbrella.js。
    boyUmb: "../assets/characters/boy/v2/umbrella/boy_umbrella_right_sheet.png",
    girlUmb: "../assets/characters/girl/v2/umbrella/girl_umbrella_right_sheet.png",
    boyUmbHand: "../assets/characters/boy/v2/umbrella/boy_umbrella_hand_front_sheet.png",
    girlUmbHand: "../assets/characters/girl/v2/umbrella/girl_umbrella_hand_front_sheet.png",
    umbBack: "../assets/minigame/act6/prop_umbrella_held_back_sheet.png",
    umbFront: "../assets/minigame/act6/prop_umbrella_held_front_sheet.png",

    boy: "../assets/characters/boy/v2/boy_sheet_act5.png",
    girl: "../assets/characters/girl/v2/girl_sheet_act5.png",
    friend: "../assets/characters/friend/v2/friend_sheet_act5.png",
    friendA: "../assets/characters/act6/friend_a_walk_down_sheet.png",
    friendB: "../assets/characters/act6/friend_b_walk_down_sheet.png",
    friendAUp: "../assets/characters/act6/friend_a_walk_up_sheet.png",
    teacher: "../assets/characters/act6/teacher/teacher_act6_sheet.png",
    // 宋遥只有左向四帧：走廊远景路过，不补四向。
    songyao: "../assets/characters/act6/songyao_walk_left_sheet.png",
    // 二班 / 三班 / 四班的班牌，一横三格（每格 32×16）。
    classSigns: "../assets/minigame/act6/ui_class_signs.png",

    npcBoyDown: "../assets/characters/npc_generated/boy_walk_down_sheet.png",
    npcBoyUp: "../assets/characters/npc_generated/boy_walk_up_sheet.png",
    npcBoyLeft: "../assets/characters/npc_generated/boy_walk_left_sheet.png",
    npcBoyRight: "../assets/characters/npc_generated/boy_walk_right_sheet.png",
    npcGirlDown: "../assets/characters/npc_generated/girl_walk_down_sheet.png",
    npcGirlUp: "../assets/characters/npc_generated/girl_walk_up_sheet.png",
    npcGirlLeft: "../assets/characters/npc_generated/girl_walk_left_sheet.png",
    npcGirlRight: "../assets/characters/npc_generated/girl_walk_right_sheet.png"
  };

  // 八個日常仍按故事里的先后排。一周目主线只走进三个（人流 / 照片 / 传纸条），
  // 其余从通关后右上角的「日常」目录进，目录里八场都能重玩。
  const GAMES = [
    { id: "relay", day: "备用 · 课间", name: "一句话经过三个人", tag: "传话", key: "relayCompleted", main: false },
    { id: "crowdrun", day: "第 2 天 · 课间", name: "穿过课间的人流", tag: "走位", key: "crowdRunCompleted", main: true },
    { id: "roster", day: "备用 · 午休", name: "值日表", tag: "排表", key: "rosterCompleted", main: false },
    { id: "photo", day: "第 4 天 · 放学后", name: "留一张照片", tag: "构图", key: "photoCompleted", main: true },
    { id: "passnote", day: "第 5 天 · 上午", name: "传纸条", tag: "时机", key: "passNoteCompleted", main: true },
    { id: "umbrella", day: "备用 · 放学", name: "雨里的伞", tag: "平衡", key: "umbrellaCompleted", main: false },
    { id: "classnotes", day: "备用 · 课堂", name: "课堂笔记", tag: "筛选", key: "classNotesCompleted", main: false },
    { id: "shuttlecock", day: "备用 · 课间", name: "踢毽子", tag: "节奏", key: "shuttlecockCompleted", main: false }
  ];

  const GAME = {
    relay: function () { return D.games.relay; },
    crowdrun: function () { return D.games.crowdrun; },
    roster: function () { return D.games.roster; },
    photo: function () { return D.games.photo; },
    passnote: function () { return D.games.passnote; },
    umbrella: function () { return D.games.umbrella; },
    classnotes: function () { return D.games.classnotes; },
    shuttlecock: function () { return D.games.shuttlecock; },
    // 主线事件 03 / 07：不是日常，不进目录，只由 story.js 调用。
    inquiry: function () { return D.games.inquiry; },
    paperplane: function () { return D.games.paperplane; }
  };

  // 主线里的画布玩法不进「日常」目录，但要走同一套 play() / 收尾 / 退出。
  const MAIN_PACKS = {
    inquiry: { id: "inquiry", day: "第 2 天 · 午休", name: "帮我问一句", tag: "打听" },
    paperplane: { id: "paperplane", day: "第 4 天 · 最后一节课前", name: "纸飞机", tag: "日常" }
  };

  const byId = function (id) {
    return GAMES.find(function (g) { return g.id === id; });
  };

  const packFor = function (id) {
    return byId(id) || MAIN_PACKS[id] || null;
  };

  // ---------------------------------------------------------------- 画布与面板

  const stage = document.getElementById("stage");
  const storyArt = document.getElementById("art");
  const storyDialog = document.getElementById("dialog");
  const headerTitle = document.getElementById("eventTitle");
  const headerDate = document.getElementById("date");
  const veil = document.getElementById("veil");

  const root = document.createElement("div");
  root.id = "mgRoot";
  root.innerHTML =
    '<canvas id="mg" width="512" height="288" aria-label="校园日常"></canvas>' +
    '<div id="mgObj" class="mg-obj"><b>目标</b><span id="mgObjSub"></span></div>' +
    '<div id="mgHint" class="mg-hint"></div>' +
    '<button id="mgExit" class="mg-exit" type="button" hidden>退出</button>' +
    '<div id="mgReact" class="mg-react" hidden></div>' +

    '<div id="crowdClock" class="crowd-clock" hidden><span>课间</span>' +
    '<div class="crowd-bar"><i id="crowdBar"></i></div></div>' +
    '<div id="crowdPad" class="crowd-pad" hidden>' +
    '<button type="button" data-dir="ArrowUp" aria-label="向上">↑</button>' +
    '<button type="button" data-dir="ArrowLeft" aria-label="向左">←</button>' +
    '<button type="button" data-dir="ArrowDown" aria-label="向下">↓</button>' +
    '<button type="button" data-dir="ArrowRight" aria-label="向右">→</button></div>' +

    '<div id="passHud" class="pass-hud" hidden><b id="passTeacher">低头批作业</b>' +
    '<span id="passCount">传了 0 格</span></div>' +

    '<div id="umbHud" class="umb-hud" hidden><span>伞</span>' +
    '<div class="umb-bar"><i id="umbTilt"></i></div><small id="umbTip">← → 调整伞的方向</small></div>' +

    '<div id="shuttleHud" class="shuttle-hud" hidden><b id="shuttleCombo">连击 0</b>' +
    '<button id="shuttleStop" type="button">差不多行了</button></div>' +

    '<div id="choice" class="mg-choice" hidden><p id="choiceLead"></p>' +
    '<div class="row" id="choiceBtns"></div></div>' +

    '<div id="relay" class="relay" hidden>' +
    '<div id="relayPick"><p class="relay-lead" id="relayLead"></p>' +
    '<div class="relay-blocks" id="relayBlocks"></div>' +
    '<p class="relay-tip">只能原样带过去两句。点一句留下，剩下的会被走廊的噪音换掉。</p>' +
    '<button id="relayConfirm" type="button" disabled>就这样说</button></div>' +
    '<div id="relayCompare" class="relay-compare" hidden><h3>同一句话，经过三个人</h3>' +
    '<p><span>原句</span><b id="relayOrigin"></b></p>' +
    '<p><span>朋友甲听到</span><b id="relayFinal"></b></p>' +
    '<small>点一下继续</small></div></div>' +

    '<div id="photo" class="photo" hidden>' +
    '<div class="photo-view" id="photoView">' +
    '<div class="photo-frame" id="photoFrame"><div class="photo-stage" id="photoStage"></div>' +
    '<div class="photo-grid"></div><div class="photo-focus"></div></div>' +
    '<div class="photo-tools"><div class="photo-zoom">' +
    '<button type="button" data-zoom="near">近景</button>' +
    '<button type="button" data-zoom="far">远景</button></div>' +
    '<button id="photoShutter" class="photo-shutter" type="button">快门</button>' +
    '<span class="photo-hint" id="photoHint">拖动三个人 · ← → ↑ ↓ 微调 · 空格快门</span></div>' +
    '<div class="photo-bottom"><div class="photo-strip" id="photoStrip"></div>' +
    '<button id="photoDone" type="button" hidden>拍够了，挑一张</button></div></div>' +
    '<div class="photo-pick" id="photoPick" hidden><h3>留哪一张</h3>' +
    '<div class="photo-pick-list" id="photoPickList"></div>' +
    '<button id="photoKeep" type="button">就这张</button></div>' +
    '<div class="photo-flash" id="photoFlash"></div></div>' +

    '<div id="roster" class="roster" hidden><h3>三班 · 值日表</h3>' +
    '<div class="roster-grid" id="rosterGrid"></div>' +
    '<div class="roster-pool" id="rosterPool"></div>' +
    '<p class="roster-tip" id="rosterTip">四张名字都要排上，每天至少两个人。实在排不出来，也可以「就先这样」。</p>' +
    '<div class="roster-row"><button id="rosterCheck" type="button">这样排</button>' +
    '<button id="rosterSkip" type="button">就先这样</button>' +
    '<button id="rosterClear" type="button">全部拿回</button></div></div>' +

    '<div id="notes" class="notes" hidden><p class="notes-speech" id="notesSpeech"></p>' +
    '<div class="notes-list" id="notesList"></div>' +
    '<p class="notes-count" id="notesCount">记了 0 / 4</p>' +
    '<div class="notes-bar"><i id="notesBar"></i></div>' +
    '<button id="notesDone" class="notes-done" type="button" hidden>记好了</button>' +
    '<div class="notes-book" id="notesBook" hidden></div></div>';

  stage.appendChild(root);
  const exitBtn = document.getElementById("mgExit");

  // 素材加载失败时挂在这里：写明失败项，给一个真的能再试一次的按钮。
  const assetBox = document.createElement("div");
  assetBox.id = "mgAssets";
  assetBox.hidden = true;
  assetBox.innerHTML =
    '<p id="mgAssetsText"></p>' +
    '<button id="mgAssetsRetry" type="button">重试</button>';
  stage.appendChild(assetBox);

  // 目录入口：只在故事看完、或者直接进日常页时出现
  const entry = document.createElement("button");
  entry.id = "mgEntry";
  entry.type = "button";
  entry.textContent = "日常";
  entry.hidden = true;
  stage.appendChild(entry);

  const hub = document.createElement("div");
  hub.className = "mg-hub";
  hub.hidden = true;
  hub.innerHTML =
    '<h1>第四幕 · 日常</h1>' +
    '<p class="sub">那些没什么用的下午</p>' +
    '<ul id="mgHubList"></ul>' +
    '<div class="row"><button id="mgHubReset" type="button">清掉日常存档</button>' +
    '<button id="mgHubClose" type="button">回到剧情</button></div>';
  stage.appendChild(hub);

  const canvas = document.getElementById("mg");
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  // ---------------------------------------------------------------- 存档
  // 和 story.js 的 our-story-act6-v1 分开：清章节剧情不会把日常一起抹掉。

  const KEY = "our-story-act6-daily-v1";
  let store = {};
  try { store = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { store = {}; }

  D.store = store;
  D.persist = function (patch) {
    if (patch) Object.assign(store, patch);
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* 无痕模式 */ }
  };
  D.wipe = function () {
    store = {};
    D.store = store;
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  };

  // ---------------------------------------------------------------- 配角
  // act6 的朋友甲 / 乙只有朝下的一张四帧行走表。

  D.FRAMES.friendA = {
    idleDown: [0, 0], idleLeft: [0, 0], idleRight: [0, 0], idleUp: [0, 0],
    walkDown: [0, 3], walkLeft: [0, 3], walkRight: [0, 3], walkUp: [0, 3]
  };
  D.FRAMES.friendB = {
    idleDown: [0, 0], idleLeft: [0, 0], idleRight: [0, 0], idleUp: [0, 0],
    walkDown: [0, 3], walkLeft: [0, 3], walkRight: [0, 3], walkUp: [0, 3]
  };
  // 背对镜头的朋友甲（自习课坐在前排，面朝黑板）
  D.FRAMES.friendAUp = {
    idleDown: [0, 0], idleLeft: [0, 0], idleRight: [0, 0], idleUp: [0, 0],
    walkDown: [0, 3], walkLeft: [0, 3], walkRight: [0, 3], walkUp: [0, 3]
  };
  // 老师：12 帧表（48×72 ×12）。0 站立 / 1 低头批作业 / 2 抬头扫视 / 3 背身写黑板，
  // 4–7 向左走（抱作业，作业已经画进帧里）、8–11 向右走。走路不再是「三个姿势加一帧」。
  D.FRAMES.teacher = {
    idleDown: [0, 0], idleLeft: [4, 4], idleRight: [8, 8], idleUp: [3, 3],
    walkDown: [0, 0], walkLeft: [4, 7], walkRight: [8, 11], walkUp: [3, 3],
    poseDown: [1, 1], poseScan: [2, 2], poseTurn: [3, 3]
  };
  // 举伞帧：0 站立，1–4 向右走。两个人都只有朝右的一套（这个游戏里所有人朝右）。
  D.FRAMES.boyUmb = {
    idleDown: [0, 0], idleLeft: [0, 0], idleRight: [0, 0], idleUp: [0, 0],
    walkDown: [1, 4], walkLeft: [1, 4], walkRight: [1, 4], walkUp: [1, 4]
  };
  D.FRAMES.girlUmb = {
    idleDown: [0, 0], idleLeft: [0, 0], idleRight: [0, 0], idleUp: [0, 0],
    walkDown: [1, 4], walkLeft: [1, 4], walkRight: [1, 4], walkUp: [1, 4]
  };
  // 宋遥只有一张左向四帧表：站着和路过都用它，没有 E，也没有对白。
  D.FRAMES.songyao = {
    idleDown: [0, 0], idleLeft: [0, 0], idleRight: [0, 0], idleUp: [0, 0],
    walkDown: [0, 3], walkLeft: [0, 3], walkRight: [0, 3], walkUp: [0, 3]
  };

  // ---------------------------------------------------------------- 尺寸对齐
  // 故事页的 .actor 是 48×72 的 1.4 倍；画布上的角色也按 1.4 画，
  // 这样从对白切进小游戏，人物的个头不会突然矮一截。

  const CHARACTER_SCALE = 1.4;
  // 雨伞要把伞柄对准手，得知道角色实际画多大；这里把倍率露出去，
  // 以后调人物大小，伞的握点会跟着走。
  D.CHARACTER_SCALE = CHARACTER_SCALE;
  const drawActorBase = D.drawActor;
  D.drawActor = function (ctx2, a, t) {
    const copy = Object.assign({}, a, { scale: (a.scale == null ? 1 : a.scale) * CHARACTER_SCALE });
    drawActorBase(ctx2, copy, t);
  };
  const shadowBase = D.shadow;
  D.shadow = function (ctx2, x, y, w) {
    shadowBase(ctx2, x, y, (w || D.FRAME_W) * CHARACTER_SCALE * 0.92);
  };

  // ---------------------------------------------------------------- 对白桥接
  // 小游戏里只调 D.lines：它落到 story.js 的 say()，推进还是那套点击 / 回车。

  function story() { return global.ACT6; }

  D.lines = async function (items) {
    const api = story();
    if (!api) return;
    D.emit("dialog:start");
    try {
      for (const item of items) {
        if (item[2]) item[2]();
        await api.say(item[0], item[1]);
      }
    } finally {
      D.emit("dialog:end");
    }
  };
  D.dialogOpen = function () {
    return !storyDialog.hidden;
  };
  D.advance = function () {
    const api = story();
    if (api) api.advance();
  };

  // ---------------------------------------------------------------- 界面小工具

  D.ui = {
    el: function (tag, cls, text) {
      const node = document.createElement(tag);
      if (cls) node.className = cls;
      if (text != null) node.textContent = text;
      return node;
    },
    show: function (el) {
      if (!el) return;
      clearTimeout(el.__hideT);
      el.hidden = false;
      requestAnimationFrame(function () { el.classList.add("show"); });
    },
    hide: function (el, ms) {
      if (!el) return;
      el.classList.remove("show");
      clearTimeout(el.__hideT);
      el.__hideT = setTimeout(function () { el.hidden = true; }, ms == null ? 200 : ms);
    },
    clear: function (el) { if (el) el.replaceChildren(); }
  };

  // 目标 / 提示 / 短反应

  const objEl = document.getElementById("mgObj");
  const objSub = document.getElementById("mgObjSub");
  D.objective = function (title, sub) {
    if (!objEl) return;
    if (!title) { objEl.classList.remove("show"); return; }
    objEl.querySelector("b").textContent = "目标";
    objSub.textContent = sub || "";
    objEl.classList.add("show");
    objEl.dataset.title = title;
  };

  const hintEl = document.getElementById("mgHint");
  let hintTimer = 0;
  D.hint = function (text, ms) {
    if (!hintEl) return;
    if (!text) { hintEl.classList.remove("show"); return; }
    hintEl.textContent = text;
    hintEl.classList.add("show");
    clearTimeout(hintTimer);
    if (ms !== 0) hintTimer = setTimeout(function () { hintEl.classList.remove("show"); }, ms || 2600);
  };

  const reactEl = document.getElementById("mgReact");
  const reactQueue = [];
  let reactCurrent = null;
  let reactTimer = 0;

  function nextReact() {
    if (reactCurrent || !reactQueue.length) return;
    const r = reactQueue.shift();
    reactCurrent = r;
    reactEl.replaceChildren(D.ui.el("b", "", r.who), D.ui.el("span", "", r.text));
    reactEl.hidden = false;
    requestAnimationFrame(function () { if (reactCurrent === r) reactEl.classList.add("show"); });
    reactTimer = setTimeout(function () {
      reactEl.classList.remove("show");
      reactCurrent = null;
      reactTimer = setTimeout(function () {
        if (!reactCurrent) reactEl.hidden = true;
        nextReact();
      }, 170);
    }, r.ms || 1700);
  }

  D.react = function (who, text, ms) {
    reactQueue.push({ who: who, text: text, ms: ms || 1700 });
    nextReact();
  };
  D.clearReact = function () {
    clearTimeout(reactTimer);
    reactQueue.length = 0;
    reactCurrent = null;
    reactEl.classList.remove("show");
    reactEl.hidden = true;
  };
  D.reactHint = function () { /* 这一章没有「主动搭话」，留着接口 */ };
  D.onPoke = function () { /* 同上 */ };
  D.poke = function () { /* 同上 */ };

  // ---------------------------------------------------------------- 一句选择

  let choosing = false;
  let abortChoice = null;

  function choose(lead, options) {
    return new Promise(function (resolve) {
      const box = document.getElementById("choice");
      const leadEl = document.getElementById("choiceLead");
      const list = document.getElementById("choiceBtns");
      if (!box || !leadEl || !list) { resolve(0); return; }

      choosing = true;
      leadEl.textContent = lead;
      list.innerHTML = "";

      let done = false;
      let timer = 0;

      function finish(i) {
        if (done) return;
        done = true;
        choosing = false;
        abortChoice = null;
        clearTimeout(timer);
        window.removeEventListener("keydown", onKey);
        D.ui.hide(box);
        resolve(i);
      }

      function onKey(e) {
        if (D.dialogOpen()) return;      // 对白还没读完，先不响应
        const n = Number(e.key);
        if (n >= 1 && n <= options.length) { D.audio.click(); finish(n - 1); }
      }

      options.forEach(function (text, i) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = text;
        b.onclick = function () { D.audio.click(); finish(i); };
        list.appendChild(b);
      });

      // Esc / 异常退出时收掉面板，返回 -1；调用方的 run() 会看到 disposed 直接收工。
      abortChoice = function () { finish(-1); };

      D.ui.show(box);
      window.addEventListener("keydown", onKey);
      // 十二秒没人动就选第一个：这几种选择都不判好坏，不能因为走神卡住。
      timer = setTimeout(function () { finish(0); }, 12000);
    });
  }

  // ---------------------------------------------------------------- 跑一场

  let active = null;
  let activePack = null;
  let raf = 0;
  let last = 0;
  let running = false;
  let activeSettle = null;

  function stopFrame() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
  }

  function frame(ts) {
    try {
      if (!last) last = ts;
      const dt = Math.min(0.05, (ts - last) / 1000);
      last = ts;

      if (active && active.update) active.update(dt);
      ctx.clearRect(0, 0, D.W, D.H);
      if (active && active.draw) active.draw(ctx);
      else { ctx.fillStyle = "#1b1924"; ctx.fillRect(0, 0, D.W, D.H); }

      raf = requestAnimationFrame(frame);
    } catch (error) {
      // 一帧画错就停掉这一局，走和正常结束相同的收尾，别留下黑场、HUD 和 running=true。
      console.error(error);
      stopFrame();
      if (activeSettle) activeSettle({ id: activePack ? activePack.id : null, completed: false, error: String(error) });
    }
  }

  function veilTo(opacity, ms) {
    return new Promise(function (resolve) {
      veil.style.transition = "opacity " + (ms || 320) + "ms linear";
      veil.style.opacity = String(opacity);
      setTimeout(resolve, (ms || 320) + 20);
    });
  }

  /** 统一退出：Esc 和屏幕上的「退出」都走这里，和正常结束同一套清理。 */
  function requestExit() {
    if (!running || !activeSettle) return false;
    if (D.dialogOpen() || choosing) return false;   // 对白/选择没收尾，先不并发
    if (active && active.setFrozen) {
      try { active.setFrozen(true); } catch (error) { console.error(error); }
    }
    stopFrame();
    activeSettle({ id: activePack ? activePack.id : null, completed: false, cancelled: true });
    return true;
  }

  /** 收尾：先把画布盖住，再放掉这一场的 HUD、面板、监听和定时器。 */
  async function cleanup(keepTitle, keepDate) {
    try { await veilTo(1, 240); } catch (error) { console.error(error); }
    if (active) {
      try { active.dispose(); } catch (error) { console.error(error); }
      active = null;
    }
    if (abortChoice) { try { abortChoice(); } catch (error) { console.error(error); } }
    stopFrame();
    root.classList.remove("on");
    exitBtn.hidden = true;
    D.objective(null);
    D.hint(null);
    D.clearReact();
    storyArt.hidden = false;
    headerTitle.textContent = keepTitle;
    headerDate.textContent = keepDate;
    running = false;
    activePack = null;
    activeSettle = null;
    updateEntry();
    try { await veilTo(0, 320); } catch (error) { console.error(error); }
  }

  /** 演一个小游戏。opts.when 会写到右上角的日期上；opts 也交给游戏自己读。 */
  async function play(id, opts) {
    const pack = packFor(id);
    if (!pack || running || !GAME[id]) return null;
    if (hubOpen) hideHub();          // 目录压在上面会挡掉面板的点击
    await assetsReady;

    const o = opts || {};
    running = true;
    activePack = pack;
    const keepTitle = headerTitle.textContent;
    const keepDate = headerDate.textContent;

    let settle = null;
    let settled = false;
    const finished = new Promise(function (resolve) {
      settle = function (value) {
        if (settled) return;
        settled = true;
        resolve(value);
      };
    });
    activeSettle = settle;

    let result = null;
    try {
      await veilTo(1, 260);
      storyArt.hidden = true;
      root.classList.add("on");
      exitBtn.hidden = false;
      headerTitle.textContent = pack.name;
      headerDate.textContent = o.when || pack.day;
      await veilTo(0, 300);

      const host = {
        opts: o,
        setChapter: function (text) { if (text) headerDate.textContent = text; },
        done: function (r) { settle(r); },
        lines: function (items) { return D.lines(items); },
        say: function (who, text) { return D.lines([[who, text]]); },
        choose: choose,
        // 主线玩法用这一对读写 story.js 的存档；日常游戏仍然用 D.persist 写日常键。
        persist: function (patch) {
          const api = story();
          if (api && api.persist) api.persist(patch);
        },
        state: function () {
          const api = story();
          return api && api.state ? api.state : {};
        },
        learn: function (factId, source, confidence, when) {
          const api = story();
          if (api && api.learn) api.learn(factId, source, confidence, when);
        }
      };

      // 工厂、start、等待结束都包在 try 里：任何一步抛错都记成 {completed:false,error}，
      // 由下面的 finally 统一收尾；下一个小游戏仍然能进来。
      try {
        const factory = GAME[id]();
        const game = factory(host);
        active = game;
        last = 0;
        if (!raf) raf = requestAnimationFrame(frame);
        game.start();
      } catch (error) {
        console.error(error);
        settle({ id: id, completed: false, error: String(error) });
      }

      result = await finished;
    } catch (error) {
      console.error(error);
      result = result || { id: id, completed: false, error: String(error) };
    } finally {
      await cleanup(keepTitle, keepDate);
    }
    return result;
  }

  // ---------------------------------------------------------------- 按键

  exitBtn.addEventListener("click", function () { requestExit(); });

  document.addEventListener("keydown", function (e) {
    if (!active || running === false) return;
    if (e.key === "Escape") {
      if (choosing || !storyDialog.hidden) return;   // 对白/选择进行中先不打断
      e.preventDefault();
      requestExit();
      return;
    }
    if (choosing) return;
    if (!storyDialog.hidden) return;          // 对白优先，story.js 自己推进
    if (e.repeat) return;
    if (active.press) active.press(e.key);
  });

  D.on("dialog:start", function () { if (active && active.setFrozen) active.setFrozen(true); });
  D.on("dialog:end", function () { if (active && active.setFrozen) active.setFrozen(false); });

  // ---------------------------------------------------------------- 目录

  let hubOpen = false;
  let dialogWasHidden = true;

  function renderHub() {
    const list = document.getElementById("mgHubList");
    list.replaceChildren();
    GAMES.forEach(function (g) {
      const done = !!D.store[g.key];
      const li = document.createElement("li");
      if (done) li.className = "done";
      li.append(
        D.ui.el("span", "day", g.day),
        D.ui.el("span", "name", g.name),
        D.ui.el("span", "where" + (g.main ? " main" : ""), g.main ? "一周目" : "目录"),
        D.ui.el("span", "tag", done ? "玩过了" : g.tag)
      );
      li.addEventListener("click", function () {
        hideHub();
        play(g.id).then(function () { showHub(); });
      });
      list.appendChild(li);
    });
  }

  function showHub() {
    renderHub();
    if (!hubOpen) dialogWasHidden = storyDialog.hidden;
    hubOpen = true;
    storyDialog.hidden = true;      // 目录开着的时候，回车不该推进背后的对白
    entry.hidden = true;
    D.ui.show(hub);
  }

  function hideHub() {
    hubOpen = false;
    D.ui.hide(hub);
    if (!dialogWasHidden && story()) storyDialog.hidden = false;
    updateEntry();
  }

  function updateEntry() {
    // 通关后（chapter04Completed）在剧情页右上角留一个「日常」入口；
    // 目录开着的时候先收起来，别和「回到剧情」并排。?daily= 仍然直接进目录。
    const direct = new URLSearchParams(location.search).get('daily') !== null;
    let chapterDone = false;
    try { chapterDone = !!(global.ACT6 && global.ACT6.state && global.ACT6.state.chapter04Completed); }
    catch (error) { chapterDone = false; }
    entry.hidden = !(direct || chapterDone) || hubOpen || running;
  }

  entry.addEventListener("click", function () {
    if (running) return;
    showHub();
  });
  document.getElementById("mgHubClose").addEventListener("click", hideHub);
  document.getElementById("mgHubReset").addEventListener("click", function () {
    D.wipe();
    renderHub();
  });

  // 故事看完之后，右上角留一个进目录的入口
  setInterval(updateEntry, 600);

  // ---------------------------------------------------------------- 启动

  // 浏览器要求先有一次用户手势才允许出声
  function unlockAudio() { D.audio.unlock(); }
  document.addEventListener("pointerdown", unlockAudio);
  document.addEventListener("keydown", unlockAudio);

  // 素材逐个加载：失败的不再静默吞掉，记下来，画面上给一条能重试的提示。
  const assetFailures = new Map();
  const assetText = document.getElementById("mgAssetsText");
  const assetRetry = document.getElementById("mgAssetsRetry");
  let assetRetrying = null;

  function renderAssetError() {
    if (!assetFailures.size) { assetBox.hidden = true; return; }
    assetText.textContent = "有 " + assetFailures.size + " 个素材没加载上：" +
      [...assetFailures.keys()].join("、") + "。可以重试，或者先继续。";
    assetBox.hidden = false;
  }

  function loadAsset(key) {
    return D.load(key, ASSETS[key]).then(
      function (img) { assetFailures.delete(key); return img; },
      function (error) {
        assetFailures.set(key, String(error && error.message ? error.message : error));
        console.error("第四幕日常：素材没加载上", key, error);
      }
    );
  }

  const assetsReady = Promise.all(Object.keys(ASSETS).map(loadAsset)).then(renderAssetError);

  assetRetry.addEventListener("click", function () {
    if (assetRetrying) return;
    assetRetry.disabled = true;
    assetText.textContent = "正在重试…";
    assetRetrying = Promise.all([...assetFailures.keys()].map(loadAsset)).then(function () {
      assetRetrying = null;
      assetRetry.disabled = false;
      renderAssetError();
    });
  });

  const params = new URLSearchParams(location.search);
  const daily = params.get("daily");

  if (daily) {
    assetsReady.then(function () {
      if (daily === "1" || !GAME[daily]) { showHub(); return; }
      play(daily).then(function () { showHub(); });
    });
  }

  // 对外的两个入口
  global.ACT6Mini = {
    games: GAMES,
    play: play,
    hub: showHub,
    closeHub: hideHub,
    get busy() { return running; },
    get current() { return active; },
    store: function () { return D.store; }
  };

})(window);



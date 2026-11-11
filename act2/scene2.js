/* 第二幕 · 黑板报 — 场景与镜头
 *
 * 流程：次日走廊（对白）→ 镜头推近宣传栏旁的黑板 → 画 → 拉回，两个人看成果。
 */
(function (global) {
  "use strict";

  const W = 512, H = 288;
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  // 椅子描顶边（§1.2）：主图达标、上边框还没画到一半时触发。
  // 与 G01 的抬箱平衡同构（指针 + 绿区 + 停笔不失败），但参数独立，不共享常量。
  const CHAIR = {
    triggerEdge: 0.5,     // 上边框覆盖率低于这个数才触发
    triggerDelay: 0.9,    // 主图达标后等多久她开口
    introTime: 0.8,       // 镜头推上去的时长
    duration: 6.0,        // 她描完顶边需要的时间（指针在绿区里才算进度）
    zone: [0.42, 0.58],   // 绿区（指针位置 0..1）
    drift: 0.5,           // 晃动指针的漂移强度
    accel: 1.15,          // A / D 的推力
    damp: 2.3,            // 阻尼
    span: [0.16, 0.84],   // 顶边从板宽哪儿描到哪儿
    settleChunk: 0.22,    // 每多久把粉笔落进图层并刷新一次统计
    shotTime: 1.7,        // 「板前退开」复用镜头停留时长
    lineAfter: 0.9,       // 退开镜头前留一点空白
    seed: 20261109        // 晃动指针的种子（可复现，§0.5）
  };

  // 自己写的伪随机（和 act5/ball.js 的 makeRnd 同式）：晃动指针可复现。
  function makeRnd(seed) {
    let s = seed >>> 0;
    return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }

  const el = (id) => document.getElementById(id);
  const bar = el("bar");
  const progEl = el("prog");
  const dlgEl = el("dlg");
  const dlgWho = el("dlgWho");
  const dlgLine = el("dlgLine");
  const hintEl = el("hint");
  const cardEl = el("card");
  const textIn = el("textin");
  const leaveEl = el("leave");
  const byeEl = el("bye");
  const byeLineEl = el("byeLine");
  const pickEl = el("pick");

  // 退出之后去哪儿。宿主接进来时用 ?back=... 指定；单开就回学校故事。
  const BACK = (() => {
    try {
      return new URLSearchParams(location.search).get("back") || "../school-preview.html";
    } catch (e) {
      return "../school-preview.html";
    }
  })();

  // 第二幕结算存档键（§1.5 / §九）：{ theme, themeName, evalIds, evals:[{id,text}] }
  // evals 里的 text 是实际说出口的整句，第四幕不同页面不用 import act2/lines.js
  // 也能直接引用。旧档没有这个键时按「无评价」处理，不报错。
  const EVAL_KEY = "our-story-act2-board-eval-v1";

  const IMG = {
    corridor: "../assets/scenes/school_corridor_board_lowered_512.png",
    boy: "../assets/characters/boy/v2/boy_sheet_v2.png",
    girl: "../assets/characters/girl/v2/girl_sheet_v2.png",
    friend: "../assets/characters/friend/v2/friend_sheet_v2.png"
  };
  const img = {};

  const board = global.ACT2.Board.createBoard(canvas);
  const LINES = global.ACT2.Lines;
  const pick = LINES.pick;
  const nextExchange = LINES.exchange;
  const THEMES = LINES.THEMES || {};
  const THEME_ORDER = LINES.THEME_ORDER || ["sports", "reading", "graduation"];

  // ---------------------------------------------------------------- 对白

  let dlg = null;
  function say(who, text, onDone) {
    dlg = { who, text, shown: 0, t: 0, onDone };
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
    const fn = dlg.onDone;
    dlg = null;
    dlgEl.classList.remove("show");
    if (fn) fn();
    return true;
  }
  function lines(items, done) {
    let i = 0;
    const next = () => {
      if (i >= items.length) { done && done(); return; }
      const [who, text] = items[i++];
      say(who, text, next);
    };
    next();
  }

  // 点对白框也能推进：和 E / 空格 / Enter 一样，先补完这一行，再翻下一句。
  // （以前只挂了 E 的键帽，框上却是 pointer 光标，点了没反应。）
  dlgEl.addEventListener("pointerdown", (e) => {
    if (!dlg) return;
    e.preventDefault();
    advance();
  });

  // 她画画时说话：走画布下面那条字幕，不挡笔。
  //
  // 画板期间只有这一条文字通道——她补完一笔、玩家擦掉一笔、她自己闲聊，
  // 全从这儿过，所以画面上永远有话说，不会一会儿冒一句一会儿没动静。
  const subsEl = el("subs");
  const subsWho = el("subsWho");
  const subsLine = el("subsLine");

  const chat = {
    on: false,
    manual: false,  // 手动推进（结尾那几句）；false 就是自己往下滚
    paused: false,  // 主题/粉笔选择时暂停轮播（别把选择题顶掉）
    hold: 0,        // 这一句还显示多久
    gap: 0,         // 两句之间空多久
    queue: [],      // 待播的 [谁, 说什么]
    after: null     // manual 模式放完之后接什么
  };

  function subsShow(who, text, hold) {
    if (!text) return;
    subsWho.textContent = who;
    subsLine.textContent = text;
    subsEl.dataset.who = who;
    subsEl.classList.add("show");
    subsEl.classList.remove("quiet");
    chat.hold = hold == null ? 3.4 : hold;
  }
  function subsHide() {
    subsEl.classList.remove("show", "quiet");
    chat.hold = 0;
  }
  function herSay(text) {
    if (!text) return;
    // 已经退场 / 已经收尾，别再冒话：她的一句会盖掉退场那句，也会盖掉结尾对白
    if (sc.state === "leave" || sc.state === "done") return;
    // 椅子段她的话走 talkLines / subsShow，别让闲聊盖掉专属对白
    if (chair.phase !== "off") return;
    subsShow("朱里", text, 3.6);
  }

  /** 一句念多久：按字数给，短句不拖，长句够看完。 */
  function holdFor(text) {
    return 2.4 + Math.min(2.4, text.length * 0.115);
  }

  /**
   * 字幕轮播。放完一段对话（2–3 句来回）自动接下一段，
   * 队列空了就再抽一段——「一直要有交谈」，不靠玩家点。
   */
  function chatStep(dt) {
    if (!chat.on || chat.manual || chat.paused) return;
    if (chat.hold > 0) {
      chat.hold -= dt;
      // 说完了不整条藏起来——底下站着两个人，藏起来就像信号断了。
      // 只把对话框压暗，0.32 秒后换下一句。
      if (chat.hold <= 0) { subsEl.classList.add("quiet"); chat.gap = 0.32; }
      return;
    }
    if (chat.gap > 0) {
      chat.gap -= dt;
      if (chat.gap > 0) return;
    }
    if (!chat.queue.length) chat.queue = nextExchange();
    const next = chat.queue.shift();
    if (!next) return;
    subsShow(next[0], next[1], holdFor(next[1]));
  }

  function chatStart(first) {
    chat.on = true;
    chat.manual = false;
    chat.paused = false;
    chat.queue = first ? [first] : [];
    chat.hold = 0;
    chat.gap = 0.5;
  }
  function chatStop() {
    chat.on = false;
    chat.manual = false;
    chat.after = null;
    chat.queue = [];
    subsHide();
  }

  /**
   * 手动推进的一段对白，走同一条对白区（不弹 #dlg）。
   *
   * 用在结尾：板子刚画完，玩家正想看看自己画了什么，这时候在中间压一个
   * 对话框等于把作品盖住。两个人站在画布下面说话，板子一直是完整的。
   */
  function talkLines(items, done) {
    chat.on = true;
    chat.manual = true;
    chat.paused = false;
    chat.queue = items.map((q) => [q[0], q[1]]);
    chat.after = done || null;
    chat.hold = 0;
    chat.gap = 0;
    talkNext();
  }

  function talkNext() {
    const next = chat.queue.shift();
    if (!next) {
      const fn = chat.after;
      chat.manual = false;
      chat.after = null;
      chat.on = false;
      subsHide();
      if (fn) fn();
      return;
    }
    subsShow(next[0], next[1], 0);
  }

  /** 手动模式下推进一句。返回 false 表示当前不是在等玩家按键。 */
  function advanceTalk() {
    if (!chat.manual) return false;
    talkNext();
    return true;
  }

  // ---------------------------------------------------------------- 开画前选主题（§1.1）

  function themeChoices() {
    return THEME_ORDER.map((id) => THEMES[id]).filter(Boolean);
  }

  /** 开画前的三选一：对白区里摆三个按钮，数字键 1–3 也能选。 */
  function openThemePick() {
    if (sc.state !== "board") return;
    sc.themePicking = true;
    pickEl.hidden = false;
    pickEl.innerHTML = "";
    for (const t of themeChoices()) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "opt theme";
      b.dataset.theme = t.id;
      b.textContent = t.name;
      b.onclick = () => pickTheme(t.id);
      pickEl.append(b);
    }
    chat.paused = true;
    subsWho.textContent = "朱里";
    subsLine.textContent = "板子还空着。这次画什么？";
    subsEl.dataset.who = "朱里";
    subsEl.classList.add("show");
    subsEl.classList.remove("quiet");
    hint("选一个主题（1 / 2 / 3）——底稿和图案会跟着换");
    emit("board:theme-open", { themes: themeChoices().map((t) => t.id) });
  }

  function closePick() {
    if (!pickEl) return;
    pickEl.hidden = true;
    pickEl.innerHTML = "";
  }

  /**
   * 选定主题。底稿（四张淡线 + 主图画稿）、图案推荐序、起始粉笔色一起换。
   * 立刻存一次盘：玩家选完主题画两笔就走，回来还是这个主题。
   */
  function pickTheme(id) {
    if (sc.state !== "board") return null;
    if (!THEMES[id]) return null;
    board.setTheme(id);
    LINES.setTheme(id);
    sc.themePicking = false;
    closePick();
    rebuildPatterns();
    repaintThumbs();
    syncUI();
    board.save();
    chat.paused = false;
    chatStart(["朱里", THEMES[id].pick]);
    hint("主题 · " + THEMES[id].name + "｜照着淡线画，画完一块它自己淡掉");
    emit("board:theme", { theme: id, name: THEMES[id].name });
    return id;
  }

  // ---------------------------------------------------------------- 粉笔二选一（§1.4）

  /** 对白区里摆两支粉笔，玩家挑一支；数字键 1 / 2 也能选。 */
  function openChalkPick(pair) {
    if (sc.state !== "board" || !pair) return;
    sc.chalkPick = { a: pair.a, b: pair.b };
    chat.paused = true;
    pickEl.hidden = false;
    pickEl.innerHTML = "";
    [pair.a, pair.b].forEach((idx, order) => {
      const c = board.COLORS[idx];
      if (!c) return;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "opt swatch";
      b.dataset.color = String(idx);
      b.dataset.key = String(order + 1);
      b.title = c.name;
      b.style.background = c.hex;
      b.textContent = c.name;
      b.onclick = () => chooseChalk(idx);
      pickEl.append(b);
    });
    subsWho.textContent = "朱里";
    subsLine.textContent = LINES.chalkOffer(board.COLORS[pair.a].name, board.COLORS[pair.b].name);
    subsEl.dataset.who = "朱里";
    subsEl.classList.add("show");
    subsEl.classList.remove("quiet");
    hint("选一支粉笔（1 / 2）——另一支她拿去补装饰");
  }

  /** 玩家选了哪支：自己用选中的，她用没被选的那支补装饰区。 */
  function chooseChalk(idx) {
    const pair = sc.chalkPick;
    if (!pair || (idx !== pair.a && idx !== pair.b)) return null;
    sc.chalkPick = null;
    closePick();
    chat.paused = false;
    board.setColor(idx);
    repaintThumbs();
    syncUI();
    const res = girl.takeChalk(idx);
    subsShow("朱里", LINES.chalkPicked(board.COLORS[idx].name), 3.4);
    emit("board:chalk", { chosen: idx, used: res ? res.other : null });
    return res;
  }

  // ---------------------------------------------------------------- 椅子描顶边（§1.2）

  /** 触发条件：主图达标，但上边框还没画到一半。 */
  function chairWanted() {
    if (chair.done || chair.phase !== "off" || sc.finished) return false;
    // 选项没选完、她自己手上还有一笔时先等等：椅子段会把她的 update 停掉，
    // 半截辅助会僵在那儿；等选择题和这一笔都收尾了再开始。
    if (sc.themePicking || sc.chalkPick || girl.active) return false;
    const r = board.regions();
    return r.main.done && r.frame.edges.top < CHAIR.triggerEdge;
  }

  function startChairIntro() {
    if (chair.phase !== "off") return;
    // 手上这一笔先收掉：镜头要动，正在拖的笔会被带歪
    if (activeId != null) { activeId = null; sc.drawing = false; board.up(); }
    chair.phase = "intro";
    chair.t = 0;
    chair.pending = 0;
    chair.progress = 0;
    chair.drawnK = 0;
    chair.pos = 0.5;
    chair.vel = 0;
    chair.paused = 0;
    chair.sway = 0;
    chair.driftA = chair.rnd() * Math.PI * 2;
    chair.driftB = chair.rnd() * Math.PI * 2;
    chair.driftT = 0;
    chair.settleAt = 0;
    board.lock(true);
    chat.paused = true;
    subsShow("朱里", pick("chair"), 2.6);
    emit("board:chair", { phase: "intro" });
  }

  function startChairPlay() {
    chair.phase = "play";
    chair.t = 0;
    hint("A / D 稳住椅子 —— 指针在绿区里她才落笔，偏了只是停一下");
    emit("board:chair", { phase: "play" });
  }

  /** 她按进度把顶边补进她的图层（板面坐标：y=6 是上边框环带中线）。 */
  function chairChalkTo(k) {
    const to = clamp(k, 0, 1);
    if (to <= chair.drawnK) return;
    // 她的一笔 = 一次 Ctrl+Z：顶边整段必须自成一个历史条目。
    // 缺了这次快照，撤销会把这条线和玩家上一笔一起撤掉。
    if (chair.drawnK === 0) board.assist.snapshot();
    const bx0 = board.BW * (CHAIR.span[0] + (CHAIR.span[1] - CHAIR.span[0]) * chair.drawnK);
    const bx1 = board.BW * (CHAIR.span[0] + (CHAIR.span[1] - CHAIR.span[0]) * to);
    board.assist.line([[bx0, 6], [bx1, 6]], { color: "#f4ecdd", w: 2, alpha: 0.86 });
    chair.drawnK = to;
  }

  function stepChairPlay(dt) {
    chair.t += dt;
    // 晃动：两条不同频率的正弦叠起来，由种子给相位——可复现，但不是死循环
    chair.driftT += dt;
    const drift = (Math.sin(chair.driftT * 1.9 + chair.driftA) * 0.7 +
      Math.sin(chair.driftT * 3.7 + chair.driftB) * 0.3) * CHAIR.drift;
    const dir = (chairKeys.d ? 1 : 0) - (chairKeys.a ? 1 : 0);
    chair.vel += (dir * CHAIR.accel + drift) * dt;
    chair.vel *= Math.max(0, 1 - CHAIR.damp * dt);
    chair.pos += chair.vel * dt;
    if (chair.pos < 0) { chair.pos = 0; chair.vel = Math.abs(chair.vel) * 0.35; }
    if (chair.pos > 1) { chair.pos = 1; chair.vel = -Math.abs(chair.vel) * 0.35; }
    chair.sway = dir !== 0 ? dir * -0.06 : chair.sway * Math.max(0, 1 - dt * 6);

    const inZone = chair.pos >= CHAIR.zone[0] && chair.pos <= CHAIR.zone[1];
    if (inZone) {
      chair.progress = Math.min(1, chair.progress + dt / CHAIR.duration);
      chairChalkTo(chair.progress);
    } else {
      // 出界只是停笔等一下：不减进度、不失败、不重开
      chair.paused += dt;
      chair.settleAt = 0;
    }

    chair.settleAt += dt;
    if (chair.settleAt >= CHAIR.settleChunk) {
      chair.settleAt = 0;
      board.assist.settle();
    }
    if (chair.progress >= 1) finishChair();
  }

  function finishChair() {
    chairChalkTo(1);
    board.assist.settle();
    chair.phase = "lines";
    chair.t = 0;
    chair.done = true;
    emit("board:chair", { phase: "done", progress: 1, paused: +chair.paused.toFixed(2) });
    // 描完那两句专属对白；读完再停 1.7 秒「板前退开」复用镜头。
    talkLines([
      ["朱里", pick("chairDone")],
      ["朱里", pick("chairDone")]
    ], () => {
      chair.phase = "shot";
      chair.t = 0;
      hint("站远一点看看");
    });
  }

  function updateChair(dt) {
    if (chair.phase === "off") {
      if (chairWanted()) {
        chair.pending += dt;
        if (chair.pending >= CHAIR.triggerDelay) startChairIntro();
      } else {
        chair.pending = 0;
      }
      return;
    }
    // 镜头推上去 / 退回来
    const target = chair.phase === "off" ? 0 : 1;
    sc.pull += (target - sc.pull) * Math.min(1, dt * 4.5);

    if (chair.phase === "intro") {
      chair.t += dt;
      if (chair.t >= CHAIR.introTime) startChairPlay();
      return;
    }
    if (chair.phase === "play") { stepChairPlay(dt); return; }
    if (chair.phase === "lines") {
      chair.t += dt;
      if (chair.t >= CHAIR.lineAfter) sc.pull = Math.max(sc.pull, 1);
      return;
    }
    if (chair.phase === "shot") {
      chair.t += dt;
      if (chair.t >= CHAIR.shotTime) {
        chair.phase = "off";
        sc.pull = 0;
        board.lock(false);
        hint("接着画吧");
        chatStart(["朱里", pick("chairAfter")]);
        emit("board:chair", { phase: "off" });
      }
    }
  }

  // ---------------------------------------------------------------- 场景状态

  const sc = {
    state: "class",     // class | approach | push | board | leave | done
    t: 0,
    zoom: 1,
    approach: 0,
    boardAlpha: 0,
    drawing: false,
    finished: false,
    walked: 0,          // 完成镜头里两个人走进来的进度
    leaveT: 0,          // 退出之后过了多久（用来等她说完那句再弹卡）
    byeShown: false,
    veil: 0,            // 退场时压暗的遮罩，0..1
    themePicking: false,// 开画前正在选主题（§1.1）
    chalkPick: null,    // 正在选粉笔 { a, b }（§1.4）
    pull: 0,            // 椅子段镜头推上去的进度 0..1（§1.2）
    lastEval: null      // 最近一次结算写的评价（§1.5）
  };

  // 椅子描顶边（§1.2）的状态。phase: off | intro | play | lines | shot
  // off 时还在等触发条件；done 表示这块板这一遍已经发生过，不再触发。
  const chair = {
    phase: "off",
    t: 0,
    pending: 0,      // 触发条件满足后等了多久
    done: false,
    progress: 0,     // 顶边描画进度 0..1
    drawnK: 0,       // 已经落进图层的进度（避免重复画同一段）
    pos: 0.5,        // 晃动指针位置 0..1
    vel: 0,
    paused: 0,       // 指针出界的累计时间（只停笔，不算失败）
    sway: 0,
    rnd: makeRnd(CHAIR.seed),
    driftA: 0,
    driftB: 0,
    driftT: 0,
    settleAt: 0
  };

  // 椅子段的镜头把 board.render 的同一块板推近（直接带变换画在主画布上），
  // 前景再画椅子和她的背影；不另建离屏画布，也不新画 CG。
  const friendCameo = { phase: "off", x: -35, t: 0, after: null };
  function startFriendCameo(after) {
    friendCameo.phase = "enter";
    friendCameo.x = -35;
    friendCameo.t = 0;
    friendCameo.after = after;
  }

  const girl = global.ACT2.Girl.create(board, {
    say: herSay,
    onAssist(kind) {
      emit("board:assist", { kind });
    },
    onChalk(pair) {
      // 递粉笔二选一（§1.4）：把两支色摆到对白区里，玩家挑一支自用，
      // 她用另一支去补装饰区——颜色是两个人共同的。
      openChalkPick(pair);
    },
    onRelay(hit) {
      // 接力笔落地：端点已经亮了，等玩家起点落进来（§1.3）
      emit("board:relay", { phase: "open", ...hit });
    }
  });

  /** 给宿主（第二幕）听的事件。同页通信，不走 postMessage。 */
  function emit(name, detail) {
    global.dispatchEvent(new CustomEvent(name, { detail }));
  }

  // ---------------------------------------------------------------- 人物

  const FW = 48, FH = 72;
  // 降低后的走廊黑板约在 (294,81)–(474,170)。
  const BOARD_AT = { x: 384, y: 126 };

  const CH = {
    boy: { x: 215, y: 242, endX: 348, endY: 215, sheet: null, frames: 31 },
    girl: { x: 269, y: 242, endX: 420, endY: 215, sheet: null, frames: 33 }
  };

  function drawChar(who, t, alpha) {
    const c = CH[who];
    if (!c.sheet) return;
    const going = sc.state === "approach" || sc.state === "push";
    const k = going ? ease(sc.approach) : 0;
    const x = c.x + (c.endX - c.x) * k;
    const y = c.y + (c.endY - c.y) * k;
    const size = 1 + 0.18 * k;
    let f = !going ? Math.floor(t * 1.4) % 2
      : sc.state === "approach" && sc.t > 0.28 && sc.approach < 1
        ? 17 + Math.floor(sc.t * 8) % 4 : 4; // 背对镜头，朝黑板走
    if (sc.state === "class" && dlg?.who === (who === "girl" ? "朱里" : "和臣")) f = who === "girl" ? 26 : 24;
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.fillStyle = "rgba(0,0,0,.18)";
    ctx.beginPath();
    ctx.ellipse(x, y - 1, 13 * size, 4 * size, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(c.sheet, f * FW, 0, FW, FH, x - FW * size / 2, y - FH * size, FW * size, FH * size);
    ctx.restore();
  }

  // ---------------------------------------------------------------- 走廊

  function drawBackdrop(zoom, cx, cy, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-cx, -cy);
    if (img.corridor) ctx.drawImage(img.corridor, 0, 0);
    drawChar("boy", sc.t);
    drawChar("girl", sc.t + 0.6);
    if (sc.state === "class" && friendCameo.phase !== "off" && img.friend) {
      const p = friendCameo.phase;
      const frame = p === "enter" ? 12 + Math.floor(sc.t * 8) % 4
        : p === "leave" ? 16 + Math.floor(sc.t * 8) % 4
          : dlg?.who === "由乃" ? 28 : 0;
      ctx.drawImage(img.friend, frame * FW, 0, FW, FH,
        Math.round(friendCameo.x - FW / 2), 242 - FH, FW, FH);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- 循环

  let last = 0;
  let now = 0;

  function update(dt) {
    sc.t += dt;
    if (sc.state === "class" && friendCameo.phase === "enter") {
      friendCameo.t += dt;
      friendCameo.x = -35 + 155 * ease(friendCameo.t / 0.95);
      if (friendCameo.t >= 0.95) {
        friendCameo.phase = "talk";
        lines([
          ["旁白", "还没走到黑板前，走廊那头就有人叫了朱里一声。"],
          ["由乃", "朱里，原来你在这儿。"],
          ["朱里", "嗯，刚准备画。"],
          ["由乃", "难怪没在教室看见你。我先回去啦。"],
          ["朱里", "好，回头见。"],
          ["旁白", "她朝朱里挥挥手，经过我时也笑了一下。她们很熟，我那时还不太了解她。"]
        ], () => { friendCameo.phase = "leave"; friendCameo.t = 0; });
      }
    } else if (sc.state === "class" && friendCameo.phase === "leave") {
      friendCameo.t += dt;
      friendCameo.x = 120 - 155 * ease(friendCameo.t / 0.8);
      if (friendCameo.t >= 0.8) {
        friendCameo.phase = "off";
        const after = friendCameo.after;
        friendCameo.after = null;
        after?.();
      }
    }
    if (dlg) {
      dlg.t += dt;
      const target = Math.min(dlg.text.length, Math.floor(dlg.t * 30));
      if (target > dlg.shown) {
        dlg.shown = target;
        dlgLine.textContent = dlg.text.slice(0, dlg.shown);
      }
    }

    if (sc.state === "approach") {
      // 先回身，再沿走廊走到黑板前；走到位以后才推镜头。
      sc.approach = clamp((sc.t - 0.28) / 1.65, 0, 1);
      if (sc.t >= 1.93) { sc.state = "push"; sc.t = 0; }
    }

    if (sc.state === "push") {
      // 180 宽的黑板铺满 512 需要 2.84 倍，正好也把 92 高放到 262——几乎贴合，
      // 交叉淡入提前到 0.35s：那张背景是从生图稿缩下来的，放大太多会糊。
      sc.zoom = 1 + ease(sc.t / 1.2) * 1.84;
      sc.boardAlpha = clamp((sc.t - 0.35) / 0.6, 0, 1);
      if (sc.t >= 1.2) {
        sc.state = "board";
        sc.zoom = 2.84;
        sc.boardAlpha = 1;
        el("stage").classList.remove("cinematic");
        bar.classList.add("show");
        progEl.classList.add("show");
        leaveEl.classList.add("show");
        hint("照着淡线画，画完一块它自己就淡掉");
        emit("board:start", {});
        // 上次没画完的接着画（?fresh=1 可以跳过，截图和测试用）。
        // 旧存档没有 theme 字段时，board.restoreSave 内部已经按读书周兜底。
        if (/(\?|&)fresh=1/.test(location.search)) {
          openThemePick();
        } else {
          board.restoreSave().then((ok) => {
            if (!ok) { openThemePick(); return; }
            LINES.setTheme(board.theme());
            sc.themePicking = false;
            closePick();
            rebuildPatterns();
            repaintThumbs();
            syncUI();
            hint("接着上次画 · 主题 " + board.themeInfo().name);
            chatStart(["朱里", pick("open")]);
            emit("board:restore", { theme: board.theme() });
          });
        }
      }
    }

    if (sc.state === "board") {
      updateChair(dt);
      // 椅子段退回来之后镜头慢慢回位
      if (chair.phase === "off" && sc.pull > 0) sc.pull = Math.max(0, sc.pull - dt * 4);
      // 椅子事件（含等触发的那 0.9 秒）期间把她按住：否则她的常规补边框会先把
      // 顶边补掉，事件永远等不到「上边框 < 50%」这个触发条件。
      const chairBusy = chair.phase !== "off" || chair.pending > 0;
      // 粉笔二选一打开时也把她按住：否则玩家迟迟不选，她会先接一笔，
      // 选完那一刻那一笔被 takeChalk 打断（队列清空、历史多一条）。
      if (!chairBusy && !sc.chalkPick) girl.update(dt, { drawing: sc.drawing });
      chatStep(dt);
      if (board.allDone() && !sc.finished) markReady();
      else sc.readyMarked = false;
      if (sc.veil > 0) sc.veil = Math.max(0, sc.veil - dt * 3.2);
    }

    // 退场：先让她把最后一句说完，再把卡推出来
    if (sc.state === "leave") {
      sc.leaveT += dt;
      // 压到 0.8 就停：全黑会把板子整个吃掉，而这张卡想说的是
      // 「东西还在，你先走」，黑板得留一点在背后。
      sc.veil = Math.min(0.8, sc.veil + dt * 2.6);
      if (sc.leaveT > 1.15 && !sc.byeShown) {
        sc.byeShown = true;
        subsHide();
        byeEl.classList.add("show");
      }
    }

    if (sc.state === "done" && sc.walked < 1) {
      sc.walked = Math.min(1, sc.walked + dt / 1.1);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    if (sc.state === "class" || sc.state === "approach") {
      drawBackdrop(1, W / 2, H / 2, 1);
      return;
    }

    if (sc.state === "push") {
      drawBackdrop(sc.zoom, BOARD_AT.x, BOARD_AT.y, 1);
      if (sc.boardAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = sc.boardAlpha;
        board.render(ctx);
        ctx.restore();
      }
      return;
    }

    // board / done
    if (sc.state === "board" && sc.pull > 0.02) {
      drawChairCam();
    } else {
      board.render(ctx);
    }

    if (sc.state === "done") {
      // 两个人从两边走进来，站在板前——镜头在黑板高度，只看到他们的上半身
      const k = ease(sc.walked);
      const boyX = -40 + (176 + 40) * k;
      const girlX = W + 40 - (W + 40 - 344) * k;
      const gy = 306;
      ctx.save();
      ctx.globalAlpha = k;
      ctx.fillStyle = "rgba(0,0,0,.22)";
      ctx.fillRect(0, 236, W, H - 236);
      ctx.restore();
      drawAt("boy", boyX, gy, k);
      drawAt("girl", girlX, gy, k);
    }

    // 退场压暗。盖在画布上而不是用 CSS 透明度：画布是同一块 canvas，
    // 用 DOM 淡出会把底下的 #stage 背景透出来，颜色对不上。
    if (sc.veil > 0.002) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, sc.veil);
      ctx.fillStyle = "#0b0a0d";
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  function drawAt(who, x, y, alpha) {
    const c = CH[who];
    if (!c.sheet) return;
    // 第 4 帧是「背对镜头」。站在黑板前看成果的两个人，应该是背对我们的。
    const f = 4;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(c.sheet, f * FW, 0, FW, FH, Math.round(x - FW / 2), Math.round(y - FH), FW, FH);
    ctx.restore();
  }

  // ---------------------------------------------------------------- 椅子段镜头（§1.2）
  //
  // 不新画 CG：把 board.render 的同一块板推近到顶边，前景画一把椅子（矩形块）
  // 和她举着粉笔的背影；画完退开一点，两个人站在板前——复用现有构图。

  function drawChairCam() {
    const t = ease(clamp(sc.pull, 0, 1));
    ctx.fillStyle = "#161218";
    ctx.fillRect(0, 0, W, H);

    const span = CHAIR.span;
    const focusX = board.INNER.x + board.BW * (span[0] + (span[1] - span[0]) * chair.progress);
    const zoom = 1 + 0.62 * t;
    ctx.save();
    ctx.translate(W / 2, H * 0.40);
    ctx.scale(zoom, zoom);
    ctx.translate(-focusX, -20);
    board.render(ctx);
    ctx.restore();

    // 四周压暗，像镜头凑近了
    const vg = ctx.createRadialGradient(W / 2, H * 0.42, H * 0.18, W / 2, H * 0.42, H * 0.92);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(8,6,10,.74)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    drawChairFigure(t);
    // 描完了：两个人退开站在板前，看刚补好的顶边——这就是那张「复用镜头」
    if (chair.phase === "shot") {
      drawAt("boy", W * 0.30, H + 12, Math.min(1, t));
      drawAt("girl", W * 0.70, H + 12, Math.min(1, t));
    }
    drawChairMeter(t);
  }

  /** 椅子（矩形块拼的，不新增图片）+ 站在上面的朱里（背对镜头那一帧）。 */
  function drawChairFigure(t) {
    const sheet = CH.girl.sheet;
    const x = W * 0.66 + chair.sway * 30;
    const bottom = H + 6;
    const seatY = bottom - 54;
    ctx.save();
    ctx.globalAlpha = Math.min(1, t * 1.2);
    // 椅背：两根立柱 + 横档
    ctx.fillStyle = "#5a4034";
    ctx.fillRect(Math.round(x - 34), Math.round(seatY - 64), 5, 64);
    ctx.fillRect(Math.round(x + 30), Math.round(seatY - 64), 5, 64);
    ctx.fillStyle = "#7a5747";
    ctx.fillRect(Math.round(x - 34), Math.round(seatY - 64), 69, 5);
    ctx.fillRect(Math.round(x - 34), Math.round(seatY - 40), 69, 4);
    // 坐面
    ctx.fillStyle = "#6b4a3a";
    ctx.fillRect(Math.round(x - 36), Math.round(seatY - 4), 73, 6);
    // 站在椅子上的她（背对镜头：精灵第 4 帧）
    if (sheet) {
      const w = 48 * 0.95, h = 72 * 0.95;
      ctx.drawImage(sheet, 4 * 48, 0, 48, 72,
        Math.round(x - w / 2), Math.round(seatY - h), Math.round(w), Math.round(h));
    }
    // 手里的粉笔：一小截白点，举向画面上面那条顶边
    const inZone = chair.pos >= CHAIR.zone[0] && chair.pos <= CHAIR.zone[1];
    if (chair.phase === "play") {
      ctx.strokeStyle = inZone ? "rgba(244,236,221,.9)" : "rgba(224,138,122,.8)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 10, seatY - 54);
      ctx.lineTo(x + 15, seatY - 78);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 指针条：绿区 + 当前位置 + 描画进度。 */
  function drawChairMeter(t) {
    const w = 168, h = 8;
    const x = (W - w) / 2, y = H - 30;
    const inZone = chair.pos >= CHAIR.zone[0] && chair.pos <= CHAIR.zone[1];
    ctx.save();
    ctx.globalAlpha = Math.min(1, t * 1.4);
    ctx.fillStyle = "rgba(12,10,14,.82)";
    ctx.fillRect(x - 10, y - 27, w + 20, 50);
    ctx.fillStyle = "rgba(242,233,218,.18)";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "rgba(160,208,150,.6)";
    ctx.fillRect(x + w * CHAIR.zone[0], y, w * (CHAIR.zone[1] - CHAIR.zone[0]), h);
    if (chair.phase === "play" || chair.phase === "intro") {
      ctx.fillStyle = inZone ? "#ffe7cd" : "#e08a7a";
      ctx.beginPath();
      ctx.moveTo(x + w * chair.pos, y - 3);
      ctx.lineTo(x + w * chair.pos - 4, y - 10);
      ctx.lineTo(x + w * chair.pos + 4, y - 10);
      ctx.closePath();
      ctx.fill();
    }
    // 描画进度
    ctx.fillStyle = "#ffd9a0";
    ctx.fillRect(x, y + h + 4, w * chair.progress, 2);
    ctx.font = '10px "Microsoft YaHei","PingFang SC",sans-serif';
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(242,233,218,.8)";
    const msg = chair.phase === "play"
      ? (inZone ? "稳住，她在描了" : "偏了——她停笔等你")
      : chair.phase === "intro" ? "她把椅子挪到了板前"
        : chair.phase === "lines" ? "顶边补完了" : "站远一点看看";
    ctx.fillText(msg + (chair.phase === "play" ? "（A / D）" : ""), W / 2, y - 14);
    ctx.restore();
  }

  function loop(t) {
    now = t;
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 0;
    last = t;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function ease(t) {
    t = clamp(t, 0, 1);
    return 1 - Math.pow(1 - t, 3);
  }

  // ---------------------------------------------------------------- 界面

  const COLORS = board.COLORS;

  function buildUI() {
    const pal = el("palette");
    COLORS.forEach((c, i) => {
      const b = document.createElement("button");
      b.className = "sw" + (i === 0 ? " on" : "");
      b.style.background = c.hex;
      b.title = c.name + "（" + (i + 1) + "）";
      b.onclick = () => { board.setColor(i); repaintThumbs(); syncUI(); };
      pal.append(b);
    });

    const tools = el("tools");
    [["pen", "画笔", "B"], ["erase", "橡皮", "X"], ["line", "直线", "L"],
     ["rect", "方框", "R"], ["text", "文字", "T"], ["stamp", "图案", "S"]].forEach(([k, name, key]) => {
      const b = document.createElement("button");
      b.dataset.tool = k;
      b.innerHTML = `<span>${name}</span><i>${key}</i>`;
      b.onclick = () => { board.setTool(k); syncUI(); };
      tools.append(b);
    });

    // 底稿开关。淡线是朱里事先打的稿，想自己从头来的时候可以关掉。
    const gh = document.createElement("button");
    gh.id = "ghost";
    gh.className = "toggle";
    gh.innerHTML = "<span>底稿</span><i>G</i>";
    gh.title = "显示 / 隐藏预设草图（G）";
    gh.onclick = () => { board.setGhost(!board.state.ghost); syncUI(); };
    tools.append(gh);

    rebuildPatterns();

    const widths = el("widths");
    [1, 2, 3].forEach((w) => {
      const b = document.createElement("button");
      b.dataset.w = w;
      b.innerHTML = `<span style="width:${w * 3}px;height:${w * 3}px"></span>`;
      b.title = w + "px";
      b.onclick = () => { board.setWidth(w); syncUI(); };
      widths.append(b);
    });

    el("finish").onclick = finishBoard;
    el("look").onclick = () => cardEl.classList.add("min");
    el("out").onclick = quitToStory;
    el("nextBroadcastDone").onclick = enterBroadcast;
    leaveEl.onclick = leaveBoard;
    el("resume").onclick = resumeBoard;
    el("quit").onclick = quitToStory;
    el("nextBroadcast").onclick = enterBroadcast;
    el("again").onclick = () => {
      board.clearAll();
      board.lock(false);
      girl.reset();
      sc.state = "board";
      sc.finished = false;
      sc.walked = 0;
      sc.leaveT = 0;
      sc.byeShown = false;
      sc.veil = 0;
      sc.themePicking = false;
      sc.chalkPick = null;
      sc.pull = 0;
      sc.readyMarked = false;
      sc.lastEval = null;
      closePick();
      // 椅子事件这一遍已经用过了；再画一张是新的一张板，重新计
      chair.phase = "off";
      chair.t = 0;
      chair.pending = 0;
      chair.done = false;
      chair.progress = 0;
      chair.drawnK = 0;
      chair.pos = 0.5;
      chair.vel = 0;
      chair.paused = 0;
      LINES.setTheme(board.theme());
      cardEl.classList.remove("show", "min");
      byeEl.classList.remove("show");
      el("stage").classList.remove("fin", "over");
      bar.classList.add("show");
      progEl.classList.add("show");
      leaveEl.classList.add("show");
      chatStart(["朱里", "再来一张？稿子还在。"]);
      markReady(true);
      syncUI();
    };
    syncUI();
  }

  function syncUI() {
    document.querySelectorAll("#palette button").forEach((b, i) =>
      b.classList.toggle("on", i === board.state.colorIndex));
    document.querySelectorAll("#tools button[data-tool]").forEach((b) =>
      b.classList.toggle("on", b.dataset.tool === board.state.tool));
    const gh = document.getElementById("ghost");
    if (gh) gh.classList.toggle("on", !!board.state.ghost);
    document.querySelectorAll("#widths button").forEach((b) =>
      b.classList.toggle("on", +b.dataset.w === board.state.width));
    document.querySelectorAll("#pats button").forEach((b) =>
      b.classList.toggle("on", b.dataset.pid === board.state.pattern));
    el("stage").classList.toggle("pats", board.state.tool === "stamp");
    updateProgress();
  }

  // ---------------------------------------------------------------- 图案面板

  const PATS = global.ACT2.Patterns;

  /** 缩略图按当前粉笔色重画：图案本来就跟着笔色走，面板里也得是同一支笔。 */
  function paintThumb(cv) {
    const pat = PATS.BY_ID[cv.dataset.pid];
    if (!pat) return;
    const g = cv.getContext("2d");
    g.clearRect(0, 0, cv.width, cv.height);
    PATS.draw(g, pat, 0, 0, board.state.color, 1, { alpha: 0.96, grain: 0.05 });
  }

  function repaintThumbs() {
    document.querySelectorAll("#pats canvas").forEach(paintThumb);
  }

  /** 图案面板按主题的推荐序重排：推荐组在前，没推荐的图案放在后面。 */
  function rebuildPatterns() {
    if (!PATS) return;
    const box = el("pats");
    box.innerHTML = "";
    let cat = null;
    const list = board.themePatterns ? board.themePatterns() : PATS.PATTERNS;
    list.forEach((p) => {
      if (p.cat !== cat) {
        cat = p.cat;
        if (box.children.length) {
          const sep = document.createElement("i");
          box.append(sep);
        }
        const lab = document.createElement("em");
        lab.textContent = cat;
        box.append(lab);
      }
      const cv = document.createElement("canvas");
      cv.width = p.size;
      cv.height = p.size;
      cv.dataset.pid = p.id;
      paintThumb(cv);
      const b = document.createElement("button");
      b.dataset.pid = p.id;
      b.title = p.name + "（放好后可以拖动、方向键微调）";
      b.append(cv);
      b.onclick = () => { board.setPattern(p.id); syncUI(); };
      box.append(b);
    });
  }

  const CHIPS = { title: "标题", frame: "边框", main: "主图", deco: "装饰" };
  let lastSig = "";

  function updateProgress() {
    const r = board.regions();
    const box = el("prog");
    for (const k in CHIPS) {
      const chip = box.querySelector(`[data-k="${k}"]`);
      if (!chip) continue;
      const v = r[k];
      chip.classList.toggle("done", v.done);
      chip.classList.toggle("near", !v.done && nearEnough(k, v));
    }
    const ok = board.allDone();
    el("finish").classList.toggle("ready", ok);
    el("finish").disabled = !ok;
    if (ok) hint("四个区都齐了，可以完成");
    else hint(whatsMissing(r));

    const sig = Object.keys(CHIPS).map((k) => (r[k].done ? 1 : 0)).join("");
    if (sig !== lastSig) {
      lastSig = sig;
      emit("board:region", r);
    }
  }

  function nearEnough(k, v) {
    if (k === "frame") return Object.values(v.edges).some((e) => e >= board.NEED.edge * 0.6);
    if (k === "deco") return v.stamps >= 1;
    if (k === "title") return v.cover >= board.NEED.titleCover * 0.6;
    return v.cover >= board.NEED.mainCover * 0.6;
  }

  function whatsMissing(r) {
    if (!r.frame.done) {
      const bad = Object.entries(r.frame.edges)
        .filter(([, v]) => v < board.NEED.edge)
        .map(([k]) => ({ top: "上", bottom: "下", left: "左", right: "右" }[k]));
      return "边框还差：" + bad.join("、") + "（她会补）";
    }
    if (!r.title.done) return r.chars < board.NEED.titleChars ? "用文字工具在标题区写几个字" : "标题区再多写一点";
    if (!r.main.done) return "中间画点什么，大一点";
    if (!r.deco.done) return `放图案（${r.deco.stamps}/3）· 点一下放，按住能拖`;
    return "";
  }

  function hint(text) {
    if (!text) return;
    if (hintEl.textContent === text) return;
    hintEl.textContent = text;
  }

  function markReady(quiet) {
    if (!board.allDone()) return;
    if (sc.readyMarked) return;   // 每帧都会进来一次，别把「画好了」刷成一串
    sc.readyMarked = true;
    if (!quiet) {
      setTimeout(() => herSay(pick("done")), 400);
    }
  }

  // ---------------------------------------------------------------- 完成

  function finishBoard() {
    if (sc.state !== "board") return;
    // 二选一还开着就按完成：先把选择收掉，别让它留到结算镜头里
    if (sc.chalkPick) { sc.chalkPick = null; closePick(); chat.paused = false; }
    if (chair.phase !== "off") return;   // 椅子段镜头里不接完成，等它退回来
    if (!board.allDone()) {
      herSay("先把四个区都填上吧。");
      return;
    }
    const png = board.toPNG(3);   // 下载给 3 倍：1344×720，贴在别处也不糊
    // §1.5 结算评价：先聚合，再让她在 DONE_EVAL 里挑 2–3 句说。
    // 同一份文本同时落进新存档键，第四幕/广播桥不用 import 本文件也能引用。
    const stats = board.stats();
    const theme = board.themeInfo();
    const evals = LINES.pickEvals(stats, theme.id);
    const evalPayload = {
      theme: theme.id,
      themeName: theme.name,
      evalIds: evals.map((e) => e.id),
      evals: evals.map((e) => ({ id: e.id, text: e.text }))
    };
    try { localStorage.setItem(EVAL_KEY, JSON.stringify(evalPayload)); } catch (e) { /* 存不下就算了 */ }
    sc.lastEval = evalPayload;

    board.save();
    board.lock(true);
    sc.finished = true;
    sc.state = "done";
    sc.walked = 0;
    bar.classList.remove("show");
    el("stage").classList.remove("pats");
    el("stage").classList.add("fin");
    progEl.classList.remove("show");
    dlgEl.classList.remove("show");
    leaveEl.classList.remove("show");
    closePick();
    chat.paused = false;
    chatStop();

    const a = el("download");
    a.href = png;
    a.download = "黑板报.png";

    const themeDone = (THEMES[theme.id] && THEMES[theme.id].done) ||
      "站远一点看看，好像比刚才想的还好看。";
    setTimeout(() => {
      // 结尾这几句走画布下面那条对白区，不弹 #dlg：
      // 板子刚画完，玩家正想看看自己画了什么，中间压一个对话框等于把作品盖住。
      // 评价句插在中间：先主题那句，再 2–3 句指向这幅画的具体特征。
      talkLines([
        ["我", "……画完了。"],
        ["朱里", themeDone],
        ...evals.map((e) => ["朱里", e.text]),
        ["我", "边上的线，是你补的。"],
        ["朱里", "嗯。我们一起画的。"],
        ["我", "下次也一起吧。"]
      ], () => {
        // 对白读完了，两个小人退场、这条让出高度，卡再出来——
        // 两样东西同时盖在画上，谁都看不清
        el("stage").classList.add("over");
        setTimeout(() => {
          cardEl.classList.remove("min");
          cardEl.classList.add("show");
        }, 340);
      });
    }, 1200);

    emit("board:finish", { png, regions: board.regions(), stats, theme: theme.id, evalIds: evalPayload.evalIds });
  }

  // ---------------------------------------------------------------- 随时离开

  /**
   * 随时可以走。
   *
   * 手上这一笔先收掉、存一次盘、她说一句，然后把画面压暗、推出一张收尾卡。
   * 卡上只有两个出口：接着画 / 离开。**不判断画完没画完**——玩家想走就走，
   * 存档已经落了，下次进来 restoreSave 接着这张。
   */
  function leaveBoard() {
    if (sc.state !== "board") return;
    if (activeId != null) { activeId = null; sc.drawing = false; board.up(); }
    // 椅子上/选择中的状态先收干净再存档：半截的镜头和没选完的题不该写进档
    if (sc.themePicking) { sc.themePicking = false; LINES.setTheme(board.theme()); }
    closePick();
    sc.chalkPick = null;
    chat.paused = false;
    chair.phase = "off";
    chair.pending = 0;
    sc.pull = 0;
    board.lock(false);
    girl.cancel();
    board.save();
    chatStop();
    const line = pick("leave");
    subsShow("朱里", line, 1.6);
    byeLineEl.textContent = "「" + line + "」";
    sc.state = "leave";
    sc.leaveT = 0;
    sc.byeShown = false;
    bar.classList.remove("show");
    progEl.classList.remove("show");
    leaveEl.classList.remove("show");
    el("stage").classList.remove("pats");
    emit("board:leave", { regions: board.regions() });
  }

  function resumeBoard() {
    if (sc.state !== "leave") return;
    sc.state = "board";
    sc.leaveT = 0;
    sc.byeShown = false;
    byeEl.classList.remove("show");
    bar.classList.add("show");
    progEl.classList.add("show");
    leaveEl.classList.add("show");
    subsHide();
    chatStart(["朱里", pick("back")]);
    syncUI();
  }

  function quitToStory() {
    emit("board:quit", { regions: board.regions() });
    const target = new URL(BACK, location.href);
    target.searchParams.set("from", "blackboard");
    target.searchParams.set("board", sc.finished ? "done" : "paused");
    location.href = target.href;
  }

  function enterBroadcast() {
    // 独立过场模块只接收作品预览和完成状态，不依赖学校预览页。
    board.save();
    try { localStorage.setItem("our-story-act2-board-preview-v1", board.toPNG(1)); } catch (e) { /* 预览可退回存档 PNG */ }
    const target = new URL("broadcast-bridge/index.html", location.href);
    target.searchParams.set("board", sc.finished ? "done" : "deferred");
    location.href = target.href;
  }

  // ---------------------------------------------------------------- 输入

  let activeId = null;
  const chairKeys = { a: false, d: false };

  function toBoard(e) {
    const r = canvas.getBoundingClientRect();
    const lx = (e.clientX - r.left) / r.width * W;
    const ly = (e.clientY - r.top) / r.height * H;
    return { x: lx - board.INNER.x, y: ly - board.INNER.y, lx, ly };
  }

  function openText(lx, ly) {
    const r = canvas.getBoundingClientRect();
    const k = r.width / W;
    textIn.style.display = "block";
    textIn.style.left = lx * k + "px";
    textIn.style.top = ly * k + "px";
    textIn.style.fontSize = Math.max(13, 16 * k) + "px";
    textIn.value = "";
    textIn.dataset.lx = lx;
    textIn.dataset.ly = ly;
    // 等这一下点击自己走完再聚焦：在 pointerdown 里 focus()，随后的默认焦点处理
    // 会把焦点丢回 body，输入框刚出现就被自己的 blur 收掉。
    setTimeout(() => textIn.focus(), 0);
  }

  function closeText(commit) {
    if (textIn.style.display !== "block") return;
    const lx = +textIn.dataset.lx, ly = +textIn.dataset.ly;
    const v = textIn.value.trim();
    textIn.style.display = "none";
    textIn.blur();
    if (commit && v) {
      const inTitle = ly >= board.INNER.y && ly <= board.INNER.y + board.REGION.title.h;
      board.commitText(v, lx - board.INNER.x, ly - board.INNER.y, inTitle ? 18 : 14);
      syncUI();
    }
  }

  textIn.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { closeText(true); }
    else if (e.key === "Escape") { closeText(false); }
  });
  textIn.addEventListener("blur", () => closeText(true));

  canvas.addEventListener("pointerdown", (e) => {
    if (sc.state !== "board") {
      if (advanceTalk()) return;
      if (sc.state === "class" || sc.state === "done") advance();
      return;
    }
    const p = toBoard(e);
    // 还没选主题就先动笔：按默认（读书周）开始，别把玩家晾在选择题前面。
    // 想换主题的仍然可以点对白区里的三个按钮（那是 DOM，不走画布）。
    if (sc.themePicking) pickTheme(board.themeInfo().id);
    if (board.state.locked) return;
    if (board.state.tool === "text") { openText(p.lx, p.ly); return; }
    activeId = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    sc.drawing = true;
    // 接力描线要的是「笔画起点」，所以只把画线类工具的起点交给她；
    // 图案/文字/橡皮不算接笔。
    const tool = board.state.tool;
    const point = (tool === "pen" || tool === "line" || tool === "rect") ? { x: p.x, y: p.y } : null;
    girl.noteStroke(board.state.colorIndex, point);
    board.down(p.x, p.y);
  });

  canvas.addEventListener("pointermove", (e) => {
    const p = toBoard(e);
    if (activeId !== e.pointerId) {
      // 没在画：图案工具给个淡淡的预览，先看清会落在哪
      if (sc.state === "board") board.hover(p.x, p.y);
      return;
    }
    board.move(p.x, p.y);
  });

  canvas.addEventListener("pointerleave", () => board.hover(-1, -1));

  function endStroke(e) {
    if (activeId !== e.pointerId) return;
    activeId = null;
    sc.drawing = false;
    board.up();
    syncUI();
  }
  canvas.addEventListener("pointerup", endStroke);
  canvas.addEventListener("pointercancel", endStroke);

  window.addEventListener("keydown", (e) => {
    if (e.target === textIn) return;

    if (e.key === "Enter" || e.key === " " || e.key === "e" || e.key === "E") {
      if (dlg) { e.preventDefault(); advance(); return; }
      // 结尾那几句走对白区，同样按 E / 空格推进
      if (advanceTalk()) { e.preventDefault(); return; }
    }
    if (sc.state !== "board") return;

    const k = e.key.toLowerCase();
    // 随时能走。放在最前面，和工具键不打架（Esc 本来没绑东西）
    if (e.key === "Escape") { e.preventDefault(); leaveBoard(); return; }
    if ((e.ctrlKey || e.metaKey) && k === "z") {
      e.preventDefault();
      (e.shiftKey ? board.redo() : board.undo()).then(syncUI);
      return;
    }
    // 椅子段（§1.2）：A / D 压指针；镜头里切工具没有意义，一律不响应
    if (chair.phase === "play") {
      if (k === "a" || k === "d") {
        e.preventDefault();
        chairKeys[k] = true;
      }
      return;
    }
    if (chair.phase !== "off") return;
    // 选择题期间数字键就是选项键（主题 1–3 / 粉笔 1–2）
    if (sc.themePicking && (k === "1" || k === "2" || k === "3")) {
      e.preventDefault();
      pickTheme(THEME_ORDER[+k - 1]);
      return;
    }
    if (sc.chalkPick && (k === "1" || k === "2")) {
      e.preventDefault();
      const pair = sc.chalkPick;
      chooseChalk(k === "1" ? pair.a : pair.b);
      return;
    }
    // 还没选主题就按了别的键：先按默认主题开始，别让工具键失灵
    if (sc.themePicking) pickTheme(board.themeInfo().id);
    if (k === "b") board.setTool("pen");
    else if (k === "x") board.setTool("erase");
    else if (k === "l") board.setTool("line");
    else if (k === "r") board.setTool("rect");
    else if (k === "t") board.setTool("text");
    else if (k === "s") board.setTool("stamp");
    else if (k === "g") board.setGhost(!board.state.ghost);
    else if (k >= "1" && k <= "6") { board.setColor(+k - 1); repaintThumbs(); }
    else if (k === "enter" && board.allDone()) finishBoard();
    else if (e.key.indexOf("Arrow") === 0) {
      // 选中的图案：方向键微调，按住 Shift 走 4 像素
      const step = e.shiftKey ? 4 : 1;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      if ((dx || dy) && board.state.sel != null) {
        e.preventDefault();
        board.nudgeSelected(dx, dy);
      }
    } else if ((k === "delete" || k === "backspace") && board.state.sel != null) {
      e.preventDefault();
      board.removeSelected();
    }
    syncUI();
  });

  window.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    if (k === "a" || k === "d") chairKeys[k] = false;
  });
  window.addEventListener("blur", () => { chairKeys.a = false; chairKeys.d = false; });

  board.on("region", () => updateProgress());
  board.on("change", () => { if (sc.state === "board") updateProgress(); });
  board.on("undo", () => girl.cancel());

  // 橡皮第一次用的时候她吭一声
  let eraseNoted = false;
  canvas.addEventListener("pointerdown", () => {
    if (sc.state === "board" && board.state.tool === "erase" && !eraseNoted) {
      eraseNoted = true;
      setTimeout(() => girl.noteErase(), 300);
    }
  });

  // ---------------------------------------------------------------- 启动

  function loadAll() {
    const keys = Object.keys(IMG);
    let left = keys.length;
    return new Promise((res) => {
      keys.forEach((k) => {
        const im = new Image();
        im.onload = () => {
          img[k] = im;
          if (k === "boy" || k === "girl") CH[k].sheet = im;
          if (--left === 0) res();
        };
        im.onerror = () => { if (--left === 0) res(); };
        im.src = IMG[k];
      });
    });
  }

  loadAll().then(() => {
    buildUI();
    el("loading").classList.remove("show");

    // 前一天在护栏边约好，第二天来到走廊宣传栏旁。
    lines([
      ["旁白", "第二天的课间，我们来到走廊宣传栏旁。昨天约好的那块黑板，还空着。"],
      ["朱里", "你真来了。我还担心你把昨天说的话忘了。"],
      ["和臣", "答应了你，当然要来。"]
    ], () => startFriendCameo(() => lines([
      ["朱里", "我在板上轻轻勾了几笔。你画中间，我来补旁边，好吗？"],
      ["和臣", "好，一起画吧。"]
    ], () => { sc.state = "approach"; sc.t = 0; })));

    requestAnimationFrame(loop);
  });

  // 调试口：测试脚本用
  global.__board = {
    board, girl, scene: sc, friendCameo, chair, CHAIR,
    chat,   // 字幕轮播的状态，自检要看「是不是一直在滚」
    finish: finishBoard,
    leave: leaveBoard,
    resume: resumeBoard,
    // §1.1 / §1.4 / §1.5 的测试入口
    pickTheme,
    chooseChalk,
    themeInfo: () => board.themeInfo(),
    stats: () => board.stats(),
    eval: () => sc.lastEval,
    state: () => ({
      state: sc.state,
      zoom: +sc.zoom.toFixed(2),
      drawing: sc.drawing,
      veil: +sc.veil.toFixed(2),
      assists: girl.assists,
      girlState: girl.state,
      regions: board.regions(),
      allDone: board.allDone(),
      locked: board.state.locked,
      theme: board.theme(),
      themeName: board.themeInfo().name,
      themePicking: sc.themePicking,
      chalkPick: sc.chalkPick ? { ...sc.chalkPick } : null,
      chair: {
        phase: chair.phase,
        pending: +chair.pending.toFixed(2),
        done: chair.done,
        progress: +chair.progress.toFixed(3),
        pos: +chair.pos.toFixed(3),
        paused: +chair.paused.toFixed(2),
        inZone: chair.pos >= CHAIR.zone[0] && chair.pos <= CHAIR.zone[1]
      },
      stats: board.stats()
    })
  };
})(window);

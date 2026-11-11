/* G04《体育活动》— 俯视 2.5D 球场，1 对 2，先进三个球
 *
 * 这一版把原来的一维横版换成了有纵深的俯视球场：
 *   场地画成梯形，越远越窄；人物和球按纵深缩放，W / S 就是纵深方向。
 *   玩家守下面（近）的球门、打上面（远）的球门；由乃和朱里反过来。
 *
 * 操作：
 *   无球：WASD 跑位，靠近持球的人按 E 抢断。
 *   有球：WASD 带球；按住空格蓄力，蓄力时 A / D 转射门角度、W / S 调射门高度，
 *         松手出脚。W 往死角挑，S 贴地打；挑太高会越过横梁。
 *   玩家的跑速 96，是由乃的 70 / 朱里的 58 里最快的。
 *
 * 射门是有高度的：球飞过防守人时，只要离地够高就不会被挡下来，
 * 但到了门线上要是高过横梁，就是一脚高射炮。
 *
 * 电脑抢断不是贴上来就立刻得手：她得先伸手（0.32 秒的短预警），
 * 这期间玩家跑开或者把球踢出去，就抢不到。断球后也有一段冷却，
 * 开球时两个人不会贴脸站着——给玩家留出带球的那一步。
 *
 * 由乃会过人：带球时每隔一阵做一个假动作（脚下亮一下、头上一颗菱形），
 * 窗口里按 E 会被她晃过去（stumble 0.6 秒动不了）；窗口外按 E 才断得下来。
 * 她赢到两球之后开始给朱里做球——不是放水，是她自己换了打法。
 * 朱里跑得慢、给球会偏、偶尔一脚踢空；她的作用是让场面不像一对一。
 *
 * 比分只在这一场里存在：不写存档、不进结果卡、不改任何关系走向。
 * 收尾时赢的那句不庆祝，输的那句不检讨。
 *
 * 对白只在开头和结尾用完整对白框；比赛里有事只用头顶短气泡。
 */
(function (global) {
  "use strict";

  const D = global.DAILY;
  D.games = D.games || {};

  const W = D.W, H = D.H;
  const TAU = Math.PI * 2;

  const CFG = {
    goalsToWin: 3,
    playerSpeed: 96,
    yunoSpeed: 70,
    jurieSpeed: 58,          // 玩家跑速的 0.6 倍

    // 俯视梯形的四个参数：d = 0 是近端（下），d = 1 是远端（上）
    cx: 256,
    nearY: 228,
    farY: 96,
    nearW: 452,
    farW: 292,
    xMin: 0.04, xMax: 0.96,
    dMin: 0.03, dMax: 0.97,

    // 球门：门柱在 x 0.355 ~ 0.645 之间，横梁高度 0.62
    goalX: [0.355, 0.645],
    goalHeight: 0.62,
    blockHeight: 0.38,
    blockX: 0.055,

    tackleRange: 30,
    tackleCd: 0.42,
    pickup: 16,

    chargeTime: 0.9,
    shotMin: 0.16,
    aimMinX: 0.22, aimMaxX: 0.78,
    aimRateA: 1.05,          // 蓄力时 A/D 每秒转多少弧度
    aimRateZ: 0.42,
    aimZ0: 0.16,

    // 电脑抢断：先靠近、再伸手；伸手这 0.32 秒里跑开或踢出去就能躲掉
    aiStealRange: 20,
    aiStealWindup: 0.32,

    feintWindow: 0.35,
    feintMin: 1.2,
    feintMax: 2.0,
    stumble: 0.6,
    aiStun: 0.5,
    goalPause: 1.5,

    // ---- §6.1 防守分工 ----------------------------------------------------
    roleHysteresis: 0.5,     // 换岗迟滞：连续 0.5 秒都该换才换
    pressLead: 0.35,         // 上抢目标 = 玩家位置 + 速度 × 0.35s
    pressLeadAhead: 0.45,    // §6.6 玩家领先两球时，提前量加大
    coverDepth: 0.10,        // 守线点：距远门线 0.10 纵深

    // ---- §6.2 朱里守门 ----------------------------------------------------
    keeperTriggerD: 0.62,    // 玩家持球越过这条纵深 → cover 进守门态
    keeperLine: 0.04,        // 站门线前 0.04
    keeperLag: 0.12,         // 跟 aimX 的 120ms 反应延迟
    keeperErr: 0.03,         // ±0.03 固定预判误差（整局不抖）
    keeperErrLead: 0.02,     // §6.6 玩家领先两球时误差收小
    keeperReach: 0.11,       // 横扑扑程（横向场地比）
    keeperLowZ: 0.50,        // 低球才扑得到，高过这条线就从她头上过去
    keeperBiasTrail: 0.04,   // §6.6 玩家落后两球时朱里偏一侧，露出远角

    // ---- §6.3 触球系统 ----------------------------------------------------
    dribbleSpeed: 0.78,      // 带球速度系数（无球仍 1.0）
    touchOffset: 0.05,       // 球的目标点在持球人朝向 0.05 纵深前
    touchFollow: 14,         // 跟随速率：每秒收敛 14 倍，速度越快滞后越大
    turnWindow: 0.20,        // 急转判定窗口
    turnLimit: 100 * Math.PI / 180,   // 0.2 秒内转向超过 100°
    turnSlip: 0.02,          // 急转时球向外侧多滑 0.02
    dashDepth: 0.16,         // Shift 拨球拨出 0.16 纵深
    dashTime: 0.45,          // 拨球后 0.45 秒加速
    dashMul: 1.15,           // 拨球后的加速倍率
    dashCd: 2.5,             // 拨球冷却
    stealRangeLoose: 26,     // 球离脚 > 0.035 时，电脑抢断距离放宽到 26

    // ---- §6.4 开球修正 ----------------------------------------------------
    kickoffProtect: 0.6,     // 开球保护只防贴脸
    stealProtectYuno: 2.2,   // 抢断得手后的喘息（只对 steal）
    stealProtectJurie: 2.4,

    // ---- §6.5 射门三把锁 --------------------------------------------------
    spreadBase: 0.010,       // σ = base + power²×powerW + 距离×distW + 压迫
    spreadPower: 0.055,
    spreadDistW: 0.020,
    spreadPressure: 0.020,
    pressureRange: 26,       // 身前扇区里的防守人 < 26px 算压迫
    pressureChargeMul: 0.7,  // 被压迫时蓄力速度 ×0.7
    weakPower: 0.25,         // 被压迫且力度 < 0.25 必踢呲
    postTol: 0.008,          // 中柱判定半宽
    saveLunge: 0.12          // 横扑动作时长（秒）
  };

  const NAME = { me: "我", yuno: "由乃", jurie: "朱里" };

  // 球在屏幕上的抬高：z = 1 时大约抬一个半人高，0.62 正好到横梁
  const LIFT = 71;
  // 横梁在屏幕上的高度（近端约 51px，远端约 32px）
  const GOAL_H = 44;

  function widthAt(d) { return CFG.nearW + (CFG.farW - CFG.nearW) * d; }
  function sxAt(x, d) { return CFG.cx + (x - 0.5) * widthAt(d); }
  function syAt(d) { return CFG.nearY + (CFG.farY - CFG.nearY) * d; }
  function scaleAt(d) { return 0.72 + 0.43 * (1 - d); }
  function liftAt(z, d) { return z * LIFT * scaleAt(d); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function distPx(x1, y1, x2, y2) { return Math.hypot(x1 - x2, y1 - y2); }

  function makeActors() {
    return {
      me: {
        key: "boy", x: 0.50, d: 0.28, face: "up", dir: "up",
        moving: false, phase: 0, scale: 1, sx: 0, sy: 0, alpha: 1
      },
      yuno: {
        key: "friend", x: 0.46, d: 0.56, face: "down", dir: "down",
        moving: false, phase: 0.7, scale: 1, sx: 0, sy: 0, alpha: 1
      },
      jurie: {
        key: "girl", x: 0.62, d: 0.66, face: "down", dir: "down",
        moving: false, phase: 0.3, scale: 1, sx: 0, sy: 0, alpha: 1
      }
    };
  }

  // 自己写的伪随机：整局可复现，自检才不会时灵时不灵
  function makeRnd(seed) {
    let s = seed >>> 0;
    return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }

  // 触控按钮按住时当作空格。模块级一份就够——同一时刻只可能有一个球赛在跑。
  let touchHeld = false;
  window.addEventListener("pointerup", function () { touchHeld = false; });
  window.addEventListener("pointercancel", function () { touchHeld = false; });

  D.games.ball = function (host) {
    const A = makeActors();
    let rnd = makeRnd(20261108);
    // §6.2 守门的预判误差方向：整局固定，不逐帧抖（自检会按种子重掷）
    let keeperErrDir = rnd() * 2 - 1;

    const el = {
      hud: document.getElementById("bgHud"),
      board: document.getElementById("bgBoard"),
      tip: document.getElementById("bgTip"),
      ctl: document.getElementById("bgCtl"),
      act: document.getElementById("bgAct")
    };

    let state = "intro";        // intro | play | goalPause | rest | done
    let frozen = false;
    let clock = 0;
    let scoreMe = 0, scoreThem = 0;
    let goalPause = 0, goalFxT = 0, goalSide = null;

    // 球的坐标用场地坐标：x 横向 0~1，d 纵深 0（近）~1（远），z 离地高度
    const ball = {
      x: 0.5, d: 0.56, z: 0.05, sx: 0, sy: 0,
      owner: "yuno", mode: "held", vx: 0, vd: 0, vz: 0, spin: 0, lock: 0
    };
    let shot = null;            // 飞行中的射门
    let pass = null;            // 飞行中的做球
    let windup = null;          // NPC 起脚前的停顿
    let feintT = 0, feintTimer = 0, yunoFeinted = false;
    let stumbleT = 0;
    // 抢断圈：靠近持球人按 E 后，双方停一拍，看谁先露空档。
    // 由乃/朱里会护住上或下的一边（圈的上半/下半亮红），玩家按 W / S 打另一边。
    let duel = null;
    let yunoStun = 0, jurieStun = 0;
    let tackleCd = 0, yunoTackleCd = 0, jurieTackleCd = 0;
    let yunoHold = 0, yunoPassCd = 0;
    let jurieActionCd = 0;

    let charging = false, armed = true, chargeT = 0, power = 0.3;
    // 射门角度：0 是屏幕正上方（正对门线），正数往右；落点 aimX 由它算出来。
    let aimAng = 0, aimX = 0.5, aimZ = CFG.aimZ0;
    // 电脑的抢断抬手：{ who, t }。t 走到 aiStealWindup 才真的断下来。
    let aiSteal = null;
    let trail = [];
    let bubbles = [];
    let calls = 0;
    let stats = {
      tackles: 0, stumbles: 0, steals: 0, shots: 0,
      goalsFor: 0, goalsAgainst: 0, passes: 0,
      feints: 0, airKicks: 0, saves: 0, duelFails: 0, turnSlips: 0, aiWindups: 0
    };
    let tipText = "";
    let actText = "";
    let boardKey = "";
    let hudPulse = 0;

    // ---- §6 新增状态 ------------------------------------------------------
    // 防守分工：近者上抢、远者守线；0.5 秒迟滞，防止两个人原地反复换岗。
    let roles = { press: "yuno", cover: "jurie", want: "yuno", timer: 0 };
    let keeperOn = false;        // §6.2 cover 是否进入守门态
    let keeperLunge = null;      // 射门瞬间的横扑 { who, fromX, toX, t }
    let keeperAimLog = [];       // aimX 的 120ms 延迟采样
    let meVel = { x: 0, d: 0 };  // 玩家速度向量（上抢提前量用）
    let ballOffFoot = 0;         // 球离持球人脚多远（世界单位）
    let lastShot = null;         // 最近一脚射门的落点与结果（自检用）
    let lastGoalSide = null;
    let dashT = 0, dashCd = 0, shiftLatch = false;   // §6.3 Shift 拨球
    let turnLog = [];            // 持球人近 0.2 秒的移动方向，用来判急转
    let holderLast = { who: null, x: 0, d: 0 };
    let slipCd = 0;

    // ---- 自检入口用的开关（正常游玩不走这条路） ---------------------------
    // simMode 打开后：update() 不再读 DOM / 对白 / 声音，键盘输入改由 simKeys 提供。
    // shell 正常游玩仍然走 rAF → update()/draw()，路径一个字没变。
    let simMode = false;
    let simKeys = null;
    let spreadScale = 1;         // §6.5 σ=0 自检开关

    // ---- 主动互动 ----------------------------------------------------------
    // F = 喊一声。不改球权、不改跑位，只是让场面里有人接话。
    function callOut() {
      if (state !== "play" || frozen || D.dialogOpen()) return;
      calls++;
      sfx("blip");
      if (ball.owner === "me") {
        D.react("我", "看好了。", 900);
        D.react("由乃", "看着呢。", 1400);
      } else if (ball.owner) {
        const who = ball.owner === "yuno" ? "由乃" : "朱里";
        D.react("我", "这边——", 900);
        D.react(who, ball.owner === "yuno" ? "你自己来拿。" : "……哪边？", 1500);
      } else {
        D.react("我", "球给我。", 900);
        D.react("由乃", "自己来抢。", 1400);
      }
    }

    function spaceHeld() {
      if (simMode) return !!(simKeys && simKeys.space);
      return !!D.keys[" "] || touchHeld;
    }

    // 键盘的两条轴。正常游玩仍走 D.axisX / D.axisY，手感不变；
    // 只有自检的固定步进才从 simKeys 里读。
    function inputX() {
      if (simMode) return simKeys ? (simKeys.right ? 1 : 0) - (simKeys.left ? 1 : 0) : 0;
      return D.axisX();
    }
    function inputY() {
      if (simMode) return simKeys ? (simKeys.up ? 1 : 0) - (simKeys.down ? 1 : 0) : 0;
      return D.axisY();
    }
    function shiftHeld() {
      if (simMode) return !!(simKeys && simKeys.shift);
      return !!D.keys["shift"];
    }

    // 音效走一层：自检的 headless 固定步进不该真的去开 Web Audio。
    function sfx(name) {
      if (!simMode) D.audio[name]();
    }

    // ---------------------------------------------------------------- 短气泡

    function bark(who, text, ms) {
      bubbles = bubbles.filter(function (b) { return b.who !== who; });
      bubbles.push({ who: who, text: text, t: 0, dur: (ms || 900) / 1000 });
    }

    function updateBubbles(dt) {
      for (const b of bubbles) b.t += dt;
      bubbles = bubbles.filter(function (b) { return b.t < b.dur; });
    }

    // ---------------------------------------------------------------- 坐标

    function refreshScreen() {
      for (const k of ["me", "yuno", "jurie"]) {
        const a = A[k];
        a.sx = sxAt(a.x, a.d);
        a.sy = syAt(a.d);
        a.scale = scaleAt(a.d);
      }
      syncBallScreen();
    }

    function syncBallScreen() {
      ball.sx = sxAt(ball.x, ball.d);
      ball.sy = syAt(ball.d);
    }

    function faceFromDelta(dx, dy) {
      if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "right" : "left";
      return dy > 0 ? "down" : "up";
    }

    // ---------------------------------------------------------------- 球权

    function syncBall() {
      if (!ball.owner) return;
      const a = A[ball.owner];
      if (!a) return;
      ball.x = a.x;
      ball.d = a.d;
      ball.z = 0.06;
      ball.vx = 0; ball.vd = 0; ball.vz = 0;
      syncBallScreen();
    }

    /** 球权交给谁。src 记来源，只有三种：steal（抢断）、kickoff（开球）、pass（做球 / 捡球）。
     *  §6.4：2.2 / 2.4 秒的喘息保护只对 steal 生效；开球只留 0.6 秒，够防贴脸就行。 */
    function giveBall(who, src) {
      const from = src || "pass";
      ball.owner = who;
      ball.mode = "held";
      ball.lock = 0;
      shot = null;
      pass = null;
      windup = null;
      aiSteal = null;
      feintT = 0;
      trail = [];
      charging = false;
      chargeT = 0;
      power = 0.3;
      keeperLunge = null;
      keeperAimLog = [];
      dashT = 0;
      ballOffFoot = 0;
      turnLog = [];
      slipCd = 0;
      const a = A[who];
      if (a) {
        a.face = who === "me" ? "up" : "down";
        a.dir = a.face;
        a.moving = false;
        holderLast = { who: who, x: a.x, d: a.d };
      }
      if (who === "me") {
        armed = !spaceHeld();
        // 刚断下球的一瞬间给一点喘息：不然电脑贴身贴着，蓄力还没抬脚就被反抢。
        // 开球是另一种情况——只防贴脸，不让玩家抱着保护一路带。
        if (from === "steal") {
          yunoTackleCd = Math.max(yunoTackleCd, CFG.stealProtectYuno);
          jurieTackleCd = Math.max(jurieTackleCd, CFG.stealProtectJurie);
        } else if (from === "kickoff") {
          yunoTackleCd = Math.max(yunoTackleCd, CFG.kickoffProtect);
          jurieTackleCd = Math.max(jurieTackleCd, CFG.kickoffProtect);
        }
      }
      if (who === "yuno") {
        feintTimer = CFG.feintMin + rnd() * (CFG.feintMax - CFG.feintMin);
        yunoFeinted = false;
        yunoHold = 0;
        yunoPassCd = 1.8;
      }
      syncBall();
    }

    function place(who, x, d, face) {
      const a = A[who];
      a.x = D.clamp(x, CFG.xMin, CFG.xMax);
      a.d = D.clamp(d, CFG.dMin, CFG.dMax);
      a.face = face || "down";
      a.dir = a.face;
      a.moving = false;
      a.sx = sxAt(a.x, a.d);
      a.sy = syAt(a.d);
      a.scale = scaleAt(a.d);
    }

    function kickoff(who) {
      shot = null;
      pass = null;
      windup = null;
      aiSteal = null;
      duel = null;
      feintT = 0;
      stumbleT = 0;
      yunoStun = 0;
      jurieStun = 0;
      tackleCd = 0;
      yunoTackleCd = 0.7;
      jurieTackleCd = 0.9;
      yunoHold = 0;
      yunoPassCd = 2.0;
      jurieActionCd = 0;
      charging = false;
      chargeT = 0;
      power = 0.3;
      aimX = 0.5;
      aimAng = 0;
      trail = [];
      // §6.4 开球阵型改成有纵深的三个点：中路不再是一条空道。
      // 玩家开球：由乃在上抢位、朱里在守线位；对面开球时站位一样，由乃站在球后面。
      place("me", 0.50, 0.30, "up");
      if (who === "me") {
        place("yuno", 0.56, 0.55, "down");
        place("jurie", 0.44, 0.80, "down");
      } else {
        place("yuno", 0.50, 0.56, "down");
        place("jurie", 0.44, 0.80, "down");
      }
      roles = { press: "yuno", cover: "jurie", want: "yuno", timer: 0 };
      keeperOn = false;
      keeperLunge = null;
      keeperAimLog = [];
      lastShot = null;
      meVel = { x: 0, d: 0 };
      ballOffFoot = 0;
      turnLog = [];
      holderLast = { who: who, x: A[who].x, d: A[who].d };
      giveBall(who, "kickoff");
      refreshScreen();
    }

    // ---------------------------------------------------------------- 射门

    // 角度和门线落点互相换算。角度是玩家脚下朝门线的方向，
    // 所以站得离门越近，同样的角度在门线上偏得越多。
    function aimDepthPx() { return Math.max(1, (1 - A.me.d) * (CFG.nearY - CFG.farY)); }
    function aimXFor(ang) {
      const lateral = Math.tan(ang) * aimDepthPx();
      return D.clamp(A.me.x + lateral / widthAt(A.me.d), CFG.aimMinX, CFG.aimMaxX);
    }
    function aimAngFor(x) {
      const lateral = (x - A.me.x) * widthAt(A.me.d);
      return Math.atan2(lateral, aimDepthPx());
    }

    // ---- §6.5 射门三把锁 --------------------------------------------------

    /** 身前扇区：防守人挡在玩家和球门之间、距离 < 26px 才算压迫。 */
    function defenderInFront() {
      for (const k of ["yuno", "jurie"]) {
        const who = A[k];
        const dx = who.sx - A.me.sx;
        const dy = A.me.sy - who.sy;          // 正数 = 在玩家身前（屏幕上更高）
        if (dy <= 0) continue;
        if (Math.hypot(dx, dy) > CFG.pressureRange) continue;
        if (Math.abs(dx) > dy * 1.6) continue; // 身前约 ±58° 的扇区
        if ((k === "yuno" ? yunoStun : jurieStun) > 0) continue;
        return true;
      }
      return false;
    }

    /** σ = base + power²×powerW + 距离系数×distW +（被压迫 ? 0.020 : 0）。
     *  距离系数：离门越远越大，0（禁区里）~1（后场）。 */
    function spreadSigma(powerLevel, meD, pressured) {
      const distFactor = D.clamp((1 - meD - 0.20) / 0.70, 0, 1);
      let s = CFG.spreadBase + CFG.spreadPower * powerLevel * powerLevel +
        CFG.spreadDistW * distFactor;
      if (pressured) s += CFG.spreadPressure;
      return s;
    }

    function shotSpread(powerLevel) {
      return spreadSigma(powerLevel, A.me.d, defenderInFront());
    }

    /** 出手落点 = 瞄准点 + 本局种子给出的偏移。spreadScale = 0 时严格等于瞄准点。 */
    function spreadLanding(x, z, powerLevel) {
      if (!(spreadScale > 0)) return { x: x, z: z };
      const sigma = shotSpread(powerLevel) * spreadScale;
      if (!(sigma > 0)) return { x: x, z: z };
      // 两次种子随机拼一个近似正态，整局可复现
      const u1 = Math.max(1e-7, rnd());
      const u2 = rnd();
      const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(TAU * u2);
      return { x: D.clamp(x + gauss * sigma, CFG.xMin, CFG.xMax), z: z };
    }

    function markShot(result, extra) {
      if (!lastShot) return;
      lastShot.result = result;
      if (extra) Object.assign(lastShot, extra);
    }

    /** §6.2 守门横扑判定：落点在扑程里、且是低球（z1 < 0.50）才扑得到。
     *  出手瞬间 keeper 已经在守门态就直接判；如果球飞起来才触发守门，下一帧再补判。 */
    function keeperDecideSave() {
      if (!shot || shot.from !== "me" || shot.saveDecided) return;
      shot.saveDecided = true;
      const kp = A[roles.cover];
      keeperLunge = {
        who: roles.cover, fromX: kp.x,
        toX: D.clamp(shot.x1, kp.x - CFG.keeperReach, kp.x + CFG.keeperReach),
        t: 0
      };
      if (Math.abs(shot.x1 - kp.x) <= CFG.keeperReach && shot.z1 < CFG.keeperLowZ) {
        shot.save = { who: roles.cover };
      }
      if (lastShot && lastShot.result === "flying") {
        lastShot.save = shot.save ? shot.save.who : null;
      }
    }

    /** 一脚射出去。x1 / z1 是门线上的落点：横向位置和离地高度。
     *  球在飞行途中穿过防守人的纵深时，只有高度低于 blockHeight 才会被挡。 */
    function shoot(who, x1, z1, powerLevel) {
      const a = A[who];
      // §6.5 第一把锁：玩家出手落点带力量-准度散布（σ 见 shotSpread）
      const aim = { x: x1, z: z1 };
      if (who === "me") {
        const l = spreadLanding(x1, z1, powerLevel);
        x1 = l.x;
        z1 = l.z;
      }
      const targetD = who === "me" ? 1 : 0;
      const dist = Math.abs(targetD - a.d);
      const speed = 0.55 + 0.75 * powerLevel;
      shot = {
        from: who, targetD: targetD,
        x0: a.x, d0: a.d, x1: x1, z1: z1,
        t: 0, dur: D.clamp(dist / speed, 0.20, 1.0), power: powerLevel
      };
      // §6.2 射门出手瞬间，守门的 cover 朝预测落点横扑；
      // 落点在扑程内、且是低球（z1 < 0.50）才扑得到，打她反方向 / 打高球是正解。
      keeperLunge = null;
      if (who === "me" && keeperOn) keeperDecideSave();
      lastShot = {
        from: who, result: "flying", x0: a.x, d0: a.d, x1: x1, z1: z1,
        aim: aim, power: powerLevel, t: clock,
        save: shot.save ? shot.save.who : null
      };
      ball.owner = null;
      ball.mode = "shot";
      ball.vx = 0; ball.vd = 0; ball.vz = 0;
      ball.z = 0.05;
      ball.lock = 0;
      ball.spin = 0;
      trail = [];
      windup = null;
      pass = null;
      feintT = 0;
      aiSteal = null;
      charging = false;
      if (who === "me") stats.shots++;
      sfx("step");
      syncBallScreen();
    }

    function arcPoint(x0, d0, x1, d1, z1, t) {
      const peak = 0.10 + 0.6 * z1;
      return {
        x: lerp(x0, x1, t),
        d: lerp(d0, d1, t),
        z: 4 * peak * t * (1 - t) + z1 * t
      };
    }

    function weakKick(who) {
      const a = A[who];
      const dir = who === "me" ? 1 : -1;
      ball.owner = null;
      ball.mode = "loose";
      ball.x = a.x;
      ball.d = a.d;
      ball.z = 0.06;
      ball.vx = 0;
      ball.vd = dir * 0.24;
      ball.vz = 0.55;
      ball.lock = 0.22;
      ball.spin = 0;
      stats.shots++;
      sfx("wrong");
      if (who === "me") bark("me", "没踢上力。", 900);
      syncBallScreen();
    }

    function blockShot(who, kind) {
      giveBall(who, "pass");
      stats.saves++;
      markShot(kind || "block", { by: who });
      sfx("click");
      bark(who, "挡住了。", 900);
    }

    function updateShot(dt) {
      const prevD = ball.d;
      shot.t = Math.min(1, shot.t + dt / shot.dur);
      const p = arcPoint(shot.x0, shot.d0, shot.x1, shot.targetD, shot.z1, shot.t);
      ball.x = p.x;
      ball.d = p.d;
      ball.z = p.z;
      ball.spin += dt * 16;
      syncBallScreen();

      const last = trail[trail.length - 1];
      const py = ball.sy - liftAt(ball.z, ball.d);
      if (!last || distPx(ball.sx, py, last.x, last.y) > 6) {
        trail.push({ x: ball.sx, y: py, life: 1 });
      }
      for (const q of trail) q.life -= dt * 2.2;
      trail = trail.filter(function (q) { return q.life > 0; });

      // §6.2 球已经在飞向远门才触发守门的话，下一帧再补一次扑救判定
      if (shot.from === "me" && keeperOn && !shot.saveDecided) keeperDecideSave();

      // §6.2 守门员横扑：球飞到门线前那一下才真的挡下来（giveBall 会让守门人拿球）
      if (shot.save) {
        const kd = 1 - CFG.keeperLine;
        const crossedKeeper = (prevD <= kd && kd <= ball.d) || (ball.d <= kd && kd <= prevD);
        if (crossedKeeper) { blockShot(shot.save.who, "save"); return; }
      }

      const defenders = shot.from === "me" ? ["yuno", "jurie"] : ["me"];
      for (const k of defenders) {
        if (k === "me" ? stumbleT > 0 : (k === "yuno" ? yunoStun : jurieStun) > 0) continue;
        const a = A[k];
        // 只算站在射门路线“前面”的人：贴着射手身后的人不能算封堵
        const inFront = shot.targetD > shot.d0
          ? a.d > shot.d0 + 0.015
          : a.d < shot.d0 - 0.015;
        if (!inFront) continue;
        const crossed = (prevD <= a.d && a.d <= ball.d) ||
                        (ball.d <= a.d && a.d <= prevD);
        if (!crossed) continue;
        if (Math.abs(ball.x - a.x) <= CFG.blockX && ball.z < CFG.blockHeight) {
          blockShot(k);
          return;
        }
      }

      if (shot.t >= 1) resolveShot();
    }

    function resolveShot() {
      const s = shot;
      shot = null;
      keeperLunge = null;
      const mouth = CFG.goalX;
      // §6.5 第三把锁：中柱。落点贴着门柱、又在门高内 → 弹出来，球变 loose
      const hitPost =
        (Math.abs(s.x1 - mouth[0]) < CFG.postTol || Math.abs(s.x1 - mouth[1]) < CFG.postTol) &&
        s.z1 <= CFG.goalHeight;
      if (hitPost) {
        const atFarPost = s.targetD === 1;
        ball.owner = null;
        ball.mode = "loose";
        ball.x = D.clamp(s.x1, CFG.xMin, CFG.xMax);
        ball.d = atFarPost ? CFG.dMax : CFG.dMin;
        ball.z = 0.08;
        ball.vz = 0;
        ball.vx = s.x1 < 0.5 ? -0.55 : 0.55;   // 往门柱外侧弹
        ball.vd = atFarPost ? -0.28 : 0.28;    // 再弹回场内
        ball.lock = 0.20;
        ball.spin = 0;
        stats.posts++;
        markShot("post");
        sfx("wrong");
        bark(s.from, "中柱。", 900);
        syncBallScreen();
        return;
      }
      const inMouth = s.x1 > mouth[0] && s.x1 < mouth[1];
      const underBar = s.z1 <= CFG.goalHeight;
      if (inMouth && underBar) {
        goal(s.from === "me" ? "me" : "them");
        return;
      }

      const atFar = s.targetD === 1;
      ball.owner = null;
      ball.mode = "loose";
      ball.x = D.clamp(s.x1, CFG.xMin, CFG.xMax);
      ball.d = atFar ? CFG.dMax : CFG.dMin;
      ball.z = 0.05;
      ball.vz = 0;
      ball.vx = 0;
      ball.vd = atFar ? -0.20 : 0.20;
      ball.lock = 0.15;
      ball.spin = 0;
      markShot(underBar ? "miss" : "high");
      sfx("wrong");
      bark(s.from, underBar ? "偏了。" : "高了。", 900);
      syncBallScreen();
    }

    function goal(side) {
      if (side === "me") { scoreMe++; stats.goalsFor++; }
      else { scoreThem++; stats.goalsAgainst++; }
      lastGoalSide = side;
      markShot("goal");
      keeperLunge = null;
      state = "goalPause";
      goalPause = CFG.goalPause;
      goalFxT = 0;
      goalSide = side;
      ball.owner = null;
      ball.mode = "loose";
      ball.x = 0.5;
      ball.d = side === "me" ? CFG.dMax : CFG.dMin;
      ball.z = 0.10;
      ball.vx = 0; ball.vd = 0; ball.vz = 0;
      ball.lock = 5;
      ball.spin = 0;
      shot = null;
      pass = null;
      windup = null;
      aiSteal = null;
      duel = null;
      charging = false;
      chargeT = 0;
      trail = [];
      hudPulse = 0.5;
      if (!simMode) el.hud.classList.add("pulse");
      sfx("right");
      syncBallScreen();
      syncHud();
    }

    // ---------------------------------------------------------------- 做球

    function passTo(from, to) {
      const a = A[from], b = A[to];
      const dist = Math.hypot((b.x - a.x) * widthAt(a.d), (b.d - a.d) * (CFG.nearY - CFG.farY));
      pass = {
        from: from, to: to,
        x0: a.x, d0: a.d, x1: b.x, d1: b.d,
        t: 0, dur: D.clamp(dist / 130, 0.35, 0.9)
      };
      ball.owner = null;
      ball.mode = "pass";
      ball.vx = 0; ball.vd = 0; ball.vz = 0;
      ball.lock = 0;
      ball.spin = 0;
      shot = null;
      windup = null;
      stats.passes++;
      syncBallScreen();
    }

    function updatePass(dt) {
      pass.t = Math.min(1, pass.t + dt / pass.dur);
      const t = pass.t;
      ball.x = lerp(pass.x0, pass.x1, t);
      ball.d = lerp(pass.d0, pass.d1, t);
      ball.z = 0.05 + 0.10 * Math.sin(Math.PI * t);
      ball.spin += dt * 9;
      syncBallScreen();
      if (t >= 1) {
        const target = pass.to;
        pass = null;
        const a = A[target];
        if (distPx(ball.sx, ball.sy, a.sx, a.sy) <= 34) {
          giveBall(target);
        } else {
          ball.owner = null;
          ball.mode = "loose";
          ball.lock = 0.2;
          ball.z = 0.05;
          ball.vz = 0;
          ball.vx = 0;
          ball.vd = 0;
        }
      }
    }

    // ---------------------------------------------------------------- 抢断

    function screenDist(a, b) {
      return distPx(a.sx, a.sy, b.sx, b.sy);
    }

    /** 抢断圈：护球人先选一边，0.42 秒时可能换边；玩家用 W / S 打另一边。
     *  打中护住的那边就是被挡下来（还会晃一下）；打空档才断得到球。 */
    function startDuel(who) {
      duel = {
        who: who,
        t: 0,
        dur: 0.9,
        switchAt: 0.42,
        switched: false,
        willSwitch: rnd() < 0.55,
        guard: rnd() < 0.5 ? "up" : "down",
        flash: 0
      };
      A[who].moving = false;
      sfx("blip");
    }

    function resolveDuel(side) {
      if (!duel) return;
      const who = duel.who;
      if (side !== duel.guard) {
        duel = null;
        giveBall("me", "steal");
        stats.tackles++;
        tackleCd = CFG.tackleCd;
        sfx("right");
        bark("me", "断下来了。", 800);
      } else {
        duel = null;
        stumbleT = CFG.stumble;
        stats.duelFails++;
        tackleCd = CFG.tackleCd + 0.2;
        sfx("wrong");
        bark(who, who === "yuno" ? "这边。" : "……这边。", 900);
      }
    }

    function updateDuel(dt) {
      duel.t += dt;
      if (duel.flash > 0) duel.flash -= dt;
      if (!duel.switched && duel.t >= duel.switchAt) {
        duel.switched = true;
        if (duel.willSwitch) {
          duel.guard = duel.guard === "up" ? "down" : "up";
          duel.flash = 0.22;
          sfx("blip");
        }
      }
      if (duel.t >= duel.dur) {
        duel = null;
        tackleCd = 0.3;
      }
    }

    function playerTackle() {
      if (state !== "play" || frozen || D.dialogOpen() || tackleCd > 0) return;
      if (stumbleT > 0 || duel) return;

      if (ball.owner && ball.owner !== "me") {
        const h = A[ball.owner];
        if (screenDist(A.me, h) > CFG.tackleRange) return;
        if (ball.owner === "yuno" && feintT > 0) {
          stumbleT = CFG.stumble;
          stats.stumbles++;
          feintT = 0;
          sfx("wrong");
          bark("yuno", "过。", 900);
          return;
        }
        startDuel(ball.owner);
        return;
      }

      if (!ball.owner && ball.mode === "loose" && ball.z <= 0.16 &&
          distPx(A.me.sx, A.me.sy, ball.sx, ball.sy) <= CFG.tackleRange) {
        giveBall("me");
        tackleCd = CFG.tackleCd;
        sfx("right");
        bark("me", "拿到了。", 800);
      }
    }

    function aiTrySteal(who) {
      if (ball.owner !== "me" || stumbleT > 0 || aiSteal) return;
      const cd = who === "yuno" ? yunoTackleCd : jurieTackleCd;
      if (cd > 0) return;
      // §6.3 球离脚 > 0.035 的那一瞬（急转外滑 / 拨球），抢断距离从 20 放宽到 26
      const range = ballOffFoot > 0.035 ? CFG.stealRangeLoose : CFG.aiStealRange;
      if (screenDist(A[who], A.me) > range) return;
      // 不立刻得手，先抬手。玩家在这 0.32 秒里跑开或者把球踢出去，这一下就空了。
      aiSteal = { who: who, t: 0, range: range };
      stats.aiWindups++;
      sfx("blip");
    }

    function updateAiSteal(dt) {
      if (!aiSteal) return;
      const who = aiSteal.who;
      // 球不在玩家脚下了、玩家被晃了，或者人已经被甩开——收手
      if (ball.owner !== "me" || stumbleT > 0) { aiSteal = null; return; }
      const cd = who === "yuno" ? yunoTackleCd : jurieTackleCd;
      if (cd > 0) { aiSteal = null; return; }
      if (screenDist(A[who], A.me) > (aiSteal.range || CFG.aiStealRange) + 6) { aiSteal = null; return; }
      aiSteal.t += dt;
      if (aiSteal.t < CFG.aiStealWindup) return;

      aiSteal = null;
      giveBall(who, "steal");
      stats.steals++;
      if (who === "yuno") yunoTackleCd = 2.4;
      else jurieTackleCd = 3.0;
      sfx("click");
      bark(who, who === "yuno" ? "球给我。" : "……给我。", 800);
    }

    // ---------------------------------------------------------------- 跑位

    function movePlayer(dt) {
      const a = A.me;
      if (stumbleT > 0 || charging) { a.moving = false; return; }
      let ax = inputX();
      let ay = inputY();
      if (!ax && !ay) {
        a.moving = false;
        if (ball.owner === "me") a.face = "up";
        return;
      }
      const len = Math.hypot(ax, ay);
      ax /= len;
      ay /= len;
      // §6.3 带球速度系数 0.95 → 0.78：无球 96 仍是全场最快，优势从「带球碾压」变成「无球跑位」。
      //      Shift 拨球后的 0.45 秒里再加速到 1.15 倍。
      let speed = CFG.playerSpeed;
      if (ball.owner === "me") speed *= CFG.dribbleSpeed;
      if (dashT > 0) speed *= CFG.dashMul;
      a.x = D.clamp(a.x + ax * speed / widthAt(a.d) * dt, CFG.xMin, CFG.xMax);
      a.d = D.clamp(a.d + ay * speed / (CFG.nearY - CFG.farY) * dt, CFG.dMin, CFG.dMax);
      // ay 是纵深轴（+1 往远处），屏幕上的 y 正好相反，换朝向时要翻一下。
      a.face = faceFromDelta(ax, -ay);
      a.dir = a.face;
      a.moving = true;
      a.sx = sxAt(a.x, a.d);
      a.sy = syAt(a.d);
      a.scale = scaleAt(a.d);
    }

    /** 按屏幕像素速度走向场上的一个点。AI 用它，玩家的键盘也用同一套换算。 */
    function stepToward(who, tx, td, speed, dt) {
      const a = A[who];
      const dx = sxAt(tx, td) - a.sx;
      const dy = syAt(td) - a.sy;
      const dist = Math.hypot(dx, dy);
      if (dist < 1.5) { a.moving = false; return; }
      const step = Math.min(dist, speed * dt);
      const nx = a.sx + (dx / dist) * step;
      const ny = a.sy + (dy / dist) * step;
      const nd = D.clamp((ny - CFG.nearY) / (CFG.farY - CFG.nearY), CFG.dMin, CFG.dMax);
      const nxx = D.clamp(0.5 + (nx - CFG.cx) / widthAt(nd), CFG.xMin, CFG.xMax);
      a.d = nd;
      a.x = nxx;
      a.sx = sxAt(a.x, a.d);
      a.sy = syAt(a.d);
      a.scale = scaleAt(a.d);
      a.face = faceFromDelta(dx, dy);
      a.dir = a.face;
      a.moving = true;
    }

    // ---- §6.3 触球系统 ----------------------------------------------------

    /** 球在持球人脚下应该待的位置：朝向前方 0.05 纵深。 */
    function touchTarget(who) {
      const a = A[who];
      let ox = 0, od = 0;
      if (a.face === "up") od = CFG.touchOffset;
      else if (a.face === "down") od = -CFG.touchOffset;
      else if (a.face === "left") ox = -CFG.touchOffset;
      else if (a.face === "right") ox = CFG.touchOffset;
      return {
        x: D.clamp(a.x + ox, CFG.xMin, CFG.xMax),
        d: D.clamp(a.d + od, CFG.dMin, CFG.dMax)
      };
    }

    /** 球不再粘脚：以有限速率追目标点（跑得越快落后越多）；
     *  急转 >100°/0.2s 时球向外侧多滑 0.02——是趟球失误，不是直接丢球。 */
    function updateTouch(dt) {
      if (!ball.owner || ball.mode !== "held") { ballOffFoot = 0; return; }
      const who = ball.owner;
      const a = A[who];
      const target = touchTarget(who);
      const k = 1 - Math.exp(-CFG.touchFollow * dt);
      ball.x = lerp(ball.x, target.x, k);
      ball.d = lerp(ball.d, target.d, k);
      ball.z = 0.06;
      ball.vx = 0; ball.vd = 0; ball.vz = 0;

      const vx = dt > 0 ? (a.x - holderLast.x) / dt : 0;
      const vd = dt > 0 ? (a.d - holderLast.d) / dt : 0;
      holderLast.x = a.x;
      holderLast.d = a.d;
      holderLast.who = who;
      const speed = Math.hypot(vx, vd);
      if (speed > 0.06) {
        const ang = Math.atan2(vd, vx);
        const expect = clock - CFG.turnWindow;
        turnLog.push({ t: clock, ang: ang });
        while (turnLog.length > 24) turnLog.shift();
        let old = null;
        for (let i = turnLog.length - 1; i >= 0; i--) {
          if (turnLog[i].t <= expect) { old = turnLog[i]; break; }
        }
        if (old && slipCd <= 0) {
          let diff = ang - old.ang;
          while (diff > Math.PI) diff -= TAU;
          while (diff < -Math.PI) diff += TAU;
          if (Math.abs(diff) > CFG.turnLimit) {
            // 顺着原来的方向往外滑 0.02：玩家还能追回来，但上抢的人能利用这一瞬
            ball.x = D.clamp(ball.x + Math.cos(old.ang) * CFG.turnSlip, CFG.xMin, CFG.xMax);
            ball.d = D.clamp(ball.d + Math.sin(old.ang) * CFG.turnSlip, CFG.dMin, CFG.dMax);
            slipCd = 0.25;
            turnLog = [];
            stats.turnSlips++;
          }
        }
      }
      ballOffFoot = Math.hypot(ball.x - a.x, ball.d - a.d);
      syncBallScreen();
    }

    /** §6.3 Shift 拨球：球向前拨 0.16 纵深，自己 0.45 秒加速到 1.15 倍，冷却 2.5 秒。
     *  拨球期间球不受控（loose），守线的人有机会拦截——玩家版的「过人」。 */
    function tryDash() {
      if (state !== "play" || (!simMode && D.dialogOpen())) return;
      if (charging || stumbleT > 0 || dashCd > 0) return;
      if (ball.owner !== "me" || ball.mode !== "held") return;
      const a = A.me;
      dashT = CFG.dashTime;
      dashCd = CFG.dashCd;
      ball.owner = null;
      ball.mode = "loose";
      ball.x = a.x;
      ball.d = D.clamp(a.d + CFG.dashDepth, CFG.dMin, CFG.dMax);
      ball.z = 0.05;
      ball.vx = 0;
      ball.vd = 0.04;      // 拨出去的球自己几乎不滚，靠人追
      ball.vz = 0;
      ball.lock = 0.10;
      ball.spin = 0;
      trail = [];
      ballOffFoot = CFG.dashDepth;
      turnLog = [];
      syncBallScreen();
    }

    // ---------------------------------------------------------------- AI

    function startFeint() {
      feintT = CFG.feintWindow;
      feintTimer = CFG.feintMin + rnd() * (CFG.feintMax - CFG.feintMin);
      yunoFeinted = true;
      stats.feints++;
    }

    function startWindup(who, dur) {
      windup = { who: who, t: 0, dur: dur };
      A[who].moving = false;
    }

    function aiShoot(who) {
      const acc = who === "yuno" ? 0.75 : 0.6;
      let aimX2, aimZ2;
      if (rnd() < acc) {
        aimX2 = 0.5 + (rnd() - 0.5) * 0.22;
        aimZ2 = 0.08 + rnd() * 0.40;
      } else if (rnd() < 0.5) {
        aimX2 = rnd() < 0.5 ? 0.26 : 0.74;
        aimZ2 = 0.10 + rnd() * 0.30;
      } else {
        aimX2 = 0.5 + (rnd() - 0.5) * 0.20;
        aimZ2 = 0.70 + rnd() * 0.12;
      }
      shoot(who, aimX2, aimZ2, 0.55 + rnd() * 0.35);
    }

    function jurieKick() {
      if (rnd() < 0.20) {
        stats.airKicks++;
        jurieStun = 0.55;
        jurieActionCd = 1.3;
        sfx("wrong");
        bark("jurie", "……踢空了。", 1000);
        return;
      }
      if (rnd() < 0.25 && A.yuno.d < A.jurie.d - 0.10) {
        passTo("jurie", "yuno");
        bark("jurie", "由乃。", 800);
        jurieActionCd = 1.6;
        return;
      }
      aiShoot("jurie");
      jurieActionCd = 2.2;
    }

    // ---- §6.1 防守分工 / §6.2 守门 ---------------------------------------

    /** 球现在大概在哪个场地坐标（有人持球就用他的位置）。 */
    function ballPoint() {
      if (ball.owner) { const a = A[ball.owner]; return { x: a.x, d: a.d }; }
      return { x: ball.x, d: ball.d };
    }

    function keeperInfo() {
      if (!keeperOn) return { active: false, who: null, x: 0.5, d: 1 - CFG.keeperLine };
      const who = roles.cover;
      return { active: true, who: who, x: A[who].x, d: A[who].d };
    }

    /** 每帧按「谁离球近」分一次工：近者上抢、远者守线；换岗带 0.5 秒迟滞。 */
    function updateRoles(dt) {
      if (ball.owner === "yuno" || ball.owner === "jurie") {
        roles.press = ball.owner;
        roles.cover = ball.owner === "yuno" ? "jurie" : "yuno";
        roles.want = ball.owner;
        roles.timer = 0;
        keeperOn = false;
        keeperLunge = null;
        return;
      }
      const bp = ballPoint();
      const bsx = sxAt(bp.x, bp.d), bsy = syAt(bp.d);
      const dy = distPx(A.yuno.sx, A.yuno.sy, bsx, bsy);
      const dj = distPx(A.jurie.sx, A.jurie.sy, bsx, bsy);
      const want = dy <= dj ? "yuno" : "jurie";
      if (want !== roles.want) { roles.want = want; roles.timer = 0; }

      // §6.2 守门触发：玩家持球且越过 0.62，或球正飞向远门
      const attacking = ball.owner === "me";
      const flyingHome = ball.mode === "shot" && !!shot && shot.targetD === 1;
      const rollingHome = ball.mode === "loose" && ball.vd > 0.06 && ball.d > 0.55;
      const wasKeeper = keeperOn;
      keeperOn = (attacking && A.me.d >= CFG.keeperTriggerD) || flyingHome || rollingHome;
      if (!keeperOn) keeperLunge = null;
      // 守门时不再换岗（免得两个人来回跑）；平时才走迟滞换岗
      if (keeperOn) {
        if (!wasKeeper) roles.timer = 0;
        return;
      }
      if (want !== roles.press) {
        roles.timer += dt;
        if (roles.timer >= CFG.roleHysteresis) {
          roles.press = want;
          roles.cover = want === "yuno" ? "jurie" : "yuno";
          roles.timer = 0;
        }
      } else {
        roles.timer = 0;
      }
    }

    /** §6.6 比分起伏的隐性平衡：领先两球时上抢提前量更大、守门误差更小；
     *  落后两球时朱里守线偏一侧，露出远角。不提示、不说破。 */
    function pressLeadNow() {
      return (scoreMe - scoreThem >= 2) ? CFG.pressLeadAhead : CFG.pressLead;
    }
    function keeperErrNow() {
      return (scoreMe - scoreThem >= 2) ? CFG.keeperErrLead : CFG.keeperErr;
    }
    function coverBiasNow(who) {
      return (scoreThem - scoreMe >= 2 && who === "jurie") ? CFG.keeperBiasTrail : 0;
    }

    /** 上抢目标点：玩家持球时 = 玩家位置 + 速度向量 × 提前量（领先两球时提前量更大）；
     *  散球 / 飞行中的球就直接去追球，不然球滚到角上没人捡。 */
    function pressSpot() {
      if (!ball.owner) return { x: ball.x, d: ball.d };
      const lead = pressLeadNow();
      return {
        x: D.clamp(A.me.x + meVel.x * lead, CFG.xMin, CFG.xMax),
        d: D.clamp(A.me.d + meVel.d * lead, CFG.dMin, CFG.dMax)
      };
    }

    /** 守线点：球与远门中心的连线上、距门线 0.10 纵深处，横向随球插值。
     *  §6.6 玩家落后两球时朱里偏一侧 0.04，露出远角（不说破）。 */
    function coverSpot(who) {
      const bp = ballPoint();
      const lineD = 1 - CFG.coverDepth;
      let x;
      if (bp.d < lineD - 0.001) {
        const t = (lineD - bp.d) / (1 - bp.d);
        x = lerp(bp.x, 0.5, t);
      } else {
        // 球已经比守线点还深：站在门线前，横向跟着球偏一点
        x = lerp(bp.x, 0.5, 0.5);
      }
      x += coverBiasNow(who);
      return { x: D.clamp(x, CFG.xMin, CFG.xMax), d: lineD };
    }

    /** 守门：站门线前 0.04，横向跟 aimX（120ms 延迟 + 整局固定误差），
     *  射门出手瞬间朝预测落点横扑。 */
    function updateKeeperAI(who, dt) {
      const a = A[who];
      // 扑救动作：射门出手后 0.12 秒内扑出去
      if (keeperLunge && keeperLunge.who === who && ball.mode === "shot") {
        keeperLunge.t += dt;
        const k = D.clamp(keeperLunge.t / CFG.saveLunge, 0, 1);
        a.x = lerp(keeperLunge.fromX, keeperLunge.toX, k);
        a.d = 1 - CFG.keeperLine;
        a.sx = sxAt(a.x, a.d);
        a.sy = syAt(a.d);
        a.scale = scaleAt(a.d);
        a.face = "down"; a.dir = "down";
        a.moving = k < 1;
        return;
      }
      keeperAimLog.push({ t: clock, x: charging ? aimX : 0.5 });
      while (keeperAimLog.length > 48) keeperAimLog.shift();
      let sample = 0.5;
      const wantT = clock - CFG.keeperLag;
      for (let i = 0; i < keeperAimLog.length; i++) {
        if (keeperAimLog[i].t <= wantT) sample = keeperAimLog[i].x;
        else break;
      }
      // §6.6 玩家领先两球：预判误差收小；玩家落后两球：朱里偏一侧，露出远角
      const targetX = D.clamp(
        sample + keeperErrDir * keeperErrNow() + coverBiasNow(who),
        CFG.goalX[0] + 0.02, CFG.goalX[1] - 0.02);
      stepToward(who, targetX, 1 - CFG.keeperLine, CFG.jurieSpeed, dt);
      a.face = "down";
      a.dir = "down";
    }

    /** 防守时两个人的分工：一个按 pressSpot 上抢，一个按 coverSpot / 守门。 */
    function defendStep(who, dt) {
      if (keeperOn && roles.cover === who) { updateKeeperAI(who, dt); return; }
      if (roles.press === who) {
        const t = pressSpot();
        stepToward(who, t.x, t.d, who === "yuno" ? CFG.yunoSpeed : CFG.jurieSpeed, dt);
        if (ball.owner === "me") aiTrySteal(who);
        return;
      }
      const c = coverSpot(who);
      // 守线的人慢一点：站位本身就是封堵，不去追人
      stepToward(who, c.x, c.d, CFG.jurieSpeed, dt);
    }

    function updateYuno(dt) {
      const a = A.yuno;
      if (yunoStun > 0) { yunoStun -= dt; a.moving = false; return; }

      if (ball.owner === "yuno") {
        yunoHold += dt;
        if (feintT > 0) {
          feintT = Math.max(0, feintT - dt);
          a.moving = false;
          return;
        }
        if (windup && windup.who === "yuno") {
          windup.t += dt;
          a.moving = false;
          if (windup.t >= windup.dur) { windup = null; aiShoot("yuno"); }
          return;
        }
        yunoPassCd = Math.max(0, yunoPassCd - dt);
        if (scoreThem >= 2 && yunoPassCd <= 0 && A.jurie.d < a.d - 0.12 && a.d < 0.60) {
          yunoPassCd = 3.4;
          passTo("yuno", "jurie");
          bark("yuno", "朱里。", 900);
          return;
        }
        if (!yunoFeinted && a.d <= 0.24) { startFeint(); return; }
        if (a.d <= 0.20 && yunoHold > 0.7 && yunoFeinted) {
          startWindup("yuno", 0.7);
          return;
        }
        if (a.d <= 0.20) { a.moving = false; a.face = "down"; return; }
        feintTimer -= dt;
        if (feintTimer <= 0) { startFeint(); return; }
        stepToward("yuno", 0.5 + Math.sin(clock * 1.9) * 0.06,
          a.d - 0.30, CFG.yunoSpeed, dt);
        a.face = "down";
        return;
      }

      if (ball.owner === "jurie") {
        // 朱里持球时由乃去接应（这条不动，做球路线还靠它）
        stepToward("yuno", D.clamp(A.jurie.x, 0.35, 0.65),
          Math.max(0.12, A.jurie.d - 0.25), CFG.yunoSpeed * 0.85, dt);
        return;
      }
      // 防守（玩家持球 / 球在飞 / 散球）：按 roles 分工，近者上抢、远者守线
      if (ball.owner === "me" || ball.mode === "shot" || ball.mode === "pass" ||
          ball.mode === "loose") {
        defendStep("yuno", dt);
        return;
      }
      a.moving = false;
    }

    function updateJurie(dt) {
      const a = A.jurie;
      if (jurieStun > 0) { jurieStun -= dt; a.moving = false; return; }

      if (ball.owner === "jurie") {
        jurieActionCd = Math.max(0, jurieActionCd - dt);
        if (windup && windup.who === "jurie") {
          windup.t += dt;
          a.moving = false;
          if (windup.t >= windup.dur) { windup = null; jurieKick(); }
          return;
        }
        if (jurieActionCd > 0) { a.moving = false; return; }
        if (a.d <= 0.24) { startWindup("jurie", 0.95); return; }
        stepToward("jurie", 0.5 + Math.sin(clock * 1.3) * 0.08,
          a.d - 0.26, CFG.jurieSpeed, dt);
        a.face = "down";
        return;
      }

      if (ball.owner === "yuno") {
        stepToward("jurie", D.clamp(A.yuno.x + 0.08, 0.30, 0.70),
          Math.max(0.10, A.yuno.d - 0.16), CFG.jurieSpeed, dt);
        return;
      }
      // 防守（玩家持球 / 球在飞 / 散球）：按 roles 分工
      if (ball.owner === "me" || ball.mode === "shot" || ball.mode === "pass" ||
          ball.mode === "loose") {
        defendStep("jurie", dt);
        return;
      }
      a.moving = false;
    }

    // ---------------------------------------------------------------- 更新

    function update(dt) {
      clock += dt;
      updateBubbles(dt);
      tackleCd = Math.max(0, tackleCd - dt);
      yunoTackleCd = Math.max(0, yunoTackleCd - dt);
      jurieTackleCd = Math.max(0, jurieTackleCd - dt);
      dashCd = Math.max(0, dashCd - dt);
      dashT = Math.max(0, dashT - dt);
      slipCd = Math.max(0, slipCd - dt);
      if (hudPulse > 0 && !simMode) {
        hudPulse -= dt;
        if (hudPulse <= 0) el.hud.classList.remove("pulse");
      }

      if (state === "goalPause") {
        goalFxT += dt;
        goalPause -= dt;
        if (goalPause <= 0) {
          if (scoreMe >= CFG.goalsToWin || scoreThem >= CFG.goalsToWin) {
            state = "rest";
            finish(scoreMe > scoreThem);
          } else {
            // §6.4 进球后由失球方开球：谁丢的球，谁就站到球前面
            kickoff(goalSide === "me" ? "yuno" : "me");
            state = "play";
          }
        }
        syncBallScreen();
        syncHud();
        return;
      }

      if (state !== "play" || frozen || (!simMode && D.dialogOpen())) {
        if (stumbleT > 0) stumbleT = Math.max(0, stumbleT - dt);
        return;
      }

      if (duel) {
        updateDuel(dt);
        updateTouch(dt);
        refreshScreen();
        syncHud();
        return;
      }

      if (stumbleT > 0) stumbleT = Math.max(0, stumbleT - dt);

      // §6.3 Shift 拨球：只在按下的那一帧触发，按住不重复
      const sh = shiftHeld();
      if (sh && !shiftLatch) tryDash();
      shiftLatch = sh;

      // 玩家的蓄力先处理：这一帧松手就立刻出脚
      const h = spaceHeld();
      if (!h) armed = true;
      if (ball.owner === "me" && ball.mode === "held" && stumbleT <= 0) {
        if (h && armed && !charging) {
          charging = true;
          chargeT = 0;
          power = 0.3;
          // 起脚时先对准门中间，再由 A/D 把角度拨开
          aimX = 0.5;
          aimAng = aimAngFor(aimX);
          aimZ = CFG.aimZ0;
        }
        if (charging) {
          // §6.5 第二把锁：被贴身压迫时蓄力速度 ×0.7
          const pressed = defenderInFront();
          chargeT += dt * (pressed ? CFG.pressureChargeMul : 1);
          power = Math.min(1, chargeT / CFG.chargeTime);
          aimAng += inputX() * CFG.aimRateA * dt;
          aimX = aimXFor(aimAng);
          aimAng = aimAngFor(aimX);   // 顶到门柱外侧时把角度收回
          aimZ = D.clamp(aimZ + inputY() * CFG.aimRateZ * dt, 0.04, 0.88);
        }
        if (charging && !h) {
          const p = power;
          const pressed = defenderInFront();
          charging = false;
          chargeT = 0;
          power = 0.3;
          if (p < CFG.shotMin) weakKick("me");
          else if (pressed && p < CFG.weakPower) weakKick("me");   // 被逼住的一脚，踢呲
          else shoot("me", aimX, aimZ, p);
        }
      } else {
        charging = false;
        chargeT = 0;
      }

      const prevX = A.me.x, prevD = A.me.d;
      movePlayer(dt);
      meVel.x = dt > 0 ? (A.me.x - prevX) / dt : 0;
      meVel.d = dt > 0 ? (A.me.d - prevD) / dt : 0;
      updateRoles(dt);
      updateYuno(dt);
      updateJurie(dt);
      updateAiSteal(dt);

      if (ball.owner && ball.mode === "held") {
        updateTouch(dt);
        ball.spin += dt * 4;
      } else if (ball.mode === "shot" && shot) {
        updateShot(dt);
      } else if (ball.mode === "pass" && pass) {
        updatePass(dt);
      } else if (ball.mode === "loose") {
        updateLoose(dt);
      }

      refreshScreen();
      syncHud();
    }

    function updateLoose(dt) {
      ball.lock = Math.max(0, ball.lock - dt);
      ball.x += ball.vx * dt;
      ball.d += ball.vd * dt;
      const f = Math.pow(0.18, dt);
      ball.vx *= f;
      ball.vd *= f;
      if (Math.abs(ball.vx) < 0.002) ball.vx = 0;
      if (Math.abs(ball.vd) < 0.002) ball.vd = 0;
      if (ball.z > 0 || ball.vz !== 0) {
        ball.vz -= 7 * dt;
        ball.z += ball.vz * dt;
        if (ball.z < 0) {
          ball.z = 0;
          ball.vz = ball.vz < -0.6 ? -ball.vz * 0.32 : 0;
        }
      }
      if (ball.vx || ball.vd) ball.spin += dt * 7;

      if (ball.x < CFG.xMin || ball.x > CFG.xMax) {
        ball.x = D.clamp(ball.x, CFG.xMin, CFG.xMax);
        ball.vx = -ball.vx * 0.45;
      }
      if (ball.d < CFG.dMin || ball.d > CFG.dMax) {
        ball.d = D.clamp(ball.d, CFG.dMin, CFG.dMax);
        ball.vd = -ball.vd * 0.45;
      }
      syncBallScreen();

      if (ball.lock > 0 || ball.z > 0.16) return;
      for (const k of ["me", "yuno", "jurie"]) {
        if (k === "me" ? stumbleT > 0 : (k === "yuno" ? yunoStun : jurieStun) > 0) continue;
        const a = A[k];
        if (distPx(a.sx, a.sy, ball.sx, ball.sy) <= CFG.pickup) {
          giveBall(k);
          if (k === "me") bark("me", "拿到了。", 800);
          break;
        }
      }
    }

    // ---------------------------------------------------------------- 界面

    function syncHud() {
      // 自检的固定步进不碰 DOM（20 个种子要在同一个页面上秒级跑完）
      if (simMode) return;
      const key = scoreMe + "_" + scoreThem;
      if (key !== boardKey && el.board) {
        boardKey = key;
        el.board.src = "../assets/minigame/scoreboard_" + key + ".png";
        el.board.alt = "比分 " + scoreMe + " 比 " + scoreThem;
      }

      let t;
      if (state === "goalPause") t = "球进了。";
      else if (state !== "play") t = "歇一会儿";
      else if (duel) {
        t = duel.guard === "up"
          ? "抢断圈：她护住上面 · W 打上 / S 打下"
          : "抢断圈：她护住下面 · W 打上 / S 打下";
      } else if (charging) {
        const inMouth = aimX > CFG.goalX[0] && aimX < CFG.goalX[1];
        const underBar = aimZ <= CFG.goalHeight;
        t = (inMouth && underBar)
          ? "A/D 角度　W/S 高低　松手射门"
          : (underBar ? "偏出门柱了 · 把角度拨回来" : "高了 · 往下压一点");
      } else if (aiSteal) {
        t = (aiSteal.who === "yuno" ? "由乃" : "朱里") + "伸脚了 · 跑开或把球踢出去";
      } else if (ball.owner === "me") {
        t = "WASD 带球　Shift 拨球　按住空格蓄力射门";
      } else if (ball.owner) {
        t = "靠近持球的人，按 E 抢断";
      } else if (ball.mode === "loose") {
        t = "球滚开了，去抢";
      } else {
        t = "看球路";
      }
      if (t !== tipText) { tipText = t; el.tip.textContent = t; }

      const label = duel
        ? "W / S<br>选方向"
        : ball.owner === "me"
          ? (charging ? "松手<br>射门" : "按住蓄力<br>射门")
          : "点一下<br>抢断";
      if (label !== actText) { actText = label; el.act.innerHTML = label; }
    }

    // ---------------------------------------------------------------- 绘制

    function groundBand(ctx, d0, d1, color) {
      ctx.beginPath();
      ctx.moveTo(sxAt(0, d0), syAt(d0));
      ctx.lineTo(sxAt(1, d0), syAt(d0));
      ctx.lineTo(sxAt(1, d1), syAt(d1));
      ctx.lineTo(sxAt(0, d1), syAt(d1));
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }

    function fieldPath(ctx) {
      ctx.beginPath();
      ctx.moveTo(sxAt(0, 0), syAt(0));
      ctx.lineTo(sxAt(1, 0), syAt(0));
      ctx.lineTo(sxAt(1, 1), syAt(1));
      ctx.lineTo(sxAt(0, 1), syAt(1));
      ctx.closePath();
    }

    function line(ctx, x0, d0, x1, d1) {
      ctx.moveTo(sxAt(x0, d0), syAt(d0));
      ctx.lineTo(sxAt(x1, d1), syAt(d1));
    }

    function drawGround(ctx) {
      // 场地外的水泥地
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#1d1f24");
      g.addColorStop(1, "#282a2e");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // 远处那面教学楼：只画到远门线后面，别抢球场的戏
      ctx.fillStyle = "#171920";
      ctx.fillRect(0, 0, W, 52);
      ctx.fillStyle = "#1f222b";
      ctx.fillRect(0, 48, W, 4);
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 14; c++) {
          const lit = ((r * 14 + c) % 5 === 1);
          ctx.fillStyle = lit ? "rgba(255,212,151,.20)" : "rgba(120,130,150,.10)";
          ctx.fillRect(14 + c * 35, 8 + r * 13, 9, 7);
        }
      }

      // 有纵深的球场：越远越窄
      fieldPath(ctx);
      ctx.fillStyle = "#2d3534";
      ctx.fill();
      ctx.save();
      ctx.clip();
      for (let d = 0; d < 1; d += 0.125) {
        groundBand(ctx, d, d + 0.0625, "#303836");
        groundBand(ctx, d + 0.0625, d + 0.125, "#2b3331");
      }
      // 一点水泥地的颗粒感：位置固定，不会每帧闪
      ctx.fillStyle = "rgba(255,255,255,.035)";
      for (let i = 0; i < 90; i++) {
        const px = (i * 97 + 31) % W;
        const py = 70 + ((i * 53 + 17) % 200);
        ctx.fillRect(px, py, 1, 1);
      }
      ctx.restore();

      // 白粉笔线
      ctx.strokeStyle = "rgba(235,231,214,.42)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      line(ctx, 0, 0, 1, 0);
      line(ctx, 0, 1, 1, 1);
      line(ctx, 0, 0, 0, 1);
      line(ctx, 1, 0, 1, 1);
      line(ctx, 0, 0.5, 1, 0.5);
      // 中圈
      const cxs = sxAt(0.5, 0.5);
      const cys = syAt(0.5);
      const rx = widthAt(0.5) * 0.155;
      const ry = (CFG.nearY - CFG.farY) * 0.155;
      ctx.moveTo(cxs + rx, cys);
      for (let i = 1; i <= 24; i++) {
        const ang = i / 24 * TAU;
        ctx.lineTo(cxs + Math.cos(ang) * rx, cys + Math.sin(ang) * ry);
      }
      // 两边的禁区与门前区
      line(ctx, 0.22, 0.80, 0.78, 0.80);
      line(ctx, 0.22, 0.80, 0.22, 1);
      line(ctx, 0.78, 0.80, 0.78, 1);
      line(ctx, 0.33, 0.91, 0.67, 0.91);
      line(ctx, 0.33, 0.91, 0.33, 1);
      line(ctx, 0.67, 0.91, 0.67, 1);
      line(ctx, 0.22, 0.20, 0.78, 0.20);
      line(ctx, 0.22, 0.20, 0.22, 0);
      line(ctx, 0.78, 0.20, 0.78, 0);
      line(ctx, 0.33, 0.09, 0.67, 0.09);
      line(ctx, 0.33, 0.09, 0.33, 0);
      line(ctx, 0.67, 0.09, 0.67, 0);
      ctx.stroke();

      // 点球点
      ctx.fillStyle = "rgba(235,231,214,.36)";
      ctx.beginPath();
      ctx.ellipse(sxAt(0.5, 0.86), syAt(0.86), 2.4, 1.2, 0, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(sxAt(0.5, 0.14), syAt(0.14), 2.4, 1.2, 0, 0, TAU);
      ctx.fill();
    }

    function drawGoal(ctx, d) {
      const mouth = CFG.goalX;
      const y = syAt(d);
      const L = sxAt(mouth[0], d);
      const R = sxAt(mouth[1], d);
      const h = GOAL_H * scaleAt(d);
      const top = y - h;
      const dir = d > 0.5 ? -1 : 1;
      const netDepth = h * 0.30;

      // 门线外侧再铺一小截网底，让球门看起来有厚度
      ctx.save();
      ctx.fillStyle = "rgba(12,14,18,.38)";
      ctx.beginPath();
      ctx.moveTo(L, y);
      ctx.lineTo(L - h * 0.08, y + dir * netDepth);
      ctx.lineTo(R + h * 0.08, y + dir * netDepth);
      ctx.lineTo(R, y);
      ctx.closePath();
      ctx.fill();

      // 正面网面：门柱之间、横梁以下
      ctx.fillStyle = "rgba(10,12,16,.34)";
      ctx.fillRect(L, top, R - L, h);
      ctx.strokeStyle = "rgba(225,220,205,.24)";
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (let i = 1; i < 8; i++) {
        const px = lerp(L, R, i / 8);
        ctx.moveTo(px, top);
        ctx.lineTo(px, y);
      }
      for (let i = 1; i < 4; i++) {
        const py = lerp(top, y, i / 4);
        ctx.moveTo(L, py);
        ctx.lineTo(R, py);
      }
      ctx.stroke();
      ctx.restore();

      // 门框：两根立柱 + 横梁
      ctx.strokeStyle = "#ded8c8";
      ctx.lineWidth = Math.max(1.2, 2.2 * scaleAt(d));
      ctx.beginPath();
      ctx.moveTo(L, y);
      ctx.lineTo(L, top);
      ctx.lineTo(R, top);
      ctx.lineTo(R, y);
      ctx.stroke();
    }

    function drawAimPath(ctx) {
      if (!charging) return;
      const a = A.me;
      ctx.save();
      ctx.strokeStyle = "rgba(255,212,151,.55)";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const p = arcPoint(a.x, a.d, aimX, 1, aimZ, t);
        const px = sxAt(p.x, p.d);
        const py = syAt(p.d) - liftAt(p.z, p.d);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
    }

    function drawAimReticle(ctx) {
      if (!charging) return;
      const px = sxAt(aimX, 1);
      const py = syAt(1) - liftAt(aimZ, 1);
      const inMouth = aimX > CFG.goalX[0] && aimX < CFG.goalX[1];
      const underBar = aimZ <= CFG.goalHeight;
      const good = inMouth && underBar;
      ctx.save();
      ctx.strokeStyle = good ? "#9ed6a8" : "#e0917f";
      ctx.fillStyle = good ? "#9ed6a8" : "#e0917f";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(px, py, 7, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px - 11, py); ctx.lineTo(px - 4, py);
      ctx.moveTo(px + 4, py); ctx.lineTo(px + 11, py);
      ctx.moveTo(px, py - 11); ctx.lineTo(px, py - 4);
      ctx.moveTo(px, py + 4); ctx.lineTo(px, py + 11);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px, py, 1.5, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.85;
      ctx.font = '8px "Microsoft YaHei",sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(good ? "射这里" : (underBar ? "偏了" : "高了"), px, py - 13);
      ctx.restore();
    }

    function drawAimAngle(ctx) {
      if (!charging) return;
      const a = A.me;
      const cx = a.sx, cy = a.sy - 6;
      const r = 26;
      const up = -Math.PI / 2;
      ctx.save();
      ctx.strokeStyle = "rgba(255,212,151,.5)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.arc(cx, cy, r, up, up + aimAng, aimAng < 0);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.sin(aimAng) * r, cy - Math.cos(aimAng) * r);
      ctx.stroke();
      const deg = Math.round(aimAng * 180 / Math.PI);
      const mid = up + aimAng / 2;
      ctx.fillStyle = "rgba(255,212,151,.9)";
      ctx.font = '8px "Microsoft YaHei",sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText((deg > 0 ? "+" : "") + deg + "°",
        cx + Math.sin(mid) * (r + 10), cy - Math.cos(mid) * (r + 10));
      ctx.restore();
    }

    function drawBall(ctx) {
      // §6.3 球不再画在固定脚边：直接按球的真实位置画，触球滞后和趟球都看得见
      const sc = scaleAt(ball.d);
      const px = ball.sx;
      const py = ball.sy;
      const z = ball.z;

      // 影子永远留在地上
      ctx.save();
      ctx.globalAlpha = 0.30;
      ctx.fillStyle = "#171b20";
      ctx.beginPath();
      ctx.ellipse(Math.round(ball.sx), Math.round(ball.sy) + 1, 4.4 * sc, 1.8 * sc, 0, 0, TAU);
      ctx.fill();
      ctx.restore();

      const drawY = py - liftAt(z, ball.d);
      const size = 15 * sc;
      if (D.img.ballSheet) {
        const f = Math.floor(ball.spin) % 4;
        ctx.drawImage(D.img.ballSheet, f * 16, 0, 16, 16,
          px - size / 2, drawY - size / 2, size, size);
      } else {
        ctx.save();
        ctx.fillStyle = "#20252b";
        ctx.beginPath(); ctx.arc(px, drawY, size * 0.38, 0, TAU); ctx.fill();
        ctx.fillStyle = "#f3f0e5";
        ctx.beginPath(); ctx.arc(px, drawY, size * 0.30, 0, TAU); ctx.fill();
        ctx.restore();
      }
    }

    function drawTrail(ctx) {
      if (!trail.length) return;
      ctx.save();
      for (const q of trail) {
        ctx.globalAlpha = 0.22 * q.life;
        ctx.fillStyle = "#f3f0e5";
        ctx.beginPath();
        ctx.arc(q.x, q.y, 2.2 * q.life + 0.8, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    function drawPower(ctx) {
      if (!charging) return;
      const a = A.me;
      const px = D.clamp(a.sx, 58, W - 58);
      const py = a.sy + 12;
      const w = 88, h = 7;
      const x = px - w / 2;
      ctx.save();
      ctx.fillStyle = "rgba(20,16,22,.82)";
      ctx.fillRect(x - 3, py - 3, w + 6, h + 6);
      ctx.fillStyle = "#4a3d48";
      ctx.fillRect(x, py, w, h);
      ctx.fillStyle = power < CFG.shotMin ? "#e0917f" : "#ffd497";
      ctx.fillRect(x, py, Math.round(power * w), h);
      ctx.font = '8px "Microsoft YaHei",sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#e2d0b8";
      ctx.fillText("A/D 角度 · W/S 高低", px, py + h + 4);
      ctx.restore();
    }

    function drawFeint(ctx) {
      if (feintT <= 0 || ball.owner !== "yuno") return;
      const a = A.yuno;
      const py = a.sy - 70 * a.scale;
      ctx.save();
      ctx.globalAlpha = 0.65 + 0.35 * Math.sin(clock * 30);
      ctx.fillStyle = "#ffd497";
      ctx.beginPath();
      ctx.moveTo(a.sx, py - 5); ctx.lineTo(a.sx + 5, py);
      ctx.lineTo(a.sx, py + 5); ctx.lineTo(a.sx - 5, py);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = "#ffd497";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.ellipse(a.sx, a.sy - 2, 20 * a.scale, 6 * a.scale, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    function drawAiSteal(ctx) {
      if (!aiSteal) return;
      const a = A[aiSteal.who];
      const k = D.clamp(aiSteal.t / CFG.aiStealWindup, 0, 1);
      const py = a.sy - 76 * a.scale;
      ctx.save();
      // 收拢的圈就是抬手的倒计时：圈合上那一下球就没了
      ctx.globalAlpha = 0.55 + 0.45 * k;
      ctx.strokeStyle = "#ffd497";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(a.sx, py, 13 - 8 * k, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#ffd497";
      ctx.font = 'bold 8px "Microsoft YaHei",sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("伸脚", a.sx, py - 15);
      ctx.restore();
    }

    function drawWindup(ctx) {
      if (!windup) return;
      const a = A[windup.who];
      const py = a.sy - 74 * a.scale;
      ctx.save();
      ctx.fillStyle = "rgba(20,16,22,.82)";
      ctx.fillRect(a.sx - 5, py - 9, 10, 15);
      ctx.strokeStyle = "#ffd497";
      ctx.lineWidth = 1;
      ctx.strokeRect(a.sx - 4.5, py - 8.5, 9, 14);
      ctx.fillStyle = "#ffd497";
      ctx.font = 'bold 10px "Microsoft YaHei",sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("!", a.sx, py - 1);
      ctx.restore();
    }

    function drawStumble(ctx) {
      if (stumbleT <= 0) return;
      const a = A.me;
      const py = a.sy - 74 * a.scale;
      const k = D.clamp(stumbleT / CFG.stumble, 0, 1);
      ctx.save();
      for (let i = 0; i < 3; i++) {
        const ang = clock * 7 + i * TAU / 3;
        const sx = a.sx + Math.cos(ang) * 14;
        const sy = py + Math.sin(ang) * 5;
        ctx.fillStyle = "#e0917f";
        ctx.fillRect(Math.round(sx) - 1, Math.round(sy) - 1, 2, 2);
      }
      ctx.strokeStyle = "rgba(224,145,127,.85)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(a.sx, py, 9, -Math.PI / 2, -Math.PI / 2 + TAU * k);
      ctx.stroke();
      ctx.restore();
    }

    function drawGoalFx(ctx) {
      if (state !== "goalPause") return;
      const d = goalSide === "me" ? 1 : 0;
      const px = sxAt(0.5, d);
      const py = syAt(d) - GOAL_H * scaleAt(d) * 0.5;
      ctx.save();
      for (let i = 0; i < 3; i++) {
        const k = D.clamp(goalFxT * 2.4 - i * 0.9, 0, 1);
        if (k <= 0) continue;
        ctx.globalAlpha = (1 - k) * 0.75;
        ctx.strokeStyle = "#ffd497";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 8 + k * 42, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawBubbles(ctx) {
      ctx.save();
      ctx.font = '10px "Microsoft YaHei",sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const b of bubbles) {
        const a = A[b.who];
        if (!a) continue;
        const w = Math.ceil(ctx.measureText(b.text).width) + 14;
        const x = D.clamp(a.sx - w / 2, 4, W - w - 4);
        const y = a.sy - 72 * a.scale - 20 + Math.sin(clock * 4) * 1;
        const fade = Math.min(1, (b.dur - b.t) * 5);
        ctx.globalAlpha = 0.94 * fade;
        ctx.fillStyle = "#241f2c";
        ctx.fillRect(x, y, w, 17);
        ctx.strokeStyle = "#d8b58d";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 16);
        ctx.fillStyle = "#241f2c";
        ctx.beginPath();
        ctx.moveTo(a.sx - 4, y + 17); ctx.lineTo(a.sx + 4, y + 17);
        ctx.lineTo(a.sx, y + 21);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#fff0dc";
        ctx.fillText(b.text, x + w / 2, y + 9);
      }
      ctx.restore();
    }

    function drawDuel(ctx) {
      if (!duel) return;
      const a = A[duel.who];
      const cx = a.sx;
      const cy = a.sy - 30 * a.scale;
      const r = 31 * a.scale;
      const upGuard = duel.guard === "up";
      const guardColor = "#e0917f";
      const openColor = "#9ed6a8";

      ctx.save();
      ctx.globalAlpha = 0.30;
      ctx.fillStyle = "#141018";
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.6, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.lineWidth = 3;
      ctx.strokeStyle = upGuard ? guardColor : openColor;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.6, 0, Math.PI, TAU);
      ctx.stroke();
      ctx.strokeStyle = upGuard ? openColor : guardColor;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.6, 0, 0, Math.PI);
      ctx.stroke();

      // 读条：圈收完之前要选
      ctx.strokeStyle = "rgba(255,212,151,.82)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 5, -Math.PI / 2,
        -Math.PI / 2 + TAU * (1 - duel.t / duel.dur));
      ctx.stroke();

      // 方向标签放到圈外，别被两个人的身体盖住
      ctx.font = 'bold 9px "Microsoft YaHei",sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const topY = cy - r * 0.6 - 11;
      const botY = cy + r * 0.6 + 11;
      const topText = "W · 上";
      const botText = "S · 下";
      for (const item of [
        { y: topY, text: topText, color: upGuard ? guardColor : openColor },
        { y: botY, text: botText, color: upGuard ? openColor : guardColor }
      ]) {
        const w = ctx.measureText(item.text).width + 8;
        ctx.fillStyle = "rgba(20,16,22,.88)";
        ctx.fillRect(cx - w / 2, item.y - 5.5, w, 11);
        ctx.fillStyle = item.color;
        ctx.fillText(item.text, cx, item.y + 0.5);
      }

      // 护住的那一边放一颗小盾
      const gy = cy + (upGuard ? -r * 0.36 : r * 0.36);
      ctx.fillStyle = guardColor;
      ctx.beginPath();
      ctx.moveTo(cx, gy - 4);
      ctx.lineTo(cx + 4, gy);
      ctx.lineTo(cx, gy + 4);
      ctx.lineTo(cx - 4, gy);
      ctx.closePath();
      ctx.fill();

      if (duel.flash > 0) {
        ctx.globalAlpha = duel.flash / 0.22;
        ctx.strokeStyle = "#fff0c8";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r + 2, r * 0.6 + 2, 0, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }

    /** §6.5 蓄力时把散布画成判定门前的半透明扇形：
     *  力度越大、离门越远、身边有人，扇面越宽——风险必须看得见，不做无预告的打偏。 */
    function drawSpreadFan(ctx) {
      if (!charging || !(spreadScale > 0)) return;
      const sigma = shotSpread(power);
      if (!(sigma > 0)) return;
      const half = sigma * widthAt(1);          // 门线处的横向半宽（px）
      const px = sxAt(aimX, 1);
      const py = syAt(1) - liftAt(aimZ, 1);
      const me = A.me;
      ctx.save();
      ctx.globalAlpha = 0.13;
      ctx.fillStyle = "#ffd497";
      ctx.beginPath();
      ctx.moveTo(me.sx, me.sy - 6);
      ctx.lineTo(px - half, py);
      ctx.lineTo(px + half, py);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.38;
      ctx.strokeStyle = "#ffd497";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(px - half, py);
      ctx.lineTo(px + half, py);
      ctx.stroke();
      ctx.restore();
    }

    function draw(ctx) {
      drawGround(ctx);
      drawGoal(ctx, 1);
      drawGoal(ctx, 0);
      drawAimPath(ctx);
      drawSpreadFan(ctx);

      // 远的先画，近的后画：俯视场里近处的人要压住远处的人。
      // 玩家永远最后画——1 对 2 时两个人会贴到身上，按纵深排会把玩家整个人盖住。
      const order = ["yuno", "jurie"].sort(function (p, q) {
        return A[q].d - A[p].d;
      });
      order.push("me");
      for (const k of order) {
        const a = A[k];
        const shake = k === "me" && stumbleT > 0 ? Math.sin(clock * 42) * 2 : 0;
        D.shadow(ctx, a.sx + shake, a.sy + 1, 46 * a.scale);
      }
      for (const k of order) {
        const a = A[k];
        const shake = k === "me" && stumbleT > 0 ? Math.sin(clock * 42) * 2 : 0;
        const tmp = {
          key: a.key, x: a.sx + shake, y: a.sy, dir: a.dir, face: a.face,
          moving: a.moving, phase: a.phase, scale: a.scale, alpha: a.alpha
        };
        D.drawActor(ctx, tmp, clock);
      }

      drawBall(ctx);
      drawTrail(ctx);
      drawDuel(ctx);
      drawFeint(ctx);
      drawAiSteal(ctx);
      drawWindup(ctx);
      drawStumble(ctx);
      drawAimAngle(ctx);
      drawAimReticle(ctx);
      drawPower(ctx);
      drawGoalFx(ctx);
      drawBubbles(ctx);
    }

    // ---------------------------------------------------------------- 自检入口
    // 无渲染、固定步进、按种子重跑：只给 act5/tools/check.cjs 用。
    // 每次开一个独立实例，正在正常对战的 current 实例不受影响；
    // 正常游玩仍然走 shell 的 rAF → update()/draw()。

    function simResetMatch(seed) {
      rnd = makeRnd(seed >>> 0);
      keeperErrDir = rnd() * 2 - 1;
      state = "play";
      frozen = false;
      clock = 0;
      scoreMe = 0;
      scoreThem = 0;
      goalPause = 0;
      goalFxT = 0;
      goalSide = null;
      lastGoalSide = null;
      shot = null;
      pass = null;
      windup = null;
      feintT = 0;
      feintTimer = 0;
      yunoFeinted = false;
      stumbleT = 0;
      duel = null;
      yunoStun = 0;
      jurieStun = 0;
      tackleCd = 0;
      yunoTackleCd = 0;
      jurieTackleCd = 0;
      yunoHold = 0;
      yunoPassCd = 0;
      jurieActionCd = 0;
      charging = false;
      armed = true;
      chargeT = 0;
      power = 0.3;
      aimAng = 0;
      aimX = 0.5;
      aimZ = CFG.aimZ0;
      aiSteal = null;
      trail = [];
      bubbles = [];
      calls = 0;
      hudPulse = 0;
      dashT = 0;
      dashCd = 0;
      shiftLatch = false;
      slipCd = 0;
      ballOffFoot = 0;
      turnLog = [];
      lastShot = null;
      roles = { press: "yuno", cover: "jurie", want: "yuno", timer: 0 };
      keeperOn = false;
      keeperLunge = null;
      keeperAimLog = [];
      meVel = { x: 0, d: 0 };
      stats = {
        tackles: 0, stumbles: 0, steals: 0, shots: 0,
        goalsFor: 0, goalsAgainst: 0, passes: 0,
        feints: 0, airKicks: 0, saves: 0, duelFails: 0, posts: 0, turnSlips: 0, aiWindups: 0
      };
    }

    function simBegin(seed, opts) {
      simMode = true;
      const o = opts || {};
      spreadScale = o.spreadScale == null ? 1 : o.spreadScale;
      simResetMatch(seed == null ? 20261108 : seed);
      kickoff(o.kick === "yuno" ? "yuno" : "me");
      return true;
    }

    function simStep(dt, keys) {
      simKeys = keys || {};
      update(dt == null ? 1 / 60 : dt);
    }

    function simEnd() {
      simMode = false;
      simKeys = null;
      spreadScale = 1;
    }

    function simLanding(x, z, powerLevel) {
      const l = spreadLanding(x, z, powerLevel);
      return { x: l.x, z: l.z };
    }

    function simSigma(powerLevel, meD, pressured) {
      return spreadSigma(powerLevel, meD == null ? A.me.d : meD, !!pressured);
    }

    /** 自检专用：改比分看 §6.6 的隐性参数（正常游玩不经过）。 */
    function simSetScore(me, them) {
      scoreMe = me | 0;
      scoreThem = them | 0;
    }

    function simProbeArgs() {
      return {
        pressLead: pressLeadNow(),
        keeperErr: keeperErrNow(),
        coverBias: coverBiasNow("jurie"),
        keeperLine: CFG.keeperLine,
        keeperReach: CFG.keeperReach,
        goalsToWin: CFG.goalsToWin
      };
    }

    function simSnap() {
      const pos = function (k) {
        const a = A[k];
        return { x: a.x, d: a.d, sx: a.sx, sy: a.sy, face: a.face, moving: a.moving };
      };
      return {
        state: state, clock: clock, holder: ball.owner, mode: ball.mode,
        me: pos("me"), yuno: pos("yuno"), jurie: pos("jurie"),
        ball: { x: ball.x, d: ball.d, z: ball.z, sx: ball.sx, sy: ball.sy },
        charging: charging, chargeT: chargeT, power: power,
        aimX: aimX, aimZ: aimZ, aimAng: aimAng,
        keeper: keeperInfo(),
        roles: { press: roles.press, cover: roles.cover, want: roles.want },
        ballOffFoot: ballOffFoot,
        dash: { t: dashT, cd: dashCd },
        lastShot: lastShot ? Object.assign({}, lastShot) : null,
        lastGoalSide: lastGoalSide,
        scoreMe: scoreMe, scoreThem: scoreThem,
        stats: Object.assign({}, stats)
      };
    }

    // ---------------------------------------------------------------- 收尾

    async function finish(win) {
      // 自检的固定步进不写存档、不弹对白；正常对战这条分支不会进
      if (simMode) { state = "done"; return; }
      state = "rest";
      D.reactHint(false);
      D.clearReact();
      D.hint(null);
      D.objective(null);
      bubbles = [];
      charging = false;
      el.ctl.hidden = true;
      el.tip.textContent = "歇一会儿";
      // 球停在中间，谁也不去捡
      ball.owner = null;
      ball.mode = "loose";
      ball.vx = 0; ball.vd = 0; ball.vz = 0;
      ball.x = 0.5;
      ball.d = 0.5;
      ball.z = 0;
      ball.lock = 5;
      shot = null;
      pass = null;
      windup = null;
      aiSteal = null;
      duel = null;
      for (const k of ["me", "yuno", "jurie"]) A[k].moving = false;
      refreshScreen();

      const lines = [
        ["旁白", "球停在中间，谁也没去捡。"],
        ["由乃", "行了，歇会儿。"]
      ];
      if (win) {
        lines.push(
          ["朱里", "我好像有一脚踢空了。"],
          ["我", "有一脚差点踢到车棚。"],
          ["由乃", "风大。"],
          ["我", "……嗯。"]
        );
      } else {
        lines.push(
          ["朱里", "……我都没怎么碰到球。"],
          ["我", "跑不动了。"],
          ["由乃", "风大。"],
          ["我", "……嗯。"]
        );
      }
      lines.push(
        ["旁白", "三个人在台阶上坐了一会儿。上课铃还没响，也没人提刚才谁进了几个。"]
      );

      await D.lines(lines);

      state = "done";
      // 只记“踢完了”；比分不进存档，也不进结果卡
      D.persist({ ballGameCompleted: true });
      host.done({
        id: "ball_match",
        completed: true,
        events: ["ball:finished", win ? "ball:won" : "ball:lost"],
        playerActions: ["tackles:" + stats.tackles, "stumbles:" + stats.stumbles]
      });
    }

    // ---------------------------------------------------------------- 生命周期

    async function start() {
      D.clearReact();
      D.onPoke(callOut);
      host.setChapter("楼前空地 · 放学后");
      D.hint(null);
      D.objective("在楼前踢一会儿", "先进三个球 · 往远处那门打");
      el.hud.classList.add("show");
      el.ctl.hidden = false;
      el.act.onpointerdown = function (e) {
        e.preventDefault();
        D.audio.unlock();
        if (ball.owner === "me") touchHeld = true;
        else playerTackle();
      };
      el.act.onpointerup = function () { touchHeld = false; };
      el.act.onpointercancel = function () { touchHeld = false; };
      canvas.addEventListener("pointerdown", onCanvasDown);
      refreshScreen();
      syncHud();

      await D.fadeTo(0, 420);
      await D.sleep(200);

      await D.lines([
        ["旁白", "下周一，放学后。楼前那块空地还没什么人。"],
        ["旁白", "地上用粉笔画了边线，两个球门一近一远。"],
        ["由乃", "踢会儿？一人一边，先进三个。"],
        ["朱里", "……我们两个人一边？"],
        ["由乃", "他一个人。公平吧。"],
        ["我", "哪儿公平了。"],
        ["由乃", "你想赢就多跑两步。"],
        ["旁白", "球是旧的，气不太足，滚得慢。"]
      ]);

      state = "play";
      D.reactHint("F · 喊一声");
      kickoff("yuno");
      syncHud();
    }

    function press(key) {
      if (state !== "play" || D.dialogOpen()) return;
      const k = key.toLowerCase();
      if (duel) {
        if (k === "w" || key === "ArrowUp") resolveDuel("up");
        else if (k === "s" || key === "ArrowDown") resolveDuel("down");
        return;
      }
      if (k === "e" || key === "Enter") playerTackle();
    }

    // 触屏也能玩抢断圈：点人的上半边是 W，下半边是 S
    const canvas = document.getElementById("scene");
    function onCanvasDown(e) {
      if (!duel) return;
      const rect = canvas.getBoundingClientRect();
      const y = (e.clientY - rect.top) / rect.height * H;
      const a = A[duel.who];
      resolveDuel(y < a.sy - 26 * a.scale ? "up" : "down");
    }

    return {
      id: "ball_match",
      title: "体育活动",
      start: start,
      update: update,
      draw: draw,
      press: press,
      setFrozen: function (v) { frozen = !!v; },
      dispose: function () {
        D.onPoke(null);
        D.reactHint(false);
        D.clearReact();
        D.hint(null);
        D.objective(null);
        el.hud.classList.remove("show");
        el.hud.classList.remove("pulse");
        el.ctl.hidden = true;
        canvas.removeEventListener("pointerdown", onCanvasDown);
        touchHeld = false;
        charging = false;
        aiSteal = null;
        duel = null;
      },
      get state() { return state; },
      get holder() { return ball.owner; },
      get mode() { return ball.mode; },
      get ball() {
        return { x: ball.x, d: ball.d, z: ball.z, sx: ball.sx, sy: ball.sy };
      },
      get actors() { return A; },
      get scoreMe() { return scoreMe; },
      get scoreThem() { return scoreThem; },
      get feint() { return feintT > 0; },
      get stumbleT() { return stumbleT; },
      get charging() { return charging; },
      get chargeT() { return chargeT; },
      get power() { return power; },
      get aimAng() { return aimAng; },
      get aimX() { return aimX; },
      get aimZ() { return aimZ; },
      get aiSteal() { return aiSteal ? { who: aiSteal.who, t: aiSteal.t } : null; },
      get windup() { return windup ? windup.who : null; },
      get duel() { return !!duel; },
      get duelGuard() { return duel ? duel.guard : null; },
      get duelT() { return duel ? duel.t : 0; },
      get calls() { return calls; },
      get stats() { return stats; },
      get config() { return CFG; },
      get roles() { return { press: roles.press, cover: roles.cover, want: roles.want }; },
      get keeper() { return keeperInfo(); },
      get ballOffFoot() { return ballOffFoot; },
      get dash() { return { t: dashT, cd: dashCd }; },
      get lastShot() { return lastShot ? Object.assign({}, lastShot) : null; },
      // 自检专用：确定性固定步进（只有 act5/tools/check.cjs 会调，正常游玩不经过）
      __simBegin: simBegin,
      __simStep: simStep,
      __simSnap: simSnap,
      __simEnd: simEnd,
      __simLanding: simLanding,
      // 一条龙自检的变体路线需要复刻真实玩法里的「按 E 起抢断圈、打她没护住的一边」，
      // 否则开局就被上抢断掉，永远走不到射门那一步。
      __simTackle: playerTackle,
      __simDuel: resolveDuel,
      __simSetSpread: function (v) { spreadScale = v == null ? 1 : v; },
      __simSigma: simSigma,
      __simScore: simSetScore,
      __simProbe: simProbeArgs,
      get winner() {
        return state === "rest" || state === "done"
          ? (scoreMe > scoreThem ? "me" : "them")
          : null;
      }
    };
  };
  // ---------------------------------------------------------------- 自检入口
  // 只创建独立实例、只做无渲染固定步进：不画、不读 DOM、不弹对白、不碰存档。
  // 正常游玩仍是 D.games.ball(host) 交给 shell 的 rAF 去 update()/draw()。
  const SIM_HOST = { setBackground: function () {}, setChapter: function () {}, done: function () {} };
  const SIM_DT = 1 / 60;

  function makeSim(seed, opts) {
    const g = D.games.ball(SIM_HOST);
    g.__simBegin(seed, opts);
    return g;
  }

  /** 「开球后带球 + 射门」的一条龙路线：AI 由种子驱动，玩家侧用脚本输入。
   *  variant: "straight"（默认，中路满力，开球后一次持球直冲——测的是「电脑上抢能堵死一条龙」）
   *         | "corner-left" / "corner-right"（打死角）| "high"（高球，越过守门员扑救高度）。
   *  变体路线会像真实玩家一样，被断走后追上去按 E 起抢断圈、打对手没护住的一边抢回来，
   *  再用抢断后的 2.2 / 2.4 秒反抢保护窗口站定蓄力——否则永远走不到起脚那一步。
   *  返回这一脚的结果（goal / save / block / post / miss / high / lost / timeout）。 */
  function simRoute(seed, variant) {
    const mode = variant || "straight";
    const g = makeSim(seed, { spreadScale: 1, kick: "me" });
    const out = {
      seed: seed, mode: mode, result: "timeout", goal: false, steps: 0,
      keeperSeen: false, keeperAt: null, landing: null, aim: null,
      power: null, shotAtD: null, meD: 0, stats: null
    };
    const aimTargetX = mode === "corner-left" ? 0.37 : mode === "corner-right" ? 0.63 : null;
    const aimTargetZ = mode === "high" ? 0.56 : null;
    // 直线路线沿用原来的 0.82；变体按 playall 通关机器人的 0.84 起脚。
    // 起脚后不再等满力：死角 / 高球要花时间拨角度，等满力反而给上抢多留了时间。
    const chargeD = mode === "straight" ? 0.82 : 0.84;
    let t = 0;
    let phase = "dribble";
    while (t < 8) {
      const s = g.__simSnap();
      if (s.keeper && s.keeper.active) {
        out.keeperSeen = true;
        if (out.keeperAt == null) out.keeperAt = { d: s.me.d, who: s.keeper.who };
      }
      if (s.state === "goalPause") {
        out.result = s.lastGoalSide === "me" ? "goal" : "conceded";
        out.meD = s.me.d;
        break;
      }
      if (s.state !== "play") { out.result = "state:" + s.state; break; }
      if (s.lastShot && s.lastShot.from === "me") {
        out.landing = { x: s.lastShot.x1, z: s.lastShot.z1 };
        out.aim = s.lastShot.aim ? { x: s.lastShot.aim.x, z: s.lastShot.aim.z } : null;
        out.power = s.lastShot.power;
        if (out.shotAtD == null) out.shotAtD = s.lastShot.d0;
        if (s.lastShot.by) out.by = s.lastShot.by;
      }
      if (phase === "flight") {
        if (s.lastShot && s.lastShot.result !== "flying") {
          out.result = s.lastShot.result;
          break;
        }
        g.__simStep(SIM_DT, {});
      } else if (s.holder !== "me") {
        if (mode === "straight") { out.result = "lost"; break; }
        // 变体路线：被断走后先抢回来（真实玩法就是按 E 起抢断圈、打她没护住的一边）。
        // 抢回来的一瞬间有 2.2 / 2.4 秒反抢保护，那才是能站定蓄力的窗口；
        // 只靠开球那一次持球，永远走不到 0.84 起脚。
        if (g.duel) {
          g.__simDuel(g.duelGuard === "up" ? "down" : "up");
          g.__simStep(SIM_DT, {});
        } else {
          const tgt = s.holder === "yuno" ? s.yuno : s.holder === "jurie" ? s.jurie : s.ball;
          const keys = {};
          if (tgt.x < s.me.x - 0.008) keys.left = true;
          else if (tgt.x > s.me.x + 0.008) keys.right = true;
          if (tgt.d > s.me.d + 0.008) keys.up = true;
          else if (tgt.d < s.me.d - 0.008) keys.down = true;
          if (!(g.stumbleT > 0)) g.__simTackle();
          g.__simStep(SIM_DT, keys);
        }
      } else if (phase === "dribble") {
        if (s.me.d >= chargeD) {
          phase = "charge";
          g.__simStep(SIM_DT, {});
        } else {
          g.__simStep(SIM_DT, { up: true });
        }
      } else if (phase === "charge") {
        if (!s.charging) {
          g.__simStep(SIM_DT, { space: true });
        } else {
          const keys = { space: true };
          let aimed = true;
          if (aimTargetX != null) {
            // 起脚时对准门中间，蓄力期间用 A/D 把落点拨到死角
            if (s.aimX > aimTargetX + 0.004) { keys.left = true; aimed = false; }
            else if (s.aimX < aimTargetX - 0.004) { keys.right = true; aimed = false; }
          }
          if (aimTargetZ != null) {
            // 高球是设计上的正解（守门员只扑 z < 0.50 的低球）；代价是从 aimZ 0.16
            // 拨到 0.54 要站定约 0.9 秒，上抢和封堵都在这个窗口里。
            if (s.aimZ < aimTargetZ - 0.004) { keys.up = true; aimed = false; }
          }
          const charged = mode === "straight"
            ? s.chargeT >= CFG.chargeTime - 1e-9
            : s.power >= 0.45;
          if (charged && aimed) {
            g.__simStep(SIM_DT, { space: false });
            phase = "flight";
          } else {
            g.__simStep(SIM_DT, keys);
          }
        }
      } else {
        g.__simStep(SIM_DT, {});
      }
      t += SIM_DT;
      out.steps++;
    }
    const end = g.__simSnap();
    out.meD = end.me.d;
    out.stats = end.stats;
    out.goal = out.result === "goal";
    g.__simEnd();
    return out;
  }

  /** 守线 / 守门状态机：带球往远门走，过中线进入射程（d ≥ 0.62）时必须进 keeper 态。 */
  function simKeeper(seed) {
    const g = makeSim(seed, { spreadScale: 1, kick: "me" });
    const out = {
      seed: seed, reached: false, keeperBefore: false, keeperActive: false,
      atD: 0, keeper: null, roles: null, holder: "me", steps: 0
    };
    let t = 0;
    while (t < 6) {
      const s = g.__simSnap();
      if (s.me.d < 0.45) {
        out.keeperBefore = !!(s.keeper && s.keeper.active);
        out.roles = s.roles;
      }
      if (s.holder !== "me") { out.holder = s.holder; break; }
      if (s.me.d >= CFG.keeperTriggerD) {
        out.reached = true;
        out.atD = s.me.d;
        out.keeperActive = !!(s.keeper && s.keeper.active);
        out.keeper = s.keeper ? { who: s.keeper.who, x: s.keeper.x, d: s.keeper.d } : null;
        out.roles = s.roles;
        break;
      }
      g.__simStep(SIM_DT, { up: true });
      t += SIM_DT;
      out.steps++;
    }
    g.__simEnd();
    return out;
  }

  /** 6.3 触球系统：球不再粘脚——站住时停在朝向 0.05 的前方；跑动有滞后；
   *  急转 >100°/0.2s 会多滑 0.02（stats.turnSlips 记一笔，方便断言）。 */
  function simTouch(seed) {
    const g = makeSim(seed, { spreadScale: 1, kick: "me" });
    const out = { seed: seed, offFootStill: 0, offFootMoving: 0, ahead: false, sticky: true, turnSlips: 0 };
    // 开球保护还在的这 0.3 秒里站住：球从脚边滚到朝向 0.05 的前方
    for (let i = 0; i < 18; i++) g.__simStep(SIM_DT, {});
    const s0 = g.__simSnap();
    out.offFootStill = s0.ballOffFoot;
    out.stillAhead = s0.holder === "me" && s0.ball.d > s0.me.d;
    // 先往远处跑一小段（攒出方向），再 180° 掉头：0.2 秒内转向超过 100° 要外滑 0.02
    for (let i = 0; i < 20; i++) {
      g.__simStep(SIM_DT, { up: true });
      const s = g.__simSnap();
      if (s.holder !== "me") break;
      out.offFootMoving = Math.max(out.offFootMoving, s.ballOffFoot);
      if (s.ball.d > s.me.d) out.ahead = true;
      if (Math.abs(s.ball.d - s.me.d) > 0.004 || Math.abs(s.ball.x - s.me.x) > 0.004) {
        out.sticky = false;
      }
    }
    for (let i = 0; i < 14; i++) g.__simStep(SIM_DT, { down: true });
    out.turnSlips = g.__simSnap().stats.turnSlips;
    g.__simEnd();
    return out;
  }

  /** 6.3 Shift 拨球：球向前拨出 0.16 纵深、自己进入 0.45s 加速与 2.5s 冷却。 */
  function simDash(seed) {
    const g = makeSim(seed, { spreadScale: 1, kick: "me" });
    const out = { seed: seed, loose: false, dashT: 0, dashCd: 0, depth: 0, recovered: false };
    for (let i = 0; i < 8; i++) g.__simStep(SIM_DT, { up: true });
    const before = g.__simSnap();
    out.d0 = before.me.d;
    g.__simStep(SIM_DT, { shift: true });
    const s1 = g.__simSnap();
    out.loose = !s1.holder && s1.mode === "loose";
    out.dashT = s1.dash.t;
    out.dashCd = s1.dash.cd;
    out.depth = s1.ball.d - s1.me.d;
    for (let i = 0; i < 90; i++) {
      g.__simStep(SIM_DT, {});
      if (g.__simSnap().holder === "me") { out.recovered = true; break; }
    }
    g.__simEnd();
    return out;
  }

  /** 6.6 比分起伏：给自检改一个比分看隐性参数（正常游玩永远从 0:0 开始）。 */
  function simScore(seed, me, them) {
    const g = makeSim(seed, { spreadScale: 1, kick: "me" });
    g.__simScore(me, them);
    const p = g.__simProbe();
    g.__simEnd();
    return p;
  }

  /** 6.5 σ=0 时出手落点必须严格等于瞄准点；打开散布时才允许偏移。 */
  function simSpread(seed) {
    const g = makeSim(seed, { spreadScale: 0, kick: "me" });
    const zero = g.__simLanding(0.42, 0.31, 1.0);
    const zero2 = g.__simLanding(0.638, 0.55, 0.62);
    const sigma = {
      zero: g.__simSigma(0, 0.8, false),
      low: g.__simSigma(0.3, 0.8, false),
      high: g.__simSigma(1.0, 0.8, false),
      far: g.__simSigma(0.3, 0.2, false),
      pressed: g.__simSigma(0.3, 0.8, true)
    };
    g.__simSetSpread(1);
    let moved = false;
    let on = null;
    for (let i = 0; i < 6; i++) {
      on = g.__simLanding(0.5, 0.40, 1.0);
      if (Math.abs(on.x - 0.5) > 1e-9) { moved = true; break; }
    }
    g.__simEnd();
    return { seed: seed, zero: zero, zero2: zero2, sigma: sigma, on: on, moved: moved };
  }

  window.__ball = {
    version: 2,
    testRoute: simRoute,
    testKeeper: simKeeper,
    testTouch: simTouch,
    testDash: simDash,
    testSpread: simSpread,
    testScore: simScore,
    testSeeds: function (n, fn) {
      const out = [];
      for (let i = 1; i <= (n || 20); i++) out.push(fn(i));
      return out;
    }
  };

})(window);

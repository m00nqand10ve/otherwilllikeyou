/* G01《一起去办事》— 一个场景 + 三个站位
 *
 * 走廊这一张图，三个人各占一个站位，原地把自己那件事做完：
 *   朱里 · 布告栏：按住空格把通知推进虚线框，松手在框里就贴好；
 *   由乃 · 教室门口：三摞材料按纸上印的号拿，拿错就重来；
 *   我　 · 走廊：把箱子推到楼梯口，门槛要抬一下，推过头会滚回来。
 *
 * 三件事都没有失败态：做错只是重来，不会结束这一场。
 * 三个人都做完，才触发结尾——朱里和由乃走到箱子边，一起把箱子抬走。
 *
 * 切人用画面下方中段的换人条（Tab 也行）。亮着的人做事，另外两个继续播自己的待机动作。
 */
(function (global) {
  "use strict";

  const D = global.DAILY;
  D.games = D.games || {};

  // 一个场景。三个站位都在这张走廊图上。
  const SCENES = {
    corridor: { bg: "corridor", name: "走廊 · 课间" }
  };

  // 三个站位：朱里在大布告栏前，由乃在教室门口，我在搬箱子那一头。
  // 「我」这一站跟着推箱路线一起镜像（见下面的参数计划）。
  const STATION = { girl: 318, friend: 252, boy: 392 };

  // 朱里 · 布告栏上的虚线框。纸从手里（y=200）升到框里。
  // 框心在三个候选位上轮换（重玩随机化）；首通永远用现行值 88。
  const NOTICE = { x: 338, y0: 200, y1: 56, half: 10, rise: 1.45, cys: [88, 76, 100] };
  /** 正好落在框里的那段 hold 进度：由框心 y 反推出 t。首通仍是 ≈[0.708, 0.847]。 */
  function noticeBandFor(cy) {
    return [
      (NOTICE.y0 - (cy + NOTICE.half)) / (NOTICE.y0 - NOTICE.y1),
      (NOTICE.y0 - (cy - NOTICE.half)) / (NOTICE.y0 - NOTICE.y1)
    ];
  }

  // 由乃 · 门口三摞材料。order 是纸上印的号，从左到右。
  // 首通是现行顺序 [2,3,1]；重玩按种子洗牌，保证和上一次不一样。
  const PAPERS = { xs: [146, 174, 202], y: 246, order: [2, 3, 1] };

  // 我 · 箱子。start → 门槛 thr（要抬）→ 落点 drop → 推过头会滚回来。
  const BOX = {
    start: 418, max: 466, thr: 438, drop: [448, 460],
    speed: 46, y: 238, rollFrom: 466, rollTo: 430
  };
  // 镜像路线：从左侧楼梯口送达。整条路线按画面宽 512 - x 折过去。
  const BOX_MIRROR = {
    start: 512 - BOX.start,                    // 94
    max: 512 - BOX.max,                        // 46
    thr: 512 - BOX.thr,                        // 74
    drop: [512 - BOX.drop[1], 512 - BOX.drop[0]],   // [52, 64]
    speed: BOX.speed, y: BOX.y,
    rollFrom: 512 - BOX.rollFrom, rollTo: 512 - BOX.rollTo
  };

  // 抬起来之后还要往楼梯口走一段：慢速横移约 120px。
  // 路上一个路人从对面走来，玩家用 W / S 换一条纵深线让开；
  // 碰到只是停一下重抬，不算失败，也不记 misses。
  const WALK = {
    dist: 120, speed: 20,          // 世界坐标里的横移距离 / 速度
    laneMin: 226, laneMax: 250,    // W / S 能调的纵深线
    laneSpeed: 38,
    bumpX: 28, bumpY: 9,           // 碰到的判定框（横向 / 纵深）
    pause: 0.9,                    // 碰到之后停多久
    npcLead: 170, npcSpeed: 40,    // 路人从前方多远迎面走来
    camEase: 110                   // 镜头先让开一点，把前面让进画面
  };

  // 三个人一起抬箱子：按住空格把箱子抬起来，A / D 把晃动压回中间。
  // 抬满 hold 秒算成功；晃过 tiltMax 就放下重来。没有失败态，只有重试。
  const CARRY = {
    hold: 2.4,          // 抬满需要按住的时间
    tiltMax: 0.40,      // 歪过这里就放下
    sway: 1.35,         // 箱子自己晃的力度
    swayFreq: 2.1,
    correct: 2.8,       // A / D 的修正力度
    restore: 1.8,       // 回正
    damp: 1.4,
    dropPause: 0.9
  };

  // ---------------------------------------------------------------- 参数种子化
  // 「本场第几次游玩」就是种子。第 0 次 = 现行参数（首通体验不变），
  // 重玩才洗牌：材料顺序、虚线框位置、推箱路线是否镜像。

  function makeRnd(seed) {          // 和 ball.js 同一个确定性伪随机
    let s = seed >>> 0;
    return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }

  const PLAN_FIRST = {
    n: 0,
    papersOrder: PAPERS.order.slice(),     // [2,3,1]
    noticeCy: NOTICE.cys[0],               // 88
    noticeBand: noticeBandFor(NOTICE.cys[0]),
    mirror: false,
    box: BOX,
    boyStation: STATION.boy,
    walkDir: 1
  };
  const planCache = [PLAN_FIRST];

  function sameOrder(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /** 第 n 次游玩的参数组。纯函数、可复现：自检和浏览器用的是同一份。 */
  function planForRun(n) {
    if (!(n > 0)) return planCache[0];
    if (planCache[n]) return planCache[n];
    const rnd = makeRnd(0x9e3779b9 ^ Math.imul(n + 1, 2654435761));
    const order = [1, 2, 3];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    // 洗出来和上一次一样就转一格：保证「材料顺序不等于上次」。
    if (sameOrder(order, planForRun(n - 1).papersOrder)) {
      const t = order[0]; order[0] = order[1]; order[1] = t;
    }
    const mirror = n % 2 === 1;
    const plan = {
      n: n,
      papersOrder: order,
      noticeCy: NOTICE.cys[n % NOTICE.cys.length],   // 三个候选位轮换
      noticeBand: noticeBandFor(NOTICE.cys[n % NOTICE.cys.length]),
      mirror: mirror,
      box: mirror ? BOX_MIRROR : BOX,
      boyStation: mirror ? 512 - STATION.boy : STATION.boy,
      walkDir: mirror ? -1 : 1
    };
    planCache[n] = plan;
    return plan;
  }

  D.games.errand = function (host) {
    const trio = D.createTrio();
    // 这一场三个人都不自己走位：全部由下面这几个函数亲手摆。
    trio.pause(true);

    const A = { girl: trio.girl, friend: trio.friend, boy: trio.boy };

    // 本场第几次游玩 → 参数组。计数落盘，重进一次就换一组；
    // resetDaily 只删完成键，不会把这个计数删掉。
    const runs = Math.max(0, Number(D.store.errandRuns) || 0);
    D.persist({ errandRuns: runs + 1 });
    const plan = planForRun(runs);
    const B = plan.box;

    // 走廊里本来就有别人。只走远侧那条道，不抢三个人的站位。
    // 走廊里本来就有别人。只走远侧那条道，而且避开中间三个人的作业区——
    // 彩色路人穿过朱里和由乃身后太抢镜，宁可让两头各自走一个。
    const crowds = [
      D.createCrowd({
        count: 1, xMin: 24, xMax: 210,
        yMin: 202, yMax: 208,
        size: 0.76, alpha: 0.5, speed: 20, seed: 5
      }),
      D.createCrowd({
        count: 1, xMin: 450, xMax: 488,
        yMin: 202, yMax: 208,
        size: 0.76, alpha: 0.5, speed: 18, seed: 9
      })
    ];
    // 抬箱走那一段时迎面来的路人。复用 crowd 的绘制 / 走位，只有一个人。
    // 活动范围放宽：他会从画面外（甚至世界坐标更远处）走进来，不能被边界提前掰回去。
    const passers = D.createCrowd({
      count: 1, xMin: -400, xMax: 1000, yMin: BOX.y, yMax: BOX.y,
      size: 0.78, alpha: 0.66, speed: WALK.npcSpeed, seed: 41
    });
    passers.actors[0].hidden = true;

    let t = 0;
    let state = "intro";      // intro | work | ending | walkout | carry | carryDone | handover | done
    let frozen = false;
    let active = "girl";      // "girl" 朱里 | "friend" 由乃 | "boy" 我
    let endingT = 0;
    let hintLock = 0;
    let hintText = "";
    let touchHold = false;
    let lastPoke = -9, pokeCount = 0, talkIdx = 0;
    let cam = 0;              // 抬箱走路那一段的镜头平移（世界坐标 → 屏幕）

    // ---- 朱里 · 贴通知 ----------------------------------------------------
    const notice = {
      t: 0, y: NOTICE.y0, restY: NOTICE.y0, tilt: 0, jx: 0,
      cy: plan.noticeCy, band: plan.noticeBand.slice(),
      link: false, praise: false,
      done: false, misses: 0, held: false, missed: false, fallT: 0
    };

    // ---- 由乃 · 数材料 ----------------------------------------------------
    const papers = {
      sel: 0, picked: 0, done: false, misses: 0,
      flash: 0, flashIdx: -1, order: plan.papersOrder.slice()
    };

    // ---- 我 · 搬箱子 ------------------------------------------------------
    const box = {
      x: B.start, lifted: false, done: false, misses: 0,
      held: false, rolling: 0, rollFrom: B.start, rollTo: B.rollTo
    };

    // ---- 三个人一起抬 ----------------------------------------------------
    const carry = {
      holding: false, lift: 0, rise: 0, tilt: 0, v: 0,
      misses: 0, dropT: 0, done: false, endT: 0, finishing: false,
      // 抬起来之后往楼梯口走的那一段
      walkOn: false, walkFrom: 0, walkTo: 0, walkDir: plan.walkDir, walkProgress: 0,
      lane: BOX.y, bumps: 0, blockT: 0, bumpedNpc: false,
      swayScale: 1
    };
    let touchDir = 0;

    let tagsEl = null;
    let canvasEl = null;

    // ---------------------------------------------------------------- 换人条

    function isDone(who) {
      return who === "girl" ? notice.done : who === "friend" ? papers.done : box.done;
    }

    function renderTags() {
      if (!tagsEl) return;
      tagsEl.querySelectorAll("button[data-who]").forEach(function (b) {
        const who = b.dataset.who;
        b.classList.toggle("on", who === active);
        b.classList.toggle("done", isDone(who));
        b.setAttribute("aria-pressed", who === active ? "true" : "false");
      });
    }

    function showTags() {
      if (!tagsEl) return;
      tagsEl.hidden = false;
      renderTags();
    }

    function hideTags() {
      if (tagsEl) tagsEl.hidden = true;
    }

    function bindTags() {
      if (!tagsEl) return;
      tagsEl.querySelectorAll("button[data-who]").forEach(function (b) {
        b.onclick = function () {
          b.blur();              // 别让空格/回车再点一次这个按钮
          switchTo(b.dataset.who);
        };
      });
    }

    /** 切人。切走时把正在按住的操作松开，纸 / 箱子停在原地等下次。 */
    function switchTo(who) {
      if (state !== "work" || frozen || D.dialogOpen()) return;
      if (who !== "girl" && who !== "friend" && who !== "boy") return;
      if (who === active) return;
      notice.held = false;
      notice.restY = notice.done ? notice.cy : NOTICE.y0;
      notice.t = 0;
      if (box.held) releaseBox();
      box.held = false;
      touchHold = false;
      active = who;
      D.audio.click();
      renderTags();
      updateObjective();
    }

    function cycleActive() {
      const order = ["girl", "friend", "boy"];
      const at = order.indexOf(active);
      switchTo(order[(at + 1) % order.length]);
    }

    // ---------------------------------------------------------------- 文案

    function setHint(text) {
      if (text === hintText) return;
      hintText = text;
      D.hint(text, 0);
    }

    function flashHint(text, ms) {
      hintText = text;
      hintLock = (ms || 1400) / 1000;
      D.hint(text, ms || 1400);
    }

    function opHint() {
      if (active === "girl") {
        return notice.done ? "贴好了 · Tab 换人" : "按住空格 · 把通知推进虚线框";
      }
      if (active === "friend") {
        return papers.done ? "数好了 · Tab 换人" : "A / D 选一摞 · E 拿起";
      }
      if (box.done) return "搬到了 · Tab 换人";
      return box.lifted ? "按住空格，推过门槛" : "按住空格推 · 门槛前按 E 抬";
    }

    function updateObjective() {
      if (state === "intro") {
        D.objective("三个人分头把事做完", "等她们各就各位");
        return;
      }
      if (state !== "work") return;
      const left = [];
      if (!notice.done) left.push("朱里 贴通知");
      if (!papers.done) left.push("由乃 数材料");
      if (!box.done) left.push("我 搬箱子");
      if (!left.length) {
        D.objective("三个人都做完了", "一起把箱子抬到楼梯口");
        return;
      }
      D.objective("三个人分头把事做完", "还剩 " + left.join(" · ") + "（Tab 换人）");
    }

    // ---------------------------------------------------------------- 朱里

    /** 由乃材料全对（一次都没拿错）时，朱里这边会稳一点。
     *  只给正反馈：她做砸了也只是回到原难度，不额外加难。 */
    function noticeLinkOn() {
      return papers.done && papers.misses === 0;
    }

    function postNotice(dt) {
      if (notice.done) { notice.held = false; return; }
      const held = (D.keys[" "] || touchHold) && !frozen && !D.dialogOpen();
      if (held && !notice.held) {
        notice.held = true;
        notice.t = 0;
        notice.missed = false;
        notice.fallT = 0;
        notice.link = noticeLinkOn();
        // 旁白点一句，不弹对白框，也不改数值
        if (notice.link && !notice.praise) {
          notice.praise = true;
          D.react("旁白", "有人扶着就是不一样。", 1900);
        }
        D.audio.click();
      } else if (!held && notice.held) {
        notice.held = false;
        releaseNotice();
      }
      if (notice.held) {
        notice.t = Math.min(1, notice.t + dt / NOTICE.rise);
        notice.y = D.lerp(NOTICE.y0, NOTICE.y1, notice.t);
        notice.tilt = 0;
        // 上升时左右轻微发抖。联动上了就减半——只是看着更稳，判定区间不变。
        const js = notice.link ? 0.5 : 1;
        notice.jx = (Math.sin(t * 23.7) * 1.5 + Math.sin(t * 9.3) * 0.8) * js;
      } else {
        notice.jx += (0 - notice.jx) * Math.min(1, dt * 10);
      }
    }

    function releaseNotice() {
      // 只是点了一下空格，不算做错，纸落回去
      if (notice.t < 0.05) {
        notice.restY = NOTICE.y0;
        return;
      }
      const inFrame = Math.abs(notice.y - notice.cy) <= NOTICE.half + 0.5;
      if (inFrame) {
        notice.done = true;
        notice.restY = notice.cy;
        notice.link = noticeLinkOn();
        notice.tilt = 0.02;
        notice.t = 0;
        D.audio.right();
        flashHint("贴好了。", 1500);
        renderTags();
        updateObjective();
        return;
      }
      // 没进框：翘一角，掉回手里，重来
      notice.misses++;
      notice.missed = true;
      notice.restY = NOTICE.y0;
      notice.tilt = notice.y < notice.cy ? -0.55 : 0.5;
      notice.fallT = 0.5;
      notice.t = 0;
      D.audio.wrong();
      flashHint("翘起来了——再来一次。", 1500);
    }

    function easeNotice(dt) {
      if (notice.held) return;
      notice.y += (notice.restY - notice.y) * Math.min(1, dt * 8);
      if (notice.fallT > 0) {
        notice.fallT -= dt;
        if (notice.fallT <= 0) notice.missed = false;
      } else {
        notice.tilt += (0 - notice.tilt) * Math.min(1, dt * 5);
      }
    }

    // ---------------------------------------------------------------- 由乃

    function countPapers(i) {
      if (papers.done || i < 0 || i > 2) return;
      papers.sel = i;
      const num = papers.order[i];
      if (num === papers.picked + 1) {
        papers.picked++;
        D.audio.right();
        if (papers.picked >= 3) {
          papers.done = true;
          flashHint("三摞都对上了。", 1600);
          renderTags();
          updateObjective();
        } else {
          flashHint("第 " + num + " 摞，对。", 1200);
        }
        return;
      }
      // 拿错：不罚、不结束，回到第一摞重数
      papers.misses++;
      papers.picked = 0;
      papers.flash = 0.5;
      papers.flashIdx = i;
      D.audio.wrong();
      flashHint("顺序不对——看纸上印的号。", 1600);
    }

    function movePaperSel(d) {
      if (papers.done) return;
      papers.sel = (papers.sel + d + 3) % 3;
      D.audio.click();
    }

    // ---------------------------------------------------------------- 我

    function toggleLift() {
      if (box.done || box.rolling > 0) return;
      box.lifted = !box.lifted;
      if (box.lifted) {
        D.audio.click();
        flashHint("抬起来了 · 按住空格推过去", 1400);
      } else {
        D.audio.step();
      }
    }

    function carryBox(dt) {
      if (box.done || box.rolling > 0) { box.held = false; return; }
      const held = (D.keys[" "] || touchHold) && !frozen && !D.dialogOpen();
      if (held && !box.held) { box.held = true; D.audio.click(); }
      if (!held && box.held) { box.held = false; releaseBox(); }
      if (!box.held) return;

      // 门槛只拦「还没跨过去」的箱子；跨过去之后即使放下也能继续推
      const dir = carry.walkDir;                 // 镜像路线就往左推
      const blocked = !box.lifted && (dir > 0
        ? (box.x >= B.thr - 3 && box.x < B.thr + 2)
        : (box.x <= B.thr + 3 && box.x > B.thr - 2));
      if (!blocked) {
        if (dir > 0 && box.x < B.max) box.x = Math.min(B.max, box.x + B.speed * dt);
        else if (dir < 0 && box.x > B.max) box.x = Math.max(B.max, box.x - B.speed * dt);
      }
      A.boy.moving = true;          // 原地推车的循环动作
      A.boy.dir = dir;
      // 抬过门槛之后箱子自己落下，别一直浮着
      if (box.lifted && (dir > 0 ? box.x > B.thr + 8 : box.x < B.thr - 8)) {
        box.lifted = false;
        D.audio.step();
      }
    }

    function releaseBox() {
      if (box.done) return;
      A.boy.moving = false;
      const dir = carry.walkDir;
      if (box.x >= B.drop[0] && box.x <= B.drop[1]) {
        box.done = true;
        box.lifted = false;
        D.audio.right();
        flashHint("放到位了。", 1500);
        renderTags();
        updateObjective();
      } else if (dir > 0 ? box.x > B.drop[1] : box.x < B.drop[0]) {
        box.misses++;
        box.lifted = false;
        box.rolling = 0.9;
        box.rollFrom = box.x;
        box.rollTo = B.rollTo;
        D.audio.wrong();
        flashHint("推过头了——箱子又滚回来了。", 1700);
      }
      // 还没到落点就松手：只是停下，不算错
    }

    function stepRoll(dt) {
      if (box.rolling <= 0) return;
      box.rolling -= dt;
      const k = 1 - D.clamp(box.rolling / 0.9, 0, 1);
      const e = k * k * (3 - 2 * k);
      box.x = D.lerp(box.rollFrom, box.rollTo, e);
      if (box.rolling <= 0) {
        box.rolling = 0;
        box.x = B.rollTo;
      }
    }

    // ---------------------------------------------------------------- 主动发起

    const TALK = [
      { me: "这些都得今天弄完？", who: "朱里", back: "嗯。弄完就走。" },
      { me: "要帮忙吗？", who: "由乃", back: "你搬你那边。" },
      { me: "……还挺沉。", who: "朱里", back: "别逞强。" }
    ];

    function poke() {
      if (state !== "work" || frozen || D.dialogOpen()) return;
      if (t - lastPoke < 0.9) return;
      lastPoke = t;
      pokeCount++;
      const line = TALK[talkIdx++ % TALK.length];
      D.audio.blip();
      D.react("我", line.me, 950);
      D.react(line.who, line.back, 1600);
    }

    // ---------------------------------------------------------------- 结尾

    /** 三个人都做完 → 停一拍 → 两个人走到箱子边。 */
    function beginEnding() {
      state = "ending";
      endingT = 1.05;
      hideTags();
      D.reactHint(false);
      D.clearReact();
      D.hint(null);
      hintText = null;
      hintLock = 0;
      notice.held = false;
      box.held = false;
      touchHold = false;
      A.boy.moving = false;
      for (const k in A) A[k].alpha = 1;
      D.objective("三个人都做完了", "一起把箱子抬到楼梯口");
    }

    /** 三个人走到箱子边，围住它。 */
    function walkOut() {
      return new Promise(function (resolve) {
        const from = {
          girl: trio.girl.x, friend: trio.friend.x, boy: trio.boy.x,
          girlY: trio.girl.y, friendY: trio.friend.y, boyY: trio.boy.y
        };
        // 两个人让到箱子两侧，我在中间；三个人站到同一条脚线上，
        // 抬箱时才和箱子、彼此的手对得上。
        const to = {
          girl: box.x - 25, friend: box.x + 25, boy: box.x
        };
        const t0 = t;
        const DUR = 0.95;
        (function step() {
          const k = D.clamp((t - t0) / DUR, 0, 1);
          const e = k * k * (3 - 2 * k);
          trio.girl.x = D.lerp(from.girl, to.girl, e);
          trio.friend.x = D.lerp(from.friend, to.friend, e);
          trio.boy.x = D.lerp(from.boy, to.boy, e);
          trio.girl.y = D.lerp(from.girlY, BOX.y, e);
          trio.friend.y = D.lerp(from.friendY, BOX.y, e);
          trio.boy.y = D.lerp(from.boyY, BOX.y, e);
          trio.girl.moving = k < 1;
          trio.friend.moving = k < 1;
          trio.boy.moving = k < 1;
          trio.girl.dir = 1;
          trio.friend.dir = 1;
          trio.boy.dir = 1;
          if (k < 1) { requestAnimationFrame(step); return; }
          trio.girl.moving = false;
          trio.friend.moving = false;
          trio.boy.moving = false;
          resolve();
        })();
      });
    }

    /** 抬箱动作帧：先弯腰抓住箱子，再一起抬起来。
     *  三个人的弯腰帧都朝左；朱里站在箱子左边，要翻过来才朝着箱子。 */
    function setCarryPose(pose) {
      trio.boy.pose = pose;
      trio.girl.pose = pose;
      trio.friend.pose = pose;
      trio.girl.flip = pose === "pickup";
      trio.friend.flip = false;
      trio.boy.flip = false;
    }

    function clearCarryPose() {
      trio.boy.pose = null;
      trio.girl.pose = null;
      trio.friend.pose = null;
      trio.girl.flip = false;
      trio.friend.flip = false;
      trio.boy.flip = false;
    }

    /** 三个人一起抬：按住空格抬起来，A / D 把晃动压回中间。 */
    function startCarry() {
      state = "carry";
      carry.holding = false;
      carry.lift = 0;
      carry.rise = 0;
      carry.tilt = 0;
      carry.v = 0;
      carry.dropT = 0;
      carry.done = false;
      carry.endT = 0;
      carry.finishing = false;
      carry.walkOn = false;
      carry.walkProgress = 0;
      carry.lane = BOX.y;
      carry.bumps = 0;
      carry.blockT = 0;
      carry.bumpedNpc = false;
      // 推箱全程没回滚（没推过头）→ 抬箱段晃得更小。只给正反馈。
      carry.swayScale = box.misses === 0 ? 0.7 : 1;
      clearCarryPose();
      syncCarryTrio();
      touchHold = false;
      touchDir = 0;
      D.objective("一起把箱子抬到楼梯口", "按住空格抬起来 · A / D 稳住");
      D.hint("按住空格抬起来 · A / D 稳住", 0);
      hintText = "按住空格抬起来 · A / D 稳住";
      hintLock = 0;
      D.react("朱里", "一、二——", 900);
      D.react("由乃", "起。", 700);
    }

    function dropCarry() {
      carry.misses++;
      carry.dropT = CARRY.dropPause;
      carry.lift = 0;
      carry.rise = 0;
      carry.tilt = 0;
      carry.v = 0;
      carry.holding = false;
      clearCarryPose();
      D.audio.wrong();
      D.react("由乃", "慢点，歪了。", 1000);
      flashHint("歪了——放下来重抬。", 1200);
    }

    function syncCarryTrio() {
      // 朱里和由乃夹着箱子，我站在正中间：我的抬箱帧里
      // 本来就画着箱子，游戏里的箱子正好叠上去；三个人站在同一条脚线上。
      // 抬起来走路那一段，脚线会跟着 W / S 的纵深微调一起动。
      trio.girl.x = box.x - 25;
      trio.friend.x = box.x + 25;
      trio.boy.x = box.x;
      trio.girl.y = carry.lane;
      trio.friend.y = carry.lane;
      trio.boy.y = carry.lane;
    }

    /** 抬起来之后往楼梯口走的那一段：慢速横移 + 迎面一个路人。 */
    function beginCarryWalk() {
      carry.walkOn = true;
      carry.walkFrom = box.x;
      carry.walkTo = box.x + carry.walkDir * WALK.dist;
      carry.walkProgress = 0;
      carry.lane = BOX.y;
      const npc = passers.actors[0];
      npc.hidden = false;
      npc.x = carry.walkTo + carry.walkDir * WALK.npcLead;
      npc.y = BOX.y;
      npc.dir = -carry.walkDir;
      npc.face = carry.walkDir > 0 ? "left" : "right";
      npc.speed = WALK.npcSpeed;
      npc.pause = 0;
      D.react("朱里", "行了，走。", 900);
      D.hint("W / S 换个位置，让一让", 3200);
    }

    function stopCarryWalk() {
      carry.walkOn = false;
      carry.walkProgress = 1;
      box.x = carry.walkTo;
      passers.actors[0].hidden = true;
      carry.endT = 0.7;
      carry.finishing = false;
      D.audio.right();
      D.react("朱里", "到了。", 900);
    }

    function updateCarryWalk(dt) {
      // 纵深：W / S 换一条线，站远一点或近一点，把迎面的人让开。
      const ay = D.axisY();
      if (ay !== 0) {
        carry.lane = D.clamp(carry.lane - ay * WALK.laneSpeed * dt,
          WALK.laneMin, WALK.laneMax);
      }

      // 平衡只影响画面：抬起之后三个人一起抬，不会因为晃而失败。
      const held = (D.keys[" "] || touchHold) && !frozen && !D.dialogOpen();
      if (held) {
        carry.v += Math.sin(t * CARRY.swayFreq) * CARRY.sway * carry.swayScale * 0.5 * dt;
        carry.v += (D.axisX() || touchDir) * CARRY.correct * 0.6 * dt;
        carry.v -= carry.tilt * CARRY.restore * dt;
        carry.v *= Math.exp(-CARRY.damp * dt);
        carry.tilt = D.clamp(carry.tilt + carry.v * dt,
          -CARRY.tiltMax * 0.7, CARRY.tiltMax * 0.7);
      } else {
        carry.v *= Math.exp(-3 * dt);
        carry.tilt += (0 - carry.tilt) * Math.min(1, dt * 6);
      }

      // 碰到路人：停一下、把箱子放低一点，再抬起来接着走。不记 misses。
      const npc = passers.actors[0];
      if (!carry.bumpedNpc &&
          Math.abs(npc.x - box.x) < WALK.bumpX &&
          Math.abs(carry.lane - npc.y) < WALK.bumpY) {
        carry.bumpedNpc = true;
        carry.blockT = WALK.pause;
        carry.bumps++;
        carry.rise = Math.max(0.35, carry.rise - 0.35);
        D.audio.step();
        D.react("由乃", "有人，慢点。", 900);
      }

      if (carry.blockT > 0) {
        carry.blockT -= dt;
        carry.rise = Math.max(0.35, carry.rise - dt * 2.2);
      } else {
        carry.rise = Math.min(1, carry.rise + dt * 2.2);
        box.x += carry.walkDir * WALK.speed * dt;
        const doneMove = carry.walkDir > 0
          ? box.x >= carry.walkTo : box.x <= carry.walkTo;
        if (doneMove) stopCarryWalk();
      }
      carry.walkProgress = D.clamp(
        Math.abs(box.x - carry.walkFrom) / WALK.dist, 0, 1);

      setCarryPose(carry.rise >= 0.85 ? "carry" : "pickup");
      syncCarryTrio();
      trio.girl.moving = false;
      trio.friend.moving = false;
      trio.boy.moving = false;
      trio.girl.dir = carry.walkDir;
      trio.friend.dir = carry.walkDir;
      trio.boy.dir = carry.walkDir;

      // 走到哪，镜头就跟到哪；先让开一点点，把前面那段走廊让进画面。
      // 镜像路线往左走，镜头就往左挪，屏幕坐标 = 世界坐标 - cam。
      const walked = (box.x - carry.walkFrom) * carry.walkDir;
      const ease = D.clamp(walked / 42, 0, 1);
      cam = carry.walkDir * (WALK.camEase * (ease * ease * (3 - 2 * ease)) + walked);
    }

    function updateCarry(dt) {
      if (carry.done) {
        if (carry.walkOn) {
          updateCarryWalk(dt);
          return;
        }
        carry.endT -= dt;
        if (carry.endT <= 0 && !carry.finishing) {
          carry.finishing = true;
          afterWalkOut();
        }
        return;
      }
      if (carry.dropT > 0) {
        carry.dropT -= dt;
        carry.rise = 0;
        clearCarryPose();
        trio.girl.moving = false;
        trio.friend.moving = false;
        trio.boy.moving = false;
        if (carry.dropT <= 0) flashHint("再来一次。", 900);
        return;
      }

      const held = (D.keys[" "] || touchHold) && !frozen && !D.dialogOpen();
      carry.holding = held;
      // 起手先蹲下抓住箱子，再站起来；松手就放回去。这一层只影响画面，
      // 真正的成败还是看 carry.lift。
      carry.rise = D.clamp(
        carry.rise + (held ? 1 / 0.32 : -1 / 0.26) * dt, 0, 1);
      if (carry.rise > 0.04) {
        setCarryPose(carry.rise >= 0.85 ? "carry" : "pickup");
      } else {
        clearCarryPose();
      }
      const ax = D.axisX() || touchDir;
      if (held) {
        carry.lift = Math.min(1, carry.lift + dt / CARRY.hold);
        carry.v += Math.sin(t * CARRY.swayFreq) * CARRY.sway * carry.swayScale * dt;
        carry.v += ax * CARRY.correct * dt;
        carry.v -= carry.tilt * CARRY.restore * dt;
        carry.v *= Math.exp(-CARRY.damp * dt);
        carry.tilt += carry.v * dt;
        if (Math.abs(carry.tilt) > CARRY.tiltMax) {
          dropCarry();
          return;
        }
        trio.girl.moving = false;
        trio.friend.moving = false;
        trio.boy.moving = false;
        trio.girl.dir = 1;
        trio.friend.dir = 1;
        trio.boy.dir = 1;
      } else {
        // 松手只是把箱子放下歇一下，不算错
        carry.lift = Math.max(0, carry.lift - dt * 0.8);
        carry.v *= Math.exp(-3 * dt);
        carry.tilt += (0 - carry.tilt) * Math.min(1, dt * 6);
        trio.girl.moving = false;
        trio.friend.moving = false;
        trio.boy.moving = false;
      }
      syncCarryTrio();

      if (carry.lift >= 1) {
        carry.done = true;
        carry.holding = false;
        carry.rise = 1;
        setCarryPose("carry");
        box.lifted = true;
        trio.girl.moving = false;
        trio.friend.moving = false;
        trio.boy.moving = false;
        D.audio.right();
        D.objective("抬到楼梯口了", "W / S 让一让迎面的人");
        flashHint("抬起来了——往楼梯口走。", 1200);
        beginCarryWalk();
      }
    }

    async function afterWalkOut() {
      state = "handover";
      box.lifted = false;
      clearCarryPose();
      await D.lines([
        ["旁白", "箱子靠墙放着，盖子上压了一张写了字的单子。"],
        ["我", "放这儿就行？"],
        ["由乃", "对，抬到楼梯口就好。"],
        ["朱里", "……搞定。"],
        ["由乃", "比我想的快。"]
      ]);
      await D.sleep(220);
      await D.lines([
        ["朱里", "回去吧。"],
        ["由乃", "下节数学。"],
        ["我", "……"],
        ["旁白", "那天下午，我第一次觉得，这条走廊其实挺短的。"]
      ]);
      state = "done";
      D.persist({ errandCompleted: true });
      host.done({
        id: "errand",
        completed: true,
        events: ["errand:notice", "errand:papers", "errand:carried"],
        playerActions: ["switch", "post_notice", "count_papers", "carry_box"]
      });
    }

    // ---------------------------------------------------------------- 开场

    /** 从门口各自散到自己的站位。 */
    function walkToStations() {
      return new Promise(function (resolve) {
        const from = { girl: trio.girl.x, friend: trio.friend.x };
        const t0 = t;
        const DUR = 0.9;
        (function step() {
          const k = D.clamp((t - t0) / DUR, 0, 1);
          const e = k * k * (3 - 2 * k);
          trio.girl.x = D.lerp(from.girl, STATION.girl, e);
          trio.friend.x = D.lerp(from.friend, STATION.friend, e);
          trio.girl.moving = k < 1;
          trio.friend.moving = k < 1;
          trio.girl.dir = 1;
          trio.friend.dir = -1;
          if (k < 1) { requestAnimationFrame(step); return; }
          trio.girl.moving = false;
          trio.friend.moving = false;
          trio.girl.dir = 1;
          trio.friend.dir = 1;
          resolve();
        })();
      });
    }

    async function start() {
      D.clearReact();
      D.onPoke(poke);
      host.setBackground(SCENES.corridor.bg);
      host.setChapter(SCENES.corridor.name);

      tagsEl = document.getElementById("erTags");
      canvasEl = document.getElementById("scene");
      bindTags();
      hideTags();

      // 三个人先在教室门口，再各走各的
      A.boy.x = plan.boyStation; A.boy.y = 230;
      A.girl.x = STATION.friend + 8; A.girl.y = 218;
      A.friend.x = STATION.friend + 20; A.friend.y = 224;
      for (const k in A) {
        A[k].moving = false;
        A[k].dir = 1;
        A[k].alpha = 1;
      }

      state = "intro";
      updateObjective();

      await D.fadeTo(0, 420);
      await D.sleep(260);

      await D.lines([
        ["旁白", "课间，走廊里全是人。"],
        ["朱里", "和臣？正好。"],
        ["我", "……怎么了？"],
        ["由乃", "三件事，分头做快一点。"],
        ["朱里", "我去把通知贴到布告栏。"],
        ["由乃", "门口这几摞材料，我来数。"],
        ["朱里", "箱子归你。"],
        ["我", "……行。"]
      ]);

      await walkToStations();

      await D.lines([
        ["朱里", "贴的时候看准框，别歪。"],
        ["由乃", "拿之前先看纸上的号。"],
        ["我", "你们俩真熟练。"]
      ]);

      state = "work";
      showTags();
      updateObjective();
      D.reactHint("F · 搭话");
      flashHint("Tab 换人 · 三个人各做各的", 2600);

      if (canvasEl) {
        canvasEl.addEventListener("pointerdown", onPointerDown);
        canvasEl.addEventListener("pointerup", onPointerUp);
        canvasEl.addEventListener("pointercancel", onPointerUp);
      }
    }

    // ---------------------------------------------------------------- 触屏

    function toCanvas(e) {
      const r = canvasEl.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) / r.width * D.W,
        y: (e.clientY - r.top) / r.height * D.H
      };
    }

    function onPointerDown(e) {
      if (frozen || D.dialogOpen()) return;
      // 抬箱子：按住不放是抬，点左 / 右半边是 A / D 的方向
      if (state === "carry") {
        const p = toCanvas(e);
        touchHold = true;
        touchDir = p.x < box.x - 6 ? -1 : p.x > box.x + 6 ? 1 : 0;
        D.audio.unlock();
        return;
      }
      if (state !== "work") return;
      if (active === "friend") {
        const p = toCanvas(e);
        if (Math.abs(p.y - PAPERS.y) > 44) return;
        let best = -1, bd = 26;
        PAPERS.xs.forEach(function (x, i) {
          const d = Math.abs(p.x - x);
          if (d < bd) { bd = d; best = i; }
        });
        if (best >= 0) { D.audio.unlock(); countPapers(best); }
        return;
      }
      if ((active === "girl" && !notice.done) || (active === "boy" && !box.done)) {
        D.audio.unlock();
        touchHold = true;
      }
    }

    function onPointerUp() { touchHold = false; touchDir = 0; }

    // ---------------------------------------------------------------- 输入

    function press(key) {
      if (state !== "work" || frozen || D.dialogOpen()) return;
      if (key === "Tab") { cycleActive(); return; }
      const k = key.toLowerCase();

      if (active === "friend" && !papers.done) {
        if (k === "a" || key === "ArrowLeft") { movePaperSel(-1); return; }
        if (k === "d" || key === "ArrowRight") { movePaperSel(1); return; }
        if (k === "e" || key === "Enter") { countPapers(papers.sel); return; }
        return;
      }
      if (active === "boy" && !box.done) {
        if (k === "e" || key === "Enter") { toggleLift(); return; }
      }
    }

    // ---------------------------------------------------------------- 生命周期

    function update(dt) {
      t += dt;
      for (const c of crowds) c.update(dt);
      passers.update(dt);
      trio.update(dt);
      if (hintLock > 0) hintLock -= dt;
      if (papers.flash > 0) papers.flash -= dt;

      easeNotice(dt);
      stepRoll(dt);

      if (state === "work" && !frozen && !D.dialogOpen()) {
        if (active === "girl") postNotice(dt);
        else notice.held = false;
        if (active === "boy") carryBox(dt);
        else if (box.held) { box.held = false; releaseBox(); }
      } else {
        notice.held = false;
        box.held = false;
        A.boy.moving = false;
      }

      if (state === "work" && notice.done && papers.done && box.done) {
        beginEnding();
      }
      if (state === "ending") {
        endingT -= dt;
        if (endingT <= 0) {
          state = "walkout";
          walkOut().then(startCarry);
        }
      }
      if (state === "carry") {
        updateCarry(dt);
      }

      // 当前角色不吃暗，另外两个人继续做自己的待机动作
      const dim = state === "work";
      for (const k in A) A[k].alpha = dim && k !== active ? 0.62 : 1;

      if ((state === "work" || state === "carry") && !D.dialogOpen()) {
        if (hintLock <= 0) {
          setHint(state === "carry"
            ? (carry.walkOn
              ? "按住空格稳住 · W / S 让一让"
              : "按住空格抬起来 · A / D 稳住")
            : opHint());
        }
      } else if (hintText != null) {
        // 对白框占着下半屏，提示条别压在它上面
        hintText = null;
        D.hint(null);
      }
    }

    function setFrozen(v) {
      frozen = !!v;
      if (frozen) {
        notice.held = false; box.held = false;
        touchHold = false; touchDir = 0;
        carry.holding = false;
      }
    }

    function dispose() {
      D.onPoke(null);
      D.reactHint(false);
      D.clearReact();
      hideTags();
      D.hint(null);
      D.objective(null);
      if (canvasEl) {
        canvasEl.removeEventListener("pointerdown", onPointerDown);
        canvasEl.removeEventListener("pointerup", onPointerUp);
        canvasEl.removeEventListener("pointercancel", onPointerUp);
        canvasEl = null;
      }
      if (tagsEl) {
        tagsEl.querySelectorAll("button[data-who]").forEach(function (b) { b.onclick = null; });
      }
    }

    // ---------------------------------------------------------------- 绘制

    function draw(ctx) {
      // 背景按镜头平移平铺：抬箱走那一段镜头会跟着往楼梯口挪一点，
      // 走廊图左右两端都是砖柱，平铺接上去看着像走廊还在往前延伸。
      const c = Math.round(cam);
      for (let k = -2; k <= 2; k++) {
        ctx.drawImage(D.img[SCENES.corridor.bg], k * D.W - c, 0, D.W, D.H);
      }
      ctx.save();
      ctx.translate(-c, 0);
      drawNotice(ctx);
      drawPapers(ctx);
      drawActiveRing(ctx);
      for (const cm of crowds) cm.draw(ctx, t);
      passers.draw(ctx, t);
      trio.draw(ctx);
      drawBox(ctx);
      ctx.restore();
      drawCarry(ctx);
      drawPrompts(ctx);
    }

    function drawNotice(ctx) {
      ctx.save();
      // 虚线框只在还没贴好时出现；亮着的时候更醒目
      if (!notice.done) {
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = active === "girl"
          ? "rgba(255,226,180,.95)" : "rgba(255,226,180,.42)";
        ctx.strokeRect(NOTICE.x - 12, notice.cy - 12, 24, 24);
      }
      ctx.translate(NOTICE.x + notice.jx, Math.round(notice.y));
      ctx.rotate(notice.tilt);
      ctx.fillStyle = "#f7f0dd";
      ctx.fillRect(-7, -9, 14, 18);
      ctx.fillStyle = "#9a8a6e";
      ctx.fillRect(-4, -5, 8, 1);
      ctx.fillRect(-4, -2, 8, 1);
      ctx.fillRect(-4, 1, 6, 1);
      ctx.fillStyle = "#d9c9a8";
      ctx.fillRect(-7, 7, 14, 2);
      if (notice.missed) {         // 翘起来的一角
        ctx.fillStyle = "#c9b58f";
        ctx.beginPath();
        ctx.moveTo(7, -9);
        ctx.lineTo(1, -9);
        ctx.lineTo(7, -3);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    function drawPapers(ctx) {
      const y = PAPERS.y;
      ctx.save();
      PAPERS.xs.forEach(function (x, i) {
        const hot = papers.flash > 0 && papers.flashIdx === i;
        ctx.fillStyle = hot ? "#c96050" : "#cdbb95";
        ctx.fillRect(x - 11, y - 4, 22, 4);
        ctx.fillStyle = hot ? "#df8a74" : "#e6d7b6";
        ctx.fillRect(x - 11, y - 11, 22, 8);
        ctx.fillStyle = hot ? "#f0c0a8" : "#f8f1de";
        ctx.fillRect(x - 11, y - 18, 22, 8);
        ctx.fillStyle = hot ? "#5a241c" : "#43332a";
        ctx.font = 'bold 8px "Microsoft YaHei",sans-serif';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(papers.order[i]), x, y - 14);

        if (papers.done) {
          ctx.fillStyle = "#9ed6a8";
          ctx.font = 'bold 9px "Microsoft YaHei",sans-serif';
          ctx.fillText("✓", x, y - 26);
        } else if (i === papers.sel && active === "friend") {
          const ay = y - 27 + Math.sin(t * 5) * 1.5;
          ctx.fillStyle = "#ffd497";
          ctx.beginPath();
          ctx.moveTo(x - 4, ay - 4);
          ctx.lineTo(x + 4, ay - 4);
          ctx.lineTo(x, ay + 1);
          ctx.closePath();
          ctx.fill();
        }
      });
      ctx.restore();
    }

    function drawActiveRing(ctx) {
      if (state !== "work") return;
      const a = A[active];
      if (!a) return;
      const pulse = 0.5 + 0.5 * Math.sin(t * 3);
      ctx.save();
      ctx.globalAlpha = 0.16 + pulse * 0.12;
      ctx.fillStyle = "#ffd497";
      ctx.beginPath();
      ctx.ellipse(a.x, a.y + 1, 26, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function drawBox(ctx) {
      const y = carry.lane;

      // 落点：虚线框 + 楼梯口
      if (!box.done) {
        ctx.save();
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(255,212,151,.55)";
        ctx.strokeRect(B.drop[0] - 2, y - 20,
                       B.drop[1] - B.drop[0] + 4, 20);
        ctx.restore();
      }
      ctx.save();
      ctx.fillStyle = "rgba(255,226,180,.72)";
      ctx.font = '8px "Microsoft YaHei",sans-serif';
      ctx.textBaseline = "middle";
      if (plan.mirror) {                 // 镜像路线：楼梯口在西边
        ctx.textAlign = "left";
        ctx.fillText("← 楼梯口", 36, y - 27);
      } else {
        ctx.textAlign = "right";
        ctx.fillText("楼梯口 →", 476, y - 27);
      }
      ctx.restore();

      // 门槛
      ctx.fillStyle = box.lifted ? "#8a7a84" : "#43363f";
      ctx.fillRect(B.thr - 3, y - 5, 6, 5);
      ctx.fillStyle = "rgba(20,16,22,.45)";
      ctx.fillRect(B.thr - 3, y - 1, 6, 1);

      // 箱子。抬箱子阶段会随晃动歪一点，也跟着三个人一起离地；
      // 抬满时箱底正好落在我抬箱帧里那只箱子的位置。
      const inCarry = state === "carry" || state === "carryDone";
      const bx = Math.round(box.x);
      const by = inCarry
        ? y - carry.rise * 18
        : y - (box.lifted ? 4 : 0);
      const lifted = inCarry ? carry.rise > 0.05 : box.lifted;
      if (lifted) {
        ctx.save();
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = "#1b1418";
        ctx.beginPath();
        ctx.ellipse(bx, y + 1, 15, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.save();
      if (inCarry && Math.abs(carry.tilt) > 0.001) {
        const py = by - 8;
        ctx.translate(bx, py);
        ctx.rotate(carry.tilt * 0.45);
        ctx.translate(-bx, -py);
      }
      // 我的抬箱帧里已经画了一只箱子。抬起来以后用一圈深色背衬把它盖住，
      // 免得箱子歪的时候后面露出第二只边。
      if (inCarry && carry.rise >= 0.85) {
        ctx.fillStyle = "#5a3c28";
        ctx.fillRect(bx - 15, by - 20, 30, 22);
      }
      ctx.fillStyle = "#8a5f3c";
      ctx.fillRect(bx - 13, by - 17, 26, 17);
      ctx.fillStyle = "#b98a5a";
      ctx.fillRect(bx - 13, by - 17, 26, 5);
      ctx.fillStyle = "#6f4a2d";
      ctx.fillRect(bx - 13, by - 12, 26, 1);
      ctx.fillStyle = "#d8c39a";
      ctx.fillRect(bx - 2, by - 17, 4, 12);
      ctx.fillStyle = "#3a2a20";
      ctx.fillRect(bx - 13, by - 1, 26, 1);
      ctx.fillRect(bx - 13, by - 17, 1, 17);
      ctx.fillRect(bx + 12, by - 17, 1, 17);
      ctx.fillStyle = "#f2ead6";
      ctx.fillRect(bx - 8, by - 22, 16, 5);
      ctx.restore();
    }

    /** 抬箱子时的合力条：中间是安全区，指针偏出去太多就会放下。 */
    function drawCarry(ctx) {
      if (state !== "carry" && state !== "carryDone") return;
      // 固定在画面下方中间：箱子在右侧，条跟着箱子会压到人身上。
      const x = 256;
      const y = 250;
      const w = 54, h = 5;
      const cx = x - w / 2;
      ctx.save();
      ctx.fillStyle = "rgba(20,16,22,.72)";
      ctx.fillRect(cx - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = "rgba(158,214,168,.30)";
      ctx.fillRect(x - 8, y, 16, h);
      const k = D.clamp(carry.tilt / CARRY.tiltMax, -1, 1);
      const mx = x + k * (w / 2 - 3);
      let col = "#9ed6a8";
      if (Math.abs(k) > 0.72) col = "#df8a74";
      else if (Math.abs(k) > 0.4) col = "#ffd497";
      ctx.fillStyle = col;
      ctx.fillRect(mx - 2, y - 2, 4, h + 4);
      // 抬起来的进度
      ctx.fillStyle = "rgba(255,226,180,.22)";
      ctx.fillRect(cx, y + 8, w, 3);
      ctx.fillStyle = "#ffe2b4";
      ctx.fillRect(cx, y + 8, w * D.clamp(carry.lift, 0, 1), 3);
      ctx.fillStyle = "rgba(255,226,180,.75)";
      ctx.font = '7px "Microsoft YaHei",sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("合力", x, y - 7);
      ctx.restore();
    }

    function drawPrompts(ctx) {
      if (state !== "work") return;
      // 箱子卡在门槛上：浮一个 E
      if (active === "boy" && !box.done && !box.lifted &&
          (plan.mirror
            ? (box.x <= B.thr + 5 && box.x > B.thr - 2)
            : (box.x >= B.thr - 5 && box.x < B.thr + 2))) {
        const y = carry.lane - 34 + Math.sin(t * 4) * 2;
        const x = Math.round(box.x);
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = "rgba(20,16,22,.78)";
        ctx.fillRect(x - 9, y - 8, 18, 16);
        ctx.strokeStyle = "rgba(255,226,180,.9)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 8.5, y - 7.5, 17, 15);
        ctx.fillStyle = "#ffe2b4";
        ctx.font = 'bold 11px "Microsoft YaHei",sans-serif';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("E", x, y);
        ctx.restore();
      }
    }

    return {
      id: "errand",
      title: "一起去办事",
      start: start,
      update: update,
      draw: draw,
      press: press,
      trio: trio,
      setFrozen: setFrozen,
      dispose: dispose,
      get state() { return state; },
      get scene() { return "corridor"; },
      get active() { return active; },
      get noticeDone() { return notice.done; },
      get noticeMisses() { return notice.misses; },
      get noticeT() { return notice.t; },
      get noticeBand() { return notice.band.slice(); },
      get noticeLink() { return notice.link; },
      get noticeJitterScale() { return notice.link ? 0.5 : 1; },
      get paperOrder() { return papers.order.slice(); },
      get paperSel() { return papers.sel; },
      get paperPicked() { return papers.picked; },
      get paperDone() { return papers.done; },
      get paperMisses() { return papers.misses; },
      get paperXs() { return PAPERS.xs.slice(); },
      get paperY() { return PAPERS.y; },
      get boxX() { return box.x; },
      get boxLifted() { return box.lifted; },
      get boxDone() { return box.done; },
      get boxMisses() { return box.misses; },
      get boxDrop() { return B.drop.slice(); },
      get boxThr() { return B.thr; },
      get run() {
        return {
          n: plan.n, papersOrder: plan.papersOrder.slice(),
          noticeCy: plan.noticeCy, noticeBand: plan.noticeBand.slice(),
          mirror: plan.mirror, walkDir: plan.walkDir,
          boyStation: plan.boyStation,
          box: {
            start: B.start, max: B.max, thr: B.thr,
            drop: B.drop.slice(), rollTo: B.rollTo
          }
        };
      },
      get carry() {
        return {
          lift: carry.lift, rise: carry.rise, tilt: carry.tilt, misses: carry.misses,
          done: carry.done, holding: carry.holding, dropT: carry.dropT,
          walkOn: carry.walkOn, walkProgress: carry.walkProgress,
          walkFrom: carry.walkFrom, walkTo: carry.walkTo,
          walkDir: carry.walkDir, lane: carry.lane,
          bumps: carry.bumps, blockT: carry.blockT,
          swayScale: carry.swayScale,
          poses: {
            boy: trio.boy.pose || null,
            girl: trio.girl.pose || null,
            friend: trio.friend.pose || null
          },
          flipGirl: !!trio.girl.flip
        };
      },
      get pokeCount() { return pokeCount; }
    };
  };

  // 自检 / 调试用：第 n 次游玩的参数组是纯函数，不用真玩也能验。
  D.games.errand.planForRun = planForRun;

})(window);

/* D02 · 穿过课间的人流
 *
 * 下课铃刚响，走廊里全是人。玩家要在上课铃响前，从四班门口走到二班门口。
 * 走路还是 act5/explore.js 那一套双轴，人群用 core.js 的 createCrowd，另外加
 * 一个抱作业的老师、一个蹲着系鞋带的人、两堆堵在门口的学生。
 *
 * 撞到人只是停一秒、说一句「抱歉」，不扣东西、不重来。到得早晚只换对白：
 * 早了朋友乙还在门口，晚了二班的门已经关上。
 */
(function (global) {
  "use strict";

  const D = global.DAILY;
  D.games = D.games || {};

  // 一条走廊拆成四段：四班门口 → 走廊 → 走廊另一头 → 二班门口。
  // 背景是同一张，靠门的站位和路牌分开；走完全程大约二十多秒。
  const SCENES = {
    class4: { bg: "corridor", walk: [44, 196], y: [206, 256], right: "corridor", sign: "四班", signX: 260 },
    corridor: { bg: "corridor", walk: [38, 474], y: [206, 256], left: "class4", right: "corridorB" },
    corridorB: { bg: "corridor", walk: [38, 474], y: [206, 256], left: "corridor", right: "class2" },
    class2: { bg: "corridor", walk: [300, 476], y: [206, 256], left: "corridorB", sign: "二班", signX: 260 }
  };

  const TOTAL = 60;

  D.games.crowdrun = function (host) {
    const clockEl = document.getElementById("crowdClock");
    const barEl = document.getElementById("crowdBar");
    const pad = document.getElementById("crowdPad");

    // 事件 02 的时间窗只改走廊里的人数（和人流里挪人的难度），不改任何信息与判定。
    const windowId = host && host.opts && host.opts.window;
    const density = { early: 6, middle: 4, late: 2 }[windowId] || 4;

    const crowd = D.createCrowd({
      count: density, xMin: 64, xMax: 448, yMin: 210, yMax: 248,
      speed: 38, size: 0.74, alpha: 0.7, seed: 11
    });

    // 老师抱着一摞作业慢慢横穿；门口两堆人堵着；走廊另一头有人蹲着系鞋带。
    // 作业是画在老师的走路帧里的（4–7 向左、8–11 向右），这里不再补画纸。
    const movers = [
      { key: "teacher", x: 372, y: 236, dir: -1, face: "left", speed: 20, size: 0.95, blockW: 12, kind: "teacher", moving: true, phase: 0 },
      { key: "npcGirl", x: 246, y: 214, dir: -1, face: "left", speed: 0, size: 0.82, blockW: 14, kind: "crowd", moving: false, phase: 0.3 },
      { key: "npcBoy", x: 262, y: 232, dir: 1, face: "right", speed: 0, size: 0.82, blockW: 14, kind: "crowd", moving: false, phase: 0.9 },
      { key: "npcGirl", x: 300, y: 252, dir: 1, face: "right", speed: 0, size: 0.7, blockW: 10, kind: "crouch", crouch: true, moving: false, phase: 1.4 }
    ];
    for (const m of movers) { m.cool = 0; }

    const ex = D.createExplore({
      scenes: SCENES,
      start: "class4",
      x: 74,
      y: 236,
      dir: 1,
      speed: 54,
      actors: crowd.actors.concat(movers)
    });

    let state = "intro";     // intro | run | arrive | done
    let timeLeft = TOTAL;
    let stun = 0;
    let invuln = 0;
    let frozen = false;
    let tier = "none";
    let t = 0;
    let disposed = false;
    let tipTimer = 0;
    let blurred = false;
    let padVisible = false;
    let padBound = false;
    const padKeys = [];

    function setBar() {
      if (!barEl) return;
      const k = Math.max(0, Math.min(1, timeLeft / TOTAL));
      barEl.style.width = (k * 100).toFixed(1) + "%";
      barEl.classList.toggle("low", timeLeft <= 12);
    }

    function stopStun() {
      if (stun > 0) return;
      ex.enable(true);
    }

    // ------------------------------------------------------------ 触屏方向键
    // 和键盘共用 D.keys，按住走、松手停；只在窄屏 / 触屏、且真正在走的时候出现。

    function usingTouch() {
      const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
      return coarse || window.innerWidth < 820;
    }

    function releasePad() {
      for (const key of padKeys) D.keys[key] = false;
      if (pad) pad.querySelectorAll("button.on").forEach(function (b) { b.classList.remove("on"); });
    }

    function updatePad(paused) {
      if (!pad) return;
      const live = state === "run" && !paused && usingTouch();
      if (live === padVisible) return;      // 别每帧清一次键盘的方向键
      padVisible = live;
      pad.hidden = !live;
      if (!live) releasePad();
    }

    function bindPad() {
      if (!pad) return;
      for (const btn of pad.querySelectorAll("[data-dir]")) {
        const key = btn.dataset.dir.toLowerCase();
        if (padKeys.indexOf(key) < 0) padKeys.push(key);
        if (padBound) continue;
        const press = function (e) {
          e.preventDefault();
          D.keys[key] = true;
          btn.classList.add("on");
          if (btn.setPointerCapture) { try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
        };
        const release = function () {
          D.keys[key] = false;
          btn.classList.remove("on");
        };
        btn.addEventListener("pointerdown", press);
        btn.addEventListener("pointerup", release);
        btn.addEventListener("pointercancel", release);
        btn.addEventListener("pointerleave", release);
        btn.addEventListener("lostpointercapture", release);
      }
      padBound = true;
    }

    function collide() {
      if (stun > 0 || t < invuln) return;
      const p = ex.actor;
      const all = crowd.actors.concat(movers);
      for (const n of all) {
        if (n.cool > 0) continue;
        const w = n.blockW || 10;
        if (Math.abs(p.x - n.x) < w && Math.abs(p.y - n.y) < 9) {
          n.cool = 3.2;
          n.pauseT = 1.2;              // 对面也停一下，别一边被撞一边被推着走
          stun = 1.0;
          invuln = t + 1.6;
          ex.enable(false);
          D.audio.step();
          D.react("我", "抱歉。", 800);
          if (n.kind === "teacher") D.react("老师", "走廊里别跑。", 1200);
          else if (n.kind === "crouch") D.react("蹲着的同学", "……看着点。", 900);
          // 往后退一点，别贴着人站着
          p.x = D.clamp(p.x + (p.x < n.x ? -10 : 10), 38, 476);
          break;
        }
      }
    }

    async function run() {
      D.objective("上课前赶到二班门口", "走廊里全是人，绕一绕");
      D.hint("WASD 走路 · 撞到人会停一下", 3600);
      if (clockEl) clockEl.hidden = false;
      setBar();

      await D.lines([
        ["旁白", "下课铃刚响，走廊里已经全是人。"],
        ["旁白", "二班在走廊另一头。上课之前，得挤过去。"],
        ["和臣", "……走吧。"]
      ]);
      if (disposed) return;

      state = "run";
      ex.enable(true);
      D.audio.bell();
    }

    function finish(kind) {
      if (state !== "run") return;
      tier = kind;
      state = "arrive";
      D.audio.bell();
      timeLeft = Math.max(0, timeLeft);
      if (clockEl) clockEl.hidden = true;
      updatePad(true);
      D.hint(null);
      arrive();
    }

    async function arrive() {
      ex.enable(false);
      if (tier === "late") {
        await D.lines([
          ["旁白", "铃响的时候，走廊一下子空了。"],
          ["和臣", "……"],
          ["旁白", "二班的门已经关上。里面在发卷子。"]
        ]);
        if (disposed) return;
        await D.lines([
          ["朋友甲", "你跑那么快干嘛。"],
          ["和臣", "没赶上。"],
          ["朋友甲", "她今天一下课就被叫走了。你要真想知道，明天早点。"],
          ["和臣", "……嗯。"]
        ]);
      } else if (tier === "early") {
        await D.lines([
          ["朋友乙", "你来得挺快。走廊上全是人吧。"],
          ["和臣", "……嗯。你在这儿等人？"],
          ["朋友乙", "等宋遥。她刚被老师叫走了。"],
          ["和臣", "那我等一会儿。"],
          ["朋友乙", "你找她有事？"],
          ["和臣", "……想问点事。"],
          ["旁白", "二班的门开着一条缝，里面在发卷子。等到铃响，也没等到人。"]
        ]);
      } else {
        await D.lines([
          ["朋友乙", "你找谁？"],
          ["和臣", "宋遥在吗。"],
          ["朋友乙", "刚进去。有事我可以帮你带一句。"],
          ["和臣", "不用，我自己来。"],
          ["旁白", "上课铃响之前，二班门口已经没人了。"]
        ]);
      }
      if (disposed) return;

      state = "done";
      D.persist({ crowdRunCompleted: true, crowdRunTier: tier, crowdRunTimeLeft: Math.round(timeLeft) });
      host.done({ id: "crowdrun", completed: true, tier: tier, timeLeft: timeLeft });
    }

    async function timeout() {
      if (state !== "run") return;
      state = "arrive";
      tier = "late";
      timeLeft = 0;
      setBar();
      if (clockEl) clockEl.hidden = true;
      D.hint(null);
      D.audio.bell();
      ex.enable(false);
      await D.lines([
        ["旁白", "铃响了。走廊一下子空了。"],
        ["老师", "上课了，回教室。"],
        ["旁白", "我只好往回走。二班在走廊尽头，门已经关了。"],
        ["旁白", "反正，下一次课间还有。"]
      ]);
      if (disposed) return;
      state = "done";
      D.persist({ crowdRunCompleted: true, crowdRunTier: "late", crowdRunTimeLeft: 0 });
      host.done({ id: "crowdrun", completed: true, tier: "late", timeLeft: 0 });
    }

    // ------------------------------------------------------------ 每帧

    function update(dt) {
      t += dt;

      // 对白 / 冻结 / 失焦时，人群、老师、碰撞计时和倒计时一起停。
      const paused = frozen || D.dialogOpen() || ex.frozen || blurred;
      updatePad(paused);

      if (!paused) {
        crowd.update(dt);
        for (const n of crowd.actors) {
          if (n.cool > 0) n.cool -= dt;
        }

        for (const m of movers) {
          if (m.cool > 0) m.cool -= dt;
          if (m.pauseT > 0) { m.pauseT -= dt; m.moving = false; continue; }
          if (!m.speed) { m.moving = false; continue; }
          m.moving = true;
          m.x += m.dir * m.speed * dt;
          if (m.x < 300) { m.x = 300; m.dir = 1; m.face = "right"; }
          if (m.x > 452) { m.x = 452; m.dir = -1; m.face = "left"; }
        }

        if (stun > 0) {
          stun -= dt;
          if (stun <= 0) { stun = 0; stopStun(); }
        }
      }

      if (state === "run" && !paused) {
        timeLeft -= dt;
        setBar();
        if (timeLeft <= 0) { timeout(); return; }
        collide();
      }

      ex.update(dt);

      if (state === "run" && ex.scene === "class2" && ex.actor.x > 430) {
        finish(timeLeft > 30 ? "early" : timeLeft > 10 ? "middle" : "late");
      }
    }

    // ------------------------------------------------------------ 画面

    function drawSign(ctx, text, atX) {
      if (!text) return;
      const x = Math.round((atX || 260) - 26);
      ctx.save();
      ctx.fillStyle = "rgba(28,22,30,.82)";
      ctx.fillRect(x, 68, 52, 18);
      ctx.strokeStyle = "#c8a17d";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, 68.5, 51, 17);
      ctx.fillStyle = "#ffe6c7";
      ctx.font = '10px "Microsoft YaHei",sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, x + 26, 78);
      ctx.restore();
    }

    function draw(ctx) {
      ex.draw(ctx);
      const scene = ex.sceneDef();
      drawSign(ctx, scene.sign, scene.signX);

      // 蹲着系鞋带的人脚下多一小片影子，免得看起来像站着缩了半截
      for (const m of movers) {
        if (!m.crouch) continue;
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = "#1b1418";
        ctx.beginPath();
        ctx.ellipse(m.x, m.y + 1, 14, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // ------------------------------------------------------------ 壳

    function start() {
      D.clearReact();
      host.setChapter("第 2 天 · 第二节课间");
      D.hint(null);
      if (clockEl) clockEl.hidden = true;
      bindPad();
      window.addEventListener("blur", onBlur);
      window.addEventListener("focus", onFocus);
      run().catch(function (error) {
        console.error(error);
        state = "done";
        host.done({ id: "crowdrun", completed: false, error: String(error) });
      });
    }

    function press(key) {
      // 走位全靠按住方向键，这里没有单次按键要做的事
      if (state === "run" && key.toLowerCase() === "f") return;
    }

    function onBlur() {
      blurred = true;
      releasePad();
      for (const k in D.keys) D.keys[k] = false;
    }

    function onFocus() {
      blurred = false;
    }

    function dispose() {
      disposed = true;
      clearTimeout(tipTimer);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      releasePad();
      if (pad) pad.hidden = true;
      if (clockEl) { clockEl.hidden = true; clockEl.classList.remove("low"); }
      D.objective(null);
      D.hint(null);
      D.clearReact();
      ex.enable(false);
    }

    return {
      id: "crowdrun",
      title: "穿过课间的人流",
      start: start,
      update: update,
      draw: draw,
      press: press,
      setFrozen: function (v) { frozen = !!v; if (v) ex.enable(false); else if (state === "run" && stun <= 0) ex.enable(true); },
      dispose: dispose,
      get state() { return state; },
      get tier() { return tier; },
      get timeLeft() { return timeLeft; },
      get scene() { return ex.scene; },
      get x() { return ex.actor.x; },
      get y() { return ex.actor.y; },
      get people() { return crowd.actors.length; },
      get debug() {
        const teach = movers.filter(function (n) { return n.kind === "teacher"; })[0];
        return {
          stun: stun, invuln: invuln, frozen: frozen, enabled: ex.isEnabled(),
          exFrozen: ex.frozen, timeLeft: timeLeft, state: state,
          x: ex.actor.x, y: ex.actor.y,
          teacher: teach ? { x: Math.round(teach.x), face: teach.face, dir: teach.dir } : null,
          near: crowd.actors.concat(movers).filter(function (n) {
            return Math.abs(n.x - ex.actor.x) < 22 && Math.abs(n.y - ex.actor.y) < 12;
          }).map(function (n) { return { x: Math.round(n.x), y: Math.round(n.y), cool: n.cool ? +n.cool.toFixed(2) : 0, kind: n.kind || "crowd" }; })
        };
      }
    };
  };

})(window);


/* D08 · 踢毽子（备用日常）
 *
 * 操场上，三个人围成一个小三角。毽子在三人之间来回，轮到和臣接的时候，
 * 在毽子落到脚边按空格。由乃和朱里自己会踢，偶尔也会踢飞。
 *
 * 踢飞了就去捡，连击归零，但不会结束。玩到二十回合，或者按「差不多行了」。
 */
(function (global) {
  "use strict";

  const D = global.DAILY;
  D.games = D.games || {};

  const GRAVITY = 320;
  const LAUNCH = -190;
  const HIT_RADIUS = 26;
  const MAX_ROUNDS = 20;

  // 三个人站的位置，毽子在他们脚边之间来回
  const SPOTS = [
    { key: "boy", x: 258, y: 262, name: "和臣" },
    { key: "friend", x: 344, y: 246, name: "由乃" },
    { key: "girl", x: 176, y: 246, name: "朱里" }
  ];
  const AI_ACCURACY = [0, 0.8, 0.9];   // 和臣由玩家负责

  D.games.shuttlecock = function (host) {
    const hud = document.getElementById("shuttleHud");
    const comboEl = document.getElementById("shuttleCombo");
    const stopBtn = document.getElementById("shuttleStop");
    const canvas = document.getElementById("mg");

    let state = "intro";      // intro | play | retrieve | done
    let from = 0;             // 刚踢的人
    let to = 1;               // 接的人
    let combo = 0;
    let best = 0;
    let rounds = 0;
    let windowT = 0;          // 玩家接球的判定时间
    let aiT = 0;
    let landT = 0;
    let kickFx = 0;
    let kickWho = -1;
    let t = 0;
    let frozen = false;
    let disposed = false;
    let launchTimer = 0;
    let endTimer = 0;

    const shuttle = { x: 0, y: 0, vx: 0, vy: 0, spin: 0 };

    // ------------------------------------------------------------ 发球

    function launch(nextFrom, nextTo) {
      from = nextFrom;
      to = nextTo;
      const a = SPOTS[from];
      const b = SPOTS[to];
      const vy = LAUNCH * (0.9 + Math.random() * 0.2);
      const air = Math.abs(vy) * 2 / GRAVITY;
      shuttle.x = a.x;
      shuttle.y = a.y - 8;
      shuttle.vy = vy;
      shuttle.vx = (b.x - a.x) / air;
      shuttle.spin = 0;
      state = "play";
      windowT = 0;
      aiT = 0;
      kickFx = 0.22;
      kickWho = from;
      rounds++;
    }

    function endSoon() {
      // 最后一球踢完再收，别把毽子停在半空
      clearTimeout(endTimer);
      endTimer = setTimeout(function () {
        if (!disposed && state !== "done") finish();
      }, 900);
    }

    function hit(byPlayer) {
      if (state !== "play") return;
      combo++;
      if (combo > best) best = combo;
      if (comboEl) comboEl.textContent = "连击 " + combo;
      D.audio.right();
      kickFx = 0.26;
      kickWho = to;
      state = "wait";

      if (combo > 0 && combo % 5 === 0) {
        const says = [
          ["由乃", "可以啊。"],
          ["朱里", "别停。"],
          ["由乃", "还接得住吗。"],
          ["朱里", "再来。"]
        ];
        const pick = says[Math.floor(Math.random() * says.length)];
        D.react(pick[0], pick[1], 1400);
      }

      if (rounds >= MAX_ROUNDS) { endSoon(); return; }

      // 下一棒：别人踢给你，或者你踢给她
      const next = (to + 1) % 3;
      clearTimeout(launchTimer);
      launchTimer = setTimeout(function () {
        // 这一局如果已经结束（停止 / Esc），就别再把 state 拉回 play。
        if (!disposed && state === "wait") launch(to, next);
      }, byPlayer ? 100 : 130);
    }

    function miss() {
      if (state !== "play") return;
      combo = 0;
      if (comboEl) comboEl.textContent = "连击 0";
      D.audio.step();
      state = "retrieve";
      landT = 1.0;
      const who = SPOTS[to].name;
      D.react(who, "我来。", 1100);
    }

    function finish() {
      if (state === "done") return;
      state = "done";
      clearTimeout(launchTimer);
      clearTimeout(endTimer);
      if (stopBtn) stopBtn.disabled = true;
      if (hud) hud.hidden = true;
      endTalk();
    }

    async function endTalk() {
      await D.lines([
        ["旁白", "毽子最后一次被踢起来，落在旁边。"],
        ["由乃", "不行了，腿酸。"],
        ["朱里", "你才踢了几下。"],
        ["和臣", "……" + (best > 0 ? "我好像踢得还行。" : "我好像一直在捡。")],
        ["旁白", "风把毽子上的一根羽毛吹起来，又落回地上。"]
      ]);
      if (disposed) return;
      D.persist({ shuttlecockCompleted: true, shuttlecockBest: best, shuttlecockRounds: rounds });
      host.done({ id: "shuttlecock", completed: true, best: best, rounds: rounds });
    }

    // ------------------------------------------------------------ 每帧

    function update(dt) {
      t += dt;
      if (kickFx > 0) kickFx = Math.max(0, kickFx - dt);
      if (frozen || D.dialogOpen()) return;

      if (state === "retrieve") {
        landT -= dt;
        if (landT <= 0) {
          // 捡回来，从刚才失手的那个人重新踢；到回合上限就收，不再多发一球。
          if (rounds >= MAX_ROUNDS) finish();
          else launch(to, (to + 1) % 3);
        }
        return;
      }

      if (state !== "play") return;

      shuttle.vy += GRAVITY * dt;
      shuttle.y += shuttle.vy * dt;
      shuttle.x += shuttle.vx * dt;
      shuttle.spin += dt * 7;

      const target = SPOTS[to];
      const nearX = Math.abs(shuttle.x - target.x) < HIT_RADIUS;
      const low = shuttle.y > target.y - 46 && shuttle.vy > 0;

      if (to === 0) {
        // 轮到和臣：给一个宽一点的判定窗，不用卡帧
        if (nearX && low) {
          if (windowT <= 0) windowT = 0.55;
          windowT -= dt;
          if (windowT <= 0 && shuttle.y > target.y + 2) miss();
        } else if (windowT > 0) {
          windowT = 0;
        }
      } else if (nearX && low) {
        if (aiT <= 0) aiT = 0.28 + Math.random() * 0.3;
        aiT -= dt;
        if (aiT <= 0) {
          if (Math.random() < AI_ACCURACY[to]) hit(false);
          else miss();
        }
      }

      if (state === "play" && (shuttle.y > target.y + 6 || shuttle.y > D.H)) {
        miss();
      }
    }

    // ------------------------------------------------------------ 画面

    function drawShuttle(ctx, x, y) {
      ctx.save();
      ctx.translate(x, y);
      // 羽毛
      ctx.strokeStyle = "#f2e3c4";
      ctx.lineWidth = 1.2;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(i * 3.4, -9 + Math.abs(i) * 2);
        ctx.stroke();
      }
      // 底座
      ctx.fillStyle = "#c05a4e";
      ctx.beginPath();
      ctx.ellipse(0, 0, 3, 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function draw(ctx) {
      const bg = D.img.field || D.img.exterior;
      if (bg) ctx.drawImage(bg, 0, 0, D.W, D.H);
      ctx.fillStyle = "rgba(22,18,28,.22)";
      ctx.fillRect(0, 0, D.W, D.H);

      // 判定圈：只在轮到和臣、毽子落下来的时候出现，颜色很轻
      if (state === "play" && to === 0) {
        const p = SPOTS[0];
        ctx.save();
        ctx.strokeStyle = windowT > 0 ? "rgba(255,212,151,.8)" : "rgba(255,212,151,.3)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y - 2, HIT_RADIUS, 7, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      for (let i = 0; i < SPOTS.length; i++) {
        const spot = SPOTS[i];
        const kicking = kickFx > 0 && kickWho === i;
        const actor = {
          key: spot.key,
          x: spot.x,
          y: spot.y - (kicking ? 2 : 0),
          dir: i === 1 ? -1 : 1,
          face: i === 1 ? "left" : "right",
          moving: false,
          phase: i * 0.7
        };
        D.shadow(ctx, spot.x, spot.y + 1, D.FRAME_W);
        D.drawActor(ctx, actor, t);
        if (kicking) {
          // 踢到的一瞬间脚下一道弧线，代替踢腿帧
          ctx.save();
          ctx.strokeStyle = "rgba(255,236,200,.75)";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(spot.x + (i === 1 ? -10 : 10), spot.y - 6, 9, Math.PI * 0.15, Math.PI * 0.85);
          ctx.stroke();
          ctx.restore();
        }
      }

      if (state === "play" || state === "retrieve") {
        drawShuttle(ctx, Math.round(shuttle.x), Math.round(shuttle.y));
      }

      // 连击在画布上也飘一下，眼睛不用来回扫 HUD
      if (state === "play" && combo >= 3) {
        ctx.save();
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = "#ffe6c7";
        ctx.font = 'bold 13px "Microsoft YaHei",sans-serif';
        ctx.textAlign = "center";
        ctx.fillText("× " + combo, SPOTS[0].x, 172);
        ctx.restore();
      }
    }

    // ------------------------------------------------------------ 流程

    async function run() {
      D.objective("踢毽子", "毽子落到脚边时按空格");
      if (hud) hud.hidden = false;
      if (comboEl) comboEl.textContent = "连击 0";

      await D.lines([
        ["旁白", "体育活动之前，操场上。由乃不知从哪儿摸出一只毽子。"],
        ["由乃", "一个人踢没意思，轮着来。"],
        ["朱里", "我不会。"],
        ["由乃", "接着踢就行，掉地上就捡。"],
        ["旁白", "毽子到她脚下，她一抬脚，羽毛散开又合上。"],
        ["和臣", "……我试试。"]
      ]);
      if (disposed) return;

      launch(1, 2);   // 由乃先踢给朱里，朱里再踢给和臣
      stopBtn.disabled = false;
      D.hint("毽子到脚边时按空格或点一下", 3000);
    }

    // ------------------------------------------------------------ 壳

    function start() {
      D.clearReact();
      host.setChapter("备用 · 课间");
      D.hint(null);
      stopBtn.disabled = true;
      canvas.addEventListener("pointerdown", onCanvasDown);
      stopBtn.onclick = function () {
        // 开场对白期间不能点：那会覆盖正在读的队列，造成并发对白。
        if (D.dialogOpen()) return;
        if (state !== "play" && state !== "wait" && state !== "retrieve") return;
        finish();
      };
      run().catch(function (error) {
        console.error(error);
        state = "done";
        host.done({ id: "shuttlecock", completed: false, error: String(error) });
      });
    }

    function canHit() {
      if (state !== "play" || frozen || D.dialogOpen() || to !== 0) return false;
      const p = SPOTS[0];
      return Math.abs(shuttle.x - p.x) < HIT_RADIUS + 6 && shuttle.y > p.y - 60;
    }

    function onCanvasDown() {
      if (canHit()) hit(true);
    }

    function press(key) {
      const k = key.toLowerCase();
      if (k !== " " && k !== "enter" && k !== "e") return;
      if (canHit()) hit(true);
    }

    function setFrozen(v) { frozen = !!v; }

    function dispose() {
      disposed = true;
      clearTimeout(launchTimer);
      clearTimeout(endTimer);
      canvas.removeEventListener("pointerdown", onCanvasDown);
      stopBtn.onclick = null;
      stopBtn.disabled = true;
      if (hud) hud.hidden = true;
      D.objective(null);
      D.hint(null);
      D.clearReact();
    }

    return {
      id: "shuttlecock",
      title: "踢毽子",
      start: start,
      update: update,
      draw: draw,
      press: press,
      setFrozen: setFrozen,
      dispose: dispose,
      get state() { return state; },
      get combo() { return combo; },
      get best() { return best; },
      get rounds() { return rounds; },
      get who() { return to; },
      get shuttle() { return { x: shuttle.x, y: shuttle.y }; }
    };
  };

})(window);

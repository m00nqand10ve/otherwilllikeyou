/* D00b · 纸飞机（事件 07，主线里的画布玩法）
 *
 * 三个人在操场上轮流试飞：由乃先扔（宽翼，飞得很近），接着是玩家
 * （三种折法 + 角度 / 力度 + 简化物理），最后朱里（方头，中等距离，上下浮动 10%）。
 *
 * 不判失败、不排名、不写任何关系字段。落地的位置记成 paperPlaneLanded，
 * 只给后面的拍照日常和事件 09 的合照当一个小小的状况；没有就跳过。
 *
 * 三折法用已加载的 prop_paper_plane.png（48×16，每格 16×16），不新增贴图。
 */
(function (global) {
  "use strict";

  const D = global.DAILY;
  D.games = D.games || {};

  const W = 512;
  const H = 288;
  const GROUND = 250;
  const HAND_Y = 232;

  // 左边是脚底的 x。玩家站在三个人中间偏左，扔的时候不会被自己挡住。
  const START = { me: 168, yuno: 248, jurie: 338 };

  // 三种折法只改参数，不需要三套动画。
  const STYLES = [
    { id: "dart", name: "尖头", speed: 1.15, lift: 0.75, stability: 0.85, drag: 0.55, frame: 0, note: "飞得远，容易偏" },
    { id: "wide", name: "宽翼", speed: 0.85, lift: 1.25, stability: 0.95, drag: 0.40, frame: 1, note: "飞得慢，飘得久" },
    { id: "square", name: "方头", speed: 0.95, lift: 1.0, stability: 1.15, drag: 0.48, frame: 2, note: "稳，距离中等" }
  ];

  const GRAVITY = 240;
  const DRAG = 0.35;
  const LIFT = 18;

  const styleById = function (id) {
    for (let i = 0; i < STYLES.length; i++) if (STYLES[i].id === id) return STYLES[i];
    return STYLES[0];
  };
  const clamp = function (v, a, b) { return D.clamp(v, a, b); };
  const round1 = function (v) { return Math.round(v * 10) / 10; };

  D.games.paperplane = function (host) {
    const canvas = document.getElementById("mg");
    let panel = null;
    let styleBtns = [];
    let angleEl = null;
    let powerEl = null;
    let aimEl = null;
    let resultEl = null;
    let throwBtn = null;

    let phase = "intro";      // intro | npc | fold | aim | fly | talk | done
    let style = STYLES[0];
    let angle = 35;
    let force = 60;
    let charging = false;
    let chargeAt = 0;
    let chargeBase = 60;
    let plane = null;
    const planes = [];
    const turns = [];
    let t = 0;
    const windSeed = Math.random() * 6.283;
    let frozen = false;
    let disposed = false;
    let landingResolve = null;
    let playerResolve = null;
    let dust = null;

    const cast = [
      { key: "boy", x: 170, y: 252, face: "right", dir: 1, phase: 0 },
      { key: "friend", x: 250, y: 252, face: "right", dir: 1, phase: 1.3 },
      { key: "girl", x: 330, y: 252, face: "left", dir: -1, phase: 0.6 }
    ];

    // ------------------------------------------------------------ 面板

    function buildPanel() {
      panel = document.createElement("section");
      panel.id = "plane";
      panel.className = "plane-panel";
      panel.hidden = true;
      panel.setAttribute("aria-label", "纸飞机");
      panel.innerHTML =
        '<div class="plane-styles" id="planeStyles">' +
          STYLES.map(function (s, i) {
            return '<button type="button" data-style="' + s.id + '">' +
              '<span class="plane-no">' + (i + 1) + '</span>' +
              '<b>' + s.name + '</b><small>' + s.note + '</small></button>';
          }).join("") +
        '</div>' +
        '<div class="plane-aim" id="planeAim" hidden>' +
          '<div class="plane-readout">' +
            '<span>角度 <b id="planeAngle">35°</b></span>' +
            '<span>力度</span>' +
            '<div class="plane-power"><i id="planePower"></i></div>' +
          '</div>' +
          '<div class="plane-btns">' +
            '<button type="button" data-act="angleDown" aria-label="角度小一点">角度 −</button>' +
            '<button type="button" data-act="angleUp" aria-label="角度大一点">角度 +</button>' +
            '<button type="button" data-act="powerDown" aria-label="力度小一点">力度 −</button>' +
            '<button type="button" data-act="powerUp" aria-label="力度大一点">力度 +</button>' +
            '<button type="button" id="planeThrow">扔出去</button>' +
          '</div>' +
        '</div>' +
        '<p class="plane-result" id="planeResult"></p>' +
        '<p class="plane-tip">1–3 折法 · ← → 角度 · ↑ ↓ 力度 · 空格蓄力，松手扔</p>';
      document.getElementById("stage").appendChild(panel);

      angleEl = panel.querySelector("#planeAngle");
      powerEl = panel.querySelector("#planePower");
      aimEl = panel.querySelector("#planeAim");
      resultEl = panel.querySelector("#planeResult");
      throwBtn = panel.querySelector("#planeThrow");
      styleBtns = Array.prototype.slice.call(panel.querySelectorAll("[data-style]"));

      styleBtns.forEach(function (btn) {
        btn.addEventListener("click", guard(function () { chooseStyle(btn.dataset.style); }));
      });
      panel.querySelectorAll("[data-act]").forEach(function (btn) {
        btn.addEventListener("click", guard(function () { act(btn.dataset.act); }));
      });
      throwBtn.addEventListener("click", guard(function () { releaseThrow(); }));
      render();
    }

    function render() {
      if (!panel) return;
      styleBtns.forEach(function (b) { b.classList.toggle("on", b.dataset.style === style.id); });
      if (angleEl) angleEl.textContent = Math.round(angle) + "°";
      if (powerEl) powerEl.style.width = Math.round(clamp(force, 0, 100)) + "%";
      if (aimEl) aimEl.hidden = phase !== "aim";
      if (throwBtn) throwBtn.disabled = phase !== "aim";
      panel.classList.toggle("aiming", phase === "aim");
      panel.classList.toggle("flying", phase === "fly");
    }

    // ------------------------------------------------------------ 折法 / 角度 / 力度

    function chooseStyle(id) {
      if (disposed || frozen) return;
      if (phase !== "fold" && phase !== "aim") return;
      style = styleById(id);
      if (phase === "fold") {
        phase = "aim";
        if (resultEl) resultEl.textContent = "";
        D.hint(null);
      }
      try { D.audio.click(); } catch (error) { /* 声音不是玩法前置 */ }
      render();
    }

    function act(what) {
      if (disposed || frozen || phase !== "aim") return;
      if (what === "angleUp") angle = clamp(angle + 5, 15, 60);
      else if (what === "angleDown") angle = clamp(angle - 5, 15, 60);
      else if (what === "powerUp") force = clamp(force + 4, 0, 100);
      else if (what === "powerDown") force = clamp(force - 4, 0, 100);
      try { D.audio.blip(); } catch (error) { /* 同上 */ }
      render();
    }

    function startCharge() {
      if (disposed || frozen || charging || phase !== "aim") return;
      charging = true;
      chargeAt = t;
      chargeBase = force;
    }

    // ------------------------------------------------------------ 物理

    function throwPlane(who, styleObj, ang, forceVal) {
      const rad = ang * Math.PI / 180;
      const power = 120 + forceVal * 1.8;
      const sx = START[who] + 12;
      plane = {
        who: who,
        style: styleObj,
        angle: ang,
        power: forceVal,
        x: sx,
        y: HAND_Y,
        startX: sx,
        vx: Math.cos(rad) * power * styleObj.speed,
        vy: -Math.sin(rad) * power * styleObj.speed,
        frame: styleObj.frame,
        landed: false,
        slide: 0,
        age: 0
      };
      phase = "fly";
      charging = false;
      D.hint(null);
      render();
      return new Promise(function (resolve) { landingResolve = resolve; });
    }

    function releaseThrow() {
      if (disposed || frozen || phase !== "aim") return;
      charging = false;
      const s = style;
      const a = angle;
      const f = Math.round(force);
      throwPlane("me", s, a, f).then(function (pl) {
        if (disposed || !pl) return;
        if (resultEl) resultEl.textContent = "飞出去 " + round1(pl.distance) + " 米。";
        const resolve = playerResolve;
        playerResolve = null;
        if (resolve) resolve(pl);
      });
    }

    function playerTurn() {
      return new Promise(function (resolve) { playerResolve = resolve; });
    }

    function finishFlight() {
      if (!plane || phase !== "fly") return;
      const pl = plane;
      pl.distance = Math.max(0, (pl.x - pl.startX) / 12);
      planes.push({ x: pl.x, y: GROUND, frame: pl.frame, style: pl.style.id, who: pl.who });
      turns.push({
        who: pl.who,
        style: pl.style.id,
        angle: Math.round(pl.angle),
        power: pl.power,
        distance: round1(pl.distance),
        x: Math.round(pl.x)
      });
      plane = null;
      phase = "talk";
      try { D.audio.blip(); } catch (error) { /* 同上 */ }
      const resolve = landingResolve;
      landingResolve = null;
      if (resolve) resolve({ distance: pl.distance, x: pl.x, style: pl.style.id, who: pl.who });
    }

    function stepFlight(dt) {
      const pl = plane;
      const steps = 2;
      for (let i = 0; i < steps; i++) {
        const h = dt / steps;
        // 风只造成少量横向偏移，不会让飞机掉头。
        const wind = Math.sin(t * 0.9 + windSeed) * 8 * (1.25 - pl.style.stability);
        pl.vy += (GRAVITY - LIFT * pl.style.lift) * h;
        pl.vx *= (1 - DRAG * pl.style.drag * h);
        pl.vy *= (1 - DRAG * 0.4 * h);
        pl.x += (pl.vx + wind) * h;
        pl.y += pl.vy * h;
        pl.age += h;
        if (!isFinite(pl.x) || !isFinite(pl.y)) {
          pl.x = pl.startX + 24;
          pl.y = GROUND;
          pl.landed = true;
          break;
        }
        if (pl.y >= GROUND) { pl.y = GROUND; pl.landed = true; break; }
        if (pl.x >= W - 12) { pl.x = W - 12; pl.landed = true; break; }
        if (pl.x <= 10) { pl.x = 10; pl.landed = true; break; }
      }
      if (pl.landed) {
        pl.slide = 0;
        dust = { x: pl.x, y: GROUND, t: 0 };
      }
    }

    function update(dt) {
      if (frozen || disposed) return;
      t += dt;

      if (phase === "aim" && charging) {
        force = Math.min(100, chargeBase + (t - chargeAt) * 46);
        render();
        // 松开空格（或松开鼠标）就投出去
        if (!D.keys[" "]) releaseThrow();
      } else if (phase === "fly" && plane) {
        if (!plane.landed) stepFlight(dt);
        else {
          plane.slide += dt;
          plane.x = clamp(plane.x + plane.vx * 0.18 * dt, 8, W - 10);
          if (plane.slide > 0.3) finishFlight();
        }
      }

      if (dust) {
        dust.t += dt;
        if (dust.t > 0.4) dust = null;
      }
      for (const a of cast) a.phase += dt * 0.5;
    }

    // ------------------------------------------------------------ 画

    function drawPlane(ctx, x, y, frame, rot) {
      const sheet = D.img.planeSheet;
      const s = 1.7;
      ctx.save();
      ctx.translate(Math.round(x), Math.round(y));
      if (rot) ctx.rotate(rot);
      if (sheet) ctx.drawImage(sheet, frame * 16, 0, 16, 16, -8 * s, -8 * s, 16 * s, 16 * s);
      else { ctx.fillStyle = "#fff9e9"; ctx.fillRect(-7, -3, 14, 6); }
      ctx.restore();
    }

    function drawDust(ctx, d) {
      const k = 1 - d.t / 0.4;
      ctx.save();
      ctx.globalAlpha = 0.5 * k;
      ctx.fillStyle = "#e8dcc6";
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(Math.round(d.x - 8 + i * 7), Math.round(d.y - 2 - k * 3), 2, 2);
      }
      ctx.restore();
    }

    /** 抛物线预览只画前 0.6 秒，不告诉玩家落点。 */
    function drawPreview(ctx) {
      const rad = angle * Math.PI / 180;
      const power = 120 + force * 1.8;
      let x = START.me + 12;
      let y = HAND_Y;
      let vx = Math.cos(rad) * power * style.speed;
      let vy = -Math.sin(rad) * power * style.speed;
      const h = 1 / 120;
      ctx.save();
      for (let i = 0; i < 72; i++) {
        vy += (GRAVITY - LIFT * style.lift) * h;
        vx *= (1 - DRAG * style.drag * h);
        vy *= (1 - DRAG * 0.4 * h);
        x += vx * h;
        y += vy * h;
        if (i % 4 === 0) {
          // 深色描边 + 暖色点：落在浅色墙面上也看得见。
          ctx.globalAlpha = 0.75;
          ctx.fillStyle = "#2a2230";
          ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 4, 4);
          ctx.globalAlpha = 0.95;
          ctx.fillStyle = "#ffe0ae";
          ctx.fillRect(Math.round(x), Math.round(y), 2, 2);
        }
        if (y >= GROUND || x > W - 8) break;
      }
      ctx.restore();
    }

    function draw(ctx) {
      const bg = D.img.field || D.img.exterior;
      if (bg) ctx.drawImage(bg, 0, 0, W, H);
      else { ctx.fillStyle = "#2a2430"; ctx.fillRect(0, 0, W, H); }

      // 一条不显眼的粉笔线：地上的落点都在它附近，不做刻度。
      // 新操场的草皮/跑道交界在 y≈220，人站在 y≈252 的跑道上，所以落点线还是留在这里。
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = "#f1e2c8";
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(12, GROUND + 1);
      ctx.lineTo(W - 12, GROUND + 1);
      ctx.stroke();
      ctx.restore();

      for (const p of planes) drawPlane(ctx, p.x, p.y, p.frame, -0.06);
      if (dust) drawDust(ctx, dust);

      const list = cast.slice().sort(function (a, b) { return a.y - b.y; });
      for (const a of list) D.shadow(ctx, a.x, a.y + 1, D.FRAME_W * (a.scale || 1));
      for (const a of list) D.drawActor(ctx, a, t);

      if (plane) {
        const rot = plane.landed ? -0.1 : Math.atan2(plane.vy, plane.vx);
        drawPlane(ctx, plane.x, plane.y, plane.frame, rot);
      }
      if (phase === "aim") drawPreview(ctx);
    }

    // ------------------------------------------------------------ 回合

    async function autoTurn(who, styleObj, ang, forceVal, before, after) {
      phase = "npc";
      if (panel) D.ui.hide(panel);
      if (before && before.length) {
        await D.lines(before);
        if (disposed) return;
      }
      await throwPlane(who, styleObj, ang, forceVal);
      if (disposed) return;
      if (after && after.length) await D.lines(after);
    }

    function commentFor(pl) {
      // 只换一句短评，不排行、不结算。
      if (pl.x >= W - 46 || pl.x <= 46) return ["朱里", "差一点就飞到树上了。"];
      if (pl.distance >= 18) return ["由乃", "你是不是偷偷练过。"];
      return ["由乃", "原来你也不会。"];
    }

    function judgeWinner() {
      if (!turns.length) return "tie";
      const max = Math.max.apply(null, turns.map(function (x) { return x.distance; }));
      const top = turns.filter(function (x) { return Math.abs(x.distance - max) <= 0.6; });
      return top.length === 1 ? top[0].who : "tie";
    }

    async function run() {
      D.objective("纸飞机", "三个人轮流扔，不排名");
      D.hint("先看由乃扔一次。", 2600);

      // 由乃：宽翼、55 度、力度 35，飞得很近。
      await autoTurn("yuno", styleById("wide"), 55, 35, null, [
        ["由乃", "怎么才飞这么远？"],
        ["和臣", "你是不是没折好？"],
        ["由乃", "你来试试！"]
      ]);
      if (disposed) return;

      // 轮到玩家：挑折法 → 调角度 / 力度 → 扔。
      phase = "fold";
      if (panel) {
        panel.hidden = false;
        D.ui.show(panel);
      }
      render();
      D.hint("挑一种折法：1 尖头 / 2 宽翼 / 3 方头", 0);

      const mine = await playerTurn();
      if (disposed || !mine) return;
      await D.lines([commentFor(mine)]);
      if (disposed) return;

      // 朱里：方头、40 度、力度 55，上下浮动 10%。
      const jitter = 0.9 + Math.random() * 0.2;
      await autoTurn("jurie", styleById("square"), 40, Math.round(55 * jitter), null, [
        ["朱里", "看来我也不太会。"],
        ["和臣", "比我第一次好。"],
        ["旁白", "她笑了一下。我忽然有点不敢看她。"]
      ]);
      if (disposed) return;

      await D.lines([["旁白", "三架纸飞机都落在操场上。"]]);
      if (disposed) return;

      phase = "done";
      if (panel) D.ui.hide(panel);

      const mineTurn = turns.filter(function (x) { return x.who === "me"; })[0] || turns[0];
      const winner = judgeWinner();
      const best = mineTurn ? mineTurn.distance : 0;
      const landedX = mineTurn ? clamp(round1(mineTurn.x / W), 0.07, 0.93) : null;
      host.persist({
        paperPlaneBest: best,
        paperPlaneStyle: mineTurn ? mineTurn.style : style.id,
        paperPlaneWinner: winner,
        paperPlaneLanded: landedX == null ? null : {
          x: landedX,
          y: 0.93,
          style: mineTurn.style,
          angle: mineTurn.angle,
          power: mineTurn.power,
          distance: best
        }
      });
      host.done({
        id: "paperplane",
        completed: true,
        best: best,
        style: mineTurn ? mineTurn.style : style.id,
        winner: winner,
        turns: turns.map(function (x) {
          return { who: x.who, style: x.style, distance: x.distance };
        })
      });
    }

    // ------------------------------------------------------------ 输入

    function startChargeFromCanvas() {
      startCharge();
    }

    function onPointerDown(event) {
      if (disposed || frozen || phase !== "aim" || D.dialogOpen()) return;
      if (event.button != null && event.button !== 0) return;
      startChargeFromCanvas();
      try { canvas.setPointerCapture(event.pointerId); } catch (error) { /* 旧浏览器 */ }
      event.preventDefault();
    }

    function onPointerUp(event) {
      if (!charging) return;
      try { canvas.releasePointerCapture(event.pointerId); } catch (error) { /* ignore */ }
      releaseThrow();
    }

    function press(key) {
      if (disposed || frozen) return;
      if (phase === "fold") {
        const n = Number(key);
        if (n >= 1 && n <= STYLES.length) { chooseStyle(STYLES[n - 1].id); return; }
        if (key === "ArrowLeft" || key === "ArrowRight") {
          const at = STYLES.indexOf(style);
          style = STYLES[clamp(at + (key === "ArrowRight" ? 1 : -1), 0, STYLES.length - 1)];
          try { D.audio.blip(); } catch (error) { /* 同上 */ }
          render();
          return;
        }
        if (key === "Enter" || key === " ") chooseStyle(style.id);
        return;
      }
      if (phase !== "aim") return;
      if (key === "ArrowLeft") { angle = clamp(angle - 5, 15, 60); try { D.audio.blip(); } catch (e) { /* */ } render(); return; }
      if (key === "ArrowRight") { angle = clamp(angle + 5, 15, 60); try { D.audio.blip(); } catch (e) { /* */ } render(); return; }
      if (key === "ArrowUp") { force = clamp(force + 4, 0, 100); try { D.audio.blip(); } catch (e) { /* */ } render(); return; }
      if (key === "ArrowDown") { force = clamp(force - 4, 0, 100); try { D.audio.blip(); } catch (e) { /* */ } render(); return; }
      if (key === "Enter") { releaseThrow(); return; }
      if (key === " ") startCharge();
    }

    // ------------------------------------------------------------ 壳

    function fail(error) {
      console.error(error);
      if (disposed) return;
      phase = "done";
      host.done({ id: "paperplane", completed: false, error: String(error) });
    }

    function guard(fn) {
      return function (event) {
        try { fn(event); }
        catch (error) { fail(error); }
      };
    }

    function start() {
      D.clearReact();
      host.setChapter("周四 · 最后一节课前 · 操场");
      D.hint(null);
      buildPanel();
      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointercancel", onPointerUp);
      run().catch(fail);
    }

    function dispose() {
      disposed = true;
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      if (panel) {
        D.ui.hide(panel, 0);
        panel.remove();
        panel = null;
      }
      if (landingResolve) {
        const resolve = landingResolve;
        landingResolve = null;
        resolve({ distance: 0, x: 0, style: style.id, who: "me" });
      }
      if (playerResolve) {
        const resolve = playerResolve;
        playerResolve = null;
        resolve(null);
      }
      D.objective(null);
      D.hint(null);
      D.clearReact();
    }

    return {
      id: "paperplane",
      title: "纸飞机",
      start: start,
      update: update,
      draw: draw,
      press: press,
      setFrozen: function (v) { frozen = !!v; },
      dispose: dispose,
      get phase() { return phase; },
      get turn() { return turns.length; },
      get styleId() { return style.id; },
      get angle() { return angle; },
      get force() { return Math.round(force); },
      get turns() { return turns.map(function (x) { return { who: x.who, style: x.style, distance: x.distance, x: x.x }; }); },
      get landed() { return planes.map(function (p) { return { x: p.x, style: p.style, who: p.who }; }); },
      get best() {
        const mine = turns.filter(function (x) { return x.who === "me"; })[0];
        return mine ? mine.distance : null;
      }
    };
  };

})(window);

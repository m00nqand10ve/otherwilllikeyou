/* D06 · 雨里的伞
 *
 * 放学突然下雨。三个人，一把伞（另一把在由乃手里，早就收不拢了）。
 * 玩家只做一件事：把伞端稳。风一阵一阵吹，伞歪了同行的人肩膀就湿。
 *
 * 走近路雨大、风密、先到；走远路雨小、安静、多走一会儿。
 * 淋湿多少、走哪条、和谁共伞，都不判好坏，只换最后那几句。
 */
(function (global) {
  "use strict";

  const D = global.DAILY;
  D.games = D.games || {};

  const ROUTES = {
    near: { label: "近路", duration: 15, drops: 110, windGap: [3.2, 5.0], tip: "近路：人多，雨大，快一点" },
    far: { label: "远路", duration: 22, drops: 72, windGap: [5.5, 7.5], tip: "远路：安静，雨小，慢一点" }
  };

  D.games.umbrella = function (host) {
    const hud = document.getElementById("umbHud");
    const tiltBar = document.getElementById("umbTilt");
    const tipEl = document.getElementById("umbTip");
    const canvas = document.getElementById("mg");

    let state = "intro";     // intro | walk | arrive | done
    let partner = "jurie";   // jurie | yuno | both
    let route = "far";
    let angle = 0;           // -1..1，正数往右倾
    let pointerAngle = null;
    let wet = 0;
    let walked = 0;
    let t = 0;
    let gust = 0;
    let gustT = 0;
    let nextGust = 4;
    let frozen = false;
    let disposed = false;
    let barks = 0;
    let nextBark = 5;
    const drops = [];
    const splashes = [];

    // ------------------------------------------------------------ 雨

    function seedRain() {
      drops.length = 0;
      const n = ROUTES[route].drops;
      for (let i = 0; i < n; i++) {
        drops.push({
          x: Math.random() * D.W,
          y: Math.random() * D.H,
          len: 6 + Math.random() * 10,
          speed: 150 + Math.random() * 160
        });
      }
    }

    function seedSplash(x) {
      splashes.push({ x: x, y: 250 + Math.random() * 24, t: 0 });
      if (splashes.length > 14) splashes.shift();
    }

    // ------------------------------------------------------------ 站位
    // 撑着伞的人站在同伴左边（manifest: left-of-partner-when-facing-right）。
    // 两人：和臣 x=244 撑伞，同伴 x=288；三人：朱里 x=206 撑伞、由乃 250 在伞下、
    // 和臣 330 在伞外淋雨。
    // 间距 44：40 时两个人的头发相接，42 时倾斜的伞杆还会擦着同伴的书包，
    // 44 两样才都让开（游戏里的样子见 06-umbrella-walk.png / 06-umbrella-three.png）。

    const SPOT = {
      two: { holder: 244, partner: 288, feet: 256 },
      three: { holder: 206, friend: 250, outsider: 330, feet: 256 }
    };

    function castNow() {
      const walk = state === "walk";
      if (partner === "both") {
        const holder = {
          key: HOLDERS.girl.key, umb: "girl", x: SPOT.three.holder, y: SPOT.three.feet,
          dir: 1, face: "right", moving: walk, phase: 0.4
        };
        const friend = {
          key: "friend", x: SPOT.three.friend, y: SPOT.three.feet,
          dir: 1, face: "right", moving: walk, phase: 0.9
        };
        const boy = {
          key: "boy", x: SPOT.three.outsider, y: SPOT.three.feet,
          dir: 1, face: "right", moving: walk, phase: 0
        };
        return { holder: holder, companions: [friend, boy], all: [friend, boy, holder] };
      }
      const holder = {
        key: HOLDERS.boy.key, umb: "boy", x: SPOT.two.holder, y: SPOT.two.feet,
        dir: 1, face: "right", moving: walk, phase: 0
      };
      const mate = {
        key: partner === "jurie" ? "girl" : "friend", x: SPOT.two.partner, y: SPOT.two.feet,
        dir: 1, face: "right", moving: walk, phase: 0.5
      };
      return { holder: holder, companions: [mate], all: [mate, holder] };
    }

    function effective() {
      return D.clamp(angle + gust, -1, 1);
    }

    // ------------------------------------------------------------ 伞与握点
    // 数字全抄自 manifest（file:// 下不能 fetch，所以写在这里，改图时两边一起改；
    // act6/tools/check.cjs 会拿磁盘上的 manifest 和这里对一遍）：
    //   assets/minigame/act6/manifest.json                   伞 96×96×5，握点 (48,68)，层顺序 back→companion→holder→front→hand
    //   assets/characters/{boy,girl}/v2/umbrella/manifest.json  举伞帧 5 帧，握点逐帧不同

    const UMB = {
      frame: 96,
      grip: [48, 68],
      back: "umbBack",
      front: "umbFront"
    };

    const HOLDERS = {
      boy: {
        key: "boyUmb",
        hand: "boyUmbHand",
        grip: [[37, 41], [37, 41], [37, 41], [37, 43], [37, 43]]
      },
      girl: {
        key: "girlUmb",
        hand: "girlUmbHand",
        grip: [[40, 42], [40, 41], [40, 42], [40, 42], [40, 42]]
      }
    };

    const WALK_FPS = 8;          // core.js 里没登记的角色默认 8 帧/秒
    const ORDER = ["umbBack", "companion", "holder", "umbFront", "handFront"];
    let frameOrder = [];

    /** 持伞人现在画的是第几帧。和 core.js drawActor 的取帧算式一致（walkRight 1–4）。 */
    function holderFrame(a) {
      if (!a.moving) return 0;
      return 1 + (Math.floor(t * WALK_FPS + (a.phase || 0)) % 4);
    }

    /** 人物实际绘制矩形，和 core.js drawActor 的 x/y/w/h 一致。 */
    function actorRect(a) {
      const s = (a.scale == null ? 1 : a.scale) * (a.size == null ? 1 : a.size) *
        (D.CHARACTER_SCALE || 1.4);
      const w = D.FRAME_W * s;
      const h = D.FRAME_H * s;
      return { s: s, w: w, h: h, x: Math.round(a.x - w / 2), y: Math.round(a.y - h) };
    }

    /** 当前帧的拳心（画布坐标）和伞该画到哪。两层伞共用同一个矩形。 */
    function umbrellaAnchor(a) {
      const H = HOLDERS[a.umb];
      const rect = actorRect(a);
      const f = holderFrame(a);
      const g = H.grip[f];
      const hand = {
        x: rect.x + g[0] * rect.w / D.FRAME_W,
        y: rect.y + g[1] * rect.h / D.FRAME_H
      };
      const size = UMB.frame * rect.s;
      return {
        frame: f,
        hand: hand,
        grip: g,
        actor: rect,
        handSheet: D.img[H.hand],
        rect: {
          x: Math.round(hand.x - UMB.grip[0] * size / UMB.frame),
          y: Math.round(hand.y - UMB.grip[1] * size / UMB.frame),
          w: size,
          h: size
        }
      };
    }

    /** 倾斜已经是五个画好的帧，代码不再 rotate；风力映射到 0–4。 */
    function tiltFrame() {
      const f = Math.round((effective() + 1) * 2);
      return D.clamp(f, 0, 4);
    }

    function drawUmbrellaLayer(ctx, anchor, key) {
      const sheet = D.img[key];
      if (!sheet) return false;
      const f = tiltFrame();
      const r = anchor.rect;
      ctx.drawImage(sheet, f * UMB.frame, 0, UMB.frame, UMB.frame, r.x, r.y, r.w, r.h);
      return true;
    }

    /** 手前景：整帧（只有 3×5 的拳头是不透明的）画在人物同一个矩形上，像素完全对齐。 */
    function drawHolderHand(ctx, anchor) {
      const sheet = anchor.handSheet;
      if (!sheet) return false;
      const r = anchor.actor;
      ctx.drawImage(sheet, anchor.frame * D.FRAME_W, 0, D.FRAME_W, D.FRAME_H, r.x, r.y, r.w, r.h);
      return true;
    }

    // ------------------------------------------------------------ 画面

    function drawShoulders(ctx, list, dark) {
      if (!dark) return;
      for (const a of list) {
        ctx.save();
        ctx.globalAlpha = 0.5 * wet;
        ctx.fillStyle = "#2a2a3a";
        ctx.beginPath();
        ctx.ellipse(a.x + 6, a.y - 46, 9, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    function drawRain(ctx) {
      const a = effective();
      const slant = a * 0.32 + gust * 0.4;
      ctx.save();
      ctx.strokeStyle = "rgba(190,205,225,.42)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const d of drops) {
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + slant * d.len, d.y + d.len);
      }
      ctx.stroke();
      ctx.restore();

      for (const s of splashes) {
        const k = D.clamp(s.t / 0.4, 0, 1);
        ctx.save();
        ctx.globalAlpha = (1 - k) * 0.5;
        ctx.strokeStyle = "#c8d6e6";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, 2 + k * 6, 0.8 + k * 2, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    function draw(ctx) {
      const bg = D.img.dusk || D.img.exterior;
      if (bg) ctx.drawImage(bg, 0, 0, D.W, D.H);
      // 傍晚 + 阴雨：整体压暗压蓝
      ctx.fillStyle = "rgba(24,30,54,.46)";
      ctx.fillRect(0, 0, D.W, D.H);

      // 走路时地面轻微横移，代替卷轴
      const sway = state === "walk" ? Math.sin(t * 2.4) * 3 : 0;
      ctx.save();
      ctx.translate(sway, 0);

      const cast = castNow();
      const anchor = umbrellaAnchor(cast.holder);
      frameOrder = [];

      for (const a of cast.all) D.shadow(ctx, a.x, a.y + 1, D.FRAME_W);

      // 顺序以 manifest 的 layerOrder 为准：
      // 伞后层 → 同伴 → 持伞人 → 伞前层 → 手前景。
      // 伞杆先画，倾斜时才会从头发和身体后面过去；拳头最后画，才压在伞杆上。
      if (drawUmbrellaLayer(ctx, anchor, UMB.back)) frameOrder.push("umbBack");

      for (const a of cast.companions) {
        D.drawActor(ctx, a, t);
        frameOrder.push("companion");
      }

      D.drawActor(ctx, cast.holder, t);
      frameOrder.push("holder");

      // 湿肩压在人物上、伞面和拳头下
      drawShoulders(ctx, cast.companions, wet > 0.18);

      if (drawUmbrellaLayer(ctx, anchor, UMB.front)) frameOrder.push("umbFront");
      if (drawHolderHand(ctx, anchor)) frameOrder.push("handFront");

      ctx.restore();

      drawRain(ctx);

      // 进度：走到头之前只在最下面留一条很细的线
      if (state === "walk") {
        ctx.fillStyle = "rgba(255,212,151,.6)";
        ctx.fillRect(0, D.H - 2, Math.round(D.W * D.clamp(walked, 0, 1)), 2);
      }
    }

    // ------------------------------------------------------------ 每帧

    function update(dt) {
      t += dt;

      for (const d of drops) {
        const speed = d.speed * (route === "near" ? 1.15 : 1);
        d.y += speed * dt;
        d.x += D.clamp(effective() * 0.32 + gust * 0.4, -1, 1) * 60 * dt;
        if (d.y > D.H + 8) {
          d.y = -10;
          d.x = Math.random() * D.W;
          if (Math.random() < 0.3) seedSplash(d.x);
        }
        if (d.x < -20) d.x = D.W + 10;
        if (d.x > D.W + 20) d.x = -10;
      }
      for (let i = splashes.length - 1; i >= 0; i--) {
        splashes[i].t += dt;
        if (splashes[i].t > 0.4) splashes.splice(i, 1);
      }

      if (state !== "walk" || frozen || D.dialogOpen()) return;

      // 按键 / 指针调整角度
      const ax = D.axisX();
      if (ax !== 0) {
        angle = D.clamp(angle + ax * dt * 2.0, -1, 1);
        pointerAngle = null;
      } else if (pointerAngle != null) {
        angle += (pointerAngle - angle) * Math.min(1, dt * 6);
      }

      // 风：隔几秒来一阵，持续一秒多
      nextGust -= dt;
      if (nextGust <= 0 && gustT <= 0) {
        gustT = 1.2;
        // 阵风要能真的把伞吹歪：不操作时也会积一点湿肩。
        gust = (Math.random() < 0.5 ? -1 : 1) * (0.26 + Math.random() * 0.22);
        nextGust = D.lerp(ROUTES[route].windGap[0], ROUTES[route].windGap[1], Math.random());
        seedSplash(120 + Math.random() * 280);
      }
      if (gustT > 0) {
        gustT -= dt;
        if (gustT <= 0) { gustT = 0; gust = 0; }
      }

      // 伞歪到一定程度，同行的人肩膀开始湿（和臣自己不画）
      const over = Math.max(0, Math.abs(effective()) - 0.30);
      wet = D.clamp(wet + over * dt * (route === "near" ? 0.72 : 0.55), 0, 1);

      if (tiltBar) {
        tiltBar.style.left = (50 + effective() * 45).toFixed(1) + "%";
        tiltBar.classList.toggle("over", over > 0.02);
      }

      walked += dt / ROUTES[route].duration;

      // 路上偶尔一句，不打断操作
      nextBark -= dt;
      if (nextBark <= 0 && barks < 3) {
        barks++;
        nextBark = 5 + Math.random() * 3;
        const who = partner === "jurie" ? "朱里" : partner === "yuno" ? "由乃" : "朱里";
        const lines = [
          "前面有个水坑。",
          "你伞拿歪了。",
          "走慢一点也行。",
          "雨好像小了一点。"
        ];
        D.react(who, lines[Math.floor(Math.random() * lines.length)], 1600);
      }

      if (walked >= 1) {
        walked = 1;
        arrive();
      }
    }

    // ------------------------------------------------------------ 结尾

    async function arrive() {
      state = "arrive";
      if (hud) hud.hidden = true;
      D.hint(null);
      D.clearReact();

      const veryWet = wet > 0.55;
      let lines;
      if (partner === "both") {
        lines = [
          ["朱里", "你怎么不打伞？"],
          ["和臣", "伞不够。"],
          ["由乃", "……你是不是傻。"],
          ["旁白", "雨落在身上，反而没那么冷。"]
        ];
      } else if (partner === "yuno") {
        lines = [
          ["由乃", "你伞拿歪了。"],
          ["和臣", "风太大了。"],
          ["由乃", "嗯。风太大。"],
          ["旁白", "她没有再说什么。"]
        ];
      } else {
        lines = [
          ["朱里", "你肩膀湿了。"],
          ["和臣", "没事。"],
          ["朱里", "下次带大一点的伞。"],
          ["旁白", "她说下次。我记住了这两个字。"]
        ];
      }
      if (veryWet && partner !== "both") {
        lines.push(["旁白", "说到一半，她看了一眼我右肩，没再说下去。"]);
      }
      // 近路和远路各留一句，别让路线选择只影响时长。
      lines.push(route === "near"
        ? ["旁白", "近路的屋檐下站满了人，我们挤着走完了最后一段。"]
        : ["旁白", "远路多绕了一个路口，雨在伞上慢慢变小。"]);

      await D.lines(lines);
      if (disposed) return;

      state = "done";
      D.persist({
        umbrellaCompleted: true,
        umbrellaRoute: route,
        umbrellaPartner: partner,
        umbrellaWet: Number(wet.toFixed(2))
      });
      host.done({ id: "umbrella", completed: true, route: route, partner: partner, wet: wet });
    }

    // ------------------------------------------------------------ 流程

    async function run() {
      D.objective("把伞端稳，送她们回家", "← → 调整方向");
      seedRain();

      await D.lines([
        ["旁白", "放学的时候，天已经下起来了。"],
        ["旁白", "由乃从书包里抽出两把伞，一把撑开就卡住了。"],
        ["由乃", "……这把坏了。"],
        ["朱里", "那就一把。"],
        ["旁白", "雨打在楼前的台阶上，一片响。"]
      ]);
      if (disposed) return;

      const who = await host.choose("一把伞，怎么走。", ["和朱里一起撑", "和由乃一起撑", "把伞给她们，我自己淋"]);
      partner = who === 0 ? "jurie" : who === 1 ? "yuno" : "both";
      if (disposed) return;

      const which = await host.choose("走哪边。", ["走近路", "走远路"]);
      route = which === 0 ? "near" : "far";
      seedRain();
      if (disposed) return;

      if (partner === "both") {
        await D.lines([
          ["和臣", "你们撑吧。我没事。"],
          ["由乃", "……那你走里面。"],
          ["旁白", "她们俩挤在一把伞下面，走得很慢。"]
        ]);
      } else {
        await D.lines([
          [partner === "jurie" ? "朱里" : "由乃", "你撑中间一点。"],
          ["和臣", "知道。"],
          ["旁白", "伞面不大，两个人的肩膀刚好都露在外面一点。"]
        ]);
      }
      if (disposed) return;

      state = "walk";
      if (hud) hud.hidden = false;
      if (tipEl) tipEl.textContent = ROUTES[route].tip;   // HUD 上已经写着，别再压一条提示在人物脸上
    }

    // ------------------------------------------------------------ 壳

    function start() {
      D.clearReact();
      host.setChapter("第 5 天 · 放学后");
      D.hint(null);
      seedRain();

      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerleave", onPointerLeave);

      run().catch(function (error) {
        console.error(error);
        state = "done";
        host.done({ id: "umbrella", completed: false, error: String(error) });
      });
    }

    function onPointerMove(e) {
      if (state !== "walk") return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width) return;
      pointerAngle = D.clamp(((e.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
    }

    function onPointerLeave() {
      pointerAngle = null;
    }

    function press(key) {
      // 方向键是按住调整的，这里不用单次按键
      if (state === "walk" && key.toLowerCase() === "escape") walked = 1;
    }

    function dispose() {
      disposed = true;
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      if (hud) hud.hidden = true;
      D.objective(null);
      D.hint(null);
      D.clearReact();
    }

    return {
      id: "umbrella",
      title: "雨里的伞",
      start: start,
      update: update,
      draw: draw,
      press: press,
      setFrozen: function (v) { frozen = !!v; },
      dispose: dispose,
      get state() { return state; },
      get angle() { return effective(); },
      get wet() { return wet; },
      get partner() { return partner; },
      get route() { return route; },
      setWet: function (v) { wet = D.clamp(v, 0, 1); },
      finishWalk: function () { walked = 1; },
      /** 自检用：这一帧实际怎么摆的。不改任何状态。 */
      get debug() {
        const cast = castNow();
        const anchor = umbrellaAnchor(cast.holder);
        const mate = cast.companions[0];
        return {
          order: frameOrder.slice(),
          layerOrder: ORDER.slice(),
          people: cast.all.length,
          holderKey: cast.holder.key,
          holderX: cast.holder.x,
          partnerKey: mate.key,
          partnerX: mate.x,
          spacing: mate.x - cast.holder.x,
          spots: cast.all.map(function (a) { return { key: a.key, x: a.x }; }),
          hand: [anchor.hand.x, anchor.hand.y],
          umbrella: [anchor.rect.x, anchor.rect.y, anchor.rect.w],
          grip: UMB.grip.slice(),
          holderGrip: anchor.grip.slice(),
          holderFrame: anchor.frame,
          tiltFrame: tiltFrame(),
          wet: wet
        };
      }
    };
  };

})(window);






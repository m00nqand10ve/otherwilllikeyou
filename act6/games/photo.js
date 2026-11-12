/* D03 · 留一张照片
 *
 * 由乃带了相机，要给三个人拍一张合照。取景框是 DOM（不是截图）：背景一层、
 * 三个人的精灵一层，位置都记成取景框里的百分比，所以同一张照片在任何大小
 * 的格子里都能原样重画一遍——底片条、挑选、以后结尾卡复用，都走同一份数据。
 *
 * 不评分，也不管「和谁站得近」。快门按下去只是把这一刻留下来。
 */
(function (global) {
  "use strict";

  const D = global.DAILY;
  D.games = D.games || {};

  const BG = "../assets/scenes/act6/school_playground_512.png";
  const SPRITE = {
    boy: "../assets/characters/boy/v2/boy_sheet_act5.png",
    girl: "../assets/characters/girl/v2/girl_sheet_act5.png",
    friend: "../assets/characters/friend/v2/friend_sheet_act5.png"
  };
  const WHO_NAME = { boy: "和臣", girl: "朱里", friend: "由乃" };

  // 远景看得见整个操场，人物小；近景往里推一点，人占得多。
  const ZOOM = {
    far: { height: 40, bg: 1, frame: 0 },
    near: { height: 58, bg: 1.22, frame: 1 }
  };

  const EVENTS = ["normal", "blink", "face", "passerby", "wind"];

  const COMMENT = {
    normal: [["朱里", "……还行。"], ["由乃", "那就这张。"]],
    blink: [["朱里", "我眨眼了。"], ["由乃", "这张好，像你。"]],
    face: [["朱里", "由乃，你正常一点。"], ["由乃", "我挺好的啊。"]],
    passerby: [["和臣", "后面那个人是谁。"], ["由乃", "不知道。反正不是我们班的。"]],
    wind: [["由乃", "头发飞起来了。"], ["朱里", "看不太出来。"], ["和臣", "……就这样吧。"]]
  };

  const DEFAULT_POS = [
    { who: "boy", x: 0.30, y: 0.93 },
    { who: "girl", x: 0.50, y: 0.93 },
    { who: "friend", x: 0.71, y: 0.93 }
  ];

  // ------------------------------------------------------------ 一张照片
  // shot = { zoom, event, actors:[{who,x,y}], plane }

  /** 事件 07 落在地上的那架纸飞机：只当作构图里的一个小小状况。 */
  const PLANE_FRAMES = { dart: 0, wide: 1, square: 2 };

  function addPlane(into, plane) {
    if (!plane) return;
    const frame = PLANE_FRAMES[plane.style] == null ? 0 : PLANE_FRAMES[plane.style];
    const node = D.ui.el("div", "photo-plane");
    node.style.left = (D.clamp(Number(plane.x) || 0.5, 0.05, 0.95) * 100).toFixed(2) + "%";
    node.style.backgroundPosition = (frame * 50) + "% 0";
    into.appendChild(node);
  }

  /** 把一个镜头画进任意容器：底片缩略图、挑选时的大图、取景框本身都走这里。 */
  function renderShot(into, shot, live) {
    into.replaceChildren();
    into.classList.toggle("near", shot.zoom === "near");

    const bg = D.ui.el("div", "photo-bg");
    bg.style.backgroundImage = "url(" + BG + ")";
    bg.style.transform = "scale(" + ZOOM[shot.zoom].bg + ")";
    into.appendChild(bg);

    addPlane(into, shot.plane);

    for (let i = 0; i < shot.actors.length; i++) {
      const p = shot.actors[i];
      const node = makeActor(p, shot, live);
      node.dataset.index = String(i);
      if (live) node.dataset.live = "1";
      into.appendChild(node);
    }

    applyFx(into, shot);
    layout(into, shot);
    return into;
  }

  function makeActor(p, shot, live) {
    const node = D.ui.el("div", "photo-actor who-" + p.who);
    node.dataset.who = p.who;
    const body = D.ui.el("div", "pa-body");
    const sheet = D.img[p.who];
    if (sheet) {
      const frames = Math.max(1, Math.round(sheet.width / D.FRAME_W));
      body.style.backgroundImage = "url(" + SPRITE[p.who] + ")";
      body.style.backgroundSize = (frames * 100) + "% 100%";
      // 站着的时候取第一帧；做鬼脸的那个换个姿势（由乃那一格偏一点）
      let f = 0;
      if (shot.event === "face" && p.who === "friend") f = Math.min(1, frames - 1);
      body.style.backgroundPosition = ((frames === 1 ? 0 : f / (frames - 1) * 100).toFixed(3)) + "% 0";
    }
    node.appendChild(body);
    node.style.height = ZOOM[shot.zoom].height + "%";
    if (live) node.title = WHO_NAME[p.who] + " · 拖我";
    return node;
  }

  function applyFx(into, shot) {
    const girl = into.querySelector('.who-girl .pa-body');
    const friend = into.querySelector('.who-friend .pa-body');

    if (shot.event === "blink" && girl) {
      girl.appendChild(D.ui.el("i", "pa-eyes"));
    }
    if (shot.event === "face" && friend) {
      friend.classList.add("pa-lean");
    }
    if (shot.event === "wind" && girl) {
      girl.classList.add("pa-wind");
      girl.appendChild(D.ui.el("i", "pa-streak s1"));
      girl.appendChild(D.ui.el("i", "pa-streak s2"));
    }
    if (shot.event === "passerby") {
      const pass = D.ui.el("div", "photo-passerby");
      const sheet = D.img.npcBoyDown;
      if (sheet) {
        const frames = Math.max(1, Math.round(sheet.width / D.FRAME_W));
        pass.style.backgroundImage = "url(../assets/characters/npc_generated/boy_walk_down_sheet.png)";
        pass.style.backgroundSize = (frames * 100) + "% 100%";
        pass.style.backgroundPosition = "0% 0";
      }
      into.appendChild(pass);
    }
  }

  /** 位置按百分比落到 DOM 上：脚在 (x,y)，水平居中。 */
  function layout(into, shot) {
    const actors = into.querySelectorAll(".photo-actor");
    for (const node of actors) {
      const i = Number(node.dataset.index);
      const p = shot.actors[i];
      if (!p) continue;
      node.style.left = (p.x * 100).toFixed(2) + "%";
      node.style.top = (p.y * 100).toFixed(2) + "%";
    }
  }

  // 事件 09 结尾要按同一份构图把照片重画一遍，别再写第二套位置换算。
  D.renderPhotoShot = function (into, shot) { return renderShot(into, shot, false); };

  D.games.photo = function (host) {
    const panel = document.getElementById("photo");
    const view = document.getElementById("photoView");
    const frame = document.getElementById("photoFrame");
    const stage = document.getElementById("photoStage");
    const strip = document.getElementById("photoStrip");
    const doneBtn = document.getElementById("photoDone");
    const shutter = document.getElementById("photoShutter");
    const pick = document.getElementById("photoPick");
    const pickList = document.getElementById("photoPickList");
    const keep = document.getElementById("photoKeep");
    const flashEl = document.getElementById("photoFlash");
    const hintEl = document.getElementById("photoHint");

    let phase = "frame";       // frame | pick | done
    let zoom = "far";
    let pos = clone(DEFAULT_POS);
    let selected = 1;          // 0..2
    let shots = [];
    let dragIndex = -1;
    let frozen = false;
    let disposed = false;
    let pickIndex = 0;
    let t = 0;
    let pickTimer = 0;

    // 事件 07 扔完纸飞机紧接着拍这张照片时，操场的地上还留着一架。
    // 没有这个字段就什么都不加，照片和以前一样。
    const planeOpt = (function () {
      const given = host && host.opts && host.opts.plane;
      if (!given) return null;
      const x = Number(given.x);
      if (!isFinite(x)) return null;
      return {
        x: D.clamp(x, 0.05, 0.95),
        y: D.clamp(Number(given.y) || 0.93, 0.62, 0.98),
        style: given.style || "dart"
      };
    })();

    function clone(list) {
      return list.map(function (p) { return { who: p.who, x: p.x, y: p.y }; });
    }

    // ------------------------------------------------------------ 取景

    function snap() {
      return {
        zoom: zoom,
        event: "normal",
        actors: clone(pos),
        plane: planeOpt ? { x: planeOpt.x, y: planeOpt.y, style: planeOpt.style } : null
      };
    }

    function renderLive() {
      renderShot(stage, snap(), true);
      layout(stage, snap());
      refreshSel();
    }

    function refreshSel() {
      const nodes = stage.querySelectorAll(".photo-actor");
      for (const node of nodes) {
        node.classList.toggle("sel", Number(node.dataset.index) === selected);
      }
    }

    function hitTest(clientX, clientY) {
      const nodes = stage.querySelectorAll(".photo-actor");
      let best = -1;
      let bestArea = Infinity;
      for (const node of nodes) {
        const r = node.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
          const area = r.width * r.height;
          if (area < bestArea) { bestArea = area; best = Number(node.dataset.index); }
        }
      }
      return best;
    }

    function clampPos(x, y) {
      return { x: D.clamp(x, 0.07, 0.93), y: D.clamp(y, 0.62, 0.98) };
    }

    function onDown(e) {
      if (phase !== "frame" || frozen || D.dialogOpen() || shots.length >= 3) return;
      const i = hitTest(e.clientX, e.clientY);
      if (i < 0) return;
      dragIndex = i;
      selected = i;
      refreshSel();
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* 旧浏览器 */ }
      e.preventDefault();
      e.stopPropagation();
      D.audio.blip();
    }

    function onMove(e) {
      if (dragIndex < 0) return;
      const r = frame.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const p = clampPos((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      pos[dragIndex].x = p.x;
      pos[dragIndex].y = p.y;
      layout(stage, { actors: pos });
      e.preventDefault();
    }

    function onUp(e) {
      if (dragIndex < 0) return;
      dragIndex = -1;
      try { stage.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }

    function nudge(dx, dy) {
      const p = clampPos(pos[selected].x + dx, pos[selected].y + dy);
      pos[selected].x = p.x;
      pos[selected].y = p.y;
      layout(stage, { actors: pos });
    }

    // ------------------------------------------------------------ 快门

    function pickEvent() {
      // 三张之内不重样：第一张多半是正常的，后面才开始出状况
      const pool = EVENTS.filter(function (ev) {
        return shots.every(function (s) { return s.event !== ev; });
      });
      const list = pool.length ? pool : EVENTS;
      return list[Math.floor(Math.random() * list.length)];
    }

    function doShutter() {
      if (phase !== "frame" || frozen || D.dialogOpen()) return;
      if (shots.length >= 3) return;
      const shot = { zoom: zoom, event: pickEvent(), actors: clone(pos), plane: snap().plane };
      shots.push(shot);

      D.audio.click();
      if (flashEl) {
        flashEl.classList.remove("on");
        void flashEl.offsetWidth;
        flashEl.classList.add("on");
      }
      renderStrip();
      if (hintEl) hintEl.textContent = "还能拍 " + Math.max(0, 3 - shots.length) + " 张";
      if (shots.length >= 3) {
        clearTimeout(pickTimer);
        pickTimer = setTimeout(function () { if (!disposed) enterPick(); }, 720);
      }
    }

    function renderStrip() {
      strip.replaceChildren();
      shots.forEach(function (shot, i) {
        const box = D.ui.el("div", "photo-thumb");
        const inner = D.ui.el("div", "photo-frame small");
        renderShot(inner, shot, false);
        box.appendChild(inner);
        box.appendChild(D.ui.el("i", "photo-no", String(i + 1)));
        strip.appendChild(box);
      });
      doneBtn.hidden = shots.length === 0;
    }

    // ------------------------------------------------------------ 挑一张

    function enterPick() {
      // 只在取景阶段进入，防止延迟定时器把挑选面板重新弹到结尾对白上。
      if (phase !== "frame" || !shots.length) return;
      clearTimeout(pickTimer);
      pickTimer = 0;
      phase = "pick";
      pickIndex = 0;
      view.hidden = true;
      pick.hidden = false;
      D.ui.show(pick);
      renderPickList();
    }

    function renderPickList() {
      pickList.replaceChildren();
      shots.forEach(function (shot, i) {
        const card = D.ui.el("button", "photo-card" + (i === pickIndex ? " on" : ""));
        card.type = "button";
        const inner = D.ui.el("div", "photo-frame small");
        renderShot(inner, shot, false);
        card.appendChild(inner);
        card.appendChild(D.ui.el("span", "photo-card-no", String(i + 1)));
        card.addEventListener("click", function () {
          pickIndex = i;
          D.audio.click();
          renderPickList();
        });
        pickList.appendChild(card);
      });
    }

    function confirmPick() {
      if (phase !== "pick" || !shots.length) return;
      if (frozen || D.dialogOpen()) return;
      clearTimeout(pickTimer);
      pickTimer = 0;
      const shot = shots[pickIndex];
      phase = "done";
      D.audio.right();
      finish(shot);
    }

    async function finish(shot) {
      clearTimeout(pickTimer);
      pickTimer = 0;
      D.ui.hide(pick);
      D.ui.hide(panel);
      await D.sleep(220);
      if (disposed) return;

      const eventLines = COMMENT[shot.event] || COMMENT.normal;
      await D.lines([["旁白", "三个人凑过去看那张照片。"]].concat(eventLines));
      if (disposed) return;
      await D.lines([
        ["由乃", "行吧，就这张。"],
        ["朱里", "存好。"],
        ["旁白", "那天放学后，操场上的光很平。照片里没发生什么，就是三个人站着。"]
      ]);
      if (disposed) return;

      const picked = {
        event: shot.event,
        zoom: shot.zoom,
        positions: shot.actors.map(function (p) {
          return { who: p.who, x: Number(p.x.toFixed(3)), y: Number(p.y.toFixed(3)) };
        }),
        // 地上那架飞机如果进了这张照片，就一起记下来；事件 09 只复现拍到的。
        plane: shot.plane ? { x: Number(shot.plane.x.toFixed(3)), y: Number(shot.plane.y.toFixed(3)), style: shot.plane.style } : null
      };
      D.persist({ photoCompleted: true, photoShots: shots.length, photoPicked: picked });
      host.done({ id: "photo", completed: true, shots: shots.length, picked: picked });
    }

    // ------------------------------------------------------------ 流程

    async function run() {
      D.objective("给三个人拍一张合照", "拖人物 · 近景/远景 · 空格快门");
      D.ui.show(panel);
      renderLive();

      await D.lines([
        ["由乃", "等一下，都别动。"],
        ["和臣", "拍什么。"],
        ["由乃", "合照啊。难得今天光这么好。"],
        ["朱里", "……我不会摆。"],
        ["由乃", "你站那儿就行。和臣，往她那边靠一点。"],
        ["旁白", "由乃举起相机，又放下。"],
        ["由乃", "取景框里看着不对。你自己挪一下吧。"]
      ]);
      if (disposed) return;
      phase = "frame";
      if (hintEl) hintEl.textContent = "拖动三个人 · ← → ↑ ↓ 微调 · 空格快门";
    }

    // ------------------------------------------------------------ 壳

    function start() {
      D.clearReact();
      host.setChapter("第 4 天 · 放学后");
      D.hint(null);

      stage.addEventListener("pointerdown", onDown);
      stage.addEventListener("pointermove", onMove);
      stage.addEventListener("pointerup", onUp);
      stage.addEventListener("pointercancel", onUp);

      shutter.onclick = doShutter;
      doneBtn.onclick = function () { if (frozen || D.dialogOpen()) return; enterPick(); };
      keep.onclick = confirmPick;

      panel.querySelectorAll("[data-zoom]").forEach(function (btn) {
        btn.onclick = function () {
          if (phase !== "frame" || frozen || D.dialogOpen()) return;
          zoom = btn.dataset.zoom;
          panel.querySelectorAll("[data-zoom]").forEach(function (b) {
            b.classList.toggle("on", b.dataset.zoom === zoom);
          });
          D.audio.click();
          renderLive();
          if (hintEl) hintEl.textContent = zoom === "near" ? "近景：人占得多，背景少" : "远景：能看见操场";
        };
      });

      panel.querySelectorAll("[data-zoom]").forEach(function (b) {
        b.classList.toggle("on", b.dataset.zoom === zoom);
      });

      renderStrip();
      run().catch(function (error) {
        console.error(error);
        phase = "done";
        host.done({ id: "photo", completed: false, error: String(error) });
      });
    }

    function update(dt) {
      t += dt;
      // 站着的人轻轻换一下重心
      const nodes = stage.querySelectorAll(".photo-actor");
      const bob = Math.sin(t * 1.6) * 1.2;
      for (const node of nodes) {
        if (dragIndex >= 0 && Number(node.dataset.index) === dragIndex) continue;
        node.style.transform = "translate(-50%, -100%) translateY(" + bob.toFixed(2) + "px)";
      }
    }

    function press(key) {
      if (phase === "pick") {
        const k = key.toLowerCase();
        if (k === "enter" || k === " " || k === "e") { confirmPick(); return; }
        const n = Number(key);
        if (n >= 1 && n <= shots.length) { pickIndex = n - 1; D.audio.click(); renderPickList(); }
        return;
      }
      if (phase !== "frame") return;
      if (key === " ") { doShutter(); return; }
      if (key === "Enter") { if (shots.length) enterPick(); return; }
      const k = key.toLowerCase();
      if (k === "arrowleft" || k === "a") nudge(-0.02, 0);
      else if (k === "arrowright" || k === "d") nudge(0.02, 0);
      else if (k === "arrowup" || k === "w") nudge(0, -0.02);
      else if (k === "arrowdown" || k === "s") nudge(0, 0.02);
      else if (k === "z") {
        zoom = zoom === "near" ? "far" : "near";
        panel.querySelectorAll("[data-zoom]").forEach(function (b) { b.classList.toggle("on", b.dataset.zoom === zoom); });
        renderLive();
      } else {
        const n = Number(key);
        if (n >= 1 && n <= 3) { selected = n - 1; refreshSel(); }
      }
    }

    function dispose() {
      disposed = true;
      clearTimeout(pickTimer);
      pickTimer = 0;
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      shutter.onclick = null;
      doneBtn.onclick = null;
      keep.onclick = null;
      D.ui.hide(panel, 0);
      view.hidden = false;
      pick.hidden = true;
      strip.replaceChildren();
      shots = [];
      D.objective(null);
    }

    return {
      id: "photo",
      title: "留一张照片",
      start: start,
      update: update,
      draw: drawAmbient,
      press: press,
      setFrozen: function (v) { frozen = !!v; },
      dispose: dispose,
      get phase() { return phase; },
      get shots() { return shots.length; },
      get zoom() { return zoom; },
      get plane() { return planeOpt; },
      get picked() { return shots[pickIndex] || null; }
    };

    // ------------------------------------------------------------ 背景
    // 取景框是 DOM。画布这边只压一层暗掉的操场，别再画三个人——
    // 他们已经在取景框里了，画两遍会让人以为外面还站着一组。

    function drawAmbient(ctx) {
      const bg = D.img.field || D.img.exterior;
      if (bg) ctx.drawImage(bg, 0, 0, D.W, D.H);
      ctx.fillStyle = "rgba(16,12,20,.62)";
      ctx.fillRect(0, 0, D.W, D.H);
    }
  };

})(window);

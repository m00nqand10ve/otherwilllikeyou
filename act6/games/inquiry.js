/* M02 · 帮我问一句（事件 03）
 *
 * 在四班门口、走廊、二班门口自由走动。朋友甲在四班门口，朋友乙在二班门口，
 * 走近按 E（或点他/屏幕上的按钮）说一次话，再选怎么开口。问到的内容只写成
 * 「朋友说的」：bAndAClose / bHasCrush 最多 reported，不写 aAndBDating，
 * 也不替玩家确认任何关系。没问到就只写 askedFriendX = "none"。
 *
 * 宋遥只在走廊远端出现一次，左向四帧远景路过；走近到 60px 内会被老师叫走。
 * 她永远没有 E 提示、不弹对白、不参与选项。
 *
 * 这一场挂在主线里（不是日常目录），所以事实通过 host.persist 写进
 * story.js 的 our-story-act6-v1；日常存档一个字段都不碰。
 * 时间窗只改走廊人数和一句开场（开场在 story.js 里），不改能问到的信息。
 */
(function (global) {
  "use strict";

  const D = global.DAILY;
  D.games = D.games || {};

  // 时间窗只影响走廊里的人数，不影响谁能问、能问到什么。
  const CROWD_BY_WINDOW = { early: 5, middle: 3, late: 1 };

  const SCENES = {
    class4: { bg: "corridor", walk: [44, 196], y: [206, 256], right: "corridor", sign: { frame: 2 } },
    corridor: { bg: "corridor", walk: [38, 474], y: [206, 256], left: "class4", right: "class2" },
    class2: { bg: "corridor", walk: [300, 476], y: [206, 256], left: "corridor", sign: { frame: 0 } }
  };

  const CARD_MS = 2400;

  D.games.inquiry = function (host) {
    const opts = (host && host.opts) || {};
    const windowId = ["early", "middle", "late"].indexOf(opts.window) >= 0 ? opts.window : "middle";
    const crowdTier = opts.crowdTier || null;

    const crowd = D.createCrowd({
      count: CROWD_BY_WINDOW[windowId],
      xMin: 70, xMax: 452, yMin: 212, yMax: 248,
      speed: 26, size: 0.7, alpha: 0.68, seed: 29
    });

    // 两个可以问的人；各问一次，问完仍站在原地，只是头顶不再有 E。
    const npcA = { key: "friendA", x: 150, y: 232, dir: "down", face: "down", moving: false, size: 1.05, kind: "friendA", talked: false, hidden: false };
    const npcB = { key: "friendB", x: 362, y: 232, dir: "down", face: "down", moving: false, size: 1.05, kind: "friendB", talked: false, hidden: false };
    // 宋遥：只有左向的四帧远景，永远不参与交互。
    const songyao = { key: "songyao", x: 486, y: 220, dir: "left", face: "left", moving: true, size: 0.86, alpha: 0.92, kind: "songyao", hidden: true, phase: 0 };
    const teacher = { key: "teacher", x: 0, y: 222, dir: "down", face: "left", moving: false, size: 1.02, kind: "teacher", hidden: true, pose: "poseTurn" };

    const ex = D.createExplore({
      scenes: SCENES,
      start: "class4",
      x: 76,
      y: 236,
      dir: "right",
      speed: 58,
      actors: crowd.actors.concat([npcA, npcB, songyao, teacher]),
      onScene: function (scene, first) {
        if (scene === "corridor" && first) spawnSongyao();
        syncHidden();
      }
    });

    let state = "intro";          // intro | explore | talk | choice | done
    let frozen = false;
    let disposed = false;
    let t = 0;
    let askedA = "none";
    let askedB = "none";
    let factClose = false;
    let factCrush = false;
    let nearNpc = null;
    let songyaoStage = "idle";    // idle | walking | called | gone
    let songyaoHinted = false;
    let finishPrompted = false;
    let talking = false;
    const timers = [];

    function later(fn, ms) {
      const id = setTimeout(function () {
        const at = timers.indexOf(id);
        if (at >= 0) timers.splice(at, 1);
        if (!disposed) fn();
      }, ms);
      timers.push(id);
      return id;
    }

    // ------------------------------------------------------------ DOM

    const stageEl = document.getElementById("stage");
    const canvas = document.getElementById("mg");

    const cardEl = document.createElement("div");
    cardEl.id = "inqCard";
    cardEl.className = "inq-card";
    cardEl.hidden = true;
    cardEl.innerHTML = '<small>听到的</small><b></b><span></span>';
    const cardText = cardEl.querySelector("b");
    const cardNote = cardEl.querySelector("span");
    stageEl.appendChild(cardEl);

    const talkBtn = document.createElement("button");
    talkBtn.id = "inqTalk";
    talkBtn.type = "button";
    talkBtn.hidden = true;
    talkBtn.textContent = "E · 说话";
    stageEl.appendChild(talkBtn);

    const backBtn = document.createElement("button");
    backBtn.id = "inqBack";
    backBtn.type = "button";
    backBtn.hidden = true;
    backBtn.textContent = "先回去";
    stageEl.appendChild(backBtn);

    const pad = document.createElement("div");
    pad.id = "inqPad";
    pad.className = "crowd-pad inq-pad";
    pad.hidden = true;
    pad.innerHTML =
      '<button type="button" data-dir="ArrowUp" aria-label="向上走">↑</button>' +
      '<button type="button" data-dir="ArrowLeft" aria-label="向左走">←</button>' +
      '<button type="button" data-dir="ArrowDown" aria-label="向下走">↓</button>' +
      '<button type="button" data-dir="ArrowRight" aria-label="向右走">→</button>';
    stageEl.appendChild(pad);

    const padKeys = [];
    let padVisible = false;

    function usingTouch() {
      const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
      return coarse || window.innerWidth < 820;
    }

    function releasePad() {
      for (const key of padKeys) D.keys[key] = false;
      pad.querySelectorAll("button.on").forEach(function (b) { b.classList.remove("on"); });
    }

    function updatePad(paused) {
      const live = state === "explore" && !paused && usingTouch();
      if (live === padVisible) return;
      padVisible = live;
      pad.hidden = !live;
      if (!live) releasePad();
    }

    const capturePointer = function (e, btn) {
      if (btn.setPointerCapture) { try { btn.setPointerCapture(e.pointerId); } catch (error) { /* ignore */ } }
    };
    for (const btn of pad.querySelectorAll("[data-dir]")) {
      const key = btn.dataset.dir.toLowerCase();
      if (padKeys.indexOf(key) < 0) padKeys.push(key);
      btn.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        D.keys[key] = true;
        btn.classList.add("on");
        capturePointer(e, btn);
      });
      const release = function () {
        D.keys[key] = false;
        btn.classList.remove("on");
      };
      btn.addEventListener("pointerup", release);
      btn.addEventListener("pointercancel", release);
      btn.addEventListener("pointerleave", release);
      btn.addEventListener("lostpointercapture", release);
    }

    // ------------------------------------------------------------ 信息卡

    const cardQueue = [];
    let cardShowing = false;
    let cardTimer = 0;

    function showCard(text, note) {
      cardQueue.push({ text: text, note: note });
      if (!cardShowing) nextCard();
    }

    function nextCard() {
      const item = cardQueue.shift();
      if (!item) { cardShowing = false; return; }
      cardShowing = true;
      cardText.textContent = item.text;
      cardNote.textContent = item.note;
      cardEl.hidden = false;
      requestAnimationFrame(function () { cardEl.classList.add("show"); });
      cardTimer = setTimeout(function () {
        cardEl.classList.remove("show");
        cardTimer = setTimeout(function () {
          cardEl.hidden = true;
          nextCard();
        }, 220);
      }, CARD_MS);
    }

    function clearCards() {
      clearTimeout(cardTimer);
      cardQueue.length = 0;
      cardShowing = false;
      cardEl.classList.remove("show");
      cardEl.hidden = true;
    }

    // ------------------------------------------------------------ 走动与目标

    function syncHidden() {
      const scene = ex.scene;
      npcA.hidden = scene !== "class4";
      npcB.hidden = scene !== "class2";
      songyao.hidden = songyaoStage !== "walking";
      teacher.hidden = songyaoStage !== "called";
    }

    function nearest() {
      if (state !== "explore" || ex.scene === "corridor") return null;
      if (ex.scene === "class4" && !npcA.talked && ex.near(npcA.x, npcA.y, 38, 24)) return npcA;
      if (ex.scene === "class2" && !npcB.talked && ex.near(npcB.x, npcB.y, 38, 24)) return npcB;
      return null;
    }

    function talkedAny() { return npcA.talked || npcB.talked; }

    function refreshObjective() {
      if (!talkedAny()) {
        const first = opts.entry === "friends" ? "先问问朋友甲" : "去二班问问";
        D.objective(first, "四班门口的朋友甲，或者二班门口的朋友乙");
        return;
      }
      if (npcA.talked && npcB.talked) D.objective("回去找由乃", "两个人都问过了");
      else D.objective("回去找由乃", "也可以再问另一个朋友");
    }

    function updateBackButton() {
      backBtn.hidden = !(talkedAny() && state === "explore");
    }

    function syncNear() {
      if (state !== "explore") {
        talkBtn.hidden = true;
        D.hint("", 0);
        return;
      }
      talkBtn.hidden = !nearNpc;
      if (nearNpc) talkBtn.textContent = "E · 跟" + (nearNpc.kind === "friendA" ? "朋友甲" : "朋友乙") + "说话";
      D.hint(nearNpc ? "E · 说话　　WASD / 方向键走动" : "WASD / 方向键走动 · 左右边缘换场景", 0);
    }

    // ------------------------------------------------------------ 宋遥路过

    function spawnSongyao() {
      if (songyaoStage !== "idle") return;
      songyaoStage = "walking";
      songyao.hidden = false;
      songyao.x = 486;
      songyao.moving = true;
    }

    function callOutSongyao() {
      if (songyaoStage !== "walking") return;
      songyaoStage = "called";
      songyao.moving = false;
      teacher.hidden = false;
      teacher.x = songyao.x + 18;
      teacher.y = songyao.y + 2;
      D.react("老师", "……你，过来一下。", 1500);
      later(function () {
        if (songyaoStage !== "called") return;
        songyaoStage = "gone";
        teacher.hidden = true;
        songyao.hidden = true;
        D.react("旁白", "宋遥被老师叫走了。她没看见我。", 1700);
      }, 1600);
    }

    function updateSongyao(dt) {
      if (songyaoStage === "walking") {
        songyao.x -= 30 * dt;
        if (ex.scene === "corridor" && Math.abs(ex.actor.x - songyao.x) < 60) callOutSongyao();
        else if (songyao.x < 26) { songyaoStage = "gone"; songyao.hidden = true; }
      }
      // 追上去也没有对白，只有一句旁白。
      if (songyaoStage === "gone" && !songyaoHinted && ex.scene === "corridor" && ex.actor.x > 390) {
        songyaoHinted = true;
        D.react("旁白", "她已经进教室了。", 1500);
      }
    }

    // ------------------------------------------------------------ 问话

    function heard(who, level, facts) {
      const patch = {};
      patch[who === "A" ? "askedFriendA" : "askedFriendB"] = level;
      if (facts.close) patch.bAndAClose = "reported";
      if (facts.crush) patch.bHasCrush = "reported";
      if (host.persist) host.persist(patch);
      if (who === "A") askedA = level; else askedB = level;
      if (facts.close) factClose = true;
      if (facts.crush) factCrush = true;
      if (facts.close) {
        showCard("宋遥最近和 A 走得挺近", (who === "A" ? "朋友甲" : "朋友乙") + "说的，不一定准");
        if (host.learn) host.learn("b_and_a_close", who === "A" ? "friend_a" : "friend_b", "reported", "day2_break");
      }
      if (facts.crush) {
        showCard("宋遥可能有喜欢的人", "朋友乙说的，不一定准");
        if (host.learn) host.learn("b_has_crush", "friend_b", "reported", "day2_break");
      }
    }

    async function talkA() {
      await D.lines([
        ["和臣", "问你个事。二班的宋瑶，你熟吗？"],
        ["朋友甲", "不熟。怎么了？"],
        ["和臣", "随便问问。"],
        ["朋友甲", "我倒是听人说，她最近跟 A 走得挺近。"]
      ]);
      if (disposed) return;
      const pick = await host.choose("还要问点什么？", ["你听谁说的？", "还有别的吗？", "算了，没事。"]);
      if (pick < 0 || disposed) return;
      if (pick === 0) {
        await D.lines([
          ["和臣", "你听谁说的？"],
          ["朋友甲", "走廊上听来的。别当真。"],
          ["旁白", "他说完就把作业往上托了托，像在说一件很普通的事。"]
        ]);
        heard("A", "full", { close: true });
      } else if (pick === 1) {
        await D.lines([
          ["和臣", "还有别的吗？"],
          ["朋友甲", "没了。我跟她又不熟。"],
          ["旁白", "他低头继续数作业，没有再抬头。"]
        ]);
        heard("A", "partial", { close: true });
      } else {
        await D.lines([
          ["和臣", "算了，没事。"],
          ["朋友甲", "哦。"],
          ["旁白", "他没再问，也没再看我。"]
        ]);
        heard("A", "none", {});
      }
    }

    async function talkB() {
      // 到得早晚只换他第一句；能问到的种类不变。入场方式（先找朋友）也不改信息。
      const opener = ex.scene === "class2" && crowdTier === "late"
        ? "你来得够晚。她刚进去。"
        : crowdTier === "early"
          ? "你来得挺快。走廊上全是人吧。"
          : "刚被老师叫走了。你找她有事？";
      await D.lines([
        ["和臣", "宋瑶在吗？"],
        ["朋友乙", opener],
        ["和臣", "……想问她点事。"],
        ["朋友乙", "她最近应该挺忙的。你要问什么，我可以帮你带一句。"]
      ]);
      if (disposed) return;
      const pick = await host.choose("怎么开口？", ["她最近很忙？", "她跟 A 熟吗？", "没事，我改天再来。"]);
      if (pick < 0 || disposed) return;

      if (pick === 0) {
        await D.lines([
          ["和臣", "她最近很忙？"],
          ["朋友乙", "嗯。你要问什么，我可以帮你带一句。"]
        ]);
        if (disposed) return;
        const sub = await host.choose("要不要让他带一句？", ["不用，我自己来", "那帮我带一句"]);
        if (sub < 0 || disposed) return;
        if (sub === 1) {
          await D.lines([
            ["和臣", "那帮我带一句。"],
            ["朋友乙", "她应该有喜欢的人吧。我也不确定。"],
            ["旁白", "他说完就回头看了一眼二班的门，没有再说下去。"]
          ]);
          heard("B", "full", { crush: true });
        } else {
          await D.lines([
            ["和臣", "不用。我自己来吧。"],
            ["朋友乙", "那我劝你改天。她这两天不太有空。"]
          ]);
          heard("B", "partial", {});
        }
        return;
      }

      if (pick === 1) {
        await D.lines([
          ["和臣", "她跟 A 熟吗？"],
          ["朋友乙", "你问这个干嘛。"],
          ["和臣", "……随便问问。"],
          ["朋友乙", "最近走得挺近吧。具体我也不清楚。"],
          ["旁白", "他说得很快，像不太想接着这个话题。"]
        ]);
        heard("B", "full", { close: true });
        return;
      }

      await D.lines([
        ["和臣", "没事，我改天再来。"],
        ["朋友乙", "行。她要是问起，我就说你来找过。"]
      ]);
      heard("B", "none", {});
    }

    async function talk(npc) {
      if (talking || disposed || state !== "explore" || npc.talked) return;
      talking = true;
      state = "talk";
      ex.enable(false);
      talkBtn.hidden = true;
      backBtn.hidden = true;
      D.hint("", 0);
      try {
        if (npc.kind === "friendA") await talkA();
        else await talkB();
      } catch (error) {
        fail(error);
        return;
      }
      if (disposed) return;
      npc.talked = true;
      talking = false;
      state = "explore";
      ex.enable(true);
      refreshObjective();
      updateBackButton();
      nearNpc = null;
      syncNear();
      updatePad(false);
      if (talkedAny()) D.hint("F · 先回去", 3000);
    }

    // 走到二班门口最右边：可以选「先回去」，不要求问过谁。
    async function askLeave() {
      if (state !== "explore" || disposed) return;
      state = "choice";
      ex.enable(false);
      talkBtn.hidden = true;
      backBtn.hidden = true;
      D.hint("", 0);
      const pick = await host.choose("二班门口。还要再问吗？", ["先回去", "再走一圈"]);
      if (disposed || state === "done") return;
      if (pick === 0) { finish("back"); return; }
      finishPrompted = false;
      state = "explore";
      ex.enable(true);
      ex.jump("class2", 300, "left");
      D.hint("WASD / 方向键走 · 走近按 E 说话", 2600);
      updateBackButton();
    }

    // ------------------------------------------------------------ 画布

    function drawKeyBadge(ctx, x, y) {
      ctx.save();
      ctx.fillStyle = "rgba(28,22,30,.86)";
      ctx.fillRect(Math.round(x) - 8, Math.round(y) - 8, 16, 16);
      ctx.strokeStyle = "#ffd497";
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(x) - 8.5, Math.round(y) - 8.5, 17, 17);
      ctx.fillStyle = "#ffe6c7";
      ctx.font = '10px "Microsoft YaHei",sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("E", Math.round(x), Math.round(y));
      ctx.restore();
    }

    function drawSign(ctx, sign) {
      if (!sign || !D.img.classSigns) return;
      // 走廊背景的门在画面正中：班牌就挂在门楣上方。
      ctx.drawImage(D.img.classSigns, sign.frame * 32, 0, 32, 16, 240, 24, 32, 16);
    }

    function draw(ctx) {
      ex.draw(ctx);
      const def = ex.sceneDef();
      drawSign(ctx, def.sign);
      if (state === "explore" && nearNpc) drawKeyBadge(ctx, nearNpc.x, nearNpc.y - 82);
    }

    // ------------------------------------------------------------ 每帧

    function update(dt) {
      t += dt;
      const paused = frozen || D.dialogOpen() || ex.frozen || disposed;
      updatePad(paused);

      if (!paused) {
        crowd.update(dt);
        updateSongyao(dt);
      }

      ex.update(dt);

      if (state === "explore" && !paused) {
        const npc = nearest();
        if (npc !== nearNpc) {
          nearNpc = npc;
          syncNear();
        }
        if (ex.scene === "class2" && ex.actor.x >= 469 && !finishPrompted) {
          finishPrompted = true;
          askLeave();
        }
      }
    }

    // ------------------------------------------------------------ 输入

    function press(key) {
      if (disposed) return;
      const k = String(key).toLowerCase();
      if (k === "e" && state === "explore") {
        const npc = nearest();
        if (npc) talk(npc);
        return;
      }
      if (k === "f" && state === "explore" && talkedAny()) finish("back");
    }

    function onCanvasDown(event) {
      if (disposed || state !== "explore") return;
      const npc = nearest();
      if (!npc) return;
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width * D.W;
      const y = (event.clientY - rect.top) / rect.height * D.H;
      // 点到脚下附近的人才算搭话；点宋遥、点空地都不会有任何反应。
      if (Math.abs(x - npc.x) < 26 && y > npc.y - 80 && y < npc.y + 8) talk(npc);
    }

    talkBtn.addEventListener("click", function () {
      if (state === "explore" && nearNpc) talk(nearNpc);
    });
    backBtn.addEventListener("click", function () {
      if (state === "explore" && talkedAny()) finish("back");
    });
    canvas.addEventListener("pointerdown", onCanvasDown);

    // ------------------------------------------------------------ 收尾

    function fail(error) {
      console.error(error);
      if (state === "done") return;
      state = "done";
      ex.enable(false);
      if (host.done) host.done({ id: "inquiry", completed: false, error: String(error) });
    }

    function finish(reason) {
      if (state === "done") return;
      state = "done";
      ex.enable(false);
      talkBtn.hidden = true;
      backBtn.hidden = true;
      clearCards();
      D.objective(null);
      D.hint(null);
      if (host.done) {
        host.done({
          id: "inquiry",
          completed: true,
          reason: reason,
          window: windowId,
          askedFriendA: askedA,
          askedFriendB: askedB,
          bAndAClose: factClose ? "reported" : null,
          bHasCrush: factCrush ? "reported" : null,
          songyao: songyaoStage
        });
      }
    }

    function dispose() {
      disposed = true;
      for (const id of timers) clearTimeout(id);
      timers.length = 0;
      clearCards();
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      canvas.removeEventListener("pointerdown", onCanvasDown);
      talkBtn.remove();
      backBtn.remove();
      pad.remove();
      cardEl.remove();
      releasePad();
      D.objective(null);
      D.hint(null);
      D.clearReact();
      ex.enable(false);
    }

    function start() {
      D.clearReact();
      refreshObjective();
      updateBackButton();
      syncHidden();
      window.addEventListener("blur", onBlur);
      window.addEventListener("focus", onFocus);
      D.hint("WASD / 方向键走 · 走近按 E 说话", 3600);
      state = "explore";
      ex.enable(true);
    }

    function onBlur() {
      releasePad();
      for (const k in D.keys) D.keys[k] = false;
    }

    function onFocus() { /* 和 crowdrun 一样，失焦回来就能继续走 */ }

    return {
      id: "inquiry",
      title: "帮我问一句",
      start: start,
      update: update,
      draw: draw,
      press: press,
      setFrozen: function (v) {
        frozen = !!v;
        if (frozen) { ex.enable(false); releasePad(); }
        else if (state === "explore") ex.enable(true);
      },
      dispose: dispose,
      get state() { return state; },
      get window() { return windowId; },
      get people() { return crowd.actors.filter(function (a) { return !a.hidden; }).length; },
      get tier() { return crowdTier; },
      get scene() { return ex.scene; },
      get x() { return ex.actor.x; },
      get y() { return ex.actor.y; },
      get target() { return nearNpc ? nearNpc.kind : null; },
      get talked() { return talkedAny(); },
      get askedFriendA() { return askedA; },
      get askedFriendB() { return askedB; },
      get songyaoState() {
        return {
          stage: songyaoStage,
          x: Math.round(songyao.x),
          visible: !songyao.hidden,
          called: songyaoStage === "called" || songyaoStage === "gone"
        };
      }
    };
  };
})(window);

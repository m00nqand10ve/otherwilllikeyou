/* D01 · 一句话经过三个人
 *
 * 由乃在走廊叫住和臣，让他回四班时带一句话给朋友甲。走廊太吵，一句话
 * 只能一棒一棒往下传：每一棒保留三块信息里的两块，剩下那块会被噪音换成
 * 别的词，下一棒带着错的那句继续传。
 *
 * 不判失败，也不写任何关系字段——它只是把「话传三个人会变样」演一遍。
 */
(function (global) {
  "use strict";

  const D = global.DAILY;
  D.games = D.games || {};

  const BLOCKS = [
    { id: "time", label: "时间", text: "放学后", wrong: "午休时" },
    { id: "place", label: "地点", text: "公告栏", wrong: "教室后墙" },
    { id: "items", label: "物品", text: "胶带、名单", wrong: "剪刀、水" }
  ];

  const HOPS = [
    { lead: "第一棒 · 告诉同桌", who: "同桌", note: "走廊太吵，他只听清你说的一半。" },
    { lead: "第二棒 · 同桌转告前排", who: "前排的同学", note: "前排的同学正低头翻书，没听全。" },
    { lead: "第三棒 · 前排转告朋友甲", who: "朋友甲", note: "前排的同学回头叫了一声。" }
  ];

  const ORIGIN = "放学后，公告栏，带胶带和名单。";

  D.games.relay = function (host) {
    const panel = document.getElementById("relay");
    const pick = document.getElementById("relayPick");
    const compare = document.getElementById("relayCompare");
    const leadEl = document.getElementById("relayLead");
    const blocksEl = document.getElementById("relayBlocks");
    const confirmEl = document.getElementById("relayConfirm");
    const originEl = document.getElementById("relayOrigin");
    const finalEl = document.getElementById("relayFinal");

    let state = "intro";      // intro | pick | done
    let hop = 0;
    let t = 0;
    let bgKey = "corridor";
    let cast = [];
    let kept = [];            // 这一棒留下的 id
    let blocks = [];          // 当前三块（含已经被换掉的）
    let resolvePick = null;
    let resolveCompare = null;
    let compareTimer = 0;
    let disposed = false;

    // ------------------------------------------------------------ 画面

    function setScene(key, actors) {
      bgKey = key;
      cast = actors;
    }

    function draw(ctx) {
      const bg = D.img[bgKey];
      if (bg) ctx.drawImage(bg, 0, 0, D.W, D.H);
      else { ctx.fillStyle = "#241f28"; ctx.fillRect(0, 0, D.W, D.H); }
      // 按 y 排一下，别让后面的人盖住前面
      const list = cast.slice().sort(function (a, b) { return a.y - b.y; });
      for (const a of list) D.shadow(ctx, a.x, a.y + 1, D.FRAME_W * (a.scale || 1));
      for (const a of list) D.drawActor(ctx, a, t);
    }

    // ------------------------------------------------------------ 信息块

    function sentence() {
      if (!blocks.length) return ORIGIN;
      const time = blocks[0].text;
      const place = blocks[1].text;
      const items = blocks[2].text.replace("、", "和");
      return time + "，" + place + "，带" + items + "。";
    }

    function renderPick() {
      blocksEl.replaceChildren();
      blocks.forEach(function (block) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "relay-block" + (kept.indexOf(block.id) >= 0 ? " keep" : "");
        btn.dataset.id = block.id;
        if (block.mutated) btn.classList.add("mutated");
        btn.append(D.ui.el("i", "relay-label", block.label), D.ui.el("b", "relay-text", block.text));
        btn.addEventListener("click", function () { toggle(block.id); });
        blocksEl.appendChild(btn);
      });
      confirmEl.disabled = kept.length !== 2;
    }

    function toggle(id) {
      if (state !== "pick") return;
      const at = kept.indexOf(id);
      if (at >= 0) kept.splice(at, 1);
      else if (kept.length < 2) kept.push(id);
      else {
        // 想留第三块，就把最早留下的那块让出来
        kept.shift();
        kept.push(id);
      }
      D.audio.click();
      renderPick();
    }

    function awaitPick() {
      return new Promise(function (resolve) { resolvePick = resolve; });
    }

    function submit() {
      if (state !== "pick" || kept.length !== 2 || !resolvePick) return;
      const resolve = resolvePick;
      resolvePick = null;
      D.audio.click();
      confirmEl.disabled = true;
      resolve();
    }

    // ------------------------------------------------------------ 三棒

    async function runHops() {
      for (hop = 0; hop < HOPS.length; hop++) {
        kept = [];
        state = "pick";
        renderPick();
        leadEl.textContent = HOPS[hop].lead + " —— " + HOPS[hop].note;
        D.ui.show(panel);

        await awaitPick();
        if (disposed) return;

        // 没被留下的那一块被走廊的噪音换掉；换过的不会变回来。
        let changed = null;
        blocks.forEach(function (block) {
          if (kept.indexOf(block.id) >= 0 || block.mutated) return;
          block.text = block.wrong;
          block.mutated = true;
          changed = block.id;
        });
        renderPick();
        if (changed) {
          const el = blocksEl.querySelector('[data-id="' + changed + '"]');
          if (el) el.classList.add("lost");
          D.audio.wrong();
        }
        await D.sleep(760);
        if (disposed) return;

        state = "intro";
        D.ui.hide(panel);
        await D.sleep(200);
        if (disposed) return;

        await D.lines([[HOPS[hop].who, sentence() + "？"]]);
        if (disposed) return;
      }

      // 三棒走完：原句和传到的那句并排放。
      originEl.textContent = ORIGIN;
      finalEl.textContent = sentence();
      pick.hidden = true;
      compare.hidden = false;
      requestAnimationFrame(function () { compare.classList.add("show"); });
      D.ui.show(panel);
      await waitCompare();
      compare.classList.remove("show");
      compare.hidden = true;
      pick.hidden = false;
      D.ui.hide(panel);
      await D.sleep(200);
    }

    /** 对照层：点一下、按一下键，或者四秒后自己走。 */
    function waitCompare() {
      return new Promise(function (resolve) {
        let done = false;
        function finish() {
          if (done) return;
          done = true;
          clearTimeout(compareTimer);
          panel.removeEventListener("pointerdown", finish);
          resolveCompare = null;
          resolve();
        }
        resolveCompare = finish;
        compareTimer = setTimeout(finish, 4200);
        panel.addEventListener("pointerdown", finish);
      });
    }

    // ------------------------------------------------------------ 流程

    async function run() {
      // 走廊：由乃把人叫住
      setScene("corridor", [
        { key: "boy", x: 300, y: 250, dir: -1, face: "left", phase: 0 },
        { key: "friend", x: 176, y: 250, dir: 1, face: "down", phase: 0.8 }
      ]);
      D.objective("把一句话带回四班", "三块信息，每次只能原样带两块");

      await D.lines([
        ["由乃", "正好，帮我带句话给四班的朋友甲。"],
        ["和臣", "现在？"],
        ["由乃", "放学后公告栏集合，带胶带和名单。"],
        ["和臣", "……公告栏，胶带和名单。"],
        ["由乃", "别记错了。三个说法，一个都不能少。"],
        ["旁白", "走廊里全是人。走过去这一路，能不能原样带到他耳朵里，很难说。"]
      ]);
      if (disposed) return;

      blocks = BLOCKS.map(function (b) {
        return { id: b.id, label: b.label, text: b.text, wrong: b.wrong, mutated: false };
      });

      // 交给同桌那一棒，站位往中间挪（同桌是普通同学，不由由乃顶替）
      setScene("corridor", [
        { key: "boy", x: 232, y: 252, dir: 1, face: "right", phase: 0 },
        { key: "npcBoy", x: 344, y: 252, dir: -1, face: "left", phase: 0.4 }
      ]);
      await runHops();
      if (disposed) return;

      // 放学后：公告栏前，朋友甲带着错的材料来了
      const lost = blocks.filter(function (b) { return b.mutated; }).map(function (b) { return b.id; });
      setScene("board", [
        { key: "boy", x: 166, y: 252, dir: 1, face: "right", phase: 0 },
        { key: "girl", x: 250, y: 252, dir: 1, face: "right", phase: 0.5 },
        { key: "friend", x: 318, y: 252, dir: -1, face: "down", phase: 1.1 },
        { key: "friendA", x: 414, y: 252, dir: -1, face: "left", phase: 0.2 }
      ]);
      D.objective("放学后 · 公告栏", "看看他到底带了什么");
      await D.sleep(320);
      if (disposed) return;

      const itemsLost = lost.indexOf("items") >= 0;
      const lines = [["旁白", "放学后，公告栏前面站着四个人。"]];
      if (lost.indexOf("time") >= 0) lines.push(["朋友甲", "我中午就来了一趟，没人。"]);
      if (lost.indexOf("place") >= 0) lines.push(["朋友甲", "教室后墙那边我也找了。"]);
      if (itemsLost) {
        lines.push(
          ["朋友甲", "我来了。剪刀，还有水。"],
          ["由乃", "……我让你带胶带和名单。"],
          ["朋友甲", "你不是说剪刀吗？"],
          ["朱里", "所以到底是带胶带还是带剪刀？"]
        );
      } else {
        lines.push(
          ["朋友甲", "我来了。胶带，名单。"],
          ["由乃", "……你怎么全带对了。"],
          ["朱里", "那就省得再跑一趟。"]
        );
      }
      lines.push(
        ["由乃", "我让你带句话，不是让你玩传话游戏。"],
        ["和臣", "……差不多。"],
        ["旁白", "朱里看了我一眼，没忍住笑了一下。"]
      );
      await D.lines(lines);
      if (disposed) return;

      if (lost.length) {
        await D.lines([["由乃", "以后有话我自己去说。"], ["和臣", "……好。"]]);
      }
      if (disposed) return;

      state = "done";
      D.persist({ relayCompleted: true, relayFinal: sentence(), relayLost: lost });
      host.done({ id: "relay", completed: true, lost: lost, final: sentence() });
    }

    // ------------------------------------------------------------ 壳

    function start() {
      D.clearReact();
      host.setChapter("第 1 天 · 课间");
      D.hint(null);
      confirmEl.addEventListener("click", submit);
      run().catch(function (error) {
        console.error(error);
        state = "done";
        host.done({ id: "relay", completed: false, error: String(error) });
      });
    }

    function update(dt) {
      t += dt;
      for (const a of cast) {
        if (!a.moving) a.phase += dt * 0.6;
      }
    }

    function press(key) {
      if (resolveCompare) {
        // 对照层只接受明确的继续键，别让方向键/数字键误触。
        const k = key.toLowerCase();
        if (k === "enter" || k === " " || k === "e") resolveCompare();
        return;
      }
      if (state !== "pick" || panel.hidden) return;
      const k = key.toLowerCase();
      if (k === " " || k === "enter" || k === "e") { submit(); return; }
      const n = Number(key);
      if (n >= 1 && n <= 3) toggle(blocks[n - 1].id);
    }

    function dispose() {
      disposed = true;
      if (resolvePick) { const r = resolvePick; resolvePick = null; r(); }
      if (resolveCompare) { resolveCompare(); }
      clearTimeout(compareTimer);
      confirmEl.removeEventListener("click", submit);
      D.ui.hide(panel, 0);
      pick.hidden = false;
      compare.hidden = true;
      compare.classList.remove("show");
      D.objective(null);
      D.hint(null);
    }

    return {
      id: "relay",
      title: "一句话经过三个人",
      start: start,
      update: update,
      draw: draw,
      press: press,
      setFrozen: function () { /* 面板不跑时间，不用冻 */ },
      dispose: dispose,
      get state() { return state; },
      get blocks() { return blocks.map(function (b) { return { id: b.id, text: b.text, mutated: b.mutated }; }); },
      get final() { return sentence(); }
    };
  };

})(window);


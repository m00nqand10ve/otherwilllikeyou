/* D07 · 课堂笔记（备用日常）
 *
 * 广播连着念一段通知，本子上最多写得下四条。记多了写不下，记少了漏项，
 * 但都不判对错——最后本子上留下的就是那几行字，值日的时候再问别人。
 *
 * 这一条是备用，不进一周目的三个，只在 ?hub=1 的目录里。
 */
(function (global) {
  "use strict";

  const D = global.DAILY;
  D.games = D.games || {};

  const SPEECH = [
    "周五下午第三节课后，各班到楼前空地集合。",
    "请带上班级牌和名单。",
    "如果下雨，改到体育馆。",
    "各班班长记得提前十分钟到。"
  ];

  // 广播念到哪一句，才把对应的要点放出来；没念到的不提前泄露。
  const REVEAL = [
    ["time", "place"],
    ["items"],
    ["rain"],
    ["early", "leader"]
  ];

  const POINTS = [
    { id: "time", text: "周五下午第三节课后" },
    { id: "place", text: "楼前空地" },
    { id: "items", text: "班级牌和名单" },
    { id: "rain", text: "下雨改体育馆" },
    { id: "early", text: "提前十分钟到" },
    { id: "leader", text: "班长负责" }
  ];

  const LIMIT = 4;
  const DURATION = 25;

  D.games.classnotes = function (host) {
    const panel = document.getElementById("notes");
    const speechEl = document.getElementById("notesSpeech");
    const listEl = document.getElementById("notesList");
    const countEl = document.getElementById("notesCount");
    const barEl = document.getElementById("notesBar");
    const bookEl = document.getElementById("notesBook");
    const doneBtn = document.getElementById("notesDone");

    let state = "intro";     // intro | listen | done
    let picked = [];
    let revealed = new Set();
    let timeLeft = DURATION;
    let spoken = 0;
    let speakT = 0;
    let t = 0;
    let frozen = false;
    let disposed = false;
    let seated = [];
    let finishTimer = 0;

    // ------------------------------------------------------------ 画面

    function draw(ctx) {
      const bg = D.img.classroom;
      if (bg) ctx.drawImage(bg, 0, 0, D.W, D.H);
      else { ctx.fillStyle = "#241f28"; ctx.fillRect(0, 0, D.W, D.H); }
      ctx.fillStyle = "rgba(20,16,24,.5)";
      ctx.fillRect(0, 0, D.W, D.H);

      for (const a of seated) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, D.W, a.top + 6);
        ctx.clip();
        D.shadow(ctx, a.x, a.y + 1, D.FRAME_W * a.size);
        D.drawActor(ctx, a, t);
        ctx.restore();
      }
    }

    // ------------------------------------------------------------ 笔记

    function renderList() {
      listEl.replaceChildren();
      POINTS.forEach(function (p, i) {
        if (!revealed.has(p.id)) return;       // 还没念到的要点不显示
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "note-card" + (picked.indexOf(p.id) >= 0 ? " on" : "");
        btn.dataset.id = p.id;
        btn.append(D.ui.el("i", "note-box", ""), D.ui.el("span", "", p.text));
        btn.appendChild(D.ui.el("em", "note-no", String(i + 1)));
        btn.addEventListener("click", function () { toggle(p.id); });
        listEl.appendChild(btn);
      });
      if (countEl) countEl.textContent = "记了 " + picked.length + " / " + LIMIT;
    }

    function toggle(id) {
      if (state !== "listen") return;
      const at = picked.indexOf(id);
      if (at >= 0) {
        picked.splice(at, 1);
        D.audio.blip();
      } else if (picked.length >= LIMIT) {
        D.audio.wrong();
        D.react("和臣", "记不下了。", 1200);
        return;
      } else {
        picked.push(id);
        D.audio.click();
      }
      renderList();
      if (picked.length >= LIMIT) {
        clearTimeout(finishTimer);
        finishTimer = setTimeout(function () { if (!disposed) finish(); }, 520);
      } else {
        // 反悔拿掉一条就取消自动收尾，别把 3 条也结束掉。
        clearTimeout(finishTimer);
        finishTimer = 0;
      }
    }

    function speakNext() {
      spoken++;
      (REVEAL[spoken - 1] || []).forEach(function (id) { revealed.add(id); });
      renderList();
      if (speechEl) {
        speechEl.replaceChildren();
        for (let i = 0; i < spoken; i++) {
          speechEl.appendChild(D.ui.el("span", i === spoken - 1 ? "now" : "", SPEECH[i]));
        }
      }
      D.audio.blip();
    }

    async function finish() {
      if (state !== "listen") return;
      clearTimeout(finishTimer);
      finishTimer = 0;
      state = "done";
      if (doneBtn) doneBtn.hidden = true;
      D.audio.bell();

      // 面板留着，把上半部分收起来，换成本子那一页
      if (speechEl) speechEl.hidden = true;
      listEl.hidden = true;
      if (countEl) countEl.hidden = true;
      if (barEl && barEl.parentElement) barEl.parentElement.hidden = true;

      await D.sleep(160);
      if (disposed) return;

      // 本子上留下记到的那几行，没记到的就是空行
      if (bookEl) {
        bookEl.replaceChildren();
        bookEl.appendChild(D.ui.el("b", "book-title", "本子"));
        POINTS.forEach(function (p) {
          const line = D.ui.el("p", picked.indexOf(p.id) >= 0 ? "book-line" : "book-line blank");
          line.textContent = picked.indexOf(p.id) >= 0 ? "· " + p.text : "· ";
          bookEl.appendChild(line);
        });
        bookEl.hidden = false;
        D.ui.show(bookEl);
      }

      const n = picked.length;
      const lines = n >= LIMIT
        ? [["旁白", "广播念完，本子上正好写满四行。"], ["老师", "……记得倒挺全。"], ["旁白", "她从旁边走过去，没有多说什么。"]]
        : n >= 2
          ? [["旁白", "本子上写了几行，后面还空着大半页。"], ["和臣", "应该够了吧。"], ["旁白", "没记到的那些，等值日的时候再问别人。"]]
          : [["旁白", "本子上几乎是空的。"], ["和臣", "……下课再问别人。"]];
      await D.lines(lines);
      if (disposed) return;

      D.ui.hide(bookEl);
      D.ui.hide(panel);
      await D.sleep(220);
      if (disposed) return;
      D.persist({ classNotesCompleted: true, classNotesPicked: picked.slice() });
      host.done({ id: "classnotes", completed: true, picked: picked.slice() });
    }

    // ------------------------------------------------------------ 流程

    async function run() {
      seated = [
        { key: "boy", x: 291, y: 237 + 44, top: 237, face: "up", dir: "up", phase: 0, size: 0.85, moving: false },
        { key: "npcGirl", x: 368, y: 188 + 44, top: 188, face: "up", dir: "up", phase: 0.8, size: 0.82, moving: false },
        { key: "npcBoy", x: 215, y: 237 + 44, top: 237, face: "up", dir: "up", phase: 1.5, size: 0.82, moving: false }
      ];

      D.objective("把通知记下来", "写不下那么多，最多四条");
      D.ui.show(panel);
      renderList();

      await D.lines([
        ["旁白", "第三节课前，广播响了。"],
        ["广播", "通知：周五下午第三节课后，各班到楼前空地集合。"],
        ["旁白", "我把本子翻到新的一页，笔帽咬在嘴里。"]
      ]);
      if (disposed) return;

      state = "listen";
      spoken = 0;
      speakT = 0;
      revealed = new Set();
      speakNext();
      if (doneBtn) doneBtn.hidden = false;
      D.hint("听到的就勾上 · 最多四条", 3200);
    }

    // ------------------------------------------------------------ 壳

    function resetPanel() {
      if (speechEl) { speechEl.hidden = false; speechEl.replaceChildren(); }
      listEl.hidden = false;
      if (countEl) countEl.hidden = false;
      if (barEl && barEl.parentElement) barEl.parentElement.hidden = false;
      if (bookEl) { bookEl.hidden = true; bookEl.classList.remove("show"); }
      if (doneBtn) doneBtn.hidden = true;
      picked = [];
      revealed = new Set();
      timeLeft = DURATION;
      if (barEl) { barEl.style.width = "100%"; barEl.classList.remove("low"); }
    }

    function start() {
      D.clearReact();
      host.setChapter("备用 · 四班课堂");
      D.hint(null);
      resetPanel();
      if (doneBtn) doneBtn.onclick = finish;
      run().catch(function (error) {
        console.error(error);
        state = "done";
        host.done({ id: "classnotes", completed: false, error: String(error) });
      });
    }

    function update(dt) {
      t += dt;
      for (const a of seated) a.phase += dt * 0.4;
      if (state !== "listen" || frozen || D.dialogOpen()) return;

      speakT += dt;
      if (speakT > 4.4 && spoken < SPEECH.length) {
        speakT = 0;
        speakNext();
      }

      timeLeft = Math.max(0, timeLeft - dt);
      if (barEl) {
        barEl.style.width = (timeLeft / DURATION * 100).toFixed(1) + "%";
        barEl.classList.toggle("low", timeLeft < 6);
      }
      if (timeLeft <= 0) finish();
    }

    function press(key) {
      if (state !== "listen") return;
      const n = Number(key);
      if (n >= 1 && n <= POINTS.length) { toggle(POINTS[n - 1].id); return; }
      const k = key.toLowerCase();
      if (k === "enter" || k === " ") finish();
    }

    function dispose() {
      disposed = true;
      clearTimeout(finishTimer);
      finishTimer = 0;
      if (doneBtn) { doneBtn.hidden = true; doneBtn.onclick = null; }
      D.ui.hide(panel, 0);
      if (bookEl) { bookEl.hidden = true; bookEl.classList.remove("show"); }
      if (barEl) barEl.style.width = "100%";
      D.objective(null);
      D.hint(null);
      D.clearReact();
    }

    return {
      id: "classnotes",
      title: "课堂笔记",
      start: start,
      update: update,
      draw: draw,
      press: press,
      setFrozen: function (v) { frozen = !!v; },
      dispose: dispose,
      get state() { return state; },
      get picked() { return picked.slice(); },
      get timeLeft() { return timeLeft; }
    };
  };

})(window);

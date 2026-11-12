/* 第四幕 · 主线里的三场 DOM 玩法
 *
 *   ACT6Flow.timing(opts)       事件 02《由乃的催促》—— 课间时机
 *   ACT6Flow.cards(opts)        事件 05《听来的，与猜到的》—— 信息卡分类
 *   ACT6Flow.memory(opts)       事件 09《原来在那之前》—— 记忆滑块
 *   ACT6Flow.showPhoto(picked)  事件 09 结尾按构图复现那张合照
 *
 * 这三场不新画图：纸卡用 minigame 里一直没接线的
 * ui_clue_frame_seen / _guessed / _remembered，相纸用 ui_photo_paper.png，
 * 合照沿用 photo.js 存下的同一份构图。对白、场景、存档仍然归 story.js，
 * 这里只负责面板、滑块和它们自己的键鼠触屏。
 *
 * 边界：不判失败、不打分；时机只改人流密度和事件 03 的开场白；
 * 分类结果只写成 reportAccuracy 一句话的语气，不升级任何 reported 事实，
 * 也不替玩家确认 A 和宋遥的关系。
 */
(function (global) {
  "use strict";

  const D = global.DAILY || {};
  const api = function () { return global.ACT6; };
  const stage = function () { return document.getElementById("stage"); };
  const asset = function (p) { return "../assets/" + p; };
  const sleep = function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function show(node) {
    node.hidden = false;
    requestAnimationFrame(function () { node.classList.add("show"); });
  }
  function hide(node, ms) {
    node.classList.remove("show");
    setTimeout(function () { node.hidden = true; }, ms == null ? 200 : ms);
  }
  function click() {
    try { if (D.audio && D.audio.click) D.audio.click(); } catch (error) { /* 声音不是玩法前置 */ }
  }
  function blip() {
    try { if (D.audio && D.audio.blip) D.audio.blip(); } catch (error) { /* 同上 */ }
  }

  /* 环境音压低：本章还没有音频轨。留一个真的接口，有轨时挂上来即可，不假装在响。 */
  function duckAmbient(on) {
    const amb = global.ACT6_AMBIENT;
    if (amb && typeof amb.setVolume === "function") {
      try { amb.setVolume(on ? 0.45 : 1); } catch (error) { console.error(error); }
    }
  }

  // ================================================================ 事件 02 · 课间时机

  /*
   * 先选时间点，再选行动。面板本身不判对错：
   *   · 时间窗只改人流密度和事件 03 的开场白，不改变能问到的信息；
   *   · 「等一会儿」让时间点往前一格，第三次等待（或已经「快上课了」还等）打铃；
   *   · 「今天算了」不是失败，只是把委托留到下一次课间。
   * 右上角三格课间刻度是叙事节奏，不做倒计时数字。
   */

  const TIMING_WINDOWS = [
    { id: "early", name: "刚下课", hint: "人多、声音大", note: "现在过去，可能挤。", action: "走廊里全是人。挤过去，可能被撞一下。" },
    { id: "middle", name: "课间中段", hint: "人少一些", note: "适合正常说话。", action: "走廊里安静了些，脚步声很清楚。" },
    { id: "late", name: "快上课了", hint: "走廊变空", note: "再不去就来不及。", action: "快上课了。现在过去，得跑。" }
  ];

  const TIMING_ACTIONS = [
    { id: "now", name: "现在过去" },
    { id: "wait", name: "等一会儿" },
    { id: "friends", name: "先去找朋友" },
    { id: "giveUp", name: "今天算了" }
  ];

  // 等一次之后面板上留的那句话：不催、不吓人，只说走廊变了。
  const TIMING_WAIT_NOTES = [
    "走廊里的人散了一些。还有一点时间。",
    "走廊里只剩几个人了。再等就要打铃。"
  ];

  let liveTiming = null;

  function timing(opts) {
    const wanted = opts && opts.window;
    let start = 0;
    for (let i = 0; i < TIMING_WINDOWS.length; i++) {
      if (TIMING_WINDOWS[i].id === wanted) start = i;
    }

    return new Promise(function (resolve) {
      let index = start;
      let waits = 0;
      let actionsShown = false;
      let noteOverride = null;
      let settled = false;

      const panel = document.createElement("section");
      panel.id = "mgTiming";
      panel.className = "timing-panel";
      panel.hidden = true;
      panel.setAttribute("aria-label", "课间时机");
      panel.innerHTML =
        '<div class="timing-ticks" id="timingTicks" aria-hidden="true"></div>' +
        '<div class="timing-head">' +
          '<h3>课间的十分钟</h3>' +
          '<p class="timing-lead">先选一个时间点，再决定怎么办。选哪个都不会失败。</p>' +
        '</div>' +
        '<div class="timing-slots" id="timingSlots">' +
          TIMING_WINDOWS.map(function (w) {
            return '<button type="button" data-slot="' + w.id + '"><b>' + w.name + '</b><small>' + w.hint + '</small></button>';
          }).join("") +
        '</div>' +
        '<p class="timing-note" id="timingNote"></p>' +
        '<div class="timing-actions" id="timingActions" hidden>' +
          TIMING_ACTIONS.map(function (a, i) {
            return '<button type="button" data-act="' + a.id + '"><span class="timing-no">' + (i + 1) + '</span>' + a.name + '</button>';
          }).join("") +
        '</div>' +
        '<p class="timing-keys">数字键 1–3 选时间点，1–4 选行动；← → 换时间点；Esc 退出</p>';

      const slots = panel.querySelector("#timingSlots");
      const actions = panel.querySelector("#timingActions");
      const note = panel.querySelector("#timingNote");
      const ticks = panel.querySelector("#timingTicks");

      // 等一会儿时画面暗一点（光偏过去），面板本身不跟着暗。
      const dusk = el("div", "timing-dusk");
      stage().appendChild(dusk);
      stage().appendChild(panel);

      function blocked() {
        // 对白还在播的时候不该被面板吃掉点击（事件 02 正常不会走到这里，留个保险）。
        const dlg = document.getElementById("dialog");
        return !!dlg && !dlg.hidden;
      }

      function render() {
        ticks.replaceChildren();
        TIMING_WINDOWS.forEach(function (w, i) {
          ticks.append(el("i", i < index ? "done" : i === index ? "now" : ""));
        });
        const buttons = slots.querySelectorAll("[data-slot]");
        buttons.forEach(function (b, i) {
          b.classList.toggle("on", i === index);
          b.setAttribute("aria-pressed", i === index ? "true" : "false");
        });
        note.textContent = noteOverride || (actionsShown ? TIMING_WINDOWS[index].action : TIMING_WINDOWS[index].note);
        actions.hidden = !actionsShown;
        panel.dataset.window = TIMING_WINDOWS[index].id;
        panel.dataset.waits = String(waits);
        dusk.style.opacity = waits > 0 ? String(waits >= 2 ? 0.34 : 0.18) : "0";
      }

      function chooseWindow(i) {
        if (settled || blocked()) return;
        index = D.clamp(i, 0, TIMING_WINDOWS.length - 1);
        actionsShown = true;
        noteOverride = null;
        click();
        render();
      }

      function waitOnce() {
        waits++;
        if (index >= TIMING_WINDOWS.length - 1 || waits >= 3) {
          try { if (D.audio && D.audio.bell) D.audio.bell(); } catch (error) { /* 铃声不是玩法前置 */ }
          finish("bell");
          return;
        }
        index++;
        actionsShown = true;
        noteOverride = TIMING_WAIT_NOTES[Math.min(index - 1, TIMING_WAIT_NOTES.length - 1)];
        blip();
        render();
      }

      function doAction(id) {
        if (settled || blocked()) return;
        if (id === "wait") { waitOnce(); return; }
        click();
        if (id === "now" || id === "friends" || id === "giveUp") finish(id);
      }

      function onKey(event) {
        if (settled) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          finish("cancel");
          return;
        }
        if (blocked()) return;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          event.stopPropagation();
          chooseWindow(index + (event.key === "ArrowRight" ? 1 : -1));
          return;
        }
        const n = Number(event.key);
        if (!n) return;
        if (actionsShown) {
          if (n >= 1 && n <= TIMING_ACTIONS.length) {
            event.preventDefault();
            event.stopPropagation();
            doAction(TIMING_ACTIONS[n - 1].id);
          }
        } else if (n >= 1 && n <= TIMING_WINDOWS.length) {
          event.preventDefault();
          event.stopPropagation();
          chooseWindow(n - 1);
        }
      }

      function fail(error) {
        console.error(error);
        finish("error", error);
      }

      function guard(fn) {
        return function (event) {
          try { fn(event); } catch (error) { fail(error); }
        };
      }

      function finish(kind, error) {
        if (settled) return;
        settled = true;
        liveTiming = null;
        document.removeEventListener("keydown", onKeyGuard, true);
        hide(panel);
        dusk.style.opacity = "0";
        setTimeout(function () { panel.remove(); dusk.remove(); }, 260);
        if (kind === "cancel") { resolve({ completed: false, cancelled: true }); return; }
        if (kind === "error") { resolve({ completed: false, error: String(error) }); return; }
        resolve({
          completed: true,
          action: kind,
          window: TIMING_WINDOWS[index].id,
          waits: waits,
          interrupted: kind === "bell"
        });
      }

      const onKeyGuard = guard(onKey);
      slots.querySelectorAll("[data-slot]").forEach(function (b, i) {
        b.addEventListener("click", guard(function () { chooseWindow(i); }));
      });
      actions.querySelectorAll("[data-act]").forEach(function (b) {
        b.addEventListener("click", guard(function () { doAction(b.dataset.act); }));
      });
      document.addEventListener("keydown", onKeyGuard, true);

      liveTiming = {
        get open() { return !settled; },
        get window() { return TIMING_WINDOWS[index].id; },
        get waits() { return waits; },
        get actions() { return actionsShown; }
      };

      render();
      show(panel);
    });
  }

  // ================================================================ 事件 05 · 信息卡

  const COLUMNS = [
    { id: "heard", name: "听到的", sub: "别人说的", frame: "minigame/ui_clue_frame_seen.png" },
    { id: "guessed", name: "我猜的", sub: "我自己想的", frame: "minigame/ui_clue_frame_guessed.png" },
    { id: "unknown", name: "还不知道", sub: "没问到的", frame: "minigame/ui_clue_frame_remembered.png" }
  ];

  // 键盘 ← / → 在「未放 → 听到的 → 我猜的 → 还不知道」之间挪。
  const COLUMN_ORDER = [null, "heard", "guessed", "unknown"];

  /* 一条都没问到时的兜底卡组：和事件 05 原先那段对白说的是同一件事。 */
  const DEFAULT_DECK = [
    { id: "a_close", truth: "heard", text: "朋友说，宋瑶最近跟 A 走得挺近。", note: "朋友说的，不一定准" },
    { id: "b_crush", truth: "unknown", text: "宋瑶有没有喜欢的人。", note: "没问到本人" },
    { id: "g_together", truth: "guessed", text: "他们肯定已经在一起了。" },
    { id: "g_snub", truth: "guessed", text: "她这两天不出现，是不想见我。" },
    { id: "g_why", truth: "unknown", text: "由乃为什么让我去问。", note: "没问过她" }
  ];

  /**
   * 卡片池跟着事件 03 真的问到了什么走：
   * 没问到的条目改成「还不知道」的问法，不假装自己听见过。
   */
  function deckFor(state) {
    const s = state || {};
    const askedAny = !!(s.inquiryCompleted || s.askedFriendA || s.askedFriendB || s.bAndAClose || s.bHasCrush);
    if (!askedAny) return DEFAULT_DECK.map(function (c) { return Object.assign({}, c); });

    const heardA = s.bAndAClose === "reported" || s.askedFriendA === "full" || s.askedFriendA === "partial";
    const heardCrush = !!s.bHasCrush;
    // 这条也可能是朋友乙说的：没问过甲时不要把话安到甲头上（只改标注，不改判定）。
    const heardASource = s.askedFriendA === "full" || s.askedFriendA === "partial" ? "朋友甲说的" : "朋友说的";

    return [
      heardA
        ? { id: "a_close", truth: "heard", text: "宋瑶最近跟 A 走得挺近。", note: heardASource + "，不一定准" }
        : { id: "a_close", truth: "unknown", text: "宋瑶跟 A 到底什么关系。", note: "没问到本人" },
      heardCrush
        ? { id: "b_crush", truth: "heard", text: "宋瑶可能有喜欢的人。", note: "朋友说的，不一定准" }
        : { id: "b_crush", truth: "unknown", text: "宋瑶有没有喜欢的人。", note: "也没问到本人" },
      { id: "g_together", truth: "guessed", text: "他们肯定已经在一起了。" },
      { id: "g_snub", truth: "guessed", text: "她这两天不出现，是不想见我。" },
      { id: "g_why", truth: "unknown", text: "由乃为什么让我去问。", note: "没问过她" }
    ];
  }

  /** 分类准不准只决定由乃说哪句，不算分、不重来。 */
  function judge(deck, placement) {
    let wrong = 0;
    let guessesAsHeard = 0;
    for (let i = 0; i < deck.length; i++) {
      const card = deck[i];
      const col = placement[card.id];
      if (col === card.truth) continue;
      wrong++;
      if (card.truth === "guessed" && col === "heard") guessesAsHeard++;
    }
    return {
      accuracy: wrong === 0 ? "accurate" : "mixed",
      wrong: wrong,
      guessesAsHeard: guessesAsHeard
    };
  }

  let liveCards = null;

  function cards(opts) {
    const state = (opts && opts.state) || {};
    const deck = deckFor(state);
    const byId = Object.create(null);
    deck.forEach(function (card) { byId[card.id] = card; });

    return new Promise(function (resolve) {
      let settled = false;
      let picked = null;
      let focused = null;
      let placement = Object.create(null);
      let suppressClick = 0;
      let press = null;
      let ghost = null;

      // ------------------------------------------------------------ 面板

      const panel = document.createElement("section");
      panel.id = "mgCards";
      panel.className = "cards-panel";
      panel.hidden = true;
      panel.setAttribute("aria-label", "信息卡分类");
      panel.innerHTML =
        '<div class="cards-head">' +
          '<h3>听来的，与猜到的</h3>' +
          '<p class="cards-lead">把五张卡放进它们该在的地方。放错了不重来，也没有分数。</p>' +
        '</div>' +
        '<div class="cards-bank-wrap" data-col="bank">' +
          '<span class="bank-label">还没放的</span>' +
          '<div class="cards-bank" id="cardsBank"></div>' +
        '</div>' +
        '<div class="cards-cols" id="cardsCols"></div>' +
        '<div class="cards-foot">' +
          '<span id="cardsCount">还有 5 张没放</span>' +
          '<button id="cardsDone" type="button" disabled>就这样</button>' +
          '<button id="cardsSilent" type="button">其实，我没问到</button>' +
          '<button id="cardsReset" type="button">全部拿回</button>' +
        '</div>' +
        '<p class="cards-keys">拖动卡片，或 Tab 选卡后按 1 / 2 / 3；← → 换栏，Esc 退出</p>';

      const bank = panel.querySelector("#cardsBank");
      const cols = panel.querySelector("#cardsCols");
      const countEl = panel.querySelector("#cardsCount");
      const doneBtn = panel.querySelector("#cardsDone");
      const silentBtn = panel.querySelector("#cardsSilent");
      const resetBtn = panel.querySelector("#cardsReset");
      const bodies = Object.create(null);

      COLUMNS.forEach(function (col) {
        const box = el("div", "cards-col");
        box.dataset.col = col.id;

        const head = document.createElement("button");
        head.type = "button";
        head.className = "col-head";
        head.dataset.col = col.id;
        const icon = el("i", "col-frame");
        icon.style.backgroundImage = "url(" + asset(col.frame) + ")";
        head.append(icon, el("b", null, col.name), el("small", null, col.sub));
        head.addEventListener("click", guard(function () {
          if (picked) place(picked, col.id);
        }));

        const body = el("div", "col-body");
        body.dataset.col = col.id;
        bodies[col.id] = body;

        box.append(head, body);
        // 点栏里任意空白处都算放进这一栏；点卡片本身不冒泡到这里。
        box.addEventListener("click", guard(function (event) {
          if (event.target.closest && event.target.closest(".card-chip")) return;
          if (picked) place(picked, col.id);
        }));
        cols.append(box);
      });

      deck.forEach(function (card) {
        const node = document.createElement("button");
        node.type = "button";
        node.className = "card-chip";
        node.dataset.id = card.id;
        node.dataset.col = "bank";
        node.append(el("span", "chip-text", card.text));
        if (card.note) node.append(el("small", "chip-note", card.note));
        node.addEventListener("click", guard(function () { pick(card.id); }));
        node.addEventListener("pointerdown", guard(function (event) { beginDrag(event, card.id); }));
        node.addEventListener("focus", guard(function () { focused = card.id; paint(); }));
        node.addEventListener("blur", guard(function () { if (focused === card.id) { focused = null; paint(); } }));
        card.node = node;
        bank.append(node);
      });

      stage().appendChild(panel);

      // ------------------------------------------------------------ 摆放

      function paint() {
        let left = 0;
        deck.forEach(function (card) {
          const col = placement[card.id] || "bank";
          if (col === "bank") left++;
          card.node.dataset.col = col;
          card.node.classList.toggle("picked", picked === card.id);
          card.node.classList.toggle("in-focus", focused === card.id);
          card.node.classList.toggle("placed", col !== "bank");
          card.node.setAttribute("aria-label", card.text + "，" + (col === "bank" ? "还没放" : "放在" + columnName(col)));
        });
        countEl.textContent = left ? "还有 " + left + " 张没放" : "五张都放好了";
        doneBtn.disabled = left > 0;
        COLUMNS.forEach(function (col) {
          const box = cols.querySelector('.cards-col[data-col="' + col.id + '"]');
          if (box) box.classList.toggle("armed", !!picked);
        });
      }

      function columnName(id) {
        const col = COLUMNS.filter(function (c) { return c.id === id; })[0];
        return col ? col.name : "";
      }

      function place(id, col) {
        const card = byId[id];
        const body = bodies[col];
        if (!card || !body) return;
        placement[id] = col;
        body.append(card.node);
        picked = null;
        click();
        paint();
      }

      function toBank(id) {
        const card = byId[id];
        if (!card) return;
        delete placement[id];
        bank.append(card.node);
        picked = null;
        blip();
        paint();
      }

      function pick(id) {
        if (performance.now() < suppressClick) return;
        picked = picked === id ? null : id;
        click();
        paint();
      }

      function reset() {
        deck.forEach(function (card) { toBankQuiet(card.id); });
        picked = null;
        blip();
        paint();
      }
      function toBankQuiet(id) {
        const card = byId[id];
        if (!card) return;
        delete placement[id];
        bank.append(card.node);
      }

      // ------------------------------------------------------------ 拖拽 / 触屏
      // 和值日表同一套：按住不动就是点选，真的移动了才算拖。

      function beginDrag(event, id) {
        if (settled) return;
        if (event.button != null && event.button !== 0) return;
        press = { id: id, x: event.clientX, y: event.clientY, moved: false };
        window.addEventListener("pointermove", onMoveGuard);
        window.addEventListener("pointerup", onUpGuard);
        window.addEventListener("pointercancel", onCancelGuard);
      }

      function dropTarget(x, y) {
        const node = document.elementFromPoint(x, y);
        if (!node || !node.closest) return null;
        const col = node.closest("[data-col]");
        if (col) return col.dataset.col;
        return node.closest(".cards-panel") ? null : "bank";
      }

      function onMove(event) {
        if (!press) return;
        if (!press.moved) {
          if (Math.abs(event.clientX - press.x) < 4 && Math.abs(event.clientY - press.y) < 4) return;
          press.moved = true;
          picked = press.id;
          ghost = el("div", "card-ghost", byId[press.id].text);
          document.body.appendChild(ghost);
          paint();
        }
        ghost.style.left = event.clientX + "px";
        ghost.style.top = event.clientY + "px";
        event.preventDefault();
      }

      function onUp(event) {
        detach();
        const moved = press && press.moved;
        const id = press && press.id;
        if (ghost) { ghost.remove(); ghost = null; }
        press = null;
        if (!moved) return;                     // 没动，交给 click 处理
        suppressClick = performance.now() + 350;
        const target = dropTarget(event.clientX, event.clientY);
        if (target === "bank") toBank(id);
        else if (target) place(id, target);
        else { picked = null; paint(); }        // 拖到面板外：放回去，不判失败
      }

      function onCancel() {
        detach();
        if (ghost) { ghost.remove(); ghost = null; }
        press = null;
        picked = null;                          // 触屏被系统打断：回到手上，不吞卡
        paint();
      }

      function detach() {
        window.removeEventListener("pointermove", onMoveGuard);
        window.removeEventListener("pointerup", onUpGuard);
        window.removeEventListener("pointercancel", onCancelGuard);
      }

      // ------------------------------------------------------------ 键盘

      function activeId() {
        return focused || picked;
      }

      function onKey(event) {
        if (settled) return;
        if (event.key === "Escape") {
          // 第一下取消手里的卡，第二下退出这一场（剧情会给重试 / 跳过）。
          event.preventDefault();
          event.stopPropagation();
          if (picked) { picked = null; paint(); return; }
          finish("cancel");
          return;
        }
        if (event.key === "1" || event.key === "2" || event.key === "3") {
          const id = activeId();
          if (!id) return;
          event.preventDefault();
          event.stopPropagation();
          place(id, COLUMNS[Number(event.key) - 1].id);
          return;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          const id = activeId();
          if (!id) return;
          event.preventDefault();
          event.stopPropagation();
          const now = COLUMN_ORDER.indexOf(placement[id] || null);
          const step = event.key === "ArrowRight" ? 1 : -1;
          const next = COLUMN_ORDER[Math.max(0, Math.min(COLUMN_ORDER.length - 1, now + step))];
          if (next) place(id, next);
          else toBank(id);
          return;
        }
        if (event.key === "Backspace" || event.key === "Delete") {
          const id = activeId();
          if (!id) return;
          event.preventDefault();
          event.stopPropagation();
          toBank(id);
        }
      }

      // ------------------------------------------------------------ 收尾

      /** 面板里任何一处出错，都收干净再交给剧情的 #eventFailure。 */
      function fail(error) {
        console.error(error);
        finish("error", error);
      }

      function guard(fn) {
        return function (event) {
          try { fn(event); }
          catch (error) { fail(error); }
        };
      }

      function finish(kind, error) {
        if (settled) return;
        settled = true;
        liveCards = null;
        detach();
        document.removeEventListener("keydown", onKeyGuard, true);
        hide(panel);
        setTimeout(function () { panel.remove(); }, 260);
        if (kind === "cancel") {
          resolve({ completed: false, cancelled: true });
          return;
        }
        if (kind === "error") {
          resolve({ completed: false, error: String(error) });
          return;
        }
        const verdict = kind === "silent"
          ? { accuracy: "silent", wrong: 0, guessesAsHeard: 0 }
          : judge(deck, placement);
        resolve({
          completed: true,
          accuracy: verdict.accuracy,
          wrong: verdict.wrong,
          guessesAsHeard: verdict.guessesAsHeard,
          placement: Object.assign({}, placement)
        });
      }

      const onKeyGuard = guard(onKey);
      const onMoveGuard = guard(onMove);
      const onUpGuard = guard(onUp);
      const onCancelGuard = guard(onCancel);

      doneBtn.addEventListener("click", guard(function () { if (!doneBtn.disabled) finish("sort"); }));
      silentBtn.addEventListener("click", guard(function () { finish("silent"); }));
      resetBtn.addEventListener("click", guard(reset));
      // 只在 document 上报一次：面板自己的 keydown 会和对白那套重复触发。
      document.addEventListener("keydown", onKeyGuard, true);

      liveCards = {
        get deck() { return deck.map(function (c) { return { id: c.id, truth: c.truth, text: c.text }; }); },
        get placement() { return Object.assign({}, placement); },
        get picked() { return picked; },
        get open() { return !settled; }
      };

      paint();
      show(panel);
    });
  }

  // ================================================================ 事件 04 · 公告栏

  /*
   * 四样材料、四个虚线区域：标题 / 活动照片 / 时间 / 参加方式。
   * 放错只给朱里或由乃一句建议，不弹错误框、不重来；8 秒没动只帮一次。
   * 吸附后允许 0–1 度的歪，保留手工感。板边那个朋友甲只在
   * 「本周目玩过传话、而且传丢了物品」时出现——只当笑话，不进主线。
   */

  const BULLETIN_SLOTS = [
    { id: "title", name: "标题", sub: "上方居中" },
    { id: "photo", name: "照片", sub: "左中" },
    { id: "time", name: "时间", sub: "右中上" },
    { id: "join", name: "参加方式", sub: "右中下" }
  ];

  const BULLETIN_ITEMS = [
    { id: "title", slot: "title", kind: "title", text: "秋季活动" },
    { id: "photo", slot: "photo", kind: "photo", text: "活动照片", src: "minigame/act6/prop_activity_photo.png" },
    { id: "time", slot: "time", kind: "card", text: "周五放学后 · 楼前空地" },
    { id: "join", slot: "join", kind: "card", text: "想参加的直接来" }
  ];

  const BULLETIN_PRAISE = {
    title: ["朱里", "标题正了。"],
    photo: ["朱里", "照片压着角就行。"],
    time: ["由乃", "时间放右上。"],
    join: ["由乃", "参加方式写这儿。"]
  };

  const BULLETIN_WRONG = {
    title: ["朱里", "标题再往上一点，别压到照片。"],
    photo: ["朱里", "照片放左边，压着角也行。"],
    time: ["由乃", "这张是时间，不是参加方式。"],
    join: ["由乃", "参加方式写在最下面那格。"]
  };

  /** 事件 04 的短反应写在面板自己身上：这一场不是小游戏，全局 #mgReact 是收起的。 */
  let liveBulletin = null;

  function bulletin(opts) {
    const lost = Array.isArray(opts && opts.relayLost) ? opts.relayLost : [];
    const joke = lost.indexOf("items") >= 0 ? "items" : null;

    return new Promise(function (resolve) {
      let settled = false;
      let picked = null;
      let cursor = 0;
      let focused = null;
      let press = null;
      let ghost = null;
      let helped = false;
      let jokeShown = false;
      let lastAction = Date.now();
      let doneTimer = 0;
      let idleTimer = 0;
      let suppressClick = 0;

      const placements = Object.create(null);
      const tilts = Object.create(null);
      const nodes = Object.create(null);
      const slotNodes = Object.create(null);

      const panel = document.createElement("section");
      panel.id = "mgBulletin";
      panel.className = "bulletin-panel";
      panel.hidden = true;
      panel.setAttribute("aria-label", "公告栏布置");
      panel.innerHTML =
        '<div class="bulletin-head">' +
          '<h3>公告栏</h3>' +
          '<p class="bulletin-lead">四样材料，四个虚线里。放错了只会有人说一句，不用重来。</p>' +
          '<p class="bulletin-say" id="bulletinSay" aria-live="polite"></p>' +
        '</div>' +
        '<div class="bulletin-board" id="bulletinBoard">' +
          BULLETIN_SLOTS.map(function (s, i) {
            return '<div class="bulletin-slot" data-slot="' + s.id + '" role="button" tabindex="0">' +
              '<b>' + (i + 1) + ' · ' + s.name + '</b><small>' + s.sub + '</small></div>';
          }).join("") +
          // 板边的错带只在真的传丢过物品时才建；没玩过传话，DOM 里也没有这个人。
          (joke === "items" ? (
            '<div class="bulletin-joke" id="bulletinJoke" hidden>' +
              '<img class="joke-friend" alt="朋友甲" src="' + asset("characters/act6/friend_a_idle_down.png") + '">' +
              '<div class="joke-items"><span class="joke-scissors">剪刀</span>' +
              '<img class="joke-water" alt="" src="' + asset("minigame/prop_cup.png") + '"><span>水</span></div>' +
              '<p>……拿错了？</p>' +
            '</div>'
          ) : "") +
        '</div>' +
        '<div class="bulletin-tray">' +
          '<span class="tray-label">还没放的材料</span>' +
          '<div class="tray-items" id="bulletinItems"></div>' +
        '</div>' +
        '<div class="bulletin-foot">' +
          '<span id="bulletinCount">还有 4 样没放</span>' +
          '<button id="bulletinDone" type="button" hidden>就这样</button>' +
        '</div>' +
        '<p class="bulletin-tip">拖动材料，或者先点材料再点虚线；Tab 选材料，1–4 放进那一格，Enter 放进当前格。Esc 退出</p>';

      const board = panel.querySelector("#bulletinBoard");
      const tray = panel.querySelector("#bulletinItems");
      const countEl = panel.querySelector("#bulletinCount");
      const doneBtn = panel.querySelector("#bulletinDone");
      const jokeEl = panel.querySelector("#bulletinJoke");
      const sayEl = panel.querySelector("#bulletinSay");
      let sayTimer = 0;

      function speak(pair, ms) {
        if (!sayEl) return;
        sayEl.textContent = pair[0] + "：" + pair[1];
        sayEl.classList.add("on");
        clearTimeout(sayTimer);
        sayTimer = setTimeout(function () { sayEl.classList.remove("on"); }, ms || 1600);
      }

      BULLETIN_ITEMS.forEach(function (item) {
        const node = document.createElement("div");
        node.className = "bulletin-item kind-" + item.kind;
        node.dataset.id = item.id;
        node.dataset.kind = item.kind;
        node.setAttribute("role", "button");
        node.tabIndex = 0;
        if (item.kind === "photo") {
          const im = document.createElement("img");
          im.alt = item.text;
          im.src = asset(item.src);
          node.append(im, el("small", "bi-note", item.text));
        } else if (item.kind === "title") {
          node.append(el("span", "bi-title", item.text));
        } else {
          node.append(el("span", "bi-card-text", item.text));
        }
        node.setAttribute("aria-label", item.text + "，还没放");
        node.addEventListener("click", guard(function () { pick(item.id); }));
        node.addEventListener("keydown", guard(function (event) {
          if (event.key !== " " && event.key !== "Spacebar") return;
          event.preventDefault();
          event.stopPropagation();
          pick(item.id);
        }));
        node.addEventListener("pointerdown", guard(function (event) { beginDrag(event, item.id); }));
        node.addEventListener("focus", guard(function () { focused = item.id; paint(); }));
        node.addEventListener("blur", guard(function () {
          if (focused === item.id) { focused = null; paint(); }
        }));
        nodes[item.id] = node;
        tray.append(node);
      });

      BULLETIN_SLOTS.forEach(function (s, i) {
        const slot = board.querySelector('[data-slot="' + s.id + '"]');
        slotNodes[s.id] = slot;
        slot.addEventListener("click", guard(function () { if (picked) place(picked, s.id); }));
        slot.addEventListener("keydown", guard(function (event) {
          if (event.key !== " " && event.key !== "Spacebar") return;
          event.preventDefault();
          event.stopPropagation();
          if (picked) place(picked, s.id);
        }));
        slot.addEventListener("focus", guard(function () { cursor = i; paint(); }));
      });

      stage().appendChild(panel);

      // ------------------------------------------------------------ 摆放

      function touch() { lastAction = Date.now(); }

      function paint() {
        const left = BULLETIN_ITEMS.filter(function (i) { return !placements[i.id]; }).length;
        countEl.textContent = left ? "还有 " + left + " 样没放" : "四样都放好了";
        doneBtn.hidden = left > 0;
        BULLETIN_SLOTS.forEach(function (s, i) {
          slotNodes[s.id].classList.toggle("cursor", i === cursor);
        });
        BULLETIN_ITEMS.forEach(function (item) {
          const node = nodes[item.id];
          node.classList.toggle("picked", picked === item.id);
          node.classList.toggle("in-focus", focused === item.id);
          node.classList.toggle("placed", !!placements[item.id]);
        });
        panel.classList.toggle("armed", !!picked);
        panel.classList.toggle("all-placed", left === 0);
        board.classList.toggle("full", left === 0);
      }

      function place(id, slotId, quiet) {
        if (settled) return false;
        const item = BULLETIN_ITEMS.filter(function (i) { return i.id === id; })[0];
        if (!item || placements[id]) return false;
        touch();
        if (item.slot !== slotId) {
          // 放错：材料还在手里，只给一句建议，不弹错误框、不重来。
          picked = null;
          nodes[id].classList.add("nope");
          setTimeout(function () { nodes[id].classList.remove("nope"); }, 260);
          try { D.audio && D.audio.wrong && D.audio.wrong(); } catch (error) { /* 声音不是前置 */ }
          speak(BULLETIN_WRONG[id], 1600);
          paint();
          return false;
        }
        placements[id] = true;
        picked = null;
        const node = nodes[id];
        const slot = slotNodes[slotId];
        const tilt = (Math.random() < 0.5 ? -1 : 1) * (0.15 + Math.random() * 0.75);
        tilts[id] = Number(tilt.toFixed(2));
        node.style.setProperty("--tilt", tilt.toFixed(2) + "deg");
        slot.append(node);
        slot.classList.add("filled");
        try { D.audio && D.audio.click && D.audio.click(); } catch (error) { /* 同上 */ }
        if (!quiet) speak(BULLETIN_PRAISE[id], 1500);
        if (joke && !jokeShown) revealJoke();
        paint();
        if (BULLETIN_ITEMS.every(function (i) { return placements[i.id]; })) complete();
        return true;
      }

      function complete() {
        board.classList.add("done");
        doneBtn.hidden = false;
        try { D.audio && D.audio.right && D.audio.right(); } catch (error) { /* 同上 */ }
        clearTimeout(doneTimer);
        // 放完不用一直盯着：过一会儿自己收，也可以点「就这样」。
        doneTimer = setTimeout(function () { finish("place"); }, 3200);
      }

      function pick(id) {
        if (settled || performance.now() < suppressClick || placements[id]) return;
        picked = picked === id ? null : id;
        if (picked) {
          const item = BULLETIN_ITEMS.filter(function (i) { return i.id === id; })[0];
          for (let i = 0; i < BULLETIN_SLOTS.length; i++) {
            if (BULLETIN_SLOTS[i].id === item.slot) cursor = i;
          }
        }
        touch();
        try { D.audio && D.audio.blip && D.audio.blip(); } catch (error) { /* 同上 */ }
        paint();
      }

      // ------------------------------------------------------------ 拖拽 / 触屏
      // 按住不动算点选，真的移动了才算拖；和卡片分类、值日表同一套。

      function beginDrag(event, id) {
        if (settled || placements[id]) return;
        if (event.button != null && event.button !== 0) return;
        press = { id: id, x: event.clientX, y: event.clientY, moved: false };
        window.addEventListener("pointermove", onMoveGuard);
        window.addEventListener("pointerup", onUpGuard);
        window.addEventListener("pointercancel", onCancelGuard);
      }

      function dropTarget(x, y) {
        const node = document.elementFromPoint(x, y);
        if (!node || !node.closest) return null;
        const slot = node.closest("[data-slot]");
        return slot ? slot.dataset.slot : null;
      }

      function onMove(event) {
        if (!press) return;
        if (!press.moved) {
          if (Math.abs(event.clientX - press.x) < 4 && Math.abs(event.clientY - press.y) < 4) return;
          press.moved = true;
          picked = press.id;
          ghost = nodes[press.id].cloneNode(true);
          ghost.removeAttribute("data-id");
          ghost.className = "bulletin-item bulletin-ghost kind-" + nodes[press.id].dataset.kind;
          document.body.appendChild(ghost);
          paint();
        }
        ghost.style.left = event.clientX + "px";
        ghost.style.top = event.clientY + "px";
        event.preventDefault();
      }

      function onUp(event) {
        detach();
        const moved = press && press.moved;
        const id = press && press.id;
        if (ghost) { ghost.remove(); ghost = null; }
        press = null;
        if (!moved) return;                 // 没动，交给 click 处理
        suppressClick = performance.now() + 350;
        const target = dropTarget(event.clientX, event.clientY);
        if (target) place(id, target);
        else { picked = null; paint(); }    // 拖到板面外：材料回到手上，不判失败
        touch();
      }

      function onCancel() {
        detach();
        if (ghost) { ghost.remove(); ghost = null; }
        press = null;
        picked = null;                      // 触屏被系统打断：不吞材料
        paint();
      }

      function detach() {
        window.removeEventListener("pointermove", onMoveGuard);
        window.removeEventListener("pointerup", onUpGuard);
        window.removeEventListener("pointercancel", onCancelGuard);
      }

      // ------------------------------------------------------------ 键盘

      function onKey(event) {
        if (settled) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (picked) { picked = null; paint(); return; }
          finish("cancel");
          return;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          event.stopPropagation();
          cursor = Math.max(0, Math.min(BULLETIN_SLOTS.length - 1, cursor + (event.key === "ArrowRight" ? 1 : -1)));
          try { D.audio && D.audio.blip && D.audio.blip(); } catch (error) { /* 同上 */ }
          touch();
          paint();
          return;
        }
        const n = Number(event.key);
        if (n >= 1 && n <= BULLETIN_SLOTS.length) {
          const id = focused || picked;
          if (!id) return;
          event.preventDefault();
          event.stopPropagation();
          place(id, BULLETIN_SLOTS[n - 1].id);
          return;
        }
        if (event.key === "Enter") {
          const id = focused || picked;
          if (!id) return;
          event.preventDefault();
          event.stopPropagation();
          place(id, BULLETIN_SLOTS[cursor].id);
        }
      }

      // ------------------------------------------------------------ 8 秒帮忙一次

      function startIdle() {
        idleTimer = setInterval(function () {
          if (settled || helped) return;
          if (press) { lastAction = Date.now(); return; }
          const dlg = document.getElementById("dialog");
          if (dlg && !dlg.hidden) { lastAction = Date.now(); return; }
          if (Date.now() - lastAction < 8000) return;
          if (BULLETIN_ITEMS.every(function (i) { return placements[i.id]; })) return;
          helped = true;
          const order = ["join", "time", "photo", "title"];
          for (let i = 0; i < order.length; i++) {
            if (!placements[order[i]]) {
              place(order[i], order[i], true);
              break;
            }
          }
          speak(["由乃", "我帮你放右边。"], 1500);
        }, 500);
      }

      // ------------------------------------------------------------ 板边的错带

      function revealJoke() {
        if (!jokeEl || jokeShown) return;
        jokeShown = true;
        jokeEl.hidden = false;
        requestAnimationFrame(function () { jokeEl.classList.add("show"); });
        speak(["朋友甲", "我是不是……拿错了。"], 1900);
      }

      // ------------------------------------------------------------ 收尾

      function fail(error) {
        console.error(error);
        finish("error", error);
      }

      function guard(fn) {
        return function (event) {
          try { fn(event); }
          catch (error) { fail(error); }
        };
      }

      function finish(kind, error) {
        if (settled) return;
        settled = true;
        liveBulletin = null;
        clearInterval(idleTimer);
        clearTimeout(doneTimer);
        clearTimeout(sayTimer);
        detach();
        document.removeEventListener("keydown", onKeyGuard, true);
        hide(panel);
        setTimeout(function () { panel.remove(); }, 260);
        if (kind === "cancel") { resolve({ completed: false, cancelled: true }); return; }
        if (kind === "error") { resolve({ completed: false, error: String(error) }); return; }
        resolve({
          completed: true,
          placements: Object.assign({}, placements),
          tilts: Object.assign({}, tilts),
          helped: helped,
          joke: joke && jokeShown ? "items" : null
        });
      }

      const onKeyGuard = guard(onKey);
      const onMoveGuard = guard(onMove);
      const onUpGuard = guard(onUp);
      const onCancelGuard = guard(onCancel);

      doneBtn.addEventListener("click", guard(function () {
        if (doneBtn.hidden) return;
        finish("place");
      }));
      document.addEventListener("keydown", onKeyGuard, true);

      liveBulletin = {
        get open() { return !settled; },
        get placed() { return Object.keys(placements); },
        get tilts() { return Object.assign({}, tilts); },
        get helped() { return helped; },
        get joke() { return jokeShown ? joke : null; }
      };

      paint();
      startIdle();
      show(panel);
    });
  }

  // ================================================================ 事件 09 · 记忆滑块

  /*
   * 三段各一个 0–100 滑块：左边「那时」，右边「后来」。
   * 画面不动、不改色、不加滤镜，只在滑到「后来」时换旁白，四周略压暗。
   * 第三段落在那条没人的走廊上；照片如果拍过，第四拍再复现一两秒。
   */
  const MEMORY_SEGMENTS = [
    {
      id: "meet",
      label: "第一段 · 第一次相遇",
      when: "周五 · 傍晚 · 记忆",
      bg: "scenes/cg_doorway.png",
      past: [["旁白", "那天她站在门口，邀请我一起玩。"]],
      later: [["旁白", "后来我才知道，在那之前，她已经在喜欢一个人了。"], ["旁白", "但那天她什么也没说。我也不知道。"]]
    },
    {
      id: "door",
      label: "第二段 · 四班门口",
      when: "周五 · 傍晚 · 记忆",
      bg: "scenes/cg_doorway_wave_v2_512.png",
      past: [["旁白", "她来找我，只是普通地打了个招呼。"]],
      later: [["旁白", "在我认识她以前，她已经有自己的故事。"], ["旁白", "那些故事里没有我。"]]
    },
    {
      id: "corridor",
      label: "第三段 · 走廊",
      when: "周五 · 傍晚 · 走廊",
      bg: "scenes/act6/school_corridor_door_dusk_512.png",
      past: [["旁白", "走廊里没有人。"], ["旁白", "护栏边的光已经淡了。"]],
      later: [["旁白", "我没有因此觉得她离我更远。"], ["旁白", "只是第一次意识到，我认识的她，不是她的全部。"]]
    }
  ];

  const LATER_AT = 50;   // 滑过一半才换旁白
  const READY_AT = 92;   // 滑到这儿才算读过「后来」

  let liveMemory = null;

  function memory(opts) {
    const start = Math.min(Math.max(0, Number(opts && opts.segmentsSeen) || 0), MEMORY_SEGMENTS.length - 1);

    return new Promise(function (resolve) {
      let index = start;
      let value = 0;
      let unlocked = false;
      let settled = false;

      const panel = document.createElement("section");
      panel.id = "mgMemory";
      panel.className = "memory-panel";
      panel.hidden = true;
      panel.innerHTML =
        '<div class="memory-top"><span class="memory-step" id="memoryStep"></span>' +
        '<span class="memory-dots" id="memoryDots"></span></div>' +
        '<div class="memory-caption" id="memoryCaption"></div>' +
        '<div class="memory-control">' +
          '<span>那时</span>' +
          '<input id="memoryRange" type="range" min="0" max="100" step="1" value="0" aria-label="记忆滑块，从那时滑到后来">' +
          '<span>后来</span>' +
        '</div>' +
        '<p class="memory-note" id="memoryNote">拖动滑块，从那时滑到后来。</p>' +
        '<button id="memoryNext" type="button" hidden>继续</button>';

      const range = panel.querySelector("#memoryRange");
      const caption = panel.querySelector("#memoryCaption");
      const stepEl = panel.querySelector("#memoryStep");
      const dotsEl = panel.querySelector("#memoryDots");
      const noteEl = panel.querySelector("#memoryNote");
      const nextBtn = panel.querySelector("#memoryNext");

      // 压暗是单独一层：只压四周，不碰画面本身。
      const vignette = el("div", "memory-vignette");
      stage().appendChild(panel);
      stage().appendChild(vignette);

      function segment() { return MEMORY_SEGMENTS[index]; }

      function renderCaption(force) {
        const later = value >= LATER_AT;
        const key = index + (later ? ":later" : ":past");
        if (force || caption.dataset.key !== key) {
          caption.dataset.key = key;
          caption.replaceChildren();
          const list = later ? segment().later : segment().past;
          list.forEach(function (item) {
            const p = el("p");
            if (item[0] && item[0] !== "旁白") p.append(el("b", null, item[0]));
            p.append(document.createTextNode(item[1]));
            caption.append(p);
          });
          caption.classList.remove("swap");
          void caption.offsetWidth;
          caption.classList.add("swap");
        }
        const dark = later ? Math.min(0.62, ((value - LATER_AT) / (100 - LATER_AT)) * 0.62) : 0;
        vignette.style.opacity = String(dark);
        // 只在真的滑到后来时压低环境音；本章还没有音轨，接口在 duckAmbient 里。
        duckAmbient(later);
      }

      function showSegment() {
        const seg = segment();
        value = 0;
        unlocked = false;
        range.value = "0";
        stepEl.textContent = seg.label;
        dotsEl.replaceChildren();
        MEMORY_SEGMENTS.forEach(function (s, i) {
          dotsEl.append(el("i", i < index ? "done" : i === index ? "now" : ""));
        });
        nextBtn.hidden = true;
        noteEl.textContent = "拖动滑块：左边是那时，右边是后来。拖回去可以再读一次。";
        renderCaption(true);
        const a = api();
        if (a) a.scene("原来在那之前", seg.when, seg.bg);
      }

      function onInput() {
        if (settled) return;
        value = Number(range.value) || 0;
        if (value >= READY_AT && !unlocked) {
          unlocked = true;
          nextBtn.hidden = false;
          noteEl.textContent = "可以继续，也可以拖回左边再读一次。";
          blip();
        }
        renderCaption();
      }

      async function next() {
        if (settled || !unlocked) return;
        click();
        const a = api();
        if (a) a.persist({ memorySegmentsSeen: index + 1 });
        if (index >= MEMORY_SEGMENTS.length - 1) { finish("done"); return; }
        // 先黑场再换段：段号真的变了的时候，画面一定已经换过去了。
        if (a && a.curtain) { try { await a.curtain(320); } catch (error) { console.error(error); } }
        if (settled) return;
        index++;
        showSegment();
      }

      function onKey(event) {
        if (settled || event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        finish("cancel");
      }

      function fail(error) {
        console.error(error);
        finish("error", error);
      }

      function guard(fn) {
        return function (event) {
          try {
            const result = fn(event);
            if (result && typeof result.catch === "function") result.catch(fail);
          } catch (error) { fail(error); }
        };
      }

      function finish(kind, error) {
        if (settled) return;
        settled = true;
        document.removeEventListener("keydown", onKeyGuard, true);
        duckAmbient(false);
        hide(panel);
        vignette.style.opacity = "0";
        setTimeout(function () {
          panel.remove();
          vignette.remove();
        }, 280);
        liveMemory = null;
        if (kind === "error") { resolve({ completed: false, error: String(error) }); return; }
        resolve({
          completed: kind === "done",
          cancelled: kind === "cancel",
          segmentsSeen: index + (kind === "done" ? 1 : 0)
        });
      }

      const onKeyGuard = guard(onKey);
      range.addEventListener("input", guard(onInput));
      range.addEventListener("change", guard(onInput));
      nextBtn.addEventListener("click", guard(next));
      document.addEventListener("keydown", onKeyGuard, true);

      liveMemory = {
        get segment() { return index; },
        get value() { return value; },
        get unlocked() { return unlocked; },
        get open() { return !settled; }
      };

      showSegment();
      show(panel);
    });
  }

  // ================================================================ 那张照片

  /**
   * 按 photo.js 存下的构图，把挑中的那张照片用 DOM 复现一两秒，然后收掉。
   * 没有照片、或者素材没接上时返回 false，剧情换成一句短旁白。
   */
  async function showPhoto(picked) {
    if (!picked || !Array.isArray(picked.positions) || !picked.positions.length) return false;
    if (typeof D.renderPhotoShot !== "function") return false;

    const shot = {
      zoom: picked.zoom === "near" ? "near" : "far",
      event: picked.event || "normal",
      // 事件 07 落在地上的那架纸飞机只在拍到了的时候复现；没有就跳过。
      plane: picked.plane || null,
      actors: picked.positions.map(function (p) {
        return { who: p.who, x: Number(p.x) || 0.5, y: Number(p.y) || 0.93 };
      })
    };

    const wrap = el("div", "memory-photo");
    const paper = el("div", "memory-polaroid");
    const slot = el("div", "mp-shot");
    const stageEl = el("div", "photo-stage");
    slot.append(stageEl);
    paper.append(slot);
    wrap.append(paper);
    stage().appendChild(wrap);

    try {
      D.renderPhotoShot(stageEl, shot);
    } catch (error) {
      console.error(error);
      wrap.remove();
      return false;
    }

    requestAnimationFrame(function () { wrap.classList.add("show"); });
    await sleep(1700);
    wrap.classList.remove("show");
    await sleep(420);
    wrap.remove();
    return true;
  }

  global.ACT6Flow = {
    timing: timing,
    cards: cards,
    bulletin: bulletin,
    memory: memory,
    showPhoto: showPhoto,
    deckFor: deckFor,
    judge: judge,
    bulletinItems: BULLETIN_ITEMS,
    bulletinSlots: BULLETIN_SLOTS,
    segments: MEMORY_SEGMENTS,
    timingState: function () {
      return liveTiming
        ? { open: liveTiming.open, window: liveTiming.window, waits: liveTiming.waits, actions: liveTiming.actions }
        : null;
    },
    cardState: function () {
      return liveCards
        ? { open: liveCards.open, deck: liveCards.deck, placement: liveCards.placement, picked: liveCards.picked }
        : null;
    },
    bulletinState: function () {
      return liveBulletin
        ? { open: liveBulletin.open, placed: liveBulletin.placed, tilts: liveBulletin.tilts, helped: liveBulletin.helped, joke: liveBulletin.joke }
        : null;
    },
    memoryState: function () {
      return liveMemory
        ? { open: liveMemory.open, segment: liveMemory.segment, value: liveMemory.value, unlocked: liveMemory.unlocked }
        : null;
    }
  };
})(window);

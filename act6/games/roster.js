/* D04 · 值日表
 *
 * 三班的值日表排不过来。朱里和由乃放学后留在公告栏边整理，和臣只是来帮忙
 * 贴通知，被拉来一起摆名字卡——他不在这个班，名字也不在表上。
 *
 * 3×3 格子（周二/周三/周四 × 擦黑板/扫地/倒垃圾），四张名字卡可以重复用。
 * 没有计时、没有分数，排错时她们只提醒一句，改完就能过。
 */
(function (global) {
  "use strict";

  const D = global.DAILY;
  D.games = D.games || {};

  const DAYS = [
    { id: "tue", name: "周二" },
    { id: "wed", name: "周三" },
    { id: "thu", name: "周四" }
  ];
  const TASKS = [
    { id: "board", name: "擦黑板" },
    { id: "floor", name: "扫地" },
    { id: "trash", name: "倒垃圾" }
  ];
  const NAMES = [
    { id: "jurie", name: "朱里" },
    { id: "yuno", name: "由乃" },
    { id: "classmateA", name: "同学甲" },
    { id: "classmateB", name: "同学乙" }
  ];

  // 每个人各自的限制。都是三班的同学，和臣不参与排班。
  const RULES = [
    { who: "jurie", notDay: "wed", text: "我周三不行。" },
    { who: "yuno", notDay: "tue", text: "别把我排周二，求你了。" },
    { who: "classmateA", onlyDay: "thu", text: "我只有周四有空。" },
    { who: "classmateB", notTask: "trash", text: "我倒垃圾总是赶不上。" }
  ];

  D.games.roster = function (host) {
    const panel = document.getElementById("roster");
    const gridEl = document.getElementById("rosterGrid");
    const pool = document.getElementById("rosterPool");
    const tipEl = document.getElementById("rosterTip");
    const checkBtn = document.getElementById("rosterCheck");
    const clearBtn = document.getElementById("rosterClear");
    const skipBtn = document.getElementById("rosterSkip");

    let grid = Object.create(null);   // "tue:board" -> who
    let held = null;                  // 手里拿着的名字
    let focus = { day: 0, task: 0 };
    let state = "intro";              // intro | arrange | done
    let t = 0;
    let bgKey = "board";
    let cast = [];
    let ghost = null;
    let dragging = false;
    let disposed = false;

    // ------------------------------------------------------------ 画面

    function draw(ctx) {
      const bg = D.img[bgKey];
      if (bg) ctx.drawImage(bg, 0, 0, D.W, D.H);
      else { ctx.fillStyle = "#241f28"; ctx.fillRect(0, 0, D.W, D.H); }
      const list = cast.slice().sort(function (a, b) { return a.y - b.y; });
      for (const a of list) D.shadow(ctx, a.x, a.y + 1, D.FRAME_W);
      for (const a of list) D.drawActor(ctx, a, t);
    }

    // ------------------------------------------------------------ 表格

    function buildGrid() {
      gridEl.replaceChildren();

      gridEl.appendChild(D.ui.el("span", "roster-corner", ""));

      TASKS.forEach(function (task) {
        gridEl.appendChild(D.ui.el("span", "roster-head", task.name));
      });

      DAYS.forEach(function (day, dayIndex) {
        gridEl.appendChild(D.ui.el("span", "roster-day", day.name));
        TASKS.forEach(function (task, taskIndex) {
          const key = day.id + ":" + task.id;
          const cell = document.createElement("button");
          cell.type = "button";
          cell.className = "roster-cell";
          cell.dataset.key = key;
          cell.addEventListener("click", function () {
            if (state !== "arrange") return;
            focus = { day: dayIndex, task: taskIndex };
            paint();
            if (held) {
              place(key, held);
            } else if (grid[key]) {
              delete grid[key];
              D.audio.blip();
              paint();
            }
          });
          gridEl.appendChild(cell);
        });
      });

      // 名字卡：可以重复用，一个人可以做几个格子
      pool.replaceChildren();
      NAMES.forEach(function (person, i) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "roster-card";
        card.dataset.who = person.id;
        card.append(D.ui.el("b", "", person.name), D.ui.el("i", "", String(i + 1)));
        card.addEventListener("click", function () {
          if (state !== "arrange") return;
          if (performance.now() < suppressUntil) return;
          held = held === person.id ? null : person.id;
          D.audio.click();
          paint();
        });
        card.addEventListener("pointerdown", function (e) {
          if (state !== "arrange") return;
          startDrag(e, person.id);
        });
        pool.appendChild(card);
      });
    }

    function paint() {
      const cells = gridEl.querySelectorAll(".roster-cell");
      for (const cell of cells) {
        const who = grid[cell.dataset.key];
        const person = who ? NAMES.find(function (n) { return n.id === who; }) : null;
        cell.textContent = person ? person.name : "";
        cell.classList.toggle("filled", !!person);
        const key = cell.dataset.key;
        cell.classList.toggle("focus", key === DAYS[focus.day].id + ":" + TASKS[focus.task].id);
        cell.classList.remove("warn");
      }
      const cards = pool.querySelectorAll(".roster-card");
      for (const card of cards) card.classList.toggle("on", card.dataset.who === held);
    }

    function place(key, who) {
      const day = key.split(":")[0];
      const task = key.split(":")[1];
      // 同一个人同一天不能做两样：把当天另一个格子让出来，比弹提示顺手
      TASKS.forEach(function (t2) {
        const other = day + ":" + t2.id;
        if (other !== key && grid[other] === who) delete grid[other];
      });
      grid[key] = who;
      D.audio.click();
      paint();
    }

    // ------------------------------------------------------------ 拖拽
    // 点击选中 + 点格子是主路径；按住名字卡拖过去也行。
    // 拖拽只在真的动了之后才算，不然 pointerdown 会把点击选中抢掉。

    let pressInfo = null;
    let suppressUntil = 0;

    function startDrag(e, who) {
      pressInfo = { who: who, x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
      window.addEventListener("pointermove", onDragMove);
      window.addEventListener("pointerup", onDragUp);
      window.addEventListener("pointercancel", onDragCancel);
    }

    function onDragMove(e) {
      if (!pressInfo) return;
      if (!pressInfo.moved) {
        if (Math.abs(e.clientX - pressInfo.x) < 4 && Math.abs(e.clientY - pressInfo.y) < 4) return;
        pressInfo.moved = true;
        dragging = true;
        held = pressInfo.who;
        paint();
        ghost = D.ui.el("div", "roster-ghost", NAMES.find(function (n) { return n.id === pressInfo.who; }).name);
        document.body.appendChild(ghost);
      }
      ghost.style.left = e.clientX + "px";
      ghost.style.top = e.clientY + "px";
      e.preventDefault();
    }

    function onDragUp(e) {
      window.removeEventListener("pointermove", onDragMove);
      window.removeEventListener("pointerup", onDragUp);
      window.removeEventListener("pointercancel", onDragCancel);
      const moved = pressInfo && pressInfo.moved;
      if (ghost) { ghost.remove(); ghost = null; }
      dragging = false;
      pressInfo = null;
      if (!moved) return;          // 没动就是一次点击，交给 click 处理
      // 拖拽结束后紧跟的这次 click 不算点选；用时间窗而不是一次性布尔，
      // 免得拖到空白处没有 click、下一次点名字卡时被误吞。
      suppressUntil = performance.now() + 350;
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const cell = target && target.closest ? target.closest(".roster-cell") : null;
      if (cell && held) place(cell.dataset.key, held);
    }

    function onDragCancel() {
      window.removeEventListener("pointermove", onDragMove);
      window.removeEventListener("pointerup", onDragUp);
      window.removeEventListener("pointercancel", onDragCancel);
      if (ghost) { ghost.remove(); ghost = null; }
      dragging = false;
      pressInfo = null;
      suppressUntil = performance.now() + 350;
    }

    // ------------------------------------------------------------ 检查

    /** 返回第一条冲突；没有就返回 null。不判分，只指出哪一条排不下。 */
    function check() {
      for (const r of RULES) {
        for (const key in grid) {
          if (grid[key] !== r.who) continue;
          const day = key.split(":")[0];
          const task = key.split(":")[1];
          if (r.notDay && day === r.notDay) return { who: r.who, text: r.text, key: key };
          if (r.onlyDay && day !== r.onlyDay) return { who: r.who, text: r.text, key: key };
          if (r.notTask && task === r.notTask) return { who: r.who, text: r.text, key: key };
        }
      }

      // 同一个人同一天被排了两样（正常放置会自己让开，这里兜一下手动改过的）
      for (const day of DAYS) {
        const seen = Object.create(null);
        for (const task of TASKS) {
          const who = grid[day.id + ":" + task.id];
          if (!who) continue;
          if (seen[who]) return { who: who, text: "一个人一天只能做一样。", key: day.id + ":" + task.id };
          seen[who] = true;
        }
      }

      for (const person of NAMES) {
        const used = Object.keys(grid).some(function (k) { return grid[k] === person.id; });
        if (!used) return { who: person.id, text: "我还没被排上。", key: null };
      }

      for (const day of DAYS) {
        let n = 0;
        for (const task of TASKS) if (grid[day.id + ":" + task.id]) n++;
        if (n < 2) return { who: "jurie", text: day.name + "至少要有两个人。", key: null };
      }

      return null;
    }

    function doCheck() {
      if (state !== "arrange") return;
      const bad = check();
      if (bad) {
        const person = NAMES.find(function (n) { return n.id === bad.who; });
        D.audio.wrong();
        D.react(person ? person.name : "朱里", bad.text, 2000);
        if (bad.key) {
          const cell = gridEl.querySelector('[data-key="' + bad.key + '"]');
          if (cell) cell.classList.add("warn");
        }
        if (tipEl) tipEl.textContent = "她说的是那一条。改完再按一次「这样排」；实在排不出来，也可以「就先这样」。";
        return;
      }
      state = "done";
      D.ui.hide(panel);
      done(false);
    }

    /** 不要求合法解：实在排不出来时跳过，只换一段短对白。 */
    function skip() {
      if (state !== "arrange") return;
      state = "done";
      D.ui.hide(panel);
      done(true);
    }

    async function done(skipped) {
      await D.sleep(220);
      if (disposed) return;
      D.objective(skipped ? "先这样" : "排好了", "");
      await D.lines(skipped ? [
        ["和臣", "……我好像排不出来。"],
        ["朱里", "没关系，先这样吧。"],
        ["由乃", "反正到时候还能换。"],
        ["旁白", "她把几格空着的地方用笔圈起来，说回头再补。"]
      ] : [
        ["由乃", "能不能换一天？"],
        ["朱里", "不能。"],
        ["由乃", "为什么。"],
        ["朱里", "你周二不在，周三又不想倒垃圾。"],
        ["由乃", "……你记得真清楚。"],
        ["旁白", "她把最后一格压平，往后退了半步。"],
        ["和臣", "那我先回去了。"],
        ["朱里", "嗯。谢谢。"],
        ["旁白", "我贴完手里那几张通知就走了。值日表上没有我的名字。"]
      ]);
      if (disposed) return;

      const solution = {};
      Object.keys(grid).forEach(function (k) { solution[k] = grid[k]; });
      D.persist({ rosterCompleted: true, rosterSolution: solution, rosterSkipped: !!skipped });
      host.done({ id: "roster", completed: true, solution: solution, skipped: !!skipped });
    }

    // ------------------------------------------------------------ 流程

    async function run() {
      D.objective("把四张名字卡摆进格子里", "谁哪天不行，她会提醒你");
      D.ui.show(panel);
      buildGrid();
      paint();

      await D.lines([
        ["朱里", "你来得正好。帮我把这几张通知贴一下。"],
        ["和臣", "贴哪儿。"],
        ["由乃", "右边。别又贴歪了。"],
        ["朱里", "等一下。值日表还差一张。"],
        ["由乃", "你们班的值日表，为什么拉我排。"],
        ["朱里", "因为你也在这个表上。"],
        ["旁白", "她把四张名字卡摊在公告栏下面的台子上。"],
        ["朱里", "你只负责按我们说的摆。别的不算你的。"],
        ["和臣", "……好。"]
      ]);
      if (disposed) return;

      state = "arrange";
      if (tipEl) tipEl.textContent = "点一个名字，再点一个格子。四张名字都要排上，每天至少两个人。";
    }

    // ------------------------------------------------------------ 壳

    function start() {
      D.clearReact();
      host.setChapter("第 3 天 · 午休");
      D.hint(null);
      bgKey = "board";
      cast = [
        { key: "boy", x: 128, y: 262, dir: 1, face: "right", phase: 0 },
        { key: "girl", x: 246, y: 262, dir: 1, face: "right", phase: 0.5 },
        { key: "friend", x: 356, y: 262, dir: -1, face: "down", phase: 1.1 }
      ];

      checkBtn.onclick = doCheck;
      skipBtn.onclick = skip;
      clearBtn.onclick = function () {
        if (state !== "arrange") return;
        grid = Object.create(null);
        D.audio.blip();
        paint();
        if (tipEl) tipEl.textContent = "都拿回来了。再摆一次也行。";
      };

      run().catch(function (error) {
        console.error(error);
        state = "done";
        host.done({ id: "roster", completed: false, error: String(error) });
      });
    }

    function update(dt) {
      t += dt;
      for (const a of cast) if (!a.moving) a.phase += dt * 0.5;
    }

    function press(key) {
      if (state !== "arrange") return;
      const k = key.toLowerCase();
      if (k === "escape") { held = null; paint(); return; }
      if (k === "enter") { doCheck(); return; }   // Enter 提交整套排表
      if (k === " ") {
        const key2 = DAYS[focus.day].id + ":" + TASKS[focus.task].id;
        if (held) place(key2, held);
        else if (grid[key2]) { delete grid[key2]; D.audio.blip(); paint(); }
        return;
      }
      if (k === "backspace" || k === "delete") {
        const key2 = DAYS[focus.day].id + ":" + TASKS[focus.task].id;
        if (grid[key2]) { delete grid[key2]; D.audio.blip(); paint(); }
        return;
      }
      if (k === "arrowleft" || k === "a") { focus.task = (focus.task + 2) % 3; paint(); return; }
      if (k === "arrowright" || k === "d") { focus.task = (focus.task + 1) % 3; paint(); return; }
      if (k === "arrowup" || k === "w") { focus.day = (focus.day + 2) % 3; paint(); return; }
      if (k === "arrowdown" || k === "s") { focus.day = (focus.day + 1) % 3; paint(); return; }
      const n = Number(key);
      if (n >= 1 && n <= 4) { held = NAMES[n - 1].id; D.audio.click(); paint(); }
    }

    function dispose() {
      disposed = true;
      checkBtn.onclick = null;
      skipBtn.onclick = null;
      clearBtn.onclick = null;
      window.removeEventListener("pointermove", onDragMove);
      window.removeEventListener("pointerup", onDragUp);
      window.removeEventListener("pointercancel", onDragCancel);
      if (ghost) { ghost.remove(); ghost = null; }
      dragging = false;
      D.ui.hide(panel, 0);
      gridEl.replaceChildren();
      pool.replaceChildren();
      D.objective(null);
      D.hint(null);
    }

    return {
      id: "roster",
      title: "值日表",
      start: start,
      update: update,
      draw: draw,
      press: press,
      setFrozen: function () { /* 没有计时，不用冻 */ },
      dispose: dispose,
      get state() { return state; },
      get grid() { return Object.assign({}, grid); },
      get held() { return held; },
      check: check
    };
  };

})(window);



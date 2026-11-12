/* D05 · 传纸条
 *
 * 自习课，四班教室。同桌从后排递来一张纸条，要传到前排朋友甲手里。
 * 老师在讲台前批作业，偶尔抬头、偶尔转身写黑板：低头和转身时安全，
 * 抬头扫视时传出去就会被看见。
 *
 * 被抓不是失败：纸条没收，从上一个检查点重来；第三次被发现，老师只说一句
 * 「下课再说」，纸条照样传过去，不会卡在这里。
 */
(function (global) {
  "use strict";

  const D = global.DAILY;
  D.games = D.games || {};

  const COLS = [132, 215, 291, 368, 445];
  const DESK_TOP = [140, 188, 237];   // 0 = 靠黑板的前排，2 = 靠镜头这边的后排

  // 和臣 → 同桌 → 前一排 → 再前一排 → 朋友甲，一共四格。
  const PATH = [
    { c: 2, r: 2, who: "me" },
    { c: 3, r: 2, who: "mate" },
    { c: 3, r: 1, who: "mid" },
    { c: 3, r: 0, who: "front" },
    { c: 2, r: 0, who: "friend" }
  ];
  const CHECKPOINTS = [0, 2, 4];

  const TEACHER = {
    down: { name: "低头批作业", safe: true, min: 2.0, max: 3.4 },
    scan: { name: "抬头扫视", safe: false, min: 0.8, max: 1.4 },
    turn: { name: "转身写黑板", safe: true, min: 1.2, max: 2.0 }
  };

  const NOTES = [
    { id: "note_01", text: "放学别先走，公告栏那边等你。" },
    { id: "note_02", text: "你刚才是不是睡着了。" },
    { id: "note_03", text: "借我一块橡皮。" }
  ];

  function seat(index) {
    const p = PATH[index];
    return { x: COLS[p.c], top: DESK_TOP[p.r], who: p.who };
  }

  D.games.passnote = function (host) {
    const hud = document.getElementById("passHud");
    const teacherLabel = document.getElementById("passTeacher");
    const countLabel = document.getElementById("passCount");
    const canvas = document.getElementById("mg");

    let state = "intro";      // intro | pass | caught | done
    let hop = 0;              // 0..4，纸条现在在第几个座位
    let checkpoint = 0;
    let teacher = "down";
    let teacherT = 0;
    let caughtCount = 0;
    let note = NOTES[Math.floor(Math.random() * NOTES.length)];
    let slide = { from: 0, t: 1 };  // 纸条从上一格滑过来的动画
    let flash = 0;
    let frozen = false;
    let t = 0;
    let disposed = false;
    let bgKey = "classroom";
    let seated = [];
    let cast = [];

    // ------------------------------------------------------------ 座位

    function buildSeats() {
      seated = PATH.map(function (p, i) {
        const s = seat(i);
        if (p.who === "me") return { key: "boy", x: s.x, y: s.top + 44, top: s.top, face: "up", dir: "up", phase: 0, size: 0.85, clip: true, moving: false };
        if (p.who === "friend") return { key: "friendAUp", x: s.x, y: s.top + 44, top: s.top, face: "up", dir: "up", phase: 0.4, size: 0.85, clip: true, moving: false };
        return { key: i === 1 ? "npcBoy" : "npcGirl", x: s.x, y: s.top + 44, top: s.top, face: "up", dir: "up", phase: i * 0.9, size: 0.85, clip: true, moving: false };
      });
      // 后排两侧各坐一个人，教室不至于空着
      seated.push(
        { key: "npcGirl", x: COLS[0], y: DESK_TOP[1] + 44, top: DESK_TOP[1], face: "up", dir: "up", phase: 1.7, size: 0.82, clip: true, moving: false },
        { key: "npcBoy", x: COLS[4], y: DESK_TOP[2] + 44, top: DESK_TOP[2], face: "up", dir: "up", phase: 2.4, size: 0.82, clip: true, moving: false }
      );
    }

    function notePos() {
      const a = seat(Math.max(0, hop - (slide.t < 1 ? 1 : 0)));
      const b = seat(hop);
      const k = slide.t >= 1 ? 1 : slide.t;
      return {
        x: D.lerp(a.x, b.x, k),
        y: D.lerp(a.top, b.top, k) + 2
      };
    }

    // ------------------------------------------------------------ 老师

    function setTeacher(next) {
      teacher = next;
      const cfg = TEACHER[next];
      teacherT = cfg.min + Math.random() * (cfg.max - cfg.min);
      if (teacherLabel) teacherLabel.textContent = cfg.name;
      if (hud) hud.classList.toggle("danger", !cfg.safe);
    }

    function nextTeacher() {
      // 低头之后不是抬头就是转身；抬头/转身之后一定低头。
      if (teacher === "down") setTeacher(Math.random() < 0.55 ? "scan" : "turn");
      else setTeacher("down");
    }

    // ------------------------------------------------------------ 传

    function doPass() {
      if (state !== "pass" || frozen || D.dialogOpen()) return;
      if (hop >= PATH.length - 1) return;
      if (slide.t < 1) return;          // 上一格还在滑，等 0.25 秒动画走完

      if (!TEACHER[teacher].safe) {
        caught();
        return;
      }

      hop++;
      slide = { from: hop - 1, t: 0 };
      D.audio.blip();
      if (CHECKPOINTS.indexOf(hop) >= 0) checkpoint = hop;
      if (countLabel) countLabel.textContent = "传了 " + hop + " 格";
      if (hop >= PATH.length - 1) {
        state = "done";
        receive();
      }
    }

    async function caught() {
      state = "caught";
      caughtCount++;
      flash = 0.5;
      D.audio.wrong();
      setTeacher("scan");
      if (countLabel) countLabel.textContent = "纸条被拿走了";

      if (caughtCount >= 3) {
        await D.lines([
          ["老师", "上课传什么。"],
          ["旁白", "她走过来，把纸条从我桌上抽走，看了一眼。"],
          ["老师", "……下课再说。"],
          ["旁白", "她把纸条折了一下，又放回前排的桌角。"]
        ]);
        if (disposed) return;
        hop = PATH.length - 1;
        slide = { from: PATH.length - 2, t: 0 };
        if (countLabel) countLabel.textContent = "传了 4 格";
        state = "done";
        receive();
        return;
      }

      await D.lines([
        ["老师", "上课传什么。"],
        ["旁白", "纸条被没收了。" + (checkpoint > 0 ? "好在前一排的人已经看过一遍。" : "只好从头再来一次。")]
      ]);
      if (disposed) return;

      hop = checkpoint;
      slide = { from: checkpoint, t: 1 };
      state = "pass";
      setTeacher("down");
      if (countLabel) countLabel.textContent = "传了 " + hop + " 格";
    }

    async function receive() {
      await D.sleep(300);
      if (disposed) return;
      await D.lines([
        ["旁白", "纸条传到前排。朋友甲把它压在胳膊底下，展开一条缝。"],
        ["旁白", "「" + note.text + "」"],
        ["旁白", "他笑了一下，又很快把纸条收进袖子里。"]
      ]);
      if (disposed) return;

      // 下课：三班门口，把这件事讲给朱里和由乃听
      bgKey = "corridor";
      seated = [];
      setScene();
      if (hud) hud.hidden = true;

      const caughtLine = caughtCount === 0
        ? "我今天上课传纸条，一次都没被发现。"
        : caughtCount >= 3
          ? "我今天上课传纸条，被老师抓了三次。"
          : "我今天上课传纸条，被老师抓了。";
      await D.lines([
        ["旁白", "下课以后，我绕到三班门口。"],
        ["和臣", caughtLine],
        ["由乃", "你还会传纸条？"],
        ["朱里", "传的什么？"],
        ["和臣", "……忘了。"],
        ["朱里", "那就是不想说。"],
        ["旁白", "她笑了一下，没有追问。"],
        ["由乃", "写的什么啊，说一半。"],
        ["和臣", "真的忘了。"]
      ]);
      if (disposed) return;

      state = "done";
      D.persist({ passNoteCompleted: true, passNoteCaught: caughtCount, passNoteContent: note.id });
      host.done({ id: "passnote", completed: true, caught: caughtCount, content: note.id });
    }

    function setScene() {
      // 下课后的走廊：朱里和由乃在门口
      cast = [
        { key: "boy", x: 196, y: 254, dir: 1, face: "right", phase: 0 },
        { key: "girl", x: 286, y: 254, dir: -1, face: "left", phase: 0.5 },
        { key: "friend", x: 352, y: 254, dir: -1, face: "down", phase: 1.0 }
      ];
    }

    // ------------------------------------------------------------ 画面

    function drawSeated(ctx, a) {
      // 只露出桌子以上那一点：把画布裁到桌面线，人就坐在桌子后面
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, D.W, a.top + 6);
      ctx.clip();
      D.shadow(ctx, a.x, a.y + 1, D.FRAME_W * a.size);
      D.drawActor(ctx, a, t);
      ctx.restore();
    }

    function drawTeacher(ctx) {
      // 老师：（12 帧表）1 低头批作业 / 2 抬头扫视 / 3 背身写黑板。
      // 低头那一帧胸前的作业本是画在帧里的，这里不再补画。
      const pose = teacher === "turn" ? "poseTurn" : teacher === "scan" ? "poseScan" : "poseDown";
      const x = 250;
      const footY = 130;
      D.shadow(ctx, x, footY + 1, D.FRAME_W * 0.95);
      D.drawActor(ctx, {
        key: "teacher", x: x, y: footY, dir: "down", face: "down",
        moving: false, pose: pose, phase: 0, scale: 0.95
      }, t);
    }

    function draw(ctx) {
      const bg = D.img[bgKey];
      if (bg) ctx.drawImage(bg, 0, 0, D.W, D.H);
      else { ctx.fillStyle = "#241f28"; ctx.fillRect(0, 0, D.W, D.H); }

      if (bgKey === "classroom") {
        // 扫视时整个画面轻轻暗一点，给玩家一个反应的空
        if (!TEACHER[teacher].safe) {
          ctx.fillStyle = "rgba(24,18,30,.16)";
          ctx.fillRect(0, 0, D.W, D.H);
        }
        for (const a of seated) drawSeated(ctx, a);
        drawTeacher(ctx);

        // 纸条：一小片浅色纸，落在桌面上
        if (state === "pass" || state === "caught" || state === "done") {
          const p = notePos();
          ctx.save();
          ctx.fillStyle = "#f4ead6";
          ctx.fillRect(Math.round(p.x - 4), Math.round(p.y - 3), 9, 5);
          ctx.strokeStyle = "#b9a384";
          ctx.lineWidth = 1;
          ctx.strokeRect(Math.round(p.x - 4) + 0.5, Math.round(p.y - 3) + 0.5, 8, 4);
          ctx.restore();
        }

        // 当前那一格脚下画一个很轻的圈，别让人找不着
        if (state === "pass") {
          const s = seat(hop);
          ctx.save();
          ctx.strokeStyle = "rgba(255,212,151,.5)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.ellipse(s.x, s.top + 40, 15, 4.5, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        if (flash > 0) {
          ctx.fillStyle = "rgba(255,232,200," + (flash * 0.55).toFixed(3) + ")";
          ctx.fillRect(0, 0, D.W, D.H);
        }
      } else {
        const list = cast.slice().sort(function (a, b) { return a.y - b.y; });
        for (const a of list) D.shadow(ctx, a.x, a.y + 1, D.FRAME_W);
        for (const a of list) D.drawActor(ctx, a, t);
      }
    }

    // ------------------------------------------------------------ 流程

    async function run() {
      D.objective("把纸条传到前排", "老师在低头时按空格");
      D.hint("空格 / 点一下 · 传一格", 3600);
      buildSeats();
      setTeacher("down");
      if (hud) hud.hidden = false;
      if (countLabel) countLabel.textContent = "传了 0 格";

      await D.lines([
        ["旁白", "自习课。黑板上还留着上一节课的板书。"],
        ["旁白", "同桌从后面递过来一张折了两折的纸条。"],
        ["同桌", "往前传，给朋友甲。"],
        ["和臣", "……现在？"],
        ["同桌", "老师在批作业，看不见。快点。"],
        ["旁白", "讲台前，老师低着头，红笔在本子上划。"]
      ]);
      if (disposed) return;

      state = "pass";
      D.hint("老师在低头或转身时，按空格往前传", 3200);
    }

    // ------------------------------------------------------------ 壳

    function start() {
      D.clearReact();
      host.setChapter("第 5 天 · 上午");
      D.hint(null);
      bgKey = "classroom";
      cast = [];
      canvas.addEventListener("pointerdown", onCanvasDown);
      run().catch(function (error) {
        console.error(error);
        state = "done";
        host.done({ id: "passnote", completed: false, error: String(error) });
      });
    }

    function onCanvasDown() {
      if (state === "pass" && !D.dialogOpen()) doPass();
    }

    function update(dt) {
      t += dt;
      if (flash > 0) flash = Math.max(0, flash - dt);
      if (slide.t < 1) slide.t = Math.min(1, slide.t + dt / 0.25);

      if (state === "pass" && !frozen && !D.dialogOpen()) {
        teacherT -= dt;
        if (teacherT <= 0) nextTeacher();
      }
      for (const a of seated) a.phase += dt * 0.4;
    }

    function press(key) {
      if (state !== "pass") return;
      const k = key.toLowerCase();
      if (k === " " || k === "enter" || k === "e") doPass();
    }

    function dispose() {
      disposed = true;
      canvas.removeEventListener("pointerdown", onCanvasDown);
      if (hud) { hud.hidden = true; hud.classList.remove("danger"); }
      D.objective(null);
      D.hint(null);
      D.clearReact();
    }

    return {
      id: "passnote",
      title: "传纸条",
      start: start,
      update: update,
      draw: draw,
      press: press,
      setFrozen: function (v) { frozen = !!v; },
      dispose: dispose,
      get state() { return state; },
      get hop() { return hop; },
      get teacher() { return teacher; },
      get caught() { return caughtCount; },
      /** 自检用：现在用的是哪一帧姿势。 */
      get pose() {
        return teacher === "turn" ? "poseTurn" : teacher === "scan" ? "poseScan" : "poseDown";
      },
      force: function (which) { setTeacher(which); },
      step: function () { doPass(); }
    };
  };

})(window);



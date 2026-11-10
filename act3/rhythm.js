/* 第三幕 · 广播室 — 判定与双轨
 *
 * 两条轨道：粉的是她的，蓝的是你的。她的自动命中，你的自己按。
 *
 * 这一版在原有三处「她在帮你」的基础上加了：
 *   F/J     高音按 J、低音按 F；空格只在试音后的前两小节等价
 *   噪音    空按 / Rest 里按 / 错键都会让电流声变大，每小节自己退一点
 *   双人长按 收尾那句 She holds first, you press within 300ms, release together ±200ms
 *   装饰音  副歌第二遍的弱拍，命中 +50，漏了不罚
 *
 * 判定时钟只认 audio.songTime()。这个文件里没有一处 setTimeout，也不碰 DOM。
 */
(function (global) {
  "use strict";

  // ---------------------------------------------------------------- 两档难度

  const DIFFS = {
    "演播": {
      name: "演播", perfect: 0.045, good: 0.110, ok: 0.250,
      approach: 1.55, noiseRescue: false,
      note: "标准档：判定宽一点，噪音只影响演出。"
    },
    "电台": {
      name: "电台", perfect: 0.035, good: 0.080, ok: 0.150,
      approach: 1.25, noiseRescue: true,
      note: "严格档：判定收紧，噪音到 80 她会替你接一句。"
    }
  };
  const DIFF_NAMES = ["演播", "电台"];
  const DEFAULT_DIFF = "演播";

  const BASE = { perfect: 1000, good: 700, ok: 400, miss: 0 };
  const RANK = [
    [0.95, "S"], [0.88, "A"], [0.78, "B"], [0.65, "C"], [0, "D"]
  ];

  // 噪音计：0–100。空按 +12、Rest 里按 +18、错键 +8，每小节自然退 6。
  const NOISE = {
    idle: 12, rest: 18, wrong: 8, decay: 6,
    grey: 50,       // ≥50 演出变灰、字幕带雪花点
    rescue: 80,     // ≥80（电台档）她替你接一句
    drop: 40,       // 接完之后回落到这里
    max: 100
  };

  const GRACE_SCORE = 50;
  const SYNC = { pressEarly: 0.10, pressLate: 0.30, release: 0.20 };
  const COVER_DELAY = 0.9;   // 她替你接一句时，粉轨补位音符延后多少拍

  /** 纯函数：偏差多少秒 → 档位。自检直接调它，不用跑实时。 */
  function judgeWith(delta, diff) {
    const a = Math.abs(delta);
    if (a <= diff.perfect) return "perfect";
    if (a <= diff.good) return "good";
    if (a <= diff.ok) return "ok";
    return "miss";
  }

  function diffOf(name) {
    return DIFFS[name] || DIFFS[DEFAULT_DIFF];
  }

  function createRhythm(chart, audio, hooks) {
    const h = hooks || {};
    const difficulty = DIFFS[h.difficulty] ? h.difficulty : DEFAULT_DIFF;
    const DIF = DIFFS[difficulty];
    const WIN = { perfect: DIF.perfect, good: DIF.good, ok: DIF.ok };

    function judge(delta) { return judgeWith(delta, DIF); }

    const HERS = chart.notes.filter((n) => n.lane === "her")
      .map((n) => Object.assign({}, n));
    const MINE = chart.notes.filter((n) => n.lane === "me")
      .map((n) => Object.assign({}, n));

    const GRACES = (chart.graces || []).map((n) => Object.assign({}, n));

    // 她的「托」音符：漏接接力之后补进来，也走她的轨道、也自动命中。
    // 关键：一开始 active = false。不然玩家还没漏，就看见「她准备替我念」的
    // 音符在半空中，而且不管你接没接住，到点都会替你把那句念一遍。
    const covers = [];
    for (const c of chart.covers || []) {
      const src = chart.notes.find((n) => n.id === c.forNote);
      if (!src) continue;
      const cov = {
        id: 9000 + c.forNote,
        lane: "her",
        type: "cover",
        beat: c.beat,
        time: c.time,
        dur: 0,
        text: src.text,
        line: src.line,
        chunk: src.chunk,
        seg: src.seg,
        forNote: c.forNote,
        chord: false,
        judged: false,
        cover: true,
        active: false
      };
      covers.push(cov);
    }
    const HER_ALL = HERS.concat(covers).sort(sortHers);
    const BASE_COVERS = covers.length;
    let HER_RUN = HER_ALL;

    function sortHers(a, b) { return a.time - b.time || a.id - b.id; }

    const S = {
      t: 0,
      hIdx: 0,
      mIdx: 0,
      gIdx: 0,
      combo: 0,
      maxCombo: 0,
      segMax: {},
      score: 0,
      counts: { perfect: 0, good: 0, ok: 0, miss: 0, wrong: 0 },
      rescues: 0,
      rescued: [],          // 被接住的音符 id
      hold: null,
      both: null,           // { event, pressedAt, releasedAt, synced }
      syncBoth: false,
      noise: 0,
      maxNoise: 0,
      lastBar: -1,
      last: null,           // { tier, delta, at, text }
      cue: null,
      cuesFired: 0,
      gracesHit: 0,
      finished: false,
      herDone: 0,
      skipped: 0,           // 跳段时略过的音符，不算漏、也不进准确率的分母
      lastNoiseCause: null
    };

    function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

    function mult() { return 1 + Math.min(0.5, S.combo * 0.01); }

    function award(tier, note) {
      if (tier === "miss") {
        S.combo = 0;
        S.counts.miss++;
        return 0;
      }
      if (tier === "wrong") {
        // 错键和漏按都算 miss 的惩罚，只是记录和判定字分开——
        // 玩家需要知道「我按错了」还是「我没按」。
        S.combo = 0;
        S.counts.wrong++;
        return 0;
      }
      // 倍率用「命中之前」的连击算：第一个 PERFECT 就该是整 1000。
      const m = mult();
      S.combo++;
      S.maxCombo = Math.max(S.maxCombo, S.combo);
      if (note && note.seg != null) {
        S.segMax[note.seg] = Math.max(S.segMax[note.seg] || 0, S.combo);
      }
      S.counts[tier]++;
      const add = Math.round(BASE[tier] * m);
      S.score += add;
      return add;
    }

    // ---------------------------------------------------------- 噪音计

    /** 纯状态更新：加/减噪音、记录峰值。阈值救援在 audio 帧的 update 里查。 */
    function addNoise(delta, cause) {
      const before = S.noise;
      S.noise = clamp(S.noise + delta, 0, NOISE.max);
      S.maxNoise = Math.max(S.maxNoise, S.noise);
      if (cause) S.lastNoiseCause = cause;
      if (before < NOISE.rescue && S.noise >= NOISE.rescue) checkNoiseRescue();
      return S.noise;
    }

    function noiseLevel() {
      if (S.noise >= NOISE.rescue) return "hot";
      if (S.noise >= NOISE.grey) return "grey";
      return "clean";
    }

    /** 电台档：噪音爆了，她替你接住下一句，噪音回落到 40。 */
    function checkNoiseRescue() {
      if (!DIF.noiseRescue) return false;   // 演播档不影响她的行
      if (S.noise < NOISE.rescue) return false;
      let next = null;
      for (let i = S.mIdx; i < MINE.length; i++) {
        const n = MINE[i];
        if (n.judged || n.both) continue;
        next = n;
        break;
      }
      S.noise = NOISE.drop;
      if (!next) return false;
      coverNote(next, "noise");
      return true;
    }

    /** 她替你接住一个音符：记 miss（和接力漏接同一种兜底），粉轨 0.9 拍后补一个「托」。
     *  如果这个音符本来就是接力（谱面上早配好了一个待激活的补位音符），
     *  就把它激活，不再多塞一个——同一句话不能念两遍。 */
    function coverNote(n, cause) {
      if (n.judged) return false;
      n.judged = true;
      n.result = "covered";
      n.covered = true;
      n.coverCause = cause || "noise";
      S.counts.miss++;
      S.combo = 0;
      S.rescues++;
      S.rescued.push(n.id);
      let cov = covers.find((c) => c.forNote === n.id);
      if (cov) {
        cov.active = true;
        cov.cause = n.coverCause;
      } else {
        cov = {
          id: 9500 + n.id,
          lane: "her",
          type: "cover",
          beat: n.beat + COVER_DELAY,
          time: chart.timeOfBeat(n.beat + COVER_DELAY),
          dur: 0,
          text: n.text,
          line: n.line,
          chunk: n.chunk,
          seg: n.seg,
          forNote: n.id,
          chord: false,
          judged: false,
          cover: true,
          active: true,
          cause: n.coverCause
        };
        covers.push(cov);
        HER_RUN.push(cov);
      }
      HER_RUN.sort(sortHers);
      resortHerIdx();
      h.onRescue && h.onRescue(n, cov);
      return true;
    }

    /** 插了补位音符之后重排她的游标：只跳过已经到点（并已判过）的部分。 */
    function resortHerIdx() {
      let i = 0;
      while (i < HER_RUN.length && HER_RUN[i].time < S.t - 1e-9) i++;
      S.hIdx = i;
    }

    // ---------------------------------------------------------- 她的轨道

    function hitHer(n) {
      if (n.judged) return;
      n.judged = true;
      n.result = "perfect";
      S.herDone++;
      if (n.cover) {
        // 替你把这一句念出来：音色是她的，音量比她平时低一点，像在压着嗓子补
        audio.say("her", n.text, audio.now(), { gain: 0.85, p: n.p });
        audio.cover(audio.now());
        h.onCover && h.onCover(n);
        return;
      }
      audio.say("her", n.text, audio.now(), { p: n.p });
      h.onHerNote && h.onHerNote(n);
    }

    // ---------------------------------------------------------- 我的轨道

    function missNote(n) {
      if (n.judged) return;
      n.judged = true;
      n.result = "miss";
      award("miss", n);
      S.last = { tier: "miss", delta: 0, at: S.t, text: n.text };
      h.onJudge && h.onJudge("miss", n, 0);
      if (n.type === "relay") rescue(n);
    }

    /** 她替你接住漏掉的接力。不是惩罚，是让这一句还能继续往下念。 */
    function rescue(n) {
      const cov = covers.find((c) => c.forNote === n.id);
      if (!cov) return;
      cov.active = true;      // 到这一步她才真的开口替他补
      S.rescues++;
      S.rescued.push(n.id);
      h.onRescue && h.onRescue(n, cov);
    }

    /** 按键对不对：教学段所有键都算对；点击画面（auto）自动对上音高。 */
    function keyOk(n, key, t) {
      if (key === "auto" || key == null) return true;
      if (n.p === "both") return key === "hi" || key === "lo";
      if (t != null && t >= chart.teaching.from && t < chart.teaching.until) return true;
      if (key === "any") return false;   // 空格只在教学段等价
      return key === n.p;
    }

    function findTarget(t) {
      let best = null;
      let bestAbs = 1e9;
      for (let i = S.mIdx; i < MINE.length && i < S.mIdx + 8; i++) {
        const n = MINE[i];
        if (n.judged) continue;
        const d = t - n.time;
        const early = n.both ? SYNC.pressEarly : WIN.ok;
        const late = n.both ? SYNC.pressLate : WIN.ok;
        if (d < -0.35) break;
        if (d < -early - 1e-9 || d > late + 1e-9) continue;
        if (Math.abs(d) < bestAbs) { best = { note: n, delta: d }; bestAbs = Math.abs(d); }
      }
      return best;
    }

    /** both 块：300ms 的按下窗里接住；档位仍按偏差给，但窗口外的偏差不算 miss。 */
    function tierBoth(delta) {
      const tier = judge(delta);
      return tier === "miss" ? "ok" : tier;
    }

    function findGrace(t) {
      for (let i = S.gIdx; i < GRACES.length; i++) {
        const g = GRACES[i];
        if (g.judged) continue;
        if (g.time - t > 0.35) break;
        if (Math.abs(t - g.time) <= 0.15) return g;
      }
      return null;
    }

    function hitGrace(g, key, t) {
      if (!g.judged) {
        g.judged = true;
        g.result = "grace";
        g.delta = t - g.time;
        S.gracesHit++;
        S.score += GRACE_SCORE;
        S.last = { tier: "grace", delta: g.delta, at: t, text: "" };
        audio.say("me", "嗯", audio.now(), { gain: 0.5, p: g.p });
        h.onGrace && h.onGrace(g, GRACE_SCORE);
      }
    }

    /** 空按：附近根本没有自己的音符。Rest 里的空按更响。 */
    function idlePress(t) {
      const inRest = restAt(t);
      addNoise(inRest ? NOISE.rest : NOISE.idle, inRest ? "rest" : "idle");
      h.onIdle && h.onIdle(inRest);
      return null;
    }

    function restAt(t) {
      for (let i = 0; i < chart.rests.length; i++) {
        const r = chart.rests[i];
        if (t < r.startTime) break;
        if (t >= r.startTime && t < r.endTime) return true;
      }
      return false;
    }

    /** 错键：这个音符按错了键位——计一次 miss，但判定字写「错键」。 */
    function wrongNote(n, t, delta) {
      n.judged = true;
      n.result = "wrong";
      n.delta = delta;
      award("wrong", n);
      S.last = { tier: "wrong", delta, at: t, text: n.text };
      addNoise(NOISE.wrong, "wrong");
      audio.say("me", n.text, audio.now(), { gain: 0.35, p: n.p === "both" ? "hi" : n.p });
      h.onJudge && h.onJudge("wrong", n, delta, 0);
      if (n.type === "relay") rescue(n);
      return { tier: "wrong", delta, note: n };
    }

    /** 按一下。key = "hi" | "lo" | "any" | "auto"。返回判定结果，场景拿它放音效。 */
    function press(t, key) {
      if (S.finished) return null;
      const k = key == null ? "auto" : key;
      const hit = findTarget(t);

      if (!hit) {
        // 装饰音：可选的加分点，漏了不罚，所以按错键位也不吃噪音惩罚
        const g = findGrace(t);
        if (g && keyOk(g, k, t)) {
          hitGrace(g, k, t);
          return { tier: "grace", note: g, delta: t - g.time };
        }
        return idlePress(t);
      }

      const n = hit.note;
      const delta = hit.delta;
      if (!keyOk(n, k, t)) return wrongNote(n, t, delta);

      const tier = n.both ? tierBoth(delta) : judge(delta);
      n.judged = true;
      n.result = tier;
      n.delta = delta;
      const gain = award(tier, n);
      S.last = { tier, delta, at: t, text: n.text };

      if (n.both) {
        const ev = chart.bothByNote ? chart.bothByNote.get(n.id) : null;
        S.both = { event: ev || null, pressedAt: t, releasedAt: null, synced: false };
        S.hold = { note: n, from: t, ratio: 0, both: true };
      } else if (n.type === "hold") {
        S.hold = { note: n, from: t, ratio: 0, both: false };
      }

      audio.say("me", n.text, audio.now(), { gain: tier === "miss" ? 0.4 : 1, p: n.p === "both" ? "hi" : n.p });
      if (tier === "perfect") audio.chime(audio.now(), true);
      else if (tier === "good") audio.chime(audio.now(), false);
      else if (tier === "ok") audio.tapPaper(audio.now());
      h.onJudge && h.onJudge(tier, n, delta, gain);
      if (n.both) h.onBothPress && h.onBothPress(n, delta);
      return { tier, delta, note: n };
    }

    /** 松手。按住比例决定长音得分；both 还要看是不是和她同时松的手。 */
    function release(t) {
      const st = S.hold;
      if (!st) return null;
      S.hold = null;
      const n = st.note;
      const need = Math.max(0.18, n.dur);
      const held = Math.max(0, t - Math.max(st.from, n.time));
      const ratio = Math.min(1, held / need);
      n.heldRatio = ratio;
      const out = { note: n, ratio, both: !!st.both, sync: false };

      if (st.both) {
        const ev = (chart.bothByNote && chart.bothByNote.get(n.id)) || null;
        const target = ev ? ev.time + ev.dur : n.time + n.dur;
        const sync = Math.abs(t - target) <= SYNC.release + 1e-9;
        out.sync = sync;
        if (S.both) { S.both.releasedAt = t; S.both.synced = sync; }
        if (sync && !S.syncBoth) {
          S.syncBoth = true;
          h.onSync && h.onSync(ev);
        }
      }

      if (ratio < 0.85) {
        // 松早了：补一点分回来，但不改档位——档位是按下那一刻定的
        const back = Math.round(BASE[n.result || "ok"] * 0.35 * (1 - ratio));
        S.score -= back;
        h.onHoldBreak && h.onHoldBreak(n, ratio, out);
      } else {
        h.onHoldDone && h.onHoldDone(n, ratio, out);
      }
      return out;
    }

    // ---------------------------------------------------------- 每帧

    function update(t) {
      S.t = t;

      // 每小节自然退 6 点噪音。小节按谱面的拍算，末段 108 BPM 时也一样。
      const bar = Math.floor(chart.beatOfTime(t) / 4);
      if (S.lastBar < 0) S.lastBar = bar;
      else if (bar > S.lastBar) {
        S.noise = clamp(S.noise - NOISE.decay * (bar - S.lastBar), 0, NOISE.max);
        S.lastBar = bar;
        if (S.noise >= NOISE.rescue) checkNoiseRescue();
      }

      // 她：到点就命中。不等待、不判定，这就是「自动」。
      // 没被激活的「托」音符直接跳过——hIdx 照样往前走，
      // 不然一个没被用上的补位音符会把整条轨道卡死。
      while (S.hIdx < HER_RUN.length && t >= HER_RUN[S.hIdx].time) {
        const n = HER_RUN[S.hIdx++];
        if (n.cover && !n.active) continue;
        hitHer(n);
      }

      // 我：过了窗口还没按，就是漏
      while (S.mIdx < MINE.length && MINE[S.mIdx].judged) S.mIdx++;
      while (S.mIdx < MINE.length) {
        const n = MINE[S.mIdx];
        const late = (n.both ? SYNC.pressLate : WIN.ok) + 1e-9;
        if (t <= n.time + late) break;
        missNote(n);
        S.mIdx++;
        while (S.mIdx < MINE.length && MINE[S.mIdx].judged) S.mIdx++;
      }

      // 装饰音过了就算没接，不罚、不断连击
      while (S.gIdx < GRACES.length && t > GRACES[S.gIdx].time + 0.15) {
        const g = GRACES[S.gIdx++];
        if (g.judged) continue;
        g.judged = true;
        g.result = "miss";
      }

      // 长按按到尾巴自然松开（both 的自动松手正好落在同步窗里）
      if (S.hold) {
        const n = S.hold.note;
        if (t >= n.time + n.dur + 0.08) release(n.time + n.dur);
      }

      // 她提前敲稿子：连着四句以上轮到你的时候，先给你一下
      while (S.cuesFired < chart.cues.length && chart.cues[S.cuesFired].time <= t) {
        const next = chart.cues[S.cuesFired++];
        S.cue = { time: next.time, len: next.len, noteId: next.noteId, until: t + 0.55 };
        audio.tapPaper(audio.now());
        h.onCue && h.onCue(next);
      }
      if (S.cue && t > S.cue.until) S.cue = null;

      // 手里还按着长音就先别结算：收尾那个 both 块要到「一起松手」才算完
      if (!S.finished && !S.hold && S.mIdx >= MINE.length && S.hIdx >= HER_RUN.length) {
        S.finished = true;
        S.finishedAt = t;
        h.onFinish && h.onFinish(stats());
      }
    }

    // ---------------------------------------------------------- 统计

    function accuracy() {
      const total = (MINE.length - S.skipped) || 1;
      const got = S.counts.perfect * 1 + S.counts.good * 0.7 + S.counts.ok * 0.4;
      return Math.max(0, Math.min(1, got / total));
    }

    function rank() {
      const a = accuracy();
      for (const [k, v] of RANK) if (a >= k) return v;
      return "D";
    }

    const HIT_RESULTS = { perfect: 1, good: 1, ok: 1 };

    function segmentStats() {
      const out = [];
      for (const seg of chart.segments) {
        const arr = MINE.filter((n) => n.seg === seg.index);
        let total = 0;
        let weighted = 0;
        let relaysTotal = 0;
        let relaysCaught = 0;
        for (const n of arr) {
          if (n.result === "skip") continue;
          total++;
          const r = n.result;
          if (r === "perfect") weighted += 1;
          else if (r === "good") weighted += 0.7;
          else if (r === "ok") weighted += 0.4;
          if (n.type === "relay") {
            relaysTotal++;
            if (HIT_RESULTS[r]) relaysCaught++;
          }
        }
        out.push({
          name: seg.name,
          index: seg.index,
          startBeat: seg.startBeat,
          endBeat: seg.endBeat,
          total,
          accuracy: total ? Math.max(0, Math.min(1, weighted / total)) : 0,
          relaysCaught,
          relaysTotal,
          maxCombo: S.segMax[seg.index] || 0
        });
      }
      return out;
    }

    function relayStats() {
      let total = 0;
      let caught = 0;
      for (const n of MINE) {
        if (n.type !== "relay" || n.result === "skip") continue;
        total++;
        if (HIT_RESULTS[n.result]) caught++;
      }
      return { caught, total };
    }

    function stats() {
      const rel = relayStats();
      return {
        score: S.score,
        combo: S.maxCombo,
        counts: Object.assign({}, S.counts),
        total: MINE.length - S.skipped,
        accuracy: accuracy(),
        rank: rank(),
        rescues: S.rescues,
        difficulty,
        noise: Math.round(S.noise),
        maxNoise: Math.round(S.maxNoise),
        syncBoth: !!S.syncBoth,
        relaysCaught: rel.caught,
        relaysTotal: rel.total,
        segments: segmentStats(),
        graces: { hit: S.gracesHit, total: GRACES.length },
        both: S.both ? {
          text: S.both.event ? S.both.event.text : "",
          pressedAt: S.both.pressedAt,
          releasedAt: S.both.releasedAt,
          synced: !!S.both.synced
        } : null
      };
    }

    /** 谱面上还没判的音符（画的时候用）。没被激活的补位音符不画。 */
    function live() {
      return {
        hers: HER_RUN.filter((n) => !n.cover || n.active),
        mine: MINE,
        graces: GRACES,
        hold: S.hold,
        cue: S.cue,
        last: S.last,
        both: S.both,
        noise: S.noise
      };
    }

    /** 跳到某一秒：把这之前的音符全部标成「略过」，不判、不计分。
     *  演示脚本靠它直接看最后一段，不用真的等三分钟。 */
    function skipTo(t) {
      while (S.hIdx < HER_RUN.length && HER_RUN[S.hIdx].time < t) {
        HER_RUN[S.hIdx].judged = true;
        HER_RUN[S.hIdx].result = "skip";
        S.hIdx++;
      }
      while (S.mIdx < MINE.length && MINE[S.mIdx].time < t) {
        const n = MINE[S.mIdx];
        if (!n.judged) { n.judged = true; n.result = "skip"; S.skipped++; }
        S.mIdx++;
      }
      while (S.gIdx < GRACES.length && GRACES[S.gIdx].time < t) {
        const g = GRACES[S.gIdx++];
        if (!g.judged) { g.judged = true; g.result = "skip"; }
      }
      S.t = t;
      S.combo = 0;
      S.hold = null;
      S.both = null;
      S.lastBar = Math.floor(chart.beatOfTime(t) / 4);
      S.noise = 0;
      S.maxNoise = 0;
    }

    function reset() {
      S.hIdx = 0; S.mIdx = 0; S.gIdx = 0;
      S.combo = 0; S.maxCombo = 0; S.segMax = {}; S.score = 0;
      S.counts = { perfect: 0, good: 0, ok: 0, miss: 0, wrong: 0 };
      S.rescues = 0; S.rescued = []; S.hold = null; S.both = null; S.syncBoth = false;
      S.noise = 0; S.maxNoise = 0; S.lastBar = -1;
      S.last = null; S.cue = null; S.cuesFired = 0; S.finished = false;
      S.herDone = 0; S.skipped = 0; S.gracesHit = 0; S.lastNoiseCause = null;
      // 噪音救援时临时塞进来的补位音符只属于上一局，重开时清掉
      covers.length = BASE_COVERS;
      HER_RUN = HERS.concat(covers).sort(sortHers);
      for (const c of covers) c.active = false;
      for (const n of HER_RUN) { n.judged = false; n.result = null; }
      for (const n of MINE) { n.judged = false; n.result = null; n.heldRatio = 0; n.covered = false; n.coverCause = null; }
      for (const g of GRACES) { g.judged = false; g.result = null; }
    }

    return {
      WIN, judge,
      press, release, update, reset, skipTo,
      stats, live, addNoise, noiseLevel, restAt,
      get difficulty() { return difficulty; },
      get diff() { return DIF; },
      get state() { return S; },
      get mine() { return MINE; },
      get hers() { return HER_RUN; },
      get covers() { return covers; },
      get graces() { return GRACES; },
      get chart() { return chart; }
    };
  }

  global.ACT3 = global.ACT3 || {};
  global.ACT3.createRhythm = createRhythm;
  global.ACT3.JUDGE_WIN = { perfect: DIFFS["演播"].perfect, good: DIFFS["演播"].good, ok: DIFFS["演播"].ok };
  global.ACT3.DIFFS = DIFFS;
  global.ACT3.DIFF_NAMES = DIFF_NAMES;
  global.ACT3.DEFAULT_DIFF = DEFAULT_DIFF;
  global.ACT3.NOISE = NOISE;
  global.ACT3.judgeWith = judgeWith;
})(window);

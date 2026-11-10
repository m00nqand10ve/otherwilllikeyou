/* 第三幕 · 广播室 — 谱面
 *
 * 把 script.js 的「谁、说什么、占几拍」摊平到一条绝对时间轴上。
 * 这里不判、不画、不出声，只产出几样东西：
 *
 *   notes     每个音符的绝对时间（秒）、轨道、类型、音高、按住多久、对应哪个词块
 *   display   字幕要一行一行显示的文本；突发段那几行的词块顺序会被打乱
 *   cues      她提前敲稿子的提示点（你要连续念四句以上时，她先给你一下）
 *   covers    漏接接力时她补位的点
 *   rests     停顿窗口（噪音计要用它区分「空按」和「在 Rest 里按」）
 *   segments  五段（试音/开场/来电/点歌/收尾），结算按段出数
 *   both      双人长按块（收尾句，两人一起按住、一起松手）
 *   graces    装饰音（副歌第二遍的弱拍，命中 +50，漏了不罚）
 *   burst     稿纸乱序突发段（谱面照常落，字幕词块顺序打乱）
 *
 * 全部是纯函数、没有随机数：同样的稿子 + 同样的种子每次生成的谱面逐字节相同，
 * 自检才能拿它当基准。唯一由种子决定的是「突发段落在哪四小节」。
 */
(function (global) {
  "use strict";

  const BPM = 96;
  const SPB = 60 / BPM;

  // 末段加速：收尾前一节起 96 → 108。拍还是那些拍，只是拍 → 秒的换算变了。
  const ACCEL_BPM = 108;
  const ACCEL_SPB = 60 / ACCEL_BPM;

  const CUE_RUN = 4;        // 连着四句以上轮到你，她才给提示
  const COVER_DELAY = 0.9;  // 漏接之后，她隔多久替你补上（拍）

  const TEACH_BEATS = 8;         // 试音之后的前两小节，空格与 F/J 等价
  const GRACE_MIN_GAP = 0.6;     // 装饰音与正常音符的最小拍距
  const GRACE_MAX = 8;           // 装饰音最多放几个
  const BURST_BARS = 4;          // 突发段长度（小节）
  const SONG_SEG = "点歌";       // 突发段与装饰音都放在点歌段
  const FINAL_APPROACH = 1.25;   // 末段的下落提前量（秒）

  // ---------------------------------------------------------------- 种子伪随机

  /** 两个整数混成一个种子。自检和游戏都用它，不用 Math.random。 */
  function mixSeed(a, b) {
    let s = ((a >>> 0) ^ Math.imul(((b >>> 0) + 0x9e3779b9) >>> 0, 0x85ebca6b)) >>> 0;
    s = Math.imul(s ^ (s >>> 13), 0xc2b2ae35) >>> 0;
    return (s ^ (s >>> 16)) >>> 0;
  }

  function makeRnd(seed) {
    let s = seed >>> 0;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function shuffled(list, rnd) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = out[i];
      out[i] = out[j];
      out[j] = t;
    }
    return out;
  }

  /** 突发段是否触发：首通必触发一次，之后由种子决定 50%。纯函数，自检直接调。 */
  function burstEnabled(seed, firstRun) {
    if (firstRun) return true;
    return makeRnd(mixSeed(seed >>> 0, 0xb0057))() < 0.5;
  }

  // ---------------------------------------------------------------- 音高

  /** 词块在句中的语调位置 → 音高。句首/上扬 hi，收尾/落点 lo。 */
  function derivePitch(text, i, n) {
    const s = text || "";
    if (n <= 1) return /[？?]$/.test(s) ? "hi" : "lo";
    if (i <= 0) return "hi";
    if (i >= n - 1) return "lo";
    return i % 2 === 0 ? "hi" : "lo";
  }

  // ---------------------------------------------------------------- 五段

  function normalizeSegments(given, lineCount) {
    const fallback = { list: [{ name: "全曲", from: 0, to: lineCount }], error: "没有五段结构" };
    if (!Array.isArray(given) || !given.length) return fallback;
    const list = [];
    let cursor = 0;
    for (const s of given) {
      if (!s || typeof s.from !== "number" || typeof s.to !== "number") return fallback;
      if (s.from !== cursor || s.to <= s.from || s.to > lineCount) return fallback;
      list.push({
        name: String(s.name || ("第" + (list.length + 1) + "段")),
        from: s.from,
        to: s.to
      });
      cursor = s.to;
    }
    if (cursor !== lineCount) return fallback;
    if (list.length !== 5) return { list, error: "段落数量不是五段" };
    return { list, error: null };
  }

  function pickSpread(list, max) {
    if (list.length <= max) return list.slice();
    const out = [];
    for (let i = 0; i < max; i++) {
      out.push(list[Math.round(i * (list.length - 1) / (max - 1))]);
    }
    return Array.from(new Set(out));
  }

  // ---------------------------------------------------------------- 谱面

  function build(script, opt) {
    const o = opt || {};
    const leadBeats = o.leadBeats == null ? 4 : o.leadBeats;
    const seed = (o.seed == null ? 0 : o.seed) >>> 0;
    const firstRun = o.firstRun !== false;
    const segInfo = normalizeSegments(
      o.segments || (global.ACT3 && global.ACT3.Segments),
      script.length
    );
    const segDefs = segInfo.list;

    // ---------- 第一遍：只按拍算。拍和 BPM 无关，BPM 改的是「拍 → 秒」。 ----------
    let beat = leadBeats;
    const notes = [];
    const lines = [];
    const rawRests = [];
    const lineSeg = new Array(script.length).fill(0);
    segDefs.forEach((def, si) => {
      for (let i = def.from; i < def.to; i++) lineSeg[i] = si;
    });

    for (let li = 0; li < script.length; li++) {
      const line = script[li];
      // 和上一行同拍起：收尾那句两个人是一起说的
      if (line.same && lines.length) beat = lines[lines.length - 1].startBeat;
      const startBeat = beat;
      const chunks = [];
      const sounding = line.chunks.filter((c) => c.k !== "rest");
      let si = 0;

      for (const c of line.chunks) {
        const len = c.beats == null ? 1 : c.beats;
        if (c.k === "rest") {
          rawRests.push({ startBeat: beat, endBeat: beat + len });
          beat += len;
          continue;
        }
        const isBoth = c.k === "both";
        // 音高：脚本显式写了就用写的，否则按词块在句中的位置推导
        const p = isBoth ? "both"
          : (c.p === "hi" || c.p === "lo") ? c.p : derivePitch(c.text, si, sounding.length);
        si++;
        const n = {
          id: notes.length,
          lane: line.who,
          type: isBoth ? "hold" : c.k,      // tap | hold | relay（both 也是「按住」）
          both: isBoth,
          beat,
          time: 0,
          dur: 0,
          durBeats: (c.k === "hold" || isBoth) ? len : 0,
          text: c.text,
          p,
          line: li,
          chunk: chunks.length,
          seg: lineSeg[li],
          chord: false
        };
        notes.push(n);
        chunks.push({ text: c.text, beat, type: n.type, lane: line.who, noteId: n.id, p });
        beat += len;
      }
      lines.push({ who: line.who, startBeat, endBeat: beat, chunks, seg: lineSeg[li] });
    }

    // ---------- 五段 + 末段加速：拍 → 秒的映射 ----------
    const segments = segDefs.map((def, i) => {
      const from = lines[def.from];
      const to = lines[def.to - 1];
      return {
        index: i,
        name: def.name,
        fromLine: def.from,
        toLine: def.to,
        startBeat: from.startBeat,
        endBeat: to.endBeat,
        startTime: 0,
        endTime: 0,
        bpm: BPM,
        approach: null
      };
    });
    const finalSeg = segments[segments.length - 1];
    // 「收尾前一节起」：从收尾段开始的那一拍往前退四个整拍，并对齐到小节线
    const accelBeat = Math.max(0, Math.floor((finalSeg.startBeat - 4) / 4) * 4);

    function timeOfBeat(b) {
      if (b <= accelBeat) return b * SPB;
      return accelBeat * SPB + (b - accelBeat) * ACCEL_SPB;
    }
    function beatOfTime(t) {
      const accelTime = accelBeat * SPB;
      if (t <= accelTime) return t / SPB;
      return accelBeat + (t - accelTime) / ACCEL_SPB;
    }

    for (const n of notes) {
      n.time = timeOfBeat(n.beat);
      n.dur = n.durBeats ? timeOfBeat(n.beat + n.durBeats) - n.time : 0;
    }
    for (const seg of segments) {
      seg.startTime = timeOfBeat(seg.startBeat);
      seg.endTime = timeOfBeat(seg.endBeat);
      seg.bpm = seg.startBeat >= accelBeat ? ACCEL_BPM : BPM;
      if (seg === finalSeg) seg.approach = FINAL_APPROACH;
    }

    notes.sort((a, b) => a.beat - b.beat || (a.lane === "her" ? -1 : 1));

    // 同一点落下的两个音符 = 合唱（只有最后那句）
    const byBeat = new Map();
    for (const n of notes) {
      const key = n.beat.toFixed(3);
      if (byBeat.has(key)) {
        byBeat.get(key).chord = true;
        n.chord = true;
      } else byBeat.set(key, n);
    }

    // both 块：两条轨道同一拍上的「一起按住、一起松手」
    const both = [];
    const bothGroups = new Map();
    for (const n of notes) {
      if (!n.both) continue;
      const key = n.beat.toFixed(3);
      if (!bothGroups.has(key)) bothGroups.set(key, { her: null, me: null });
      bothGroups.get(key)[n.lane === "me" ? "me" : "her"] = n;
    }
    for (const g of bothGroups.values()) {
      if (!g.me || !g.her) continue;
      both.push({
        beat: g.me.beat,
        time: g.me.time,
        dur: g.me.dur,
        text: g.me.text,
        line: g.me.line,
        seg: g.me.seg,
        meId: g.me.id,
        herId: g.her.id,
        pressEarly: 0.10,   // 玩家可以在她按住前 100ms 抢按（手感容差）
        pressLate: 0.30,    // 她按住后 300ms 内必须按下
        release: 0.20       // 两人松手的时间差在 ±200ms 内算同步
      });
    }
    both.sort((a, b) => a.beat - b.beat);
    const bothByNote = new Map();
    for (const ev of both) {
      bothByNote.set(ev.meId, ev);
      bothByNote.set(ev.herId, ev);
    }

    // ---------- 字幕行 ----------
    const display = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const group = [l];
      while (i + 1 < lines.length && lines[i + 1].startBeat === l.startBeat) {
        group.push(lines[++i]);
      }
      const who = group.length > 1 ? "both"
        : group[0].who === "her" ? "her" : "me";
      // 合唱那句两个人的词块一模一样，字幕上只留一份——
      // 不然会显示成「下次见。下次见。」
      const all = group.flatMap((g) => g.chunks);
      const same = group.length > 1 && all.every((c) => c.text === all[0].text);
      display.push({
        who,
        startBeat: l.startBeat,
        endBeat: Math.max(...group.map((g) => g.endBeat)),
        startTime: timeOfBeat(l.startBeat),
        endTime: timeOfBeat(Math.max(...group.map((g) => g.endBeat))),
        chunks: same ? [all[0]] : all,
        burst: false,
        scrambled: false
      });
    }

    // ---------- 停顿窗口（噪音计用） ----------
    const rests = rawRests
      .map((r) => ({
        startBeat: r.startBeat,
        endBeat: r.endBeat,
        startTime: timeOfBeat(r.startBeat),
        endTime: timeOfBeat(r.endBeat)
      }))
      .sort((a, b) => a.startBeat - b.startBeat);

    // ---------- 教学段：试音之后的前两小节 ----------
    const teaching = {
      fromBeat: segments[0].endBeat,
      untilBeat: segments[0].endBeat + TEACH_BEATS,
      from: timeOfBeat(segments[0].endBeat),
      until: timeOfBeat(segments[0].endBeat + TEACH_BEATS)
    };

    // ---------- 提示点：连着四句以上都是你的 ----------
    const cues = [];
    let run = [];
    const flush = () => {
      if (run.length >= CUE_RUN) {
        cues.push({
          beat: run[0].beat - 1,
          time: timeOfBeat(run[0].beat - 1),
          noteId: run[0].id,
          len: run.length
        });
      }
      run = [];
    };
    for (const n of notes) {
      if (n.lane === "me") run.push(n);
      else flush();
    }
    flush();

    // ---------- 漏接接力：她在 0.9 拍后补一个「托」 ----------
    const covers = [];
    for (const n of notes) {
      if (n.type !== "relay") continue;
      covers.push({
        beat: n.beat + COVER_DELAY,
        time: timeOfBeat(n.beat + COVER_DELAY),
        forNote: n.id,
        line: n.line,
        seg: n.seg
      });
    }

    // ---------- 装饰音：副歌（点歌段）第二遍的弱拍 ----------
    const graceSegIndex = Math.max(0, segments.findIndex((s) => s.name === SONG_SEG));
    const gs = segments[graceSegIndex];
    const mineMain = notes.filter((n) => n.lane === "me" && !n.both);
    const holdSpans = notes
      .filter((n) => n.lane === "me" && n.durBeats > 0)
      .map((n) => ({ from: n.beat - 0.2, to: n.beat + n.durBeats + 0.2 }));
    const midBeat = Math.ceil(((gs.startBeat + gs.endBeat) / 2) / 4) * 4;
    const graceCand = [];
    for (let bar = midBeat; bar + 4 <= gs.endBeat + 0.001; bar += 4) {
      for (const off of [1, 3]) {
        const gb = bar + off;   // 4/4 里的第 2、4 拍 = 弱拍
        if (gb <= gs.startBeat || gb >= gs.endBeat) continue;
        if (graceCand.indexOf(gb) >= 0) continue;
        let ok = true;
        for (const n of mineMain) {
          if (Math.abs(n.beat - gb) < GRACE_MIN_GAP) { ok = false; break; }
        }
        if (ok) {
          for (const h of holdSpans) {
            if (gb > h.from && gb < h.to) { ok = false; break; }
          }
        }
        if (ok) graceCand.push(gb);
      }
    }
    const graces = pickSpread(graceCand, GRACE_MAX).map((gb, i) => ({
      id: 5000 + i,
      lane: "me",
      type: "grace",
      grace: true,
      beat: gb,
      time: timeOfBeat(gb),
      dur: 0,
      durBeats: 0,
      p: i % 2 === 0 ? "hi" : "lo",
      seg: graceSegIndex,
      text: "",
      line: -1,
      chunk: -1,
      chord: false,
      both: false
    }));

    // ---------- 突发段：稿纸被碰乱的那四小节 ----------
    let burst = { on: false };
    if (burstEnabled(seed, firstRun)) {
      const bs = segments[graceSegIndex];
      const candidates = [];
      const firstBar = Math.ceil(bs.startBeat / 4) * 4;
      for (let bar = firstBar; bar + BURST_BARS * 4 <= bs.endBeat + 0.001; bar += 4) {
        let count = 0;
        for (const n of notes) {
          if (n.lane === "me" && n.beat >= bar && n.beat < bar + BURST_BARS * 4) count++;
        }
        if (count >= 4) candidates.push(bar);
      }
      if (candidates.length) {
        const rnd = makeRnd(mixSeed(seed, 0x51ed));
        const bar = candidates[Math.floor(rnd() * candidates.length) % candidates.length];
        burst = {
          on: true,
          seed,
          startBeat: bar,
          endBeat: bar + BURST_BARS * 4,
          startTime: timeOfBeat(bar),
          endTime: timeOfBeat(bar + BURST_BARS * 4),
          bars: BURST_BARS
        };
      } else {
        burst = { on: false, reason: "没有候选小节" };
      }
    } else {
      burst = { on: false, reason: "种子没抽中" };
    }

    // 突发段里字幕词块的顺序和谱面解耦：只打乱呈现，不改一个字。
    if (burst.on) {
      let bi = 0;
      for (const d of display) {
        if (d.startBeat < burst.startBeat || d.startBeat >= burst.endBeat) continue;
        d.burst = true;
        if (d.chunks.length <= 1) continue;
        const rnd = makeRnd(mixSeed(seed, 0x9a17 + (bi++)));
        const order = () => d.chunks.map((c) => c.noteId).join(",");
        const orig = order();
        let next = shuffled(d.chunks, rnd);
        let guard = 0;
        while (next.map((c) => c.noteId).join(",") === orig && guard++ < 6) {
          next = shuffled(next, rnd);
        }
        if (next.map((c) => c.noteId).join(",") === orig) {
          next = d.chunks.slice(1).concat([d.chunks[0]]);
        }
        d.chunks = next;
        d.scrambled = true;
      }
    }

    const totalBeats = beat;
    return {
      bpm: BPM,
      spb: SPB,
      leadBeats,
      accelBeat,
      accelBpm: ACCEL_BPM,
      finalApproach: FINAL_APPROACH,
      tempo: { fromBeat: accelBeat, bpm: ACCEL_BPM, baseBpm: BPM },
      timeOfBeat,
      beatOfTime,
      seed,
      firstRun,
      segmentError: segInfo.error,
      notes,
      lines,
      display,
      cues,
      covers,
      rests,
      segments,
      both,
      bothByNote,
      graces,
      teaching,
      burst,
      totalBeats,
      duration: timeOfBeat(totalBeats),
      count: notes.length,
      mine: notes.filter((n) => n.lane === "me").length,
      hers: notes.filter((n) => n.lane === "her").length,
      types: notes.reduce((m, n) => { m[n.type] = (m[n.type] || 0) + 1; return m; }, {})
    };
  }

  global.ACT3 = global.ACT3 || {};
  global.ACT3.buildChart = build;
  global.ACT3.CUE_RUN = CUE_RUN;
  global.ACT3.burstEnabled = burstEnabled;
  global.ACT3.mixSeed = mixSeed;
  global.ACT3.makeRnd = makeRnd;
  global.ACT3.CHART_CONST = {
    BPM, ACCEL_BPM, SPB, ACCEL_SPB, TEACH_BEATS, GRACE_MAX, GRACE_MIN_GAP,
    BURST_BARS, FINAL_APPROACH, COVER_DELAY
  };
})(window);

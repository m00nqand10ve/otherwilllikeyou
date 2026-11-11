/* 第三幕 · 晚间广播 — 自检
 *
 * 分两半：
 *   前半在 Node 里跑谱面和判定。判定是纯函数（偏差秒数 → 档位），
 *   不需要真的等 3 分钟，也不需要音频设备。
 *   后半开浏览器，验真实流程：选档、进演奏、自动弹一遍、突发段字幕、
 *   噪音演出、退出、存档、分段结算卡。
 *
 * 用法：node act3/tools/check.cjs
 * 截图落在 act3/tools/out/。
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { chromium } = require(path.resolve(__dirname, "../../game/dust-corridor/node_modules/playwright-core"));

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(__dirname, "out");
// seed 钉死：突发段落在哪四小节是种子决定的，自检要可复现
const PAGE = "file:///" + path.join(ROOT, "act3/broadcast.html").replace(/\\/g, "/") + "?fresh=1&seed=7";
const PAGE_NORMAL = "file:///" + path.join(ROOT, "act3/broadcast.html").replace(/\\/g, "/") + "?seed=3";

const SEG_NAMES = ["试音", "开场", "来电", "点歌", "收尾"];
const DIFF_NAMES = ["演播", "电台"];

const fails = [];
const notes = [];
const fail = (m) => { fails.push(m); };
const ok = (m) => { notes.push(m); };
const close = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-6 : eps);

function loadAct3() {
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of ["audio.js", "script.js", "chart.js", "rhythm.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, "act3", f), "utf8"), sandbox, { filename: f });
  }
  return sandbox.ACT3;
}

function stubAudio() {
  const log = { say: [], cover: 0, chime: 0, paper: 0 };
  return {
    log,
    now: () => 0,
    say: (who, text) => log.say.push([who, text]),
    blip() {}, chime() { log.chime++; }, tapPaper() { log.paper++; },
    thud() {}, cover() { log.cover++; }, click() {}, metronome() {}
  };
}

// ---------------------------------------------------------------- 1. 谱面

function checkChart(A) {
  const c = A.buildChart(A.Script);

  if (c.segmentError) fail(`五段表有问题：${c.segmentError}`);
  if (c.duration < 150 || c.duration > 200) {
    fail(`谱面时长 ${c.duration.toFixed(1)}s，应该在 150–200 秒之间`);
  }
  if (c.count < 120 || c.count > 190) {
    fail(`音符 ${c.count} 个，密度不对（120–190）`);
  }
  if (c.mine < 50) fail(`轮到玩家的音符只有 ${c.mine} 个，手太闲`);
  for (const t of ["tap", "hold", "relay"]) {
    if (!c.types[t]) fail(`谱面里没有 ${t} 类型的音符`);
  }
  if (c.types.relay < 4) fail(`接力音符只有 ${c.types.relay} 个，双人合作体现不出来`);

  // 同一轨道不能挤在一起（末段 108 BPM 之后 0.5 拍 = 0.278s）
  for (const lane of ["me", "her"]) {
    const list = c.notes.filter((n) => n.lane === lane);
    for (let i = 1; i < list.length; i++) {
      const gap = list[i].time - list[i - 1].time;
      if (gap < 0.26) fail(`${lane} 轨在 ${list[i].time.toFixed(2)}s 处间隔只有 ${gap.toFixed(3)}s`);
    }
  }

  const empty = c.notes.filter((n) => !n.text || !n.text.length);
  if (empty.length) fail(`${empty.length} 个音符没有词块`);

  // ---- 五段 ----
  if (c.segments.length !== 5) fail(`段落数是 ${c.segments.length}，应该是 5`);
  else {
    const names = c.segments.map((s) => s.name);
    if (JSON.stringify(names) !== JSON.stringify(SEG_NAMES)) {
      fail(`五段名字是 ${names.join("/")}，应该是 ${SEG_NAMES.join("/")}`);
    }
    let line = 0;
    for (const s of c.segments) {
      if (s.fromLine !== line) fail(`段落「${s.name}」没有接上一段`);
      if (!(s.endBeat > s.startBeat)) fail(`段落「${s.name}」的拍数不对`);
      line = s.toLine;
    }
    if (line !== A.Script.length) fail(`五段没有盖满稿子（盖到第 ${line} 行，共 ${A.Script.length} 行）`);
    for (const n of c.notes) {
      if (!(n.seg >= 0 && n.seg < 5)) fail(`音符「${n.text}」的段号是 ${n.seg}`);
    }
    // 试音段本来就只有她的音符，玩家段数应该是 0
    const mine0 = c.notes.filter((n) => n.lane === "me" && n.seg === 0).length;
    if (mine0 !== 0) fail(`试音段不该有玩家的音符，实际 ${mine0} 个`);
    const segMine = c.segments.map((s) => c.notes.filter((n) => n.lane === "me" && n.seg === s.index).length);
    if (segMine.reduce((a, b) => a + b, 0) !== c.mine) fail("五段的玩家音符加起来不等于总数");
    ok(`五段 ${c.segments.map((s) => s.name + "(" + s.startBeat + "-" + s.endBeat + "拍)").join(" / ")}`);
  }

  // ---- 音高 ----
  const pitched = c.notes.filter((n) => n.p === "hi" || n.p === "lo").length;
  const bothP = c.notes.filter((n) => n.p === "both").length;
  if (pitched + bothP !== c.notes.length) fail("有音符没有音高字段");
  const hi = c.notes.filter((n) => n.p === "hi" && n.lane === "me").length;
  const lo = c.notes.filter((n) => n.p === "lo" && n.lane === "me").length;
  if (hi < 15 || lo < 15) fail(`玩家轨高低音分布不对：hi ${hi} / lo ${lo}`);
  // 句首高、句尾低：随便挑一句两段以上的词验证推导规则
  const line3 = c.notes.filter((n) => n.line === 3);
  if (!line3.length) fail("找不到用于验证音高推导的句子");
  else {
    if (line3[0].p !== "hi") fail("句子第一个词块不是高音（句首/上扬应为 hi）");
    if (line3[line3.length - 1].p !== "lo") fail("句子最后一个词块不是低音（收尾应为 lo）");
  }
  ok(`音高：玩家轨 hi ${hi} / lo ${lo}，收尾 both ${bothP} 个`);

  // ---- 教学段：试音之后的前两小节 ----
  const t0 = c.segments[0];
  const teachBeats = c.teaching.untilBeat - c.teaching.fromBeat;
  if (!close(teachBeats, 8)) fail(`教学段是 ${teachBeats} 拍，应该是两小节 8 拍`);
  if (!close(c.teaching.fromBeat, t0.endBeat)) fail("教学段没有从试音结束处开始");
  const firstMine = c.notes.find((n) => n.lane === "me");
  if (!firstMine || firstMine.time < c.teaching.from || firstMine.time >= c.teaching.until) {
    fail("第一个玩家音符不在教学段里（玩家没机会用空格过渡）");
  }

  // ---- 末段加速 ----
  if (!(c.accelBeat > 0 && c.accelBeat < c.totalBeats)) fail(`加速起点 ${c.accelBeat} 不对`);
  if (!close(c.timeOfBeat(c.accelBeat + 4) - c.timeOfBeat(c.accelBeat), 4 * 60 / 108, 1e-9)) {
    fail("末段 4 拍不是 108 BPM 的长度");
  }
  if (!close(c.timeOfBeat(c.accelBeat) - c.timeOfBeat(c.accelBeat - 4), 4 * 0.625, 1e-9)) {
    fail("加速前的 4 拍不是 96 BPM 的长度");
  }
  const lastSeg = c.segments[c.segments.length - 1];
  if (lastSeg.bpm !== 108) fail(`收尾段的 bpm 是 ${lastSeg.bpm}，应该是 108`);
  if (!close(lastSeg.approach, 1.25)) fail("收尾段的下落提前量不是 1.25s");
  if (!close(c.duration, c.timeOfBeat(c.totalBeats), 1e-9)) fail("总时长没有按末段加速换算");
  ok(`末段加速：第 ${c.accelBeat} 拍起 108 BPM，收尾段提前量 1.25s`);

  // ---- both 双人长按 ----
  if (c.both.length !== 1) fail(`both 块应该有 1 个，实际 ${c.both.length}`);
  else {
    const ev = c.both[0];
    const me = c.notes.find((n) => n.id === ev.meId);
    const her = c.notes.find((n) => n.id === ev.herId);
    if (!me || !her || !me.both || !her.both) fail("both 事件没有对应的双侧音符");
    if (!me || !her || !close(me.beat, her.beat)) fail("both 的两侧不在同一拍");
    if (!close(ev.dur, 2.5 * 60 / 108, 1e-9)) fail(`both 块的按住时长 ${ev.dur} 不对`);
    if (!close(ev.pressLate, 0.3) || !close(ev.release, 0.2)) fail("both 的同步窗口不是 300/200ms");
    if (ev.text !== "下次见。") fail(`both 块的文本被改了：${ev.text}`);
    if (ev.seg !== 4) fail("both 块不在收尾段");
    if (!c.bothByNote.get(ev.meId) || !c.bothByNote.get(ev.herId)) fail("bothByNote 索引不对");
    if (!c.notes[c.notes.length - 1].chord) fail("最后一句不是两条轨道同拍落下");
    ok(`both：${ev.text} 在 ${ev.time.toFixed(2)}s，按住 ${ev.dur.toFixed(2)}s`);
  }

  // ---- 装饰音 ----
  if (c.graces.length < 4 || c.graces.length > 8) fail(`装饰音 ${c.graces.length} 个，应该在 4–8 之间`);
  const graceSeg = c.segments.findIndex((s) => s.name === "点歌");
  const mineBeats = c.notes.filter((n) => n.lane === "me" && !n.both);
  for (const g of c.graces) {
    if (g.seg !== graceSeg) fail("装饰音不在点歌段（副歌第二遍）");
    if (g.p !== "hi" && g.p !== "lo") fail("装饰音没有音高");
    if (g.text) fail("装饰音不该带词块（不能往稿子里加字）");
    let minD = 99;
    for (const n of mineBeats) minD = Math.min(minD, Math.abs(n.beat - g.beat));
    if (minD < 0.59) fail(`装饰音在 ${g.beat} 拍离正常音符只有 ${minD.toFixed(2)} 拍`);
    if (g.beat >= c.segments[graceSeg].endBeat) fail("装饰音落在点歌段外面");
  }
  // 装饰音不能撞上长按的按住区间，不然玩家腾不出手
  for (const g of c.graces) {
    for (const n of c.notes.filter((x) => x.lane === "me" && x.durBeats > 0)) {
      if (g.beat > n.beat - 0.2 && g.beat < n.beat + n.durBeats + 0.2) {
        fail(`装饰音 ${g.beat} 拍撞上了长音「${n.text}」`);
      }
    }
  }
  ok(`装饰音 ${c.graces.length} 个，都在点歌段第二遍的弱拍上`);

  // ---- 突发段 ----
  const cOff = A.buildChart(A.Script, { firstRun: false, seed: 0 });
  if (!c.burst || !c.burst.on) fail("首通（默认参数）没有触发突发段");
  else {
    const bs = c.segments.find((s) => s.name === "点歌");
    if (c.burst.startBeat < bs.startBeat || c.burst.endBeat > bs.endBeat + 1e-9) {
      fail("突发段不在点歌段里");
    }
    if (!close(c.burst.endBeat - c.burst.startBeat, 16)) fail("突发段不是 4 小节（16 拍）");
    if (c.burst.startBeat % 4 !== 0) fail("突发段没有对齐小节线");
    const burstLines = c.display.filter((d) => d.burst);
    if (!burstLines.length) fail("突发段里没有字幕行被标成 burst");
    // 顺序必须真的被打乱，而且文字一个字没变
    let scrambled = 0;
    for (const d of burstLines) {
      if (d.chunks.length < 2) continue;
      const order = d.chunks.map((ch) => ch.noteId);
      const byTime = order.slice().sort((a, b) => {
        const na = c.notes.find((n) => n.id === a);
        const nb = c.notes.find((n) => n.id === b);
        return (na ? na.beat : 0) - (nb ? nb.beat : 0);
      });
      if (JSON.stringify(order) === JSON.stringify(byTime)) fail("突发段的词块顺序没有被真正打乱");
      else scrambled++;
      const text = d.chunks.map((ch) => ch.text).sort().join("|");
      const base = cOff.display.find((x) => x.startBeat === d.startBeat);
      if (!base) fail("对照谱面里找不到同一条字幕行");
      else if (base.chunks.map((ch) => ch.text).sort().join("|") !== text) {
        fail("突发段改动了稿子文字");
      }
    }
    if (!scrambled) fail("没有任何一行字幕被真正打乱");
    ok(`突发段：${c.burst.startBeat}-${c.burst.endBeat} 拍，${burstLines.length} 行字幕乱序`);
  }
  if (A.burstEnabled(123, true) !== true) fail("首通时突发段没有强制触发");
  if (A.burstEnabled(123, false) !== A.burstEnabled(123, false)) fail("突发段触发不确定");
  let on = 0;
  for (let s = 1; s <= 400; s++) if (A.burstEnabled(s, false)) on++;
  if (on < 140 || on > 260) fail(`非首通 400 个种子里触发 ${on} 次，不是 50% 左右`);

  // ---- 停顿窗口 ----
  if (!c.rests.length) fail("没有生成停顿窗口");
  for (let i = 0; i < c.rests.length; i++) {
    const r = c.rests[i];
    if (!(r.endTime > r.startTime)) fail(`停顿窗口 ${i} 的时间不对`);
    if (i && r.startBeat < c.rests[i - 1].startBeat) fail("停顿窗口没有排序");
  }

  // ---- 提示点 / 补位点 ----
  if (!c.cues.length) fail("没有生成任何「她提前敲稿子」的提示点");
  for (const q of c.cues) {
    const n = c.notes.find((x) => x.id === q.noteId);
    if (!n) { fail("提示点指向了一个不存在的音符"); continue; }
    if (Math.abs((n.beat - q.beat) - 1) > 0.001) fail("提示点不在音符前一拍");
    if (n.lane !== "me") fail("提示点指向的不是玩家的音符");
  }
  const relays = c.notes.filter((n) => n.type === "relay");
  if (c.covers.length !== relays.length) {
    fail(`救场点 ${c.covers.length} 个，接力音符 ${relays.length} 个，对不上`);
  }
  for (const cv of c.covers) {
    const src = c.notes.find((n) => n.id === cv.forNote);
    if (!src) { fail("救场点找不到对应的接力音符"); continue; }
    if (Math.abs((cv.beat - src.beat) - 0.9) > 0.001) fail("救场点没有延后 0.9 拍");
  }

  // ---- 确定性：同稿同种子两次生成，逐事件相等 ----
  const again = A.buildChart(A.Script);
  const key = (x) => JSON.stringify(x);
  if (key(c.notes) !== key(again.notes)) fail("两次生成的音符不一样，说明里面有随机");
  if (key(c.display) !== key(again.display)) fail("两次生成的字幕行不一样");
  if (key(c.graces) !== key(again.graces)) fail("两次生成的装饰音不一样");
  if (key(c.rests) !== key(again.rests)) fail("两次生成的停顿窗口不一样");
  if (key(c.both) !== key(again.both)) fail("两次生成的 both 块不一样");
  if (key(c.burst) !== key(again.burst)) fail("同一个种子两次生成的突发段不一样");
  // 换种子只应该动突发段，不动音符
  const cSeed8 = A.buildChart(A.Script, { seed: 8 });
  if (key(cSeed8.notes) !== key(c.notes)) fail("换种子之后音符变了（种子只该决定突发段）");

  ok(`谱面 ${c.count} 音符 / ${Math.floor(c.duration / 60)}:${String(Math.round(c.duration % 60)).padStart(2, "0")} / 我 ${c.mine} 她 ${c.hers}`);
  return c;
}

// ---------------------------------------------------------------- 2. 判定窗口（两档）

function checkJudge(A) {
  const expect = {
    "演播": { perfect: 0.045, good: 0.110, ok: 0.250, approach: 1.55, noiseRescue: false },
    "电台": { perfect: 0.035, good: 0.080, ok: 0.150, approach: 1.25, noiseRescue: true }
  };
  for (const name of DIFF_NAMES) {
    const d = A.DIFFS[name];
    if (!d) { fail(`没有档位 ${name}`); continue; }
    for (const k of ["perfect", "good", "ok", "approach"]) {
      if (!close(d[k], expect[name][k])) fail(`${name} 档的 ${k} 是 ${d[k]}，应该是 ${expect[name][k]}`);
    }
    if (d.noiseRescue !== expect[name].noiseRescue) fail(`${name} 档的噪音救援开关不对`);
  }
  if (!close(A.JUDGE_WIN.perfect, 0.045)) fail("默认判定窗口不是演播档");
  if (!close(A.DEFAULT_DIFF, "演播") && A.DEFAULT_DIFF !== "演播") fail("默认档位不是演播");

  const chart = A.buildChart(A.Script);
  for (const name of DIFF_NAMES) {
    const r = A.createRhythm(chart, stubAudio(), { difficulty: name });
    if (r.judge !== A.judgeWith) { /* 实例包装，正常 */ }
    if (r.diff !== A.DIFFS[name]) fail(`${name} 档的 rhythm 没有拿到对应的判定表`);
    const w = A.DIFFS[name];
    const cases = [
      [0, "perfect"],
      [w.perfect, "perfect"], [w.perfect + 0.0001, "good"], [-w.perfect, "perfect"], [-w.perfect - 0.0001, "good"],
      [w.good, "good"], [w.good + 0.0001, "ok"], [-w.good - 0.0001, "ok"],
      [w.ok, "ok"], [w.ok + 0.0001, "miss"], [-w.ok - 0.0001, "miss"],
      [0.4, "miss"], [0.9, "miss"]
    ];
    for (const [delta, want] of cases) {
      const got = r.judge(delta);
      if (got !== want) fail(`${name} 档 judge(${delta}) = ${got}，应该是 ${want}`);
    }
  }
  ok("判定窗口：演播 ±45/110/250ms，电台 ±35/80/150ms");
}

// ---------------------------------------------------------------- 3. F/J 错键 vs 漏按

function checkKeys(A) {
  const chart = A.buildChart(A.Script);
  const r = A.createRhythm(chart, stubAudio(), { difficulty: "演播" });
  const mine = r.mine;
  const first = mine[0];

  if (first.p !== "hi" && first.p !== "lo") fail("第一个玩家音符没有音高");
  // 教学段：空格等价
  r.reset();
  let res = r.press(first.time, "any");
  if (!res || res.tier !== "perfect") fail(`教学段里按空格判定成了 ${res && res.tier}，应该等价`);
  if (r.state.counts.wrong) fail("教学段按空格被算成了错键");

  // 教学段之后：空格 = 错键
  const afterTeach = mine.find((n) => n.time >= chart.teaching.until - 1e-9 && !n.both);
  if (!afterTeach) fail("找不到教学段之后的玩家音符");
  else {
    r.reset();
    res = r.press(afterTeach.time, "any");
    if (!res || res.tier !== "wrong") fail(`教学段之后按空格判定成了 ${res && res.tier}，应该算错键`);
    if (r.state.counts.wrong !== 1) fail(`错键计数是 ${r.state.counts.wrong}`);
    if (r.state.counts.miss !== 0) fail("错键不该同时记成漏按");
    if (!close(r.state.noise, A.NOISE.wrong)) fail(`错键之后噪音是 ${r.state.noise}，应该是 +8`);
    if (r.state.combo !== 0) fail("错键之后连击没有清零");
    if (afterTeach.result !== "wrong") fail("错键之后音符没有标成 wrong");
  }

  // F/J 按反 = 错键，且计一次 miss 的惩罚。
  // 注意要挑教学段之外的音符：教学段里所有键都等价，测不出错键。
  const keyNote = mine.find((n) => n.time >= chart.teaching.until - 1e-9 && !n.both) || first;
  r.reset();
  const wrongKey = keyNote.p === "hi" ? "lo" : "hi";
  res = r.press(keyNote.time, wrongKey);
  if (!res || res.tier !== "wrong") fail(`按反键位判定成了 ${res && res.tier}`);
  if (r.state.counts.wrong !== 1) fail("按反键位没有记错键");
  if (r.state.score !== 0) fail("按反键位不该得分");

  // 按对 = PERFECT
  r.reset();
  res = r.press(first.time, first.p);
  if (!res || res.tier !== "perfect") fail(`按对键位判定成了 ${res && res.tier}`);
  if (r.state.counts.wrong !== 0) fail("按对键位却记了错键");

  // 点击画面（auto）自动对音高，不能被判成错键
  r.reset();
  res = r.press(first.time, "auto");
  if (!res || res.tier !== "perfect") fail(`点击画面判定成了 ${res && res.tier}`);

  // 漏按 = miss，和错键分开记
  r.reset();
  r.update(first.time + A.JUDGE_WIN.ok + 0.01);
  if (r.state.counts.miss !== 1) fail(`漏按计数是 ${r.state.counts.miss}`);
  if (r.state.counts.wrong !== 0) fail("漏按被记成了错键");
  if (r.state.noise !== 0) fail("漏按不该加噪音");

  // both 块：F/J 都算对
  const ev = chart.both[0];
  r.reset();
  r.skipTo(ev.time - 0.5);
  r.update(ev.time + 0.001);
  res = r.press(ev.time + 0.02, "lo");
  if (!res || res.tier === "wrong") fail("both 块按 F 被判成了错键");
  r.reset();
  r.skipTo(ev.time - 0.5);
  r.update(ev.time + 0.001);
  res = r.press(ev.time + 0.02, "hi");
  if (!res || res.tier === "wrong") fail("both 块按 J 被判成了错键");

  ok("F/J：按对命中、按反错键 +8、漏按记 miss；空格只在教学段等价");
}

// ---------------------------------------------------------------- 4. 噪音计与阈值

function insideRest(chart, t) {
  return chart.rests.some((r) => t >= r.startTime && t < r.endTime);
}
function findIdleTime(chart) {
  for (let t = 0.5; t < chart.duration; t += 0.05) {
    if (insideRest(chart, t)) continue;
    if (chart.notes.some((n) => n.lane === "me" && Math.abs(n.time - t) < 0.4)) continue;
    if (chart.graces.some((g) => Math.abs(g.time - t) < 0.3)) continue;
    return t;
  }
  return null;
}
function findRestIdleTime(chart) {
  for (const r of chart.rests) {
    const t = (r.startTime + r.endTime) / 2;
    if (chart.notes.some((n) => n.lane === "me" && Math.abs(n.time - t) < 0.4)) continue;
    if (chart.graces.some((g) => Math.abs(g.time - t) < 0.3)) continue;
    return t;
  }
  return null;
}

function checkNoise(A) {
  const N = A.NOISE;
  if (!close(N.idle, 12) || !close(N.rest, 18) || !close(N.wrong, 8) || !close(N.decay, 6)) {
    fail("噪音参数不是 空按+12 / Rest+18 / 错键+8 / 每小节-6");
  }
  if (!close(N.grey, 50) || !close(N.rescue, 80) || !close(N.drop, 40)) {
    fail("噪音阈值不是 50 / 80 / 回落 40");
  }

  const chart = A.buildChart(A.Script);
  const r = A.createRhythm(chart, stubAudio(), { difficulty: "演播" });

  // 空按 +12
  const idleT = findIdleTime(chart);
  if (idleT == null) fail("找不到一个干净的空按时机");
  else {
    r.reset();
    r.press(idleT);
    if (!close(r.state.noise, 12)) fail(`空按之后噪音是 ${r.state.noise}，应该是 12`);
  }

  // Rest 里按 +18
  const restT = findRestIdleTime(chart);
  if (restT == null) fail("找不到一个干净的 Rest 按键时机");
  else {
    r.reset();
    r.press(restT);
    if (!close(r.state.noise, 18)) fail(`Rest 里按之后噪音是 ${r.state.noise}，应该是 18`);
  }

  // 每小节自然衰减 6
  r.reset();
  r.update(chart.timeOfBeat(8) + 0.01);
  r.addNoise(20);
  r.update(chart.timeOfBeat(12) + 0.01);
  if (!close(r.state.noise, 14)) fail(`过了一小节噪音是 ${r.state.noise}，应该是 14（20-6）`);
  if (!close(r.state.maxNoise, 20)) fail("噪音峰值没有被记下来");

  // 上下限
  r.reset();
  r.addNoise(120);
  if (!close(r.state.noise, 100)) fail(`噪音上限是 ${r.state.noise}，应该卡在 100`);
  if (!close(r.state.maxNoise, 100)) fail("噪音峰值没有卡在 100");
  r.addNoise(-200);
  if (r.state.noise !== 0) fail(`噪音下限是 ${r.state.noise}，应该是 0`);

  // 演播档：≥80 只影响演出，不触发救援
  r.reset();
  r.addNoise(85);
  if (r.state.rescues !== 0) fail("演播档噪音 ≥80 也触发了救援");
  if (!(r.state.noise >= 80)) fail("演播档噪音没有停在 80 以上");
  if (r.mine.some((n) => n.result === "covered")) fail("演播档有音符被她替掉了");

  // 电台档：≥80 触发一次现有救援机制，回落到 40
  const rE = A.createRhythm(chart, stubAudio(), { difficulty: "电台" });
  rE.addNoise(79);
  if (rE.state.rescues !== 0) fail("噪音没到 80 就触发了救援");
  if (!(rE.state.noise >= 79)) fail("噪音累加不对");
  rE.addNoise(1);
  if (rE.state.rescues !== 1) fail(`电台档噪音到 80 之后救援次数是 ${rE.state.rescues}`);
  if (!close(rE.state.noise, 40)) fail(`救援之后噪音是 ${rE.state.noise}，应该回落到 40`);
  const covered = rE.mine.find((n) => n.result === "covered");
  if (!covered) fail("噪音救援没有替玩家接住任何一句");
  else {
    // 接力的补位音符是谱面里预先生成的那个，被噪音救援激活（不再多塞一个）
    const cov = rE.covers.find((c) => c.forNote === covered.id && c.active);
    if (!cov) fail("噪音救援没有生成粉轨补位音符");
    else {
      rE.update(cov.time + 0.01);
      if (!cov.judged) fail("噪音救援的补位音符到点没有命中");
      if (!rE.state.rescued.includes(covered.id)) fail("被噪音救援接住的音符没有记进 rescued");
    }
  }
  ok("噪音：空按+12 / Rest+18 / 错键+8 / 每小节-6；演播只演出，电台 ≥80 救援回落 40");

  return A;
}

// ---------------------------------------------------------------- 5. both 同步窗口

function checkBoth(A) {
  const chart = A.buildChart(A.Script);
  const r = A.createRhythm(chart, stubAudio(), { difficulty: "演播" });
  const ev = chart.both[0];
  if (!ev) { fail("没有 both 块"); return; }
  const meNote = r.mine.find((n) => n.id === ev.meId);
  const herNote = r.hers.find((n) => n.id === ev.herId);
  if (!meNote || !herNote) { fail("both 的两侧音符找不到"); return; }
  if (!meNote.both || !herNote.both) fail("both 音符没有标记 both");
  const target = ev.time + ev.dur;

  const setup = () => { r.reset(); r.skipTo(ev.time - 0.5); r.update(ev.time + 0.001); };

  // 按下窗边界：+300ms 内算接住，+301ms 不算
  setup();
  let res = r.press(ev.time + 0.30, "hi");
  if (!res) fail("both 块在 +300ms 按下没有被接住");
  if (!meNote.judged) fail("both 块按下之后音符没有判定");

  setup();
  res = r.press(ev.time + 0.31, "hi");
  if (res) fail("both 块在 +310ms 按下居然接住了");
  r.update(ev.time + 0.32);
  if (meNote.result !== "miss") fail(`both 块 +310ms 没按之后结算成了 ${meNote.result}`);
  if (r.state.syncBoth) fail("没接住 both 却算了同步");

  // 提前 100ms 内可以抢按
  setup();
  res = r.press(ev.time - 0.10, "hi");
  if (!res) fail("both 块提前 100ms 按下没有被接住");
  setup();
  res = r.press(ev.time - 0.11, "hi");
  if (res) fail("both 块提前 110ms 按下居然接住了");

  // 松手窗边界：±200ms 算同步
  setup();
  r.press(ev.time + 0.05, "hi");
  let out = r.release(target + 0.20);
  if (!out || !out.sync) fail("both 块在 +200ms 松手没有算同步");
  setup();
  r.press(ev.time + 0.05, "hi");
  r.release(target + 0.21);
  if (r.state.syncBoth) fail("both 块在 +210ms 松手居然算了同步");
  setup();
  r.press(ev.time + 0.05, "hi");
  out = r.release(target - 0.19);
  if (!out || !out.sync) fail("both 块在 -190ms 松手没有算同步");
  setup();
  r.press(ev.time + 0.05, "hi");
  r.release(target - 0.21);
  if (r.state.syncBoth) fail("both 块在 -210ms 松手居然算了同步");

  // 她那一侧自动命中
  setup();
  r.update(ev.time + 0.001);
  if (!herNote.judged) fail("both 块的她那一侧没有自动命中");

  // 按住了但一直不松手：超过 +200ms 同步窗后按「晚松」结算，不能算同步
  setup();
  r.press(ev.time + 0.02, "hi");
  r.update(target + 0.09);
  if (r.state.syncBoth) fail("both 块还没到同步窗边缘就判了同步");
  r.update(target + 0.21);
  if (r.state.syncBoth) fail("both 块按住到自动松手仍算了同步（应该按晚松判）");

  // 同步窗口和难度无关
  for (const name of DIFF_NAMES) {
    const rr = A.createRhythm(chart, stubAudio(), { difficulty: name });
    rr.reset();
    rr.skipTo(ev.time - 0.5);
    rr.update(ev.time + 0.001);
    const rres = rr.press(ev.time + 0.29, "hi");
    if (!rres) fail(`${name} 档的 both 按下窗被改窄了`);
  }
  ok("both：300ms 按下窗、±200ms 松手窗边界正确，她那一侧自动按住");
}

// ---------------------------------------------------------------- 6. 判定/计分/救场 + 五段一致

function playThrough(A, chart, difficulty) {
  const audio = stubAudio();
  const r = A.createRhythm(chart, audio, { difficulty });
  const events = [];
  for (const n of r.mine) {
    events.push({ t: n.time, kind: "press", n });
    if (n.type === "hold") events.push({ t: n.time + n.dur, kind: "release", n });
  }
  for (const g of r.graces || []) events.push({ t: g.time, kind: "grace", n: g });
  // 同一时刻先松手再按下一个；事件时间按谱面精确给
  events.sort((a, b) => a.t - b.t || (a.kind === "release" ? -1 : 1));
  for (const ev of events) {
    r.update(ev.t);
    if (ev.kind === "press") {
      r.press(ev.t, ev.n.p === "both" ? "hi" : ev.n.p);
    } else if (ev.kind === "grace") {
      r.press(ev.t, ev.n.p);
    } else {
      r.release(ev.t);
    }
  }
  r.update(chart.duration + 2);
  return { r, audio };
}

function checkPlay(A) {
  const chart = A.buildChart(A.Script);
  const audio = stubAudio();
  const events = { judge: [], rescue: [], cover: [], cue: [] };
  const r = A.createRhythm(chart, audio, {
    difficulty: "演播",
    onJudge: (tier, n, d) => events.judge.push([tier, n.text, +d.toFixed(3)]),
    onRescue: (n) => events.rescue.push(n.text),
    onCover: (n) => events.cover.push(n.text),
    onCue: (q) => events.cue.push(q.time)
  });
  const mine = r.mine;

  // 6.1 正拍按下 = PERFECT
  let res = r.press(mine[0].time, mine[0].p);
  if (!res || res.tier !== "perfect") fail(`正拍按下判定成了 ${res && res.tier}`);
  if (r.state.combo !== 1) fail("命中之后连击没有加");
  if (r.state.score !== 1000) fail(`第一个 PERFECT 得分 ${r.state.score}，应该是 1000`);

  // 6.2 演播档晚 80ms = GOOD（旧 ±150 的 120ms 在新窗里是 OK）
  r.reset();
  res = r.press(r.mine[0].time + 0.08, r.mine[0].p);
  if (!res || res.tier !== "good") fail(`晚 80ms 判定成了 ${res && res.tier}`);
  r.reset();
  res = r.press(r.mine[0].time + 0.12, r.mine[0].p);
  if (!res || res.tier !== "ok") fail(`演播档晚 120ms 判定成了 ${res && res.tier}，应该是 OK`);

  // 6.3 晚 200ms = OK
  r.reset();
  res = r.press(r.mine[0].time + 0.2, r.mine[0].p);
  if (!res || res.tier !== "ok") fail(`晚 200ms 判定成了 ${res && res.tier}`);

  // 6.4 完全不按 = MISS，连击清零
  r.reset();
  r.update(r.mine[0].time + 0.26);
  if (r.state.counts.miss !== 1) fail(`过了窗口没按，miss 计数是 ${r.state.counts.miss}`);
  if (r.state.combo !== 0) fail("miss 之后连击没有清零");

  // 6.5 长按：按满 vs 松太早
  const holdNote = r.mine.find((n) => n.type === "hold" && !n.both);
  r.reset();
  r.update(holdNote.time - 0.5);
  r.press(holdNote.time, holdNote.p);
  const sFull = r.state.score;
  r.release(holdNote.time + holdNote.dur);
  if (Math.abs((holdNote.heldRatio || 0) - 1) > 0.02) fail(`按满的长音 heldRatio = ${holdNote.heldRatio}`);
  r.reset();
  r.update(holdNote.time - 0.5);
  r.press(holdNote.time, holdNote.p);
  r.release(holdNote.time + holdNote.dur * 0.25);
  if ((holdNote.heldRatio || 0) > 0.4) fail(`松太早的长音 heldRatio = ${holdNote.heldRatio}，应该明显小于 1`);
  if (r.state.score >= sFull) fail("松太早居然没扣分");

  // 6.6 接力漏掉 → 她补位
  const relay = r.mine.find((n) => n.type === "relay");
  r.reset();
  r.update(relay.time + A.JUDGE_WIN.ok + 0.01);
  if (r.state.rescues !== 1) fail(`漏掉接力之后救场次数是 ${r.state.rescues}`);
  if (!events.rescue.length) fail("救场没有触发 onRescue");
  const cov = r.covers.find((c) => c.forNote === relay.id);
  if (!cov) fail("没有生成对应的补位音符");
  else {
    r.update(cov.time + 0.01);
    if (!cov.judged) fail("补位音符到点了却没有命中");
    if (!events.cover.length) fail("补位没有触发 onCover");
    if (!audio.log.cover) fail("补位没有放她那声「接住」的音效");
  }

  // 6.6b 接力接住了，她就不该再补念一遍
  r.reset();
  audio.log.cover = 0;
  events.cover.length = 0;
  const covB = r.covers.find((c) => c.forNote === relay.id);
  if (covB.active) fail("还没漏接，补位音符就已经激活了");
  if (r.live().hers.some((n) => n.cover)) fail("还没漏接，补位音符就已经画在轨道上了");
  r.update(relay.time);
  const rres = r.press(relay.time, relay.p);
  if (!rres || rres.tier !== "perfect") fail("接力音符正拍按下没判成 PERFECT");
  r.update(relay.time + 0.3);
  r.update(covB.time + 0.05);
  if (r.state.rescues !== 0) fail(`接力接住了，救场次数却是 ${r.state.rescues}`);
  if (events.cover.length) fail("接力接住了，她却还是补念了一遍");
  if (audio.log.cover) fail("接力接住了，补位音效还是响了");

  // 6.7 她的轨道全自动
  r.reset();
  const herNote = r.hers.find((n) => !n.cover);
  r.update(herNote.time + 0.01);
  if (!herNote.judged) fail("她的音符到点了没有自动命中");
  if (r.state.counts.miss !== 0) fail("她的轨道出现了 MISS");

  // 6.8 提示点
  r.reset();
  const cue = chart.cues[0];
  r.update(cue.time + 0.01);
  if (!events.cue.length) fail("提示点没有触发");
  if (!audio.log.paper) fail("提示点没有「敲稿纸」的音效");

  // 6.9 全部走完一个都不按 → D
  r.reset();
  for (let t = 0; t <= chart.duration + 1; t += 0.05) r.update(t);
  if (!r.state.finished) fail("整首走完却没有结算");
  const stMiss = r.stats();
  if (stMiss.total !== r.mine.length) fail("结算里的音符总数不对");
  if (stMiss.rank !== "D") fail(`一个都没按，评级却是 ${stMiss.rank}`);
  if (stMiss.accuracy > 0.01) fail("一个都没按，准确率却不是 0");

  // 6.10 两档各打一遍全 PERFECT：评级、五段数据与逐段回放一致
  for (const name of DIFF_NAMES) {
    const { r: rr, audio: aa } = playThrough(A, chart, name);
    const st = rr.stats();
    if (!rr.state.finished) fail(`${name} 档全打完之后没有结算`);
    if (rr.state.counts.wrong) fail(`${name} 档全打对却出现了错键`);
    if (st.accuracy < 0.99) fail(`${name} 档全 PERFECT 准确率只有 ${st.accuracy.toFixed(3)}`);
    if (st.rank !== "S") fail(`${name} 档全 PERFECT 评级是 ${st.rank}`);
    if (st.combo !== rr.mine.length) fail(`${name} 档全命中最高连击是 ${st.combo}`);
    if (!st.syncBoth) fail(`${name} 档收尾没有同步成功`);
    if (st.graces.hit !== st.graces.total) fail(`${name} 档装饰音没有全收（${st.graces.hit}/${st.graces.total}）`);
    if (st.difficulty !== name) fail(`结算里的档位是 ${st.difficulty}`);
    if (st.maxNoise !== 0) fail(`全打对却有噪音 ${st.maxNoise}`);

    // 五段：名字 / 顺序 / 每段数字都能从逐音符结果独立重算出来
    if (st.segments.length !== 5) fail(`${name} 档结算不是五段`);
    if (JSON.stringify(st.segments.map((s) => s.name)) !== JSON.stringify(SEG_NAMES)) {
      fail(`${name} 档五段名字不对`);
    }
    // 独立重算每段：准确率、接力、段内最高连击
    const segMax = {};
    let combo = 0;
    let maxCombo = 0;
    const relayBySeg = {};
    for (const n of rr.mine) {
      if (n.result === "skip") continue;
      if (n.type === "relay") {
        relayBySeg[n.seg] = relayBySeg[n.seg] || { total: 0, caught: 0 };
        relayBySeg[n.seg].total++;
      }
      const hit = n.result === "perfect" || n.result === "good" || n.result === "ok";
      if (hit) {
        combo++;
        maxCombo = Math.max(maxCombo, combo);
        segMax[n.seg] = Math.max(segMax[n.seg] || 0, combo);
        if (n.type === "relay") relayBySeg[n.seg].caught++;
      } else {
        combo = 0;
      }
    }
    let totalNotes = 0;
    let totalRelay = 0;
    let totalCaught = 0;
    for (const s of st.segments) {
      const arr = rr.mine.filter((n) => n.seg === s.index && n.result !== "skip");
      totalNotes += arr.length;
      let weighted = 0;
      for (const n of arr) {
        if (n.result === "perfect") weighted += 1;
        else if (n.result === "good") weighted += 0.7;
        else if (n.result === "ok") weighted += 0.4;
      }
      const acc = arr.length ? Math.max(0, Math.min(1, weighted / arr.length)) : 0;
      if (!close(s.accuracy, acc, 1e-9)) fail(`${name} 档「${s.name}」的准确率和逐音符重算不一致`);
      if (s.total !== arr.length) fail(`${name} 档「${s.name}」的音符数和重算不一致`);
      if (s.maxCombo !== (segMax[s.index] || 0)) fail(`${name} 档「${s.name}」的最高连击和逐段回放不一致`);
      const rel = relayBySeg[s.index] || { total: 0, caught: 0 };
      if (s.relaysTotal !== rel.total) fail(`${name} 档「${s.name}」的接力总数不一致`);
      if (s.relaysCaught !== rel.caught) fail(`${name} 档「${s.name}」的接力接住数不一致`);
      totalRelay += rel.total;
      totalCaught += rel.caught;
    }
    if (totalNotes !== st.total) fail(`${name} 档五段音符数加起来不等于总数`);
    if (totalRelay !== st.relaysTotal) fail(`${name} 档五段接力数加起来不等于总接力数`);
    if (totalCaught !== st.relaysCaught) fail(`${name} 档五段接住数加起来不等于总接住数`);
    if (Math.max(...st.segments.map((s) => s.maxCombo)) !== st.combo) {
      fail(`${name} 档逐段最高连击的最大值不等于全局最高连击`);
    }
    if (maxCombo !== st.combo) fail(`${name} 档全局最高连击和逐音符重算不一致`);
    if (aa.log.say.length === 0) fail(`${name} 档全流程没有发出任何声音事件`);
    if (st.relaysCaught !== st.relaysTotal) fail(`${name} 档接力没有全接住`);
  }

  // 全 PERFECT 的分数要包含装饰音（8 个 ×50）
  const { r: perfect } = playThrough(A, chart, "演播");
  const pst = perfect.stats();
  if (pst.score <= 0) fail("全 PERFECT 分数是 0");
  ok(`判定/计分/救场 + 五段：全 PERFECT ${pst.score} 分 S 级，五段数据与逐段回放一致`);
}

// ---------------------------------------------------------------- 7. 浏览器

async function checkBrowser(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  // Chrome 冷启动时首屏偶尔会慢过 30 秒，超时时间给足，别让自检假报错
  await page.goto(PAGE, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__bc && window.__bc.state, null, { timeout: 30000 });
  {
    const safe = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--safe-b").trim());
    if (safe !== "0px") fail(`没有自动隐藏任务栏时不该让出底部安全区（--safe-b=${safe || "空"}）`);
  }

  // 7.1 开场
  const s0 = await page.evaluate(() => window.__bc.state());
  if (s0.state !== "intro") fail(`刚打开时状态是 ${s0.state}`);
  if (s0.difficulty !== "演播") fail(`没有存档时默认档位是 ${s0.difficulty}`);
  if (s0.paperVariant) fail("没有过场稿纸存档时不该有多出来的念稿小动作");
  await page.waitForTimeout(2400);
  const dlgOn = await page.evaluate(() => document.getElementById("dlg").classList.contains("show"));
  if (!dlgOn) fail("开场没有出现对白框");

  // 7.2 布局：字幕条在画布下面，轨道不压人物
  const geo = await page.evaluate(() => {
    const g = document.getElementById("game").getBoundingClientRect();
    const s = document.getElementById("script").getBoundingClientRect();
    return {
      canvas: [Math.round(g.width), Math.round(g.height)],
      canvasBottom: Math.round(g.bottom), scriptTop: Math.round(s.top),
      scriptH: Math.round(s.height),
      inner: [document.getElementById("game").width, document.getElementById("game").height]
    };
  });
  if (geo.inner[0] !== 512 || geo.inner[1] !== 288) fail(`画布逻辑尺寸 ${geo.inner}，应该是 512×288`);
  if (geo.scriptTop < geo.canvasBottom - 1) fail("广播稿字幕条压在画布上了");
  if (geo.scriptH < 40) fail(`字幕条只有 ${geo.scriptH}px 高`);

  const laneBox = await page.evaluate(() => {
    const girl = [275 - 29, 275 + 29], boy = [166 - 30, 166 + 30];
    return { lane: [358, 458], girl, boy };
  });
  if (!(laneBox.lane[0] > laneBox.girl[1] && laneBox.lane[0] > laneBox.boy[1])) {
    fail("轨道和人物重叠了");
  }

  // 7.3 推完开场对白 → 试音
  for (let i = 0; i < 40; i++) {
    const st = await page.evaluate(() => window.__bc.state().state);
    if (st !== "intro") break;
    await page.keyboard.press("KeyE");
    await page.waitForTimeout(90);
  }
  let st = await page.evaluate(() => window.__bc.state().state);
  if (st !== "check") fail(`对白读完应该进入试音，实际是 ${st}`);

  // 7.4 跟着节拍器按 8 下 → 档位选择
  const waitForTick = await page.evaluate(() => {
    const c = window.__bc.scene.check;
    return c ? Math.max(0, (c.start - window.__bc.audio.now()) * 1000) : 0;
  });
  await page.waitForTimeout(waitForTick + 60);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Space");
    await page.waitForTimeout(625);
  }
  await page.waitForFunction(() => window.__bc.state().state === "diff", null, { timeout: 12000 })
    .catch(() => { });
  st = await page.evaluate(() => window.__bc.state().state);
  if (st !== "diff") fail(`按满 8 下之后应该是档位选择，实际是 ${st}`);
  const diffUi = await page.evaluate(() => ({
    show: document.getElementById("diff").classList.contains("show"),
    opts: [...document.querySelectorAll("#diff [data-d]")].map((b) => b.dataset.d)
  }));
  if (!diffUi.show) fail("档位选择层没有出现");
  if (JSON.stringify(diffUi.opts) !== JSON.stringify(DIFF_NAMES)) fail(`档位按钮是 ${diffUi.opts.join("/")}`);
  // 选「演播」进正式录
  await page.click('#diff [data-d="演播"]');
  const savedDiff = await page.evaluate(() => {
    try { return localStorage.getItem("act3-difficulty-v1"); } catch (e) { return null; }
  });
  if (savedDiff !== "演播") fail(`档位没有存进 act3-difficulty-v1（存的是 ${savedDiff}）`);
  const offsetSaved = await page.evaluate(() => {
    try {
      const d = JSON.parse(localStorage.getItem("our-story-act3-broadcast-v1") || "null");
      return d ? d.offset : null;
    } catch (e) { return null; }
  });
  if (offsetSaved === null) fail("试音之后没有把手感校准存下来");

  // 7.5 倒计时 → 演奏
  await page.waitForFunction(() => window.__bc.state().state === "play", null, { timeout: 15000 });
  const onAir = await page.evaluate(() => window.__bc.state().onAir);
  if (onAir < 0.5) fail("开始演奏了 ON AIR 灯却没亮");
  const firstChart = await page.evaluate(() => ({
    burst: window.__bc.chart.burst,
    segs: window.__bc.chart.segments.length,
    keys: window.__bc.chart.notes.filter((n) => n.lane === "me").every((n) => n.p === "hi" || n.p === "lo" || n.p === "both")
  }));
  if (!firstChart.keys) fail("玩家音符没有音高字段");
  if (firstChart.segs !== 5) fail("浏览器里的谱面不是五段");
  if (!firstChart.burst || !firstChart.burst.on) fail("首通没有触发突发段");
  // 音频时钟也要跟着末段加速：拍 → 秒的换算和谱面一致
  const tempo = await page.evaluate(() => {
    const a = window.__bc.audio, c = window.__bc.chart;
    let maxT = 0, maxB = 0;
    for (let b = 0; b <= c.totalBeats; b += 0.37) {
      maxT = Math.max(maxT, Math.abs(a.beatTime(b) - c.timeOfBeat(b)));
      maxB = Math.max(maxB, Math.abs(a.beatAt(c.timeOfBeat(b)) - c.beatOfTime(c.timeOfBeat(b))));
    }
    return {
      accel: c.accelBeat,
      d4: a.beatTime(c.accelBeat + 4) - a.beatTime(c.accelBeat),
      seekRound: a.beatAt(c.timeOfBeat(c.accelBeat + 2)),
      maxT: maxT,
      maxB: maxB
    };
  });
  if (Math.abs(tempo.d4 - 4 * 60 / 108) > 1e-6) fail(`音频时钟没有跟着末段加速（4 拍 = ${tempo.d4.toFixed(3)}s）`);
  if (Math.abs(tempo.seekRound - (tempo.accel + 2)) > 1e-6) fail("音频的拍 ↔ 秒换算不可逆");
  // 拍 ↔ 秒只有谱面这一份实现；音频必须全程和它一致，不能各写一份后悄悄错位
  if (tempo.maxT > 1e-9 || tempo.maxB > 1e-9) {
    fail(`音频和谱面的拍 ↔ 秒映射不一致（拍→秒 ${tempo.maxT}，秒→拍 ${tempo.maxB}）`);
  }

  // 7.6 打开自动弹：按音高按 F/J，故意漏掉所有接力（验证补位）
  await page.evaluate(() => {
    window.__auto = { on: true, presses: 0, skips: 0, skip: new Set(), done: new Set() };
    let hold = null;
    (function tick() {
      if (!window.__auto.on) return;
      const bc = window.__bc;
      if (bc.state().state === "play") {
        const t = bc.audio.songTime();
        if (hold && t >= hold.until) { bc.release(); hold = null; }
        for (const n of bc.rhythm.mine) {
          if (n.judged || window.__auto.skip.has(n.id) || window.__auto.done.has(n.id)) continue;
          if (n.time - t > 0.02) break;
          if (t - n.time > 0.06) continue;
          if (n.type === "relay") {
            window.__auto.skip.add(n.id);
            window.__auto.skips++;
            continue;
          }
          window.__auto.done.add(n.id);
          bc.press(n.p === "lo" ? "lo" : "hi");
          window.__auto.presses++;
          if (n.type === "hold") hold = { until: n.time + n.dur };
        }
      }
      requestAnimationFrame(tick);
    })();
  });

  // 7.7 漏接接力 → 她补位
  await page.waitForFunction(() => window.__bc.state().rescues >= 1, null, { timeout: 40000 })
    .catch(() => { });
  const resc = await page.evaluate(() => window.__bc.state());
  if (!resc.rescues) fail("漏掉接力之后她没有补位");
  await page.waitForTimeout(1200);
  const coverHit = await page.evaluate(() => {
    const c = window.__bc.rhythm.covers[0];
    return c ? { judged: !!c.judged, text: c.text } : null;
  });
  if (!coverHit) fail("没有生成补位音符");
  else if (!coverHit.judged) fail(`补位音符「${coverHit.text}」到点了却没有命中`);
  await page.screenshot({ path: path.join(OUT, "c2-rescue.png") });

  // 7.8 再跑一段，确认普通音符一直在被命中
  await page.waitForTimeout(7000);
  const auto = await page.evaluate(() => ({
    presses: window.__auto.presses,
    st: window.__bc.state(),
    scr: {
      who: document.getElementById("scrWho").textContent,
      text: document.getElementById("scrLine").textContent,
      spans: document.getElementById("scrLine").children.length
    }
  }));
  if (auto.presses < 3) fail(`自动弹了二十几秒只按下 ${auto.presses} 次，谱面没在走`);
  if (auto.st.counts.perfect < auto.presses * 0.7) {
    fail(`自动弹 ${auto.presses} 次，PERFECT 只有 ${auto.st.counts.perfect} 次`);
  }
  if (auto.st.counts.wrong > 0) fail(`自动弹按对了音高却出现了 ${auto.st.counts.wrong} 个错键`);
  if (auto.st.counts.miss > 8) fail(`自动弹却漏了 ${auto.st.counts.miss} 个（只该漏接力）`);
  if (!auto.scr.spans) fail("字幕条里没有任何词块");
  if (!auto.scr.text.length) fail("字幕条是空的");
  if (["朱里", "和臣"].indexOf(auto.scr.who) < 0) fail(`字幕说话人显示成了「${auto.scr.who}」`);
  await page.screenshot({ path: path.join(OUT, "c1-play.png") });

  // 7.9 突发段字幕：词块顺序和谱面解耦、整行标红、文字没改
  const burstCheck = await page.evaluate(() => {
    const bc = window.__bc;
    const d = bc.chart.display.find((x) => x.burst && x.chunks.length > 1);
    if (!d) return { err: "没有可验证的突发段字幕行" };
    bc._seek(d.startTime + 0.05);
    return { startTime: d.startTime };
  });
  if (burstCheck.err) fail(burstCheck.err);
  else {
    await page.waitForTimeout(350);
    const burstScr = await page.evaluate(() => {
      const spans = [...document.querySelectorAll("#scrLine span")];
      const ids = spans.map((s) => +s.dataset.note);
      const timeOf = {};
      for (const n of window.__bc.chart.notes) timeOf[n.id] = n.time;
      const domOrder = ids.map((id) => timeOf[id]);
      const sorted = domOrder.slice().sort((a, b) => a - b);
      return {
        lineBurst: document.getElementById("scrLine").classList.contains("burst"),
        burstSpans: spans.filter((s) => s.classList.contains("burst")).length,
        spans: spans.length,
        scrambled: JSON.stringify(domOrder) !== JSON.stringify(sorted)
      };
    });
    if (!burstScr.lineBurst) fail("突发段的字幕行没有标红");
    if (burstScr.burstSpans < 2) fail("突发段的词块没有标红");
    if (burstScr.spans < 2) fail("突发段字幕行里没有词块");
    if (!burstScr.scrambled) fail("突发段的词块顺序没有被真正打乱");
  }

  // 7.10 噪音演出：≥50 字幕条带雪花点，升到 80 在电台档会救援（演播档这里只验类名）
  await page.evaluate(() => { window.__bc.rhythm.state.noise = 60; });
  await page.waitForTimeout(250);
  const noisy = await page.evaluate(() => ({
    cls: document.getElementById("script").classList.contains("noisy"),
    noise: window.__bc.state().noise
  }));
  if (noisy.noise < 50) fail(`把噪音调到 60 之后读数还是 ${noisy.noise}`);
  if (!noisy.cls) fail("噪音 ≥50 时字幕条没有进入雪花点状态");
  await page.evaluate(() => { window.__bc.rhythm.state.noise = 0; });
  await page.waitForTimeout(250);
  const clean = await page.evaluate(() => document.getElementById("script").classList.contains("noisy"));
  if (clean) fail("噪音降回 0 之后字幕条还是雪花点状态");

  // 7.11 退出
  await page.keyboard.press("Escape");
  await page.waitForTimeout(900);
  const left = await page.evaluate(() => ({
    st: window.__bc.state().state,
    bye: document.getElementById("bye").classList.contains("show"),
    bar: document.getElementById("script").classList.contains("show"),
    t: window.__bc.audio.songTime()
  }));
  if (left.st !== "leave") fail(`按 Esc 之后状态是 ${left.st}`);
  if (!left.bye) fail("按 Esc 之后没有推出收尾卡");
  if (left.bar) fail("退出之后字幕条还在滚");
  // 停歌之后 songTime 必须停在停下的那一刻，不能归零
  if (left.t < 5) fail(`退出时 songTime 是 ${left.t.toFixed(2)}，停歌把时钟归零了`);
  await page.screenshot({ path: path.join(OUT, "c3-leave.png") });

  // 7.12 再录一次：直接跳到结尾，让它自然结算到完成卡
  await page.click("#resume");
  await page.waitForFunction(() => window.__bc.state().state === "play", null, { timeout: 20000 });
  await page.evaluate(() => window.__bc._seek(window.__bc.chart.duration - 6));
  await page.waitForFunction(() => window.__bc.scene.state === "finale" || window.__bc.scene.state === "done",
    null, { timeout: 30000 }).catch(() => { });
  for (let i = 0; i < 40; i++) {
    const scene = await page.evaluate(() => window.__bc.scene.state);
    if (scene === "done") break;
    await page.keyboard.press("KeyE");
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(600);
  const card = await page.evaluate(() => {
    let result = null;
    try { result = JSON.parse(localStorage.getItem("act3-result-v1") || "null"); } catch (e) { }
    let save = null;
    try { save = JSON.parse(localStorage.getItem("our-story-act3-broadcast-v1") || "null"); } catch (e) { }
    return {
      scene: window.__bc.scene.state,
      cardShown: document.getElementById("card").classList.contains("show"),
      rank: document.getElementById("rank").textContent,
      rows: document.querySelectorAll("#segRows tr").length,
      segNames: [...document.querySelectorAll("#segRows tr td:first-child")].map((td) => td.textContent),
      meta: document.getElementById("meta").textContent,
      sync: document.getElementById("syncLine").textContent,
      result, save,
      stats: window.__bc.stats(),
      burst: window.__bc.chart.burst
    };
  });
  if (card.scene !== "done") fail(`收尾之后状态是 ${card.scene}`);
  if (!card.cardShown) fail("收尾之后完成卡没有弹出来");
  if (card.rows !== 5) fail(`完成卡里的分段行数是 ${card.rows}，应该是 5`);
  if (JSON.stringify(card.segNames) !== JSON.stringify(SEG_NAMES)) fail(`完成卡五段是 ${card.segNames.join("/")}`);
  if (!card.meta.includes("电流最高")) fail("完成卡没有显示电流最高值");
  if (!card.sync.includes("收尾同步")) fail("完成卡没有收尾同步这一行");

  // act3-result-v1 的结构（第四幕按它换台词）
  const res = card.result;
  if (!res) fail("没有写 act3-result-v1");
  else {
    if (res.difficulty !== "演播") fail(`结算存档的档位是 ${res.difficulty}`);
    if (!["S", "A", "B", "C", "D"].includes(res.rank)) fail(`结算存档评级是 ${res.rank}`);
    if (typeof res.accuracy !== "number" || res.accuracy < 0 || res.accuracy > 1) fail(`结算存档准确率是 ${res.accuracy}`);
    if (typeof res.score !== "number") fail("结算存档没有分数");
    if (typeof res.maxCombo !== "number") fail("结算存档没有最高连击");
    if (typeof res.relaysCaught !== "number" || typeof res.relaysTotal !== "number") fail("结算存档没有接力数");
    if (res.relaysCaught > res.relaysTotal) fail("结算存档接住的接力比总数还多");
    if (typeof res.syncBoth !== "boolean") fail("结算存档的 syncBoth 不是布尔");
    if (typeof res.maxNoise !== "number" || res.maxNoise < 0 || res.maxNoise > 100) fail("结算存档的 maxNoise 不在 0–100");
    if (typeof res.rescues !== "number") fail("结算存档没有救援次数");
    if (!Array.isArray(res.segments) || res.segments.length !== 5) fail("结算存档不是五段");
    else {
      if (JSON.stringify(res.segments.map((s) => s.name)) !== JSON.stringify(SEG_NAMES)) {
        fail("结算存档五段名字不对");
      }
      for (const s of res.segments) {
        if (typeof s.accuracy !== "number" || s.accuracy < 0 || s.accuracy > 1) fail(`「${s.name}」的准确率不在 0–1`);
        if (typeof s.relaysCaught !== "number" || typeof s.relaysTotal !== "number") fail(`「${s.name}」缺接力数`);
        if (typeof s.maxCombo !== "number") fail(`「${s.name}」缺最高连击`);
      }
    }
    const rs = card.stats;
    if (res.difficulty !== rs.difficulty) fail("结算存档的档位与 stats 不一致");
    if (res.maxCombo !== rs.combo) fail("结算存档的最高连击与 stats 不一致");
    if (Math.abs(res.accuracy - rs.accuracy) > 1e-4) fail("结算存档的准确率与 stats 不一致");
    if (res.syncBoth !== rs.syncBoth) fail("结算存档的 syncBoth 与 stats 不一致");
    if (JSON.stringify(res.segments.map((s) => s.maxCombo)) !== JSON.stringify(rs.segments.map((s) => s.maxCombo))) {
      fail("结算存档的分段连击与 stats 不一致");
    }
    // 自动按住并到点松手，收尾 both 必须同步成功（这是 2.3 的验收点）
    if (res.syncBoth !== true) fail("收尾 both 自动按住/松手之后没有同步成功");
    if (!res.graces || res.graces.total !== 8) fail(`结算存档的装饰音总数是 ${res.graces && res.graces.total}`);
    if (res.burst !== true) fail("首通结算存档没有记录突发段");
  }
  // 旧键语义不变：只留 offset / cleared / best
  if (!card.save) fail("旧的广播存档被弄丢了");
  else {
    const allowed = ["offset", "cleared", "best"];
    const extra = Object.keys(card.save).filter((k) => allowed.indexOf(k) < 0);
    if (extra.length) fail(`旧存档键里多了字段：${extra.join(",")}（应该只存 offset/cleared/best）`);
    if (card.save.cleared !== true) fail("录完之后旧存档没有记 cleared");
  }

  // 7.13 过场稿纸变体：接住 1 张时念稿前多一句小动作字幕，谱面不变
  const ctx2 = await browser.newContext();
  await ctx2.addInitScript(() => {
    try {
      localStorage.setItem("our-story-bridge-papers-v1", "1");
      localStorage.setItem("act3-difficulty-v1", "电台");
      localStorage.setItem("our-story-act3-broadcast-v1", JSON.stringify({ offset: 40, best: 1234 }));
    } catch (e) { }
  });
  const page2 = await ctx2.newPage({ viewport: { width: 1280, height: 720 } });
  const errors2 = [];
  page2.on("pageerror", (e) => errors2.push("pageerror: " + e.message));
  page2.on("console", (m) => { if (m.type() === "error") errors2.push("console: " + m.text()); });
  await page2.goto(PAGE_NORMAL, { waitUntil: "load", timeout: 60000 });
  await page2.waitForFunction(() => window.__bc && window.__bc.state, null, { timeout: 30000 });
  const p2 = await page2.evaluate(() => ({
    difficulty: window.__bc.state().difficulty,
    papers: window.__bc.papersCaught(),
    variant: window.__bc.state().paperVariant,
    offsetMs: window.__bc.state().offsetMs,
    notes: window.__bc.chart.count,
    segs: window.__bc.chart.segments.length
  }));
  if (p2.difficulty !== "电台") fail(`存档里的档位没有读回来（读到 ${p2.difficulty}）`);
  if (p2.papers !== 1) fail(`过场稿纸数读成了 ${p2.papers}`);
  if (!p2.variant) fail("接住 1 张稿纸时，念稿前没有小动作字幕变体");
  if (p2.offsetMs !== 40) fail(`两档共用的 offsetMs 没有读回来（读到 ${p2.offsetMs}）`);
  if (p2.notes !== 145) fail(`稿纸变体动了谱面音符数（${p2.notes}）`);
  if (p2.segs !== 5) fail("稿纸变体动了五段结构");
  // 把这句变体字幕抓出来
  const seen = [];
  for (let i = 0; i < 40; i++) {
    const scene = await page2.evaluate(() => window.__bc.state().state);
    if (scene !== "intro") break;
    seen.push(await page2.evaluate(() => document.getElementById("dlgLine").textContent));
    await page2.keyboard.press("KeyE");
    await page2.waitForTimeout(90);
  }
  if (!seen.some((t) => t.indexOf("顺序有点乱") >= 0)) fail("接住 1 张时的念稿前小动作字幕没有出现");
  if (errors2.length) fails.push(...errors2.slice(0, 4));
  await ctx2.close();

  // 7.14 自动隐藏任务栏的安全区：任务栏弹出来不能盖住广播稿字幕条
  // 命中条件：工作区高度 == 整屏（任务栏不占位）、窗口贴着屏幕底、还留着浏览器标题栏。
  const ctxSafe = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctxSafe.addInitScript(() => {
    Object.defineProperty(Screen.prototype, "height", { get: () => 720 });
    Object.defineProperty(Screen.prototype, "availHeight", { get: () => 720 });
    Object.defineProperty(window, "outerHeight", { get: () => 900 });
  });
  const pageSafe = await ctxSafe.newPage();
  await pageSafe.goto(PAGE_NORMAL, { waitUntil: "load", timeout: 60000 });
  await pageSafe.waitForFunction(() => window.__bc && window.__bc.state, null, { timeout: 30000 });
  const safe = await pageSafe.evaluate(() => {
    const st = document.getElementById("stage").getBoundingClientRect();
    const sc = document.getElementById("script").getBoundingClientRect();
    return {
      v: getComputedStyle(document.documentElement).getPropertyValue("--safe-b").trim(),
      stageBottom: Math.round(st.bottom),
      scriptBottom: Math.round(sc.bottom),
      inner: innerHeight
    };
  });
  if (safe.v !== "52px") fail(`自动隐藏任务栏时底部安全区应该是 52px，实际 ${safe.v || "0"}`);
  if (safe.stageBottom !== safe.inner - 52) fail(`底部安全区没让出来（stage 底 ${safe.stageBottom} / 视口 ${safe.inner}）`);
  if (Math.abs(safe.scriptBottom - safe.stageBottom) > 1) fail(`字幕条没有落在安全区上沿（${safe.scriptBottom} / ${safe.stageBottom}）`);
  await ctxSafe.close();

  // 7.15 报错
  if (errors.length) fails.push(...errors.slice(0, 6));
  else ok("浏览器无报错");

  await page.close();
  return { geo, auto: auto.st, left, result: res };
}

// ---------------------------------------------------------------- 跑

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const A = loadAct3();
  const chart = checkChart(A);
  checkJudge(A);
  checkKeys(A);
  checkNoise(A);
  checkBoth(A);
  checkPlay(A);

  const browser = await chromium.launch({
    channel: "chrome",
    args: ["--autoplay-policy=no-user-gesture-required"]
  });
  let br = null;
  try {
    br = await checkBrowser(browser);
  } catch (e) {
    fail("浏览器部分抛异常：" + e.message.split("\n")[0]);
  }
  await browser.close();

  console.log(JSON.stringify({
    chart: {
      notes: chart.count, mine: chart.mine, hers: chart.hers,
      duration: +chart.duration.toFixed(1), types: chart.types,
      segments: chart.segments.map((s) => s.name), accelBeat: chart.accelBeat,
      graces: chart.graces.length, both: chart.both.length,
      burst: chart.burst && chart.burst.on ? [chart.burst.startBeat, chart.burst.endBeat] : null
    },
    browser: br,
    ok: notes,
    failures: fails
  }, null, 2));

  if (fails.length) {
    console.log("\n✗ " + fails.length + " 条没过");
    process.exit(1);
  }
  console.log("\n✓ 全部通过（" + notes.length + " 项）");
})();

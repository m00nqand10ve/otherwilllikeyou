/* 全站 BGM 管理器
 *
 * 普通 <script> 引入，不依赖构建：
 *   <script src="../audio/bgm.js"></script>
 *
 *   BGM.play("afternoon");           // 开始 / 换曲，默认交叉淡入
 *   BGM.crossfade("dusk", 2.4);      // 显式指定淡入淡出秒数
 *   BGM.duck(0.55);                  // 对白时压低
 *   BGM.unduck();
 *   BGM.stop({ fade: 1 });
 *
 * 约束：
 *   - 项目要能 file:// 双击打开，所以 BGM 用 <audio> 元素播放。不走
 *     fetch + decodeAudioData，也不接 createMediaElementSource——本地文件
 *     可能被当成跨域而静音。
 *   - 默认目录 assets/audio/bgm/，同名 .ogg 优先、.mp3 兜底；整组曲目
 *     可以用 BGM.configure({ base: "audio/bgm/" }) 换位置。
 *   - 浏览器不允许无手势自动播放：play() 被拦下时先挂起，等第一次
 *     pointerdown / keydown 再续上，不抛错。
 *   - 音量和静音存在 our-story-audio-v1，不碰剧情存档。
 */
(function (global) {
  "use strict";

  const STORE_KEY = "our-story-audio-v1";
  const DEFAULT_VOLUME = 0.55;
  const DEFAULT_FADE = 1.4;
  const DEFAULT_STOP = 0.8;

  // 曲目表。file 不带扩展名时按浏览器能力补 .ogg / .mp3。
  // 这些名字和《第四幕-美术资产清单》里的建议一一对应，文件还没放进来
  // 也不会报错，只会在控制台提示一次加载失败。
  const TRACKS = {
    afternoon: { file: "corridor_afternoon", volume: 0.90 },
    title: { file: "corridor_afternoon", volume: 0.70 },
    morning: { file: "corridor_morning", volume: 0.85 },
    dusk: { file: "corridor_dusk", volume: 0.90 },
    memory: { file: "corridor_memory", volume: 0.80 },
    tense: { file: "corridor_tense", volume: 0.65 },
    phone: { file: "phone_dust", volume: 0.60 },
    ball: { file: "corridor_ball", volume: 0.85 },
    ending: { file: "corridor_ending", volume: 0.90 },
    radio: { file: "radio_room_tone", volume: 0.45 }
  };

  const channels = [];
  const tweens = new Map();
  const warned = Object.create(null);
  const preloaders = Object.create(null);
  const listeners = [];

  let rootUrl = detectRoot();
  let baseUrl = new URL("assets/audio/bgm/", rootUrl).href;
  let ext = null;

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {}; } catch (e) { saved = {}; }

  let master = typeof saved.volume === "number" ? clamp(saved.volume, 0, 1) : DEFAULT_VOLUME;
  let muted = saved.muted === true;
  let duckLevel = 1;
  let unlocked = false;
  let pending = null;
  let unlockHandler = null;
  let active = null;
  let currentName = null;
  let pausedName = null;
  let timer = 0;

  function now() {
    return global.performance && global.performance.now ? global.performance.now() : Date.now();
  }

  function clamp(v, a, b) {
    v = Number(v);
    if (!isFinite(v)) return a;
    return v < a ? a : v > b ? b : v;
  }

  function detectRoot() {
    const script = document.currentScript;
    if (script && script.src) {
      try { return new URL("../", script.src); } catch (e) { /* 落到下面的默认值 */ }
    }
    // currentScript 拿不到时只能按当前页面推断。放在各幕子目录里时，
    // 用 BGM.configure({ base: "../assets/audio/bgm/" }) 修正。
    return new URL("./", location.href);
  }

  function pickExt() {
    if (ext) return ext;
    const probe = document.createElement("audio");
    if (probe.canPlayType && probe.canPlayType('audio/ogg; codecs="vorbis"')) ext = ".ogg";
    else if (probe.canPlayType && probe.canPlayType("audio/mpeg")) ext = ".mp3";
    else ext = ".ogg";
    return ext;
  }

  function trackUrl(def) {
    if (def.src) return new URL(def.src, baseUrl).href;
    let file = def.file || def.name || "track";
    if (!/\.(ogg|mp3|wav|m4a)$/i.test(file)) file += pickExt();
    return new URL(file, baseUrl).href;
  }

  function getTrack(name) {
    return TRACKS[name] || null;
  }

  function newAudio() {
    if (typeof global.Audio === "function") return new global.Audio();
    return document.createElement("audio");
  }

  function warnOnce(key, message, err) {
    if (warned[key]) return;
    warned[key] = true;
    if (!global.console || !console.warn) return;
    if (err) console.warn("[BGM] " + message, err);
    else console.warn("[BGM] " + message);
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        volume: Math.round(master * 1000) / 1000,
        muted: muted
      }));
    } catch (e) { /* 无痕模式 / 本地存储被禁用 */ }
  }

  function emit() {
    const snapshot = state();
    listeners.slice().forEach(function (fn) {
      try { fn(snapshot); } catch (e) { /* 订阅者自己的错误不该影响播放 */ }
    });
  }

  // ------------------------------------------------------------ 音量

  function applyVolume(ch) {
    ch.el.volume = muted ? 0 : clamp(master * ch.level * ch.gain * duckLevel, 0, 1);
  }

  function applyAll() {
    for (let i = 0; i < channels.length; i++) applyVolume(channels[i]);
  }

  function setVolume(v) {
    master = clamp(v, 0, 1);
    applyAll();
    save();
    emit();
    return master;
  }

  function setMuted(v) {
    muted = !!v;
    applyAll();
    save();
    emit();
    return muted;
  }

  // ------------------------------------------------------------ 补间

  function scheduleTick() {
    if (timer) return;
    timer = setInterval(tick, 33);
  }

  function tick() {
    const t = now();
    const entries = Array.from(tweens.entries());
    for (let i = 0; i < entries.length; i++) {
      const key = entries[i][0];
      const tw = entries[i][1];
      if (!tweens.has(key)) continue;
      let k = (t - tw.start) / tw.dur;
      if (k > 1) k = 1;
      const v = tw.from + (tw.to - tw.from) * k;
      try { tw.apply(v); } catch (e) { /* 忽略单个补间错误 */ }
      if (k >= 1) {
        tweens.delete(key);
        if (tw.done) {
          try { tw.done(); } catch (e) { /* 同上 */ }
        }
      }
    }
    if (!tweens.size && timer) {
      clearInterval(timer);
      timer = 0;
    }
  }

  function tween(key, from, to, ms, apply, done) {
    stopTween(key);
    if (!(ms > 0) || Math.abs(to - from) < 0.0001) {
      apply(to);
      if (done) done();
      return;
    }
    tweens.set(key, {
      from: from,
      to: to,
      start: now(),
      dur: ms,
      apply: apply,
      done: done
    });
    scheduleTick();
  }

  function stopTween(key) {
    tweens.delete(key);
  }

  // ------------------------------------------------------------ 通道

  function makeChannel() {
    const el = newAudio();
    el.loop = true;
    el.preload = "auto";
    const ch = { el: el, name: null, level: 1, gain: 0 };
    el.addEventListener("error", function () {
      const src = el.currentSrc || el.src;
      warnOnce("load:" + src, "无法加载 " + src);
    });
    return ch;
  }

  function ensureChannels() {
    if (channels.length) return;
    channels.push(makeChannel());
    channels.push(makeChannel());
  }

  function fadeOutChannel(ch, ms) {
    if (!ch) return;
    stopTween(ch);
    if (ch.el.paused) {
      ch.gain = 0;
      ch.name = null;
      applyVolume(ch);
      return;
    }
    if (!(ms > 0)) {
      ch.gain = 0;
      ch.name = null;
      ch.el.pause();
      applyVolume(ch);
      return;
    }
    tween(ch, ch.gain, 0, ms, function (v) {
      ch.gain = v;
      applyVolume(ch);
    }, function () {
      ch.el.pause();
      ch.name = null;
      ch.gain = 0;
      applyVolume(ch);
    });
  }

  function begin(name, opts, ch, fade) {
    const def = getTrack(name);
    if (!def) return false;

    const url = trackUrl(def);
    ch.name = name;
    ch.level = def.volume == null ? 1 : clamp(def.volume, 0, 1);
    ch.gain = 0;
    ch.el.loop = def.loop !== false;
    if (ch.el.src !== url) ch.el.src = url;
    applyVolume(ch);
    try { ch.el.currentTime = 0; } catch (e) { /* 元数据还没到时忽略 */ }

    const req = { name: name, opts: opts };
    let promise = null;
    let blocked = false;
    try {
      promise = ch.el.play();
    } catch (err) {
      blocked = true;
      if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
        pending = req;
        armUnlock(true);
      } else {
        warnOnce("play:" + name, "播放失败：" + name, err);
      }
    }

    if (promise && typeof promise.then === "function") {
      promise.then(function () {
        if (pending === req) pending = null;
        markUnlocked();
      }).catch(function (err) {
        if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
          pending = req;
          armUnlock(true);
        } else {
          warnOnce("play:" + name, "播放失败：" + name, err);
        }
      });
    } else if (!blocked) {
      if (pending === req) pending = null;
      markUnlocked();
    }

    tween(ch, 0, 1, fade, function (v) {
      ch.gain = v;
      applyVolume(ch);
    });
    return true;
  }

  // ------------------------------------------------------------ 自动播放解锁

  function removeUnlock() {
    if (!unlockHandler) return;
    global.removeEventListener("pointerdown", unlockHandler, true);
    global.removeEventListener("keydown", unlockHandler, true);
    unlockHandler = null;
  }

  function markUnlocked() {
    if (unlocked) return;
    unlocked = true;
    removeUnlock();
  }

  function armUnlock(force) {
    if (unlockHandler) return;
    if (unlocked && !force) return;
    unlockHandler = function () {
      removeUnlock();
      unlocked = true;
      const req = pending;
      pending = null;
      if (req) BGM.play(req.name, Object.assign({}, req.opts || {}, { restart: true }));
    };
    global.addEventListener("pointerdown", unlockHandler, true);
    global.addEventListener("keydown", unlockHandler, true);
  }

  function unlock() {
    unlocked = true;
    removeUnlock();
    const req = pending;
    pending = null;
    if (req) BGM.play(req.name, Object.assign({}, req.opts || {}, { restart: true }));
  }

  // ------------------------------------------------------------ 播放

  function play(name, opts) {
    const o = opts || {};
    const def = getTrack(name);
    if (!def) {
      warnOnce("track:" + name, "未注册曲目：" + name);
      return false;
    }

    ensureChannels();
    const fade = o.fade == null ? DEFAULT_FADE : clamp(o.fade, 0, 10);

    if (currentName === name && active && !active.el.paused && !o.restart) return true;
    if (currentName === name && active && active.el.paused && !o.restart) {
      resume();
      return true;
    }

    const old = active;
    const next = old ? (channels[0] === old ? channels[1] : channels[0]) : channels[0];

    for (let i = 0; i < channels.length; i++) {
      if (channels[i] !== next) fadeOutChannel(channels[i], fade);
    }
    if (old === next) {
      stopTween(next);
      next.el.pause();
    }

    active = next;
    currentName = name;
    pausedName = null;

    const ok = begin(name, o, next, fade);
    armUnlock();
    emit();
    return ok;
  }

  function crossfade(name, seconds) {
    return play(name, { fade: seconds });
  }

  function stop(opts) {
    const o = typeof opts === "number" ? { fade: opts } : (opts || {});
    const ms = o.fade == null ? DEFAULT_STOP : clamp(o.fade, 0, 10);
    ensureChannels();
    pending = null;
    currentName = null;
    pausedName = null;
    for (let i = 0; i < channels.length; i++) fadeOutChannel(channels[i], ms);
    active = null;
    emit();
  }

  function pause() {
    ensureChannels();
    pausedName = currentName;
    pending = null;
    for (let i = 0; i < channels.length; i++) {
      if (!channels[i].el.paused) channels[i].el.pause();
    }
    emit();
  }

  function resume() {
    ensureChannels();
    if (active && active.el.paused && currentName) {
      const name = currentName;
      let promise = null;
      let blocked = false;
      try {
        promise = active.el.play();
      } catch (err) {
        blocked = true;
        if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
          pending = { name: name, opts: { fade: 0 } };
          armUnlock(true);
        } else {
          warnOnce("play:" + name, "恢复播放失败：" + name, err);
        }
      }
      if (promise && typeof promise.then === "function") {
        promise.then(markUnlocked).catch(function (err) {
          if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
            pending = { name: name, opts: { fade: 0 } };
            armUnlock(true);
          } else {
            warnOnce("play:" + name, "恢复播放失败：" + name, err);
          }
        });
      } else if (!blocked) {
        markUnlocked();
      }
      pausedName = null;
      emit();
      return true;
    }
    if (pausedName) {
      const name = pausedName;
      pausedName = null;
      return play(name, { fade: 0.25, restart: true });
    }
    return false;
  }

  function duck(amount, ms) {
    const to = clamp(amount == null ? 0.55 : amount, 0, 1);
    const dur = ms == null ? 350 : clamp(ms, 0, 10000);
    tween("duck", duckLevel, to, dur, function (v) {
      duckLevel = v;
      applyAll();
    });
  }

  function unduck(ms) {
    duck(1, ms == null ? 600 : ms);
  }

  // ------------------------------------------------------------ 预加载 / 配置

  function preload(names) {
    const list = names == null ? Object.keys(TRACKS) : (Array.isArray(names) ? names : [names]);
    for (let i = 0; i < list.length; i++) {
      const def = getTrack(list[i]);
      if (!def) continue;
      const url = trackUrl(def);
      if (preloaders[url]) continue;
      const el = newAudio();
      el.preload = "auto";
      el.src = url;
      try { el.load(); } catch (e) { /* 不支持时等 play 再加载 */ }
      preloaders[url] = el;
    }
    return list.length;
  }

  function register(name, def) {
    if (!name) return;
    if (typeof def === "string") TRACKS[name] = { file: def };
    else if (def && typeof def === "object") TRACKS[name] = Object.assign({}, def);
  }

  function configure(opts) {
    if (!opts) return;
    if (opts.base) {
      try {
        const u = new URL(opts.base, rootUrl);
        baseUrl = /\/$/.test(u.href) ? u.href : u.href + "/";
      } catch (e) {
        warnOnce("base:" + opts.base, "无效的 BGM 路径：" + opts.base, e);
      }
    }
    if (opts.tracks) {
      Object.keys(opts.tracks).forEach(function (name) {
        register(name, opts.tracks[name]);
      });
    }
    if (opts.volume != null) setVolume(opts.volume);
    if (opts.muted != null) setMuted(opts.muted);
  }

  // ------------------------------------------------------------ 查询

  function state() {
    return {
      track: currentName,
      paused: !!(active && active.el.paused),
      volume: master,
      muted: muted,
      duck: duckLevel,
      unlocked: unlocked,
      pending: pending ? pending.name : null
    };
  }

  function on(fn) {
    if (typeof fn !== "function") return function () {};
    listeners.push(fn);
    return function () {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  const BGM = {
    play: play,
    crossfade: crossfade,
    stop: stop,
    pause: pause,
    resume: resume,
    unlock: unlock,
    duck: duck,
    unduck: unduck,
    setVolume: setVolume,
    getVolume: function () { return master; },
    setMuted: setMuted,
    toggleMuted: function () { return setMuted(!muted); },
    isMuted: function () { return muted; },
    isPlaying: function () { return !!(active && !active.el.paused); },
    current: function () { return currentName; },
    preload: preload,
    configure: configure,
    register: register,
    state: state,
    on: on,
    trackUrl: function (name) {
      const def = getTrack(name);
      return def ? trackUrl(def) : null;
    },
    base: function () { return baseUrl; },
    TRACKS: TRACKS
  };

  global.BGM = BGM;
})(window);

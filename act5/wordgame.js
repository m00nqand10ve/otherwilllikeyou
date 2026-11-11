/* G03《课间猜人物》— 三人轮流猜动漫 / 游戏 / 电影里的角色
 *
 * 剪影只画「人形轮廓 + 一件标志性道具」，不重绘原作形象、不画脸；名字照写，属于同人引用。
 * 老 9 题保留 assets/silhouettes/ 的 PNG（生成脚本 tools/make-silhouettes.py），新题不再配图：
 * WGMask 用 Canvas 路径按 fig 数据画剪影，再叠一层随线索推进逐级揭开的马赛克蒙版。
 * 加一题只改 QUESTIONS 里的一条数据，零素材文件。
 *
 * 六回合由「游玩次」做种子，从 18 题里按类别各抽 2 道。每题 3 条线索分
 * look / story / quote 三类，首条固定展示，之后两条由玩家点选想先听哪类。
 * 每条线索展示后开 2.2 秒抢答窗：窗内答对得满分；窗过之后她俩按已展示的线索
 * 依次报出猜测（猜错，被主持人纠正），玩家再答得半分。分数只影响结束措辞。
 *
 * 六题之后「换你出题」做两轮：第二轮她们会排除第一轮猜错过的词，玩家挑的误导线索
 * 只能让她们犹豫半拍——台词里会明说「上一轮就栽在这儿」。
 * 不给分、不计时、不改结局。
 */
(function (global) {
  "use strict";

  const D = global.DAILY;
  D.games = D.games || {};

  // ================================================================
  // 5.1 WGMask：程序化剪影 + 马赛克蒙版（不新增任何图片素材）
  //
  //   WGMask.render(canvas, q, reveal)  把一道题画到 canvas 上，并按 reveal 上蒙版
  //   WGMask.prepare(q)                 老题先把 PNG 加载到 #wgSil 里（中转，不显示）
  //   WGMask.animate(canvas, q, a, b, ms)  200ms 把格长从 a 插值到 b
  //   WGMask.clear(canvas) / stop(canvas)  收题时清空 / 停下动画
  //   WGMask.cellFor(reveal)            已展示线索数 → 马赛克格长（1→16 2→10 3→5 4→0）
  //
  // 剪影统一用 96×96 的归一化坐标手写：体型 4 种（stand / sit / cape / chibi），
  // 道具 20 件（全是 Canvas 路径，不是图片）。单色 tint 填充即剪影。
  // 马赛克每格的取样偏移由题 id 的哈希做种子，同一道题每次渲染像素完全一致，
  // 自检才敢比较像素哈希。
  // ================================================================

  const MASK_SIZE = 96;

  const WGMask = (function () {
    // ---- 像素风小工具：全部用整数矩形 / 折线拼，和现有 9 张像素剪影同一路数 ----
    function box(ctx, x, y, w, h) { ctx.rect(x, y, w, h); }
    function poly(ctx, pts) {
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.closePath();
    }

    // ---- 体型：人形轮廓（不画脸）----
    const BODIES = {
      stand: function (ctx) {
        box(ctx, 40, 10, 16, 6);      // 头顶削角
        box(ctx, 36, 14, 24, 20);     // 头
        box(ctx, 40, 34, 16, 6);      // 下巴
        box(ctx, 44, 38, 8, 6);       // 脖子
        box(ctx, 32, 42, 32, 10);     // 肩
        box(ctx, 34, 50, 28, 22);     // 身
        box(ctx, 28, 44, 6, 24);      // 左臂
        box(ctx, 62, 44, 6, 24);      // 右臂
        box(ctx, 38, 72, 8, 20);      // 左腿
        box(ctx, 50, 72, 8, 20);      // 右腿
        box(ctx, 35, 90, 12, 4);      // 左脚
        box(ctx, 49, 90, 12, 4);      // 右脚
      },
      sit: function (ctx) {
        box(ctx, 40, 14, 16, 6);
        box(ctx, 36, 18, 24, 20);
        box(ctx, 40, 38, 16, 6);
        box(ctx, 42, 42, 12, 6);
        box(ctx, 34, 46, 30, 14);     // 上身
        box(ctx, 54, 56, 26, 12);     // 大腿伸出去
        box(ctx, 68, 66, 12, 24);     // 小腿
        box(ctx, 28, 48, 6, 20);      // 手臂
        box(ctx, 32, 58, 24, 10);     // 另一条腿/膝
        box(ctx, 28, 86, 30, 4);      // 坐着的底
      },
      cape: function (ctx) {
        box(ctx, 40, 8, 16, 6);
        box(ctx, 36, 12, 24, 20);
        box(ctx, 40, 32, 16, 6);
        box(ctx, 42, 38, 12, 6);
        box(ctx, 30, 42, 36, 8);      // 披风
        box(ctx, 26, 50, 44, 10);
        box(ctx, 22, 60, 52, 16);
        box(ctx, 26, 76, 44, 8);
        box(ctx, 38, 84, 8, 10);      // 下摆外露的腿
        box(ctx, 50, 84, 8, 10);
        box(ctx, 35, 92, 12, 3);
        box(ctx, 49, 92, 12, 3);
      },
      chibi: function (ctx) {
        box(ctx, 38, 10, 20, 6);
        box(ctx, 32, 16, 32, 22);     // 大头
        box(ctx, 38, 38, 20, 6);
        box(ctx, 42, 42, 12, 4);
        box(ctx, 38, 46, 20, 22);     // 小身子
        box(ctx, 32, 48, 6, 16);
        box(ctx, 58, 48, 6, 16);
        box(ctx, 40, 68, 8, 20);
        box(ctx, 50, 68, 8, 20);
        box(ctx, 37, 88, 12, 4);
        box(ctx, 49, 88, 12, 4);
      }
    };

    // ---- 道具表：20 件校园题材够用的标志物，全部是代码路径 ----
    // 键名只给数据用；形状都刻意伸出人形轮廓之外，单色填充时才看得出是「多了一件东西」。
    const PROPS = {
      hat_straw: function (ctx) {            // 草帽
        box(ctx, 50, 2, 14, 6);
        box(ctx, 44, 8, 26, 6);
        box(ctx, 20, 14, 58, 6);
        box(ctx, 26, 20, 46, 4);
      },
      headband: function (ctx) {             // 护额
        box(ctx, 32, 16, 32, 6);
        poly(ctx, [24, 14, 34, 16, 34, 24, 22, 22]);
        poly(ctx, [62, 16, 72, 14, 74, 22, 62, 24]);
      },
      cat_ears: function (ctx) {             // 猫耳
        poly(ctx, [36, 16, 34, 2, 48, 12]);
        poly(ctx, [48, 12, 62, 2, 60, 16]);
      },
      glasses: function (ctx) {              // 眼镜
        box(ctx, 20, 18, 18, 8);
        box(ctx, 58, 18, 18, 8);
        box(ctx, 38, 20, 20, 3);
      },
      necktie: function (ctx) {              // 领结
        poly(ctx, [44, 40, 26, 34, 26, 46, 44, 44]);
        poly(ctx, [52, 40, 70, 34, 70, 46, 52, 44]);
        box(ctx, 43, 39, 10, 8);
      },
      sword: function (ctx) {                // 剑
        poly(ctx, [60, 82, 68, 88, 92, 28, 85, 24]);   // 刃
        poly(ctx, [92, 28, 94, 16, 85, 24]);           // 尖
        poly(ctx, [52, 86, 64, 96, 70, 88, 58, 82]);   // 护手 + 柄
      },
      staff: function (ctx) {                // 法杖
        box(ctx, 72, 22, 4, 70);
        box(ctx, 66, 10, 16, 12);
        box(ctx, 62, 6, 24, 4);
      },
      shield: function (ctx) {               // 盾
        poly(ctx, [8, 42, 30, 38, 32, 62, 18, 78, 6, 58]);
        box(ctx, 17, 48, 4, 16);
      },
      crown: function (ctx) {                // 皇冠
        poly(ctx, [34, 16, 34, 2, 42, 9, 48, 0, 54, 9, 62, 2, 62, 16]);
      },
      cap: function (ctx) {                  // 棒球帽
        box(ctx, 34, 4, 28, 12);
        box(ctx, 30, 14, 44, 4);
        box(ctx, 58, 12, 8, 4);
        box(ctx, 62, 8, 10, 4);
      },
      headphones: function (ctx) {           // 耳机
        box(ctx, 38, 2, 20, 4);
        box(ctx, 32, 6, 6, 8);
        box(ctx, 58, 6, 6, 8);
        box(ctx, 24, 16, 10, 20);
        box(ctx, 62, 16, 10, 20);
      },
      microphone: function (ctx) {           // 话筒
        box(ctx, 70, 40, 4, 28);
        box(ctx, 62, 26, 18, 14);
        box(ctx, 68, 22, 10, 4);
      },
      backpack: function (ctx) {             // 书包
        box(ctx, 12, 42, 16, 32);
        box(ctx, 10, 48, 4, 20);
        box(ctx, 26, 44, 8, 4);
      },
      umbrella: function (ctx) {             // 雨伞
        poly(ctx, [12, 18, 22, 8, 38, 2, 58, 2, 74, 8, 84, 18, 48, 12]);
        box(ctx, 60, 14, 4, 58);
        box(ctx, 64, 66, 10, 4);
        box(ctx, 68, 60, 4, 10);
      },
      broom: function (ctx) {                // 扫帚
        poly(ctx, [60, 10, 66, 14, 40, 80, 34, 76]);
        poly(ctx, [24, 76, 42, 70, 46, 94, 20, 94]);
      },
      football: function (ctx) {             // 足球
        box(ctx, 62, 80, 18, 10);
        box(ctx, 66, 74, 10, 20);
      },
      guitar: function (ctx) {               // 吉他
        box(ctx, 56, 56, 30, 26);             // 琴箱
        box(ctx, 60, 48, 22, 8);
        poly(ctx, [78, 48, 82, 48, 94, 8, 90, 6]);   // 琴颈
        box(ctx, 84, 2, 12, 8);               // 琴头
      },
      camera: function (ctx) {               // 相机
        box(ctx, 58, 46, 24, 16);
        box(ctx, 66, 42, 8, 4);
        box(ctx, 82, 50, 6, 8);
      },
      fan: function (ctx) {                  // 扇子
        poly(ctx, [30, 38, 24, 62, 10, 72, 4, 58, 16, 40]);
        box(ctx, 28, 60, 4, 20);
      },
      key: function (ctx) {                  // 钥匙
        box(ctx, 66, 14, 14, 14);
        box(ctx, 70, 18, 6, 6);
        box(ctx, 78, 20, 18, 4);
        box(ctx, 84, 24, 4, 8);
        box(ctx, 92, 20, 4, 12);
      }
    };

    // 蒙版：reveal = 已展示线索数（可带小数，用于 200ms 插值）；4 = 公布答案
    function cellFor(reveal) {
      const r = Number(reveal);
      if (!(r > 0)) return 16;
      if (r >= 4) return 0;
      if (r >= 3) return Math.round(5 * (4 - r));
      if (r >= 2) return Math.round(10 + (5 - 10) * (r - 2));
      return Math.round(16 + (10 - 16) * Math.max(0, r - 1));
    }

    // 题 id → 种子（FNV-1a 32 位）。同一道题的马赛克永远一样。
    function seedOf(id) {
      const s = String(id == null ? "" : id);
      let h = 2166136261 >>> 0;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
      return h >>> 0;
    }

    function makeRnd(seed) {
      let s = (seed >>> 0) || 1;
      return function () {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
      };
    }

    const cache = Object.create(null);       // PNG 中转：q.sil → <img>
    // 两块离屏画布分开用：
    //   矢量题只走路径，永远不碰 file:// 图片，所以它的画布不会被打上「跨源脏画布」，
    //   自检才能读像素做哈希；PNG 题那块被污染也没关系——我们只往里画、只往外 drawImage，
    //   从不读它的像素（file:// 下 getImageData 会直接抛 SecurityError）。
    let scratchVec = null, scratchVecCtx = null;
    let scratchImg = null, scratchImgCtx = null;
    let tween = { raf: 0, timer: 0 };

    function getScratch(size, fromImage) {
      if (fromImage) {
        if (!scratchImg || scratchImg.width !== size) {
          scratchImg = document.createElement("canvas");
          scratchImg.width = size;
          scratchImg.height = size;
          scratchImgCtx = scratchImg.getContext("2d");
        }
        return { canvas: scratchImg, ctx: scratchImgCtx };
      }
      if (!scratchVec || scratchVec.width !== size) {
        scratchVec = document.createElement("canvas");
        scratchVec.width = size;
        scratchVec.height = size;
        scratchVecCtx = scratchVec.getContext("2d");
      }
      return { canvas: scratchVec, ctx: scratchVecCtx };
    }

    /** 老题：把 PNG 加载到面板里的 #wgSil（只做加载中转，不显示）。
     *  中转元素只有一个，重玩时可能还停在上一条剪影上，所以每次都要核对 src，
     *  否则 drawImage 会把上一题的图当成这一题画出来。 */
    function prepare(q) {
      return new Promise(function (resolve) {
        if (!q || !q.sil) { resolve(false); return; }
        const img = document.getElementById("wgSil");
        if (!img) { resolve(false); return; }
        if (cache[q.sil] && img.getAttribute("src") === q.sil &&
            img.complete && img.naturalWidth) {
          resolve(true);
          return;
        }
        let settled = false;
        const done = function (okFlag) {
          if (settled) return;
          settled = true;
          img.onload = null;
          img.onerror = null;
          if (okFlag) cache[q.sil] = img;
          resolve(!!okFlag);
        };
        img.onload = function () { done(true); };
        img.onerror = function () { done(false); };
        img.src = q.sil;
        if (img.complete && img.naturalWidth) done(true);
      });
    }

    function drawFig(ctx, fig, size) {
      const k = size / MASK_SIZE;
      ctx.save();
      ctx.scale(k, k);
      ctx.fillStyle = fig.tint || "#20242c";
      if (fig.flip) {
        ctx.translate(MASK_SIZE, 0);
        ctx.scale(-1, 1);
      }
      const body = BODIES[fig.body] || BODIES.stand;
      ctx.beginPath();
      body(ctx);
      ctx.fill();
      (fig.props || []).forEach(function (name) {
        const fn = PROPS[name];
        if (!fn) return;
        ctx.beginPath();
        fn(ctx);
        ctx.fill();
      });
      ctx.restore();
    }

    /** 蒙版这一层：整块 canvas 上盖马赛克，每格取样偏移由题 id 的种子决定。
     *  用 drawImage 做「1 像素 → 格长」的取样：file:// 下 PNG 画到 canvas 上会被
     *  标成跨源脏画布，getImageData / putImageData 一律抛异常，drawImage 不受影响。 */
    function applyMask(ctx, src, size, cell, seed) {
      const oldSmooth = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      if (cell <= 0) {
        ctx.drawImage(src, 0, 0);
        ctx.imageSmoothingEnabled = oldSmooth;
        return;
      }
      const rnd = makeRnd(seed ^ 0x5f356495);
      for (let y = 0; y < size; y += cell) {
        for (let x = 0; x < size; x += cell) {
          const w = Math.min(cell, size - x);
          const h = Math.min(cell, size - y);
          const ox = x + Math.floor(rnd() * w);
          const oy = y + Math.floor(rnd() * h);
          ctx.drawImage(src, ox, oy, 1, 1, x, y, w, h);
        }
      }
      ctx.imageSmoothingEnabled = oldSmooth;
    }

    /** 画一道题：老题画 PNG，新题按 fig 画路径；然后上蒙版。 */
    function render(canvas, q, reveal) {
      if (!canvas || !q) return false;
      const size = canvas.width || MASK_SIZE;
      const scratch = getScratch(size, !!q.sil);
      const sctx = scratch.ctx;
      sctx.clearRect(0, 0, size, size);
      let drew = false;
      if (q.sil) {
        const img = cache[q.sil];
        if (img && img.naturalWidth) {
          sctx.drawImage(img, 0, 0, size, size);
          drew = true;
        }
      } else if (q.fig) {
        drawFig(sctx, q.fig, size);
        drew = true;
      }
      if (!drew) return false;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, size, size);
      applyMask(ctx, scratch.canvas, size, cellFor(reveal), seedOf(q.id));
      return true;
    }

    function stop() {
      if (tween.raf) cancelAnimationFrame(tween.raf);
      if (tween.timer) clearTimeout(tween.timer);
      tween.raf = 0;
      tween.timer = 0;
    }

    /** 200ms 内把格长从 a 插值到 b（只换格长，不做逐帧粒子）。 */
    function animate(canvas, q, from, to, ms) {
      stop();
      if (!canvas || !q) return;
      const dur = ms || 200;
      let t0 = null;
      const finish = function () {
        stop();
        render(canvas, q, to);
      };
      const step = function (now) {
        if (t0 == null) t0 = now;
        const t = Math.min(1, (now - t0) / dur);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        render(canvas, q, from + (to - from) * e);
        if (t < 1) tween.raf = requestAnimationFrame(step);
        else finish();
      };
      tween.raf = requestAnimationFrame(step);
      // rAF 在后台标签页可能不走，兜底确保最终一定落到目标格长
      tween.timer = setTimeout(finish, dur + 120);
    }

    function clear(canvas) {
      stop();
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    /** 像素哈希：自检用来证明「同一道题每次渲染完全一致」。
     *  只对纯矢量（fig）画布有效；掺了 file:// PNG 的画布是被浏览器标脏的，
     *  读像素会抛 SecurityError，这里返回 0 而不是把调用方带崩。 */
    function pixelHash(canvas) {
      if (!canvas) return 0;
      let d;
      try {
        d = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      } catch (e) {
        return 0;
      }
      let h = 2166136261 >>> 0;
      for (let i = 0; i < d.length; i++) {
        h ^= d[i];
        h = Math.imul(h, 16777619) >>> 0;
      }
      return h >>> 0;
    }

    return {
      SIZE: MASK_SIZE,
      PROPS: PROPS,
      BODIES: BODIES,
      render: render,
      prepare: prepare,
      animate: animate,
      clear: clear,
      stop: stop,
      cellFor: cellFor,
      seedOf: seedOf,
      pixelHash: pixelHash,
      applyMask: applyMask
    };
  })();

  // ================================================================
  // 题库：18 题，动漫 / 游戏 / 电影各 6 道。
  // 老 9 题保留 sil（PNG）；新 9 题只写 fig，零素材。
  // clues 每条带 k：look 外形 / story 经历 / quote 台词。
  // npcByClue 可选：抢答窗过后，她俩按某一类线索往哪个方向猜。
  // ================================================================

  const QUESTIONS = [
    {
      id: "luffy",
      cat: "anime",
      sil: "../assets/silhouettes/silhouette_anime_01.png",
      host: "friend",
      answer: "路飞",
      aliases: ["蒙奇D路飞", "草帽路飞"],
      clues: [
        { k: "look", t: "帽子是草编的，帽檐很宽。" },
        { k: "look", t: "胳膊能伸得特别长。" },
        { k: "quote", t: "他说要找到一个大宝藏。" }
      ],
      options: ["路飞", "鸣人", "黑崎一护", "坂田银时"],
      hostLines: ["换点不一样的。猜人。", "第一题，动漫里的。"],
      npc: { who: "girl", right: false, text: "鸣人？" },
      banter: { who: "friend", text: "人家戴的是护额，不是草帽。" }
    },
    {
      id: "naruto",
      cat: "anime",
      sil: "../assets/silhouettes/silhouette_anime_02.png",
      host: "girl",
      answer: "鸣人",
      aliases: ["漩涡鸣人", "鸣人君"],
      clues: [
        { k: "look", t: "脸上有几道像胡须的纹。" },
        { k: "look", t: "头上绑着一块铁牌。" },
        { k: "quote", t: "他总说要当上火影。" }
      ],
      options: ["黑崎一护", "鸣人", "沢田纲吉", "日向翔阳"],
      hostLines: ["换我出。这个你们肯定认识。", "……我描述得可能不太准。"],
      npc: { who: "friend", right: false, text: "黑崎一护？" },
      banter: { who: "girl", text: "人家拿的是斩魄刀，不是苦无。" }
    },
    {
      id: "doraemon",
      cat: "anime",
      sil: "../assets/silhouettes/silhouette_anime_03.png",
      host: "friend",
      answer: "哆啦A梦",
      aliases: ["哆啦a梦", "机器猫", "叮当猫"],
      clues: [
        { k: "look", t: "他没有耳朵。" },
        { k: "look", t: "肚子上有个口袋，能掏出东西。" },
        { k: "story", t: "他怕老鼠。" }
      ],
      options: ["龙猫", "皮卡丘", "哆啦A梦", "蜡笔小新"],
      hostLines: ["再来一个，小时候都看过。", "这个应该最好猜。"],
      npc: { who: "girl", right: false, text: "龙猫？" },
      banter: { who: "friend", text: "龙猫有耳朵，还很大。" }
    },
    {
      id: "conan",
      cat: "anime",
      fig: { body: "chibi", props: ["glasses", "necktie"], flip: false, tint: "#20242c" },
      host: "girl",
      answer: "江户川柯南",
      aliases: ["柯南", "工藤新一"],
      clues: [
        { k: "look", t: "鼻梁上架着一副圆框眼镜，领口打了个结。" },
        { k: "story", t: "身体缩成了小学生的样子，脑子还是高中生。" },
        { k: "quote", t: "他常说「真相只有一个」。" }
      ],
      options: ["工藤新一", "服部平次", "江户川柯南", "怪盗基德"],
      hostLines: ["换我出。这个你们肯定听过。", "提示：他不是普通小学生。"],
      npc: { who: "friend", right: false, text: "工藤新一？" },
      banter: { who: "girl", text: "工藤新一就是他本人，不算猜对。" },
      npcByClue: {
        story: { who: "friend", right: false, text: "灰原哀？" },
        quote: { who: "friend", right: false, text: "怪盗基德？" }
      }
    },
    {
      id: "ichigo",
      cat: "anime",
      fig: { body: "stand", props: ["sword"], flip: true, tint: "#20242c" },
      host: "friend",
      answer: "黑崎一护",
      aliases: ["一护", "黑崎"],
      clues: [
        { k: "look", t: "一头橘色的短发，肩上扛着一把大刀。" },
        { k: "story", t: "他本来是普通高中生，后来成了死神代理。" },
        { k: "quote", t: "他说过「我要保护所有人」。" }
      ],
      options: ["绯村剑心", "黑崎一护", "朽木白哉", "宇智波佐助"],
      hostLines: ["动漫的最后一个。这个有点帅。", "……我是说刀。"],
      npc: { who: "girl", right: false, text: "绯村剑心？" },
      banter: { who: "friend", text: "剑心用的是逆刃刀，没这么长。" },
      npcByClue: {
        story: { who: "girl", right: false, text: "朽木白哉？" },
        quote: { who: "girl", right: false, text: "宇智波佐助？" }
      }
    },
    {
      id: "bocchi",
      cat: "anime",
      fig: { body: "sit", props: ["headphones", "guitar"], flip: false, tint: "#20242c" },
      host: "girl",
      answer: "后藤一里",
      aliases: ["波奇", "波奇酱", "后藤独"],
      clues: [
        { k: "look", t: "粉色长发，头上扣着一副耳机。" },
        { k: "story", t: "她一个人躲在家里练吉他，想组一支乐队。" },
        { k: "quote", t: "她小声说过「我、我也可以上台吗」。" }
      ],
      options: ["平泽唯", "后藤一里", "喜多郁代", "凉宫春日"],
      hostLines: ["这个是我自己很喜欢的。", "……可能有点冷门。"],
      npc: { who: "friend", right: false, text: "平泽唯？" },
      banter: { who: "girl", text: "唯弹吉他可没躲在壁橱里。" },
      npcByClue: {
        story: { who: "friend", right: false, text: "喜多郁代？" },
        quote: { who: "friend", right: false, text: "凉宫春日？" }
      }
    },
    {
      id: "mario",
      cat: "game",
      sil: "../assets/silhouettes/silhouette_game_01.png",
      host: "girl",
      answer: "马里奥",
      aliases: ["超级马里奥", "马力欧", "mario"],
      clues: [
        { k: "look", t: "戴红帽子，留胡子。" },
        { k: "look", t: "从水管里钻出来。" },
        { k: "story", t: "踩扁蘑菇，去救公主。" }
      ],
      options: ["索尼克", "林克", "吃豆人", "马里奥"],
      hostLines: ["换个游戏的。和臣应该会。", "我不太玩，听你们说过。"],
      npc: { who: "friend", right: false, text: "索尼克？" },
      banter: { who: "girl", text: "索尼克跑得比他快。" }
    },
    {
      id: "link",
      cat: "game",
      sil: "../assets/silhouettes/silhouette_game_02.png",
      host: "friend",
      answer: "林克",
      aliases: ["塞尔达", "link"],
      clues: [
        { k: "look", t: "一身绿衣服，帽子是尖的。" },
        { k: "look", t: "背后背着剑和盾。" },
        { k: "story", t: "他进别人家会摔罐子。" }
      ],
      options: ["林克", "克劳德", "但丁", "马里奥"],
      hostLines: ["这个有点难。", "提示可以问我要。"],
      npc: { who: "girl", right: false, text: "克劳德？" },
      banter: { who: "friend", text: "克劳德的头发比他长多了。" }
    },
    {
      id: "pikachu",
      cat: "game",
      sil: "../assets/silhouettes/silhouette_game_03.png",
      host: "girl",
      answer: "皮卡丘",
      aliases: ["皮卡丘", "pikachu"],
      clues: [
        { k: "look", t: "黄色的，尾巴像一道闪电。" },
        { k: "look", t: "会放电。" },
        { k: "story", t: "他最好的朋友是个训练家。" }
      ],
      options: ["伊布", "皮卡丘", "杰尼龟", "小火龙"],
      hostLines: ["最后一个游戏的。", "这个连我都知道。"],
      npc: { who: "friend", right: false, text: "伊布？" },
      banter: { who: "girl", text: "伊布的尾巴是毛的。" }
    },
    {
      id: "cloud",
      cat: "game",
      fig: { body: "stand", props: ["sword"], flip: false, tint: "#20242c" },
      host: "friend",
      answer: "克劳德",
      aliases: ["克劳德·斯特莱夫", "cloud"],
      clues: [
        { k: "look", t: "金色的尖刺头发，背着一把比人还宽的巨剑。" },
        { k: "story", t: "他当过神罗的特种兵，后来跟着伙伴满世界跑。" },
        { k: "quote", t: "他偶尔会说一句「我没兴趣」。" }
      ],
      options: ["克劳德", "萨菲罗斯", "斯考尔", "但丁"],
      hostLines: ["换个游戏。这个剑比人还大。", "我不太玩，听和臣提过。"],
      npc: { who: "girl", right: false, text: "萨菲罗斯？" },
      banter: { who: "friend", text: "萨菲罗斯的头发散着，不是尖的。" },
      npcByClue: {
        look: { who: "girl", right: false, text: "萨菲罗斯？" },
        story: { who: "girl", right: false, text: "斯考尔？" }
      }
    },
    {
      id: "miku",
      cat: "game",
      fig: { body: "stand", props: ["headphones"], flip: false, tint: "#20242c" },
      host: "girl",
      answer: "初音未来",
      aliases: ["初音", "miku"],
      clues: [
        { k: "look", t: "两边扎着很长的马尾，耳边挂着耳机。" },
        { k: "story", t: "她只活在屏幕和舞台上，演唱会却坐满了人。" },
        { k: "quote", t: "她的歌里唱「世界第一的公主殿下」。" }
      ],
      options: ["镜音铃", "巡音流歌", "初音未来", "洛天依"],
      hostLines: ["这个算游戏里的吧……算。", "她的歌我听过。"],
      npc: { who: "friend", right: false, text: "洛天依？" },
      banter: { who: "girl", text: "洛天依是中国的，这个不是。" },
      npcByClue: {
        story: { who: "friend", right: false, text: "镜音铃？" },
        quote: { who: "friend", right: false, text: "巡音流歌？" }
      }
    },
    {
      id: "steve",
      cat: "game",
      fig: { body: "stand", props: ["sword", "shield"], flip: false, tint: "#20242c" },
      host: "friend",
      answer: "史蒂夫",
      aliases: ["steve", "我的世界史蒂夫"],
      clues: [
        { k: "look", t: "一身方方正正的蓝衣服，一手剑一手盾。" },
        { k: "story", t: "他的世界全是方块，白天挖矿，晚上躲僵尸。" },
        { k: "quote", t: "他从来不说话，最多「嗯」一声。" }
      ],
      options: ["史蒂夫", "艾利克斯", "苦力怕", "林克"],
      hostLines: ["最后一个游戏的。这个我知道。", "班里有人天天玩。"],
      npc: { who: "girl", right: false, text: "苦力怕？" },
      banter: { who: "friend", text: "苦力怕不会拿剑。" },
      npcByClue: {
        look: { who: "girl", right: false, text: "苦力怕？" },
        story: { who: "girl", right: false, text: "艾利克斯？" }
      }
    },
    {
      id: "vader",
      cat: "movie",
      sil: "../assets/silhouettes/silhouette_movie_01.png",
      host: "friend",
      answer: "达斯·维达",
      aliases: ["达斯维达", "黑武士", "维达"],
      clues: [
        { k: "look", t: "黑色头盔，披着斗篷。" },
        { k: "look", t: "呼吸声很重。" },
        { k: "quote", t: "他说「我是你父亲」。" }
      ],
      options: ["蝙蝠侠", "钢铁侠", "达斯·维达", "万磁王"],
      hostLines: ["换电影。这个有点年头了。", "和臣应该看过。"],
      npc: { who: "girl", right: false, text: "蝙蝠侠？" },
      banter: { who: "friend", text: "蝙蝠侠不这么喘气。" }
    },
    {
      id: "jack",
      cat: "movie",
      sil: "../assets/silhouettes/silhouette_movie_02.png",
      host: "girl",
      answer: "杰克·斯派洛",
      aliases: ["杰克船长", "杰克", "斯派洛"],
      clues: [
        { k: "look", t: "戴三角帽，头发很长。" },
        { k: "look", t: "走路摇摇晃晃。" },
        { k: "story", t: "他总在找朗姆酒和船。" }
      ],
      options: ["印第安纳·琼斯", "阿拉贡", "尼奥", "杰克·斯派洛"],
      hostLines: ["这个我熟。", "……他走路的样子很好认。"],
      npc: { who: "friend", right: false, text: "阿拉贡？" },
      banter: { who: "girl", text: "阿拉贡不喝朗姆酒。" }
    },
    {
      id: "harry",
      cat: "movie",
      sil: "../assets/silhouettes/silhouette_movie_03.png",
      host: "friend",
      answer: "哈利·波特",
      aliases: ["哈利波特", "哈利"],
      clues: [
        { k: "look", t: "圆眼镜，额头有一道闪电形的疤。" },
        { k: "look", t: "手里拿着一根魔杖。" },
        { k: "story", t: "他在九又四分之三站台上车。" }
      ],
      options: ["哈利·波特", "罗恩", "佛罗多", "彼得·帕克"],
      hostLines: ["最后一题，电影。", "这个太出名了，送分。"],
      npc: { who: "girl", right: false, text: "罗恩？" },
      banter: { who: "friend", text: "罗恩没那道疤。" }
    },
    {
      id: "gandalf",
      cat: "movie",
      fig: { body: "cape", props: ["staff"], flip: false, tint: "#20242c" },
      host: "girl",
      answer: "甘道夫",
      aliases: ["灰袍甘道夫", "gandalf"],
      clues: [
        { k: "look", t: "长长的白胡子，灰袍子，手里拄着一根法杖。" },
        { k: "story", t: "他是个到处旅行的巫师，总在要紧关头出现。" },
        { k: "quote", t: "他在桥上说过「你不能过去」。" }
      ],
      options: ["邓布利多", "甘道夫", "萨鲁曼", "梅林"],
      hostLines: ["换电影。这个有点老了。", "我也只看过一遍。"],
      npc: { who: "friend", right: false, text: "邓布利多？" },
      banter: { who: "girl", text: "邓布利多的胡子是白的，但法杖不是这样拿的。" },
      npcByClue: {
        story: { who: "friend", right: false, text: "梅林？" },
        quote: { who: "friend", right: false, text: "萨鲁曼？" }
      }
    },
    {
      id: "elsa",
      cat: "movie",
      fig: { body: "cape", props: ["crown"], flip: true, tint: "#20242c" },
      host: "friend",
      answer: "艾莎",
      aliases: ["艾莎公主", "elsa"],
      clues: [
        { k: "look", t: "盘着长辫子，头上戴着一顶小皇冠，披着长披风。" },
        { k: "story", t: "她天生能把东西冻成冰，后来当上了女王。" },
        { k: "quote", t: "她唱「随它吧，随它吧」。" }
      ],
      options: ["艾莎", "安娜", "白雪公主", "莫阿娜"],
      hostLines: ["这个应该都听过。", "小时候听过好多遍。"],
      npc: { who: "girl", right: false, text: "安娜？" },
      banter: { who: "friend", text: "安娜没有冰魔法。" },
      npcByClue: {
        look: { who: "girl", right: false, text: "白雪公主？" },
        story: { who: "girl", right: false, text: "莫阿娜？" }
      }
    },
    {
      id: "totoro",
      cat: "movie",
      fig: { body: "chibi", props: ["umbrella"], flip: false, tint: "#20242c" },
      host: "girl",
      answer: "龙猫",
      aliases: ["多多洛", "totoro"],
      clues: [
        { k: "look", t: "圆滚滚的一大团，肚子上一道道灰纹。" },
        { k: "story", t: "它住在森林里，只有小孩能看见它。" },
        { k: "quote", t: "它不太说话，只在雨里吼过一声。" }
      ],
      options: ["龙猫", "皮卡丘", "小熊维尼", "史迪奇"],
      hostLines: ["最后一题，电影。", "这个……算电影吧。"],
      npc: { who: "friend", right: false, text: "皮卡丘？" },
      banter: { who: "girl", text: "皮卡丘是黄的，这个是灰的。" },
      npcByClue: {
        look: { who: "friend", right: false, text: "小熊维尼？" },
        story: { who: "friend", right: false, text: "史迪奇？" }
      }
    }
  ];

  const CAT = { anime: "动漫", game: "游戏", movie: "电影" };
  const CLUE_K = { look: "外形", story: "经历", quote: "台词" };

  // 换你出题：玩家挑一个词，再挑两句「像」的线索。
  // 每个词三句，其中一句其实是另一个词的——真挑错了，她俩会顺着这句猜偏，
  // 但不会卡住：再给一句就回来了。不给分、不计时。
  const SWAP_ROUNDS = [
    {
      word: "抢票",
      clues: [
        { text: "得盯着开票那一下。", fits: true },
        { text: "看完先别急着跟人说。", fits: false, mislead: "剧透" },
        { text: "手慢一点就没了。", fits: true }
      ]
    },
    {
      word: "剧透",
      clues: [
        { text: "得拉着人一起点，才点得着。", fits: false, mislead: "抢票" },
        { text: "一句话说早了，后面就没意思。", fits: true },
        { text: "有人比你先看完，你就坐不住了。", fits: true }
      ]
    },
    {
      word: "片尾曲",
      clues: [
        { text: "字幕滚完了，还不走。", fits: true },
        { text: "散场了，有人还在哼。", fits: true },
        { text: "得盯着开票时间。", fits: false, mislead: "抢票" }
      ]
    }
  ];

  const WHO = { girl: "朱里", me: "和臣", friend: "由乃" };

  // 5.2 抢答窗：每条线索展示后 2.2 秒
  const BUZZ_MS = 2200;

  function norm(s) {
    return String(s || "").replace(/[\s,，。、．.!！?？~～"'“”‘’·]/g, "");
  }

  function makeRnd(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /** 5.5 抽题：种子 = 本场游玩次。动漫 / 游戏 / 电影各洗一次，各取 2 道。 */
  function pickQuestions(seed) {
    const rnd = makeRnd((Math.imul((seed >>> 0) || 1, 2654435761) ^ 0x1f2e3d4c) >>> 0);
    const out = [];
    ["anime", "game", "movie"].forEach(function (cat) {
      const pool = QUESTIONS.filter(function (q) { return q.cat === cat; });
      const arr = pool.slice();
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
      }
      out.push(arr[0], arr[1]);
    });
    return out;
  }

  /** 抢答窗过后她俩往哪猜：npcByClue 覆盖优先，缺省走题目的 npc。 */
  function npcGuess(q, kind) {
    if (q && q.npcByClue && q.npcByClue[kind]) return q.npcByClue[kind];
    if (q && q.npc) return q.npc;
    return { who: "friend", right: false, text: "……谁？" };
  }

  D.games.wordgame = function (host) {
    let idx = 0;
    let correct = 0;          // 答对的回合数
    let score = 0;            // 分数：抢答窗内 1，窗过 / 用了提示 0.5
    let fullWins = 0;
    let halfWins = 0;
    let hints = 0;
    let tries = 0;
    let choiceResolve = null;
    let sayResolve = null;
    let state = "idle";
    let teased = false;
    let streak = 0;
    let buzzActive = false;
    let buzzEndAt = 0;
    let buzzTimer = 0;

    // ---- 抽题 / 蒙版 ----
    let drawn = [];            // 本轮抽到的 6 题
    let roundSeqSeed = 0;      // 本场种子 = 游玩次
    let currentReveal = 1;     // 当前蒙版的线索进度（1..3，4 = 公布答案）
    let currentQ = null;

    // ---- 主动互动 ----------------------------------------------------------
    // F = 抢答 / 插话：把主持人还没念完的那句直接带过去，角色马上接一句。
    let pokeCount = 0, typedReacted = false;

    // ---- 换你出题：两轮 ----
    let swapChoice = -2, swapTimer = 0, swapKey = null;
    let swapState = "idle";      // idle | pick | clues | done
    let swapUsed = 0;            // 这段插曲里真的说出了几句线索
    let swapChoices = [];        // 两轮各挑了哪个词
    let swapRoundIdx = 0;
    let learnedCats = [];        // 主持人状态：她俩第一轮猜错过的词，第二轮排除
    let pickTimer = 0;

    const el = {};

    function grab() {
      el.root = document.getElementById("wg");
      el.round = document.getElementById("wgRound");
      el.host = document.getElementById("wgHost");
      el.clues = document.getElementById("wgClues");
      el.opts = document.getElementById("wgOpts");
      el.say = document.getElementById("wgSay");
      el.hintBtn = document.getElementById("wgHint");
      el.input = document.getElementById("wgInput");
      el.send = document.getElementById("wgSend");
      el.figure = document.getElementById("wgFigure");
      el.sil = document.getElementById("wgSil");
      el.canvas = document.getElementById("wgSilCv");
      el.cat = document.getElementById("wgCat");
      el.buzz = document.getElementById("wgBuzz");
      el.buzzBar = el.buzz ? el.buzz.querySelector("i") : null;
      el.pick = document.getElementById("wgPick");
      el.chips = Array.prototype.slice.call(document.querySelectorAll("#wg .chip"));
      el.swap = document.getElementById("wgSwap");
      el.swapLead = document.getElementById("wgSwapLead");
      el.swapOpts = document.getElementById("wgSwapOpts");
      el.swapClues = document.getElementById("wgSwapClues");
      el.swapSay = document.getElementById("wgSwapSay");
    }

    // ---------------------------------------------------------------- 面板

    function show() {
      // 重玩时要把上一段「换你出题」留下的隐藏状态全部复位
      el.swap.hidden = true;
      el.swapOpts.hidden = false;
      el.swapClues.hidden = true;
      el.swapOpts.innerHTML = "";
      el.swapClues.innerHTML = "";
      el.swapSay.textContent = "";
      el.swapSay.classList.remove("show");
      swapState = "idle";
      swapUsed = 0;
      swapChoice = -2;
      swapChoices = [];
      swapRoundIdx = 0;
      learnedCats = [];
      el.clues.hidden = false;
      el.opts.hidden = false;
      el.figure.hidden = false;
      el.root.querySelector(".wg-tools").hidden = false;
      el.input.disabled = false;
      el.send.disabled = false;
      if (el.buzz) { el.buzz.hidden = true; el.buzz.classList.remove("show"); }
      if (el.pick) { el.pick.hidden = true; el.pick.innerHTML = ""; }
      el.root.hidden = false;
      el.root.classList.add("show");
    }
    function hide() {
      el.root.classList.remove("show");
      el.root.hidden = true;
      el.swap.hidden = true;
      if (el.buzz) el.buzz.hidden = true;
      if (el.pick) el.pick.hidden = true;
    }

    function highlight(who) {
      el.chips.forEach(function (c) {
        c.classList.toggle("on", c.dataset.who === who);
      });
    }

    function setRound(i) {
      el.round.textContent = "第 " + (i + 1) + " / " + drawn.length + " 回合";
    }

    /** 面板上的一句话。自动推进，点面板可以提前跳过。
     *  target = "host" 时写进上方那条主持人的位置（会一直留着），
     *  否则写进下面那条临时的反应行。 */
    function say(who, text, ms, target) {
      const box = target === "host" ? el.host : el.say;
      box.textContent = (who && target !== "host" ? WHO[who] + "：" : "") + text;
      box.classList.add("show");
      if (who) highlight(who);
      return new Promise(function (resolve) {
        const timer = setTimeout(finish, ms || 1500);
        function finish() {
          clearTimeout(timer);
          el.root.removeEventListener("click", onClick);
          sayResolve = null;
          resolve();
        }
        function onClick(e) {
          if (e.target.closest("button")) return;
          finish();
        }
        sayResolve = finish;
        el.root.addEventListener("click", onClick);
      });
    }

    /** 线索列表：按展示顺序画，并带上类别标签（外形 / 经历 / 台词）。 */
    function renderClues(q, n, order) {
      el.clues.innerHTML = "";
      for (let i = 0; i < n && i < order.length; i++) {
        const c = q.clues[order[i]];
        if (!c) continue;
        const li = document.createElement("li");
        li.dataset.k = c.k;
        const tag = document.createElement("span");
        tag.className = "wg-ck";
        tag.textContent = CLUE_K[c.k] || "";
        li.appendChild(tag);
        li.appendChild(document.createTextNode(c.t));
        el.clues.appendChild(li);
      }
    }

    function renderOptions(q, dead) {
      el.opts.innerHTML = "";
      const right = q.options.indexOf(q.answer);
      q.options.forEach(function (text, i) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = text;
        b.dataset.index = String(i);
        // 正确答案的位置每题不同，标出来只给自动化脚本按「答对」那条路走，
        // 玩家看到的仍然只是四个词，不显示任何标记。
        if (i === right) b.dataset.ans = "1";
        if (dead.indexOf(i) >= 0) b.disabled = true;
        b.addEventListener("click", function () { pick(i); });
        el.opts.appendChild(b);
      });
    }

    function pick(i) {
      if (state !== "ask" || !choiceResolve) return;
      const r = choiceResolve;
      choiceResolve = null;
      state = "wait";
      D.audio.click();
      r(i);
    }

    // ---------------------------------------------------------------- 蒙版

    function showMask(reveal, animate) {
      if (!el.canvas || !currentQ) return;
      const from = currentReveal;
      currentReveal = reveal;
      if (animate) WGMask.animate(el.canvas, currentQ, from, reveal, 200);
      else WGMask.render(el.canvas, currentQ, reveal);
    }

    // ---------------------------------------------------------------- 抢答窗

    function startBuzzBar(ms) {
      if (!el.buzz || !el.buzzBar) return;
      el.buzz.hidden = false;
      el.buzz.classList.add("show");
      el.buzzBar.style.transition = "none";
      el.buzzBar.style.transform = "scaleX(1)";
      // 强制回流，让上面这一帧成为动画起点
      void el.buzzBar.offsetWidth;
      el.buzzBar.style.transition = "transform " + ms + "ms linear";
      el.buzzBar.style.transform = "scaleX(0)";
    }

    function endBuzzBar() {
      if (!el.buzz) return;
      el.buzz.classList.remove("show");
      el.buzz.hidden = true;
    }

    /** 开一个抢答窗：窗内点对（pick）得满分，超时 resolve -1。 */
    function buzzWindow(ms) {
      state = "ask";
      buzzActive = true;
      buzzEndAt = (typeof performance !== "undefined" ? performance.now() : Date.now()) + ms;
      startBuzzBar(ms);
      return new Promise(function (resolve) {
        let done = false;
        function finish(res) {
          if (done) return;
          done = true;
          clearTimeout(buzzTimer);
          buzzTimer = 0;
          buzzActive = false;
          buzzEndAt = 0;
          endBuzzBar();
          choiceResolve = null;
          resolve(res);
        }
        buzzTimer = setTimeout(function () { finish(-1); }, ms);
        choiceResolve = function (i) { finish(i); };
      });
    }

    function askAnswer() {
      state = "ask";
      buzzActive = false;
      return new Promise(function (resolve) { choiceResolve = resolve; });
    }

    // ---------------------------------------------------------------- 回合

    /** 她俩在抢答窗过去之后开口：按已展示线索的类别选一句猜测，再被主持人纠正。 */
    async function npcGuessLines(q, order, shown) {
      const kind = q.clues[order[shown - 1]].k;
      const guess = npcGuess(q, kind);
      state = "talk";
      await D.sleep(240);
      await say(guess.who, guess.text, 1150);
      if (q.banter) {
        state = "talk";
        await say(q.banter.who, q.banter.text, 1100);
      }
    }

    /** 5.3 线索类别：首条固定，之后两条玩家点选先听哪类。 */
    function chooseClueKind(q, order) {
      const rest = [1, 2];
      const kinds = [];
      rest.forEach(function (i) {
        const k = q.clues[i].k;
        if (kinds.indexOf(k) < 0) kinds.push(k);
      });
      function applyKind(kind) {
        const first = [];
        const later = [];
        rest.forEach(function (i) {
          if (q.clues[i].k === kind) first.push(i);
          else later.push(i);
        });
        order[1] = first[0];
        order[2] = first.length > 1 ? first[1] : later[0];
      }
      if (kinds.length < 2) {
        applyKind(kinds[0]);
        return Promise.resolve(false);
      }
      if (!el.pick) {
        applyKind(kinds[0]);
        return Promise.resolve(false);
      }
      state = "pick";
      el.pick.hidden = false;
      el.pick.innerHTML = "";
      return new Promise(function (resolve) {
        let done = false;
        function finish(kind) {
          if (done) return;
          done = true;
          clearTimeout(pickTimer);
          pickTimer = 0;
          el.pick.hidden = true;
          el.pick.innerHTML = "";
          applyKind(kind);
          resolve(true);
        }
        kinds.forEach(function (k) {
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = "先听" + (CLUE_K[k] || "");
          b.dataset.kind = k;
          b.addEventListener("click", function () { D.audio.click(); finish(k); });
          el.pick.appendChild(b);
        });
        // 不点也会自己往下走，不把玩家拦在这儿
        pickTimer = setTimeout(function () { finish(kinds[0]); }, 6000);
      });
    }

    /** 揭下一条线索：需要的话先让玩家挑类别，然后更新线索列表并把蒙版揭一格。 */
    async function revealNextClue() {
      if (!currentQ || currentReveal >= 3) return false;
      if (orderState.shown === 1 && !orderState.chosen) {
        await chooseClueKind(currentQ, orderState.order);
        orderState.chosen = true;
      }
      orderState.shown++;
      renderClues(currentQ, orderState.shown, orderState.order);
      showMask(orderState.shown, true);
      return true;
    }

    // 当前回合的展示状态（revealNextClue / hint 共用）
    let orderState = { order: [0, 0, 0], shown: 1, chosen: false, half: false, dead: [] };

    async function playRound(i) {
      const q = drawn[i];
      const dead = [];
      currentQ = q;
      orderState = { order: [0, 0, 0], shown: 1, chosen: false, half: false, dead: dead };

      setRound(i);
      // 换题就换剪影和分类标签。剪影只是「那一类人」的轮廓 + 道具，
      // 不画脸、不重绘原作——认人还是靠线索。
      el.figure.hidden = false;
      el.cat.textContent = CAT[q.cat] || "";
      el.sil.alt = "第 " + (i + 1) + " 题的剪影";
      if (el.canvas) el.canvas.setAttribute("aria-label", "第 " + (i + 1) + " 题的剪影");
      el.say.textContent = "";
      el.say.classList.remove("show");
      el.host.textContent = "";
      el.host.classList.remove("show");
      el.clues.hidden = false;
      el.opts.hidden = false;
      el.root.querySelector(".wg-tools").hidden = false;
      el.input.value = "";
      if (el.pick) { el.pick.hidden = true; el.pick.innerHTML = ""; }
      if (el.buzz) el.buzz.hidden = true;

      // 老题先把 PNG 中转进 #wgSil，再和 fig 一样画到 canvas 上
      await WGMask.prepare(q);
      currentReveal = 1;
      WGMask.clear(el.canvas);
      WGMask.render(el.canvas, q, 1);

      renderClues(q, 1, orderState.order);
      renderOptions(q, dead);
      el.hintBtn.hidden = false;
      el.hintBtn.disabled = false;
      el.hintBtn.onclick = onHint;

      el.send.onclick = submitText;
      el.input.onkeydown = function (e) {
        if (e.key === "Enter") { e.preventDefault(); submitText(); }
      };

      highlight(q.host);
      for (const line of q.hostLines) await say(q.host, line, 1250, "host");

      const right = q.options.indexOf(q.answer);
      let half = false;

      // 每条线索只给一次作答机会：
      //   抢答窗内答对 → 满分；窗内答错 → 这条线索算废了，她俩猜完直接换下一条；
      //   窗过 → 她俩先猜，玩家再答一次：答对半分，答错换下一条。
      // 三条线索答完还没对，公布答案，亮出整张剪影。没有失败态，只是往下走。
      while (true) {
        el.hintBtn.disabled = true;
        const res = await buzzWindow(BUZZ_MS);
        el.hintBtn.disabled = false;
        state = "talk";

        if (res >= 0) {
          tries++;
          if (res === right) {
            correct++;
            streak++;
            if (!half) { score += 1; fullWins++; } else { score += 0.5; halfWins++; }
            D.audio.right();
            dead.push(res);
            renderOptions(q, dead);
            highlight(q.host);
            await say(q.host, half ? "抢到了，不过已经慢了半拍。" : "抢到了。", 900);
            await tease(q);
            return true;
          }
          // 窗内答错：不再给这条线索第二次机会，她俩猜完就换下一条
          half = true;
          orderState.half = true;
          streak = 0;
          D.audio.wrong();
          dead.push(res);
          renderOptions(q, dead);
          await say(q.host, "不对。", 750);
          await npcGuessLines(q, orderState.order, orderState.shown);
        } else {
          // 窗过：她俩按已展示线索的类别先猜
          await npcGuessLines(q, orderState.order, orderState.shown);
          // 玩家再答一次，答对拿半分
          const picked = await askAnswer();
          if (picked >= 0) {
            tries++;
            if (picked === right) {
              correct++;
              streak++;
              score += 0.5;
              halfWins++;
              D.audio.right();
              dead.push(picked);
              renderOptions(q, dead);
              highlight(q.host);
              await say(q.host, "对了。——慢了半拍。", 900);
              await tease(q);
              return true;
            }
            streak = 0;
            D.audio.wrong();
            dead.push(picked);
            renderOptions(q, dead);
          }
        }

        // 这条线索用完了：还有下一条就先让玩家挑类别，没有就公布答案
        if (orderState.shown >= 3) {
          dead.push(right);
          renderOptions(q, dead);
          showMask(4, true);
          await say(q.host, "算了，是「" + q.answer + "」。", 1600);
          return false;
        }
        half = true;
        orderState.half = true;
        await revealNextClue();
        await say(q.host, "不对。再听一条。", 900);
      }
    }

    /** 连对两题 / 和谁想到一块儿去了，由乃打趣一句。 */
    async function tease(q) {
      if (!teased && streak >= 2) {
        teased = true;
        await say("friend", "你是不是偷偷背过题库？", 1400);
        await say("me", "没有。", 900);
      } else if (!teased && q.npc && q.npc.right) {
        teased = true;
        await say("friend", "你俩想一块儿去了。", 1400);
      }
    }

    /** 玩家主动插话。不新增回合、不改答案，只是让节奏能被玩家推一下。 */
    function poke() {
      if (state === "done" || state === "swap" || D.dialogOpen() || el.root.hidden) return;
      pokeCount++;
      D.audio.click();
      D.react("我", "我猜到了，能说了吗？", 1000);
      D.react("由乃", state === "ask" ? "那就说啊。" : "急什么，还没说完呢。", 1500);
      // 主持人的话没念完就直接进题目——和 press() 里 E 的跳过是同一条路
      if (sayResolve && state !== "ask") { const f = sayResolve; sayResolve = null; f(); }
    }

    /** 「再给点提示」：抢答窗关着的时候才能用，用提示这条线索就不能再拿满分了。 */
    function onHint() {
      if (state !== "ask" || buzzActive) return;
      if (orderState.shown >= 3) { D.audio.wrong(); return; }
      hints++;
      orderState.half = true;
      D.audio.click();
      const r = choiceResolve;
      choiceResolve = null;
      state = "wait";
      if (r) r(-1);
    }

    /** 半场：话题自己跑远一会儿。不是回合、不给选项、不计分。 */
    async function interlude() {
      state = "chat";
      el.say.textContent = "";
      el.say.classList.remove("show");
      el.host.textContent = "";
      el.host.classList.remove("show");
      el.clues.hidden = true;
      el.opts.hidden = true;
      el.figure.hidden = true;
      el.hintBtn.hidden = true;
      el.root.querySelector(".wg-tools").hidden = true;
      el.round.textContent = "课间 · 接了趟水";
      await say(null, "有人去接了趟水。回来的时候，话题已经跑远了。", 1500);
      await say("friend", "对了，那档综艺上周停播了。", 1300);
      await say("girl", "是放假吧。", 1100);
      await say("friend", "那也算理由啊。", 1200);
      await say("me", "……下一题呢？", 1000);
    }

    /** 换你出题：两轮。第一轮她被那句「不像」的线索带着猜偏；
     *  第二轮她们会排除上一轮猜错过的词，同样的误导只让她们犹豫半拍。
     *  不给分、不计时、不改结局，不点也会自己往下走。 */
    function swapRound() {
      return new Promise(function (resolve) {
        let usedWords = [];
        let picked = [];
        let resolved = false;

        state = "swap";
        swapState = "pick";
        swapChoice = -2;
        swapUsed = 0;
        swapChoices = [];
        swapRoundIdx = 0;
        learnedCats = [];

        el.clues.hidden = true;
        el.opts.hidden = true;
        el.figure.hidden = true;
        if (el.pick) el.pick.hidden = true;
        if (el.buzz) el.buzz.hidden = true;
        el.root.querySelector(".wg-tools").hidden = true;
        el.host.classList.remove("show");
        el.say.classList.remove("show");
        el.round.textContent = "换你出题";
        el.swapLead.textContent = "由乃：「换你出一个，我们来猜。」";
        el.swapOpts.hidden = false;
        el.swapOpts.innerHTML = "";
        el.swapClues.hidden = true;
        el.swapClues.innerHTML = "";
        el.swapSay.textContent = "";
        el.swapSay.classList.remove("show");
        el.swap.hidden = false;
        highlight("friend");

        function setSay(who, text) {
          el.swapSay.textContent = WHO[who] + "：" + text;
          el.swapSay.classList.add("show");
          highlight(who);
        }

        /** 她不点，就替她往下走。计时只用来兜底，不挂在 HUD 上、不算成绩。 */
        function armAuto() {
          clearTimeout(swapTimer);
          swapTimer = setTimeout(function () {
            if (swapState === "pick") {
              const b = el.swapOpts.querySelector("button:not(:disabled)");
              if (b) b.click();
              return;
            }
            if (swapState !== "clues") return;
            const b = el.swapClues.querySelector("button:not(:disabled)");
            if (b) b.click();
          }, 6000);
        }

        /** 第二轮：出过的词、上一轮猜错过的词都摆出来但点不动——她们真的在排除。 */
        function learnedIds() {
          return [0, 1, 2].filter(function (i) {
            return learnedCats.indexOf(SWAP_ROUNDS[i].word) >= 0;
          });
        }
        function isRemoved(i) {
          return usedWords.indexOf(i) >= 0 || learnedIds().indexOf(i) >= 0;
        }
        function openPick() {
          swapState = "pick";
          swapChoice = -2;
          picked = [];
          el.swapLead.textContent = swapRoundIdx === 0
            ? "由乃：「换你出一个，我们来猜。」"
            : "由乃：「再来一个。这次我们学乖了。」";
          el.swapOpts.hidden = false;
          el.swapOpts.innerHTML = "";
          el.swapClues.hidden = true;
          el.swapClues.innerHTML = "";
          el.swapSay.textContent = "";
          el.swapSay.classList.remove("show");
          const learned = learnedIds();
          const ids = [0, 1, 2].filter(function (i) { return !isRemoved(i); });
          const deadIds = [0, 1, 2].filter(function (i) { return isRemoved(i); });
          // 先摆点不动的，再把能选的放在后面：脚本按「最后一个」点也不会点到禁用项
          deadIds.concat(ids).forEach(function (i) {
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = SWAP_ROUNDS[i].word;
            b.dataset.word = String(i);
            if (isRemoved(i)) {
              b.disabled = true;
              b.textContent += usedWords.indexOf(i) >= 0 ? "（出过）" : "（排除）";
            } else {
              b.addEventListener("click", function () { choose(i); });
            }
            el.swapOpts.appendChild(b);
          });
          armAuto();
        }

        function choose(i) {
          if (swapState !== "pick") return;
          if (isRemoved(i)) return;
          swapState = "clues";
          swapChoice = i;
          swapChoices.push(i);
          usedWords.push(i);
          picked = [];
          D.audio.click();
          const round = SWAP_ROUNDS[i];
          setSay("me", "「" + round.word + "」。");
          el.swapOpts.hidden = true;
          el.swapOpts.innerHTML = "";
          el.swapLead.textContent = (swapRoundIdx === 0 ? "你出「" : "第二轮，你出「")
            + round.word + "」。挑两句最像的，别提这个词。";
          el.swapClues.innerHTML = "";
          round.clues.forEach(function (c, j) {
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = c.text;
            b.dataset.clue = String(j);
            b.addEventListener("click", function () { give(j, b); });
            el.swapClues.appendChild(b);
          });
          el.swapClues.hidden = false;
          armAuto();
        }

        function give(j, btn) {
          if (swapState !== "clues" || btn.disabled) return;
          const round = SWAP_ROUNDS[swapChoice];
          const clue = round.clues[j];
          btn.disabled = true;
          picked.push(j);
          swapUsed++;
          D.audio.click();
          setSay("me", clue.text);
          clearTimeout(swapTimer);
          // 让她俩先听完这一句，再决定往哪边猜
          swapTimer = setTimeout(function () {
            if (swapState !== "clues") return;
            if (!clue.fits) {
              // 5.4 第二轮：她们记得上一轮猜错过的词，同样的误导只算半拍
              const second = swapRoundIdx > 0;
              const learned = learnedCats.indexOf(clue.mislead) >= 0;
              if (second) {
                D.audio.blip();
                setSay("friend", learned
                  ? "……" + clue.mislead + "？不对，上一轮我就栽在这儿，这次排除它。"
                  : "……" + clue.mislead + "？先记着，这次不急着猜。");
              } else {
                D.audio.wrong();
                setSay("friend", "……" + clue.mislead + "？");
                if (learnedCats.indexOf(clue.mislead) < 0) learnedCats.push(clue.mislead);
              }
            } else {
              const fits = picked.filter(function (k) {
                return round.clues[k].fits;
              }).length;
              if (fits >= 2) { finishRound(); return; }
              D.audio.blip();
              setSay("girl", "再说一句。");
            }
            if (picked.length >= round.clues.length) finishRound();
            else armAuto();
          }, 950);
        }

        function finishRound() {
          if (swapState === "done") return;
          swapState = "done";
          clearTimeout(swapTimer);
          el.swapClues.hidden = true;
          const round = SWAP_ROUNDS[swapChoice];
          D.audio.right();
          setSay("friend", "……" + round.word + "？");
          setTimeout(function () {
            setSay("girl", "嗯。就是。");
            setTimeout(function () {
              if (swapRoundIdx === 0) {
                // ---- 第一轮收，进第二轮 ----
                swapRoundIdx = 1;
                swapState = "pick";
                setSay("friend", "再来一个。这次谁再提上一轮那个词，谁负责收场。");
                setTimeout(openPick, 1100);
              } else {
                // ---- 两轮结束 ----
                setSay("friend", "两轮都猜着了。你出得挺好猜。");
                setTimeout(function () {
                  el.swap.hidden = true;
                  if (swapKey) { window.removeEventListener("keydown", swapKey); swapKey = null; }
                  if (!resolved) { resolved = true; resolve(); }
                }, 1150);
              }
            }, 850);
          }, 850);
        }

        function onKey(e) {
          const n = Number(e.key);
          if (!(n >= 1 && n <= 3)) return;
          if (swapState === "pick") {
            const b = el.swapOpts.querySelectorAll("button")[n - 1];
            if (b && !b.disabled) b.click();
          } else if (swapState === "clues") {
            const b = el.swapClues.querySelector('button[data-clue="' + (n - 1) + '"]');
            if (b && !b.disabled) b.click();
          }
        }
        window.addEventListener("keydown", onKey);
        swapKey = onKey;
        openPick();
      });
    }

    function submitText() {
      if (state !== "ask" || !choiceResolve) return;
      const q = drawn[idx];
      if (!q) return;
      const v = norm(el.input.value);
      if (!v) return;
      const hit = norm(q.answer) === v || q.aliases.some(function (a) { return norm(a) === v; });
      if (hit) {
        // 手写是对的，也让角色即时看见一次——不然这个可选输入像没人接
        if (!typedReacted) {
          typedReacted = true;
          D.react("由乃", "还能直接写出来啊。", 1500);
        }
        // 手写对了也走「选项命中」那条路，省得两套反馈
        const i = q.options.indexOf(q.answer);
        pick(i);
      } else {
        D.audio.wrong();
        el.input.value = "";
        el.say.textContent = WHO[q.host] + "：不对。";
        el.say.classList.add("show");
      }
    }

    // ---------------------------------------------------------------- 生命周期

    async function start() {
      grab();
      D.clearReact();
      D.onPoke(poke);
      state = "intro";

      // 5.5 抽题：种子 = 本场游玩次（完成时 +1；中途刷新重进仍是同一轮题目）
      const runs = Math.max(0, Number(D.store.wordRuns) || 0);
      roundSeqSeed = runs;
      drawn = pickQuestions(runs);

      show();
      D.reactHint("F · 抢答");
      // 章节壳进来之前把画面压黑了，这里要自己淡回来——
      // #fade 盖在所有面板上面，不淡掉的话整个猜词界面是全黑的。
      await D.fadeTo(0, 320);

      await say(null, "课间，走廊尽头那张长椅。", 1400);
      await say("friend", "闲着也是闲着，猜点东西吧。", 1300);
      await say("me", "猜什么？", 1000);
      await say("friend", "随便啊。最近听的、玩的、班里传的，都行。", 1600);
      await say("girl", "别出太难的。", 1100);

      for (let i = 0; i < drawn.length; i++) {
        if (i === 3) await interlude();   // 前半场三题结束，聊两句再回来
        idx = i;
        await playRound(i);
      }

      el.hintBtn.hidden = true;
      await swapRound();
      D.reactHint(false);
      state = "done";

      // 收尾交回画布上的对白
      hide();
      const lines = [
        ["由乃", score >= 5.5 ? "全对。行啊你。" : score >= 3.5 ? "差不多吧。" : "……下次让着你点。"],
        ["朱里", "他刚才想了好久。"],
        ["我", "没有很久。"],
        ["旁白", "上课铃响了。三个人从长椅上站起来，谁也没提刚才那几道题。"]
      ];
      await D.lines(lines);

      D.persist({ wordGameCompleted: true, wordGameCorrect: correct, wordGameHints: hints, wordRuns: runs + 1 });
      host.done({
        id: "word_guess",
        completed: true,
        events: ["wordgame:finished"],
        playerActions: [
          "rounds:" + drawn.length,
          "correct:" + correct,
          "hints:" + hints,
          "score:" + score,
          "buzz:" + fullWins + "+half:" + halfWins
        ]
      });
    }

    function update() { /* 面板驱动，没有逐帧逻辑 */ }

    function draw(ctx) {
      // 猜词时画面只做背景：压暗一层，让人专心看面板
      ctx.drawImage(D.img.railing, 0, 0, D.W, D.H);
      ctx.fillStyle = "rgba(24,18,26,.62)";
      ctx.fillRect(0, 0, D.W, D.H);
    }

    function press(key) {
      const k = key.toLowerCase();
      if (k === "e" || key === "Enter") {
        // 对白里按 E 提前跳过当前这句
        if (sayResolve && state !== "ask") { const f = sayResolve; sayResolve = null; f(); }
      }
    }

    return {
      id: "word_guess",
      title: "课间猜人物",
      start: start,
      update: update,
      draw: draw,
      press: press,
      setFrozen: function () { },
      dispose: function () {
        D.onPoke(null);
        D.reactHint(false);
        D.clearReact();
        clearTimeout(swapTimer);
        clearTimeout(buzzTimer);
        clearTimeout(pickTimer);
        WGMask.stop();
        WGMask.clear(el.canvas);
        if (el.buzz) el.buzz.hidden = true;
        if (el.pick) el.pick.hidden = true;
        if (swapKey) { window.removeEventListener("keydown", swapKey); swapKey = null; }
        hide();
      },
      get state() { return state; },
      get roundIndex() { return idx; },
      get rounds() { return drawn.length || 6; },
      get seed() { return roundSeqSeed; },
      get drawn() { return drawn.slice(); },
      get questions() { return QUESTIONS; },
      get maskReveal() { return currentReveal; },
      get maskCell() { return WGMask.cellFor(currentReveal); },
      get buzzActive() { return buzzActive; },
      get buzzMs() { return BUZZ_MS; },
      get buzzLeft() {
        if (!buzzActive) return 0;
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        return Math.max(0, buzzEndAt - now);
      },
      get score() { return score; },
      get fullWins() { return fullWins; },
      get halfWins() { return halfWins; },
      get pokeCount() { return pokeCount; },
      get swapChoice() { return swapChoice; },
      get swapChoices() { return swapChoices.slice(); },
      get swapRoundIdx() { return swapRoundIdx; },
      get swapState() { return swapState; },
      get swapUsed() { return swapUsed; },
      get learnedCats() { return learnedCats.slice(); },
      get swapData() {
        const round = SWAP_ROUNDS[swapChoice];
        const opts = el.swapOpts
          ? Array.prototype.map.call(el.swapOpts.querySelectorAll("button"), function (b) {
            return { text: b.textContent, disabled: !!b.disabled, word: Number(b.dataset.word) };
          })
          : [];
        return round ? {
          word: round.word,
          round: swapRoundIdx,
          clues: round.clues.map(function (c) {
            return { text: c.text, fits: !!c.fits, mislead: c.mislead || null };
          }),
          options: opts
        } : { word: null, round: swapRoundIdx, clues: [], options: opts };
      },
      get clueKinds() {
        return currentQ ? currentQ.clues.map(function (c) { return c.k; }) : [];
      },
      get stats() {
        return {
          correct: correct, hints: hints, tries: tries,
          score: score, fullWins: fullWins, halfWins: halfWins
        };
      }
    };
  };

  // 自检 / 维护工具：模块级的纯函数和道具表挂在工厂函数上，不进任何存档。
  D.games.wordgame.WGMask = WGMask;
  D.games.wordgame.QUESTIONS = QUESTIONS;
  D.games.wordgame.pickQuestions = pickQuestions;
  D.games.wordgame.npcGuess = npcGuess;

})(window);

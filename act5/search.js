/* G02《校园寻物》— 线索收集 + 环境观察
 *
 * 周三中午，她的校园卡不见了。她在教室门口翻书包，你一个人出去找。
 *
 * 设计稿第 4 章要求的三件事，都在这里：
 *  1. 八处可看的东西，只有四处跟卡有关，其余是**真的、但没用**的观察——
 *     不是假线索。找东西的时候本来就大部分白看。
 *  2. 线索分三种：亲眼看见 / 我记得 / 我猜的。猜的那条在对话里就把话说全了
 *     （「也可能只是谁的手蹭到了」），线索本里也单独归一类，不和观察混着放。
 *  3. 卡一直就在楼梯口的窗台上。不需要先听完线索才能捡——
 *     提前找到的话，收尾对话会承认「你怎么直接就找到了」。
 *  4. 摊开线索之后能打开二楼平面图，把地点钉出来，拼「她上午去过哪」。
 *     钉的先后就是画的线——三站顺序不对，线也拐不到一块儿去。
 *     拼对不拦路、拼错也不拦路；拼对只换来一句「果然在这儿」和一条明路。
 */
(function (global) {
  "use strict";

  const D = global.DAILY;
  D.games = D.games || {};

  // 走廊是平视的，但地面从 y≈200 铺到画面底部：左右换场景，
  // 前后（W / 上、S / 下）只在地面里走，站得越靠前越大。
  const FLOOR = [204, 258];

  const SCENES = {
    corridor: { bg: "corridor", walk: [46, 468], y: FLOOR, left: "stair", name: "走廊" },
    stair: { bg: "stair", walk: [64, 456], y: FLOOR, left: "railing", right: "corridor", name: "楼梯口" },
    railing: { bg: "railing", walk: [52, 466], y: FLOOR, right: "stair", name: "楼上 · 走廊" }
  };

  // 卡在楼梯口窗台上 —— 首通固定在这儿（CARD_SPOTS[0]），重玩按游玩次轮换。
  // 每个落点配一张线索链表：八处观察点里哪四处产出真线索、每条线索钉在哪、
  // 它是「她上午走过的路」里的第几站（step 1/2/3）。仅凭这组真线索就能唯一
  // 确定落点——自检里用纯数据求解验这一条，不靠玩家背台词。
  const CARD_SPOTS = [
    {
      // 0 · 首通（现行）
      id: "stairSill", name: "楼梯口窗台", place: "楼梯口的窗台", short: "窗台",
      scene: "stair", x: 300, y: 150, standY: 214,
      findHint: "E · 看看窗台",
      findFirst: "窗台上落着一层薄灰。靠外那一角，压着一张卡。",
      dest: "windowsill",
      route: ["classroom", "cooler", "windowsill"],
      hint3: "楼梯口那个窗台。你去看一眼就知道了。",
      truePoints: ["door", "sill", "plate", "can"],
      variants: {
        door: [{
          kind: "see", pin: "classroom", step: 1,
          text: "教室里的桌子没收，笔搁在练习册上，笔帽没盖——她是先出去的。"
        }],
        plate: [{
          kind: "see", pin: "classroom", step: 1,
          text: "门边的小牌子下沿被指甲刮花了一小块——她出门的时候从这儿过。"
        }],
        sill: [{
          kind: "remember", pin: "cooler", step: 2,
          text: "她说过，卡只在接水的时候拿出来——接水是出去以后的事。"
        }, {
          kind: "see", pin: "windowsill", step: 3,
          text: "左边窗台的灰里有一块干净的长方形印子——最后卡搁在这儿，又被拿走了。"
        }],
        can: [{
          kind: "see", pin: "cooler", step: 2,
          text: "垃圾桶最上面那个面包袋是今天的——她接水回来路过这儿时还拿着。"
        }]
      },
      answers: {
        girl: [
          { text: "朱里说，最后一次刷卡是第二节下课，接水的时候。", pin: "cooler" },
          { text: "朱里说，去了。接水的时候卡还刷了一下。", pin: "cooler" },
          { text: "朱里说，卡套是蓝的，挂绳断了——她去监控室问过。", pin: "cctv" }
        ],
        friend: [
          { text: "由乃说，她出去就一会儿，回来的时候手里是空的。", pin: null },
          { text: "由乃说，她接完水才去窗边站的。", pin: "windowsill" },
          { text: "由乃说，她没敢说卡落在哪儿，只说刷过卡。", pin: "cooler" }
        ]
      },
      confirms: [
        { who: "girl", q: 1, point: "sill", pin: "cooler",
          text: "朱里说卡就是接水时刷的——窗台上那块干净印子，是卡躺过的地方。" },
        { who: "friend", q: 1, point: "sill", pin: "windowsill",
          text: "由乃说接完水才去窗边——窗台那块印子对上了，卡最后被人拿走。" }
      ]
    },
    {
      // 1 · 开水房刷卡机旁（第二轮抽到它）
      id: "waterReader", name: "开水房刷卡机旁", place: "开水房的刷卡机旁边", short: "刷卡机",
      scene: "corridor", x: 448, y: 168, standY: 214,
      findHint: "E · 看看刷卡机旁边",
      findFirst: "刷卡机的台面上，卡贴着墙根搁着。",
      dest: "cooler",
      route: ["classroom", "windowsill", "cooler"],
      hint3: "开水房那台刷卡机旁边。你去看一眼就知道了。",
      truePoints: ["door", "sill", "plate", "board"],
      variants: {
        door: [{
          kind: "see", pin: "classroom", step: 1,
          text: "教室里的桌子没收，笔搁在练习册上，笔帽没盖——她是先出去的。"
        }],
        plate: [{
          kind: "see", pin: "classroom", step: 1,
          text: "门边的小牌子下沿被指甲刮花了一小块——她出门的时候从这儿过。"
        }],
        sill: [{
          kind: "see", pin: "windowsill", step: 2,
          text: "左边窗台的灰里有一块干净的长方形印子——她出来以后先在这儿站了一会儿，卡掏出来过。"
        }, {
          kind: "remember", pin: "cooler", step: 3,
          text: "她说过，卡只在接水的时候拿出来——站完窗边才去接的水。"
        }],
        board: [{
          kind: "see", pin: "cooler", step: 3,
          text: "布告栏上钉着一张「开水房刷卡机又吞卡了」的纸条——她接水的时候卡就是在那儿没的。"
        }]
      },
      answers: {
        girl: [
          { text: "朱里说，最后一次刷卡是第二节下课，接完水就没再掏过。", pin: "cooler" },
          { text: "朱里说，去了。卡在刷卡机上贴了一下。", pin: "cooler" },
          { text: "朱里说，卡套是蓝的，挂绳断了——她去监控室问过。", pin: "cctv" }
        ],
        friend: [
          { text: "由乃说，她出去就一会儿，回来的时候手里是空的。", pin: null },
          { text: "由乃说，她先去窗边站了一会儿，才去接的水。", pin: "windowsill" },
          { text: "由乃说，卡大概是接水的时候落在刷卡机边上的。", pin: "cooler" }
        ]
      },
      confirms: [
        { who: "girl", q: 1, point: "board", pin: "cooler",
          text: "朱里说卡在刷卡机上贴了一下——布告栏那张「又吞卡了」的纸条，说的就是她那回。" },
        { who: "friend", q: 1, point: "sill", pin: "windowsill",
          text: "由乃说先去窗边——窗台那块干净印子对上了，卡是在那儿拿出来的。" }
      ]
    },
    {
      // 2 · 布告栏下方
      id: "underBoard", name: "布告栏下方", place: "布告栏下面", short: "布告栏",
      scene: "corridor", x: 392, y: 202, standY: 226,
      findHint: "E · 看看布告栏下面",
      findFirst: "布告栏底下，靠墙根的地砖上，压着一张卡。",
      dest: "lostfound",
      route: ["classroom", "cooler", "lostfound"],
      hint3: "布告栏下面。你去看一眼就知道了。",
      truePoints: ["door", "plate", "sill", "board"],
      variants: {
        door: [{
          kind: "see", pin: "classroom", step: 1,
          text: "教室里的桌子没收，笔搁在练习册上，笔帽没盖——她是先出去的。"
        }],
        plate: [{
          kind: "see", pin: "classroom", step: 1,
          text: "门边的小牌子下沿被指甲刮花了一小块——她出门的时候从这儿过。"
        }],
        sill: [{
          kind: "remember", pin: "cooler", step: 2,
          text: "她说过，卡只在接水的时候拿出来——接水是出去以后的事。"
        }],
        board: [{
          kind: "see", pin: "lostfound", step: 3,
          text: "布告栏最上面新钉的「校园卡挂失补办流程」下沿还翘着——她接完水回来，在这儿停过。"
        }]
      },
      answers: {
        girl: [
          { text: "朱里说，接水的时候刷的卡，刷完就塞兜里了。", pin: "cooler" },
          { text: "朱里说，去了。刷完卡还站在机器旁边缓了一会儿。", pin: "cooler" },
          { text: "朱里说，卡套是蓝的，挂绳断了——她去监控室问过。", pin: "cctv" }
        ],
        friend: [
          { text: "由乃说，她出去就一会儿，回来的时候手里是空的。", pin: null },
          { text: "由乃说，她先去接的水，后来才往布告栏那边走。", pin: "cooler" },
          { text: "由乃说，卡大概是回教室路上丢的，她在布告栏底下站过。", pin: "lostfound" }
        ]
      },
      confirms: [
        { who: "girl", q: 1, point: "sill", pin: "cooler",
          text: "朱里说接水时刷的卡——窗台那块干净印子，是卡掏出来又塞回去留下的。" },
        { who: "friend", q: 2, point: "board", pin: "lostfound",
          text: "由乃说她在布告栏底下站过——挂失通知下沿还翘着，对上了。" }
      ]
    },
    {
      // 3 · 楼梯拐角台阶（第二轮抽到它）
      id: "stairSteps", name: "楼梯拐角台阶", place: "楼梯拐角的台阶上", short: "台阶",
      scene: "stair", x: 72, y: 228, standY: 238,
      findHint: "E · 看看台阶",
      findFirst: "台阶最下面一级，卡卡在缝里，露出一角。",
      dest: "stair",
      route: ["classroom", "cooler", "stair"],
      hint3: "楼梯拐角那几级台阶。你去看一眼就知道了。",
      truePoints: ["door", "plate", "sill", "rail"],
      variants: {
        door: [{
          kind: "see", pin: "classroom", step: 1,
          text: "教室里的桌子没收，笔搁在练习册上，笔帽没盖——她是先出去的。"
        }],
        plate: [{
          kind: "see", pin: "classroom", step: 1,
          text: "门边的小牌子下沿被指甲刮花了一小块——她出门的时候从这儿过。"
        }],
        sill: [{
          kind: "remember", pin: "cooler", step: 2,
          text: "她说过，卡只在接水的时候拿出来——接水是出去以后的事。"
        }],
        rail: [{
          kind: "guess", pin: "stair", step: 3,
          text: "扶手上有一道没干的白灰，可能刚有人扶着上过楼。（这是猜的。可她刚接完水，往楼梯这边走了。）"
        }]
      },
      answers: {
        girl: [
          { text: "朱里说，接水的时候刷的卡，刷完就攥在手里。", pin: "cooler" },
          { text: "朱里说，去了。刷卡机就在楼梯拐角那边。", pin: "cooler" },
          { text: "朱里说，卡套是蓝的，挂绳断了——她去监控室问过。", pin: "cctv" }
        ],
        friend: [
          { text: "由乃说，她出去就一会儿，回来的时候手里是空的。", pin: null },
          { text: "由乃说，她先接的水，接完往楼梯那边去了。", pin: "cooler" },
          { text: "由乃说，卡可能是上楼梯的时候掉的。", pin: "stair" }
        ]
      },
      confirms: [
        { who: "girl", q: 1, point: "sill", pin: "cooler",
          text: "朱里说接水时刷的卡——窗台那块干净印子，是卡掏出来的时候留下的。" },
        { who: "friend", q: 2, point: "rail", pin: "stair",
          text: "由乃说卡可能是在楼梯上掉的——扶手上那道白灰对上了，她确实往楼梯去了。" }
      ]
    }
  ];

  // 收尾里那几句按落点换词：谁都听得出来她在问「哪儿」。
  const SPOT_TEXT = {
    stairSill: { echo: "窗台？", low: "……在楼梯口，窗台上。", detail: "压在最外头那一角。", mid: "楼梯口的窗台上。" },
    waterReader: { echo: "刷卡机？", low: "……在开水房，刷卡机旁边。", detail: "贴着墙根搁着。", mid: "开水房刷卡机旁边。" },
    underBoard: { echo: "布告栏？", low: "……在布告栏下面。", detail: "靠墙根的地砖上。", mid: "布告栏下面。" },
    stairSteps: { echo: "台阶上？", low: "……在楼梯拐角的台阶上。", detail: "最下面一级的缝里。", mid: "楼梯拐角的台阶上。" }
  };

  // 每轮抽哪个落点：按「游玩次」分块，一块 4 场、每块用一个种子洗牌，
  // 所以同一块里四个落点各来一次、重玩不会连着两次同一个位置。
  // 首通那一块固定成 [0, 3, 1, 2]：第 0 次（楼梯口窗台）保持不变，
  // 后面三轮也是同一套顺序——和旧版第一次玩的体验对齐。
  const SPOT_ORDER = [0, 3, 1, 2];
  function makeRnd(seed) {          // 和 ball.js / errand.js 同一个确定性伪随机
    let s = seed >>> 0;
    return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }
  const spotBlocks = [SPOT_ORDER];
  function spotBlockAt(block) {
    if (spotBlocks[block]) return spotBlocks[block];
    const rnd = makeRnd(0x51ed270b ^ Math.imul(block + 1, 2654435761));
    const arr = [0, 1, 2, 3];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    spotBlocks[block] = arr;
    return arr;
  }
  function spotIndexForRun(n) {
    const block = Math.floor(n / SPOT_ORDER.length);
    const k = ((n % SPOT_ORDER.length) + SPOT_ORDER.length) % SPOT_ORDER.length;
    return spotBlockAt(block)[k];
  }

  // 问人的问题（每人 3 个，答案随这一轮的落点变）。第 3 个问题里，
  // 朱里那句永远指向监控（不在任何一条答案路线上），是地图上的干扰项。
  const ASK = {
    girl: [
      "最后一次刷卡是什么时候？",
      "上午去过开水房吗？",
      "卡套是什么颜色？"
    ],
    friend: [
      "她出去多久？",
      "她先去的哪儿？",
      "她说过卡在哪儿丢的吗？"
    ]
  };
  const ASK_NAME = { girl: "朱里", friend: "由乃" };

  // 门口站着的两个人。她们不进队伍，就在原地等——G02 是一个人找东西，
  // 三个人一起翻箱倒柜反而不像话。站得离互动点稍开一点，免得按 E 时
  // 想看的门缝 / 牌子被「问人」抢掉。
  const GIRL = { key: "girl", x: 238, y: 212, dir: 1, moving: false, phase: 0.4, scale: 1 };
  const FRIEND = { key: "friend", x: 186, y: 236, dir: 1, moving: false, phase: 0.9, scale: 1 };

  // ---------------------------------------------------------------- 八处

  const POINTS = {
    corridor: [
      {
        id: "door", x: 256, r: 46, label: "看一眼门缝",
        lines: [
          ["旁白", "门没关严，留了一道缝。"],
          ["旁白", "里面桌子都没收，练习册摊着，笔搁在页边上。"],
          ["我", "……笔帽都没盖。"],
          ["旁白", "走得很急。"]
        ],
        clues: [{
          kind: "see",
          pin: "classroom",
          text: "教室里的桌子没收，笔搁在练习册上，笔帽没盖。",
          from: "走廊 · 门缝"
        }]
      },
      {
        id: "board", x: 338, r: 44, label: "看布告栏",
        lines: [
          ["旁白", "布告栏上钉着几张通知，最上面那张是新的。"],
          ["我", "「校园卡挂失补办流程」……"],
          ["旁白", "底下那张被撕掉了一半，只剩日期。"]
        ],
        clues: [{
          kind: "see",
          pin: "lostfound",
          text: "布告栏最上面新钉了一张「校园卡挂失补办流程」。",
          from: "走廊 · 布告栏"
        }]
      },
      {
        id: "sill", x: 95, r: 44, label: "看左边窗台",
        lines: [
          ["旁白", "窗台上落了一层灰，被太阳照得发白。"],
          ["我", "……这块是干净的。"],
          ["旁白", "灰里有一个长方形的印子，边角很齐。有东西在这儿放过一阵，又被拿走了。"],
          ["我", "她只在一个地方会把卡掏出来。"],
          ["旁白", "接水的时候。开水房要刷卡。"]
        ],
        clues: [
          {
            kind: "see",
            pin: "windowsill",
            text: "左边窗台的灰里有一块干净的长方形印子——有东西在这儿放过，又被拿走了。",
            from: "走廊 · 左边窗台"
          },
          {
            kind: "remember",
            pin: "cooler",
            text: "她说过，卡她只在接水的时候拿出来——开水房要刷卡。",
            from: "走廊 · 左边窗台"
          }
        ]
      },
      {
        id: "plate", x: 203, r: 40, label: "看门边的牌子",
        lines: [
          ["旁白", "门边钉着一块小牌子。"],
          ["我", "高二（三）班。"],
          ["旁白", "牌子下沿被人用指甲刮花了一小块，看不出原来是什么。"]
        ],
        clues: [{
          kind: "see",
          pin: "classroom",
          text: "门边的牌子写着高二（三）班，下沿被刮花了一小块。",
          from: "走廊 · 班级牌"
        }]
      }
    ],

    stair: [
      {
        id: "rail", x: 120, r: 44, label: "看扶手",
        lines: [
          ["旁白", "扶手是铁的，摸上去冰手。"],
          ["我", "这儿蹭了一道白灰。"],
          ["旁白", "还没干透。"],
          ["我", "……有人刚扶着这儿上过楼。"],
          ["旁白", "（这是猜的。也可能只是谁的手蹭到了。）"]
        ],
        clues: [{
          kind: "guess",
          pin: "stair",
          text: "扶手上有一道没干的白灰，可能刚有人扶着上过楼。",
          from: "楼梯口 · 扶手"
        }]
      },
      {
        id: "can", x: 430, r: 44, label: "看垃圾桶",
        lines: [
          ["旁白", "垃圾桶快满了，边上还压着一个没塞进去的纸袋。"],
          ["我", "……面包袋。"],
          ["旁白", "袋子上的日期是今天。"]
        ],
        clues: [{
          kind: "see",
          pin: "bin",
          text: "垃圾桶快满了，最上面那个面包袋的日期是今天。",
          from: "楼梯口 · 垃圾桶"
        }]
      }
    ],

    railing: [
      {
        id: "ledge", x: 200, r: 46, label: "看栏杆平台",
        lines: [
          ["旁白", "栏杆平台上放着一个空水瓶，瓶身被晒得发烫。"],
          ["我", "不是她的。"],
          ["旁白", "瓶子上贴着一张写了名字的标签，字不是她的。"]
        ],
        clues: [{
          kind: "see",
          pin: "stair",
          text: "栏杆平台上有个空水瓶，标签上的名字不是她。",
          from: "楼上 · 栏杆"
        }]
      },
      {
        id: "column", x: 336, r: 44, label: "看柱子",
        lines: [
          ["旁白", "柱子上有几道很浅的铅笔印，一道压着一道。"],
          ["我", "她说过，她们班的人爱在这根柱子上画道道。"],
          ["旁白", "一道一道，从低到高。"]
        ],
        clues: [{
          kind: "remember",
          pin: "stair",
          text: "她说过，她们班的人爱在这根柱子上画道道。",
          from: "楼上 · 柱子"
        }]
      }
    ]
  };

  // 互动点的纵向站位：墙上的东西在墙根，垃圾桶在靠前一点的地面。
  // 玩家不必精确站到某条线上，但站在镜头最前面时够不到墙根。
  const SPOT_Y = {
    door: 214, board: 214, sill: 214, plate: 214,
    rail: 214, can: 226, ledge: 214, column: 214
  };
  Object.keys(POINTS).forEach(function (scene) {
    POINTS[scene].forEach(function (p) { p.y = SPOT_Y[p.id] == null ? 216 : SPOT_Y[p.id]; });
  });

  // ---------------------------------------------------------------- 平面图上的地点

  // x / y 是 assets/minigame/map_floor2.png（256×160）上的坐标，不是场景坐标。
  // 位置尽量贴着图上已有的标签：窗台 / 饮水 / 招领 / 教室 / 楼梯；
  // 垃圾桶和监控在图上没有字，面板里补两个小标签。
  const SPOTS = {
    classroom: { x: 52, y: 27, name: "教室" },
    windowsill: { x: 37, y: 73, name: "窗台" },
    cooler: { x: 102, y: 73, name: "饮水机" },
    bin: { x: 146, y: 73, name: "垃圾桶" },
    lostfound: { x: 183, y: 73, name: "招领处" },
    cctv: { x: 218, y: 73, name: "监控" },
    stair: { x: 238, y: 39, name: "楼梯" }
  };

  // 首通（游玩次 0）的路线：教室 → 饮水机 → 楼梯口窗台，和旧版一致。
  const FIRST_ROUTE = CARD_SPOTS[0].route;

  // 三级提示。前两条不说具体位置；第三条按这一轮的落点换。
  const HINTS = [
    "你先别翻了。她上午就出去过一次，就一会儿。",
    "出去那次是接水。接水得刷卡。"
  ];

  // 线索分四类：亲眼看见 / 我记得 / 我猜的 / 问到的。
  // 「问到的」是这一版新加的一类，和前三类并列摆在线索本里。
  const KIND = {
    see: { label: "亲眼看见", cls: "k-see" },
    remember: { label: "我记得", cls: "k-rem" },
    guess: { label: "我猜的", cls: "k-gue" },
    ask: { label: "问到的", cls: "k-ask" }
  };

  // 八个观察点的位置索引：自检按 id 走到点位上，不用背坐标。
  const POINT_INDEX = {};
  Object.keys(POINTS).forEach(function (scene) {
    POINTS[scene].forEach(function (p) {
      POINT_INDEX[p.id] = { id: p.id, scene: scene, x: p.x, y: p.y, r: p.r, label: p.label };
    });
  });

  /** 第 n 次游玩的这一轮：落点、路线、真线索、问话答案、印证版。
   *  纯数据，自检可以直接求解「仅凭真线索能不能唯一确定落点」。 */
  function roundInfo(n) {
    const si = spotIndexForRun(n);
    const s = CARD_SPOTS[si];
    return {
      n: n,
      spotIndex: si,
      spot: {
        id: s.id, name: s.name, place: s.place, short: s.short,
        scene: s.scene, x: s.x, y: s.y, standY: s.standY,
        dest: s.dest, findHint: s.findHint, findFirst: s.findFirst
      },
      route: s.route.slice(),
      routeNames: s.route.map(function (id) { return SPOTS[id].name; }),
      dest: s.dest,
      destName: SPOTS[s.dest].name,
      truePoints: s.truePoints.slice(),
      variants: JSON.parse(JSON.stringify(s.variants)),
      answers: JSON.parse(JSON.stringify(s.answers)),
      confirms: JSON.parse(JSON.stringify(s.confirms)),
      hint3: s.hint3,
      points: JSON.parse(JSON.stringify(POINT_INDEX)),
      spots: JSON.parse(JSON.stringify(SPOTS))
    };
  }

  /** 跨场景步数的收尾评价。只影响措辞，不进任何存档字段。 */
  function stepVerdict(n) {
    if (n <= 3) return ["由乃", "你心里有谱啊，都没怎么绕。"];
    if (n >= 7) return ["由乃", "腿都跑细了吧你。"];
    return ["由乃", "跑了几趟，也不算白跑。"];
  }

  // ---------------------------------------------------------------- 游戏

  D.games.search = function (host) {
    // 每个场景各有一小队路人。换场景时只放当前这一队出来，
    // 免得楼上楼下的人影被同一批对象带着走。
    const crowds = {
      corridor: D.createCrowd({ count: 2, xMin: 46, xMax: 468, yMin: 202, yMax: 211, size: 0.78, alpha: 0.6, speed: 20, seed: 11 }),
      stair: D.createCrowd({ count: 2, xMin: 64, xMax: 456, yMin: 202, yMax: 211, size: 0.78, alpha: 0.6, speed: 18, seed: 22 }),
      railing: D.createCrowd({ count: 2, xMin: 52, xMax: 466, yMin: 202, yMax: 211, size: 0.78, alpha: 0.6, speed: 21, seed: 33 })
    };
    const walkers = [];
    Object.keys(crowds).forEach(function (k) {
      crowds[k].actors.forEach(function (a) { a.scene = k; walkers.push(a); });
    });

    const ex = D.createExplore({
      scenes: SCENES,
      start: "corridor",
      x: 150,
      dir: 1,
      y: 228,
      actors: [GIRL, FRIEND].concat(walkers),
      drawBack: drawBack,
      onScene: onScene
    });

    // 本场第几次游玩 → 这一轮的落点。计数在完成时落盘（刷新重进沿用同一轮）。
    const runs = Math.max(0, Number(D.store.searchRuns) || 0);
    const round = roundInfo(runs);
    const cardSpot = CARD_SPOTS[round.spotIndex];
    const hintList = HINTS.concat([round.hint3]);
    let steps = 0;                  // 跨场景次数（只影响收尾措辞）
    const confirmed = {};            // "观察点|pin" → 问过关键问题之后的印证版文本

    const el = {
      btn: document.getElementById("nbBtn"),
      nb: document.getElementById("nb"),
      list: document.getElementById("nbList"),
      empty: document.getElementById("nbEmpty"),
      hintBtn: document.getElementById("nbHint"),
      mapBtn: document.getElementById("nbMap"),
      close: document.getElementById("nbClose"),
      msg: document.getElementById("msg"),
      map: document.getElementById("map"),
      mapWrap: document.getElementById("mapWrap"),
      mapRoute: document.getElementById("mapRoute"),
      mapCount: document.getElementById("mapCount"),
      mapCheck: document.getElementById("mapCheck"),
      mapClose: document.getElementById("mapClose"),
      mapSaid: document.getElementById("mapSaid"),
      mapPick: document.getElementById("mapPick"),
      mapPickLead: document.getElementById("mapPickLead"),
      mapPickList: document.getElementById("mapPickList"),
      mapPickClose: document.getElementById("mapPickClose")
    };
    // 问人的面板：不往 daily.html 里加东西，起场时按现有样式（.give-back）建。
    const askEl = document.createElement("div");
    askEl.id = "askBox";
    askEl.className = "give-back";
    askEl.hidden = true;
    const askLead = document.createElement("p");
    askLead.id = "askLead";
    const askBtns = document.createElement("div");
    askBtns.id = "askBtns";
    askBtns.className = "row";
    const askSaid = document.createElement("p");
    askSaid.id = "askSaid";
    askSaid.style.cssText = "margin:8px 0 0;font-size:clamp(13px,1.2vw,16px);line-height:1.6;color:#f6ecdf;text-align:left;";
    askEl.append(askLead, askBtns, askSaid);
    const stageEl = document.getElementById("stage");
    if (stageEl) stageEl.appendChild(askEl);
    let askOpen = false;
    let askWho = null;

    let state = "intro";        // intro | search | found | done
    let clues = [];
    let hints = 0;
    let near = null;
    let nbOpen = false;
    let mapOpen = false;
    let mapBuilt = false;
    let pins = [];              // 玩家钉上的地点 id，按点击先后排 —— 顺序就是答案的一部分
    let pinClue = {};           // 地点 id → 用来钉它的那条线索；取消时放回线索池
    let pickFor = null;         // 正在等证据的地点
    let routeSolved = false;
    let routeTries = 0;
    let msgTimer = 0;

    // ---- 主动互动 ----------------------------------------------------------
    // F 是自言自语 / 随口问一句，不是提示：不碰 hints、不动线索本、不给方向。
    // 「问问由乃」那三级提示是另一套东西，次数不能被这里吃掉。
    let pokeCount = 0, lastPoke = -9, mumbleIdx = 0;
    let idleT = 0, idleReacted = false;
    let returnChoice = -1;          // -1 = 没选（超时照常往下走）
    let choiceTimer = 0, choiceKey = null;
    const MUMBLE = [
      { me: "她上午到底去哪儿了……", who: "由乃", back: "我哪能一直盯着她。" },
      { me: "会不会压根没带出来？", who: "由乃", back: "那就更找不着了。" },
      { me: "先上楼看一眼吧。", who: "由乃", back: "随你，慢点走。" }
    ];

    // ---------------------------------------------------------------- 线索本

    function updateBadge() {
      el.btn.querySelector("b").textContent = String(clues.length);
      el.btn.classList.toggle("has", clues.length > 0);
    }

    function renderNotebook() {
      el.list.innerHTML = "";
      const order = ["see", "remember", "guess", "ask"];
      let any = false;
      for (const k of order) {
        for (const c of clues) {
          if (c.kind !== k) continue;
          any = true;
          const li = document.createElement("li");
          li.className = KIND[k].cls;

          const tag = document.createElement("i");
          tag.textContent = KIND[k].label;

          const span = document.createElement("span");
          span.textContent = c.text;

          const em = document.createElement("em");
          em.textContent = c.from;

          // 「问到的」这一类没有单独的 CSS 类，用内联样式给一个能认出来的颜色，
          // 不动 daily.css。
          if (k === "ask") {
            li.style.borderLeftColor = "#8fb98a";
            li.style.background = "#232b25";
            tag.style.color = "#a9d6a0";
          }

          li.append(tag, span, em);
          el.list.appendChild(li);
        }
      }
      el.empty.hidden = any;
      el.hintBtn.disabled = hints >= hintList.length;
      el.hintBtn.textContent = hints >= hintList.length ? "问过了" : "问问由乃";
    }

    /** 线索本的图例在 daily.html 里只写了三类，第四类「问到的」起场时补上。 */
    function ensureLegend() {
      const legend = document.querySelector("#nb .nb-legend");
      if (!legend || legend.dataset.ask) return;
      legend.dataset.ask = "1";
      legend.appendChild(document.createTextNode("　·　"));
      const i = document.createElement("i");
      i.textContent = "问到的";
      i.style.color = "#a9d6a0";
      i.style.fontStyle = "normal";
      legend.appendChild(i);
      legend.appendChild(document.createTextNode("是她们说的"));
    }

    function openNotebook() {
      if (nbOpen || state !== "search") return;
      nbOpen = true;
      renderNotebook();
      el.nb.hidden = false;
      requestAnimationFrame(function () { el.nb.classList.add("show"); });
      ex.enable(false);
      D.hint(null);
    }

    function closeNotebook() {
      if (!nbOpen) return;
      nbOpen = false;
      el.nb.classList.remove("show");
      setTimeout(function () { if (!nbOpen) el.nb.hidden = true; }, 200);
      if (state === "search") ex.enable(true);
    }

    function addClues(list) {
      for (const c of list) {
        if (clues.some(function (x) { return x.text === c.text; })) continue;
        clues.push(c);
      }
      updateBadge();
      refreshBadges();
    }

    // ---------------------------------------------------------------- 问人
    // 回到教室门口，可以分别问朱里和由乃，每人 3 个问题。答案算第四类线索
    // 「问到的」进线索本；关键问题问过之后，对应观察点的那条线索会换成
    // 印证版——「问到的」和「看到的」就对上了。不限次数、不扣分。

    /** 站在她俩谁跟前。范围比观察点小，免得盖住门缝 / 牌子。 */
    function personNear() {
      if (ex.scene !== "corridor") return null;
      const a = ex.actor;
      for (const who of ["girl", "friend"]) {
        const p = who === "girl" ? GIRL : FRIEND;
        if (Math.abs(a.x - p.x) <= 15 && Math.abs(a.y - p.y) <= 18) return who;
      }
      return null;
    }

    function renderAsk() {
      askBtns.innerHTML = "";
      askSaid.textContent = "";
      if (!askWho) {
        askLead.textContent = "回教室门口了。问谁？";
        for (const who of ["girl", "friend"]) {
          const b = document.createElement("button");
          b.type = "button";
          b.dataset.who = who;
          b.textContent = ASK_NAME[who];
          b.addEventListener("click", function () { askWho = who; renderAsk(); });
          askBtns.appendChild(b);
        }
      } else {
        askLead.textContent = ASK_NAME[askWho] + "——问什么？";
        ASK[askWho].forEach(function (q, i) {
          const b = document.createElement("button");
          b.type = "button";
          b.dataset.q = String(i);
          b.textContent = q;
          b.addEventListener("click", function () { askQuestion(askWho, i); });
          askBtns.appendChild(b);
        });
        const back = document.createElement("button");
        back.type = "button";
        back.dataset.back = "1";
        back.textContent = "换个人";
        back.addEventListener("click", function () { askWho = null; renderAsk(); });
        askBtns.appendChild(back);
      }
      const close = document.createElement("button");
      close.type = "button";
      close.dataset.close = "1";
      close.textContent = "先不问";
      close.addEventListener("click", closeAsk);
      askBtns.appendChild(close);
    }

    function openAsk() {
      if (askOpen || state !== "search") return;
      askOpen = true;
      askWho = null;
      renderAsk();
      askEl.hidden = false;
      requestAnimationFrame(function () { askEl.classList.add("show"); });
      ex.enable(false);
      D.hint(null);
      D.audio.click();
    }

    function closeAsk() {
      if (!askOpen) return;
      askOpen = false;
      askEl.classList.remove("show");
      setTimeout(function () { if (!askOpen) askEl.hidden = true; }, 200);
      if (state === "search") ex.enable(true);
    }

    /** 把某条线索换成问出来的印证版（问之前 / 问之后看到的都换）。 */
    function applyConfirm(c) {
      confirmed[c.point + "|" + c.pin] = c.text;
      let hit = false;
      for (const cl of clues) {
        if (cl.kind === "ask") continue;
        if (cl.point === c.point && cl.pin === c.pin) {
          cl.text = c.text;
          hit = true;
        }
      }
      return hit;
    }

    function askQuestion(who, qi) {
      const ans = round.answers[who][qi];
      if (!ans) return;
      addClues([{
        kind: "ask",
        pin: ans.pin || null,
        point: null,
        text: ans.text,
        from: "走廊 · 问" + ASK_NAME[who]
      }]);
      let matched = false;
      for (const c of round.confirms) {
        if (c.who !== who || c.q !== qi) continue;
        if (applyConfirm(c)) matched = true;
      }
      askSaid.textContent = ans.text + (matched ? "（和刚才看到的那处对上了。）" : "");
      // 问完不用关面板：可以接着问，也可以换个人。不限次数。
      D.audio.blip();
      renderNotebook();
      if (matched && !nbOpen) D.react("我", "……对上了。", 1200);
    }

    // ---------------------------------------------------------------- 平面图

    /** 每个地点上挂几条线索。挂的是「她可能去过这儿」的证据，
     *  不是答案——尤其「我猜的」那条也会挂上去，徽章用虚线框提醒它不可靠。 */
    function clueCountAt() {
      const out = {};
      for (const c of clues) {
        if (!c.pin) continue;
        if (!out[c.pin]) out[c.pin] = { n: 0, guess: 0 };
        out[c.pin].n += 1;
        if (c.kind === "guess") out[c.pin].guess += 1;
      }
      return out;
    }

    /** 七个地点由 SPOTS 生成，坐标只写一份；HTML 里只留空的地图。 */
    function buildMap() {
      if (mapBuilt) return;
      mapBuilt = true;
      const LABELS = { bin: "垃圾桶", cctv: "监控" };
      for (const id of Object.keys(SPOTS)) {
        const s = SPOTS[id];
        const b = document.createElement("button");
        b.type = "button";
        b.className = "spot";
        b.dataset.spot = id;
        b.style.left = (s.x / 256 * 100).toFixed(2) + "%";
        b.style.top = (s.y / 160 * 100).toFixed(2) + "%";
        b.setAttribute("aria-label", s.name);
        b.title = s.name;
        const cnt = document.createElement("b");
        cnt.className = "cnt";
        cnt.hidden = true;
        b.appendChild(cnt);
        // 钉上的先后：第 1 站、第 2 站……拼路线时得按这个顺序读
        const ord = document.createElement("i");
        ord.className = "ord";
        ord.hidden = true;
        b.appendChild(ord);
        b.addEventListener("click", function () { clickSpot(id); });
        el.mapWrap.appendChild(b);
      }
      // 图上没有「垃圾桶」「监控」两个标签，补两个小字
      for (const id of Object.keys(LABELS)) {
        const s = SPOTS[id];
        const tag = document.createElement("span");
        tag.className = "map-tag";
        tag.textContent = LABELS[id];
        tag.style.left = (s.x / 256 * 100).toFixed(2) + "%";
        tag.style.top = (s.y / 160 * 100 + 8).toFixed(2) + "%";
        el.mapWrap.appendChild(tag);
      }
    }

    function refreshBadges() {
      if (!mapBuilt) return;
      const counts = clueCountAt();
      for (const b of el.mapWrap.querySelectorAll(".spot")) {
        const info = counts[b.dataset.spot];
        const cnt = b.querySelector(".cnt");
        cnt.hidden = !info;
        cnt.textContent = info ? String(info.n) : "";
        cnt.classList.toggle("gue", !!info && info.guess > 0);
      }
    }

    /** 钉上的站按点击先后编号，地图上那条线也跟着一路画过去。
     *  这让「顺序」变成看得见的东西：顺序错了，线会拐回去。 */
    function refreshPins() {
      if (!mapBuilt) return;
      for (const b of el.mapWrap.querySelectorAll(".spot")) {
        const i = pins.indexOf(b.dataset.spot);
        const on = i >= 0;
        b.classList.toggle("pin", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
        b.setAttribute("aria-label", on
          ? SPOTS[b.dataset.spot].name + "，第 " + (i + 1) + " 站，证据：" + pinClue[b.dataset.spot].text
          : SPOTS[b.dataset.spot].name);
        b.title = on
          ? SPOTS[b.dataset.spot].name + "：" + pinClue[b.dataset.spot].text
          : SPOTS[b.dataset.spot].name;
        const ord = b.querySelector(".ord");
        if (ord) {
          ord.hidden = !on;
          ord.textContent = on ? String(i + 1) : "";
        }
      }
      el.mapCount.textContent = "钉了 " + pins.length + " 个";
      // 钉到第二站才连线；线按照玩家点的先后走，拼错的时候也在
      const pts = pins.map(function (id) {
        return SPOTS[id].x + "," + SPOTS[id].y;
      }).join(" ");
      el.mapRoute.setAttribute("points", pts);
      el.map.classList.toggle("drawing", pins.length >= 2 && !routeSolved);
    }

    function openMap() {
      if (mapOpen || state !== "search") return;
      if (nbOpen) closeNotebook();
      buildMap();
      closePick();
      refreshBadges();
      refreshPins();
      if (!routeSolved) {
        el.mapSaid.textContent = pins.length >= 2
          ? "线往哪儿拐，她就往哪儿走。顺序也能点错。"
          : "她上午可能去过哪儿？";
      }
      mapOpen = true;
      el.map.hidden = false;
      requestAnimationFrame(function () { el.map.classList.add("show"); });
      ex.enable(false);
      D.hint(null);
    }

    function closeMap() {
      if (!mapOpen) return;
      closePick();
      mapOpen = false;
      el.map.classList.remove("show");
      setTimeout(function () { if (!mapOpen) el.map.hidden = true; }, 200);
      if (state === "search") ex.enable(true);
    }

    /** 还没被钉出去的线索。钉地点之前得先挑一句能证明「她来过这儿」的话。 */
    function availableClues() {
      const used = Object.keys(pinClue).map(function (id) { return pinClue[id]; });
      return clues.filter(function (c) {
        return c.pin && used.indexOf(c) < 0;
      });
    }

    function closePick() {
      pickFor = null;
      el.map.classList.remove("picking");
      el.mapPick.hidden = true;
      el.mapPickList.innerHTML = "";
    }

    function openPick(id) {
      pickFor = id;
      el.map.classList.add("picking");
      el.mapPickLead.textContent = "「" + SPOTS[id].name + "」——哪一句能证明她来过这儿？";
      el.mapPickList.innerHTML = "";
      availableClues().forEach(function (c) {
        const b = document.createElement("button");
        b.type = "button";
        const span = document.createElement("span");
        span.textContent = c.text;
        const tag = document.createElement("i");
        tag.textContent = KIND[c.kind].label + " · " + c.from;
        b.append(span, tag);
        b.addEventListener("click", function () { pickClue(c); });
        el.mapPickList.appendChild(b);
      });
      el.mapPick.hidden = false;
      D.audio.click();
      el.mapSaid.textContent = "先别急着钉——看哪一句真的指向这儿。";
    }

    /** 挑中的句子得真的属于这个地点，才钉得上。
     *  挑错只提醒一句，面板不关、线索也不扣——让她自己再读一遍。 */
    function pickClue(c) {
      if (!pickFor || routeSolved) return;
      const id = pickFor;
      if (c.pin !== id) {
        D.audio.wrong();
        el.mapSaid.textContent = "这句说的是别的地方。再读一遍它写的是哪儿。";
        return;
      }
      D.audio.right();
      pins.push(id);
      pinClue[id] = c;
      closePick();
      refreshPins();
      refreshBadges();
      sayPins();
    }

    function sayPins() {
      if (!pins.length) el.mapSaid.textContent = "她上午可能去过哪儿？";
      else if (pins.length === 1) el.mapSaid.textContent = "钉上了。接着找下一句能对上的。";
      else el.mapSaid.textContent = "线往哪儿拐，她就往哪儿走。顺序也能点错。";
    }

    /** 点地点：钉过了就取消（把证据放回线索池）；没钉过就先摊开线索让她挑。 */
    function clickSpot(id) {
      if (routeSolved) return;
      const i = pins.indexOf(id);
      if (i >= 0) {
        pins.splice(i, 1);
        delete pinClue[id];
        if (pickFor === id) closePick();
        D.audio.click();
        refreshPins();
        sayPins();
        return;
      }
      if (!availableClues().length) {
        D.audio.wrong();
        el.mapSaid.textContent = clues.some(function (c) { return c.pin; })
          ? "手里的线索都钉完了。想想还有没有别的地方没看。"
          : "还没有能钉的线索。先去走廊和楼梯口看看。";
        return;
      }
      openPick(id);
    }

    /** 地点集合对、顺序也要对。先报「多 / 少一站」，再报顺序——
     *  顺序错的时候不点名，只提醒「顺着走过的先后」，让她自己把线顺过来。 */
    function verifyRoute() {
      const ROUTE = round.route;      // 这一轮的答案路线（每一轮不一样）
      if (pins.length < ROUTE.length) {
        return { ok: false, said: "少了一站。她上午出去，不止这一会儿。" };
      }
      if (pins.length > ROUTE.length) {
        return { ok: false, said: "多了一站。有一站，我其实没看见她。" };
      }
      const same = ROUTE.every(function (id) { return pins.indexOf(id) >= 0; });
      if (!same) return { ok: false, said: "这条线对不上。再想想。" };
      for (let i = 0; i < ROUTE.length; i++) {
        if (pins[i] !== ROUTE[i]) {
          return {
            ok: false,
            said: routeTries >= 3
              ? "地方都对。她是先出的教室，再去接的水，最后才上的楼梯。"
              : "地方都对，可顺序不对。线得顺着她走过的先后画。"
          };
        }
      }
      return { ok: true, said: "" };
    }

    function checkRoute() {
      if (!mapOpen || routeSolved) return;
      if (!pins.length) { el.mapSaid.textContent = "还没钉。先点一个地方。"; return; }
      routeTries += 1;
      const r = verifyRoute();
      if (!r.ok) {
        D.audio.wrong();
        el.mapSaid.textContent = r.said;
        return;
      }
      solveRoute();
    }

    /** 拼对了才给的那一下：线亮起来、目标卡改口，省掉一次瞎走。
     *  存档只记「拼出来过」这个布尔，不记钉了几次、错了几次。 */
    function solveRoute() {
      routeSolved = true;
      closePick();
      D.persist({ searchRouteSolved: true });
      D.audio.right();
      el.mapRoute.setAttribute("points", round.route.map(function (id) {
        return SPOTS[id].x + "," + SPOTS[id].y;
      }).join(" "));
      el.map.classList.remove("drawing");
      el.map.classList.add("solved");
      el.mapCheck.disabled = true;
      el.mapCheck.textContent = "就是这条";
      el.mapSaid.textContent = "那就是这条。先出教室，去" + SPOTS[round.route[1]].name +
        "，最后到" + SPOTS[round.route[2]].name + "。";
      D.objective("帮她把校园卡找回来",
        "她上午去过 " + round.routeNames.join("、") + " —— 卡多半在" + cardSpot.place);
    }

    // ---------------------------------------------------------------- 消息

    function toast(text, ms) {
      el.msg.innerHTML = "";
      const b = document.createElement("b");
      b.textContent = "由乃";
      const p = document.createElement("span");
      p.textContent = text;
      el.msg.append(b, p);
      el.msg.classList.add("show");
      clearTimeout(msgTimer);
      msgTimer = setTimeout(function () { el.msg.classList.remove("show"); }, ms || 5200);
    }

    function askFriend() {
      if (hints >= hintList.length) return;
      // 第一次问的时候她在走廊里看不见你，所以先问一句「你在哪儿呢」
      const text = hints === 0 ? "你在哪儿呢。　" + hintList[0] : hintList[hints];
      hints += 1;
      toast(text);
      D.audio.click();
      renderNotebook();
    }

    function poke() {
      if (state !== "search" || nbOpen || mapOpen || askOpen || D.dialogOpen()) return;
      if (ex.t - lastPoke < 1.0) return;
      lastPoke = ex.t;
      const m = MUMBLE[mumbleIdx++ % MUMBLE.length];
      pokeCount++;
      D.audio.blip();
      // 故意不写 hints += 1，也不调 toast()：这不是向她求助，只是自己嘀咕一句
      D.react("我", m.me, 1000);
      D.react(m.who, m.back, 1700);
    }

    /** 找到卡之后：怎么还给她。三个说法只改收尾第一句，不改结局、不记分。
     *  不选也照样往下走（4 秒后自动用默认），所以不拦关、不逼玩家做选择。 */
    function chooseReturn() {
      return new Promise(function (resolve) {
        const box = document.getElementById("giveBack");
        box.hidden = false;
        requestAnimationFrame(function () { box.classList.add("show"); });
        let done = false;

        function finish(i) {
          if (done) return;
          done = true;
          clearTimeout(choiceTimer);
          window.removeEventListener("keydown", onKey);
          choiceKey = null;
          box.classList.remove("show");
          setTimeout(function () { box.hidden = true; }, 200);
          returnChoice = i;
          D.reactHint(false);
          if (i >= 0) {
            D.react("我", ["给，找到了。", "放你桌上了。", "朱里——"][i], 1200);
          }
          resolve(i);
        }
        function onKey(e) {
          if (e.key === "1" || e.key === "2" || e.key === "3") finish(Number(e.key) - 1);
          else if (e.key === "f" || e.key === "F" || e.key === "Enter" || e.key === " ") finish(0);
        }
        box.onclick = function (e) {
          const b = e.target.closest("button[data-i]");
          if (b) finish(Number(b.dataset.i));
        };
        window.addEventListener("keydown", onKey);
        choiceKey = onKey;
        // 给玩家留出真的想一想的时间。3.6 秒连读完三个选项都紧，
        // 更别说选；不选也会自己往下走，这里放宽到 6 秒。
        choiceTimer = setTimeout(function () { finish(-1); }, 6000);
      });
    }

    // ---------------------------------------------------------------- 看东西

    /** 这一处这一轮该产出的线索：真线索点用变体，其余点用原来那组观察。
     *  问过关键问题的，换成印证版文本。 */
    function cluesForPoint(p) {
      const base = (round.variants[p.id] || p.clues);
      return base.map(function (c) {
        const conf = confirmed[p.id + "|" + c.pin];
        const out = {};
        for (const k in c) out[k] = c[k];
        out.point = p.id;
        if (conf) out.text = conf;
        return out;
      });
    }

    async function look(p) {
      ex.enable(false);
      D.hint(null);
      await D.lines(p.lines);
      addClues(cluesForPoint(p));
      D.audio.click();
      // 玩家刚看完一处，马上落一句自己的反应，别让「记线索」像交作业
      D.react("我", "记一下。", 1200);
      ex.enable(true);
    }

    // ---------------------------------------------------------------- 找到

    async function find() {
      state = "found";
      ex.enable(false);
      D.hint(null);
      D.reactHint(false);
      D.clearReact();
      await D.lines([
        ["旁白", cardSpot.findFirst],
        ["我", routeSolved ? "……果然在这儿。" : "……还真是这儿。"],
        ["旁白", "卡的边角被晒得有点卷。上面是她的照片，头发比现在短。"]
      ]);

      // 还卡之前让玩家拿一下主意。不选也会自己往下走，不拦关。
      await chooseReturn();

      await D.fadeTo(1, 300);
      ex.jump("corridor", 150, 1);
      host.setChapter("走廊");
      await D.fadeTo(0, 300);

      await closing();

      state = "done";
      el.btn.hidden = true;
      D.objective(null);
      D.hint(null);
      D.persist({
        searchCompleted: true,
        searchRuns: runs + 1,
        searchClues: clues.length,
        searchHints: hints,
        searchRouteSolved: routeSolved
      });
      host.done({
        id: "search",
        completed: true,
        clues: clues.length,
        total: 9,
        hints: hints,
        steps: steps,
        spot: cardSpot.id,
        early: clues.length <= 2
      });
    }

    /** 收尾按「看了多少」分三种说法。三种都只说她怎么反应，不说她高不高兴。
     *  「怎么还」那一步只给最前面添一句，不改后面任何一句、不改结局。
     *  跨场景步数只往中间加一句评价（少步数 / 多步数口径），也不进存档。 */
    function closing() {
      const lead = returnChoice === 1 ? [["我", "放你桌上了。"]]
                 : returnChoice === 2 ? [["我", "朱里——找到了。"]]
                 : [];
      const txt = SPOT_TEXT[cardSpot.id] || {
        echo: cardSpot.short + "？", low: "……在" + cardSpot.place + "。",
        detail: "就在那儿。", mid: cardSpot.place + "。"
      };
      let base;
      if (clues.length <= 2) {
        base = [
          ["由乃", "这么快？"],
          ["我", txt.low],
          ["朱里", txt.echo],
          ["我", "嗯。" + txt.detail],
          ["由乃", "你怎么直接就找到了。"],
          ["我", "……运气。"],
          ["朱里", "……谢谢。"]
        ];
      } else if (clues.length <= 6) {
        base = [
          ["由乃", "找到了？"],
          ["我", txt.mid],
          ["朱里", "我上午去接水……"],
          ["朱里", "……你怎么知道。"],
          ["我", "门没关严，笔帽没盖。你走得太急了。"],
          ["朱里", "……"],
          ["由乃", "行了行了，快去食堂吧。"]
        ];
      } else {
        base = [
          ["朱里", "……你去了楼上？"],
          ["我", "嗯。"],
          ["由乃", "他把整栋楼都看了一遍。"],
          ["朱里", "为什么。"],
          ["我", "……不为什么。"],
          ["旁白", "她低下头，把卡塞回卡套。卡套上挂着一个小小的挂件。"],
          ["旁白", "我没问她为什么一直不挂在脖子上。"]
        ];
      }
      const body = base.slice();
      body.splice(Math.max(1, body.length - 2), 0, stepVerdict(steps));
      return D.lines(lead.concat(body));
    }

    // ---------------------------------------------------------------- 换场景

    function onScene(name, first) {
      if (state !== "search") return;
      steps += 1;                         // 跨场景次数：只用来决定收尾措辞
      if (!first) return;
      if (name === "stair") {
        D.lines([["旁白", "楼梯口的窗户开着，风一阵一阵灌进来。"]]);
      } else if (name === "railing") {
        D.lines([["旁白", "楼上比楼下安静。操场上有人在跑。"]]);
      }
    }

    // ---------------------------------------------------------------- 生命周期

    async function start() {
      D.clearReact();
      D.onPoke(poke);
      host.setChapter("走廊");
      D.objective("帮她把校园卡找回来", "她上午出去过一趟 —— 到处看看，按 E");
      el.btn.hidden = false;
      updateBadge();
      renderNotebook();
      ensureLegend();

      el.btn.onclick = function () { nbOpen ? closeNotebook() : openNotebook(); };
      el.close.onclick = closeNotebook;
      el.hintBtn.onclick = askFriend;
      el.mapBtn.onclick = openMap;
      el.mapCheck.onclick = checkRoute;
      el.mapClose.onclick = closeMap;
      el.mapPickClose.onclick = closePick;

      ex.enable(false);
      await D.fadeTo(0, 420);
      await D.sleep(220);

      await D.lines([
        ["旁白", "周三，中午。走廊里只剩几个赶着去食堂的人。"],
        ["朱里", "……等一下。"],
        ["我", "怎么了？"],
        ["朱里", "卡不见了。校园卡。"],
        ["由乃", "书包翻两遍了。"],
        ["朱里", "中午还得去食堂。"],
        ["由乃", "你去帮她找找？她上午就出去过一趟，就一会儿。"],
        ["我", "……行。"],
        ["朱里", "要是找不到就算了，我下午去补办。"],
        ["我", "先找找。"]
      ]);

      state = "search";
      ex.enable(true);
      D.reactHint("F · 自言自语");
      D.hint("WASD 走路　Tab 打开线索本", 3600);
    }

    function update(dt) {
      ex.update(dt);

      // 她们只在走廊门口等。extras 是全局画一遍的，不在这儿关掉，
      // 玩家上楼的时候会看见她俩也站在楼梯口——她们根本没跟过来。
      const atDoor = ex.scene === "corridor";
      GIRL.hidden = !atDoor;
      FRIEND.hidden = !atDoor;

      for (const k in crowds) {
        const here = ex.scene === k;
        crowds[k].setHidden(!here);
        if (here) crowds[k].update(dt);
      }

      if (state !== "search" || nbOpen || mapOpen || askOpen || D.dialogOpen()) { near = null; return; }

      // 站太久就自己嘀咕一句。不是提示，不给方向。
      if (D.axisX() !== 0 || D.axisY() !== 0) { idleT = 0; idleReacted = false; }
      else {
        idleT += dt;
        if (idleT > 6 && !idleReacted) {
          idleReacted = true;
          D.react("我", "……先从哪儿看起。", 1500);
        }
      }

      // 观察点优先：门缝 / 牌子这些互动点离她俩不远，站在点位上按 E 时
      // 不该被「问人」抢掉。问人只在站在她俩跟前时才亮提示。
      near = null;
      for (const p of POINTS[ex.scene] || []) {
        if (p.used) continue;
        if (ex.near(p.x, p.y, p.r, 20)) { near = p; break; }
      }
      if (near) { D.hint("E · " + near.label, 0); return; }

      const who = personNear();
      if (who) { D.hint("E · 问问" + ASK_NAME[who], 0); return; }

      // 卡自己不是「互动点」——它一直躺在那儿，走过去按 E 就捡。
      // 没听过任何线索也捡得起来，这是设计稿明确要求的。
      if (ex.scene === cardSpot.scene && ex.near(cardSpot.x, cardSpot.standY, 46, 20)) {
        D.hint(cardSpot.findHint, 0);
        return;
      }
      D.hint(null);
    }

    function press(key) {
      if (askOpen) {
        if (key === "Escape") closeAsk();
        return;
      }
      if (mapOpen) {
        if (key === "Tab" || key === "Escape") closeMap();
        return;
      }
      if (key === "Tab") { nbOpen ? closeNotebook() : openNotebook(); return; }
      if (key === "Escape") { if (askOpen) closeAsk(); else closeNotebook(); return; }
      if (nbOpen) return;
      if (state !== "search") return;
      if (D.dialogOpen()) return;

      const k = key.toLowerCase();
      if (k !== "e" && key !== "Enter") return;

      if (near && !near.used) {
        near.used = true;
        look(near);
        return;
      }
      const who = personNear();
      if (who) { openAsk(); return; }
      if (ex.scene === cardSpot.scene && ex.near(cardSpot.x, cardSpot.standY, 46, 20)) {
        find();
        return;
      }
    }

    function draw(ctx) {
      ex.draw(ctx);
      if (near) drawPrompt(ctx, near.x);
    }

    // ---------------------------------------------------------------- 绘制

    function drawPrompt(ctx, x) {
      const y = 150 + Math.sin(ex.t * 4) * 2;
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "rgba(20,16,22,.78)";
      ctx.fillRect(x - 9, y - 8, 18, 16);
      ctx.strokeStyle = "rgba(255,226,180,.9)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 8.5, y - 7.5, 17, 15);
      ctx.fillStyle = "#ffe2b4";
      ctx.font = 'bold 11px "Microsoft YaHei",sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("E", x, y);
      ctx.restore();
    }

    /** 这一轮落点上那张卡。走近了才有一点反光，不走近就是一块很不起眼的白。
     *  找到之后先别急着擦掉——旁白还在说「压着一张卡」，
     *  画面上却空了，等于把话说了一半。等离开这个场景再收。 */
    function drawBack(ctx, scene, t) {
      if (scene !== cardSpot.scene) return;
      if (state === "done") return;

      const x = cardSpot.x, y = cardSpot.y;
      ctx.save();

      // 「开水房刷卡机旁边」得让玩家看见刷卡机，不然那条线索落不了地。
      // 只用 Canvas 画几个方块，不新增图片素材。
      if (cardSpot.id === "waterReader") {
        ctx.globalAlpha = 0.92;
        ctx.fillStyle = "#4a4d55";
        ctx.fillRect(x - 22, y - 44, 44, 30);
        ctx.fillStyle = "#5c606a";
        ctx.fillRect(x - 22, y - 44, 44, 4);
        ctx.fillStyle = "#23262c";
        ctx.fillRect(x - 14, y - 34, 20, 10);       // 刷卡区
        ctx.fillStyle = "#8fd6a0";
        ctx.fillRect(x + 10, y - 32, 4, 4);         // 绿灯
        ctx.fillStyle = "rgba(255,226,180,.72)";
        ctx.font = '7px "Microsoft YaHei",sans-serif';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("开水房", x, y - 50);
      }

      ctx.globalAlpha = 0.3;
      ctx.fillStyle = "#2b2b33";
      ctx.fillRect(x - 5, y - 1, 11, 3);       // 卡压着的影子

      ctx.globalAlpha = 1;
      ctx.fillStyle = "#2f3238";
      ctx.fillRect(x - 5, y - 12, 10, 12);     // 一圈深色边，不然白卡会溶进背景
      ctx.fillStyle = "#f4f1e6";
      ctx.fillRect(x - 4, y - 11, 8, 10);
      ctx.fillStyle = "#5f86a8";
      ctx.fillRect(x - 4, y - 11, 8, 3);       // 顶上那道蓝
      ctx.fillStyle = "#c8c0ae";
      ctx.fillRect(x - 3, y - 7, 2, 2);        // 照片
      ctx.fillRect(x - 3, y - 4, 5, 1);
      ctx.fillRect(x - 3, y - 2, 4, 1);

      if (Math.abs(ex.actor.x - x) < 120) {
        const k = 0.5 + 0.5 * Math.sin(t * 3.4);
        ctx.globalAlpha = 0.2 + k * 0.5;
        ctx.fillStyle = "#fffdf2";
        ctx.fillRect(x + 3, y - 12, 2, 1);
      }
      ctx.restore();
    }

    return {
      id: "search",
      title: "校园寻物",
      start: start,
      update: update,
      draw: draw,
      press: press,
      setFrozen: function (v) { ex.enable(!v); },
      dispose: function () {
        D.onPoke(null);
        D.reactHint(false);
        D.clearReact();
        clearTimeout(choiceTimer);
        if (choiceKey) { window.removeEventListener("keydown", choiceKey); choiceKey = null; }
        const box = document.getElementById("giveBack");
        if (box) { box.classList.remove("show"); box.hidden = true; }
        if (askOpen) closeAsk();
        askEl.classList.remove("show");
        askEl.hidden = true;
        if (askEl.parentNode) askEl.parentNode.removeChild(askEl);
        mapOpen = false;
        closePick();
        el.map.classList.remove("show");
        el.map.hidden = true;
        el.btn.hidden = true;
      },
      get state() { return state; },
      get scene() { return ex.scene; },
      get x() { return ex.actor.x; },
      get y() { return ex.actor.y; },
      get clues() { return clues; },
      get hints() { return hints; },
      get pokeCount() { return pokeCount; },
      get returnChoice() { return returnChoice; },
      get girlVisible() { return !GIRL.hidden; },
      get mapOpen() { return mapOpen; },
      get askOpen() { return askOpen; },
      get steps() { return steps; },
      get runs() { return runs; },
      get round() { return round; },
      get confirmed() { return Object.assign({}, confirmed); },
      get pins() { return pins.slice(); },
      get evidence() { return Object.assign({}, pinClue); },
      get pickFor() { return pickFor; },
      get routeSolved() { return routeSolved; },
      get routeTries() { return routeTries; },
      get nearPoint() { return near ? near.id : null; },
      get cardSpot() {
        return {
          id: cardSpot.id, name: cardSpot.name, place: cardSpot.place,
          scene: cardSpot.scene, x: cardSpot.x, y: cardSpot.y,
          standY: cardSpot.standY, dest: cardSpot.dest, findHint: cardSpot.findHint
        };
      },
      spots: SPOTS,
      route: round.route.slice(),
      cardX: cardSpot.x
    };
  };

  // 自检 / 调试用：每一轮的数据是纯函数，不用真玩也能求解验证。
  D.games.search.roundInfo = roundInfo;
  D.games.search.stepVerdict = stepVerdict;
  D.games.search.CARD_SPOTS = CARD_SPOTS;

})(window);

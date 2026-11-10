# 黑板报 → 广播室过场模块

入口：[index.html](index.html)。直接双击可预览；从黑板报页面的完成卡点“继续 · 广播室”，或未完成退出卡点“先去广播室”，会带入 `?board=done|deferred`。

模块不依赖 `school-preview.html`，也不修改它。当前做到分镜 01–07：黑板报前退开、时间切换、走廊走到广播室、推门进入、和臣到共用播音桌左侧座位、回头看见右侧门口的朱里、朱里走到同一张桌子的右侧麦克风前。结尾的“开始广播”接入 `../../act3/broadcast.html?from=bridge`。

## 开场回响（读第二幕存档）

黑板上那段退开镜头之后，开场对白会读第二幕的 `our-story-act2-board-eval-v1`（存在才读）：

- 有主题和评价句时，朱里会补一句「<主题>那块板……你当时说「<第一句评价>」。我记得。」
- 存档里没有这个键（旧档）就维持原来那句旁白，不报错、不多话。

第四幕回忆用同一份存档里的 `evals: [{ id, text }]` 整句文本，所以不同页面不需要 import `act2/lines.js`。

## 分镜 03：风吹稿纸（小游戏）

走廊段走到中段（x ≥ 150）时，穿堂风把稿纸吹散 **3 张**：稿纸沿抛物线飘落，地上有个淡淡的圈标出落点。

- 走到落点附近（横向 30px）按 `E` 接住；接住几张只做记录，**不拦路**——`D` 一直按着也能继续走，接不接不影响后续剧情。
- 落点由种子（`PAPERS.seed = 20261109`）决定，同一份数据每次加载一致（自检比对两次加载的落点）。
- 结果写 `localStorage` 键 `our-story-bridge-papers-v1`：整数 **0–3**；没写过这个键时读取方按 **3（全接住）** 兜底，第三幕开场白按这个数走一句变体字幕。
- 走出走廊时再补写一次，接住的张数在接住当下就落盘。

## 空间与操作

- 走廊的广播室门位于右侧；室内同一侧也是门。和臣从右门进入，向左走到前景桌位坐下。
- 和臣坐在唯一播音桌的左侧，麦克风就在面前。门在他身后的右边，因此听见门响后回头看朱里是成立的。
- 朱里从右侧门拿着稿纸进入，走到同一张桌子的右侧，先把稿纸递到桌边，再坐下。CG 和后续像素场景都保持门打开。
- 人物使用 v2 的 48×72 帧：和臣走近、入座、回头；朱里持稿入门、走近、递稿、入座。播音桌和麦克风按前景层遮挡下半身。
- 走廊按住 `D` / `→`，室内按住 `A` / `←`；可点“走过去”自动行走。到门／座位后按 `E` 或点按钮。对白用 `E`、`Enter` 或点击推进。

## 文件

| 文件 | 用途 |
| --- | --- |
| `index.html` / `styles.css` / `bridge.js` | 独立过场与状态机 |
| `layout.js` | 512×288 场景锚点、人物脚点和桌沿遮挡基准 |
| `assets/broadcast_corridor.png` | 512×288 的新走廊段，广播室门关闭 |
| `assets/broadcast_corridor_open.png` | 同门打开状态 |
| `assets/broadcast_room_single_desk.png` | 512×288 室内，唯一共用播音桌与关闭的右门 |
| `assets/broadcast_room_single_desk_open.png` | 同构图，右门打开并接到走廊 |
| `assets/cg_turn_to_zhuli_single_desk.png` | 和臣坐在桌后回望右侧门口的 CG |
| `assets/*_source.png` | 生图模型生成的高分辨率源稿，保留用于修改；游戏读取上述 512×288 场景图 |

角色复用 `../../assets/characters/{boy,girl}/v2/*_sheet_v2.png`。黑板作品预览由 `scene2.js` 在进入本模块前保存到 `localStorage` 的 `our-story-act2-board-preview-v1`；没有预览时回退到画板存档。广播互动接入时可从 `ready` 状态继续。调试口 `window.__broadcastBridge` 暴露 `scene / boyX / papers / papersCaught / papersSpawned / papersStored / boardEval` 和 `enter / setBoyX / catchPaper`，自检用。`node tools/check-handoff.cjs` 会验证递稿过渡、开场回响与风里稿纸，并生成 `handoff-preview.png` / `papers-preview.png`。

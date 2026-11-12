(() => {
  'use strict';
  const base = '../assets/';
  const bg = document.getElementById('background'), actors = document.getElementById('actors');
  const title = document.getElementById('eventTitle'), date = document.getElementById('date');
  const dialog = document.getElementById('dialog'), speaker = document.getElementById('speaker'), line = document.getElementById('line');
  const panel = document.getElementById('interaction'), end = document.getElementById('ending');
  const saveKey = 'our-story-act6-v1';
  const initial = { event: 0, event01Completed:false, yunoAskedAboutB:false,
    timingCompleted:false, timingChoice:null, timingWindow:null, timingWaits:0, timingDeferred:false,
    inquiryCompleted:false, askedFriendA:null, askedFriendB:null,
    bAndAClose:null, bHasCrush:null, reportCompleted:false, reportAccuracy:null, aAndBDating:null,
    bulletinCompleted:false, bulletinPlacements:null, bulletinTilts:null,
    bulletinLostItem:null, bulletinYunoEcho:false,
    paperPlaneCompleted:false, paperPlaneBest:null, paperPlaneStyle:null,
    paperPlaneWinner:null, paperPlaneLanded:null,
    jurieLikedABeforeTransfer:null, aDidNotReciprocate:null, yunoMotive:null,
    memoryRevisitCompleted:false, memorySegmentsSeen:0, chapter04Completed:false,
    knowledgeEvents:[] };
  let state; try { state={...initial,...JSON.parse(localStorage.getItem(saveKey)||'{}')}; } catch { state={...initial}; }
  const persist = data => {
    Object.assign(state,data);
    try { localStorage.setItem(saveKey,JSON.stringify(state)); }
    catch(error){
      // 无痕模式 / 配额满：退回内存状态继续这一局，不要因为存档写失败把事件打断。
      if(!persist.warned){persist.warned=true;console.warn('第四幕：存档写不进去，改用内存状态继续。',error);}
    }
  };
  let pending=null, running=false, dropChoice=null;
  function image(path){bg.src=base+path;}
  function scene(name,when,path,cast={}) {
    title.textContent=name;date.textContent=when;image(path);actors.replaceChildren();
    for(const [key,c] of Object.entries(cast)){
      const el=document.createElement('img');el.className='actor'+(c.small?' small':'')+(c.flip?' flip':'');
      el.src=base+c.src;el.alt=key;el.style.left=c.x+'%';el.style.top=(c.y+3.5)+'%';el.dataset.actor=key;actors.append(el);
    }
  }
  function move(key,x,y){const el=actors.querySelector(`[data-actor="${key}"]`);if(el){el.style.left=x+'%';el.style.top=(y+3.5)+'%';}}
  const boy=(x=38,y=78,src='idle_right.png')=>({src:'characters/boy/v2/'+src,x,y});
  const girl=(x=62,y=78,src='idle_left.png')=>({src:'characters/girl/v2/'+src,x,y});
  const yuno=(x=62,y=78,src='idle_left.png')=>({src:'characters/friend/v2/'+src,x,y});
  const friendA=(x=63,y=78)=>({src:'characters/act6/friend_a_idle_down.png',x,y});
  const friendB=(x=63,y=78)=>({src:'characters/act6/friend_b_idle_down.png',x,y});
  function say(who,words){speaker.textContent=who;line.textContent=words;dialog.hidden=false;return new Promise(resolve=>pending=resolve);}
  function advance(){if(pending){const resolve=pending;pending=null;dialog.hidden=true;resolve();}}
  async function lines(items){
    if(window.BGM)BGM.duck(0.55,400);
    try{
      for(const [who,words,action] of items){if(action)action();await say(who,words);}
    }finally{
      if(window.BGM)BGM.unduck(700);
    }
  }
  function choose(question,items){
    dialog.hidden=true;panel.hidden=false;panel.replaceChildren();
    const h=document.createElement('h2');h.textContent=question;panel.append(h);
    const box=document.createElement('div');box.className='options';panel.append(box);
    return new Promise(resolve=>{
      let done=false;
      const finish=index=>{
        if(done)return;done=true;
        dropChoice=null;
        document.removeEventListener('keydown',onKey);
        panel.hidden=true;resolve(index);
      };
      const onKey=event=>{
        // 对白还没读完、或者已经选过了，就不再响应数字键，避免重复选择。
        if(done||panel.hidden||pending)return;
        const n=Number(event.key);
        if(n>=1&&n<=items.length){event.preventDefault();finish(n-1);}
      };
      items.forEach((item,i)=>{
        const b=document.createElement('button');b.className='option';b.type='button';
        const no=document.createElement('i');no.className='option-no';no.textContent=String(i+1);
        b.append(no,document.createTextNode(item));
        b.onclick=()=>finish(i);
        box.append(b);
      });
      document.addEventListener('keydown',onKey);
      dropChoice=()=>{document.removeEventListener('keydown',onKey);panel.hidden=true;};
    });
  }
  function pause(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
  async function curtain(ms=400){const v=document.getElementById('veil');v.style.opacity='1';await pause(ms);v.style.opacity='0';}
  const door='scenes/school_corridor_door_pixel.png', railing='scenes/school_corridor_railing_pixel.png';
  const stairs='../act4/after-broadcast/assets/stairwell.png', board='scenes/school_corridor_board_lowered_512.png';
  const field='scenes/school_exterior_pixel.png';

  // 校园自由探索按时间段维持底色；事件本身只在覆盖时段/情绪时才换曲。
  // 事件 09 的 memory 只覆盖那一场，回到校园仍是 dusk。
  function campusTrack(index){
    if(index<=2)return 'morning';
    if(index<=6)return 'afternoon';
    return 'dusk';
  }
  function eventTrack(index){
    if(index<=2)return 'morning';
    if(index<=6)return 'afternoon';
    if(index===7)return 'dusk';
    if(index===8)return 'memory';
    return 'dusk';
  }

  async function event01(){
    scene('还本子的早上','第二周 · 周二早读前 · 三班门口',door,{和臣:boy(24,82),朱里:girl(72,82)});
    await lines([['旁白','朱里在窗台边放下书包。我把本子从书包里拿出来。'],['朱里','你还特地送过来。'],['和臣','顺路。']]);
    move('和臣',43,82);await pause(800);
    const answer=await choose('把本子递给朱里时……',['问她昨天贴到几点','只说“本子还你”','放下本子就走']);
    if(answer===0)await lines([['和臣','昨天贴到几点？'],['朱里','比平时晚一点。还好有由乃帮忙。']]);
    else if(answer===1)await lines([['和臣','本子还你。'],['朱里','嗯，谢谢。']]);
    else await lines([['朱里','和臣。谢谢你送过来。']]);
    await lines([['旁白','她翻了两页，又把本子合上。'],['朱里','今天放学可能还要留一会儿。'],['和臣','又要贴通知？'],['朱里','不是。整理点东西。'],['旁白','她没有提那一页。我也没有问。']]);
    persist({event01Completed:true});
  }
  async function event02(){
    scene('由乃的催促','周二 · 第二节课间 · 楼梯口',stairs,{和臣:boy(),由乃:yuno()});
    await lines([['由乃','问了吗？'],['和臣','……还没。'],['由乃','不着急。但别拖到她自己来问我。'],['和臣','她自己？'],['由乃','随口说的。你别多想。']]);
    image('cg/act6/cg04_01_yuno_request_512.png');actors.replaceChildren();
    await lines([['旁白','课间只剩几分钟。走廊上的人正往两边散。']]);
    const flow=window.ACT6Flow;
    if(!flow) throw new Error('课间时机模块未加载');
    // 先选时间点，再选行动。等几次、打铃、今天算了都不算失败，只换演出。
    const result=await playInline('事件02 课间时机',()=>flow.timing({window:state.timingWindow}));
    if(result.cancelled) return;
    const action=result.action;
    persist({
      timingCompleted:true, yunoAskedAboutB:true,
      timingChoice:action==='bell'?'wait':action,
      timingWindow:result.window, timingWaits:result.waits,
      timingDeferred:action==='giveUp'||action==='bell'
    });
    if(action==='giveUp'){
      await lines([['由乃','可以。那我去。'],['和臣','……我不是这个意思。'],['由乃','我知道。'],['旁白','她把窗台边的书包背上，先往三班走了。']]);
      return;
    }
    if(action==='bell'){
      await lines([['旁白','铃响了。走廊里的人一下散干净。'],['旁白','二班的门关上了。她已经进教室了。'],['和臣','……下一次课间。']]);
      return;
    }
    if(action==='friends'){
      await lines([['由乃','行。别拖到放学。'],['旁白','我先回四班门口。朋友甲还抱着那摞作业。']]);
      return;
    }
    if(result.window==='late'){
      // 快上课了还现在过去：跑过去，铃声追上，M02 走短版本。
      await lines([['由乃','快上课了。你还去？'],['和臣','跑过去还来得及。'],['旁白','走廊里已经没什么人。我沿着墙边往二班走。']]);
      return;
    }
    await lines([['由乃','那就现在。'],['和臣','嗯。'],['旁白',result.window==='early'?'走廊里全是人。我从人群里挤过去。':'走廊里安静了些。我沿着护栏往二班走。']]);
    await playDaily('crowdrun',{window:result.window});
  }
  async function event03(){
    const windowNow=state.timingWindow;
    // 时间窗只换开场这一句；「今天算了」/打铃之后，下一次课间的第一句换成「想好了吗」。
    if(state.timingDeferred){
      scene('帮我问一句','周二 · 午休 · 楼梯口',stairs,{和臣:boy(),由乃:yuno()});
      await lines([['由乃','想好了吗？'],['和臣','……嗯。'],['由乃','那就去。问不问到都行。'],['旁白','她说完就让开了楼梯口。']]);
    }else{
      scene('帮我问一句','周二 · 午休 · 四班门口',door,{和臣:boy()});
      const opening=state.timingChoice==='friends'
        ? '先回四班门口。朋友甲还抱着那摞作业。'
        : {
          early:'刚下课，走廊里还都是人。趁现在过去。',
          middle:'课间中段，走廊里安静了些。',
          late:'快上课了，走廊里已经没什么人。'
        }[windowNow]||'午休前的走廊，人不多不少。';
      await lines([['旁白',opening],['和臣','……去问问吧。']]);
    }
    // 在四班门口 / 走廊 / 二班门口自由走：问甲、问乙、走到二班先回去，都行。
    await playGame('inquiry',{
      when:'周二 · 午休',
      window:windowNow,
      entry:state.timingDeferred?'deferred':(state.timingChoice==='friends'?'friends':'direct'),
      crowdTier:dailyStore().crowdRunTier||null
    },'事件03 打听');
    persist({inquiryCompleted:true});

    const heardA=!!state.askedFriendA&&state.askedFriendA!=='none';
    const heardB=!!state.askedFriendB&&state.askedFriendB!=='none';
    if(heardA||heardB){
      const bits=[];
      if(state.bAndAClose==='reported')bits.push('跟 A 走得挺近');
      if(state.bHasCrush==='reported')bits.push('可能有喜欢的人');
      await lines([
        ['旁白','回去的路上，我把听到的几句话在心里排了一遍。'],
        ['和臣',bits.length===1?'听说她'+bits[0]+'。':'听说她'+bits.join('，还')+'。'],
        ['旁白','都是朋友说的。没有一句是宋瑶本人说的。']
      ]);
      return;
    }
    await lines([['旁白','我在走廊里站了一会儿，什么也没问成。'],['和臣','……下次吧。']]);
  }
  async function event04(){
    // 传话搬去日常目录了。公告栏这一场做设计里的四材料四槽：
    // 本周目如果玩过传话、而且传丢了「物品」，朋友甲会把剪刀和水错带到板边——
    // 只当一句笑话，不进主线，也不改任何事实。
    scene('公告栏','周二 · 放学后 · 公共走廊',board,{和臣:boy(30,83),朱里:girl(52,83),由乃:yuno(73,83)});
    await lines([['朱里','你来得正好。帮我把这几张摆一下。'],['由乃','我负责右边。你别又把标题贴歪。'],['和臣','我什么时候贴歪过。'],['朱里','上次。'],['旁白','朱里把一叠通知摊在公告栏下面的长椅上，胶带压在旁边。']]);
    const flow=window.ACT6Flow;
    if(!flow) throw new Error('公告栏模块未加载');
    const result=await playInline('事件04 公告栏',()=>flow.bulletin({relayLost:relayLostItems()}));
    if(result.cancelled) return;
    persist({
      bulletinCompleted:true,
      bulletinPlacements:result.placements,
      bulletinTilts:result.tilts,
      bulletinLostItem:result.joke==='items'?'scissors-and-water':null
    });
    if(result.joke==='items'){
      await lines([['旁白','板边还站着朋友甲，手里拎着一把剪刀和一杯水。'],['朋友甲','……我是不是拿错了。'],['朱里','上回让你带的不是这个。']]);
    }
    await lines([['朱里','这样就行。'],['由乃','比上次整齐。'],['旁白','三个人退开半步，看了一会儿。']]);
    // 「上次那个事……」只在四样都放好之后说一次，说完不解释。
    if(!state.bulletinYunoEcho){
      await lines([['由乃','对了，上次那个事……'],['和臣','怎么了？'],['由乃','没什么。等会儿再说。'],['朱里','你们俩打什么哑谜。'],['由乃','没有。摆你的。'],['旁白','朱里低头去压平一张翘角的纸，没有追问。']]);
      persist({bulletinYunoEcho:true});
    }
  }
  async function event05(){
    scene('听来的，与猜到的','周三 · 放学后 · 楼梯口',stairs,{和臣:boy(),由乃:yuno()});
    await lines([['由乃','你说吧。问到什么了。'],['和臣','……我理一下。'],['旁白','这几天听到的、自己想的，混在一起。我把它们摊开在楼梯口的窗台上。']]);
    const flow=window.ACT6Flow;
    if(!flow) throw new Error('信息卡模块未加载');
    // 五张卡、三栏；分得准不准都不重来，只记一个结果给事件 08 用。
    // 这一段要让玩家自己区分「听来的」和「猜的」，音乐先压下去。
    if(window.BGM)BGM.duck(0.35,700);
    const result=await playInline('事件05 信息卡分类',()=>flow.cards({state:{...state}}));
    if(window.BGM)BGM.unduck(900);
    if(result.cancelled) return;
    persist({reportCompleted:true,reportAccuracy:result.accuracy});
    if(result.accuracy==='silent'){
      await lines([['和臣','其实……我没问到。宋瑶本人不在，我谁也没拦住。'],['由乃','行。没问到就是没问到。'],['和臣','你不生气？'],['由乃','我为什么要生气。'],['旁白','她把我摊开的卡片收成一叠，没有再问别的。']]);
      return;
    }
    if(result.accuracy==='accurate'){
      await lines([['和臣','朋友说，宋瑶最近跟 A 走得挺近。她本人不在，我没能问到。'],['和臣','剩下的，是我自己猜的。'],['由乃','嗯。至少你没替他们编。'],['旁白','她把袖子往上拉了一点，看着窗台，没有追问。']]);
      return;
    }
    if(result.guessesAsHeard){
      await lines([['和臣','我听到的是……他们肯定已经在一起了。'],['由乃','这句是你自己加的。'],['和臣','……差不多吧。'],['由乃','差很多。'],['旁白','我把那张卡片翻过去，压回一叠里。']]);
      return;
    }
    await lines([['和臣','朋友说宋瑶跟 A 走得挺近。可她本人到底怎么想，我不知道。'],['由乃','你把拿不准的放一边了。'],['和臣','嗯。'],['旁白','她点了点头，没再追问。']]);
  }
  async function event06(){
    scene('一个名字','周四 · 午休 · 走廊',door,{和臣:boy(35,82),朋友甲:friendA(76,82)});
    await lines([['旁白','朋友甲从身后追了上来。',()=>move('朋友甲',58,82)],['朋友甲','你上次问宋瑶，是想确认她跟 A 吧？'],['和臣','……算是。'],['朋友甲','他们在一起了。昨天放学看到的。'],['和臣','你确定？'],['朋友甲','反正两个人是一起走的。你要不信，自己去问。']]);
    image('cg/act6/cg04_02_heard_ab_512.png');actors.replaceChildren();
    await lines([['旁白','我没有去问。'],['回忆 · 由乃','帮我去问问她，现在有没有喜欢的人。'],['旁白','原来那天她让我问的，是这件事。'],['旁白','可她还是没告诉我，为什么是我去。']]);
    persist({aAndBDating:'reported'});
  }
  async function event07(){
    scene('纸飞机','周四 · 最后一节课前 · 操场',field,{和臣:boy(30,80),朱里:girl(53,80),由乃:yuno(75,80)});
    await lines([['由乃','谁要试？我找到一沓废纸。'],['朱里','你又想比赛。'],['由乃','这次我认真折。'],['旁白','三个人在操场上站开，一人一张纸。']]);
    // 折法、角度、力度、三个人的回合都在这一场里；落地只在楼前留一架飞机。
    const result=await playGame('paperplane',{},'事件07 纸飞机');
    persist({paperPlaneCompleted:true});
    if(!result||!result.completed){
      await lines([['旁白','纸飞机最后没扔成，纸还捏在手里。'],['由乃','下次再试。']]);
    }
    // 第 4 天 · 放学后：楼前的光正好，由乃说要拍一张。
    // 地上那架飞机只作为构图里的小小状况；没有就不加。
    await playDaily('photo',{plane:state.paperPlaneLanded||null});
  }
  async function event08(){
    // 第 5 天 · 上午：自习课上传纸条（四班教室）。一周目的第三场日常只留这一场，
    // 课堂笔记和雨里的伞都回到通关后的「日常」目录。
    scene('四班教室','周五 · 上午','scenes/school_classroom_pixel.png',{和臣:boy(40,82)});
    await playDaily('passnote');
    scene('由乃说的事','周五 · 放学后 · 楼梯口',stairs,{和臣:boy(36,82),由乃:yuno(66,82,'sit_left.png')});
    // 事件 05 分得怎么样，只改开场这一句语气；不升级任何事实。
    const tone={
      accurate:[['由乃','周三你把话分得很清楚。现在也不用替他们编。'],['和臣','……嗯。']],
      mixed:[['由乃','周三有几张卡，你放得不太对。'],['和臣','……嗯。'],['由乃','这次先听我说完。']],
      silent:[['由乃','周三你说没问到。'],['由乃','那就照没问到的说。'],['和臣','……好。']]
    }[state.reportAccuracy];
    if(tone) await lines(tone);
    await lines([['由乃','A 和宋瑶的事，你知道了。'],['和臣','嗯。'],['由乃','那朱里的事，你也该知道了。'],['和臣','……什么事。']]);
    // 名字说出口之前把音乐撤掉：这一段是「知道过去」，不是心动或惊吓。
    // 环境声和她的声音留在前面，不用 tense，也不给一句确认音。
    if(window.BGM)BGM.stop({fade:1.4});
    await lines([['由乃','她转来以前，喜欢过 A。'],['和臣','……'],['由乃','A 没有回应她。至少她是这么跟我说的。'],['和臣','你为什么现在才说。'],['由乃','因为你现在已经听到一半了。再不说，你会自己编完。'],['和臣','那天让我去问宋瑶……'],['由乃','我想确认一些事。'],['和臣','替朱里？'],['由乃','……我有我的理由。'],['和臣','你总是这样。'],['由乃','嗯。'],['旁白','她没有再解释。楼梯口的风把她的头发吹到一边。']]);
    persist({jurieLikedABeforeTransfer:'reported',aDidNotReciprocate:'reported',yunoMotive:'partial'});
    // 这里不再接雨伞：回到校园时 showCampus 自己把日常底色接回来。
  }
  async function event09(){
    const flow=window.ACT6Flow;
    if(!flow) throw new Error('记忆滑块模块未加载');
    // 三段各一个滑块：从「那时」滑到「后来」，第三段落在那条没人的走廊上。
    const result=await playInline('事件09 记忆重访',()=>flow.memory({segmentsSeen:state.memorySegmentsSeen||0}));
    if(result.cancelled) return;
    const photo=pickedPhoto();
    if(photo){
      await lines([['旁白','口袋里还留着前几天那张照片。']]);
      const shown=await flow.showPhoto(photo);
      await lines([shown?['旁白','普通的一天还在。']:['旁白','我在走廊里站了一会儿，才往回走。']]);
    }else{
      await lines([['旁白','我在走廊里站了一会儿，才往回走。']]);
    }
    persist({memoryRevisitCompleted:true,memorySegmentsSeen:3});
    // 回忆片段说完就回到当前时段，不把 memory 带进下一场。
    if(window.BGM)BGM.play('dusk',{fade:1.8});
  }
  async function event10(){
    // 毽子也回到目录了：结尾只留并肩走这一小段。
    scene('和平时一样','下周二 · 课间 · 四班门口',door,{和臣:boy(31,82),朱里:girl(75,82)});
    await lines([['旁白','我回到四班门口。朱里从三班那边走来，在门边等我。',()=>move('朱里',62,82)],['朱里','和臣，你回来啦。'],['和臣','嗯。你等很久了？'],['朱里','一起走？'],['和臣','……好。']]);
    move('和臣',47,82);move('朱里',56,82);
    await lines([['旁白','我们并肩走了一段。'],['朱里','你最近好像老在发呆。'],['和臣','有吗。'],['朱里','有。'],['旁白','她没有问我为什么。我也没有说。']]);
    persist({chapter04Completed:true});
  }
  const events=[event01,event02,event03,event04,event05,event06,event07,event08,event09,event10];

  // 日常小游戏接在这一章里：对白、站位、选择都还用上面这一套，
  // 游戏自己只管画布和面板，结束时交回 here。
  // 主线的事件 03 也走同一套，但它的面板来自 ACT6Mini.play('inquiry', opts)。
  const playGame = async (id, opts, label) => {
    if (!window.ACT6Mini) throw new Error('小游戏模块未加载：'+id);
    const result=await window.ACT6Mini.play(id, opts);
    if (result?.completed) return result;
    if (result?.cancelled) {
      // 玩家自己退出了这一局：给一次重试，或者先跳过，接着走主线。
      const pick=await choose('这一段先停在这里。', ['重试这一段','先跳过']);
      if (pick===0) return playGame(id, opts, label);
      console.warn('跳过：'+(label||id));
      return result;
    }
    throw new Error((label||id)+'没有完成'+(result?.error?'（'+result.error+'）':''));
  };
  const playDaily = (id, opts) => playGame(id, opts, '小游戏 '+id);

  // 日常存档只读，用来把「人流到得早晚」带进事件 03；不写。
  const dailyStore = () => {
    try { return (window.ACT6Mini && window.ACT6Mini.store && window.ACT6Mini.store()) || {}; }
    catch (error) { console.error(error); return {}; }
  };

  // 传话搬回目录之后，本周目真的传丢过哪几块只从日常存档里读，本章不写它。
  const relayLostItems = () => {
    const lost = dailyStore().relayLost;
    return Array.isArray(lost) ? lost.slice() : [];
  };

  // 知识事件：同一条事实、同一个来源不重复追加。置信度只到 reported。
  const learn = (factId, source, confidence, when) => {
    const list = Array.isArray(state.knowledgeEvents) ? state.knowledgeEvents.slice() : [];
    if (list.some(e => e.factId === factId && e.source === source && e.confidence === confidence)) return;
    list.push({ factId, source, confidence, whenLearned: when });
    persist({ knowledgeEvents: list });
  };

  // 主线里的 DOM 小段（02 时机 / 05 分类 / 09 滑块）走同一套退出约定：
  // Esc 只取消这一场，剧情给「重试这一段 / 先跳过」；抛错交给 runEvent 的 #eventFailure。
  const playInline = async (label, make) => {
    const result = await make();
    if (result?.completed) return result;
    if (result?.cancelled) {
      const pick = await choose('这一段先停在这里。', ['重试这一段','先跳过']);
      if (pick === 0) return playInline(label, make);
      console.warn('跳过：'+label);
      return result;
    }
    throw new Error(label+'没有完成'+(result?.error?'（'+result.error+'）':''));
  };

  // 事件 07 拍的照片存在日常存档里，事件 09 只读来复现，不改它。
  const pickedPhoto = () => {
    try {
      const store = window.ACT6Mini && window.ACT6Mini.store ? window.ACT6Mini.store() : null;
      return store && store.photoPicked ? store.photoPicked : null;
    } catch (error) {
      console.error(error);
      return null;
    }
  };

  // 给 minigames.js 用的接口：一套对白，一个推进方式
  window.ACT6 = {
    scene, move, image, say, advance, lines, choose, pause, curtain, persist, learn,
    get state(){ return {...state}; }
  };

  const places=[
    {name:'三班门口',bg:door,story:[0]},
    {name:'楼梯口',bg:stairs,story:[1,4,7]},
    {name:'四班门口',bg:door,story:[2,9]},
    {name:'二班门口',bg:door,story:[]},
    {name:'公告栏',bg:board,story:[3]},
    {name:'走廊护栏',bg:railing,story:[5,8]},
    {name:'操场',bg:field,story:[6]}
  ];
  const campusRoute=new CampusRoute(places,0,52);
  const eventCast={
    0:[['朱里',girl(70,82)]],1:[['由乃',yuno(70,82)]],
    2:[['朋友甲',friendA(70,82)]],3:[['朱里',girl(67,82)],['由乃',yuno(81,82)]],
    4:[['由乃',yuno(70,82)]],5:[['朋友甲',friendA(70,82)]],
    6:[['朱里',girl(67,82)],['由乃',yuno(81,82)]],
    7:[['由乃',yuno(70,82)]],8:[],9:[['朱里',girl(70,82)]]
  };
  const campusDate=['第二周 · 周二','第二周 · 周二','第二周 · 周二','第二周 · 周二','第二周 · 周三','第二周 · 周四','第二周 · 周四','第二周 · 周五','第二周 · 周五','下周二'];
  const campusAction=['还本子','找由乃','问问朋友','帮忙布置','向由乃说清楚','听朋友说','一起折纸飞机','听由乃说','想起那天','和朱里一起走'];
  const campusNotes=[
    '第二天早读前。朱里在三班门口，我的书包里还放着她的本子。',
    '课间的楼梯口，似乎有人在等我。由乃上次托我的事还没问。',
    '午休前先回四班门口。朋友甲正抱着一摞作业。',
    '放学后的公告栏又热闹起来。朱里和由乃还在那里。',
    '隔了一天，楼梯口安静了些。由乃应该还在等我的回答。',
    '朋友甲从走廊那边追了过来。我还没有问宋瑶本人。',
    '操场上有一阵风。她们手里的废纸折成了纸飞机。',
    '周五放学后，楼梯口只剩由乃一个人。',
    '傍晚，我又走回那道护栏前，想起第一次见到朱里的时候。',
    '下周二的课间，朱里照常在四班门口等我。'
  ];
  const narration=document.createElement('div');narration.id='campusNarration';narration.hidden=true;document.getElementById('stage').append(narration);
  const hint=document.createElement('div');hint.id='campusHint';hint.hidden=true;document.getElementById('stage').append(hint);
  // 事件中途抛异常时的兜底：简短提示 + 重试 / 回校园，存档和事件进度都不动。
  const failure=document.createElement('section');failure.id='eventFailure';failure.hidden=true;
  failure.innerHTML='<h2>这一段没能继续</h2><p>可以直接再试一次，或者先回校园。存档不会丢。</p>'+
    '<div class="row"><button type="button" id="eventRetry">重试这一段</button>'+
    '<button type="button" id="eventBack">回到校园</button></div>';
  document.getElementById('stage').append(failure);
  const eventRetry=failure.querySelector('#eventRetry'),eventBack=failure.querySelector('#eventBack');
  const held=new Set();
  let campusOpen=false,campusY=84,campusFacing='down',campusMotionUntil=0,lastCampusFrame=0;
  function nearby(){return places[campusRoute.area].story.includes(state.event)&&Math.abs(campusRoute.x-55)<19&&campusY>=77;}
  // 触屏：屏幕上的方向键 + 走到事件点才出现的互动按钮。和键盘共用 held / campusFrame，
  // 事件或对白进行时自动收起，也不压在底部对白框上。
  const pad=document.createElement('div');pad.id='campusPad';pad.hidden=true;
  pad.innerHTML=
    '<button type="button" data-dir="up" aria-label="向上走">↑</button>'+
    '<button type="button" data-dir="left" aria-label="向左走">←</button>'+
    '<button type="button" data-dir="down" aria-label="向下走">↓</button>'+
    '<button type="button" data-dir="right" aria-label="向右走">→</button>';
  document.getElementById('stage').append(pad);
  const interactBtn=document.createElement('button');
  interactBtn.id='campusInteract';interactBtn.type='button';interactBtn.hidden=true;
  document.getElementById('stage').append(interactBtn);
  const padHeld=new Set();
  const coarse=window.matchMedia?window.matchMedia('(pointer: coarse)'):null;
  function usingTouch(){return !!coarse&&(coarse.matches||window.innerWidth<820);}
  for(const btn of pad.querySelectorAll('[data-dir]')){
    const code={up:'ArrowUp',down:'ArrowDown',left:'ArrowLeft',right:'ArrowRight'}[btn.dataset.dir];
    const press=e=>{e.preventDefault();padHeld.add(code);btn.classList.add('on');
      if(btn.setPointerCapture){try{btn.setPointerCapture(e.pointerId);}catch{}}};
    const release=()=>{padHeld.delete(code);btn.classList.remove('on');};
    btn.addEventListener('pointerdown',press);
    btn.addEventListener('pointerup',release);
    btn.addEventListener('pointercancel',release);
    btn.addEventListener('pointerleave',release);
    btn.addEventListener('lostpointercapture',release);
  }
  interactBtn.addEventListener('click',()=>{if(campusOpen&&!running&&nearby())startEvent();});
  window.addEventListener('resize',()=>updateTouch());
  if(coarse&&coarse.addEventListener)coarse.addEventListener('change',()=>updateTouch());
  function updateTouch(){
    const live=usingTouch()&&campusOpen&&!running&&dialog.hidden;
    pad.hidden=!live;
    if(!live)padHeld.clear();
    const can=live&&nearby();
    interactBtn.hidden=!can;
    if(can)interactBtn.textContent='E 互动 · '+campusAction[state.event];
  }
  function campusActor(){
    const el=actors.querySelector('[data-actor="和臣"]');if(!el)return;
    const moving=performance.now()<campusMotionUntil;
    const idle={down:0,left:2,right:3,up:4};
    const walk={down:5,left:9,right:13,up:17};
    const frame=moving?walk[campusFacing]+Math.floor(performance.now()/150)%4:idle[campusFacing];
    const src=base+'characters/boy/v2/frames/'+String(frame).padStart(2,'0')+'.png';
    if(el.getAttribute('src')!==src)el.src=src;
    move('和臣',campusRoute.x,campusY);
  }
  function updateHint(){
    hint.hidden=!campusOpen;
    if(campusOpen)hint.textContent=nearby()?'E · '+campusAction[state.event]+'　　WASD / 方向键走动':'WASD / 方向键走动 · 左右边缘换场景';
    updateTouch();
  }
  function showCampus(){
    if(state.event>=events.length){
      campusOpen=false;hint.hidden=true;narration.hidden=true;end.hidden=false;
      if(window.BGM)BGM.play('ending',{fade:2.2});
      updateTouch();return;
    }
    campusOpen=true;dialog.hidden=true;panel.hidden=true;panel.classList.remove('campus');
    if(window.BGM)BGM.play(campusTrack(state.event),{fade:1.4});
    const p=places[campusRoute.area],next=state.event;
    const cast={和臣:boy(campusRoute.x,campusY,'idle_'+campusFacing+'.png')};
    if(p.story.includes(next))for(const [name,data] of eventCast[next]||[])cast[name]=data;
    scene(p.name,campusDate[next],p.bg,cast);
    narration.textContent=campusNotes[next];narration.hidden=false;
    actors.querySelector('[data-actor="和臣"]')?.classList.add('exploring');
    for(let i=0;i<2;i++){
      const npc=document.createElement('img');npc.className='actor small passerby '+(i?'left':'right');
      npc.src=base+'characters/npc_generated/'+(i?'girl_walk_left.gif':'boy_walk_right.gif');
      npc.alt='路过的学生';npc.style.left=(19+i*59)+'%';npc.style.top=(82+i*3)+'%';
      npc.style.animationDelay=(-i*3)+'s';actors.append(npc);
    }
    updateHint();
  }
  function showEventFailure(index,error){
    console.error(error);
    if(dropChoice){dropChoice();dropChoice=null;}
    dialog.hidden=true;pending=null;panel.hidden=true;
    // 主线这几场是 DOM 面板 / 画布玩法：中途出错时收掉，重试不会叠出第二层。
    for(const node of document.querySelectorAll('#mgCards,#mgTiming,.timing-dusk,#mgMemory,.memory-vignette,.memory-photo,#mgBulletin,.bulletin-ghost'))node.remove();
    eventRetry.onclick=()=>{if(!running)runEvent(index);};
    eventBack.onclick=()=>{failure.hidden=true;showCampus();};
    failure.hidden=false;
    updateTouch();
  }
  async function runEvent(index){
    failure.hidden=true;running=true;
    if(window.BGM)BGM.play(eventTrack(index),{fade:1.2});
    try{await events[index]();persist({event:index+1});await curtain(250);showCampus();}
    catch(error){showEventFailure(index,error);}
    finally{running=false;}
  }
  async function startEvent(){
    if(!campusOpen||running||!nearby())return;
    campusOpen=false;hint.hidden=true;narration.hidden=true;
    padHeld.clear();updateTouch();
    await runEvent(state.event);
  }
  function campusFrame(now){
    const dt=lastCampusFrame?Math.min(.05,(now-lastCampusFrame)/1000):0;lastCampusFrame=now;
    if(campusOpen&&!running){
      const dx=Number(held.has('KeyD')||held.has('ArrowRight')||padHeld.has('ArrowRight'))-Number(held.has('KeyA')||held.has('ArrowLeft')||padHeld.has('ArrowLeft'));
      const dy=Number(held.has('KeyS')||held.has('ArrowDown')||padHeld.has('ArrowDown'))-Number(held.has('KeyW')||held.has('ArrowUp')||padHeld.has('ArrowUp'));
      if(dx||dy){
        const speed=dx&&dy?Math.SQRT1_2:1;
        if(dx){
          const proposed=campusRoute.x+dx*dt*29*speed;
          const castHere=places[campusRoute.area].story.includes(state.event)?eventCast[state.event]||[]:[];
          const blocked=campusY>78&&castHere.some(([,person])=>Math.abs(proposed-person.x)<11&&Math.abs(proposed-person.x)<Math.abs(campusRoute.x-person.x));
          if(!blocked){const step=campusRoute.move(dx,dt*29*speed);if(step.changed)showCampus();}
        }
        campusY=Math.max(70,Math.min(90,campusY+dy*dt*23*speed));
        campusFacing=dy?(dy<0?'up':'down'):(dx<0?'left':'right');campusMotionUntil=now+75;
        campusActor();updateHint();
      }else if(now>=campusMotionUntil)campusActor();
    }
    requestAnimationFrame(campusFrame);
  }
  requestAnimationFrame(campusFrame);
  dialog.addEventListener('click',advance);
  document.addEventListener('keydown',e=>{
    const onControl=e.target instanceof Element&&!!e.target.closest('button,a,input,select,textarea,[role="button"]');
    if(['KeyA','KeyD','KeyW','KeyS','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code)){
      if(campusOpen){held.add(e.code);e.preventDefault();}return;
    }
    if(campusOpen&&e.code==='KeyE'){e.preventDefault();if(!e.repeat)startEvent();return;}
    if(['Enter','Space','KeyE'].includes(e.code)){
      // 焦点在按钮/选项上时，回车和空格留给按钮自己触发，别被对白推进吃掉。
      if(onControl&&(e.code==='Enter'||e.code==='Space'))return;
      e.preventDefault();if(!dialog.hidden)advance();
    }
  });
  document.addEventListener('keyup',e=>held.delete(e.code));
  window.addEventListener('blur',()=>{held.clear();padHeld.clear();pad.querySelectorAll('[data-dir].on').forEach(b=>b.classList.remove('on'));});
  document.getElementById('endNext').onclick=()=>{location.href='../index.html';};
  window.__act6={get state(){return {...state};},get campus(){return {area:campusRoute.area,x:campusRoute.x,y:campusY,open:campusOpen,event:state.event,nearby:nearby(),target:places.findIndex(p=>p.story.includes(state.event))};},reset(){localStorage.removeItem(saveKey);location.reload();},startAt(i){persist({event:i});location.reload();},daily(id){return playDaily(id);}};
  // ?daily=1 / ?daily=relay 直接进日常目录或单个小游戏，不跑剧情
  const fromDaily = new URLSearchParams(location.search).get('daily');
  if (!fromDaily) {
    if(state.event===0){
      if(window.BGM)BGM.play('morning',{fade:1.6});
      scene('第二天早晨','第二周 · 周二早读前',door,{和臣:boy(30,84),朱里:girl(70,82)});
      lines([['旁白','第二天早读前，我从四班走向三班。由乃昨晚交给我的本子还在书包里。'],['旁白','朱里在门口整理书包。我走近了些。']])
        .then(showCampus).catch(error=>{console.error(error);showCampus();});
    }else showCampus();
  }
})();

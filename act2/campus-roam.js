/* 第二幕的可选校园散步。离开时回到当前剧情节点，不改剧情存档。 */
(() => {
  const allowed = new Set(['exterior','boardIntro','boardPending','boardReturn','snackIntro','montage','walk','chat']);
  const spots = [['教学楼前','exterior'],['教室','classroom'],['走廊·教室门','door'],['走廊·护栏','railing']];
  const route = new CampusRoute(spots, 3, 45);
  const style=document.createElement('style');
  style.textContent='.campus-roam-toggle,.campus-roam-panel{position:fixed;z-index:90;background:#211b29e8;color:#fff2e2;border:1px solid #d6ad8c;font:16px "Microsoft YaHei",sans-serif}.campus-roam-toggle{right:2%;top:4%;padding:7px 12px;cursor:pointer}.campus-roam-panel{right:2%;top:12%;padding:12px;display:grid;gap:7px;min-width:180px}.campus-roam-panel button{font:inherit;padding:6px 8px;background:#77545a;color:#fff;border:1px solid #dfb99c;cursor:pointer}.campus-roam-panel[hidden],.campus-roam-toggle[hidden]{display:none}';document.head.append(style);
  const toggle=document.createElement('button');toggle.className='campus-roam-toggle';toggle.textContent='在学校走走';document.body.append(toggle);
  const menu=document.createElement('div');menu.className='campus-roam-panel';menu.hidden=true;document.body.append(menu);
  let roaming=false,walkActor=null;
  function visit(where){scene(where);walkActor=actor('me',route.x);walkActor.style.bottom='15%';walkActor.style.width='14%';
    if(where!=='exterior')for(let i=0;i<2;i++){
      const npc=document.createElement('img');npc.src='assets/characters/npc_generated/'+(i?'girl_idle_left.png':'boy_idle_right.png');
      npc.alt='路过的学生';npc.style.cssText='position:absolute;left:'+(18+i*60)+'%;bottom:21%;width:7%;height:24%;image-rendering:pixelated;opacity:.8;pointer-events:none';
      people.append(npc);
    }
  }
  function close(){roaming=false;menu.hidden=true;render();}
  function open(){if(!allowed.has(state)||talk)return;roaming=true;menu.hidden=false;menu.replaceChildren();
    const info=document.createElement('div');info.textContent='A / D 走到边缘换场景';menu.append(info);
    const back=document.createElement('button');back.textContent='回到刚才的剧情';back.onclick=close;menu.append(back);
    visit(route.areas[route.area][1]);
  }
  toggle.onclick=()=>roaming?close():open();
  document.addEventListener('keydown',e=>{if(!roaming)return;
    if(['a','A','ArrowLeft','d','D','ArrowRight'].includes(e.key)){
      e.stopImmediatePropagation();e.preventDefault();const step=route.move(['a','A','ArrowLeft'].includes(e.key)?-1:1);
      if(step.changed)visit(step.place[1]);else if(walkActor)walkActor.style.left=step.x+'%';
    }
    if(e.key==='Escape'){e.stopImmediatePropagation();e.preventDefault();close();}
  },true);
  setInterval(()=>{toggle.hidden=!roaming&&(!allowed.has(state)||!!talk);},500);
})();

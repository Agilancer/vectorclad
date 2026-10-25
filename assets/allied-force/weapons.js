import {kit,batchRigid} from './kit.js';
export const WEAPONS={
 rifle:{name:'AR-24 assault rifle',interval:.13,damage:8,range:85,speed:720,splash:0},
 machinegun:{name:'MG-62 belt-fed machine gun',interval:.075,damage:6,range:110,speed:820,splash:0},
 rocket:{name:'RL-9 guided rocket launcher',interval:2.4,damage:85,range:170,speed:55,splash:5},
 grenade:{name:'GL-6 revolver grenade launcher',interval:.7,damage:28,range:65,speed:32,splash:3},
 laser:{name:'HL-4 high-power laser',interval:.45,damage:25,range:145,speed:Infinity,splash:0}
};
export function createWeapon(T,skin,id='rifle'){
 if(!WEAPONS[id])throw Error('Unknown weapon '+id);
 const K=kit(T,skin),{group,box,cyl,ring,rod,mark}=K;
 const root=new T.Group();root.name=WEAPONS[id].name;
 const carriage=group(root,'recoil carriage'),muzzles=[];
 box(root,.08,.17,.12,0,-.065,0,'black').rotation.x=-.18;
 box(root,.1,.1,.25,0,.04,-.17,'frame');box(root,.12,.2,.07,0,.04,-.3,'black');
 const muzzle=(z,r=.025,x=0,y=.06)=>{const node=group(carriage,'muzzle +Z',x,y,z);muzzles.push(node);cyl(carriage,r*1.5,.075,x,y,z-.035,'frame','z');cyl(carriage,r,.006,x,y,z+.006,'black','z');};
 if(id==='rifle'){
  box(carriage,.13,.17,.46,0,.065,.18);box(carriage,.09,.055,.38,0,.17,.22,'gold');
  box(carriage,.1,.17,.13,0,-.12,.15,'frame').rotation.x=-.25;
  for(let i=0;i<5;i++)box(carriage,.145,.035,.025,0,.09,.24+i*.045,'black');
  cyl(carriage,.022,.35,0,.065,.56,'frame','z');muzzle(.76);box(carriage,.035,.055,.07,0,.21,.15,'visor');
 }else if(id==='machinegun'){
  box(carriage,.18,.19,.46,0,.07,.16);box(carriage,.22,.2,.21,-.15,-.035,.14,'frame');
  cyl(carriage,.044,.65,0,.07,.64,'frame','z');for(let i=0;i<7;i++)ring(carriage,.052,.012,0,.07,.37+i*.07,'gold');
  for(let i=0;i<6;i++)cyl(carriage,.018,.07,-.24+i*.03,.08,.19,'gold','y',8);
  rod(carriage,[-.065,.01,.72],[-.14,-.17,.88],.012);rod(carriage,[.065,.01,.72],[.14,-.17,.88],.012);muzzle(1,.03);
 }else if(id==='rocket'){
  cyl(carriage,.105,.98,0,.105,.29,'armor','z',20);ring(carriage,.108,.018,0,.105,.78,'gold');ring(carriage,.108,.018,0,.105,-.2,'gold');
  cyl(carriage,.085,.015,0,.105,-.21,'black','z');box(carriage,.06,.09,.15,.12,.17,.2,'visor');
  for(const s of [-1,1])box(carriage,.05,.1,.3,s*.1,.13,.45,'frame');muzzle(.79,.077,0,.105);
 }else if(id==='grenade'){
  box(carriage,.15,.16,.38,0,.075,.13);cyl(carriage,.12,.23,0,-.045,.28,'frame','z',20);
  for(let i=0;i<6;i++){let a=i*Math.PI/3;cyl(carriage,.032,.025,Math.cos(a)*.085,-.045+Math.sin(a)*.085,.405,'gold','z',8);}
  cyl(carriage,.057,.31,0,.07,.55,'frame','z');muzzle(.73,.045);box(carriage,.06,.06,.1,0,.21,.18,'visor');
 }else{
  box(carriage,.17,.2,.48,0,.08,.23);box(carriage,.11,.14,.28,0,-.08,.18,'gold');
  for(const s of [-1,1]){box(carriage,.045,.16,.32,s*.12,.08,.38,'frame');for(let i=0;i<4;i++)box(carriage,.025,.09,.018,s*.147,.085,.27+i*.06,'glow');}
  cyl(carriage,.06,.36,0,.08,.59,'frame','z');for(let i=0;i<4;i++)ring(carriage,.069,.012,0,.08,.46+i*.065,'gold');muzzle(.8,.045,0,.08);cyl(carriage,.025,.01,0,.08,.809,'glow','z');
 }
 box(root,.055,.11,.055,0,-.09,.29,'black');
 const grips={right:new T.Vector3(0,0,0),left:new T.Vector3(0,-.035,id==='rocket'?.28:.26)};
 const flash=new T.Mesh(new T.ConeGeometry(id==='laser'?.035:.065,.24,6),new T.MeshBasicMaterial({color:id==='laser'?skin.palette.light:0xffce72,transparent:true,opacity:.9,depthWrite:false}));flash.rotation.x=Math.PI/2;flash.position.set(0,0,.11);muzzles[0].add(flash);flash.visible=false;
 mark(carriage,id==='laser'?'HL-4':id==='rocket'?'RL-9':'VC',.11,.035,.074,.11,.25).rotation.y=Math.PI/2;
 batchRigid(T,root);
 return {id,definition:WEAPONS[id],root,carriage,grips,muzzles,flash,
  update(time,recoil=0,firing=false){carriage.position.z=-recoil*.045;flash.visible=firing;},
  dispose(){const textures=new Set(),materials=new Set(),geometries=new Set();root.traverse(o=>{if(!o.isMesh)return;geometries.add(o.geometry);if(o.material!==skin.material&&o.material!==skin.black&&o.material!==skin.glow&&o.material!==skin.visor){materials.add(o.material);if(o.material.map)textures.add(o.material.map);}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());root.removeFromParent();}
 };
}

import {createSkin} from './skins.js';
import {kit,batchRigid} from './kit.js';
import {createWeapon,WEAPONS} from './weapons.js';

export const UNITS={
 ranger:{name:'01 / Ranger',kind:'soldier',height:1.82,weapon:'rifle',role:'recon',armor:'light'},
 trooper:{name:'02 / Line trooper',kind:'soldier',height:1.88,weapon:'rifle',role:'rifle squad',armor:'medium'},
 gunner:{name:'03 / Support gunner',kind:'soldier',height:1.96,weapon:'machinegun',role:'suppression',armor:'heavy'},
 rocketeer:{name:'04 / Rocketeer',kind:'soldier',height:1.9,weapon:'rocket',role:'anti-armor',armor:'medium'},
 grenadier:{name:'05 / Grenadier',kind:'soldier',height:1.86,weapon:'grenade',role:'indirect support',armor:'medium'},
 lancer:{name:'06 / Laser lancer',kind:'soldier',height:1.92,weapon:'laser',role:'precision energy',armor:'heavy'},
 medic:{name:'07 / Field medic',kind:'soldier',height:1.8,weapon:'rifle',role:'support',armor:'light'},
 commander:{name:'08 / Squad leader',kind:'soldier',height:1.87,weapon:'rifle',role:'command',armor:'medium'},
 kestrel:{name:'09 / Kestrel scout frame',kind:'mech',height:3.3,weapon:'laser',role:'fast escort',armor:'aerial'},
 bastion:{name:'10 / Bastion infantry frame',kind:'mech',height:4.4,weapon:'machinegun',role:'heavy screen',armor:'carrier'},
 bombard:{name:'11 / Bombard support frame',kind:'mech',height:4,weapon:'rocket',role:'fire support',armor:'artillery'}
};
export const ACTIONS=['idle','walk','run','strafe','aim','fire','reload','crouch','jump','land','hit','die','boost','salute'];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

// Analytic two-bone solve in the upper joint's parent space. Bone rest direction is -Y.
function solve(T,upper,lower,target,l1,l2,pole){
 const start=upper.position,delta=target.clone().sub(start),actual=delta.length(),d=clamp(actual,.025,l1+l2-.0001),axis=delta.normalize();
 if(actual<.00001)axis.set(0,-1,0);
 const bend=pole.clone().addScaledVector(axis,-pole.dot(axis)).normalize();
 const a=(l1*l1-l2*l2+d*d)/(2*d),h=Math.sqrt(Math.max(0,l1*l1-a*a));
 const elbow=start.clone().addScaledVector(axis,a).addScaledVector(bend,h),end=start.clone().addScaledVector(axis,d);
 upper.quaternion.setFromUnitVectors(new T.Vector3(0,-1,0),elbow.clone().sub(start).normalize());
 lower.quaternion.setFromUnitVectors(new T.Vector3(0,-1,0),end.sub(elbow).normalize().applyQuaternion(upper.quaternion.clone().invert()));
 return Math.max(0,actual-(l1+l2));
}

export class AlliedUnit{
 constructor(T,{type='trooper',skin='vanguard',weapon,unitsPerMeter=1}={}){
  if(!UNITS[type])throw Error('Unknown unit '+type);if(!(unitsPerMeter>0))throw Error('unitsPerMeter must be positive');
  this.T=T;this.type=type;this.definition=UNITS[type];this.heightMeters=this.definition.height;this.unitsPerMeter=unitsPerMeter;
  this.skin=createSkin(T,skin);this.root=new T.Group();this.root.name=this.definition.name;this.root.scale.setScalar(this.heightMeters/(this.definition.kind==='mech'?1.885:1.795)*unitsPerMeter);
  this.time=0;this.phase=0;this.cooldown=0;this.action='idle';this.elapsed=0;this.aimWeight=0;this.moveWeight=0;this.runWeight=0;this.crouchWeight=0;this.recoil=0;this.events=[];this.fans=[];this.thrusters=[];
  this.build();this.equip(weapon||this.definition.weapon);batchRigid(T,this.root);this.update(0,{action:'idle'});
 }
 build(){
  const T=this.T,K=kit(T,this.skin),{box,cyl,sphere,panel,ring,rod,mark,group,mesh}=K,mech=this.definition.kind==='mech',heavy=this.definition.armor==='heavy';this.K=K;
  const body=this.body=group(this.root,'pelvis',0,.92,0),chest=this.chest=group(body,'waist',0,.04,0);
  box(body,mech?.51:.29,.19,mech?.3:.19,0,-.025,0,'cloth');box(body,mech?.43:.27,.1,.055,0,.025,.15,'frame');box(body,.08,.07,.07,0,.025,.19,'gold');
  box(chest,mech?.62:.36,.46,mech?.34:.23,0,.28,0,'cloth');
  panel(chest,[[-(mech?.34:.2),.47],[mech?.34:.2,.47],[mech?.29:.16,.12],[0,.07],[-(mech?.29:.16),.12]],mech?.2:.075,0,0,mech?.18:.13);
  box(chest,mech?.22:.13,.04,.02,0,.29,mech?.294:.175,'gold');mark(chest,mech?'VC':'V',mech?.2:.085,.045,0,.38,mech?.294:.175);
  for(const s of [-1,1]){
   box(chest,mech?.16:.075,.11,.08,s*(mech?.22:.12),.14,mech?.3:.18,'frame');
   box(body,mech?.18:.1,.23,.1,s*(mech?.26:.18),-.09,.05,'armor').rotation.z=s*.15;
   rod(chest,[s*.12,.15,-.08],[s*.14,.46,-.09],mech?.027:.014,'frame');
  }
  const head=this.head=group(chest,'head',0,mech?.58:.54,0);
  cyl(head,.053,.18,0,-.04,0,'frame');
  if(!mech){
   mesh(head,new T.SphereGeometry(.13,16,12),'armor',0,.15,-.012).scale.set(1,1.07,1.05);
   box(head,.23,.11,.09,0,.16,.099,'visor');box(head,.25,.035,.1,0,.225,.105,'armor');
   panel(head,[[-.105,.13],[.105,.13],[.075,.015],[-.075,.015]],.065,0,0,.105,'frame');
   for(const s of [-1,1]){cyl(head,.048,.033,s*.132,.135,-.005,'frame','x');box(head,.025,.05,.05,s*.151,.14,.012,'gold');}
   if(this.type==='ranger'){box(head,.07,.045,.055,.115,.18,.13,'glow');box(chest,.33,.25,.13,0,.31,-.18,'cloth');}
   if(heavy){box(head,.045,.095,.05,-.1,.11,.14,'armor');box(head,.045,.095,.05,.1,.11,.14,'armor');}
   if(this.type==='commander'){rod(head,[.13,.2,-.04],[.15,.43,-.07],.009);box(head,.06,.035,.04,.15,.43,-.07,'glow');}
  }else{
   // Sloped multi-pane cockpit draws its forms from the Kestrel's pointed cabin.
   panel(head,[[-.18,.05],[-.15,.27],[0,.34],[.15,.27],[.18,.05],[0,-.02]],.24,0,0,0);
   panel(head,[[-.13,.11],[-.1,.24],[0,.29],[.1,.24],[.13,.11],[0,.065]],.035,0,0,.143,'visor');
   box(head,.025,.17,.03,0,.19,.17,'gold');box(head,.1,.03,.035,0,.07,.17,'glow');
   for(const s of [-1,1])cyl(head,.065,.04,s*.18,.14,-.02,'frame','x');
  }
  this.legs=[];this.arms=[];this.mounts={};
  for(const s of [-1,1]){
   const hip=group(body,'hip '+s,s*(mech?.19:.105),-.04,0),knee=group(hip,'knee '+s,0,-.43,0),ankle=group(knee,'ankle '+s,0,-.43,0);
   const width=mech?.25:heavy?.18:.145;
   box(hip,width,.31,mech?.27:.18,0,-.2,0,'cloth');box(hip,width*.95,.22,.075,0,-.19,mech?.17:.11);
   cyl(hip,mech?.09:.055,width+.025,0,-.01,0,'frame','x');
   box(knee,width*.92,.32,mech?.28:.155,0,-.23,-.015,'cloth');
   panel(knee,[[-width*.55,.09],[0,.04],[width*.55,.09],[width*.55,-.1],[width*.25,-.16],[-width*.25,-.16]],.09,0,0,mech?.18:.105);
   box(knee,width*.7,.21,.07,0,-.27,mech?.14:.085);box(knee,.025,.11,.018,0,-.25,mech?.183:.127,'gold');
   box(ankle,mech?.27:.15,mech?.15:.13,mech?.4:.28,0,-.005,mech?.095:.065,'frame');
   box(ankle,mech?.24:.14,.07,mech?.22:.16,0,.027,mech?.16:.105);box(ankle,mech?.28:.16,.025,mech?.42:.3,0,-.07,mech?.095:.065,'black');
   if(mech){cyl(knee,.085,width+.06,s*.01,-.02,0,'frame','x');ring(knee,.065,.014,s*(width*.5+.045),-.02,0,'gold','x');rod(knee,[s*.09,-.1,-.1],[s*.09,-.36,-.12],.018,'gold');}
   this.legs.push({s,hip,knee,ankle});
   const upperLength=mech?.36:.32,lowerLength=mech?.36:.31;
   const shoulder=group(chest,'shoulder '+s,s*(mech?.4:.245),.47,0),elbow=group(shoulder,'elbow '+s,0,-upperLength,0),hand=group(elbow,'hand '+s,0,-lowerLength,0);
   const aw=mech?.23:heavy?.15:.12;
   sphere(shoulder,aw*.57,0,-.025,0,'frame');box(shoulder,aw,.19,mech?.23:.16,0,-.1,0);
   box(shoulder,aw*.65,.15,aw*.8,0,-.25,0,'cloth');cyl(elbow,aw*.45,aw,0,0,0,'frame','x');
   box(elbow,aw*.88,lowerLength*.7,mech?.23:.14,0,-lowerLength*.5,.018);box(elbow,aw*.55,.065,.025,0,-.1,mech?.145:.097,'gold');
   box(hand,mech?.115:.085,.095,.09,0,-.015,.018,'black');for(let j=0;j<3;j++)box(hand,.018,.04,.018,(j-1)*.025,-.055,.052,'frame');
   this.arms.push({s,shoulder,elbow,hand,upperLength,lowerLength});
   this.mounts[s>0?'rightHand':'leftHand']=group(hand,'attachment '+s);
   this.mounts[s>0?'shoulderR':'shoulderL']=group(chest,'shoulder hardpoint '+s,s*(mech?.4:.245),.57,-.06);
  }
  this.mounts.back=group(chest,'back hardpoint',0,.34,-.2);
  this.mounts.pilot=group(chest,'pilot camera',0,.76,.22);
  this.weaponMount=group(chest,'aiming weapon mount',mech?.04:.07,.28,mech?.16:.17);
  this.mounts.weapon=this.weaponMount;
  if(!mech){
   box(chest,.27,.32,.15,0,.27,-.2,'frame');box(chest,.22,.23,.05,0,.29,-.29,'armor');
   if(this.type==='rocketeer')for(const s of [-1,1]){cyl(chest,.055,.54,s*.19,.32,-.22,'armor');ring(chest,.058,.012,s*.19,.58,-.22,'gold','y');}
   if(this.type==='grenadier')for(let i=0;i<5;i++)cyl(chest,.027,.09,(i-2)*.064,.18,.215,'gold');
   if(this.type==='gunner')for(let i=0;i<4;i++)box(chest,.08,.13,.1,-.13+i*.085,.1,.22,'frame');
   if(this.type==='lancer'){for(const s of [-1,1])cyl(chest,.05,.3,s*.15,.3,-.27,'frame');box(chest,.11,.09,.04,0,.32,-.33,'glow');}
   if(this.type==='medic'){box(chest,.24,.2,.09,0,.18,-.32,'armor');box(chest,.12,.035,.015,0,.18,-.375,'glow');box(chest,.035,.12,.015,0,.18,-.375,'glow');}
   if(this.type==='commander'){rod(chest,[-.13,.42,-.2],[-.13,.85,-.2],.009);mark(chest,'CMD',.13,.04,.1,.46,.177);}
  }else{
   box(chest,.58,.4,.26,0,.3,-.29,'frame');for(const s of [-1,1]){
    cyl(chest,.065,.1,s*.18,.25,-.45,'frame','z');ring(chest,.063,.012,s*.18,.25,-.51,'gold');
    const plume=group(chest,'boost plume '+s,s*.18,.25,-.52);cyl(plume,.038,.11,0,0,-.035,'glow','z');this.thrusters.push(plume);
    box(chest,.17,.3,.22,s*.3,.3,-.27);for(let i=0;i<4;i++)box(chest,.13,.025,.018,s*.3,.2+i*.06,-.39,'black');
    const fin=group(chest,'swept stabilizer '+s,s*.3,.4,-.22);fin.rotation.x=-.55;
    panel(fin,[[0,0],[s*.08,.26],[s*.4,.56],[s*.45,.5],[s*.2,-.05]],.065,0,0,0);
    panel(fin,[[s*.08,.05],[s*.35,.43],[s*.39,.42],[s*.17,.02]],.02,0,0,.047,'gold');
   }
   if(this.type==='kestrel'){
    panel(chest,[[-.26,.43],[.26,.43],[.16,.23],[0,.1],[-.16,.23]],.15,0,0,.22);
    panel(chest,[[-.13,.37],[.13,.37],[.08,.28],[-.08,.28]],.025,0,0,.31,'visor');
    box(chest,.025,.18,.025,0,.29,.33,'gold');
   }
   if(this.type==='kestrel')for(const s of [-1,1]){
    const wing=group(chest,'lift outrigger '+s,s*.45,.5,-.05);box(wing,.26,.065,.22,s*.06,0,0);
    const duct=group(wing,'duct '+s,s*.23,0,0);ring(duct,.17,.033,0,0,0,'armor','y');ring(duct,.17,.009,0,.025,0,'gold','y');
    const rotor=group(duct,'rotor '+s);cyl(rotor,.035,.04,0,0,0,'frame');for(let k=0;k<6;k++){const blade=box(rotor,.035,.015,.22,0,0,0,'frame');blade.rotation.y=k*Math.PI/3;}
    this.fans.push({rotor,s});
   }
   if(this.type==='bastion'){
    box(chest,.8,.17,.48,0,.49,-.02);panel(chest,[[-.37,.39],[.37,.39],[.3,.19],[-.3,.19]],.12,0,0,.31);
    for(const s of [-1,1])box(chest,.23,.065,.025,s*.14,.51,.234,'visor');box(chest,.035,.12,.025,0,.51,.25,'gold');
    for(const s of [-1,1]){cyl(chest,.15,.08,s*.43,.5,-.02,'frame','x');ring(chest,.11,.02,s*.48,.5,-.02,'gold','x');box(chest,.28,.18,.3,s*.42,.55,0);}
   }
   if(this.type==='bombard')for(const s of [-1,1]){
    const pod=group(chest,'six-cell rocket rack '+s,s*.34,.66,-.17);pod.rotation.x=-.15;box(pod,.25,.3,.39);
    for(let y=0;y<3;y++)for(let x=0;x<2;x++){cyl(pod,.039,.025,(x-.5)*.1,(y-1)*.085,.21,'frame','z',12);cyl(pod,.025,.01,(x-.5)*.1,(y-1)*.085,.226,'black','z',12);}
   }
  }
 }
 equip(id){if(!WEAPONS[id])throw Error('Unknown weapon '+id);if(this.weapon)this.weapon.dispose();this.weapon=createWeapon(this.T,this.skin,id);this.weaponMount.add(this.weapon.root);return this.weapon;}
 play(action){if(!ACTIONS.includes(action))throw Error('Unknown action '+action);this.action=action;this.elapsed=0;return this;}
 update(dt,state={}){
  const T=this.T;dt=clamp(dt,0,.1);const action=state.action||this.action;if(!ACTIONS.includes(action))throw Error('Unknown action '+action);
  if(action!==this.action){this.action=action;this.elapsed=0;}this.elapsed+=dt;this.time+=dt;this.events.length=0;
  const t=this.time,e=this.elapsed,mech=this.definition.kind==='mech',moving=['walk','run','strafe','boost'].includes(action),run=action==='run'||action==='boost',speed=state.speed??(moving?(run?4.8:1.5):0);
  const blend=1-Math.exp(-dt*10);
  this.moveWeight+=(Number(moving)-this.moveWeight)*blend;this.runWeight+=(Number(run)-this.runWeight)*blend;this.crouchWeight+=(Number(action==='crouch')-this.crouchWeight)*blend;
  this.phase+=dt*(6.5+3.5*this.runWeight)*(moving?clamp(speed/(run?4.8:1.5),.1,2):.5)*this.moveWeight;const phase=this.phase;
  const crouch=action==='crouch'?1:0,jump=action==='jump'?Math.sin(Math.min(1,e/.9)*Math.PI)*.42:0,landing=action==='land'?Math.exp(-e*6)*.15:0;
  this.body.position.y=.92-this.moveWeight*.055-this.crouchWeight*.19-landing+Math.cos(phase*2)*.012*this.moveWeight+Math.sin(t*1.7)*.004*(1-this.moveWeight)+jump;
  this.body.rotation.set(0,0,moving?Math.sin(phase)*.015:0);
  this.chest.rotation.set(.025+this.runWeight*.135+this.crouchWeight*.115,clamp(state.aimYaw||0,-.85,.85),0);
  const aiming=!!state.aim||['aim','fire','crouch'].includes(action);this.aimWeight+=(Number(aiming)-this.aimWeight)*(1-Math.exp(-dt*12));
  const pitch=clamp(state.aimPitch||0,-.65,.65);this.head.rotation.set(-pitch*.65,Math.sin(t*.4)*.06*(1-this.aimWeight),0);
  let maxError=0;
  for(const L of this.legs){
   const q=((phase/(2*Math.PI)+(L.s>0?.5:0))%1+1)%1,stance=q<.62,u=stance?q/.62:(q-.62)/.38,stride=.2+.12*this.runWeight;
   const z=(stance?stride*(1-2*u):-stride+2*stride*u)*this.moveWeight+L.s*.025*(1-this.moveWeight);
   const lift=!stance?Math.sin(u*Math.PI)*(.095+.065*this.runWeight)*this.moveWeight:0;
   const target=new T.Vector3(L.s*(mech?.22:.13)+(action==='strafe'?z:0),.08-this.body.position.y+lift+jump,action==='strafe'?0:z);
   if(action==='jump'){const tuck=Math.sin(Math.min(1,e/.9)*Math.PI);target.y+=.1*tuck;target.z=L.s*.11*tuck;}
   maxError=Math.max(maxError,solve(T,L.hip,L.knee,target,.43,.43,new T.Vector3(0,0,1)));
   const combined=L.hip.quaternion.clone().multiply(L.knee.quaternion);L.ankle.quaternion.copy(combined.invert());
  }
  this.weaponMount.rotation.set(.32*(1-this.aimWeight)-pitch*this.aimWeight,0,run?.035*Math.sin(phase):0);
  this.weaponMount.position.y=.28+Math.sin(t*1.7)*.003;
  if(action==='reload'){this.weaponMount.rotation.x=.6;this.weaponMount.rotation.z=-.18*Math.sin(Math.min(e,1.8)/1.8*Math.PI);}
  this.root.rotation.x=action==='die'?-Math.min(1,e/1.1)*Math.PI/2:0;
  this.root.position.y=state.groundY??0;
  this.cooldown=Math.max(0,this.cooldown-dt);this.recoil*=Math.exp(-dt*16);
  const firing=action==='fire'||state.fire;
  if(firing&&this.cooldown<=0){this.cooldown=this.weapon.definition.interval;this.recoil=1;this.events.push({type:'fire',weapon:this.weapon.id});}
  if(action==='hit')this.chest.rotation.x-=Math.exp(-e*9)*.18;
  this.weaponMount.position.z=(mech?.16:.17)-this.recoil*.025;
  this.weaponMount.updateMatrix();
  for(const A of this.arms){let grip=(A.s>0?this.weapon.grips.right:this.weapon.grips.left).clone().applyMatrix4(this.weaponMount.matrix);
   if(action==='reload'&&A.s<0)grip.set(-.12,.15,.22+Math.sin(e*6)*.08);
   if(action==='salute'&&A.s>0)grip.set(.16,.76,.14);
   maxError=Math.max(maxError,solve(T,A.shoulder,A.elbow,grip,A.upperLength,A.lowerLength,new T.Vector3(A.s*.85,-.4,-.3)));
   A.hand.quaternion.copy(A.shoulder.quaternion.clone().multiply(A.elbow.quaternion).invert()).multiply(this.weaponMount.quaternion);
  }
  for(const fan of this.fans)fan.rotor.rotation.y=t*24*fan.s;
  for(const plume of this.thrusters){plume.visible=action==='boost'||(action==='jump'&&e<.5);plume.scale.z=1+Math.sin(t*50)*.15;}
  this.weapon.update(t,this.recoil,firing&&this.cooldown>this.weapon.definition.interval-.045);
  this.root.updateMatrixWorld(true);this.ikError=maxError;
  return this.events;
 }
 muzzle(index=0){const point=this.weapon.muzzles[index];const origin=point.getWorldPosition(new this.T.Vector3()),direction=point.getWorldDirection(new this.T.Vector3());return {origin,direction};}
 dispose(){this.weapon.dispose();const gs=new Set(),ms=new Set(),ts=new Set();this.root.traverse(o=>{if(!o.isMesh)return;gs.add(o.geometry);if(![this.skin.material,this.skin.visor,this.skin.glow,this.skin.black].includes(o.material)){ms.add(o.material);if(o.material.map)ts.add(o.material.map);}});gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());ts.forEach(t=>t.dispose());this.root.removeFromParent();}
}

export {WEAPONS};

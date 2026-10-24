import * as THREE from '../../js/three.js';
import { Mech } from '../../js/mech.js';
import { addOutline, frontPrism } from '../../js/atlas.js';
import { citadelKit } from './citadel-kit.js';

// Fresh procedural geometry. No source STL vertices, surfaces or gun geometry.
// Original VECTORCLAD hierarchy: +Y up, +Z forward, unchanged game-unit rig.
export class CitadelMech extends Mech {
 constructor(mats,glowTex){
  super(mats,glowTex);this.frameId='citadel';this.frameName='AX-19 Citadel';
  const keep=new Set();for(const t of this.allThrusters())t.group.traverse(o=>keep.add(o));for(const p of this.pistons){keep.add(p.barrel);keep.add(p.rod);}
  const removed=[];this.root.traverse(o=>{if((o.isMesh||o.isSprite)&&!keep.has(o))removed.push(o)});for(const o of removed)o.removeFromParent();this.outlines=this.outlines.filter(o=>keep.has(o));
  this.citadelVisuals=[];this.buildCitadel();for(const g of this.citadelVisuals)this.outlines.push(...addOutline(g,.009));
 }
 animate(dt,st){
  const result=super.animate(dt,st);
  // Keep the stock planted-foot solver and leg pose; straighten only the upper rig.
  const lift=.17*(1-this.w.crouch)*(1-.7*this.w.dash);
  this.waist.rotation.x-=lift;
  this.head.rotation.x+=lift*.7;
  this.arms.forEach((arm,i)=>arm.sh.rotation.x+=lift*this.w.aim[i]);
  this.root.updateMatrixWorld(true);
  for(const piston of this.pistons)piston.update();
  for(const thruster of this.thrusters.main)thruster.updateRams();
  return result;
 }
 buildCitadel(){
  const K=this.kit=citadelKit(),{mesh,box,hull,panel,cyl,ring,rod,hose,vent,bearing,label}=K;
  const skin=(p,name)=>{let g=K.group(p,'AX19 / '+name);this.citadelVisuals.push(g);return g;};
  const core=skin(this.pelvis,'pelvic cradle');
  box(core,.85,.52,.77,0,-.03,0,'navy');cyl(core,.17,1.7,0,-.12,0,'metal','x');
  panel(core,[[-.32,.17],[.32,.17],[.43,-.18],[.22,-.44],[-.22,-.44],[-.43,-.18]],.22,0,0,.48,'armor');
  box(core,.5,.075,.05,0,-.06,.63,'copper');
  this.hipPads.forEach((pad,i)=>{let s=i===0?-1:1,g=skin(pad,'floating hip plate '+s);panel(g,[[-.3,.16],[.3,.16],[.41,-.34],[.19,-.72],[-.24,-.62],[-.4,-.1]],.16,0,0,.24,'navy');box(g,.38,.1,.055,0,-.05,.35,'copper');});
  const abdomen=skin(this.waist,'protected spinal joint');cyl(abdomen,.27,.74,0,.15,0,'frame','y');
  for(const s of [-1,1]){rod(abdomen,[s*.25,-.16,.15],[s*.37,.56,.14],.044,'copper');hose(abdomen,[[s*.25,.6,-.09],[s*.37,.2,-.14],[s*.3,-.2,.1]],.04);}
  const chest=skin(this.chest,'reactor enclosure');
  hull(chest,[{y:-.12,w:1.07,d:.9,c:.2},{y:.26,w:1.6,d:1.22,c:.23,z:-.1},{y:1.05,w:2.36,d:1.4,c:.28,z:-.13},{y:1.4,w:1.7,d:1.03,c:.2,z:-.17}],'navy');
  // Split horseshoe armor leaves a luminous, recessed circular reactor chamber.
  for(const s of [-1,1]){
   panel(chest,[[s*.36,.25],[s*.65,.1],[s*1.2,.53],[s*1.16,1.12],[s*.68,1.34],[s*.39,1.08]],.27,0,0,.69,'armor',s*.15);
   panel(chest,[[s*.68,1.25],[s*1.04,1.32],[s*1.24,1.13],[s*1.11,.98],[s*.62,1.04]],.08,0,0,.88,'white',s*.15);
   box(chest,.11,.63,.09,s*.94,.68,.91,'copper',0,0,-s*.19);
   vent(chest,s*1.05,.47,-.06,.22,4);rod(chest,[s*.4,.13,.63],[s*.57,.49,.75],.04,'metal');
  }
  cyl(chest,.4,.1,0,.77,.72,'dark');ring(chest,.32,.045,0,.77,.79,'metal');cyl(chest,.235,.025,0,.77,.795,'light');
  for(const s of [-1,1])rod(chest,[s*.22,.46,.86],[-s*.22,1.08,.86],.027,'copper');
  panel(chest,[[-.55,.28],[.55,.28],[.37,-.04],[-.37,-.04]],.15,0,0,.62,'armor');label(chest,'AX-19',0,.13,.72,.5);
  // Compact core bracing and bolt-on service modules, with space for the waist joint.
  for(const s of [-1,1]){
   box(chest,.27,.46,.22,s*.72,.35,.64,'navy',0,0,-s*.12);
   box(chest,.18,.08,.04,s*.72,.42,.78,'gold');
   box(chest,.25,.2,.42,s*.97,.89,.17,'navy');
   for(const y of [.26,.5])cyl(chest,.023,.03,s*.73,y,.79,'metal','z');
   rod(chest,[s*.82,1.12,-.35],[s*.55,.15,-.34],.052,'metal');
  }
  const head=skin(this.head,'gold anime helmet');
  cyl(head,.15,.34,0,-.16,-.02,'metal','y');
  hull(head,[{y:-.12,w:.42,d:.42,c:.09,z:-.01},{y:.19,w:.61,d:.54,c:.13,z:-.03},{y:.47,w:.49,d:.45,c:.12,z:-.12}],'navy');
  panel(head,[[-.24,.22],[-.17,.49],[0,.58],[.17,.49],[.24,.22],[.12,.16],[-.12,.16]],.16,0,0,.26,'gold');
  panel(head,[[-.19,.15],[.19,.15],[.17,-.11],[.1,-.25],[-.1,-.25],[-.17,-.11]],.065,0,0,.35,'dark');
  // One closed, full-width extrusion joins both cheeks and the hooked face.
  const beak=panel(head,[[.16,.27],[.36,.32],[.55,.24],[.75,.1],[.82,-.04],[.65,-.09],[.48,-.16],[.33,-.23],[.18,-.2]],.46,0,0,0,'gold');
  beak.geometry.rotateY(-Math.PI/2);
  // Close the broad cheek section into a narrow centerline tip in plan view.
  const beakPositions=beak.geometry.attributes.position;
  for(let i=0;i<beakPositions.count;i++){
   const forward=beakPositions.getZ(i);
   const taper=1-Math.min(1,Math.max(0,(forward-.46)/.36));
   beakPositions.setX(i,beakPositions.getX(i)*taper);
  }
  beakPositions.needsUpdate=true;beak.geometry.computeVertexNormals();
  beak.geometry.computeBoundingBox();beak.geometry.computeBoundingSphere();
  beak.name='solid gold tapered face';
  for(const s of [-1,1]){
   const socket=panel(head,[[.3,.2],[.53,.18],[.58,.08],[.35,.07]],.022,s*.251,0,0,'dark');socket.geometry.rotateY(-Math.PI/2);
   const eye=panel(head,[[.34,.17],[.5,.15],[.53,.1],[.38,.1]],.018,s*.27,0,0,'light');eye.geometry.rotateY(-Math.PI/2);
   const nostril=panel(head,[[.62,.04],[.7,.015],[.69,-.025],[.62,-.01]],.012,s*.251,0,0,'dark');nostril.geometry.rotateY(-Math.PI/2);
   panel(head,[[s*.05,.2],[s*.28,.27],[s*.23,.15],[s*.07,.1]],.05,0,0,.39,'gold');
   panel(head,[[s*.07,.11],[s*.22,.16],[s*.2,.1],[s*.08,.07]],.025,0,0,.42,'light');
   panel(head,[[s*.22,.06],[s*.32,.02],[s*.28,-.2],[s*.14,-.28],[s*.13,-.1]],.12,0,0,.3,'gold',s*.14);
   // Paired swept antennae and a layered rear crown.
   const antenna=panel(head,[[s*.15,0],[s*.25,.08],[s*.41,.74],[s*.35,.88],[s*.27,.53]],.055,0,.35,.1,'gold',-s*.12);
   antenna.rotation.x=-Math.PI*.31;
   panel(head,[[s*.24,.31],[s*.49,.48],[s*.69,.62],[s*.51,.2],[s*.29,.13]],.06,0,0,-.23,'gold',s*.55);
   panel(head,[[s*.25,.15],[s*.5,.2],[s*.56,.07],[s*.3,-.03]],.04,0,0,-.25,'navy',s*.55);
   bearing(head,s*.34,.12,-.03,.17,'x');ring(head,.115,.018,s*.435,.12,-.03,'gold','x');
   for(let j=0;j<3;j++)hose(head,[[s*(.12+j*.04),-.31,-.1],[s*(.25+j*.035),-.13,-.21],[s*.28,.15,-.25-j*.04]],.014,j===1?'gold':'frame');
   for(let j=0;j<4;j++)cyl(head,.016,.02,s*(.2+j*.018),-.1-j*.035,.39,'metal','z');
  }
  panel(head,[[-.035,.41],[0,.78],[.035,.41],[0,.2]],.065,0,0,-.035,'navy');
  for(const L of this.legs){const s=L.s;
   const hip=skin(L.hip,'segmented femur '+s);bearing(hip,s*.36,-.09,.02,.23,'x');
   hull(hip,[{y:-.16,w:.75,d:.86,c:.16},{y:-.58,w:.94,d:.93,c:.21,z:.01},{y:-1.31,w:.7,d:.73,c:.16},{y:-1.61,w:.46,d:.5,c:.11}],'navy');
   for(let j=0;j<3;j++)panel(hip,[[-.31,.03],[.31,.03],[.36,-.25],[.2,-.4],[-.24,-.36]],.15,0,-.29-j*.36,.5-j*.02,'armor');
   box(hip,.09,.7,.06,s*.34,-.73,.51,'copper');rod(hip,[-s*.19,-.24,-.27],[-s*.17,-1.5,-.19],.045,'metal');
   box(hip,.22,.83,.52,s*.36,-.65,-.06,'armor',0,0,-s*.08);
   box(hip,.045,.39,.06,s*.49,-.62,.25,'navy');
   this.pistons.push(K.hydraulic(L.hip,[s*.43,-.29,.2],L.knee,[s*.4,-.58,.19],.055));
   const knee=skin(L.knee,'split knee and greave '+s);bearing(knee,s*.37,0,0,.25,'x');
   hull(knee,[{y:.16,w:.7,d:.84,c:.18,z:.05},{y:-.34,w:.92,d:.96,c:.21,z:.02},{y:-1.32,w:.81,d:.8,c:.17,z:-.09},{y:-2.35,w:.45,d:.49,c:.1,z:0}],'navy');
   panel(knee,[[-.36,.61],[-.12,.31],[0,.2],[.12,.31],[.36,.61],[.45,-.24],[.22,-.61],[-.22,-.61],[-.45,-.24]],.28,0,0,.48,'armor');
   box(knee,.41,.08,.055,0,-.04,.62,'copper');
   for(const side of [-1,1]){
    box(knee,.18,.55,.51,side*.35,-.1,.21,'navy');
    cyl(knee,.07,.055,side*.38,-.05,.5,'metal','z');
   }
   panel(knee,[[-.28,-.25],[.28,-.25],[.32,-.43],[.16,-.67],[-.16,-.67],[-.32,-.43]],.12,0,0,.61,'navy');
   box(knee,.35,.19,.29,0,-1.64,-.42,'metal');
   this.pistons.push(K.hydraulic(L.knee,[-s*.24,-.66,-.28],L.ankle,[-s*.16,.12,-.13],.043));
   for(const side of [-1,1])panel(knee,[[side*.03,-.72],[side*.31,-.7],[side*.36,-1.5],[side*.18,-2.32],[side*.03,-2.2]],.17,0,0,.38,'armor',side*.08);
   box(knee,.08,1.18,.1,0,-1.43,.47,'frame');box(knee,.045,.65,.04,0,-1.2,.53,'light');
   cyl(knee,.21,.16,s*.48,-.84,-.2,'metal','x');vent(knee,0,-1.86,-.33,.25,4);
   const ankle=skin(L.ankle,'three-pad landing foot '+s);
   box(ankle,.65,.36,.7,0,-.11,.04,'navy');bearing(ankle,s*.35,.02,0,.17,'x');
   // Both long toes extend along +Z, matching the player and weapon forward axis.
   for(const side of [-1,1]){let toe=mesh(ankle,frontPrism([[-.2,-.22],[.66,-.22],[1.17,-.43],[1.2,-.53],[-.24,-.53]],.29,.018).rotateY(-Math.PI/2),'armor',side*.19);toe.name='forward toe '+side;box(ankle,.27,.045,1.26,side*.19,-.535,.45,'frame');box(ankle,.17,.06,.31,side*.19,-.31,.72,'copper');}
   box(ankle,.42,.28,.38,0,-.39,-.35,'navy');rod(ankle,[s*.18,.14,-.1],[s*.2,-.3,-.42],.025,'metal');
   L.toeMarker=new THREE.Object3D();L.toeMarker.name='toe +Z';L.toeMarker.position.set(0,-.4,1.15);L.ankle.add(L.toeMarker);
   L.heelMarker=new THREE.Object3D();L.heelMarker.name='heel -Z';L.heelMarker.position.set(0,-.4,-.5);L.ankle.add(L.heelMarker);
   label(knee,s<0?'19-R':'19-L',0,-.91,.56,.37);
  }
  for(const A of this.arms){let s=A.s,upper=skin(A.sh,'upper arm '+s);
   bearing(upper,s*.27,-.05,0,.24,'x');box(upper,.57,.78,.65,0,-.48,.02,'navy');
   panel(upper,[[-.24,-.2],[.24,-.2],[.3,-.65],[.12,-.86],[-.18,-.82]],.14,0,0,.39,'armor');
   rod(upper,[-s*.17,-.1,-.16],[-s*.17,-.8,-.16],.04,'copper');
   const pa=skin(A.pauldron,'arched collar shoulder '+s);
   hull(pa,[{y:-.38,w:1.0,d:.98,c:.22},{y:.14,w:1.19,d:1.17,c:.27,z:-.02},{y:.48,w:.8,d:.89,c:.2,z:-.09}],'armor',s*.16);
   box(pa,.67,.14,.75,s*.2,.49,-.05,'navy');box(pa,.4,.06,.12,s*.27,.59,.21,'copper');
   // Squared replaceable shoulder blocks over the round structural joint.
   box(pa,.7,.23,.72,s*.24,.4,.12,'navy');
   panel(pa,[[s*.05,.32],[s*.62,.32],[s*.71,-.12],[s*.49,-.32],[s*.12,-.2]],.12,0,0,.62,'armor');
   box(pa,.18,.055,.07,s*.5,.04,.71,'gold');
   for(const x of [.14,.52])cyl(pa,.025,.03,s*x,.23,.715,'metal','z');
   for(let j=0;j<3;j++)panel(pa,[[s*.21,.18-j*.14],[s*.64,.09-j*.14],[s*.78,-.25-j*.15],[s*.55,-.2-j*.15]],.055,0,0,.6-j*.03,'navy',s*.1);
   for(let j=0;j<3;j++)cyl(pa,.022,.035,s*(.12+j*.18),.43,.51,'copper','z');
   const shoulderFin=K.group(pa,'swept shoulder stabilizer '+s);
   shoulderFin.position.set(s*.18,.22,-.3);shoulderFin.rotation.set(-.78,-s*.28,-s*.18);shoulderFin.scale.set(1.85,1.85,1.12);
   panel(shoulderFin,[[s*.05,.03],[s*.2,.37],[s*.65,.99],[s*.82,1.07],[s*.72,.5],[s*.35,-.07]],.12,0,0,-.05,'navy');
   panel(shoulderFin,[[s*.25,.29],[s*.66,.85],[s*.72,.9],[s*.58,.5],[s*.34,.17]],.045,0,0,.035,'armor');
   panel(shoulderFin,[[s*.31,.24],[s*.59,.66],[s*.62,.67],[s*.38,.22]],.018,0,0,.07,'gold');
   const fore=skin(A.elbow,'braced forearm '+s);bearing(fore,s*.28,0,0,.18,'x');
   hull(fore,[{y:.09,w:.56,d:.65,c:.14},{y:-.3,w:.82,d:.88,c:.18,z:.04},{y:-.81,w:.76,d:.8,c:.17,z:.03},{y:-1.15,w:.44,d:.5,c:.1}],'navy');
   panel(fore,[[-.31,-.16],[.31,-.16],[.37,-.62],[.18,-1.1],[-.24,-1.02]],.18,0,0,.47,'armor');
   for(let j=0;j<3;j++)box(fore,.45,.045,.06,0,-.38-j*.14,.61,'metal');box(fore,.08,.67,.05,s*.32,-.52,.5,'copper');
   for(const y of [-.24,-.83]){cyl(fore,.03,.035,-.21,y,.61,'metal','z');cyl(fore,.03,.035,.21,y,.61,'metal','z');}
   hose(fore,[[s*.2,-.1,-.23],[s*.29,-.4,-.3],[s*.22,-1,-.19]],.025);
   const hand=skin(A.hand,'gripper '+s);box(hand,.35,.25,.32,0,-.13,.02,'frame');for(let j=0;j<3;j++)box(hand,.09,.23,.13,(j-1)*.105,-.32,.12,'metal');box(hand,.1,.25,.13,-s*.2,-.22,.04,'copper');
  }
  const back=skin(this.backpack,'low reactor pack');box(back,1.37,.88,.68,0,.04,-.3,'navy');vent(back,0,.02,-.68,.71,6);
  // Separate bolted propulsion housings frame the inherited gimballed thrusters.
  for(const s of [-1,1]){
   hull(back,[{y:.38,w:.46,d:.58,c:.1,z:-.36},{y:-.22,w:.54,d:.69,c:.12,z:-.39},{y:-.61,w:.45,d:.6,c:.1,z:-.43}],'armor',s*.45);
   box(back,.38,.12,.12,s*.45,.25,-.73,'navy');
   box(back,.24,.05,.07,s*.45,.14,-.77,'gold');
   vent(back,s*.45,-.08,-.75,.28,4);
   hose(back,[[s*.23,.3,-.66],[s*.23,.05,-.83],[s*.42,-.34,-.76]],.035,'frame');
   cyl(back,.12,.13,s*.7,-.17,-.48,'metal','x');
  }
  for(const s of [-1,1]){
   // Six-round missile cassettes in U-shaped trunnion yokes, not floating discs.
   const support=skin(this.chest,'launcher support '+s);
   box(support,.28,.62,.5,s*.96,.96,-.92,'navy');
   rod(support,[s*.91,.72,-.9],[s*1.43,1.58,-1.1],.105,'metal');
   rod(support,[s*.9,1.04,-1.18],[s*1.43,1.58,-.82],.065,'gold');
   box(support,.34,.19,.7,s*1.43,1.36,-.95,'navy');
   const launcher=skin(this.chest,'six-cell drum '+s);launcher.position.set(s*1.43,1.76,-.96);launcher.rotation.x=-.12;
   cyl(launcher,.52,1.02,0,0,-.06,'navy','z',48);
   ring(launcher,.51,.045,0,0,.45,'gold');ring(launcher,.51,.045,0,0,-.55,'metal');
   cyl(launcher,.455,.06,0,0,.47,'frame','z',48);
   for(let j=0;j<6;j++){
    let a=j*Math.PI/3,x=Math.cos(a)*.3,y=Math.sin(a)*.3;
    // Deep sleeve, dark bore and recessed round nose form distinct loaded tubes.
    cyl(launcher,.118,.18,x,y,.53,'metal','z',24);
    cyl(launcher,.092,.025,x,y,.63,'dark','z',24);
    cyl(launcher,.061,.014,x,y,.648,'navy','z',24);
    cyl(launcher,.022,.016,x,y,.659,'gold','z',16);
   }
   cyl(launcher,.1,.07,0,0,.53,'gold','z',24);
   for(const side of [-1,1]){box(launcher,.1,.3,.74,side*.56,-.13,-.06,'armor');bearing(launcher,side*.58,0,-.02,.12,'x');}
   cyl(launcher,.36,.08,0,0,-.62,'metal','z',36);cyl(launcher,.28,.025,0,0,-.675,'navy','z',36);
   for(let j=0;j<4;j++)box(launcher,.31,.024,.025,0,-.1+j*.065,-.697,'frame');
   label(launcher,'M6',0,-.18,.67,.16);
   const radiator=skin(this.backpack,'folded radiator '+s);radiator.position.set(s*.64,.02,-.55);radiator.rotation.set(.12,s*.45,s*.33);
   panel(radiator,[[-.11,.4],[.29,.53],[.48,-.73],[.21,-1.2],[-.1,-.9]],.14,0,0,0,'navy');for(let j=0;j<7;j++)box(radiator,.25,.035,.09,.15,.21-j*.17,.1,'copper');
   const wing=skin(this.backpack,'swept backpack wing '+s);
   wing.position.set(s*.56,.18,-.43);wing.rotation.set(.2,s*.48,-s*.64);wing.scale.set(1.38,1.38,1.08);
   panel(wing,[[0,.08],[s*.28,.4],[s*1.13,1.0],[s*1.42,1.02],[s*.98,.39],[s*.25,-.33]],.15,0,0,-.16,'navy');
   panel(wing,[[s*.19,.09],[s*.41,.36],[s*1.13,.83],[s*.85,.33],[s*.3,-.12]],.055,0,0,-.06,'armor');
   panel(wing,[[s*.35,.09],[s*.84,.41],[s*1.05,.65],[s*.71,.43]],.02,0,0,-.015,'gold');
   rod(wing,[s*.12,.03,-.04],[s*.64,.36,-.05],.035,'metal');
  }
 }
}

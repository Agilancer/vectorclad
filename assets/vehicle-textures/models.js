import {finishVehicle,addWingRotor} from './vehicle-finish.js';
// The allied vehicles: the Kestrel assault lifter (dropship) and the Bastion armored carrier (the
// tanks), copied from the builders in assets/riftlings/preview.html, plus the Kestrel H heavy lifter,
// the variant that carries the mech in. Models are authored in meters with -Z forward and +Y up;
// options.metersPerUnit scales them into game units.
export function workshop(T, options) {
  const mats = {};
  const colors = { armor: options.color ?? 0x31343a, edge: 0x737b54,
    dark: 0x171b20, metal: 0x535b5c, rubber: 0x161c1e,
    glass: 0x173b43, brass: 0xb0a06a, white: 0xd6d4b9, red: 0x9e4235, ...options.palette };
  for (const [k,c] of Object.entries(colors)) mats[k] = new T.MeshStandardMaterial({
    name:'vehicle:'+k,color:c, roughness:k==='glass'?.22:.78, metalness:k==='rubber'?0:.35 });
  mats.glass.emissive.setHex(0x12313c); mats.glass.emissiveIntensity=.35;
  mats.light = new T.MeshStandardMaterial({color:0xffeac2,emissive:0xffcc83,emissiveIntensity:2});
  mats.engine = new T.MeshStandardMaterial({color:0x89daf5,emissive:0x279ccc,emissiveIntensity:2});
  const mesh=(parent,geo,mat,x=0,y=0,z=0)=>{const m=new T.Mesh(geo,mats[mat]||mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;};
  const box=(p,w,h,d,x,y,z,m='armor')=>mesh(p,new T.BoxGeometry(w,h,d),m,x,y,z);
  const cyl=(p,r1,r2,h,x,y,z,m='metal',axis='y',segments=16)=>{const q=mesh(p,new T.CylinderGeometry(r1,r2,h,segments),m,x,y,z);if(axis==='x')q.rotation.z=Math.PI/2;if(axis==='z')q.rotation.x=Math.PI/2;return q;};
  // Octagonal loft: z, half-width, bottom, top. Explicit hard-edge faces.
  function hull(p, sections, mat='armor') {
    const rings=sections.map(([z,w,b,t])=>[[-w*.7,b,z],[w*.7,b,z],[w,b+(t-b)*.22,z],[w,t-(t-b)*.22,z],[w*.7,t,z],[-w*.7,t,z],[-w,t-(t-b)*.22,z],[-w,b+(t-b)*.22,z]]);
    let v=[];const tri=(a,b,c)=>v.push(...a,...b,...c);
    for(let k=0;k<rings.length-1;k++)for(let j=0;j<8;j++){let a=rings[k][j],b=rings[k][(j+1)%8],c=rings[k+1][j],d=rings[k+1][(j+1)%8];tri(a,b,c);tri(b,d,c);}
    for(let j=1;j<7;j++){tri(rings[0][0],rings[0][j+1],rings[0][j]);let r=rings.at(-1);tri(r[0],r[j],r[j+1]);}
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(v,3));g.computeVertexNormals();return mesh(p,g,mat);
  }
  function plate(p,points,thickness,y,mat='armor') {
    const shape=new T.Shape();points.forEach(([x,z],i)=>i?shape.lineTo(x,-z):shape.moveTo(x,-z));shape.closePath();
    const g=new T.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:false,steps:1});g.rotateX(-Math.PI/2);return mesh(p,g,mat,0,y,0);
  }
  function label(p,text,w,h,x,y,z,ry=0){
    const c=document.createElement('canvas');c.width=512;c.height=128;const ctx=c.getContext('2d');
    ctx.fillStyle='#d9d8bd';ctx.font='bold 82px monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,256,68);
    const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;
    const mat=new T.MeshStandardMaterial({map:tex,transparent:true,roughness:.9,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,side:T.DoubleSide});
    const m=mesh(p,new T.PlaneGeometry(w,h),mat,x,y,z);m.rotation.y=ry;m.castShadow=false;return m;
  }
  function group(p,name,x=0,y=0,z=0){let g=new T.Group();g.name=name;g.position.set(x,y,z);p.add(g);return g;}
  // Merge static siblings by material, keeping movable groups intact.
  function batch(g){
    g.updateMatrixWorld(true);let buckets=new Map();
    for(const m of [...g.children]){if(!m.isMesh||m.userData.rotor)continue;m.updateMatrix();let geo=m.geometry.index?m.geometry.toNonIndexed():m.geometry.clone();geo.applyMatrix4(m.matrix);let b=buckets.get(m.material)||[];b.push(geo);buckets.set(m.material,b);g.remove(m);m.geometry.dispose();}
    for(const [mat,list] of buckets){const geo=new T.BufferGeometry();for(const key of ['position','normal','uv']){if(!list.every(g=>g.getAttribute(key)))continue;let size=list[0].getAttribute(key).itemSize;let arr=new Float32Array(list.reduce((s,g)=>s+g.getAttribute(key).array.length,0)),offset=0;for(const g of list){arr.set(g.getAttribute(key).array,offset);offset+=g.getAttribute(key).array.length;}geo.setAttribute(key,new T.BufferAttribute(arr,size));}for(const g of list)g.dispose();mesh(g,geo,mat);}
  }
  function finish(root,parts){
    finishVehicle(T,root,root.name.includes('Bastion')?'apc':'dropship');
    for(const g of parts)batch(g);
    const metersPerUnit=options.metersPerUnit??1;if(!(metersPerUnit>0))throw Error('metersPerUnit must be positive');root.scale.setScalar(1/metersPerUnit);
    root.userData={...root.userData,metersPerUnit,forward:'-Z',up:'+Y',originalProceduralGeometry:true};
    root.userData.dispose=()=>{const gs=new Set(),ms=new Set(),ts=new Set();root.traverse(o=>{if(o.geometry)gs.add(o.geometry);if(o.material)for(const m of (Array.isArray(o.material)?o.material:[o.material])){ms.add(m);if(m.map&&!m.map.userData.sharedVehicleTexture)ts.add(m.map);}});gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());ts.forEach(t=>t.dispose());};return root;
  }
  return {mats,mesh,box,cyl,hull,plate,label,group,finish};
}

/**
 * options.lifter builds the Kestrel H: lift fans in place of the rocket pods and a cradle under the
 * belly whose clamp arms hold the mech by the shoulders. userData.hang is where the mech's feet hang
 * (model meters), userData.setClamp(k) opens the arms (0 shut, 1 open).
 */
export function createDropship(THREE, options={}) {
  const T=THREE, {box,cyl,hull,plate,label,group,finish}=workshop(T,options);
  const lifter=!!options.lifter, tag=lifter?'H7':'07';
  const root=new T.Group();root.name=lifter?'VECTORCLAD / Kestrel H heavy lifter':'VECTORCLAD / Kestrel assault lifter';
  const body=group(root,'fuselage');
  hull(body,[[-12,.8,1.8,2.8],[-9,1.55,1.25,4.0],[-5,2.5,.7,4.6],[3.8,2.5,.7,4.4],[7.5,1.45,1.4,3.4],[12,.7,2.05,2.8]]);
  hull(body,[[-11.2,.85,2.6,3.3],[-8.2,1.25,3.6,4.8],[-5.6,1.35,3.8,4.7]],'dark');
  // Faceted tinted cockpit with a central armored spine.
  hull(body,[[-10.65,.68,2.98,3.35],[-8.2,.98,3.95,4.63],[-6.2,1.02,4.0,4.55]],'glass');
  box(body,.15,.16,4.6,0,4.12,-8.2,'edge').rotation.x=-.26;
  for(const z of [-9,-7.3])box(body,2.1,.1,.12,0,4.25+(z+8)*.22,z,'edge').rotation.x=-.26;
  box(body,3.7,.28,7.4,0,.65,-.4,'dark');
  // Cargo lift underside and its structural rails.
  box(body,3.35,.17,6.6,0,.43,-.4,'metal');
  for(const s of [-1,1]){box(body,.16,.25,7.4,s*1.65,.5,-.4,'brass');for(let z=-3;z<=2;z+=1)box(body,2.9,.05,.08,0,.33,z,'dark');}
  for(const s of [-1,1]){
    // Shoulder-mounted turbine housings, exposed intakes, rear exhausts.
    hull(body,[[-5.0,.55,3.4,4.6],[-3.7,.85,3.1,5.1],[3.8,.8,3.0,4.9],[5.2,.52,3.4,4.5]],'edge').position.x=s*2.55;
    cyl(body,.57,.57,.12,s*2.55,4.05,-5.04,'dark','z');
    for(let k=0;k<8;k++){const a=k*Math.PI/4;box(body,.08,.85,.06,s*2.55,4.05,-5.13,'metal').rotation.z=a;}
    cyl(body,.49,.63,.9,s*2.55,3.95,5.05,'metal','z');cyl(body,.38,.38,.06,s*2.55,3.95,5.53,'engine','z');
    for(const z of [-2,1.1]){cyl(body,.44,.56,.38,s*2.5,1.6,z,'metal','x');cyl(body,.3,.3,.04,s*2.72,1.6,z,'dark','x');}
    box(body,.09,1.75,5.8,s*2.505,2.45,-.25,'edge');
    label(body,'VC / '+tag,2.6,.5,s*2.57,2.7,.5,s*Math.PI/2);
    for(let k=0;k<9;k++)box(body,.1,.06,.42,s*1.7,4.48,-1.7+k*.52,'dark');
    // Swept aft wings and outward-canted twin vertical stabilizers.
    plate(body,[[s*.6,6],[s*3.1,5.4],[s*7.2,10.6],[s*7.0,12],[s*2.1,9.5]],.2,2.65);
    plate(body,[[s*1.4,7],[s*3,6.8],[s*6.8,10.7],[s*6.6,11]],.05,2.86,'edge');
    let tail=group(root,'tail fin '+s,s*.9,2.7,8.2);
    const fin=plate(tail,[[0,-1],[0,3.5],[2.7,3.9],[1.9,1.1]],.16,0);fin.rotation.z=Math.PI/2;tail.rotation.z=-s*.18;
    label(body,tag,1,.65,s*2.3,3.3,6.2,s*Math.PI/2);
  }
  // Folding forward weapon outriggers, each on a real pivot.
  const wings=[];
  for(const s of [-1,1]){
    const wing=group(root,'weapon outrigger '+s,s*2.2,3.05,-4.2);wings.push(wing);
    plate(wing,lifter?[[0,-1.3],[s*2.7,-1.3],[s*2.7,1.3],[0,1.7]]:[[0,-1.3],[s*3.5,-1.9],[s*4.9,.1],[s*4.5,2.6],[0,1.7]],.3,0);
    if(lifter){
      // Open duct with a counter-rotating textured rotor, retained by two guard struts.
      const fan=group(wing,'lift fan',s*4.05,-.15,.1);
      const wall=new T.Mesh(new T.CylinderGeometry(1.45,1.45,.75,48,1,true),new T.MeshStandardMaterial({color:0x25282d,metalness:.6,roughness:.4,side:T.DoubleSide}));fan.add(wall);
      for(const y of [-.36,.37]){const ring=new T.Mesh(new T.TorusGeometry(1.33,.12,8,48),new T.MeshStandardMaterial({color:0xd6a547,metalness:.92,roughness:.22}));ring.rotation.x=Math.PI/2;ring.position.y=y;fan.add(ring);}
      addWingRotor(T,fan,s);
      for(let k=0;k<2;k++)box(fan,.08,.08,2.65,0,.4,0,'edge').rotation.y=k*Math.PI/2;
      box(fan,.32,.14,.12,s*1.47,.1,-.6,'light');
      label(fan,'LIFT',1.2,.3,0,.39,1.46);
      continue;
    }
    const pod=group(wing,'rocket pod',s*4.05,-.15,.1);
    hull(pod,[[-2.05,.62,-.7,.7],[-1.7,.9,-.85,.85],[1.35,.9,-.85,.85],[1.8,.55,-.55,.55]],'armor');
    box(pod,1.5,1.45,.08,0,0,-2.09,'dark');
    for(let row=0;row<3;row++)for(let col=0;col<3;col++){
      cyl(pod,.16,.16,.09,(col-1)*.43,(row-1)*.43,-2.16,'metal','z',10);
      cyl(pod,.11,.11,.02,(col-1)*.43,(row-1)*.43,-2.215,'rubber','z',10);
    }
    for(let k=0;k<5;k++)box(pod,1.4,.055,.1,0,.87,-1.1+k*.45,'dark');
    label(pod,'CAUTION',1.1,.2,0,.4,1.73);
  }
  const gun=group(root,'chin turret',0,1.7,-10.7);cyl(gun,.46,.54,.45,0,0,0,'dark');
  for(const x of [-.22,.22]){cyl(gun,.11,.14,1.75,x,-.15,-.9,'metal','z');cyl(gun,.08,.08,.1,x,-.15,-1.82,'rubber','z');}
  for(const s of [-1,1])box(body,.24,.15,.09,s*.85,2,-11.2,'light');
  const gear=[];
  for(const [x,z] of [[-2,3.6],[2,3.6],[0,-8]]){const g=group(root,'landing strut',x,1.25,z);cyl(g,.09,.13,1.7,0,-.85,0,'metal');box(g,.9,.22,1.5,0,-1.7,0,'dark');box(g,.8,.06,1.3,0,-1.84,0,'edge');gear.push(g);}
  const clamps=[];
  if(lifter){
    // The cradle: a keel beam and a grapple pad under the belly, and a clamp arm down each side
    // that closes under the mech's shoulders. Hazard paint marks the grapple.
    const cradle=group(root,'mech cradle',0,.2,-.6);
    box(cradle,1.1,.55,8.2,0,-.15,0,'dark');box(cradle,3.1,.32,2.9,0,-.55,0,'metal');
    box(cradle,3.3,.08,3.1,0,-.74,0,hazard(T));
    for(const z of [-1.1,1.1])cyl(cradle,.24,.24,.5,0,-.95,z,'brass');
    for(const s of [-1,1]){
      box(cradle,.6,.6,2.2,s*1.75,-.35,0,'armor');
      const arm=group(cradle,'clamp arm '+s,s*1.95,-.5,0);clamps.push(arm);
      box(arm,.42,2.4,1.5,s*.25,-1.15,0,'armor');box(arm,.46,.24,1.6,s*.25,-.1,0,'edge');
      box(arm,1.45,.42,1.4,-s*.35,-2.35,0,'dark').rotation.z=s*.28;
      box(arm,.4,.18,1.5,-s*.95,-2.12,0,hazard(T)).rotation.z=s*.28;
      for(const z of [-.45,.45])cyl(arm,.09,.09,1.6,s*.62,-1,z,'metal','y',8);
      box(arm,.08,1.8,.2,s*.48,-1.1,.78,'light');
    }
    label(body,'HEAVY LIFT',2.3,.4,0,.27,2.6,0).rotation.x=Math.PI/2;
  }
  const all=[];root.traverse(o=>{if(o.isGroup)all.push(o)});
  root.userData.setFlightMode=(flight)=>{wings.forEach((w,i)=>w.rotation.z=(i===0?-1:1)*(flight?.08:.78));gear.forEach(g=>g.visible=!flight);};
  root.userData.setFlightMode(true);
  if(lifter){
    root.userData.hang=new T.Vector3(0,-8.15,-.6);
    root.userData.setClamp=(k)=>clamps.forEach((a,i)=>a.rotation.z=(i?-1:1)*-.75*k);
  }
  return finish(root,all);
}

let hazardMat=null;
/** Yellow and black chevrons for the lifter's grapple */
function hazard(T){
  if(hazardMat)return hazardMat;
  const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d');
  g.fillStyle='#1b1c1f';g.fillRect(0,0,64,64);g.fillStyle='#e8b52e';
  for(let k=-2;k<4;k++){g.beginPath();g.moveTo(k*24,64);g.lineTo(k*24+12,64);g.lineTo(k*24+76,0);g.lineTo(k*24+64,0);g.fill();}
  const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.repeat.set(3,1);
  return hazardMat=new T.MeshStandardMaterial({map:tex,roughness:.7,metalness:.2});
}

export function createAPC(THREE,options={}) {
  const T=THREE,{box,cyl,hull,plate,label,group,finish}=workshop(T,options);
  const root=new T.Group();root.name='VECTORCLAD / Bastion armored carrier';
  const body=group(root,'armored hull');
  hull(body,[[-4.65,1.45,.95,1.65],[-3.4,1.83,.65,2.5],[2.9,1.83,.65,2.55],[4.45,1.55,.95,2.25]]);
  box(body,2.7,.45,7.4,0,.75,0,'dark');
  // Heavy central nose rib, divided windscreen and forward bumper.
  box(body,.44,.3,1.9,0,2.12,-3.75,'edge').rotation.x=-.38;
  for(const s of [-1,1]){
    box(body,1.15,.22,.12,s*.82,2.32,-3.55,'dark').rotation.x=-.5;
    box(body,1,.12,.14,s*.82,2.33,-3.61,'glass').rotation.x=-.5;
    box(body,.43,.16,.1,s*1.14,1.39,-4.75,'light');
    box(body,.48,.28,.15,s*1.12,1.37,-4.67,'dark');
    box(body,.09,1.2,2.2,s*1.84,1.7,.25,'edge');
    box(body,.12,1.06,1.8,s*1.9,1.67,.25,'armor');
    box(body,.06,.12,.42,s*1.98,1.96,-.22,'brass');
    box(body,.08,.14,6.1,s*1.94,.62,.25,'metal');
    label(body,'VC-12',1.15,.28,s*1.91,2.18,1.8,s*Math.PI/2);
    // Wheel armor brows leave the tires exposed below.
    for(const z of [-2.95,2.8]){
      plate(body,[[s*1.1,z-1.42],[s*2.08,z-1.1],[s*2.15,z+.95],[s*1.1,z+1.35]],.16,2.07,'edge');
      box(body,.18,.42,.25,s*1.93,1.8,z-1.25,'armor');box(body,.18,.42,.25,s*1.93,1.8,z+1.25,'armor');
    }
  }
  box(body,3.3,.3,.3,0,.98,-4.65,'metal');box(body,3.35,.26,.35,0,.92,4.35,'dark');
  for(const x of [-1.3,1.3])box(body,.26,.18,.08,x,1.3,4.48,'red');
  // Separate wheels with broad block treads and recessed concentric hubs.
  const wheels=[];
  for(const s of [-1,1])for(const z of [-2.95,2.8]){
    const wheel=group(root,'wheel '+s+' '+z,s*1.7,1.04,z);wheels.push(wheel);
    cyl(wheel,1.04,1.04,.7,0,0,0,'rubber','x',24);
    for(let k=0;k<24;k++){const a=k*Math.PI/12;const t=box(wheel,.77,.15,.25,0,Math.cos(a)*1.02,Math.sin(a)*1.02,'rubber');t.rotation.x=a;}
    cyl(wheel,.79,.79,.04,s*.37,0,0,'metal','x',24);cyl(wheel,.64,.64,.07,s*.4,0,0,'armor','x',20);cyl(wheel,.3,.3,.09,s*.45,0,0,'edge','x');
    for(let k=0;k<8;k++){const a=k*Math.PI/4;cyl(wheel,.055,.055,.035,s*.46,Math.cos(a)*.49,Math.sin(a)*.49,'metal','x',6);}
  }
  for(const s of [-1,1]){box(body,.15,.08,5.1,s*.9,2.59,.7,'metal');for(let k=0;k<9;k++)box(body,.065,.06,1.2,s*.9,2.65,1.6+k*.16,'dark');}
  cyl(body,.64,.64,.12,0,2.62,2.5,'edge');box(body,.5,.09,.12,0,2.73,2.5,'metal');
  const turret=group(root,'sliding roof turret',0,2.67,-1.6);
  cyl(turret,.66,.75,.22,0,0,0,'metal');
  hull(turret,[[-1.05,.6,.05,.4],[-.65,1,.02,.72],[.72,.86,.06,.62],[1.05,.5,.12,.4]]);
  // The twin barrels on their own pivot, so they can elevate (userData.setGunPitch)
  const gun=group(turret,'twin gun',0,.36,-.65);
  for(const x of [-.3,.3]){cyl(gun,.09,.13,1.7,x,0,-.85,'metal','z');box(gun,.22,.2,.35,x,0,-1.6,'dark');}
  box(turret,.42,.2,.28,.5,.8,.1,'glass');
  cyl(body,.025,.04,1.4,-1.1,3.2,3.1,'metal', 'y',6);
  label(body,'VECTORCLAD',2.2,.22,0,1.76,4.47);
  const all=[];root.traverse(o=>{if(o.isGroup)all.push(o)});
  root.userData.setTurretAngle=r=>turret.rotation.y=r;
  root.userData.setGunPitch=r=>gun.rotation.x=r;
  root.userData.setTurretStowed=stowed=>turret.position.z=stowed?2.05:-1.6;
  root.userData.roll=distance=>wheels.forEach(w=>w.rotation.x-=distance*(options.metersPerUnit??1)/1.04);
  return finish(root,all);
}


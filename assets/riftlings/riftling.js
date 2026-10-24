// VECTORCLAD Riftling: original procedural swarm creature. Three.js r170.
// +Y up, -Z forward. All anatomy is authored in meters.
export const RIFTLING_COLORS={green:0x62ff15,orange:0xff6508,purple:0xb429ff,blue:0x149aff};
export const RIFTLING_CLIPS={idle:{duration:2.4,loop:true},walking:{duration:1.1,loop:true},running:{duration:.62,loop:true},attacking:{duration:.85,loop:false},leaping:{duration:1.25,loop:false},climbing:{duration:1.05,loop:true},screaming:{duration:1.65,loop:false},stalking:{duration:1.9,loop:true},crawling:{duration:1.3,loop:true},dodging:{duration:.65,loop:false},hit:{duration:.5,loop:false},death:{duration:1.4,loop:false}};
// Thirteenth action is a defensive tail lash, independent of the forearm strike.
RIFTLING_CLIPS.tailwhip={duration:.9,loop:false};

function buildRig(T,low){
 const root=new T.Group(),bones=[],names={},chunks=[];
 function bone(name,parent,x,y,z){let b=new T.Object3D();b.name=name;b.position.set(x,y,z);(parent||root).add(b);b.userData.id=bones.length;b.userData.rest=b.position.clone();names[name]=b;bones.push(b);return b;}
 const body=bone('body',null,0,.76,0),chest=bone('chest',body,0,.17,-.16),head=bone('head',chest,0,.12,-.38),jaw=bone('jaw',head,0,-.12,-.25);
 function piece(b,geo,scale,pos,tone=1,glow=0,rot=[0,0,0]){geo.scale(...scale);geo.rotateX(rot[0]);geo.rotateY(rot[1]);geo.rotateZ(rot[2]);geo.translate(...pos);if(geo.index){const indexed=geo;geo=geo.toNonIndexed();indexed.dispose()}let n=geo.getAttribute('position').count;geo.setAttribute('boneId',new T.Float32BufferAttribute(new Float32Array(n).fill(b.userData.id),1));geo.setAttribute('glow',new T.Float32BufferAttribute(new Float32Array(n).fill(glow),1));let color=new Float32Array(n*3);for(let i=0;i<n;i++)color.set([tone,tone,tone],i*3);geo.setAttribute('color',new T.Float32BufferAttribute(color,3));chunks.push(geo);}
 const orb=(b,s,p,t=1,g=0)=>piece(b,new T.SphereGeometry(1,low?6:10,low?4:6),s,p,t,g);
 function spike(b,a,end,r,t=.8,g=0){let va=new T.Vector3(...a),vb=new T.Vector3(...end),d=vb.clone().sub(va),q=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),d.clone().normalize());let geo=new T.ConeGeometry(r,d.length(),low?4:6);geo.applyQuaternion(q);piece(b,geo,[1,1,1],va.add(vb).multiplyScalar(.5).toArray(),t,g);}
 function rod(b,a,end,r,t=.18){let va=new T.Vector3(...a),vb=new T.Vector3(...end),d=vb.clone().sub(va),q=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),d.clone().normalize());let geo=new T.CylinderGeometry(r*.8,r,d.length(),low?5:7);geo.applyQuaternion(q);piece(b,geo,[1,1,1],va.add(vb).multiplyScalar(.5).toArray(),t);}
 orb(body,[.21,.22,.38],[0,0,.1],.14);orb(chest,[.27,.24,.37],[0,0,-.02],.17);
 // Overlapping shell plates with luminous margins, rib cage and split crest.
 for(let i=0;i<4;i++){orb(body,[.25-i*.025,.1,.17],[0,.18,.02+i*.14],.85,.08);orb(body,[.255-i*.025,.025,.15],[0,.225,.02+i*.14],1,.7);}
 for(const s of [-1,1]){
  for(let i=0;i<5;i++)orb(chest,[.025,.12,.035],[s*(.23-i*.012),-.015,-.22+i*.095],.48,.18);
  orb(chest,[.18,.11,.29],[s*.16,.2,-.05],.9,.12);
  for(let i=0;i<3;i++)spike(chest,[s*.16,.19,.08+i*.13],[s*(.29+i*.025),.49-i*.025,.24+i*.14],.075,.8);
 }
 orb(head,[.18,.17,.37],[0,.015,-.13],.18);
 orb(head,[.13,.065,.16],[0,-.105,-.35],.015);
 for(const s of [-1,1]){
  orb(head,[.12,.15,.36],[s*.095,.09,-.12],.9,.12);
  spike(head,[s*.09,.15,.1],[s*.14,.25,.42],.105,.85);
  spike(head,[s*.14,.08,-.29],[s*.23,.14,-.57],.09,.95,.15);
  for(let i=0;i<3;i++)orb(head,[.028,.022,.035],[s*.17,.015+i*.045,-.36+i*.065],1,2.2);
  for(let i=0;i<4;i++){spike(head,[s*.105,-.09,-.18-i*.065],[s*.08,-.19,-.2-i*.065],.025,.9);spike(jaw,[s*.09,-.015,.05-i*.07],[s*.075,.065,.02-i*.07],.023,.9);}
  spike(jaw,[s*.09,-.015,-.12],[s*.2,-.06,-.33],.045,.85);
 }
 orb(jaw,[.12,.045,.23],[0,-.04,-.06],.3);orb(jaw,[.06,.02,.13],[0,.005,-.06],1,.8);
 const limbs=[];
 for(const s of [-1,1]){
  const hip=bone('hip'+s,body,s*.19,-.08,.24),knee=bone('knee'+s,hip,s*.13,-.29,-.16),ankle=bone('ankle'+s,knee,-s*.02,-.28,.18);
  orb(hip,[.12,.17,.15],[s*.04,-.09,-.02],.8);rod(hip,[0,0,0],[s*.13,-.29,-.16],.07);orb(knee,[.07,.08,.09],[0,0,0],1,.1);rod(knee,[0,0,0],[-s*.02,-.28,.18],.045);rod(ankle,[0,0,0],[0,-.11,-.13],.035);
  for(let k=0;k<3;k++)spike(ankle,[0,-.1,-.08],[(k-1)*.07,-.12,-.31],.026,.8);
  const arm=bone('arm'+s,chest,s*.24,.03,-.15),elbow=bone('elbow'+s,arm,s*.18,-.13,-.18);
  orb(arm,[.11,.12,.13],[0,0,0],.8);rod(arm,[0,0,0],[s*.18,-.13,-.18],.055);orb(elbow,[.08,.09,.09],[0,0,0],.3);
  spike(elbow,[0,0,0],[s*.17,-.23,-.35],.105,.95,.13);spike(elbow,[s*.15,-.2,-.29],[s*.16,-.4,-.49],.065,.8);spike(elbow,[s*.16,-.35,-.44],[s*.02,-.39,-.56],.045,1,.3);
  const support=bone('support'+s,chest,s*.22,-.1,.13),hand=bone('hand'+s,support,s*.17,-.22,-.14);
  rod(support,[0,0,0],[s*.17,-.22,-.14],.038);rod(hand,[0,0,0],[s*.03,-.19,-.11],.025);
  for(let k=0;k<2;k++)spike(hand,[s*.03,-.16,-.09],[s*(.03+k*.06),-.25,-.2],.022,.7);
  limbs.push({s,hip,knee,ankle,arm,elbow,support,hand});
 }
 const tail=[];let parent=body;
 for(let i=0;i<7;i++){let b=bone('tail'+i,parent,0,i===0?-.02:0,i===0?.38:.19);orb(b,[.1-i*.01,.08-i*.007,.125],[0,0,.07],.5,.06);spike(b,[0,.06,.03],[0,.16,.16],.043,1,.3);tail.push(b);parent=b;}
 spike(tail.at(-1),[0,0,.08],[0,.12,.4],.065,.85,.15);
 const geometry=new T.BufferGeometry();for(const key of ['position','normal','uv','color','boneId','glow']){const size=chunks[0].getAttribute(key).itemSize;let a=new Float32Array(chunks.reduce((n,g)=>n+g.getAttribute(key).array.length,0)),off=0;for(const c of chunks){a.set(c.getAttribute(key).array,off);off+=c.getAttribute(key).array.length}geometry.setAttribute(key,new T.BufferAttribute(a,size));}chunks.forEach(g=>g.dispose());
 function pose(name,u){
  for(const b of bones){b.position.copy(b.userData.rest);b.rotation.set(0,0,0)}
  const phase=u*Math.PI*2,pulse=Math.sin(phase),bell=Math.sin(Math.PI*u),strike=Math.sin(Math.PI*Math.min(1,u*1.5));
  body.position.y+=.016*pulse;chest.rotation.x=.08;head.rotation.y=.08*Math.sin(phase*.5);jaw.rotation.x=-.06;
  let stride=0,amount=0;
  if(['walking','running','stalking','crawling','climbing'].includes(name)){stride=phase;amount=name==='running'?1:name==='stalking'?.27:.55;body.position.y+=Math.abs(Math.sin(phase*2))*(name==='running'?.1:.035);chest.rotation.x=name==='running'?.25:.12;}
  for(const l of limbs){let a=Math.sin(stride+(l.s<0?0:Math.PI))*amount;l.hip.rotation.x=-.2+a;l.hip.rotation.z=l.s*.14;l.knee.rotation.x=.25-Math.max(0,a)*.8;l.ankle.rotation.x=-.05+Math.max(0,-a)*.4;l.arm.rotation.x=-.32-a*.55;l.arm.rotation.z=-l.s*.2;l.elbow.rotation.x=-.22;l.support.rotation.x=-a*.85;l.hand.rotation.x=.25+Math.max(0,a)*.4;}
  if(name==='idle'){head.rotation.x=.04*pulse;limbs.forEach(l=>l.elbow.rotation.z=l.s*.08*pulse);}
  if(name==='stalking'||name==='crawling'){body.position.y-=name==='crawling'?.28:.13;chest.rotation.x=.23;head.rotation.x=-.2;limbs.forEach(l=>{l.hip.rotation.z+=l.s*.2;l.support.rotation.z=-l.s*.28;});}
  if(name==='attacking'){chest.rotation.x=-.3*bell+.65*strike;body.position.z=-.18*strike;head.rotation.x=-.15;limbs.forEach(l=>{l.arm.rotation.x=-1.35*bell+.75*strike;l.arm.rotation.z=l.s*(.65*bell-.75*strike);l.elbow.rotation.x=-.7*bell;});jaw.rotation.x=-.5*bell;}
  if(name==='leaping'){body.position.y+=1.25*bell-.18*Math.sin(Math.PI*Math.min(1,u*3));body.position.z=-.4*bell;chest.rotation.x=.35*bell;limbs.forEach(l=>{l.hip.rotation.x=-1.1*bell;l.knee.rotation.x=1.25*bell;l.arm.rotation.x=-1.25*bell;l.support.rotation.x=-.8*bell});}
  if(name==='climbing'){body.rotation.x=-Math.PI/2;body.position.set(0,.7+.08*pulse,-.22);head.rotation.x=-.3;limbs.forEach(l=>{l.arm.rotation.x=-.8+Math.sin(phase+l.s)*.7;l.support.rotation.x=.3-Math.sin(phase+l.s)*.6;});}
  if(name==='screaming'){chest.rotation.x=.22*bell;head.rotation.x=.65*bell;head.rotation.z=.035*Math.sin(phase*8)*bell;jaw.rotation.x=-1.15*bell;body.position.y+=.1*bell;limbs.forEach(l=>l.arm.rotation.z=l.s*.7*bell);}
  if(name==='dodging'){body.position.x=.85*bell;body.position.y-=.22*bell;body.rotation.z=-.45*bell;limbs.forEach(l=>l.hip.rotation.z+=l.s*.5*bell);}
  if(name==='hit'){body.rotation.x=-.35*bell;head.rotation.x=.5*bell;body.position.z=.15*bell;limbs.forEach(l=>l.arm.rotation.z=l.s*.4*bell);}
  if(name==='death'){let fall=Math.min(1,u*1.7);fall=fall*fall*(3-2*fall);body.position.y-=.58*fall;body.rotation.z=1.35*fall;body.rotation.y=-.3*fall;head.rotation.x=.5*fall;jaw.rotation.x=-.65*fall;limbs.forEach(l=>{l.hip.rotation.x=-.8*fall;l.knee.rotation.x=1.1*fall;l.arm.rotation.x=-.8*fall;l.support.rotation.z=l.s*.5*fall});}
  if(name==='tailwhip'){body.rotation.y=-.45*bell;chest.rotation.y=.6*bell;limbs.forEach(l=>l.arm.rotation.z=l.s*.5*bell);}
  tail.forEach((b,i)=>{b.rotation.y=.12*Math.sin(phase-i*.65);b.rotation.x=-.07;if(name==='tailwhip')b.rotation.y+=.65*Math.sin(phase-i*.38)*bell;if(name==='death')b.rotation.y=.25*Math.min(1,u*2);});
  root.updateMatrixWorld(true);
 }
 return {root,bones,geometry,pose};
}

export function createRiftlingSwarm(T,options={}){
 const capacity=options.capacity??512,meters=options.metersPerUnit??1;
 if(!Number.isInteger(capacity)||capacity<1||!(meters>0))throw Error('Invalid swarm capacity or metersPerUnit');
 const rig=buildRig(T,options.lod==='low'),nb=rig.bones.length,fps=24,clips={},frames=[];
 for(const [name,clip] of Object.entries(RIFTLING_CLIPS)){let count=Math.ceil(clip.duration*fps)+1,start=frames.length;clips[name]={...clip,start,count};for(let i=0;i<count;i++){rig.pose(name,i/(count-1));let row=[];for(const b of rig.bones){let p=new T.Vector3(),q=new T.Quaternion(),s=new T.Vector3();b.matrixWorld.decompose(p,q,s);row.push(...q.toArray(),...p.toArray(),1);}frames.push(row);}}
 const tex=new T.DataTexture(new Float32Array(frames.flat()),nb*2,frames.length,T.RGBAFormat,T.FloatType);tex.minFilter=tex.magFilter=T.NearestFilter;tex.needsUpdate=true;
 const geometry=rig.geometry;
 const states=new Float32Array(capacity*4),clock=new Float32Array(capacity*2);
 geometry.setAttribute('anim',new T.InstancedBufferAttribute(states,4));geometry.setAttribute('animClock',new T.InstancedBufferAttribute(clock,2));
 let time=0,shader=null;
 const material=new T.MeshStandardMaterial({color:0xffffff,vertexColors:true,metalness:.3,roughness:.39});
 material.onBeforeCompile=s=>{
  shader=s;s.uniforms.riftTime={value:time};s.uniforms.riftPose={value:tex};
  s.vertexShader=s.vertexShader.replace('#include <common>',`#include <common>
attribute float boneId; attribute float glow; attribute vec4 anim; attribute vec2 animClock;
uniform float riftTime; uniform sampler2D riftPose;
varying float riftGlow; varying vec3 riftTint;
vec3 rq(vec4 q,vec3 v){return v+2.0*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
void rpose(out vec4 q,out vec3 p){
float elapsed=max(0.0,riftTime-animClock.x)*animClock.y;
float u=anim.w>0.5?fract(elapsed/anim.z):clamp(elapsed/anim.z,0.0,1.0);
float frame=u*(anim.y-1.0),f=floor(frame),blend=fract(frame);
vec2 uv=vec2((boneId*2.0+.5)/${nb*2}.0,(anim.x+f+.5)/${frames.length}.0);
vec4 a=texture2D(riftPose,uv),b=texture2D(riftPose,uv+vec2(0.,1.0/${frames.length}.0));
if(dot(a,b)<0.0)b=-b;q=normalize(mix(a,b,blend));
vec2 du=vec2(1.0/${nb*2}.0,0.);p=mix(texture2D(riftPose,uv+du).xyz,texture2D(riftPose,uv+du+vec2(0.,1.0/${frames.length}.0)).xyz,blend);
}`);
  s.vertexShader=s.vertexShader.replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\nvec4 riftQ; vec3 riftP; rpose(riftQ,riftP); objectNormal=rq(riftQ,objectNormal);');
  s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed=rq(riftQ,transformed)+riftP; riftGlow=glow; riftTint=instanceColor;');
  s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying float riftGlow; varying vec3 riftTint;');
  s.fragmentShader=s.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=riftTint*riftGlow*.85;');
 };
 material.customProgramCacheKey=()=>`riftling-${nb}-${frames.length}`;
 const mesh=new T.InstancedMesh(geometry,material,capacity);mesh.name='VECTORCLAD Riftling swarm';mesh.frustumCulled=false;mesh.count=0;
 // Shadow casting deliberately disabled: an unmodified shadow shader cannot sample these GPU poses.
 mesh.castShadow=false;mesh.receiveShadow=true;
 const dummy=new T.Object3D(),color=new T.Color(),actors=new Array(capacity);
 function check(i){if(!Number.isInteger(i)||i<0||i>=capacity)throw Error('Actor slot out of range');}
 function setTransform(i,{position=[0,0,0],quaternion=[0,0,0,1],scale=1}={}){check(i);dummy.position.fromArray(position);dummy.quaternion.fromArray(quaternion);dummy.scale.setScalar(scale/meters);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);mesh.instanceMatrix.needsUpdate=true;}
 function setColor(i,value='green'){check(i);color.set(RIFTLING_COLORS[value]??value);mesh.setColorAt(i,color);mesh.instanceColor.needsUpdate=true;}
 function play(i,name='idle',{speed=1,phase=0}={}){check(i);let c=clips[name];if(!c)throw Error('Unknown animation '+name);if(!(speed>0))throw Error('Animation speed must be positive');states.set([c.start,c.count,c.duration,c.loop?1:0],i*4);clock.set([time-phase*c.duration/speed,speed],i*2);geometry.attributes.anim.needsUpdate=true;geometry.attributes.animClock.needsUpdate=true;actors[i]={name,start:clock[i*2],speed};}
 for(let i=0;i<capacity;i++){setTransform(i);setColor(i,Object.keys(RIFTLING_COLORS)[i%4]);play(i,'idle',{phase:(i*.618)%1});}
 function update(seconds){if(!Number.isFinite(seconds))throw Error('Time must be finite');time=seconds;if(shader)shader.uniforms.riftTime.value=time;}
 function setCount(n){if(!Number.isInteger(n)||n<0||n>capacity)throw Error('Count out of range');mesh.count=n;}
 function isFinished(i){check(i);let a=actors[i],c=clips[a.name];return !c.loop&&(time-a.start)*a.speed>=c.duration;}
 function samplePose(name,seconds){const c=clips[name];if(!c)throw Error('Unknown animation');const u=c.loop?((seconds/c.duration)%1+1)%1:Math.max(0,Math.min(1,seconds/c.duration));rig.pose(name,u);return rig.bones.map(b=>({name:b.name,matrix:b.matrixWorld.clone()}));}
 return {mesh,clips,capacity,boneCount:nb,triangles:geometry.attributes.position.count/3,
   setTransform,setColor,play,setCount,update,isFinished,samplePose,
   dispose(){mesh.removeFromParent();geometry.dispose();material.dispose();tex.dispose();},
   metadata:{name:'Riftling',metersPerUnit:meters,nominalStandingHeightMeters:1.35,forward:'-Z',up:'+Y',animationFPS:fps,animationFrames:frames.length,poseTextureBytes:tex.image.data.byteLength}};
}

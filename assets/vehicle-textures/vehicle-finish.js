// Shared textures also work when the game's Fleet copies these materials to InstancedMesh.
const caches=new WeakMap();
function textures(T){
 if(caches.has(T))return caches.get(T);
 const loader=new T.TextureLoader(),base=new URL('./',import.meta.url),out={};
 for(const kind of ['dropship','apc']){
  const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');ctx.fillStyle='rgb(0,165,50)';ctx.fillRect(0,0,1,1);
  const orm=new T.CanvasTexture(c);orm.wrapS=orm.wrapT=T.RepeatWrapping;
  const map=loader.load(new URL(kind+'-armor.png',base).href,tex=>{
   c.width=tex.image.width;c.height=tex.image.height;ctx.drawImage(tex.image,0,0);
   const data=ctx.getImageData(0,0,c.width,c.height),p=data.data;
   for(let i=0;i<p.length;i+=4){const gold=p[i]>p[i+1]*1.08&&p[i+1]>p[i+2]*1.18&&p[i]>65;p[i]=0;p[i+1]=gold?58:170;p[i+2]=gold?245:50;}
   ctx.putImageData(data,0,0);orm.needsUpdate=true;
  });
  map.colorSpace=T.SRGBColorSpace;map.wrapS=map.wrapT=T.RepeatWrapping;map.anisotropy=8;map.userData.sharedVehicleTexture=true;out[kind]={map,orm};
 }
 out.rotor=loader.load(new URL('wing-rotor.png',base).href);out.rotor.colorSpace=T.SRGBColorSpace;out.rotor.userData.sharedVehicleTexture=true;
 caches.set(T,out);return out;
}
export function finishVehicle(T,root,kind){
 const {map,orm}=textures(T)[kind],seen=new Set();
 root.traverse(o=>{
  if(!o.isMesh||!/^vehicle:(armor|edge|brass|metal|white)$/.test(o.material.name))return;
  const m=o.material;
  if(!seen.has(m)){
   seen.add(m);
   if(/:brass$/.test(m.name)){m.color.setHex(0xd6a547);m.metalness=.92;m.roughness=.24;}
   else{m.color.setHex(0xffffff);m.map=map;m.roughnessMap=orm;m.metalnessMap=orm;m.roughness=m.metalness=1;}
  }
  const g=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone(),p=g.attributes.position,n=g.attributes.normal,uv=[];
  g.computeBoundingBox();const bounds=g.boundingBox,size=bounds.getSize(new T.Vector3());
  const span=Math.max(size.x,size.y,size.z),wing=/outrigger|tail fin/.test(o.parent.name)||(size.x>4&&size.y<.5);
  const norm=(value,axis)=>(value-bounds.min[axis])/Math.max(size[axis],.0001);
  for(let i=0;i<p.count;i+=3){const x=Math.abs(n.getX(i)),y=Math.abs(n.getY(i)),z=Math.abs(n.getZ(i));
   const top=y>=x&&y>=z,side=!top&&x>=z,mechanical=span<2||/:(metal|edge)$/.test(m.name);
   // Atlas: side upper-left, deck upper-right, wing/nose lower-left, machinery lower-right.
   const cell=mechanical?[1,0]:wing?[0,0]:top?[1,1]:side?[0,1]:[0,0];
   for(let j=i;j<i+3;j++){
    let a=top?norm(p.getX(j),'x'):side?norm(p.getZ(j),'z'):norm(p.getX(j),'x');
    let b=top?norm(p.getZ(j),'z'):norm(p.getY(j),'y');
    // Long hulls use a quiet strip; existing separate decals carry undistorted IDs.
    if(side&&!mechanical&&!wing)b=.18+(b-.5)*Math.min(.3,size.y/Math.max(size.z,.001));
    if(side&&n.getX(i)<0)a=1-a;
    uv.push((cell[0]+.025+a*.95)*.5,(cell[1]+.025+b*.95)*.5);
   }}
  g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));o.geometry.dispose();o.geometry=g;
 });
}
export function addWingRotor(T,parent,sign){
 const mat=new T.MeshStandardMaterial({map:textures(T).rotor,transparent:true,alphaTest:.2,side:T.DoubleSide,metalness:.65,roughness:.34});
 const time={value:0};mat.userData.rotorTime=time;
 mat.onBeforeCompile=shader=>{shader.uniforms.rotorTime=time;shader.vertexShader='uniform float rotorTime;\n'+shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
 float a=rotorTime*${sign<0?'-':'+'}24.0;
 transformed.xy=mat2(cos(a),sin(a),-sin(a),cos(a))*transformed.xy;`);};
 mat.customProgramCacheKey=()=>`wing-rotor-${sign}`;
 mat.onBeforeRender=()=>{time.value=performance.now()*.001;};
 const rotor=new T.Mesh(new T.PlaneGeometry(2.28,2.28),mat);rotor.rotation.x=-Math.PI/2;rotor.position.y=.19;rotor.name='spinning wing rotor';parent.add(rotor);
 rotor.userData.rotor=true;return rotor;
}

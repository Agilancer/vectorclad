import {mapSkin} from './skins.js';
export function kit(T,skin){
 const mesh=(p,g,key='armor',x=0,y=0,z=0)=>{const special=['visor','glow','black'].includes(key),geo=special?g:mapSkin(T,g,key);const o=new T.Mesh(geo,special?skin[key]:skin.material);o.position.set(x,y,z);o.castShadow=o.receiveShadow=true;p.add(o);return o;};
 const group=(p,name,x=0,y=0,z=0)=>{const g=new T.Group();g.name=name;g.position.set(x,y,z);p.add(g);return g;};
 const box=(p,w,h,d,x=0,y=0,z=0,key='armor')=>{const shape=new T.Shape(),c=Math.min(w,h)*.12;for(const [i,v] of [[-w/2+c,-h/2],[w/2-c,-h/2],[w/2,-h/2+c],[w/2,h/2-c],[w/2-c,h/2],[-w/2+c,h/2],[-w/2,h/2-c],[-w/2,-h/2+c]].entries())i?shape.lineTo(...v):shape.moveTo(...v);shape.closePath();const g=new T.ExtrudeGeometry(shape,{depth:d,bevelEnabled:false,steps:1});g.translate(0,0,-d/2);return mesh(p,g,key,x,y,z);};
 const cyl=(p,r,h,x=0,y=0,z=0,key='frame',axis='y',segments=16)=>{const o=mesh(p,new T.CylinderGeometry(r,r,h,segments),key,x,y,z);if(axis==='x')o.rotation.z=Math.PI/2;if(axis==='z')o.rotation.x=Math.PI/2;return o;};
 const sphere=(p,r,x,y,z,key='black')=>mesh(p,new T.SphereGeometry(r,12,8),key,x,y,z);
 const panel=(p,points,d,x=0,y=0,z=0,key='armor')=>{const s=new T.Shape();points.forEach(([a,b],i)=>i?s.lineTo(a,b):s.moveTo(a,b));s.closePath();const g=new T.ExtrudeGeometry(s,{depth:d,bevelEnabled:false});g.translate(0,0,-d/2);return mesh(p,g,key,x,y,z);};
 const ring=(p,r,t,x,y,z,key='gold',axis='z')=>{const o=mesh(p,new T.TorusGeometry(r,t,6,24),key,x,y,z);if(axis==='y')o.rotation.x=Math.PI/2;if(axis==='x')o.rotation.y=Math.PI/2;return o;};
 const rod=(p,a,b,r,key='frame')=>{const av=new T.Vector3(...a),bv=new T.Vector3(...b),o=cyl(p,r,av.distanceTo(bv),0,0,0,key);o.position.copy(av.add(bv).multiplyScalar(.5));o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),new T.Vector3(...b).sub(new T.Vector3(...a)).normalize());return o;};
 const mark=(p,text,w,h,x,y,z)=>{const c=document.createElement('canvas');c.width=512;c.height=128;const ctx=c.getContext('2d');ctx.fillStyle=skin.palette.ink;ctx.font='bold 68px monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,256,66);const map=new T.CanvasTexture(c);map.colorSpace=T.SRGBColorSpace;const mat=new T.MeshStandardMaterial({map,transparent:true,alphaTest:.1,roughness:.8,polygonOffset:true,polygonOffsetFactor:-2});const o=new T.Mesh(new T.PlaneGeometry(w,h),mat);o.position.set(x,y,z);p.add(o);return o;};
 return {mesh,group,box,cyl,sphere,panel,ring,rod,mark};
}

// Merge only direct rigid surfaces; animation groups, attachment nodes and transparent decals remain.
export function batchRigid(T,root){
 const groups=[];root.traverse(o=>{if(o.isGroup)groups.push(o);});
 for(const p of groups){const bank=new Map();for(const o of [...p.children]){if(!o.isMesh||o.material.transparent)continue;o.updateMatrix();const g=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();g.applyMatrix4(o.matrix);const list=bank.get(o.material)||[];list.push(g);bank.set(o.material,list);o.geometry.dispose();o.removeFromParent();}
  for(const [mat,list] of bank){const geo=new T.BufferGeometry();for(const key of ['position','normal','uv']){if(!list.every(g=>g.attributes[key]))continue;const len=list.reduce((v,g)=>v+g.attributes[key].array.length,0),a=new Float32Array(len);let offset=0;for(const g of list){a.set(g.attributes[key].array,offset);offset+=g.attributes[key].array.length;}geo.setAttribute(key,new T.BufferAttribute(a,list[0].attributes[key].itemSize));}list.forEach(g=>g.dispose());const m=new T.Mesh(geo,mat);m.castShadow=m.receiveShadow=true;p.add(m);}
 }
}

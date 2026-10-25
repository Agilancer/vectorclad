export const SKINS={
  vanguard:{name:'Vanguard / charcoal + gold',armor:'#343940',cloth:'#202a2e',frame:'#42484d',gold:'#be9347',ink:'#e7dfc4',light:0x64edff},
  urban:{name:'Urban / ivory + cobalt',armor:'#bcc3c5',cloth:'#263443',frame:'#48525c',gold:'#486c9c',ink:'#253747',light:0x72cfff},
  woodland:{name:'Woodland / olive + brass',armor:'#515b46',cloth:'#303b30',frame:'#414641',gold:'#b59b5e',ink:'#e2dbba',light:0xb7f178},
  desert:{name:'Desert / sand + copper',armor:'#a38c68',cloth:'#49453b',frame:'#474949',gold:'#ac7346',ink:'#292d2e',light:0xffbc65}
};
const cache=new WeakMap();
export function createSkin(T,id='vanguard'){
 let bank=cache.get(T);if(!bank){bank=new Map();cache.set(T,bank);}if(bank.has(id))return bank.get(id);
 const p=SKINS[id];if(!p)throw Error('Unknown skin '+id);
 const size=2048,half=size/2;
 const canvases=['color','roughness','metalness'].map(()=>{let c=document.createElement('canvas');c.width=c.height=size;return c;});
 const [c,r,m]=canvases.map(x=>x.getContext('2d'));
 let seed=1729;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const keys=['armor','cloth','frame','gold'];
 keys.forEach((key,i)=>{const x=(i%2)*half,y=Math.floor(i/2)*half;
  c.fillStyle=p[key];c.fillRect(x,y,half,half);
  r.fillStyle=['#a6a6a6','#e0e0e0','#858585','#565656'][i];r.fillRect(x,y,half,half);
  m.fillStyle=['#333333','#000000','#d4d4d4','#eeeeee'][i];m.fillRect(x,y,half,half);
  c.save();c.beginPath();c.rect(x+8,y+8,half-16,half-16);c.clip();
  if(key==='armor'&&id==='woodland'){
   for(const [a,b,w,h] of [[80,110,280,170],[530,60,240,310],[280,490,310,180],[650,730,320,220]]){c.fillStyle='#343e32';c.beginPath();c.moveTo(x+a,y+b);c.lineTo(x+a+w,y+b-40);c.lineTo(x+a+w+55,y+b+h*.65);c.lineTo(x+a+w*.25,y+b+h);c.closePath();c.fill();}
  }
  if(key==='armor'&&id==='desert'){c.strokeStyle='#c2ad89';c.lineWidth=70;c.beginPath();c.moveTo(x+180,y);c.lineTo(x+760,y+half);c.stroke();}
  if(key==='cloth'){
   c.strokeStyle='#ffffff0a';c.lineWidth=2;for(let a=0;a<half;a+=9){c.beginPath();c.moveTo(x+a,y);c.lineTo(x+a,y+half);c.stroke();c.beginPath();c.moveTo(x,y+a);c.lineTo(x+half,y+a);c.stroke();}
   c.strokeStyle='#00000020';for(let a=40;a<half;a+=180){c.beginPath();c.moveTo(x+a,y);c.bezierCurveTo(x+a+20,y+300,x+a-30,y+700,x+a,y+half);c.stroke();}
  }else{
   c.strokeStyle='#10161aaa';c.lineWidth=5;c.strokeRect(x+32,y+32,half-64,half-64);
   c.strokeStyle=p.ink+'45';c.lineWidth=2;c.strokeRect(x+39,y+39,half-78,half-78);
   for(const [bx,by] of [[58,58],[half-58,58],[58,half-58],[half-58,half-58]]){c.fillStyle='#12191d';c.beginPath();c.arc(x+bx,y+by,8,0,Math.PI*2);c.fill();c.strokeStyle='#b0ac9970';c.beginPath();c.moveTo(x+bx-4,y+by);c.lineTo(x+bx+4,y+by);c.stroke();}
   if(key==='armor'){c.strokeStyle=p.gold;c.lineWidth=13;c.beginPath();c.moveTo(x+100,y+half-140);c.lineTo(x+half-160,y+half-140);c.lineTo(x+half-100,y+half-200);c.stroke();c.fillStyle=p.ink+'90';c.font='24px monospace';c.fillText('VC / CERAMIC 04',x+110,y+half-94);}
   if(key==='frame'){c.strokeStyle='#151d23';c.lineWidth=12;for(let j=0;j<9;j++){c.beginPath();c.moveTo(x+120,y+180+j*70);c.lineTo(x+half-120,y+180+j*70);c.stroke();}}
   c.strokeStyle=key==='gold'?'#f3deb84a':'#c7c9c330';c.lineWidth=1.3;
   for(let k=0;k<330;k++){const a=x+40+random()*(half-80),b=y+40+random()*(half-80);c.beginPath();c.moveTo(a,b);c.lineTo(a+3+random()*14,b-random()*4);c.stroke();}
  }
  c.restore();
 });
 const textures=canvases.map((canvas,i)=>{let t=new T.CanvasTexture(canvas);if(i===0)t.colorSpace=T.SRGBColorSpace;t.anisotropy=8;return t;});
 const material=new T.MeshStandardMaterial({map:textures[0],roughnessMap:textures[1],metalnessMap:textures[2],roughness:1,metalness:1});
 const visor=new T.MeshStandardMaterial({color:0x142a37,metalness:.65,roughness:.18,emissive:p.light,emissiveIntensity:.22});
 const glow=new T.MeshStandardMaterial({color:p.light,emissive:p.light,emissiveIntensity:1.3,roughness:.3});
 const black=new T.MeshStandardMaterial({color:0x131b20,roughness:.86});
 const skin={id,palette:p,canvases,material,visor,glow,black,textures};bank.set(id,skin);return skin;
}

export function mapSkin(T,geometry,region='armor'){
 const g=geometry.index?geometry.toNonIndexed():geometry.clone();g.computeVertexNormals();g.computeBoundingBox();
 const bounds=g.boundingBox,s=bounds.getSize(new T.Vector3()),p=g.attributes.position,n=g.attributes.normal,uv=[];
 const cell={armor:[0,1],cloth:[1,1],frame:[0,0],gold:[1,0]}[region];
 const norm=(v,k)=>(v-bounds.min[k])/Math.max(s[k],.00001);
 for(let i=0;i<p.count;i+=3){const a=Math.abs(n.getX(i)),b=Math.abs(n.getY(i)),c=Math.abs(n.getZ(i));
  for(let j=i;j<i+3;j++){let u,v;if(b>=a&&b>=c){u=norm(p.getX(j),'x');v=norm(p.getZ(j),'z');}else if(a>=c){u=norm(p.getZ(j),'z');v=norm(p.getY(j),'y');}else{u=norm(p.getX(j),'x');v=norm(p.getY(j),'y');}
   uv.push((cell[0]+.035+.93*u)/2,(cell[1]+.035+.93*v)/2);}}
 g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));return g;
}

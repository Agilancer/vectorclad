import { citadelKit } from './citadel-kit.js';

// +Z muzzle direction; grip at origin, matching VECTORCLAD hand weapons.
export function buildSpearlineRifle(){
 const K=citadelKit(),{box,cyl,ring,rod,label,muzzle}=K,g=new K.THREE.Group();g.name='SR-19 Spearline coil rifle';
 box(g,.47,.5,1.25,0,.24,.35,'navy');box(g,.3,.32,.64,0,.27,-.58,'armor');box(g,.17,.4,.23,0,-.13,0,'frame');box(g,.28,.4,.35,0,-.18,.57,'copper');
 const rail=K.group(g,'recoil carriage');
 for(const s of [-1,1]){box(rail,.12,.28,2.0,s*.2,.28,1.87,'armor');box(rail,.06,.075,1.8,s*.13,.28,1.87,'light');for(let i=0;i<4;i++)box(rail,.19,.42,.09,s*.23,.28,1.08+i*.47,'copper');}
 box(rail,.57,.39,.22,0,.28,2.92,'navy');box(rail,.24,.16,.03,0,.28,3.045,'dark');box(rail,.065,.085,.04,0,.28,3.07,'light');
 box(g,.27,.2,.5,0,.59,.19,'armor');cyl(g,.06,.04,0,.6,.47,'light','z',12);rod(g,[-.2,.07,.77],[.2,.07,.77],.025,'metal');
 label(g,'SR-19',.246,.29,.32,.49,Math.PI/2);
 const muzzles=[muzzle(rail,0,.28,3.09)];return {group:g,muzzles,recoil:rail,animate(t,{recoil=0}={}){rail.position.z=-Math.max(0,recoil)*.15},dispose:()=>K.dispose(g)};
}

export function buildBreakerCannon(){
 const K=citadelKit(),{box,cyl,ring,label,muzzle}=K,g=new K.THREE.Group();g.name='BC-6 Breaker scatter cannon';
 box(g,.64,.58,1.04,0,.25,.34,'navy');box(g,.17,.4,.23,0,-.13,0,'frame');box(g,.41,.31,.48,0,.25,-.42,'armor');
 const receiver=K.group(g,'six-port breech');box(receiver,.84,.63,1.03,0,.3,1.3,'armor');box(receiver,.76,.54,.13,0,.3,1.87,'navy');
 const muzzles=[];for(let row=0;row<2;row++)for(let col=0;col<3;col++){let x=(col-1)*.22,y=.3+(row-.5)*.23;cyl(receiver,.088,.17,x,y,1.97,'metal','z',10);cyl(receiver,.058,.024,x,y,2.067,'dark','z',10);muzzles.push(muzzle(receiver,x,y,2.09));}
 cyl(g,.25,.65,0,-.17,.81,'copper','x',16);ring(g,.21,.025,.34,-.17,.81,'metal','x');box(g,.57,.09,.64,0,.65,.58,'copper');label(g,'BC-6',.335,.34,.31,.44,Math.PI/2);
 return {group:g,muzzles,recoil:receiver,animate(t,{recoil=0}={}){receiver.position.z=-Math.max(0,recoil)*.11},dispose:()=>K.dispose(g)};
}

export function buildAegisShield(){
 const K=citadelKit(),{box,panel,label}=K,g=new K.THREE.Group();g.name='AG-3 folding buckler';
 panel(g,[[-.63,.91],[.63,.91],[.87,.52],[.78,-.74],[.35,-1.08],[-.35,-1.08],[-.78,-.74],[-.87,.52]],.22,0,0,.04,'navy');
 panel(g,[[-.39,.69],[.39,.69],[.48,.4],[.42,-.56],[.17,-.78],[-.17,-.78],[-.42,-.56],[-.48,.4]],.15,0,0,.23,'armor');
 box(g,.1,1.17,.08,0,.02,.35,'copper');
 const wings=[];for(const s of [-1,1]){let w=K.group(g,'folding leaf '+s);w.position.x=s*.63;panel(w,[[0,.73],[s*.43,.5],[s*.47,-.42],[s*.1,-.81],[0,-.69]],.12,0,0,0,'armor');wings.push(w)}
 label(g,'AG-3',0,.48,.33,.5);box(g,.27,.55,.24,0,0,-.16,'frame');
 return {group:g,muzzles:[],setFolded(v){wings.forEach((w,i)=>w.rotation.y=(i?1:-1)*(v?1.05:0))},dispose:()=>K.dispose(g)};
}

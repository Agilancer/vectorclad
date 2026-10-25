// Optional controller and instancing adapter. Combat callbacks belong to the game.
export class UnitFleet{
 constructor(T,scene,template,capacity=64){this.T=T;this.parts=[];this.capacity=capacity;
  template.root.traverse(o=>{if(!o.isMesh)return;const mesh=new T.InstancedMesh(o.geometry,o.material,capacity);mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);mesh.count=0;mesh.castShadow=o.castShadow;mesh.receiveShadow=true;mesh.frustumCulled=false;scene.add(mesh);this.parts.push(mesh);});
 }
 write(index,actor){if(index>=this.capacity)throw Error('UnitFleet capacity exceeded');actor.root.updateMatrixWorld(true);let j=0;
  actor.root.traverse(o=>{if(!o.isMesh)return;const part=this.parts[j++];if(!part)throw Error('Fleet requires identical type, skin and weapon');let visible=true;for(let p=o;p;p=p.parent)if(!p.visible){visible=false;break;}part.setMatrixAt(index,visible?o.matrixWorld:new this.T.Matrix4().makeScale(0,0,0));});
  if(j!==this.parts.length)throw Error('Fleet topology mismatch');
 }
 commit(count){if(!Number.isInteger(count)||count<0||count>this.capacity)throw Error('Invalid fleet count');for(const p of this.parts){p.count=count;p.instanceMatrix.needsUpdate=true;}}
 dispose(){for(const p of this.parts){p.removeFromParent();p.dispose();}this.parts.length=0;}
}

export class AlliedSquad{
 constructor(T,{units=[],onShot=()=>{},groundHeight=()=>0,resolvePosition}={}){this.T=T;this.units=units;this.onShot=onShot;this.groundHeight=groundHeight;this.resolvePosition=resolvePosition;this.time=0;}
 update(dt,{leader,targets=[]}={}){
  dt=Math.max(0,Math.min(.1,dt));this.time+=dt;const T=this.T;
  for(let i=0;i<this.units.length;i++){
   const actor=this.units[i],pos=actor.root.position,scale=actor.unitsPerMeter;let target=null,best=Infinity;
   for(const q of targets){if(q.alive===false)continue;const p=q.position||q.pos;if(!p)continue;const d=pos.distanceToSquared(p);if(d<best&&d<(actor.weapon.definition.range*scale)**2){best=d;target=q;}}
   let goal,action='idle',fire=false,aimYaw=0,aimPitch=0,speed=0;
   if(target){goal=(target.position||target.pos).clone();const delta=goal.clone().sub(pos),yaw=Math.atan2(delta.x,delta.z),err=Math.atan2(Math.sin(yaw-actor.root.rotation.y),Math.cos(yaw-actor.root.rotation.y));
    actor.root.rotation.y+=Math.max(-dt*3,Math.min(dt*3,err));aimYaw=Math.atan2(Math.sin(yaw-actor.root.rotation.y),Math.cos(yaw-actor.root.rotation.y));
    aimPitch=Math.atan2(delta.y-actor.heightMeters*.65*scale,Math.hypot(delta.x,delta.z));action='aim';fire=Math.abs(aimYaw)<.3;
   }else if(leader){goal=leader.clone().add(new T.Vector3(((i%4)-1.5)*2.1*scale,0,-(2+Math.floor(i/4)*2.3)*scale));}
   if(goal&&!target){const delta=goal.clone().sub(pos);delta.y=0;const dist=delta.length();if(dist>.4*scale){speed=dist>6*scale?4.8:1.5;const move=Math.min(dist,speed*scale*dt);pos.addScaledVector(delta.normalize(),move);actor.root.rotation.y=Math.atan2(delta.x,delta.z);action=speed>3?'run':'walk';}}
   if(this.resolvePosition)this.resolvePosition(pos,actor);
   const events=actor.update(dt,{action,fire,aim:!!target,aimYaw,aimPitch,speed,groundY:this.groundHeight(pos.x,pos.z)});
   for(const event of events){if(event.type!=='fire')continue;const {origin,direction}=actor.muzzle();this.onShot({actor,target,weapon:actor.weapon.id,origin,direction,definition:actor.weapon.definition});}
  }
 }
}

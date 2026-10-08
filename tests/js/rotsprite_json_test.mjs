import { test,eq,near,truthy,finish } from './_harness.mjs';
import { validateRotDefinition,validateRotAnimations,sampleRotClip,buildRotModelPose,installRotSprite,tickRotSprite } from '../../src/highlevel/rotsprite.js';
import { createApi } from '../../src/highlevel/api.js';
const base=()=>({version:1,atlas:'prop.png',style:'pixel',rig:{bones:[{name:'root',pivot:[0,0,0]},{name:'child',parent:'root',pivot:[10,0,0]}],parts:[{id:80,bone:'child'}],joints:[{name:'tip',bone:'child',point:[10,0,0]}]},groups:{shell:[80]},animations:{version:1,clips:{spin:{duration:2,loop:true,tracks:[{target:'root',channel:'rotation.z',keys:[[0,0],[2,180]]}]},blink:{duration:1,loop:false,tracks:[{target:'face',channel:'eyes',keys:[[0,'open'],[.5,'closed'],[1,'open']]}]}},defaults:{body:true,motion:'spin'}}});
const throws=f=>{let bad=false;try{f();}catch(e){bad=true;}truthy(bad);};
test('JSON validation rejects cycles, invalid part IDs, duplicate tracks and key times',()=>{
 const d=validateRotDefinition(base());eq(d.rig.parts[0].id,80);
 for (const change of [d=>d.rig.bones[0].parent='child',d=>d.rig.parts[0].id=255,d=>d.rig.parts.push({...d.rig.parts[0]}),d=>d.rig.bones[0].pivot=[NaN,0,0]]) {const x=base();change(x);throws(()=>validateRotDefinition(x));}
 for (const change of [a=>a.clips.spin.duration=0,a=>a.clips.spin.tracks[0].target='missing',a=>a.clips.spin.tracks[0].keys=[[1,0],[0,1]],a=>a.clips.spin.tracks.push({...a.clips.spin.tracks[0]})]) {const a=base().animations;change(a);throws(()=>validateRotAnimations(a,d));}
});
test('Clip interpolation, looping, one-shot and facial step',()=>{
 const d=validateRotDefinition(base()),a=validateRotAnimations(d.animations,d);
 near(sampleRotClip(a.clips.spin,1).bones.root['rotation.z'],90,1e-9);
 near(sampleRotClip(a.clips.spin,3).bones.root['rotation.z'],90,1e-9);
 eq(sampleRotClip(a.clips.blink,.49).face.eyes,'open');eq(sampleRotClip(a.clips.blink,.5).face.eyes,'closed');
 truthy(sampleRotClip(a.clips.blink,2).ended);eq(sampleRotClip(a.clips.blink,2).face.eyes,'open');
});
test('Hierarchical affine transforms rotate child joints and arbitrary ID 80',()=>{
 const d=validateRotDefinition(base()),a=validateRotAnimations(d.animations,d);
 const p=buildRotModelPose(d,sampleRotClip(a.clips.spin,1),{body:true});
 eq(p.records[0][0],80);near(p.records[0][5],0,1e-9);near(p.records[0][6],-1,1e-9);near(p.bones.child[4],1,1e-9);
});
test('High-level JSON assembly, layers, overrides, reload and legacy coexistence',()=>{
 const $=createApi();installRotSprite($);let released=0,last,stamp='1';const source=base();
 $.fs={readText:path=>path==='models/prop.json'?JSON.stringify(source):null};
 engine.rotSpriteLoad=path=>({path,sprite:7,width:128,version:2,yaw:0,pitch:0,eyes:0,mouth:0,brows:0});
 engine.rotSpriteInfo=h=>({...h});engine.rotSpritePose=(h,y,p,e=h.eyes,m=h.mouth,b=h.brows)=>{Object.assign(h,{yaw:y,pitch:p,eyes:e,mouth:m,brows:b});return h.sprite;};
 engine.rotSpriteModelPose=(h,scale,rows)=>{last={scale,rows};};engine.rotSpriteDispose=()=>released++;
 engine.rotSpriteStyle=(h,style)=>{h.width=style==='anime'?256:128;h.style=style;return h.sprite;};
 engine.rotSpriteChanged=()=>false;engine.rotSpriteFileStamp=()=>stamp;engine.rotSpritePart=(h,path,ids)=>{eq(ids[0],80);return h.sprite;};
 eq($.re2dSprite,$.rotSprite);
 const n=$.re2dSprite.from('models/prop.json',{id:'json'});n.re2dPose(10,5).re2dRig({body:true}).re2dLayer('blink',false).re2dBone('child',{rotation:[0,0,0]}).re2dHotReload(false).re2dPose(0,0);eq($.rotSprite.info(n).path,'models/prop.png');
 n.rotSeek(1);let info=$.rotSprite.info(n);near(info.joints.tip.x,64,1e-9);near(info.joints.tip.y,74,1e-9);
 n.rotLayer('blink');tickRotSprite(.5);eq($.rotSprite.info(n).eyes,2);n.rotLayer('blink',false);eq($.rotSprite.info(n).eyes,0);
 n.rotBone('child',{translation:[2,0,0]}).rotPart('shell','donor.png').rotStyle('anime');
 eq($.rotSprite.info(n).style,'anime');eq($.rotSprite.info(n).parts.shell,'donor.png');eq($.rotSprite.info(n).animationTime,1.5);
 n.rotHotReload();stamp='2';tickRotSprite(.5);truthy($.rotSprite.info(n).reloads>1);
 const before=$.rotSprite.info(n).sprite;source.rig.parts[0].id=255;throws(()=>n.rotReload());eq($.rotSprite.info(n).sprite,before);
 const def=$.rotSprite.definition(n);def.rig.parts[0].id=40;eq($.rotSprite.definition(n).rig.parts[0].id,80);
 throws(()=>n.rotBone('unknown',{rotation:[1,2,3]}));throws(()=>n.rotMotion('unknown'));
 n.remove();truthy(released>=3);
});
test('Sockets align arbitrary models, reject cycles and survive reload/remove',()=>{
 const $=createApi();installRotSprite($);const source=base();source.rig.sockets=[{name:'hand',bone:'child',point:[10,2,3]}];
 const n=$.rotSprite.from(source,{id:'socket-parent'}).rotMotion('spin',0).rotPose(65,20);
 const child=base();child.rig.sockets=[{name:'grip',bone:'root',point:[2,3,4]}];
 const item=$.rotSprite.from(child,{id:'socket-item'}).rotMotion('spin',0).rotAttach(n,'hand',{grip:'grip',rotation:[0,180,0]});
 const aligned=()=>{const h=$.rotSprite.info(n),i=$.rotSprite.info(item);for (const k of [3,7,11]) near(h.sockets.hand.matrix[k],i.sockets.grip.matrix[k],1e-8);eq(h.yaw,i.yaw);eq(h.pitch,i.pitch);};
 aligned();n.rotBone('root',{rotation:[10,20,30]});aligned();n.rotReload();item.rotReload();aligned();
 throws(()=>n.rotAttach(item,'grip'));throws(()=>item.rotAttach(n,'unknown'));eq($.rotSprite.info(item).attachment.socket,'hand');
 n.remove();eq($.rotSprite.info(item).attachment,null);item.remove();
});
finish();

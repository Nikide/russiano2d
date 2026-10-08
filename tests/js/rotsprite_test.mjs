import { test, eq, near, truthy, finish } from './_harness.mjs';
import { normalizeRotPose, rotPixelRect, installRotSprite, tickRotSprite } from '../../src/highlevel/rotsprite.js';
import { createApi } from '../../src/highlevel/api.js';

test('углы: полный оборот и ограничение pitch', () => {
    eq(normalizeRotPose(360,100).yaw,0);
    eq(normalizeRotPose(-540,-100).yaw,-180);
    eq(normalizeRotPose(12.5,100).pitch,75);
    near(normalizeRotPose(12.5,-100).yaw,12.5,1e-10);
    for (const y of [NaN,Infinity,-Infinity,'30']) {
        let threw = false;
        try { normalizeRotPose(y,0); } catch (e) { threw = true; }
        truthy(threw);
    }
});

test('экранный пиксель: целый масштаб и привязка краёв после камеры', () => {
    const p = rotPixelRect({x: 31.3,y:-2.8,w:255,h:200});
    eq(p.scale,3); eq(p.w,192); eq(p.h,192);
    eq(p.x-p.w/2,Math.round(31.3-96));
    eq(p.y-p.h/2,Math.round(-2.8-96));
    eq(rotPixelRect({x:0,y:0,w:8,h:4}).w,64);
});

test('публичный API: цепочки, владение, замена и remove', () => {
    const calls = [];
    engine.rotSpriteLoad = (path) => {
        if (path === 'bad') throw new Error('bad PNG');
        return {path,sprite:calls.length+10};
    };
    engine.rotSpriteInfo = (h) => ({sprite:h.sprite});
    engine.rotSpritePose = (h,y,p) => { calls.push(['pose',y,p]); return h.sprite; };
    engine.rotSpriteDispose = (h) => calls.push(['dispose',h.path]);
    const $ = createApi();
    installRotSprite($);
    try { $.rotSprite.create('bad',{id:'invalid-head'}); } catch (e) {}
    eq($('#invalid-head').length,0);
    const n = $.rotSprite.create('whole.png',{id:'head'});
    eq(n.get(0).tag,'rotsprite');
    eq(n.rotPose(360,100),n);
    eq(calls[0][1],0); eq(calls[0][2],75);
    try { n.rotSpriteAtlas('bad'); } catch (e) {}
    eq($.rotSprite.info(n).path,'whole.png');
    n.rotSpriteAtlas('second.png');
    eq(calls[1][0],'dispose');
    n.remove();
    eq(calls[2][0],'dispose');
});
test('мимика и локомоция: независимые параметры и контроль значений', () => {
    const $=createApi();installRotSprite($);
    engine.rotSpriteLoad=() => ({sprite:10,yaw:0,pitch:0,eyes:0,mouth:0,brows:0});
    engine.rotSpriteInfo=h => ({...h,width:128,version:2});
    engine.rotSpritePose=(h,y,p,e=h.eyes,m=h.mouth,b=h.brows) => {Object.assign(h,{yaw:y,pitch:p,eyes:e,mouth:m,brows:b});return h.sprite;};
    let last;
    engine.rotSpriteRig=(h,body,phase,stride,armLeft,armRight,headYaw) => {last={body,phase,stride,armLeft,armRight,headYaw};return h.sprite;};
    engine.rotSpriteDispose=() => {};
    const n=$.rotSprite.create('atlas.png');
    eq(n.rotEmotion('angry'),n);eq($.rotSprite.info(n).brows,1);
    n.rotPose(35,12);eq($.rotSprite.info(n).brows,1);
    n.rotMotion('walk');tickRotSprite(.1);near(last.phase,.5,1e-9);eq(last.stride,22);
    n.rotRig({armLeft:90});eq(last.armLeft,90);
    n.rotMotion('idle');const phase=last.phase;tickRotSprite(.1);eq(last.phase,phase);eq(last.stride,0);
    for (const f of [()=>n.rotMotion('bad'),()=>n.rotMotion('run',NaN),()=>n.rotExpression({eyes:'bad'}),()=>n.rotEmotion('bad'),()=>n.rotRig({headYaw:Infinity})]) {
        let threw=false;try {f();} catch(e) {threw=true;}truthy(threw);
    }
    eq(rotPixelRect({x:0,y:0,w:512,h:512},128).scale,4);
    n.remove();
});
finish();

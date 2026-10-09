#!/usr/bin/env python3
"""RotSprite: реальные кадры, поза, владение, строгий PNG и demo input."""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[2] / 'tools'))
from agent_client import Agent, ROOT
from PIL import Image

FAILURES = []


def check(ok, message):
    print(('  ok   ' if ok else '  FAIL ') + message)
    if not ok: FAILURES.append(message)


def shot(a, path):
    a.step(2)
    a.screenshot(str(path))
    with Image.open(path) as image: return image.convert('RGBA').tobytes()


def main():
    atlas = 'demos/assets/art/mascot/russi_rotsprite_v1.png'
    with tempfile.TemporaryDirectory(prefix='r2d-rotsprite-') as temp:
        temp = Path(temp)
        partial = temp / 'partial.png'
        invalid = temp / 'invalid.png'
        Image.new('RGBA',(64,64),(0,255,0,128)).save(partial)
        Image.new('RGBA',(64,65),(0,255,0,255)).save(invalid)
        # Fixture без UI: сравнение кадров не зависит от текста таймера демо.
        with Agent(game='tests/fixtures/rotsprite',seed=11) as a:
            a.step(2)
            before = a.eval('engine.limits().textures')
            a.eval(f"$.rotSprite.create('{atlas}',{{id:'rot-test'}}).at(400,300).size(256,256)")
            info = a.eval("$.rotSprite.info('#rot-test')")
            check(info['atlasWidth'] == 512 and info['width'] == 64,'голова из общего PNG 512×512')
            a.eval("$('#rot-test').rotPose(0,0)")
            front = shot(a,temp/'front.png')
            rev = a.eval("$.rotSprite.info('#rot-test').revision")
            a.eval("$('#rot-test').rotPose(360,0)")
            check(a.eval("$.rotSprite.info('#rot-test').revision") == rev,'360° не делает повторный upload')
            check(shot(a,temp/'turn.png') == front,'полный оборот возвращает тот же кадр')
            a.eval("$('#rot-test').rotPose(180,0)")
            back = shot(a,temp/'back.png')
            check(front != back,'затылок отличается от фронта по пикселям')
            a.eval("$('#rot-test').rotPose(-180,0)")
            check(shot(a,temp/'seam.png') == back,'стык −180/+180 без скачка')
            a.eval("$('#rot-test').rotPose(35,75)")
            up = shot(a,temp/'up.png')
            a.eval("$('#rot-test').rotPose(35,-75)")
            check(up != shot(a,temp/'down.png'),'pitch меняет проекцию по пикселям')
            a.eval("$('#rot-test').rotPose(0,0); $.gfx.filter(true)")
            check(shot(a,temp/'filter.png') == front,'nearest сохраняется при глобальном linear')
            for path in (partial,invalid):
                result = a.eval(f"(() => {{ try {{ $('#rot-test').rotSpriteAtlas({str(path)!r}); return false; }} catch(e) {{ return true; }} }})()")
                check(result,'невалидный формат/альфа отклоняются')
            check(a.eval("$.rotSprite.info('#rot-test').path") == atlas,'невалидная замена сохраняет действующий PNG')
            a.eval("$('#rot-test').remove()")
            check(a.eval('engine.limits().textures') == before,'remove возвращает GPU-ресурс')
            a.eval(f"globalThis.rotHandle = engine.rotSpriteLoad('{atlas}'); engine.rotSpriteDispose(rotHandle); engine.rotSpriteDispose(rotHandle)")
            check(a.eval('engine.rotSpriteInfo(rotHandle).disposed'),'dispose идемпотентен')
            check(a.eval("(() => { try { engine.rotSpritePose(rotHandle,0,0); return false; } catch(e) { return true; } })()"),'поза освобождённого ресурса отклоняется')
            a.eval(f"$.rotSprite.create('{atlas}',{{id:'reload-head'}})")
            a.eval("engine.requestReload('rotsprite-test')")
            a.step(3)
            check(a.eval('engine.limits().textures') == before,'hot reload освобождает нативный ресурс')
        # v2 data maps, expressions, body rig, replacement and atomic live reload.
        import shutil
        import math
        v2='demos/assets/art/mascot/russi_rotsprite_v2.png'
        live=temp/'live.png';donor=temp/'donor.png'
        shutil.copyfile(Path(ROOT)/v2,live)
        shutil.copyfile(Path(ROOT)/'demos/assets/art/mascot/russi_rotsprite_police.png',donor)
        with Agent(game='tests/fixtures/rotsprite',seed=11) as a:
            a.step(2);before=a.eval('engine.limits().textures')
            a.eval(f"$.rotSprite.create({str(live)!r},{{id:'v2'}}).at(400,300).size(512,512).rotHotReload()")
            info=a.eval("$.rotSprite.info('#v2')")
            check(info['version']==2 and info['atlasWidth']==4096 and info['width']==128,'v2: один PNG 4096 и растер 128')
            check(info['surfaceSamples']>10000,'геометрия декодирована из служебных карт')
            front=shot(a,temp/'v2-front.png')
            a.eval("$('#v2').rotExpression({eyes:'closed'})")
            check(shot(a,temp/'v2-closed.png')!=front,'закрытые глаза меняют реальные пиксели')
            rev=a.eval("$.rotSprite.info('#v2').revision")
            a.eval("$('#v2').rotExpression({eyes:'closed'})")
            check(a.eval("$.rotSprite.info('#v2').revision")==rev,'мимика с прежними параметрами не делает upload')
            a.eval("$('#v2').rotEmotion('angry')")
            check(a.eval("$.rotSprite.info('#v2').brows")==1,'эмоция переключает брови независимо от глаз')
            a.eval("$('#v2').rotRig({body:true})")
            check(a.eval("$.rotSprite.info('#v2').body"),'проекция всего тела включена')
            idle=shot(a,temp/'v2-idle.png')
            a.eval("$('#v2').rotRig({phase:1.57,stride:30})")
            check(shot(a,temp/'v2-walk.png')!=idle,'суставы изменяют растер локомоции')
            a.eval("$('#v2').rotRig({stride:0,armLeft:90})")
            check(a.eval("$.rotSprite.info('#v2').joints.handLeft.x")<40,'рука поворачивается вокруг плеча')
            a.eval(f"$('#v2').rotPart('costume',{str(donor)!r})")
            police=shot(a,temp/'v2-police.png')
            check(police!=idle,'подмена костюма меняет пиксели')
            check(a.eval('engine.limits().textures')==before+1,'временный донор не оставляет GPU-текстуру')
            a.eval("$('#v2').rotReload()")
            check(shot(a,temp/'v2-reload.png')==police,'перечитывание сохраняет костюм, суставы и эмоцию')
            a.eval(f"$('#v2').rotPart('torso',{v2!r}).rotPart('costume',{str(donor)!r}).rotPart('torso',{v2!r})")
            mixed=shot(a,temp/'v2-mixed.png');a.eval("$('#v2').rotReload()")
            check(shot(a,temp/'v2-mixed-reload.png')==mixed,'порядок перекрывающихся подмен сохраняется при reload')
            a.eval(f"$('#v2').rotPart('costume',{str(donor)!r})")
            check(shot(a,temp/'v2-restored.png')==police,'повторная подмена возвращает тот же костюм по пикселям')
            count=a.eval("$.rotSprite.info('#v2').reloads")
            stat=live.stat();os.utime(live,ns=(stat.st_atime_ns,stat.st_mtime_ns+2_000_000_000))
            a.step(35)
            check(a.eval("$.rotSprite.info('#v2').reloads")==count+1,'изменение всего PNG подхватывается автоматически')
            count=a.eval("$.rotSprite.info('#v2').reloads")
            stat=donor.stat();os.utime(donor,ns=(stat.st_atime_ns,stat.st_mtime_ns+2_000_000_000))
            a.step(35)
            check(a.eval("$.rotSprite.info('#v2').reloads")==count+1,'hot reload отслеживает и PNG заменяемых частей')
            # Anime is opt-in and survives costume overrides, reload and filter changes.
            a.eval("$('#v2').rotStyle('anime')")
            smooth=a.eval("$.rotSprite.info('#v2')")
            check(smooth['style']=='anime' and smooth['width']==512,'anime: сглаженный растер 512')
            check(smooth['parts']['costume']==str(donor) and smooth['brows']==1,'смена стиля сохраняет костюм и мимику')
            anime=shot(a,temp/'v2-anime.png')
            a.eval("$('#v2').rotReload(); $.gfx.filter(false)")
            check(shot(a,temp/'v2-anime-reload.png')==anime,'anime сохраняет линейную фильтрацию и подмены при reload')
            check(a.eval('engine.limits().textures')==before+1,'смена стиля и reload не оставляют GPU-ресурсы')
            a.eval("$('#v2').rotStyle('pixel')")
            check(a.eval("$.rotSprite.info('#v2').width")==128,'обратное переключение возвращает совместимый pixel режим')
            a.eval("$('#v2').rotStyle('anime')")
            last_valid=shot(a,temp/'v2-last-valid.png')
            donor.write_bytes(b'invalid PNG');a.step(35)
            check(bool(a.eval("$.rotSprite.info('#v2').reloadError")),'ошибка hot reload доступна структурированно')
            check(shot(a,temp/'v2-invalid-reload.png')==last_valid,'невалидное обновление сохраняет прежний персонаж')
            a.eval("$('#v2').remove()")
            check(a.eval('engine.limits().textures')==before,'v2 remove освобождает ресурс')
        with Agent(game='demos',scene='rotsprite',seed=11) as a:
            a.step(20)
            check(a.eval('$.scene.current()') == 'rotsprite','демо открывается напрямую')
            check(a.state()['rotSpriteDemo']['head']['style']=='anime','демо использует аниме-проекцию')
            check(a.eval("$('rotsprite').length") == 4,'маскот и три проверки pitch в сцене')
            a.cmd('key',key='Space',action='tap'); a.step(2)
            check(not a.state()['rotSpriteDemo']['auto'],'пробел останавливает автоповорот')
            yaw = a.state()['rotSpriteDemo']['yaw']
            a.cmd('key',key='Right',action='down'); a.step(20)
            a.cmd('key',key='Right',action='up'); a.step(2)
            check(a.state()['rotSpriteDemo']['yaw'] > yaw+10,'стрелка поворачивает голову')
            state=a.state()['rotSpriteDemo'];j=state['head']['joints']['handLeft'];size=a.eval('$.window.size()')
            scale=size['h']*.59/128
            x=size['w']*.7+(j['x']-64)*scale;y=size['h']*.43+(j['y']-64)*scale
            a.mouse_move(x=x,y=y);a.mouse(button=1,action='down');a.step(2)
            check(a.state()['rotSpriteDemo']['drag']=='Left','кисть выбирается мышью')
            a.mouse_move(x=x-70,y=y-65);a.step(2)
            check(abs(a.state()['rotSpriteDemo']['armLeft'])>20,'перетаскивание поворачивает руку')
            a.mouse(button=1,action='up');a.step(2)
            check(a.state()['rotSpriteDemo']['drag'] is None,'кнопка мыши отпускает кисть')
            a.cmd('key',key='L',action='tap');a.step(2)
            check(a.state()['rotSpriteDemo']['motion']=='walk','L включает ходьбу')
            phase=a.eval("$.rotSprite.info('#rot-head').rig.phase");a.step(5)
            check(a.eval("$.rotSprite.info('#rot-head').rig.phase")!=phase,'цикл локомоции шагает автоматически')
            before = a.eval('engine.limits().textures')
            a.cmd('key',key='Escape',action='tap'); a.step(30)
            check(a.eval('$.scene.current()') == 'launcher','Esc возвращает в меню')
            check(a.eval("$('rotsprite').length") == 0,'сцена удаляет все головы')
            check(a.eval('engine.limits().textures') <= before,'переход не сохраняет нативные текстуры голов')
            errors = [line for line in a.stderr_text().splitlines() if 'ошибка' in line.lower() or '[error]' in line.lower() or 'syntax error' in line.lower()]
            check(not errors,'нет ошибок игрового кода: '+str(errors))
    print('Все проверки пройдены' if not FAILURES else f'Провалов: {len(FAILURES)}')
    return bool(FAILURES)


if __name__ == '__main__': sys.exit(main())

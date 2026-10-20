// Compatibility adapter: old SDK shell uses the Editor controller.
import { create } from '../../editor/studios/sprite_mesh.js';
let current=null;
export async function open(app,args) {
    if(!current) {
        let inst=null;
        current={
            async open(path) {
                if(inst)inst.close();
                inst=create({$:app.$,document:app.$.ui.doc('sdk/ui/sprite_mesh_studio.rml'),
                    backend:(...args)=>app.backend(...args),changed:()=>{},typing:()=>app.$.ui.typing(),
                    status:(text,kind)=>app.setStatus(text,kind==='err'?'fail':kind),
                    closeTab:()=>{inst.close();if(app.doc)app.doc.show();if(app.showView)app.showView('tools');}});
                await inst.open(path);inst.onActive(true);inst.doc.show();if(app.doc)app.doc.hide();
                app.studios.spriteMesh=current;return {id:'sprite-mesh-studio',studio:current};
            },
            get state(){return inst&&inst.state;},
        };
        for(const name of ['close','snapshot','diagnostics','render','bake','saveAndBake','selectFrame','selectAnimation','play','pause','undo','redo'])
            current[name]=(...args)=>inst[name](...args);
        app.$.update(dt=>{if(inst)inst.update(dt);});
    }
    return current.open(args.assetAbs||args.asset||null);
}

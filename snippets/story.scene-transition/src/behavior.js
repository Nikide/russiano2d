// Переход: полноэкранный узел-затемнение, затем сцена или сценарий.
export default function sceneTransition(node, config, $) {
    const go = () => {
        const v = $.camera.viewport();
        const veil = $('<veil>', { ui: true }).at(640, 360).size(4000, 4000).color('#000000').alpha(0).appendTo($.world);
        void v;
        veil.fadeTo(1, config.fade).then(() => {
            if (config.scene) $.scene.load(config.scene);
            else if (config.script) { $.story.play(config.script); veil.fadeTo(0, config.fade).then(() => veil.remove()); }
        });
    };
    $.on(config.event, go);
    return () => $.off(config.event, go);
}

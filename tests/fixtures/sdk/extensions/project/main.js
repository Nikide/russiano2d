export const standalone = true;   // инструмент-страница не требует выбранного ассета
// Fixture extension: активируется хостом расширений SDK (sdk/lib/extensions.js).
export function activate(ctx) {
    ctx.sdk.registerWorldTool({
        id: 'fixture.world.runtime', title: 'Runtime tool',
        run(opts) { return opts.apply('world.set', { x: 64 }); },
    });
    ctx.sdk.registerInspectorSection({
        id: 'fixture.inspector.runtime', title: 'Runtime inspector', fields: ['targetY'],
        run(opts) {
            if (!opts.selection.ids.length) return { ok: false, message: 'Select an object first' };
            return opts.apply('world.set', { y: Number(opts.targetY) });
        },
    });
    ctx.sdk.registerContextAction({
        id: 'fixture.context.runtime', label: 'Move selected context',
        run(opts) {
            if (!opts.selection.ids.length) return { ok: false, message: 'Select an object first' };
            return opts.apply('world.set', { x: 96 });
        },
    });
    ctx.sdk.registerValidator({ id: 'fixture.validator.runtime', title: 'Runtime validator', run(map) {
        return [{ code: 'FIXTURE_RUNTIME_VALIDATOR', severity: 'warning', message: 'Runtime validator saw ' + map.brushes.length + ' brush', details: { frozen: Object.isFrozen(map) && Object.isFrozen(map.brushes) } }];
    } });
    ctx.sdk.registerValidator({ id: 'fixture.validator.throw', title: 'Throwing validator', run() { throw new Error('fixture validator failure'); } });
    return { ok: true, id: 'fixture.world-tools' };
}

export async function open(app) {
    return { id: 'fixture.world-tools.panel', opened: true };
}

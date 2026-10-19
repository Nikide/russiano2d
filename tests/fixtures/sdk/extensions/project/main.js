export const standalone = true;   // инструмент-страница не требует выбранного ассета
// Fixture extension: активируется хостом расширений SDK (sdk/lib/extensions.js).
export function activate(ctx) {
    ctx.sdk.registerWorldTool({ id: 'fixture.world.runtime', title: 'Runtime tool', run() { return { ok: true }; } });
    ctx.sdk.registerValidator({ id: 'fixture.validator.runtime', title: 'Runtime validator', run() { return []; } });
    return { ok: true, id: 'fixture.world-tools' };
}

export async function open(app) {
    return { id: 'fixture.world-tools.panel', opened: true };
}

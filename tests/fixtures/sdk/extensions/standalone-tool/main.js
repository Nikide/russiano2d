export function activate(ctx) {
    ctx.app.setStatus('fixture.standalone активен', '');
    return { ok: true, id: 'fixture.standalone' };
}

export async function open(app) {
    return { id: 'fixture.standalone', opened: true };
}

// Код: случайный из алфавита без 0/O/1/I; хранится в $.store inviteCode.
const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export default function inviteCode(node, config, $) {
    const make = () => { let c = ''; for (let i = 0; i < config.length; i++) c += ABC[$.random.int(0, ABC.length - 1)]; $.store.set('inviteCode', c); $.emit('invite:code', { code: c }); $.emit('room:create', { name: c }); };
    const enter = (e) => { const c = String(e.data && e.data.code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); if (c.length === config.length) $.emit('room:join-code', { code: c, address: e.data.address }); else $.emit('invite:invalid', {}); };
    $.on('invite:new', make);
    $.on('invite:enter', enter);
    return () => { $.off('invite:new', make); $.off('invite:enter', enter); };
}

const MAP_FILE = 'level.tilemap.json';
const MASCOT = { src: 'assets/mascot/rusiano_walk_sheet.png', cols: 8, rows: 4, cw: 176, ch: 176 };
let hero, goal, motion = '', won = false;

$.scene.add('spring_path', {
	enter($) {
		const map = $.fs.readJSON(MAP_FILE);
		$.world.gravity(0, 800).color('#8ed7f2');
		const level = $('<tilemap>', map).at(320, 176).appendTo($.world);
		level.collisions(true);
		hero = $('<player>', { id: 'hero' }).at(40, 310)
			.collision(22, 34).size(42, 42).frames(MASCOT)
			.animate({ from: 0, to: 3, speed: 6, loop: true })
			.appendTo($.world);
		goal = $('<text>', { id: 'goal', text: '★', color: '#ffdc69' })
			.at(600, 80).layer(2).appendTo($.world);
		goal.get(0).size = 48;
		$('<ui.label>', {
			id: 'instructions', text: 'Весенняя тропа  ·  A/D или ←/→ — идти  ·  Space — прыгнуть  ·  R — заново',
			color: '#143047', x: 640, y: 28,
		}).appendTo($.ui).get(0).size = 20;
		$.input.bind('move_left', ['a', 'Left']);
		$.input.bind('move_right', ['d', 'Right']);
		$.input.bind('jump', ['space', 'w', 'Up']);
		$.camera.follow('#hero', { smooth: 0.12, offset: [0, -8], zoom: 2 }).limits(0, 0, 640, 352);
		motion = ''; won = false;
	},
	update(dt, $) {
		if ($.input.pressed('r')) { $.scene.restart(); return; }
		const pos = hero.pos(), v = hero.velocity(), grounded = hero.onFloor();
		const left = $.input.down('move_left'), right = $.input.down('move_right');
		const vx = (right ? 180 : 0) - (left ? 180 : 0);
		const vy = $.input.pressed('jump') && grounded ? -420 : v.y;
		hero.velocity(vx, vy).flip(vx < 0, false);
		const nextMotion = !grounded ? 'air' : (vx ? 'walk' : 'idle');
		if (motion !== nextMotion) {
			motion = nextMotion;
			const clips = { idle: { from: 0, to: 3, speed: 6 }, walk: { from: 8, to: 13, speed: 13 }, air: { from: 21, to: 23, speed: 9 } };
			hero.animate(Object.assign({ loop: true }, clips[motion]));
		}
		if (!won && Math.abs(pos.x - goal.pos().x) < 44 && Math.abs(pos.y - goal.pos().y) < 68) {
			won = true;
			$.ui.label('#instructions', 'Получилось! Ты нашёл звезду  ·  R — сыграть ещё раз');
			goal.text('✦');
		}
		if (pos.y > 470) $.scene.restart();
		void dt;
	},
});

$.ready(() => $.scene.load('spring_path', { transition: 'none' }));

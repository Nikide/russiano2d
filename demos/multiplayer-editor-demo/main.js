// Авторитарный multiplayer-пример, созданный через Russiano2D Editor.
import { multiplayer, startHost, joinHost, syncEntity, sendInput } from './multiplayer.js';

const ENTITY_ID = 'demo:shared-mascot';
const HOST_ADDRESS = '127.0.0.1'; // Для LAN укажите адрес компьютера-host.
const SPEED = 220;
const WORLD = { width: 1280, height: 720, padding: 72 };
const MASCOT_SHEET = {
	src: 'assets/russiano_mascot_walk.png',
	cols: 4, rows: 4, cw: 313.5, ch: 313.5,
};

$.ready(() => {
	$.gfx.color('#0b0e14');
	$.camera.at(WORLD.width / 2, WORLD.height / 2).zoom(1);

	$('<text>', { text: 'AUTHORITATIVE MULTIPLAYER', size: 22, color: '#91a8bf' })
		.at(32, 28).appendTo($.world);
	const status = $('<text>', {
		id: 'net-status', text: 'H — host     J — join localhost', size: 20, color: '#ffffff',
	}).at(32, 68).appendTo($.world);
	$('<text>', {
		text: 'WASD двигает маскота · host считает состояние · цикл ходьбы меняет направление',
		size: 16, color: '#91a8bf',
	}).at(32, 104).appendTo($.world);
	$('<text>', { text: 'H', size: 18, color: '#71f0ad' }).at(40, 190).appendTo($.world);
	$('<text>', { text: 'J', size: 18, color: '#ffd36e' }).at(40, 236).appendTo($.world);

	const mascot = $('<sprite>', { id: 'shared-mascot' })
		.frames(MASCOT_SHEET)
		.size(176, 176)
		.pivot(0.5, 1)
		.at(WORLD.width / 2, WORLD.height / 2 + 72)
		.appendTo($.world);

	// С одинаковым id owner=host все клиенты получают авторитетную позицию.
	// Runtime интерполирует реплицированный transform; кадр ходьбы остаётся локальным.
	syncEntity('#shared-mascot', ENTITY_ID, 'host');
	$.net.syncRate(multiplayer.syncRate);
	$.net.interpolationDelay(100);

	const remoteMove = { x: 0, y: 0 };
	let facingRow = 0; // 0 вниз, 1 влево, 2 вправо, 3 вверх.
	let activeRow = -1;
	let wasMoving = false;
	let lastX = mascot.x;
	let lastY = mascot.y;

	$.net.on('connect', (peer) => status.text('Подключён peer ' + peer.id));
	$.net.on('disconnect', (peer) => {
		remoteMove.x = 0;
		remoteMove.y = 0;
		status.text('Отключён peer ' + peer.id);
	});
	$.net.on('error', (message) => status.text('Ошибка сети: ' + message));
	$.net.on('input', (input) => {
		if (!$.net.isAuthority() || !input || input.entity !== ENTITY_ID) return;
		remoteMove.x = Math.max(-1, Math.min(1, Number(input.moveX) || 0));
		remoteMove.y = Math.max(-1, Math.min(1, Number(input.moveY) || 0));
	});

	function animateFromTransform() {
		const dx = mascot.x - lastX;
		const dy = mascot.y - lastY;
		const moving = Math.hypot(dx, dy) > 0.15;
		if (moving) {
			if (Math.abs(dx) > Math.abs(dy)) facingRow = dx < 0 ? 1 : 2;
			else facingRow = dy < 0 ? 3 : 0;
		}
		const firstFrame = facingRow * 4;
		if (moving) {
			if (!wasMoving || activeRow !== facingRow) {
				mascot.animate({ from: firstFrame, to: firstFrame + 3, speed: 9, loop: true });
				activeRow = facingRow;
			}
		} else if (wasMoving || activeRow !== facingRow) {
			mascot.stopAnim().frame(firstFrame);
			activeRow = facingRow;
		}
		wasMoving = moving;
		lastX = mascot.x;
		lastY = mascot.y;
	}

	$.update((dt) => {
		if ($.input.pressed('h')) {
			status.text(startHost() ? 'HOST слушает порт ' + multiplayer.port : 'Не удалось открыть host');
		}
		if ($.input.pressed('j')) {
			status.text(joinHost(HOST_ADDRESS) ? 'Подключение к ' + HOST_ADDRESS + ':' + multiplayer.port : 'Не удалось подключиться');
		}

		const move = $.input.vec('wasd');
		if ($.net.isAuthority()) {
			let x = move.x + remoteMove.x;
			let y = move.y + remoteMove.y;
			const length = Math.hypot(x, y);
			if (length > 1) { x /= length; y /= length; }
			const nextX = Math.max(WORLD.padding, Math.min(WORLD.width - WORLD.padding, mascot.x + x * SPEED * dt));
			const nextY = Math.max(WORLD.padding, Math.min(WORLD.height - WORLD.padding, mascot.y + y * SPEED * dt));
			mascot.at(nextX, nextY);
		} else if ($.net.online()) {
			// Клиент сообщает намерение, а не координаты; host проверяет скорость и границы.
			sendInput({ entity: ENTITY_ID, moveX: move.x, moveY: move.y });
		}
		animateFromTransform();
	});
});

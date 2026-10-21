const registry = $.fs.readJSON('story/speakers.json');
for (const [id, speaker] of Object.entries(registry.speakers || {})) {
	$.dialog.speaker(id, speaker);
}
$.dialog.themeDefine('spring-romance', {
	rml: 'ui/dialog/romance.rml',
	rcss: 'ui/dialog/romance.rcss',
	choiceSlots: 4,
});
$.dialog.theme('spring-romance');
$.ready(() => {
	$.story.resetFlags();
	$.story.play('story/main.scene');
});

// Загрузка: $.loading показывает прогресс фоновых задач и смены сцены.
export default function loadingOverlay(node, config, $) {
    $.loading.title(config.title);
    const onStart = () => $.loading.show();
    const onDone = () => $.loading.hide();
    $.on('scene:loading', onStart);
    $.on('scene:ready', onDone);
    return () => { $.off('scene:loading', onStart); $.off('scene:ready', onDone); };
}

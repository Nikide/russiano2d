// Пропуск: next() допечатывает, затем листает; fastKey — next каждый кадр без выбора.
export default function dialogueSkip(node, config, $) {
    return $.updateFor(node, () => {
        if (!$.dialog.isOpen()) return;
        if ($.input.pressed(config.key)) $.dialog.next();
        else if ($.input.down(config.fastKey) && !$.dialog.choices().length) $.dialog.next();
    });
}

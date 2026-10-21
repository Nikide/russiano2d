// Односторонняя: тело узла становится one-way; спрыгивание даёт движок (.dropThrough).
export default function oneWayPlatform(node, config, $) {
    node.oneWay(true).addClass('one-way');
    return () => node.oneWay(false).removeClass('one-way');
}

// Масштаб камеры: плавно (zoomTo) или сразу; при снятии — назад к 1.
export default function cameraZoom(node, config, $) {
    if (config.duration > 0) $.camera.zoomTo(config.zoom, config.duration); else $.camera.zoom(config.zoom);
    return () => $.camera.zoom(1);
}

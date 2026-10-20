// API Browser reuses Code Check's native-backed panel but must open on the
// generated schema tab instead of silently leaving the user on Doctor.
import { open as openCodeCheck, standalone } from './code-check.js';

export { standalone };

export async function open(app, args) {
    const panel = await openCodeCheck(app, args);
    panel.api();
    return panel;
}

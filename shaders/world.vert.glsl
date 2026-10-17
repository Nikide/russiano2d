#version 450
// Constrained surface pass: no world mesh or vertex buffers.
#ifdef R2D_BATCH_SSBO
// Batched path: one fullscreen triangle per group, instance index selects the
// per-surface uniform from the std430 batch SSBO in the fragment stage. The
// per-group base is a vertex uniform because Metal instance_id is draw-relative.
layout(location=0) flat out int vBatchInstance;
#endif
void main() {
    vec2 p=vec2(float((gl_VertexIndex<<1)&2),float(gl_VertexIndex&2));
    gl_Position=vec4(p*2.0-1.0,0.0,1.0);
#ifdef R2D_BATCH_SSBO
    vBatchInstance=gl_InstanceIndex;
#endif
}

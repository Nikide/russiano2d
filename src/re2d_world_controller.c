#include "re2d_world_controller.h"
#include <math.h>

// Smallest step in one substep; keeps the swept circle from skipping a wall.
#define R2D_CONTROLLER_MAX_SUBSTEPS 64
#define R2D_CONTROLLER_RAD_TO_DEG 57.29577951308232f
#define R2D_CONTROLLER_EPS 1e-4f

static bool finite_config(const R2DWorldControllerConfig *c)
{
    return isfinite(c->radius)&&isfinite(c->height)&&isfinite(c->eye)&&
        isfinite(c->step)&&isfinite(c->slope_limit)&&isfinite(c->gravity)&&
        isfinite(c->jump_speed)&&isfinite(c->max_ground)&&isfinite(c->max_air)&&
        isfinite(c->accel)&&isfinite(c->friction)&&isfinite(c->air_control)&&
        c->radius>0&&c->height>0&&c->step>=0&&c->slope_limit>=0&&
        c->slope_limit<=89&&c->gravity>=0&&c->jump_speed>=0&&
        c->max_ground>=0&&c->max_air>=0&&c->accel>=0&&c->friction>=0&&
        c->air_control>=0;
}

static bool finite_state(const R2DWorldControllerState *s)
{
    return isfinite(s->x)&&isfinite(s->y)&&isfinite(s->feet)&&
        isfinite(s->vx)&&isfinite(s->vy)&&isfinite(s->vz);
}

static bool span_contains_xy(const R2DWorldSpan *s,float x,float y)
{
    return x>=s->x&&x<=s->x+s->w&&y>=s->y&&y<=s->y+s->h;
}

// Prefer the public span query. Worlds built from bare spans (no explicit
// cells) have no cell index, so fall back to the same plane test over spans.
static int span_at_compat(const R2DRe2dWorld *w,float x,float y,float h)
{
    int span=r2d_world_span_at(w,x,y,h);
    if(span>=0)return span;
    int best=-1;float best_floor=-INFINITY;
    for(int i=0;i<w->span_count;i++) {
        const R2DWorldSpan *s=&w->spans[i];
        if(!span_contains_xy(s,x,y))continue;
        float floor=r2d_world_floor_height(s,x,y);
        float ceiling=r2d_world_ceiling_height(s,x,y);
        if(h>=floor&&h<ceiling&&floor>best_floor){best=i;best_floor=floor;}
    }
    return best;
}

// A destination floor above the allowed step but below the head blocks the
// body like a solid riser even when no wall was authored on the span edge.
static bool riser_blocks(const R2DRe2dWorld *w,float x,float y,float feet,float height,float step)
{
    for(int i=0;i<w->span_count;i++) {
        const R2DWorldSpan *s=&w->spans[i];
        if(!span_contains_xy(s,x,y))continue;
        float floor=r2d_world_floor_height(s,x,y);
        if(floor>feet+step&&floor<feet+height)return true;
    }
    return false;
}

static bool body_overlaps_span(const R2DRe2dWorld *w,float x,float y,float feet,float height)
{
    for(int i=0;i<w->span_count;i++) {
        const R2DWorldSpan *s=&w->spans[i];
        if(!span_contains_xy(s,x,y))continue;
        float floor=r2d_world_floor_height(s,x,y);
        float ceiling=r2d_world_ceiling_height(s,x,y);
        if(floor<feet+height&&ceiling>feet)return true;
    }
    return false;
}

// A horizontal destination is usable when it has a support reachable within
// step_allow and no floor inside the body height that exceeds that step. A
// destination with no span at all is a void: movement is allowed and the body
// falls; a destination span with insufficient headroom blocks.
static bool can_stand(const R2DRe2dWorld *w,const R2DWorldControllerConfig *c,
                      float x,float y,float feet,float step_allow)
{
    if(r2d_world_blocked(w,x,y,c->radius,feet,feet+c->height))return false;
    if(riser_blocks(w,x,y,feet,c->height,step_allow))return false;
    if(r2d_world_support(w,x,y,feet,c->height,step_allow)>=0)return true;
    return !body_overlaps_span(w,x,y,feet,c->height);
}

static void approach(float *vx,float *vy,float target_x,float target_y,float max_delta)
{
    float dx=target_x-*vx,dy=target_y-*vy;
    float distance=sqrtf(dx*dx+dy*dy);
    if(distance<=max_delta||distance<=0){*vx=target_x;*vy=target_y;return;}
    float scale=max_delta/distance;
    *vx+=dx*scale;*vy+=dy*scale;
}

bool r2d_world_controller_init(const R2DRe2dWorld *world,
                               const R2DWorldControllerConfig *config,
                               const R2DWorldControllerState *start,
                               R2DWorldControllerState *out)
{
    if(!world||!config||!out||!finite_config(config))return false;
    R2DWorldControllerState state={0};
    if(start) {
        if(!finite_state(start))return false;
        state=*start;
    }
    int span=r2d_world_support(world,state.x,state.y,state.feet,config->height,config->step);
    if(span<0)return false;
    float floor=r2d_world_floor_height(&world->spans[span],state.x,state.y);
    state.span=span;
    state.ceiling=r2d_world_ceiling_height(&world->spans[span],state.x,state.y);
    if(state.feet<=floor) {
        state.feet=floor;
        state.vz=0;
        state.grounded=true;
    } else {
        state.grounded=false; // start above the support: fall under gravity
    }
    *out=state;
    return true;
}

void r2d_world_controller_move(const R2DRe2dWorld *world,
                               const R2DWorldControllerConfig *config,
                               R2DWorldControllerState *state,
                               float wish_x,float wish_y,bool jump,float dt)
{
    if(!world||!config||!state||!finite_config(config)||!finite_state(state))return;
    if(!isfinite(wish_x)||!isfinite(wish_y)||!isfinite(dt))return;
    if(dt<=0||dt>0.5f)return;

    float x=state->x,y=state->y,feet=state->feet;
    float vx=state->vx,vy=state->vy,vz=state->vz;
    bool grounded=state->grounded;
    int span=state->span;
    float ceiling=state->ceiling;

    // Normalise only oversized wish vectors: analog input keeps its magnitude.
    float wish_len=sqrtf(wish_x*wish_x+wish_y*wish_y);
    if(wish_len>1){wish_x/=wish_len;wish_y/=wish_len;wish_len=1;}
    bool has_wish=wish_len>1e-6f;

    // Horizontal acceleration/friction decomposition for this fixed tick.
    if(grounded) {
        if(has_wish) approach(&vx,&vy,wish_x*config->max_ground,wish_y*config->max_ground,config->accel*dt);
        else {
            float speed=sqrtf(vx*vx+vy*vy);
            float drop=config->friction*dt;
            if(speed<=drop){vx=0;vy=0;}
            else {float scale=(speed-drop)/speed;vx*=scale;vy*=scale;}
        }
    } else {
        if(has_wish) approach(&vx,&vy,wish_x*config->max_air,wish_y*config->max_air,config->accel*config->air_control*dt);
        float speed=sqrtf(vx*vx+vy*vy);
        if(speed>config->max_air&&speed>0){float scale=config->max_air/speed;vx*=scale;vy*=scale;}
    }

    // Jump only from the ground; the ceiling pass below can still stop it.
    if(jump&&grounded){vz=config->jump_speed;grounded=false;}

    // One substep moves at most radius*0.5. The bound includes gravity gained
    // during the tick and is capped so a huge dt cannot explode the loop.
    float speed_bound=sqrtf(vx*vx+vy*vy)+fabsf(vz)+config->gravity*dt;
    float substep_limit=config->radius*0.5f;
    int substeps=(int)ceilf(speed_bound*dt/substep_limit);
    if(substeps<1)substeps=1;
    if(substeps>R2D_CONTROLLER_MAX_SUBSTEPS)substeps=R2D_CONTROLLER_MAX_SUBSTEPS;
    float substep_dt=dt/(float)substeps;

    for(int i=0;i<substeps;i++) {
        float old_x=x,old_y=y;
        float dx=vx*substep_dt,dy=vy*substep_dt;
        float step_allow=grounded?config->step:0;
        if(can_stand(world,config,x+dx,y+dy,feet,step_allow)) {
            x+=dx;y+=dy;
        } else {
            // Wall slide: full move, then X-only, then Y-only.
            if(can_stand(world,config,x+dx,y,feet,step_allow))x+=dx;else vx=0;
            if(can_stand(world,config,x,y+dy,feet,step_allow))y+=dy;else vy=0;
        }
        float horizontal=sqrtf((x-old_x)*(x-old_x)+(y-old_y)*(y-old_y));

        // Ground follow: rise up to step, descend up to step or along a
        // walkable slope; anything deeper starts a fall.
        if(grounded) {
            int support=r2d_world_support(world,x,y,feet,config->height,config->step);
            if(support>=0) {
                float floor=r2d_world_floor_height(&world->spans[support],x,y);
                float rise=floor-feet;
                bool follow=rise>=0&&rise<=config->step+R2D_CONTROLLER_EPS;
                if(!follow&&rise<0) {
                    float drop=-rise;
                    follow=drop<=config->step+R2D_CONTROLLER_EPS;
                    if(!follow&&horizontal>1e-6f) {
                        float angle=atan2f(drop,horizontal)*R2D_CONTROLLER_RAD_TO_DEG;
                        follow=angle<=config->slope_limit+R2D_CONTROLLER_EPS;
                    }
                }
                if(follow) {
                    feet=floor;
                    vz=0;
                    span=support;
                    ceiling=r2d_world_ceiling_height(&world->spans[support],x,y);
                } else grounded=false;
            } else grounded=false;
        }

        // Airborne vertical integration with ceiling and landing resolution.
        if(!grounded) {
            vz-=config->gravity*substep_dt;
            float next=feet+vz*substep_dt;
            if(vz>0) {
                int current=span_at_compat(world,x,y,feet);
                if(current>=0) {
                    float limit=r2d_world_ceiling_height(&world->spans[current],x,y);
                    if(next+config->height>limit) {
                        next=limit-config->height;
                        vz=0;
                    }
                }
            } else {
                int landing=r2d_world_support(world,x,y,feet,config->height,0);
                if(landing>=0) {
                    float floor=r2d_world_floor_height(&world->spans[landing],x,y);
                    if(next<=floor) {
                        next=floor;
                        vz=0;
                        grounded=true;
                        span=landing;
                        ceiling=r2d_world_ceiling_height(&world->spans[landing],x,y);
                    }
                }
            }
            feet=next;
            if(grounded) { /* support/ceiling already resolved */ }
            else {
                int current=span_at_compat(world,x,y,feet);
                if(current>=0) {
                    span=current;
                    ceiling=r2d_world_ceiling_height(&world->spans[current],x,y);
                } else {
                    span=-1;
                    ceiling=INFINITY;
                }
            }
        }
    }

    // Final support/ceiling refresh at the settled XY for callers/next tick.
    if(grounded) {
        int support=r2d_world_support(world,x,y,feet,config->height,config->step);
        if(support>=0) {
            span=support;
            ceiling=r2d_world_ceiling_height(&world->spans[support],x,y);
        } else {
            grounded=false;
        }
    }
    if(!grounded) {
        int current=span_at_compat(world,x,y,feet);
        if(current>=0) {
            span=current;
            ceiling=r2d_world_ceiling_height(&world->spans[current],x,y);
        } else {
            span=-1;
            ceiling=INFINITY;
        }
        if(feet+config->height>ceiling) {
            // Defensive: never report a body above a known ceiling.
            feet=ceiling-config->height;
            if(vz>0)vz=0;
        }
    }

    state->x=x;state->y=y;state->feet=feet;
    state->vx=vx;state->vy=vy;state->vz=grounded?0:vz;
    state->span=span;state->ceiling=ceiling;state->grounded=grounded;
}

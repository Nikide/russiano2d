#include "re2d_world_mover.h"

#include <math.h>

// Pure C mover timeline: no allocation, no globals, no time source. Every
// result depends only on the struct and the incoming dt.

#define R2D_MOVER_MAX_DT 0.25f

// Internal negative `timer` latches while MOVING (see header).
#define R2D_MOVER_TIMER_START_PENDING (-1.0f)
#define R2D_MOVER_TIMER_BLOCKED (-2.0f)

static bool mover_valid(const R2DWorldMover *m)
{
    if (!m) return false;
    if (m->type < (int)R2D_MOVER_DOOR || m->type > (int)R2D_MOVER_PLATFORM) return false;
    if (!isfinite(m->from) || !isfinite(m->to) || m->from == m->to) return false;
    if (!isfinite(m->speed) || m->speed <= 0.0f) return false;
    if (!isfinite(m->wait) || m->wait < 0.0f) return false;
    return true;
}

static bool at_to(const R2DWorldMover *m)
{
    return (m->to >= m->from) ? (m->position >= m->to) : (m->position <= m->to);
}

static bool at_from(const R2DWorldMover *m)
{
    return (m->to >= m->from) ? (m->position <= m->from) : (m->position >= m->from);
}

static float compute_fraction(const R2DWorldMover *m)
{
    float f = (m->position - m->from) / (m->to - m->from);
    if (!(f > 0.0f)) return 0.0f;   // also catches NaN defensively
    if (f > 1.0f) return 1.0f;
    return f;
}

static void begin_motion(R2DWorldMover *m, int direction)
{
    m->direction = direction;
    m->phase = R2D_MOVER_MOVING;
    m->arrived = false;
    m->timer = R2D_MOVER_TIMER_START_PENDING;
    // A new intent while blocked must not re-emit BLOCKED for the same pause.
    if (m->blocking) m->timer = R2D_MOVER_TIMER_BLOCKED;
}

// Endpoint completion, called once per arrival (phase then leaves MOVING or
// immediately launches the crusher reversal).
static void finish_endpoint(R2DWorldMover *m, unsigned *events)
{
    if (m->direction > 0) {
        *events |= R2D_MOVER_EVENT_ARRIVED;
        m->arrived = true;
        if (m->auto_return) {
            if (m->wait > 0.0f) {
                m->phase = R2D_MOVER_WAITING;
                m->timer = m->wait;
                return;
            }
            if (m->type == (int)R2D_MOVER_CRUSHER) {
                // Reverse immediately, launch on the following tick.
                m->direction = -1;
                m->phase = R2D_MOVER_MOVING;
                m->arrived = false;
                m->timer = R2D_MOVER_TIMER_START_PENDING;
                return;
            }
        }
        m->phase = R2D_MOVER_IDLE;
        m->timer = 0.0f;
        return;
    }

    *events |= R2D_MOVER_EVENT_CLOSED;
    m->arrived = true;
    if (m->auto_return && m->type == (int)R2D_MOVER_CRUSHER) {
        if (m->wait > 0.0f) {
            m->phase = R2D_MOVER_WAITING;
            m->timer = m->wait;
            return;
        }
        m->direction = 1;
        m->phase = R2D_MOVER_MOVING;
        m->arrived = false;
        m->timer = R2D_MOVER_TIMER_START_PENDING;
        return;
    }
    m->phase = R2D_MOVER_IDLE;
    m->timer = 0.0f;
}

bool r2d_world_mover_init(R2DWorldMover *m, int type, int span,
                          float from, float to, float speed, float wait,
                          bool auto_return)
{
    if (!m) return false;
    if (type < (int)R2D_MOVER_DOOR || type > (int)R2D_MOVER_PLATFORM) return false;
    if (span < 0) return false;
    if (!isfinite(from) || !isfinite(to) || from == to) return false;
    if (!isfinite(speed) || speed <= 0.0f) return false;
    if (!isfinite(wait) || wait < 0.0f) return false;

    m->type = type;
    m->span = span;
    m->from = from;
    m->to = to;
    m->speed = speed;
    m->wait = wait;
    m->position = from;
    m->fraction = 0.0f;
    m->phase = R2D_MOVER_IDLE;
    m->direction = 1;
    m->timer = 0.0f;
    m->auto_return = auto_return;
    m->arrived = true;
    m->blocking = false;
    return true;
}

bool r2d_world_mover_step(R2DWorldMover *m, float dt, unsigned *events)
{
    unsigned ev = 0u;
    bool changed = false;

    if (events) *events = 0u;
    if (!mover_valid(m)) return false;

    // Deterministic clamp into [0, 0.25]. NaN behaves as 0; infinities clamp.
    if (isnan(dt)) {
        dt = 0.0f;
    } else if (dt < 0.0f) {
        dt = 0.0f;
    } else if (dt > R2D_MOVER_MAX_DT) {
        dt = R2D_MOVER_MAX_DT;
    }

    // Blocking freezes travelling movers. The event fires once per pause, and
    // a crusher backs away by reversing its travel direction.
    if (m->blocking && m->phase == R2D_MOVER_MOVING) {
        if (m->timer != R2D_MOVER_TIMER_BLOCKED) {
            ev |= R2D_MOVER_EVENT_BLOCKED;
            if (m->type == (int)R2D_MOVER_CRUSHER) m->direction = -m->direction;
            m->timer = R2D_MOVER_TIMER_BLOCKED;
        }
        if (events) *events = ev;
        return false;
    }
    if (!m->blocking && m->phase == R2D_MOVER_MOVING &&
        m->timer == R2D_MOVER_TIMER_BLOCKED) {
        m->timer = R2D_MOVER_TIMER_START_PENDING;   // resumed: STARTED next tick
    }

    // Dwell at an endpoint, then launch the return leg.
    if (m->phase == R2D_MOVER_WAITING) {
        m->timer -= dt;
        if (m->timer > 0.0f) {
            if (events) *events = ev;
            return false;
        }
        m->timer = 0.0f;
        m->direction = at_to(m) ? -1 : 1;
        m->phase = R2D_MOVER_MOVING;
        m->arrived = false;
        ev |= R2D_MOVER_EVENT_STARTED;
        if (events) *events = ev;
        return false;   // launch tick itself moves no distance
    }

    if (m->phase != R2D_MOVER_MOVING) {
        if (events) *events = ev;
        return false;
    }

    // Launch/resume latch: exactly one STARTED per move episode.
    if (m->timer < 0.0f) {
        ev |= R2D_MOVER_EVENT_STARTED;
        if (m->direction > 0 && at_from(m)) ev |= R2D_MOVER_EVENT_REOPENED;
        m->timer = 0.0f;
    }

    // A cancelled opening can already sit at its close endpoint.
    if ((m->direction > 0) ? at_to(m) : at_from(m)) {
        finish_endpoint(m, &ev);
        if (events) *events = ev;
        return false;
    }

    const float distance = m->speed * dt;
    if (distance > 0.0f) {
        float next = m->position;
        if (m->direction > 0) {
            next = m->position + distance;
            if (m->to >= m->from) {
                if (next > m->to) next = m->to;
            } else {
                if (next < m->to) next = m->to;
            }
        } else {
            next = m->position - distance;
            if (m->from >= m->to) {
                if (next > m->from) next = m->from;
            } else {
                if (next < m->from) next = m->from;
            }
        }
        // Hard invariant: never escape the authored interval.
        const float lo = fminf(m->from, m->to);
        const float hi = fmaxf(m->from, m->to);
        if (next < lo) next = lo;
        if (next > hi) next = hi;

        if (next != m->position) {
            m->position = next;
            m->fraction = compute_fraction(m);
            changed = true;
        }

        if ((m->direction > 0) ? at_to(m) : at_from(m)) {
            finish_endpoint(m, &ev);
        }
    }

    if (events) *events = ev;
    return changed;
}

void r2d_world_mover_open(R2DWorldMover *m)
{
    if (!mover_valid(m)) return;
    if (m->phase == R2D_MOVER_MOVING && m->direction > 0) return;
    if (m->phase == R2D_MOVER_IDLE && at_to(m)) return;
    if (m->phase == R2D_MOVER_WAITING && at_to(m)) return;
    begin_motion(m, 1);
}

void r2d_world_mover_close(R2DWorldMover *m)
{
    if (!mover_valid(m)) return;
    if (m->phase == R2D_MOVER_MOVING && m->direction < 0) return;
    if (m->phase == R2D_MOVER_IDLE && at_from(m)) return;
    begin_motion(m, -1);
}

void r2d_world_mover_toggle(R2DWorldMover *m)
{
    if (!mover_valid(m)) return;

    // "Opening" means already moving toward `to`, or parked/waiting at `to`.
    const bool opening =
        (m->phase == R2D_MOVER_MOVING && m->direction > 0) ||
        ((m->phase == R2D_MOVER_IDLE || m->phase == R2D_MOVER_WAITING) && at_to(m));

    // Toggle must also cancel an opening that has not moved yet, so bypass the
    // already-closed no-op of r2d_world_mover_close here.
    begin_motion(m, opening ? -1 : 1);
}

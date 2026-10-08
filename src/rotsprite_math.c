#include "rotsprite_math.h"
#include <math.h>
#include <stddef.h>
#include <string.h>

#define PI 3.14159265358979323846
typedef struct Vec { double x, y, z; } Vec;

bool r2d_rotsprite_layout(int w, int h, int *cell)
{
    if (w != h || w % 8 != 0 || w < 64 || w > 2048) return false;
    if (cell) *cell = w / 8;
    return true;
}

bool r2d_rotsprite_angles(double yaw, double pitch, double *oy, double *op)
{
    if (!isfinite(yaw) || !isfinite(pitch)) return false;
    double y = fmod(yaw, 360.0);
    if (y >= 180) y -= 360;
    if (y < -180) y += 360;
    *oy = y == 0 ? 0 : y;
    *op = fmax(-75, fmin(75, pitch));
    return true;
}

// Обратный поворот: сначала отменяем pitch, затем yaw.
static Vec inverse(Vec p, double cy, double sy, double cp, double sp)
{
    const double y = cp * p.y + sp * p.z;
    const double z = -sp * p.y + cp * p.z;
    return (Vec){cy * p.x - sy * z, y, sy * p.x + cy * z};
}

static Vec point(Vec o, Vec d, double t)
{
    return (Vec){o.x + d.x * t, o.y + d.y * t, o.z + d.z * t};
}

static bool head_hit(Vec o, Vec d, double *t)
{
    const Vec a = {o.x / 14, o.y / 18, o.z / 12};
    const Vec b = {d.x / 14, d.y / 18, d.z / 12};
    const double aa = b.x*b.x + b.y*b.y + b.z*b.z;
    const double bb = a.x*b.x + a.y*b.y + a.z*b.z;
    const double cc = a.x*a.x + a.y*a.y + a.z*a.z - 1;
    const double disc = bb*bb - aa*cc;
    if (disc < 0) return false;
    *t = (-bb - sqrt(disc)) / aa;
    return *t >= 0;
}

// Пересечение выпуклой призмы через полуплоскости, без вершинного меша.
static bool plane(Vec o, Vec d, Vec n, double c, double *lo, double *hi)
{
    const double p = n.x*o.x + n.y*o.y + n.z*o.z - c;
    const double v = n.x*d.x + n.y*d.y + n.z*d.z;
    if (fabs(v) < 1e-12) return p <= 0;
    const double t = -p / v;
    if (v < 0) *lo = fmax(*lo, t); else *hi = fmin(*hi, t);
    return *lo <= *hi;
}

static bool ear_hit(Vec o, Vec d, int side, double *t)
{
    o.x *= side; d.x *= side;
    const double x[3] = {-16, -13, -4}, y[3] = {-9, -27, -12};
    double lo = 0, hi = 200;
    for (int i = 0; i < 3; ++i) {
        const int j = (i + 1) % 3;
        const Vec n = {y[j] - y[i], x[i] - x[j], 0};
        if (!plane(o, d, n, n.x*x[i] + n.y*y[i], &lo, &hi)) return false;
    }
    if (!plane(o, d, (Vec){0,0,1}, 3, &lo, &hi) ||
        !plane(o, d, (Vec){0,0,-1}, 3, &lo, &hi)) return false;
    *t = lo;
    return true;
}

static int texel(double u, int size)
{
    int i = (int)floor(u * size);
    return i < 0 ? 0 : (i >= size ? size - 1 : i);
}

static const uint8_t *sample(const uint8_t *atlas, int stride, int n,
                              Vec p, int part)
{
    int x, y;
    if (part == 0) {
        double u = 0.5 + atan2(p.x / 14, p.z / 12) / (2*PI);
        u -= floor(u);
        const double v = acos(fmax(-1, fmin(1, -p.y / 18))) / PI;
        x = texel(u, 4*n); y = texel(v, 2*n);
    } else {
        const double px = part == 1 ? p.x : -p.x;
        x = (part == 1 ? 4 : 5)*n + texel((px + 16) / 12, n);
        y = (p.z < 0 ? n : 0) + texel((p.y + 27) / 18, n);
    }
    return atlas + (size_t)y * (size_t)stride + (size_t)x * 4;
}

bool r2d_rotsprite_raster(const uint8_t *atlas, int w, int h, int stride,
                          double yaw, double pitch, uint8_t *out)
{
    int n;
    if (!atlas || !out || !r2d_rotsprite_layout(w, h, &n) || stride < w*4 ||
        !r2d_rotsprite_angles(yaw, pitch, &yaw, &pitch)) return false;
    const double a = yaw * PI/180, b = pitch * PI/180;
    const double cy = cos(a), sy = sin(a), cp = cos(b), sp = sin(b);
    const Vec d = inverse((Vec){0,0,-1}, cy,sy,cp,sp);
    memset(out, 0, R2D_ROTSPRITE_SIZE * R2D_ROTSPRITE_SIZE * 4);
    for (int y = 0; y < R2D_ROTSPRITE_SIZE; ++y) {
        for (int x = 0; x < R2D_ROTSPRITE_SIZE; ++x) {
            const Vec o = inverse((Vec){x + 0.5 - 32, y + 0.5 - 32, 100}, cy,sy,cp,sp);
            double nearest = 201;
            const uint8_t *color = NULL;
            for (int part = 0; part < 3; ++part) {
                double t;
                const bool hit = part == 0 ? head_hit(o,d,&t) : ear_hit(o,d,part == 1 ? 1 : -1,&t);
                if (!hit || t >= nearest) continue;
                const uint8_t *c = sample(atlas,stride,n,point(o,d,t),part);
                if (c[3] == 0) continue;
                color = c; nearest = t;
            }
            if (color) memcpy(out + (y * R2D_ROTSPRITE_SIZE + x)*4, color, 4);
        }
    }
    return true;
}

#include <stdlib.h>

bool r2d_rotsprite_v2_header(const uint8_t *a,int w,int h,int stride)
{
    if (!a || w!=h || w<1024 || w>4096 || w%1024 || stride<w*4) return false;
    int k=w/1024;
    const uint8_t *p=a+(size_t)(h*15/16)*stride;
    return !memcmp(p,"R2D",3) && !memcmp(p+k*4,"ROT",3) && p[k*8]==2 && p[k*8+1]==4 && p[k*8+2]==4;
}

// Pick an existing palette texel representative of the source footprint.
// A lone top-left outline texel must not become a whole thick output stripe.
static const uint8_t *representative(const uint8_t *a,int stride,int k,int x,int y)
{
    const uint8_t *samples[16]; int n=0,sum[3]={0};
    for (int dy=0;dy<4;dy++) for (int dx=0;dx<4;dx++) {
        const uint8_t *c=a+(size_t)(y*4+dy)*k*stride+(x*4+dx)*k*4;
        if (c[3]!=255) continue;
        samples[n++]=c;for (int j=0;j<3;j++) sum[j]+=c[j];
    }
    if (!n) return a+(size_t)y*4*k*stride+x*4*k*4;
    const uint8_t *best=samples[0];long score=0x7fffffff;
    for (int i=0;i<n;i++) {
        long d=0;for (int j=0;j<3;j++) {long v=samples[i][j]*n-sum[j];d+=v*v;}
        if (d<score) {score=d;best=samples[i];}
    }
    return best;
}

static const uint8_t *feature_sample(const uint8_t *a,int stride,int k,int x,int y)
{
    const uint8_t *best=a+(size_t)y*4*k*stride+x*4*k*4;int distance=100;
    for (int dy=0;dy<4;dy++) for (int dx=0;dx<4;dx++) {
        const uint8_t *c=a+(size_t)(y*4+dy)*k*stride+(x*4+dx)*k*4;
        int d=(dx-2)*(dx-2)+(dy-2)*(dy-2);
        if (c[3]==255 && d<distance) {distance=d;best=c;}
    }
    return best;
}

bool r2d_rotsprite_v2_decode(const uint8_t *a,int w,int h,int stride,R2DRotAtlas *out)
{
    if (!out || !r2d_rotsprite_v2_header(a,w,h,stride)) return false;
    R2DRotAtlas decoded={0};
    decoded.points=malloc(256*192*sizeof *decoded.points);
    if (!decoded.points) return false;
    int k=w/1024;
    for (int y=0;y<192;y++) for (int x=0;x<256;x++) {
        const uint8_t *id=a+(size_t)(768+y)*k*stride+x*k*4;
        const uint8_t *occ=id+512*k*4;
        if (!occ[0] || !occ[3]) continue;
        int part=id[0];
        if (part<1 || part>254) {
            free(decoded.points); return false;
        }
        const uint8_t *z=id+256*k*4, *xy=id+768*k*4;
        const uint8_t *c=a+(size_t)(y*4)*k*stride+x*4*k*4;
        if (occ[0]!=255 || occ[3]!=255 || id[3]!=255 || z[3]!=255 || xy[3]!=255 || c[3]!=255) { free(decoded.points); return false; }
        R2DRotPoint *p=&decoded.points[decoded.count++];
        memset(p,0,sizeof *p);
        p->x=(xy[0]-128)*.25f; p->y=(xy[1]-128)*.5f; p->z=(z[0]-128)*.25f;
        p->part=(uint8_t)part; memcpy(p->rgba,part<16 ? representative(a,stride,k,x,y) : feature_sample(a,stride,k,x,y),4);
    }
    if (!decoded.count) { free(decoded.points); return false; }
    *out=decoded;
    return true;
}

// Interpolate only within one continuous material patch, never across part seams.
bool r2d_rotsprite_v2_decode_anime(const uint8_t *a,int w,int h,int stride,R2DRotAtlas *out)
{
    R2DRotAtlas base={0};
    if (!out || !r2d_rotsprite_v2_decode(a,w,h,stride,&base)) return false;
    int *grid=malloc(256*192*sizeof *grid);
    R2DRotAtlas dense={.points=malloc((size_t)base.count*sizeof *dense.points)};
    if (!grid || !dense.points) { free(grid);free(dense.points);r2d_rotsprite_v2_free(&base);return false; }
    for (int i=0;i<256*192;i++) grid[i]=-1;
    int k=w/1024,n=0;
    for (int y=0;y<192;y++) for (int x=0;x<256;x++) {
        const uint8_t *id=a+(size_t)(768+y)*k*stride+x*k*4;
        if (id[512*k*4] && id[512*k*4+3]) grid[y*256+x]=n++;
    }
    for (int y=0;y<192;y++) for (int x=0;x<256;x++) {
        int id=grid[y*256+x];if (id<0) continue;
        const R2DRotPoint *p=&base.points[id];
        int right=x<255 ? grid[y*256+x+1] : -1;
        int down=y<191 ? grid[(y+1)*256+x] : -1;
        int diagonal=x<255 && y<191 ? grid[(y+1)*256+x+1] : -1;
        bool continuous=right>=0 && down>=0 && diagonal>=0;
        int indices[]={id,right,down,diagonal};
        if (continuous) for (int j=1;j<4;j++) {
            const R2DRotPoint *q=&base.points[indices[j]];
            if (p->part!=q->part || fabs(q->x-p->x)>3 || fabs(q->y-p->y)>3 || fabs(q->z-p->z)>3) continuous=false;
        }
        for (int dy=0;dy<1;dy++) for (int dx=0;dx<1;dx++) {
            R2DRotPoint *q=&dense.points[dense.count++];*q=*p;
            if (continuous) {
                float u=dx*.5f,v=dy*.5f,weights[]={(1-u)*(1-v),u*(1-v),(1-u)*v,u*v};
                q->x=q->y=q->z=0;
                for (int j=0;j<4;j++) {const R2DRotPoint *t=&base.points[indices[j]];q->x+=t->x*weights[j];q->y+=t->y*weights[j];q->z+=t->z*weights[j];}
            }
            if (continuous) {
                const R2DRotPoint *r=&base.points[right],*d=&base.points[down],*b=&base.points[diagonal];
                float u=dx*.5f,v=dy*.5f;
                q->patch=true;
                q->du[0]=((r->x-p->x)*(1-v)+(b->x-d->x)*v);
                q->du[1]=((r->y-p->y)*(1-v)+(b->y-d->y)*v);
                q->du[2]=((r->z-p->z)*(1-v)+(b->z-d->z)*v);
                q->dv[0]=((d->x-p->x)*(1-u)+(b->x-r->x)*u);
                q->dv[1]=((d->y-p->y)*(1-u)+(b->y-r->y)*u);
                q->dv[2]=((d->z-p->z)*(1-u)+(b->z-r->z)*u);
                q->duv[0]=(b->x-r->x-d->x+p->x);
                q->duv[1]=(b->y-r->y-d->y+p->y);
                q->duv[2]=(b->z-r->z-d->z+p->z);
            }
            // Area-average the actual high-resolution material, without palette quantization.
            {
                int sum[3]={0},count=0;
                for (int yy=0;yy<2*k;yy++) for (int xx=0;xx<2*k;xx++) {
                    const uint8_t *c=a+(size_t)((y*4+dy*2)*k+yy)*stride+((x*4+dx*2)*k+xx)*4;
                    if (c[3]!=255) continue;
                    for (int j=0;j<3;j++) sum[j]+=c[j];count++;
                }
                if (count) for (int j=0;j<3;j++) q->rgba[j]=(uint8_t)((sum[j]+count/2)/count);
            }
            if (!continuous && p->part>=32 && right>=0) {
                const R2DRotPoint *r=&base.points[right];
                if (r->part==p->part && fabs(r->x-p->x)<3 && fabs(r->y-p->y)<1 && fabs(r->z-p->z)<3) {
                    q->patch=true;q->du[0]=r->x-p->x;q->du[1]=r->y-p->y;q->du[2]=r->z-p->z;q->dv[1]=.24f;
                }
            }
            for (int j=0;j<4;j++) {
                const uint8_t *c=a+(size_t)(y*4+dy*2+(j/2)*4)*k*stride+(x*4+dx*2+(j%2)*4)*k*4;
                memcpy(q->colors[j],c[3]==255 ? c : q->rgba,4);
            }
        }
    }
    free(grid);r2d_rotsprite_v2_free(&base);*out=dense;return true;
}

void r2d_rotsprite_v2_free(R2DRotAtlas *a)
{
    if (!a) return;
    free(a->points); a->points=NULL; a->count=0;
}

static void transform_point(const R2DRotPoint *p,const R2DRotRig *rig,double *ox,double *oy,double *oz)
{
    if (rig && rig->model) {
        const double *m=rig->model->parts[p->part].matrix;
        *ox=m[0]*p->x+m[1]*p->y+m[2]*p->z+m[3];
        *oy=m[4]*p->x+m[5]*p->y+m[6]*p->z+m[7];
        *oz=m[8]*p->x+m[9]*p->y+m[10]*p->z+m[11];
        return;
    }
    bool head=p->part<=3 || p->part==5 || p->part>=16;

        double X=p->x,Y=p->y,Z=p->z;
        if (rig && rig->body) {
            if (head) {
                double c=cos(rig->head_yaw*PI/180),s=sin(rig->head_yaw*PI/180);
                double hx=c*X+s*Z; Z=(-s*X+c*Z)*.8; X=hx*.8; Y=Y*.8-22;
            } else {
                double swing=sin(rig->phase)*rig->stride*PI/180, angle=0, pivot=0;
                bool left=p->part==8 || p->part==13;
                if (left || p->part==12 || p->part==14) {angle=left ? swing : -swing; pivot=20;}
                if (p->part==7 || p->part==11) {angle=p->part==7 ? -swing : swing; pivot=-10;}
                if ((left || p->part==12 || p->part==14) && Y>36) {
                    double knee=fmax(0,sin(rig->phase+(left ? 0 : PI)))*fabs(rig->stride)*.65*PI/180;
                    double d=Y-36; Y=36+cos(knee)*d-sin(knee)*Z; Z=sin(knee)*d+cos(knee)*Z;
                }
                double d=Y-pivot; Y=pivot+cos(angle)*d-sin(angle)*Z; Z=sin(angle)*d+cos(angle)*Z;
                if (p->part==7 || p->part==11) {
                    double az=(p->part==7 ? rig->arm_left : rig->arm_right)*PI/180;
                    double anchor=p->part==7 ? -9.5 : 9.5, dx=X-anchor,dy=Y+10;
                    X=anchor+cos(az)*dx-sin(az)*dy; Y=-10+sin(az)*dx+cos(az)*dy;
                }
            }
        }
    *ox=X;*oy=Y;*oz=Z;
}

// Facial decals are one-sided. Their approximate surface normal rotates with
// the independent head joint, body yaw and pitch, so the far eye disappears.
static bool face_visible(const R2DRotPoint *p,double yaw,double pitch,const R2DRotRig *rig)
{
    if (rig && rig->model) {
        const R2DRotPartPose *part=&rig->model->parts[p->part];
        if (!part->one_sided) return true;
        const double *m=part->matrix;
        double u[3],v[3];
        for (int j=0;j<3;j++) {
            u[j]=p->patch ? p->du[j]+.5*p->duv[j] : (j==0);
            v[j]=p->patch ? p->dv[j]+.5*p->duv[j] : (j==1);
        }
        double a[3],b[3];
        for (int j=0;j<3;j++) {
            a[j]=m[j*4]*u[0]+m[j*4+1]*u[1]+m[j*4+2]*u[2];
            b[j]=m[j*4]*v[0]+m[j*4+1]*v[1]+m[j*4+2]*v[2];
        }
        double nx=a[1]*b[2]-a[2]*b[1],ny=a[2]*b[0]-a[0]*b[2],nz=a[0]*b[1]-a[1]*b[0];
        double length=sqrt(nx*nx+ny*ny+nz*nz);
        if (length<1e-8) return true;
        double y=yaw*PI/180,pt=pitch*PI/180;
        return (cos(pt)*(-sin(y)*nx+cos(y)*nz)+sin(pt)*ny)/length>.02;
    }
    if (p->part<16) return true;
    double angle=(yaw+(rig && rig->body ? rig->head_yaw : 0))*PI/180;
    double nx=p->x/14.0,nz=p->z/12.0,ny=p->y/19.0;
    if (p->patch) {
        double u[3],v[3];for (int j=0;j<3;j++) {u[j]=p->du[j]+.5*p->duv[j];v[j]=p->dv[j]+.5*p->duv[j];}
        double x=u[1]*v[2]-u[2]*v[1],y=u[2]*v[0]-u[0]*v[2],z=u[0]*v[1]-u[1]*v[0];
        double length=sqrt(x*x+y*y+z*z);
        if (length>1e-8) {nx=x/length;ny=y/length;nz=z/length;}
    }
    double facing=cos(pitch*PI/180)*(-sin(angle)*nx+cos(angle)*nz)+sin(pitch*PI/180)*ny;
    return facing>.02;
}

void r2d_rotsprite_v2_joint(int part,double x,double y,double z,double yaw,double pitch,const R2DRotRig *rig,double *ox,double *oy)
{
    R2DRotPoint p={.x=(float)x,.y=(float)y,.z=(float)z,.part=(uint8_t)part};
    double X,Y,Z;transform_point(&p,rig,&X,&Y,&Z);
    double cy=cos(yaw*PI/180),sy=sin(yaw*PI/180),cp=cos(pitch*PI/180),sp=sin(pitch*PI/180);
    double zz=-sy*X+cy*Z,scale=rig && rig->body ? 1 : 2;
    *ox=64+(cy*X+sy*Z)*scale;*oy=64+(cp*Y-sp*zz)*scale;
}

bool r2d_rotsprite_v2_draw(const R2DRotAtlas *a,double yaw,double pitch,int eyes,int mouth,const R2DRotRig *rig,uint8_t *out)
{
    if (!a || !a->points || !out || eyes<0 || eyes>3 || mouth<0 || mouth>3 ||
        !r2d_rotsprite_angles(yaw,pitch,&yaw,&pitch) || (rig && (rig->brows<0 || rig->brows>3 ||
        !isfinite(rig->phase) || !isfinite(rig->stride) || !isfinite(rig->arm_left) || !isfinite(rig->arm_right) || !isfinite(rig->head_yaw)))) return false;
    float depth[128*128], distance[128*128];
    for (int i=0;i<128*128;i++) { depth[i]=-1e9f; distance[i]=1e9f; }
    memset(out,0,128*128*4);
    double cy=cos(yaw*PI/180),sy=sin(yaw*PI/180),cp=cos(pitch*PI/180),sp=sin(pitch*PI/180);
    for (int i=0;i<a->count;i++) {
        const R2DRotPoint *p=&a->points[i];
        if (!face_visible(p,yaw,pitch,rig)) continue;
        if (rig && rig->model) {
            const R2DRotPartPose *part=&rig->model->parts[p->part];
            if (!part->defined || !part->visible) continue;
            int selected=part->selector==1 ? eyes : part->selector==2 ? mouth : rig->brows;
            if (part->selector && part->variant!=selected) continue;
        } else {
        if (p->part>=16 && p->part<=19 && p->part!=16+eyes) continue;
        if (p->part>=32 && p->part<=35 && p->part!=32+mouth) continue;
        if (p->part>=48 && p->part<=51 && p->part!=48+(rig ? rig->brows : 0)) continue;
        bool head=p->part<=3 || p->part==5 || p->part>=16;
        if (!head && (!rig || !rig->body)) continue;
        }
        double X,Y,Z;transform_point(p,rig,&X,&Y,&Z);
        double scale=rig && rig->model ? rig->model->scale : rig && rig->body ? 1 : 2;
        double xx=cy*X+sy*Z, zz=-sy*X+cy*Z;
        double yy=cp*Y-sp*zz, z=sp*Y+cp*zz;
        int x=(int)floor(xx*scale+64),y=(int)floor(yy*scale+64);
        // Dense sampled surfaces splat a source footprint; no interpolated colors.
        for (int dy=0;dy<=1;dy++) for (int dx=0;dx<=1;dx++) {
            int tx=x+dx,ty=y+dy;
            if (tx<0 || tx>=128 || ty<0 || ty>=128) continue;
            int n=ty*128+tx;
            double dd=(tx+.5-(xx*scale+64))*(tx+.5-(xx*scale+64))+(ty+.5-(yy*scale+64))*(ty+.5-(yy*scale+64));
            if (z<depth[n]-.001) continue;
            if (fabs(z-depth[n])<=.001) {
                if (dd>distance[n]+1e-6) continue;
                // Stable texel tie-break makes replacement/reload independent of storage order.
                if (fabs(dd-distance[n])<=1e-6) {
                    const uint8_t *old=out+n*4;
                    int light=54*p->rgba[0]+183*p->rgba[1]+19*p->rgba[2];
                    int previous=54*old[0]+183*old[1]+19*old[2];
                    if (light<previous || (light==previous && memcmp(p->rgba,old,4)>=0)) continue;
                }
            }
            distance[n]=(float)dd; depth[n]=(float)z; memcpy(out+n*4,p->rgba,4);
        }
    }
    return true;
}

bool r2d_rotsprite_v2_raster(const R2DRotAtlas *a,double yaw,double pitch,int eyes,int mouth,uint8_t *out)
{
    return r2d_rotsprite_v2_draw(a,yaw,pitch,eyes,mouth,NULL,out);
}

typedef struct RotVertex {double x,y,z; uint8_t rgba[4];} RotVertex;
static double edge(const RotVertex *a,const RotVertex *b,double x,double y)
{return (x-a->x)*(b->y-a->y)-(y-a->y)*(b->x-a->x);}
static void anime_triangle(const RotVertex *a,const RotVertex *b,const RotVertex *c,float *depth,uint8_t *rgba,int bounds[4])
{
    double area=edge(a,b,c->x,c->y);if (fabs(area)<1e-8) return;
    int x0=(int)fmax(0,floor(fmin(a->x,fmin(b->x,c->x)))),x1=(int)fmin(511,ceil(fmax(a->x,fmax(b->x,c->x))));
    int y0=(int)fmax(0,floor(fmin(a->y,fmin(b->y,c->y)))),y1=(int)fmin(511,ceil(fmax(a->y,fmax(b->y,c->y))));
    if(x0>x1||y0>y1)return;
    if(x0<bounds[0])bounds[0]=x0;if(y0<bounds[1])bounds[1]=y0;
    if(x1+1>bounds[2])bounds[2]=x1+1;if(y1+1>bounds[3])bounds[3]=y1+1;
    for (int y=y0;y<=y1;y++) for (int x=x0;x<=x1;x++) {
        double u=edge(b,c,x+.5,y+.5)/area,v=edge(c,a,x+.5,y+.5)/area,w=1-u-v;
        if (u< -1e-7 || v< -1e-7 || w< -1e-7) continue;
        double z=u*a->z+v*b->z+w*c->z;int n=y*512+x;
        if (z<depth[n]-.001) continue;
        uint8_t color[4];for (int j=0;j<4;j++) color[j]=(uint8_t)fmax(0,fmin(255,round(u*a->rgba[j]+v*b->rgba[j]+w*c->rgba[j])));
        if (fabs(z-depth[n])<=.001) {
            uint8_t *old=rgba+n*4;
            int light=54*color[0]+183*color[1]+19*color[2],previous=54*old[0]+183*old[1]+19*old[2];
            if (light<previous || (light==previous && memcmp(color,old,4)>=0)) continue;
        }
        depth[n]=(float)z;memcpy(rgba+n*4,color,4);
    }
}

// Supersampled round surface footprints keep fractional rotations and soft silhouettes.
// This produces an ordinary 2D RGBA sprite; no scene mesh or 3D renderer is introduced.
bool r2d_rotsprite_v2_anime_workspace(const R2DRotAtlas *a,double yaw,double pitch,int eyes,int mouth,const R2DRotRig *rig,uint8_t *out,R2DRotAnimeWorkspace *workspace)
{
    if (!a || !a->points || !out || eyes<0 || eyes>3 || mouth<0 || mouth>3 ||
        !r2d_rotsprite_angles(yaw,pitch,&yaw,&pitch) || (rig && (rig->brows<0 || rig->brows>3 ||
        !isfinite(rig->phase) || !isfinite(rig->stride) || !isfinite(rig->arm_left) || !isfinite(rig->arm_right) || !isfinite(rig->head_yaw)))) return false;
    enum { N=512 };
    if(!workspace)return false;
    if(!workspace->depth) {
        workspace->depth=malloc(N*N*sizeof(float));workspace->distance=malloc(N*N*sizeof(float));
        workspace->rgba=malloc(N*N*4);workspace->resolved=malloc(256*256*4);
        if(!workspace->depth||!workspace->distance||!workspace->rgba||!workspace->resolved) {r2d_rotsprite_anime_workspace_free(workspace);return false;}
        workspace->bounds[0]=workspace->bounds[1]=0;workspace->bounds[2]=workspace->bounds[3]=N;
    }
    float *depth=workspace->depth,*distance=workspace->distance;uint8_t *rgba=workspace->rgba;
    // Every previously touched supersample is restored before reusing scratch.
    for(int y=workspace->bounds[1];y<workspace->bounds[3];y++) {
        int x0=workspace->bounds[0],x1=workspace->bounds[2];
        for(int x=x0;x<x1;x++){depth[y*N+x]=-1e9f;distance[y*N+x]=1e9f;}
        memset(rgba+(y*N+x0)*4,0,(size_t)(x1-x0)*4);
    }
    int bounds[4]={N,N,0,0};
    double cy=cos(yaw*PI/180),sy=sin(yaw*PI/180),cp=cos(pitch*PI/180),sp=sin(pitch*PI/180);
    double projected[256][12];
    if(rig && rig->model)for(int id=1;id<255;id++) {
        const R2DRotPartPose *part=&rig->model->parts[id];if(!part->defined||!part->visible)continue;
        const double *m=part->matrix;double scale=rig->model->scale*4;
        for(int j=0;j<4;j++) {
            double z=-sy*m[j]+cy*m[8+j];
            projected[id][j]=(cy*m[j]+sy*m[8+j])*scale;
            projected[id][4+j]=(cp*m[4+j]-sp*z)*scale;
            projected[id][8+j]=sp*m[4+j]+cp*z;
        }
    }
    for (int i=0;i<a->count;i++) {
        const R2DRotPoint *p=&a->points[i];
        if (rig && rig->model) {
            const R2DRotPartPose *part=&rig->model->parts[p->part];
            if (!part->defined || !part->visible) continue;
            int selected=part->selector==1 ? eyes : part->selector==2 ? mouth : rig->brows;
            if (part->selector && part->variant!=selected) continue;
        } else {
        if (p->part>=16 && p->part<=19 && p->part!=16+eyes) continue;
        if (p->part>=32 && p->part<=35 && p->part!=32+mouth) continue;
        if (p->part>=48 && p->part<=51 && p->part!=48+(rig ? rig->brows : 0)) continue;
        bool head=p->part<=3 || p->part==5 || p->part>=16;
        if (!head && (!rig || !rig->body)) continue;
        }
        if (rig && rig->model) {
            const R2DRotPartPose *part=&rig->model->parts[p->part];
            if(part->one_sided) {
                const double *m=part->matrix;double u[3],v[3],a[3],b[3];
                for(int j=0;j<3;j++){u[j]=p->patch?p->du[j]+.5*p->duv[j]:(j==0);v[j]=p->patch?p->dv[j]+.5*p->duv[j]:(j==1);}
                for(int j=0;j<3;j++){a[j]=m[j*4]*u[0]+m[j*4+1]*u[1]+m[j*4+2]*u[2];b[j]=m[j*4]*v[0]+m[j*4+1]*v[1]+m[j*4+2]*v[2];}
                double nx=a[1]*b[2]-a[2]*b[1],ny=a[2]*b[0]-a[0]*b[2],nz=a[0]*b[1]-a[1]*b[0],len=sqrt(nx*nx+ny*ny+nz*nz);
                if(len>=1e-8 && (cp*(-sy*nx+cy*nz)+sp*ny)/len<=.02)continue;
            }
        } else if(!face_visible(p,yaw,pitch,rig))continue;
        if (p->patch) {
            RotVertex vertices[4];
            for (int j=0;j<4;j++) {
                R2DRotPoint corner=*p;int u=j%2,v=j/2;
                corner.x+=u*p->du[0]+v*p->dv[0]+u*v*p->duv[0];corner.y+=u*p->du[1]+v*p->dv[1]+u*v*p->duv[1];corner.z+=u*p->du[2]+v*p->dv[2]+u*v*p->duv[2];
                if(rig && rig->model) {
                    const double *m=projected[p->part];double v[3];
                    for(int row=0;row<3;row++)v[row]=m[row*4]*corner.x+m[row*4+1]*corner.y+m[row*4+2]*corner.z+m[row*4+3];
                    vertices[j]=(RotVertex){.x=256+v[0],.y=256+v[1],.z=v[2]};
                } else {
                    double X,Y,Z;transform_point(&corner,rig,&X,&Y,&Z);
                    double scale=rig && rig->body ? 4 : 8,zz=-sy*X+cy*Z;
                    vertices[j]=(RotVertex){.x=256+(cy*X+sy*Z)*scale,.y=256+(cp*Y-sp*zz)*scale,.z=sp*Y+cp*zz};
                }
                memcpy(vertices[j].rgba,p->colors[j],4);
            }
            anime_triangle(&vertices[0],&vertices[1],&vertices[2],depth,rgba,bounds);
            anime_triangle(&vertices[1],&vertices[3],&vertices[2],depth,rgba,bounds);
            continue;
        }
        if ((!rig || !rig->model) && (p->part==2 || p->part==3)) continue; // Isolated ear/hair border samples must not become floating dots.
        double sx,syy,z;
        if(rig && rig->model) {
            const double *m=projected[p->part];double v[3];
            for(int row=0;row<3;row++)v[row]=m[row*4]*p->x+m[row*4+1]*p->y+m[row*4+2]*p->z+m[row*4+3];
            sx=256+v[0];syy=256+v[1];z=v[2];
        } else {
            double X,Y,Z;transform_point(p,rig,&X,&Y,&Z);
            double scale=rig && rig->body ? 4 : 8,zz=-sy*X+cy*Z;
            sx=256+(cy*X+sy*Z)*scale;syy=256+(cp*Y-sp*zz)*scale;z=sp*Y+cp*zz;
        }
        double radius=p->part>=32 && p->part<=35 ? 1.2 : p->part>=16 ? 2.7 : 3.2;
        int loX=(int)floor(sx-radius),hiX=(int)ceil(sx+radius),loY=(int)floor(syy-radius),hiY=(int)ceil(syy+radius);
        int bx0=loX<0?0:loX,by0=loY<0?0:loY,bx1=hiX>=N?N:hiX+1,by1=hiY>=N?N:hiY+1;
        if(bx0<bx1&&by0<by1){
            if(bx0<bounds[0])bounds[0]=bx0;if(by0<bounds[1])bounds[1]=by0;
            if(bx1>bounds[2])bounds[2]=bx1;if(by1>bounds[3])bounds[3]=by1;
        }
        for (int y=loY;y<=hiY;y++) for (int x=loX;x<=hiX;x++) {
            if (x<0 || y<0 || x>=N || y>=N) continue;
            double d=(x+.5-sx)*(x+.5-sx)+(y+.5-syy)*(y+.5-syy);
            if (d>radius*radius) continue;
            int n=y*N+x;
            if (z<depth[n]-.001) continue;
            if (fabs(z-depth[n])<=.001) {
                if (d>distance[n]+1e-6) continue;
                if (fabs(d-distance[n])<=1e-6) {
                    const uint8_t *old=rgba+n*4;
                    int light=54*p->rgba[0]+183*p->rgba[1]+19*p->rgba[2],previous=54*old[0]+183*old[1]+19*old[2];
                    if (light<previous || (light==previous && memcmp(p->rgba,old,4)>=0)) continue;
                }
            }
            depth[n]=(float)z;distance[n]=(float)d;memcpy(rgba+n*4,p->rgba,4);
        }
    }
    memcpy(workspace->bounds,bounds,sizeof bounds);memset(out,0,256*256*4);
    int x0=bounds[0]/2,y0=bounds[1]/2,x1=(bounds[2]+1)/2,y1=(bounds[3]+1)/2;
    // Resolve the covered region at the SAME 512 -> 256 quality as before.
    for (int y=y0;y<y1;y++) for (int x=x0;x<x1;x++) {
        unsigned sum[3]={0},alpha=0;
        for (int dy=0;dy<2;dy++) for (int dx=0;dx<2;dx++) {
            const uint8_t *p=rgba+((y*2+dy)*N+x*2+dx)*4;
            alpha+=p[3];for (int j=0;j<3;j++) sum[j]+=p[j]*p[3];
        }
        uint8_t *p=out+(y*256+x)*4;
        for (int j=0;j<3;j++) p[j]=alpha ? (uint8_t)((sum[j]+alpha/2)/alpha) : 0;
        p[3]=(uint8_t)((alpha+2)/4);
    }
    // Extrude color under transparent neighbors for straight-alpha linear sampling.
    // Otherwise a zero-RGB transparent texel adds a dark fringe to pale anime edges.
    memcpy(workspace->resolved,out,256*256*4);
    if(x0>0)x0--;if(y0>0)y0--;if(x1<256)x1++;if(y1<256)y1++;
    for (int y=y0;y<y1;y++) for (int x=x0;x<x1;x++) {
        uint8_t *p=out+(y*256+x)*4;if (p[3]) continue;
        const uint8_t *best=NULL;
        for (int dy=-1;dy<=1;dy++) for (int dx=-1;dx<=1;dx++) {
            int sx=x+dx,sy=y+dy;if (sx<0 || sy<0 || sx>=256 || sy>=256) continue;
            const uint8_t *q=workspace->resolved+(sy*256+sx)*4;
            if (q[3] && (!best || q[3]>best[3])) best=q;
        }
        if (best) memcpy(p,best,3);
    }
    return true;
}

void r2d_rotsprite_anime_workspace_free(R2DRotAnimeWorkspace *w)
{if(!w)return;free(w->depth);free(w->distance);free(w->rgba);free(w->resolved);memset(w,0,sizeof *w);}
bool r2d_rotsprite_v2_anime(const R2DRotAtlas *a,double yaw,double pitch,int eyes,int mouth,const R2DRotRig *rig,uint8_t *out)
{R2DRotAnimeWorkspace w={0};bool ok=r2d_rotsprite_v2_anime_workspace(a,yaw,pitch,eyes,mouth,rig,out,&w);r2d_rotsprite_anime_workspace_free(&w);return ok;}

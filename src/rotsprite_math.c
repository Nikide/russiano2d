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
    const uint8_t *extension=a+(size_t)960*k*stride+3*k*4;
    bool subpixel=extension[0]==83 && extension[1]==85 && extension[2]==66 && extension[3]==255;
    const uint8_t *blending=extension+k*4;
    bool blended=subpixel && blending[0]==66 && blending[1]==76 && blending[2]==68 && blending[3]==255;
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
        if ((occ[0]!=255 && !(subpixel && occ[0]==128)) || occ[3]!=255 || id[3]!=255 || z[3]!=255 || xy[3]!=255 || (c[3]!=255 && !(subpixel && c[3]==0))) { free(decoded.points); return false; }
        R2DRotPoint *p=&decoded.points[decoded.count++];
        memset(p,0,sizeof *p);
        p->x=(xy[0]-128)*.25f; p->y=(xy[1]-128)*.5f; p->z=(z[0]-128)*.25f;
        if(subpixel){p->x+=(xy[2]>>4)/64.0f;p->y+=(xy[2]&15)/32.0f;p->z+=(z[1]/17)/64.0f;}
        if(blended){
            if(id[2]==255 || (!id[2] && z[2])){free(decoded.points);return false;}
            p->blend_part=id[2];p->blend_weight=z[2];
        }
        p->mapped=subpixel;p->group=subpixel && id[1] ? id[1] : part;
        p->part=(uint8_t)part; memcpy(p->rgba,part<16 ? representative(a,stride,k,x,y) : feature_sample(a,stride,k,x,y),4);
        if(subpixel)p->rgba[3]=c[3];
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
            if (p->group!=q->group || fabs(q->x-p->x)>3 || fabs(q->y-p->y)>3 || fabs(q->z-p->z)>3) continuous=false;
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
            if (continuous) {
                q->textured=true;
                for(int c=0;c<4;c++){
                    const R2DRotPoint *corner=&base.points[indices[c]];
                    q->corner_parts[c]=corner->part;q->corner_blend_parts[c]=corner->blend_part;q->corner_blend_weights[c]=corner->blend_weight;
                }
                for(int ty=0;ty<5;ty++) for(int tx=0;tx<5;tx++) {
                    const uint8_t *c=a+(size_t)(y*4+ty)*k*stride+(x*4+tx)*k*4;
                    memcpy(q->material+(ty*5+tx)*4,c,4);
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

// Blend rigid warp transforms without shrinking their rotation axes. Ordinary
// matrix interpolation loses 29% of joint thickness at a 90-degree bend.
static bool rigid_dual(const double m[12],double q[4],double d[4])
{
    for(int i=0;i<3;i++)for(int j=i;j<3;j++){
        double dot=0;for(int k=0;k<3;k++)dot+=m[k*4+i]*m[k*4+j];
        if(fabs(dot-(i==j ? 1 : 0))>1e-5)return false;
    }
    double det=m[0]*(m[5]*m[10]-m[6]*m[9])-m[1]*(m[4]*m[10]-m[6]*m[8])+m[2]*(m[4]*m[9]-m[5]*m[8]);
    if(det<0)return false;
    double trace=m[0]+m[5]+m[10];
    if(trace>0){double s=sqrt(trace+1)*2;q[3]=s*.25;q[0]=(m[9]-m[6])/s;q[1]=(m[2]-m[8])/s;q[2]=(m[4]-m[1])/s;}
    else {
        int i=m[5]>m[0]?1:0;if(m[10]>m[i*5])i=2;int j=(i+1)%3,k=(i+2)%3;
        double s=sqrt(fmax(0,1+m[i*5]-m[j*5]-m[k*5]))*2;if(s<1e-12)return false;
        q[i]=s*.25;q[j]=(m[j*4+i]+m[i*4+j])/s;q[k]=(m[k*4+i]+m[i*4+k])/s;q[3]=(m[k*4+j]-m[j*4+k])/s;
    }
    double x=m[3],y=m[7],z=m[11];
    d[0]=.5*(x*q[3]+y*q[2]-z*q[1]);d[1]=.5*(-x*q[2]+y*q[3]+z*q[0]);
    d[2]=.5*(x*q[1]-y*q[0]+z*q[3]);d[3]=-.5*(x*q[0]+y*q[1]+z*q[2]);
    return true;
}
static void model_point(const R2DRotPoint *p,const R2DRotModelPose *model,double out[3])
{
    const double *a=model->parts[p->part].matrix;
    for(int i=0;i<3;i++)out[i]=a[i*4]*p->x+a[i*4+1]*p->y+a[i*4+2]*p->z+a[i*4+3];
    if(!p->blend_part || !p->blend_weight || !model->parts[p->blend_part].defined)return;
    const double *b=model->parts[p->blend_part].matrix;double w=p->blend_weight/255.0;
    double qa[4],qb[4],da[4],db[4];
    if(!rigid_dual(a,qa,da) || !rigid_dual(b,qb,db)){
        // Preserve arbitrary affine/scaled models rather than stripping their scale.
        for(int i=0;i<3;i++)out[i]=out[i]*(1-w)+w*(b[i*4]*p->x+b[i*4+1]*p->y+b[i*4+2]*p->z+b[i*4+3]);
        return;
    }
    double dot=0;for(int i=0;i<4;i++)dot+=qa[i]*qb[i];double sign=dot<0?-1:1,q[4],d[4],norm=0;
    for(int i=0;i<4;i++){q[i]=(1-w)*qa[i]+w*sign*qb[i];d[i]=(1-w)*da[i]+w*sign*db[i];norm+=q[i]*q[i];}
    norm=sqrt(norm);if(norm<1e-12)return;
    for(int i=0;i<4;i++){q[i]/=norm;d[i]/=norm;}
    double tx=2*(q[1]*p->z-q[2]*p->y),ty=2*(q[2]*p->x-q[0]*p->z),tz=2*(q[0]*p->y-q[1]*p->x);
    out[0]=p->x+q[3]*tx+q[1]*tz-q[2]*ty+2*(-d[3]*q[0]+d[0]*q[3]-d[1]*q[2]+d[2]*q[1]);
    out[1]=p->y+q[3]*ty+q[2]*tx-q[0]*tz+2*(-d[3]*q[1]+d[0]*q[2]+d[1]*q[3]-d[2]*q[0]);
    out[2]=p->z+q[3]*tz+q[0]*ty-q[1]*tx+2*(-d[3]*q[2]-d[0]*q[1]+d[1]*q[0]+d[2]*q[3]);
}

static void transform_point(const R2DRotPoint *p,const R2DRotRig *rig,double *ox,double *oy,double *oz)
{
    if (rig && rig->model) {
        double out[3];model_point(p,rig->model,out);*ox=out[0];*oy=out[1];*oz=out[2];
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
        if (!p->rgba[3] || !face_visible(p,yaw,pitch,rig)) continue;
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
static double cross2(double ax,double ay,double bx,double by) {return ax*by-ay*bx;}

// Invert the same bilinear map that defines the atlas footprint. A diagonal
// split is not equivalent when the fourth corner or its depth is non-affine.
static void anime_quad(const RotVertex p[4],float *depth,uint8_t *rgba,int bounds[4],int size,const R2DRotPoint *patch,bool one_sided)
{
    double minx=p[0].x,maxx=minx,miny=p[0].y,maxy=miny;
    for(int j=1;j<4;j++){minx=fmin(minx,p[j].x);maxx=fmax(maxx,p[j].x);miny=fmin(miny,p[j].y);maxy=fmax(maxy,p[j].y);}
    int x0=(int)fmax(0,floor(minx)),x1=(int)fmin(size-1,ceil(maxx));
    int y0=(int)fmax(0,floor(miny)),y1=(int)fmin(size-1,ceil(maxy));
    if(x0>x1 || y0>y1)return;
    if(x0<bounds[0])bounds[0]=x0;if(y0<bounds[1])bounds[1]=y0;
    if(x1+1>bounds[2])bounds[2]=x1+1;if(y1+1>bounds[3])bounds[3]=y1+1;
    double bx=p[1].x-p[0].x,by=p[1].y-p[0].y;
    double cx=p[2].x-p[0].x,cy=p[2].y-p[0].y;
    double dx=p[3].x-p[1].x-p[2].x+p[0].x,dy=p[3].y-p[1].y-p[2].y+p[0].y;
    double A=-cross2(bx,by,dx,dy),bc=cross2(bx,by,cx,cy);
    double eps=1e-10*fmax(1,(fabs(bx)+fabs(by)+fabs(cx)+fabs(cy))*(fabs(dx)+fabs(dy)+1));
    for(int y=y0;y<=y1;y++)for(int x=x0;x<=x1;x++){
        double rx=x+.5-p[0].x,ry=y+.5-p[0].y;
        double B=cross2(rx,ry,dx,dy)-bc,C=cross2(rx,ry,cx,cy),roots[2];int count=0;
        if(fabs(A)<=eps){if(fabs(B)>eps)roots[count++]=-C/B;}
        else {
            double discriminant=B*B-4*A*C;
            if(discriminant>=0){
                double q=-.5*(B+copysign(sqrt(discriminant),B));
                if(fabs(q)>eps){roots[count++]=q/A;roots[count++]=C/q;}
                else roots[count++]=-B/(2*A);
            }
        }
        for(int root=0;root<count;root++){
            double u=roots[root];if(u< -1e-7 || u>1+1e-7)continue;
            double vx=cx+dx*u,vy=cy+dy*u,den=vx*vx+vy*vy;if(den<1e-14)continue;
            double v=((rx-bx*u)*vx+(ry-by*u)*vy)/den;
            if(v< -1e-7 || v>1+1e-7)continue;
            // Reject numerical roots of collapsed edges and cull locally, not
            // by the normal at the centre of a whole curved facial cell.
            double ex=bx*u+cx*v+dx*u*v-rx,ey=by*u+cy*v+dy*u*v-ry;
            if(ex*ex+ey*ey>1e-8)continue;
            if(one_sided && cross2(bx+dx*v,by+dy*v,vx,vy)<=eps)continue;
            u=fmax(0,fmin(1,u));v=fmax(0,fmin(1,v));
            double weights[4]={(1-u)*(1-v),u*(1-v),(1-u)*v,u*v},z=0;
            for(int j=0;j<4;j++)z+=weights[j]*p[j].z;
            int n=y*size+x;if(z<depth[n]-.001)continue;
            uint8_t color[4];
            if(patch->textured){
                double tu=u*4,tv=v*4;int ix=(int)fmin(3,floor(tu)),iy=(int)fmin(3,floor(tv));
                double fx=tu-ix,fy=tv-iy,w[4]={(1-fx)*(1-fy),fx*(1-fy),(1-fx)*fy,fx*fy},alpha=0,sum[3]={0};
                for(int j=0;j<4;j++){
                    const uint8_t *c=patch->material+((iy+j/2)*5+ix+j%2)*4;double wa=w[j]*c[3];alpha+=wa;
                    for(int k=0;k<3;k++)sum[k]+=wa*c[k];
                }
                if(alpha<128)continue;
                for(int j=0;j<3;j++)color[j]=(uint8_t)fmin(255,round(sum[j]/alpha));color[3]=255;
            }else {
                for(int k=0;k<4;k++){double value=0;for(int j=0;j<4;j++)value+=weights[j]*p[j].rgba[k];color[k]=(uint8_t)fmax(0,fmin(255,round(value)));}
                if(!color[3])continue;
            }
            if(fabs(z-depth[n])<=.001){
                const uint8_t *old=rgba+n*4;int light=54*color[0]+183*color[1]+19*color[2],previous=54*old[0]+183*old[1]+19*old[2];
                if(light<previous || (light==previous && memcmp(color,old,4)>=0))continue;
            }
            depth[n]=(float)z;memcpy(rgba+n*4,color,4);
        }
    }
}

// Supersampled round surface footprints keep fractional rotations and soft silhouettes.
// This produces an ordinary 2D RGBA sprite; no scene mesh or 3D renderer is introduced.
bool r2d_rotsprite_v2_anime_sized(const R2DRotAtlas *a,double yaw,double pitch,int eyes,int mouth,const R2DRotRig *rig,uint8_t *out,R2DRotAnimeWorkspace *workspace,int size)
{
    if (!a || !a->points || !out || eyes<0 || eyes>3 || mouth<0 || mouth>3 ||
        !r2d_rotsprite_angles(yaw,pitch,&yaw,&pitch) || (rig && (rig->brows<0 || rig->brows>3 ||
        !isfinite(rig->phase) || !isfinite(rig->stride) || !isfinite(rig->arm_left) || !isfinite(rig->arm_right) || !isfinite(rig->head_yaw)))) return false;
    if(size!=256 && size!=512)return false;
    const int N=size*2;const double density=size/256.0;
    if(!workspace)return false;
    if(workspace->depth && workspace->size!=size)r2d_rotsprite_anime_workspace_free(workspace);
    if(!workspace->depth) {
        workspace->depth=malloc(N*N*sizeof(float));workspace->distance=malloc(N*N*sizeof(float));
        workspace->rgba=malloc(N*N*4);workspace->resolved=malloc(size*size*4);
        workspace->sample_depth=calloc((size_t)size*size,sizeof(float));
        if(!workspace->depth||!workspace->distance||!workspace->rgba||!workspace->resolved||!workspace->sample_depth) {r2d_rotsprite_anime_workspace_free(workspace);return false;}
        workspace->size=size;
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
        const double *m=part->matrix;double scale=rig->model->scale*4*density;
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
            if(part->one_sided && !p->patch) {
                const double *m=part->matrix;double u[3],v[3],a[3],b[3];
                for(int j=0;j<3;j++){u[j]=p->patch?p->du[j]+.5*p->duv[j]:(j==0);v[j]=p->patch?p->dv[j]+.5*p->duv[j]:(j==1);}
                for(int j=0;j<3;j++){a[j]=m[j*4]*u[0]+m[j*4+1]*u[1]+m[j*4+2]*u[2];b[j]=m[j*4]*v[0]+m[j*4+1]*v[1]+m[j*4+2]*v[2];}
                double nx=a[1]*b[2]-a[2]*b[1],ny=a[2]*b[0]-a[0]*b[2],nz=a[0]*b[1]-a[1]*b[0],len=sqrt(nx*nx+ny*ny+nz*nz);
                if(len>=1e-8 && (cp*(-sy*nx+cy*nz)+sp*ny)/len<=.02)continue;
            }
        } else if(!p->patch && !face_visible(p,yaw,pitch,rig))continue;
        if (p->patch) {
            RotVertex vertices[4];
            for (int j=0;j<4;j++) {
                R2DRotPoint corner=*p;int u=j%2,v=j/2;
                corner.x+=u*p->du[0]+v*p->dv[0]+u*v*p->duv[0];corner.y+=u*p->du[1]+v*p->dv[1]+u*v*p->duv[1];corner.z+=u*p->du[2]+v*p->dv[2]+u*v*p->duv[2];
                if(rig && rig->model) {
                    int corner_part=p->corner_parts[j] ? p->corner_parts[j] : p->part;
                    if(!rig->model->parts[corner_part].defined || !rig->model->parts[corner_part].visible)corner_part=p->part;
                    const double *m=projected[corner_part];double v[3];
                    corner.part=corner_part;corner.blend_part=p->corner_blend_parts[j];corner.blend_weight=p->corner_blend_weights[j];
                    if(corner.blend_weight){
                        double point[3];model_point(&corner,rig->model,point);
                        double z=-sy*point[0]+cy*point[2],scale=rig->model->scale*4*density;
                        v[0]=(cy*point[0]+sy*point[2])*scale;v[1]=(cp*point[1]-sp*z)*scale;v[2]=sp*point[1]+cp*z;
                    }else for(int row=0;row<3;row++)v[row]=m[row*4]*corner.x+m[row*4+1]*corner.y+m[row*4+2]*corner.z+m[row*4+3];
                    vertices[j]=(RotVertex){.x=size+v[0],.y=size+v[1],.z=v[2]};
                } else {
                    double X,Y,Z;transform_point(&corner,rig,&X,&Y,&Z);
                    double scale=(rig && rig->body ? 4 : 8)*density,zz=-sy*X+cy*Z;
                    vertices[j]=(RotVertex){.x=size+(cy*X+sy*Z)*scale,.y=size+(cp*Y-sp*zz)*scale,.z=sp*Y+cp*zz};
                }
                memcpy(vertices[j].rgba,p->colors[j],4);
            }
            bool one_sided=rig && rig->model ? rig->model->parts[p->part].one_sided : p->part>=16;
            anime_quad(vertices,depth,rgba,bounds,N,p,one_sided);
            continue;
        }
        if (((!rig || !rig->model) && (p->part==2 || p->part==3)) || (p->mapped && (p->part==3 || p->part==24))) continue; // Isolated ear/hair border samples must not become floating dots.
        double sx,syy,z;
        if(rig && rig->model) {
            const double *m=projected[p->part];double v[3];
            if(p->blend_weight){
                double point[3];model_point(p,rig->model,point);
                double z=-sy*point[0]+cy*point[2],scale=rig->model->scale*4*density;
                v[0]=(cy*point[0]+sy*point[2])*scale;v[1]=(cp*point[1]-sp*z)*scale;v[2]=sp*point[1]+cp*z;
            }else for(int row=0;row<3;row++)v[row]=m[row*4]*p->x+m[row*4+1]*p->y+m[row*4+2]*p->z+m[row*4+3];
            sx=size+v[0];syy=size+v[1];z=v[2];
        } else {
            double X,Y,Z;transform_point(p,rig,&X,&Y,&Z);
            double scale=(rig && rig->body ? 4 : 8)*density,zz=-sy*X+cy*Z;
            sx=size+(cy*X+sy*Z)*scale;syy=size+(cp*Y-sp*zz)*scale;z=sp*Y+cp*zz;
        }
        if(!p->rgba[3])continue;
        double radius=p->mapped ? .9 : p->part>=32 && p->part<=35 ? 1.2 : p->part>=16 ? 2.7 : 3.2;
        radius*=density;
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
    memcpy(workspace->bounds,bounds,sizeof bounds);memset(out,0,size*size*4);
    memset(workspace->sample_depth,0,(size_t)size*size*sizeof(float));
    const double depth_scale=(rig && rig->model ? rig->model->scale : rig && rig->body ? 1 : 2)/128.0;
    int x0=bounds[0]/2,y0=bounds[1]/2,x1=(bounds[2]+1)/2,y1=(bounds[3]+1)/2;
    // Resolve two supersamples per output axis with alpha-weighted color.
    for (int y=y0;y<y1;y++) for (int x=x0;x<x1;x++) {
        unsigned sum[3]={0},alpha=0;float nearest=-1e9f;
        for (int dy=0;dy<2;dy++) for (int dx=0;dx<2;dx++) {
            const uint8_t *p=rgba+((y*2+dy)*N+x*2+dx)*4;
            alpha+=p[3];for (int j=0;j<3;j++) sum[j]+=p[j]*p[3];
            if(p[3]&&depth[(y*2+dy)*N+x*2+dx]>nearest)nearest=depth[(y*2+dy)*N+x*2+dx];
        }
        uint8_t *p=out+(y*size+x)*4;
        for (int j=0;j<3;j++) p[j]=alpha ? (uint8_t)((sum[j]+alpha/2)/alpha) : 0;
        p[3]=(uint8_t)((alpha+2)/4);
        if(alpha)workspace->sample_depth[y*size+x]=(float)(nearest*depth_scale);
    }
    // Extrude color under transparent neighbors for straight-alpha linear sampling.
    // Otherwise a zero-RGB transparent texel adds a dark fringe to pale anime edges.
    memcpy(workspace->resolved,out,size*size*4);
    if(x0>0)x0--;if(y0>0)y0--;if(x1<size)x1++;if(y1<size)y1++;
    for (int y=y0;y<y1;y++) for (int x=x0;x<x1;x++) {
        uint8_t *p=out+(y*size+x)*4;if (p[3]) continue;
        const uint8_t *best=NULL;
        for (int dy=-1;dy<=1;dy++) for (int dx=-1;dx<=1;dx++) {
            int sx=x+dx,sy=y+dy;if (sx<0 || sy<0 || sx>=size || sy>=size) continue;
            const uint8_t *q=workspace->resolved+(sy*size+sx)*4;
            if (q[3] && (!best || q[3]>best[3])) best=q;
        }
        if (best) memcpy(p,best,3);
    }
    return true;
}

bool r2d_rotsprite_v2_anime_workspace(const R2DRotAtlas *a,double yaw,double pitch,int eyes,int mouth,const R2DRotRig *rig,uint8_t *out,R2DRotAnimeWorkspace *w)
{return r2d_rotsprite_v2_anime_sized(a,yaw,pitch,eyes,mouth,rig,out,w,256);}

void r2d_rotsprite_anime_workspace_free(R2DRotAnimeWorkspace *w)
{if(!w)return;free(w->depth);free(w->distance);free(w->sample_depth);free(w->rgba);free(w->resolved);memset(w,0,sizeof *w);}
bool r2d_rotsprite_v2_anime(const R2DRotAtlas *a,double yaw,double pitch,int eyes,int mouth,const R2DRotRig *rig,uint8_t *out)
{R2DRotAnimeWorkspace w={0};bool ok=r2d_rotsprite_v2_anime_workspace(a,yaw,pitch,eyes,mouth,rig,out,&w);r2d_rotsprite_anime_workspace_free(&w);return ok;}

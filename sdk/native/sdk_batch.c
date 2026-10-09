// Native batch operations reuse the same baker and validator as individual tools.
#include "sdk_bake.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static bool absolute(const char *p) { return p && (p[0]=='/' || (strlen(p)>2 && p[1]==':')); }
static void path_of(const char *dir,const char *p,char *out,size_t cap) {
    char raw[2048];
    if(absolute(p)) snprintf(raw,sizeof raw,"%s",p); else sdk_join(dir,p?p:"",raw,sizeof raw);
    // Collapse lexical aliases so ./hero and tmp/../hero cannot overwrite each other.
    char *parts[1024];int n=0;bool rooted=raw[0]=='/';char *cursor=raw;
    while(*cursor){while(*cursor=='/')cursor++;if(!*cursor)break;char *part=cursor;while(*cursor&&*cursor!='/')cursor++;if(*cursor)*cursor++=0;
        if(!strcmp(part,"."))continue;
        if(!strcmp(part,"..")&&n&&strcmp(parts[n-1],"..")){n--;continue;}
        if(!strcmp(part,"..")&&rooted)continue;
        if(n<1024)parts[n++]=part;
    }
    out[0]=0;if(rooted)snprintf(out,cap,"/");
    for(int i=0;i<n;i++){size_t used=strlen(out);if(used&&out[used-1]!='/')strncat(out,"/",cap-used-1);used=strlen(out);strncat(out,parts[i],cap-used-1);}
    if(!out[0])snprintf(out,cap,".");
}
int sdk_cmd_batch(const SdkArgs *a) {
    SdkReport rep; sdk_report_init(&rep);
    const char *path=sdk_arg_positional(a,0);
    if(!path) { int rc=sdk_fail(&rep,"SDK_USAGE","r2d-sdk batch <manifest.json> [--output report.json]");sdk_report_free(&rep);return rc; }
    R2dJson *root=sdk_load_json(path,&rep); const R2dJson *jobs=root?r2d_json_get(root,"jobs"):NULL;
    if(!root || root->type!=R2D_JSON_OBJ || r2d_json_num(r2d_json_get(root,"version"),0)!=1 || !jobs || jobs->type!=R2D_JSON_ARR || jobs->count>4096) {
        sdk_diag(&rep,SDK_ERROR,"SDK_BATCH_FORMAT",path,NULL,NULL,"Нужен version:1 и массив jobs (до 4096)");
        R2dSb out;r2d_sb_init(&out);r2d_sb_puts(&out,"{\"ok\":false,");sdk_report_put(&rep,&out);r2d_sb_putc(&out,'}');puts(out.data);
        r2d_sb_free(&out);r2d_json_free(root);sdk_report_free(&rep);return 1;
    }
    char dir[1536];sdk_dirname(path,dir,sizeof dir);
    R2dSb items;r2d_sb_init(&items);int failed=0,warnings=0;
    for(int i=0;i<jobs->count;i++) {
        const R2dJson *j=jobs->items[i];SdkReport jr;sdk_report_init(&jr);
        const char *kind=r2d_json_str(r2d_json_get(j,"op"),"");
        const char *src=r2d_json_str(r2d_json_get(j,"source"),NULL);
        char source[2048],output[2048];path_of(dir,src,source,sizeof source);
        R2dSb result;r2d_sb_init(&result);bool ok=false;
        if(j->type!=R2D_JSON_OBJ || !src || !src[0]) sdk_diag(&jr,SDK_ERROR,"SDK_BATCH_JOB",path,NULL,NULL,"job %d: нужен объект с op и source",i);
        else if(!strcmp(kind,"validate")) {
            const char *type=sdk_validate_file(source,r2d_json_str(r2d_json_get(j,"type"),NULL),&jr);
            r2d_sb_puts(&result,"{\"type\":");r2d_sb_put_json_string(&result,type);r2d_sb_putc(&result,'}');ok=jr.errors==0;
        } else if(!strcmp(kind,"bake-re2d")) {
            const char *dest=r2d_json_str(r2d_json_get(j,"output"),NULL);
            BkOptions o;bk_default_options(&o);BkResult res={0};
            o.expression=r2d_json_str(r2d_json_get(j,"expression"),NULL);
            o.type=r2d_json_str(r2d_json_get(j,"type"),"prop");o.name=r2d_json_str(r2d_json_get(j,"name"),NULL);
            o.style=r2d_json_str(r2d_json_get(j,"style"),"anime");
            const char *uv=r2d_json_str(r2d_json_get(j,"uv"),"auto"),*origin=r2d_json_str(r2d_json_get(j,"origin"),!strcmp(o.type,"environment")?"feet":"center");
            double size=r2d_json_num(r2d_json_get(j,"size"),1024),scale=r2d_json_num(r2d_json_get(j,"scale"),0),first=r2d_json_num(r2d_json_get(j,"firstId"),80);
            const char *strings[]={"type","name","style","uv","origin","expression"};
            const char *numbers[]={"size","scale","firstId"};bool typed=true;
            for(size_t k=0;k<sizeof strings/sizeof strings[0];k++){const R2dJson *v=r2d_json_get(j,strings[k]);if(v&&v->type!=R2D_JSON_STR)typed=false;}
            for(size_t k=0;k<sizeof numbers/sizeof numbers[0];k++){const R2dJson *v=r2d_json_get(j,numbers[k]);if(v&&v->type!=R2D_JSON_NUM)typed=false;}
            if(!typed || !dest || !dest[0] || (strcmp(uv,"auto")&&strcmp(uv,"existing")&&strcmp(uv,"optimized")) || (strcmp(origin,"center")&&strcmp(origin,"feet")) ||
                (size!=1024&&size!=2048&&size!=4096) || !isfinite(scale) || scale<0 || scale>1e6 || first<1 || first>254 || floor(first)!=first)
                sdk_diag(&jr,SDK_ERROR,"SDK_BATCH_OPTIONS",path,NULL,NULL,"job %d: неверные output/uv/origin/size/scale/firstId",i);
            else {
                path_of(dir,dest,output,sizeof output);
                // Duplicate destinations are refused before a later job overwrites an earlier result.
                for(int k=0;k<i;k++) {const R2dJson *prev=jobs->items[k];const char *pd=r2d_json_str(r2d_json_get(prev,"output"),NULL);char normalized[2048];path_of(dir,pd,normalized,sizeof normalized);if(pd && !strcmp(normalized,output))sdk_diag(&jr,SDK_ERROR,"SDK_BATCH_OUTPUT_DUPLICATE",output,NULL,NULL,"job %d: output уже использован job %d",i,k);}
                o.uv=!strcmp(uv,"existing")?BK_UV_EXISTING:!strcmp(uv,"optimized")?BK_UV_OPTIMIZED:BK_UV_AUTO;o.origin=!strcmp(origin,"feet")?BK_ORIGIN_FEET:BK_ORIGIN_CENTER;
                o.size=(int)size;o.scale=(float)scale;o.first_id=(int)first;
                if(!jr.errors)ok=bk_bake(source,output,&o,&res,&jr);
                if(res.report_json)r2d_sb_puts(&result,res.report_json);
                bk_result_free(&res);
            }
        } else sdk_diag(&jr,SDK_ERROR,"SDK_BATCH_OPERATION",path,NULL,NULL,"job %d: поддержаны op validate и bake-re2d",i);
        if(!ok)failed++;warnings+=jr.warnings;
        if(i)r2d_sb_putc(&items,',');r2d_sb_printf(&items,"{\"index\":%d,\"ok\":%s,\"source\":",i,ok?"true":"false");r2d_sb_put_json_string(&items,source);
        r2d_sb_puts(&items,",\"result\":");r2d_sb_puts(&items,result.len?result.data:"null");r2d_sb_putc(&items,',');sdk_report_put_counts(&jr,&items);r2d_sb_putc(&items,',');sdk_report_put(&jr,&items);r2d_sb_putc(&items,'}');
        r2d_sb_free(&result);sdk_report_free(&jr);
    }
    R2dSb out;r2d_sb_init(&out);
    r2d_sb_printf(&out,"{\"ok\":%s,\"total\":%d,\"succeeded\":%d,\"failed\":%d,\"warnings\":%d,\"jobs\":[%s]",failed?"false":"true",jobs->count,jobs->count-failed,failed,warnings,items.data?items.data:"");
    const char *dest=sdk_arg_value(a,"--output");
    // Final report I/O errors affect both the stdout status and exit code.
    R2dSb file;r2d_sb_init(&file);r2d_sb_puts(&file,out.data);r2d_sb_putc(&file,',');sdk_report_put(&rep,&file);r2d_sb_puts(&file,"}\n");
    if(dest && !sdk_write_file(dest,file.data,file.len))sdk_diag(&rep,SDK_ERROR,"SDK_WRITE_FAILED",dest,NULL,NULL,"Не удалось записать batch report");
    r2d_sb_free(&file);
    if(rep.errors){out.len=0;out.data[0]=0;r2d_sb_printf(&out,"{\"ok\":false,\"total\":%d,\"succeeded\":%d,\"failed\":%d,\"warnings\":%d,\"jobs\":[%s]",jobs->count,jobs->count-failed,failed,warnings,items.data?items.data:"");}
    r2d_sb_putc(&out,',');sdk_report_put(&rep,&out);r2d_sb_puts(&out,"}\n");fputs(out.data,stdout);
    int rc=failed||rep.errors?1:0;r2d_sb_free(&out);r2d_sb_free(&items);r2d_json_free(root);sdk_report_free(&rep);return rc;
}

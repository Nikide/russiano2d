// Native protocol client: carries original engine requests/responses without another API.
#include "sdk.h"
#include <SDL3/SDL.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
static bool line_read(SDL_IOStream *io,R2dSb *line,Uint64 timeout) {
    r2d_sb_clear(line);Uint64 end=SDL_GetTicks()+timeout;
    while(SDL_GetTicks()<end) {
        char ch;
        if(SDL_ReadIO(io,&ch,1)==1) {if(ch=='\n')return true;if(line->len>=16*1024*1024)return false;r2d_sb_putc(line,ch);}
        else if(SDL_GetIOStatus(io)==SDL_IO_STATUS_NOT_READY)SDL_Delay(1);
        else return false;
    }
    return false;
}
static bool line_write(SDL_IOStream *io,const char *line,Uint64 timeout) {
    size_t pos=0,n=strlen(line);Uint64 end=SDL_GetTicks()+timeout;
    while(pos<n && SDL_GetTicks()<end) {
        size_t k=SDL_WriteIO(io,line+pos,n-pos);pos+=k;
        if(!k) {if(SDL_GetIOStatus(io)!=SDL_IO_STATUS_NOT_READY)return false;SDL_Delay(1);}
    }
    return pos==n;
}
static void report_json(R2dSb *out,const R2dJson *ready,const R2dSb *replies,const SdkReport *rep,int completed,int failed) {
    r2d_sb_clear(out);r2d_sb_printf(out,"{\"ok\":%s,\"completed\":%d,\"failed\":%d,\"ready\":",rep->errors||failed?"false":"true",completed,failed);
    if(ready)sdk_json_put_compact(out,ready);else r2d_sb_puts(out,"null");
    r2d_sb_printf(out,",\"responses\":[%s],",replies->data?replies->data:"");
    sdk_report_put_counts(rep,out);r2d_sb_putc(out,',');sdk_report_put(rep,out);r2d_sb_puts(out,"}\n");
}
int sdk_cmd_agent(const SdkArgs *a) {
    SdkReport rep;sdk_report_init(&rep);R2dSb replies,line,out;r2d_sb_init(&replies);r2d_sb_init(&line);r2d_sb_init(&out);
    const char *path=sdk_arg_positional(a,0);R2dJson *root=NULL,*ready=NULL;SDL_Process *p=NULL;int completed=0,failed=0;
    if(!path){sdk_diag(&rep,SDK_ERROR,"SDK_USAGE",NULL,NULL,NULL,"r2d-sdk agent <session.json> [--engine path] [--output report.json]");goto finish;}
    root=sdk_load_json(path,&rep);const R2dJson *requests=root?r2d_json_get(root,"requests"):NULL;
    const char *game=r2d_json_str(r2d_json_get(root,"game"),NULL);double timeout=r2d_json_num(r2d_json_get(root,"timeoutMs"),30000);
    const R2dJson *timeout_node=r2d_json_get(root,"timeoutMs"),*seed_node=r2d_json_get(root,"seed"),*scene_node=r2d_json_get(root,"scene");
    double seed_value=r2d_json_num(seed_node,1);
    if((timeout_node&&timeout_node->type!=R2D_JSON_NUM)||(seed_node&&seed_node->type!=R2D_JSON_NUM)||(scene_node&&scene_node->type!=R2D_JSON_STR)||
        !isfinite(seed_value)||seed_value<0||seed_value>4294967295.0||floor(seed_value)!=seed_value||floor(timeout)!=timeout||
        !root || root->type!=R2D_JSON_OBJ || r2d_json_num(r2d_json_get(root,"version"),0)!=1 || !game || !game[0] ||
        !requests || requests->type!=R2D_JSON_ARR || requests->count>4096 || !isfinite(timeout) || timeout<1 || timeout>600000) {
        sdk_diag(&rep,SDK_ERROR,"SDK_AGENT_SESSION",path,NULL,NULL,"Нужен version:1, game, requests[], целый timeoutMs 1..600000 и seed uint32");goto finish;
    }
    for(int i=0;i<requests->count;i++) {
        const R2dJson *req=requests->items[i];const char *cmd=r2d_json_str(r2d_json_get(req,"cmd"),NULL);
        if(req->type!=R2D_JSON_OBJ || !cmd || !cmd[0] || (!strcmp(cmd,"quit") && i!=requests->count-1)) {
            sdk_diag(&rep,SDK_ERROR,"SDK_AGENT_REQUEST",path,NULL,NULL,"request %d: нужен cmd, quit допустим только последним",i);goto finish;
        }
    }
    char engine[1536],dir[1536],gamepath[2048],seed[40];
    if(!sdk_find_engine(sdk_arg_value(a,"--engine"),engine,sizeof engine)){sdk_diag(&rep,SDK_ERROR,"SDK_ENGINE_NOT_FOUND",NULL,NULL,NULL,"Бинарник движка не найден");goto finish;}
    sdk_dirname(path,dir,sizeof dir);if(game[0]=='/' || (strlen(game)>2&&game[1]==':'))snprintf(gamepath,sizeof gamepath,"%s",game);else sdk_join(dir,game,gamepath,sizeof gamepath);
    snprintf(seed,sizeof seed,"%.0f",seed_value);
    const char *argv[20]={engine,"--agent","--headless","--fixed-dt","0.0166666667","--no-hot-reload","--game",gamepath,"--seed",seed,NULL};
    const char *scene=r2d_json_str(r2d_json_get(root,"scene"),NULL);if(scene){argv[10]="--scene";argv[11]=scene;argv[12]=NULL;}
    SDL_PropertiesID props=SDL_CreateProperties();SDL_SetPointerProperty(props,SDL_PROP_PROCESS_CREATE_ARGS_POINTER,(void*)argv);
    SDL_SetNumberProperty(props,SDL_PROP_PROCESS_CREATE_STDIN_NUMBER,SDL_PROCESS_STDIO_APP);
    SDL_SetNumberProperty(props,SDL_PROP_PROCESS_CREATE_STDOUT_NUMBER,SDL_PROCESS_STDIO_APP);
    SDL_SetNumberProperty(props,SDL_PROP_PROCESS_CREATE_STDERR_NUMBER,SDL_PROCESS_STDIO_NULL);
    p=SDL_CreateProcessWithProperties(props);SDL_DestroyProperties(props);
    if(!p){sdk_diag(&rep,SDK_ERROR,"SDK_ENGINE_START",engine,NULL,NULL,"%s",SDL_GetError());goto finish;}
    SDL_IOStream *in=SDL_GetProcessInput(p),*io=SDL_GetProcessOutput(p);char err[256];
    if(!line_read(io,&line,(Uint64)timeout) || !(ready=r2d_json_parse(line.data,err,sizeof err)) || strcmp(r2d_json_str(r2d_json_get(ready,"event"),""),"ready")) {
        sdk_diag(&rep,SDK_ERROR,"SDK_AGENT_READY",gamepath,NULL,NULL,"Не получено событие ready");goto finish;
    }
    for(int i=0;i<requests->count;i++) {
        const R2dJson *req=requests->items[i];R2dSb send;r2d_sb_init(&send);sdk_json_put_compact(&send,req);
        if(!r2d_json_get(req,"id")){send.data[--send.len]=0;r2d_sb_printf(&send,",\"id\":%d}",i+1);}r2d_sb_putc(&send,'\n');
        bool sent=line_write(in,send.data,(Uint64)timeout);r2d_sb_free(&send);
        if(!sent || !line_read(io,&line,(Uint64)timeout)){sdk_diag(&rep,SDK_ERROR,"SDK_AGENT_IO",gamepath,NULL,NULL,"Нет ответа на request %d (EOF или timeout)",i);break;}
        R2dJson *response=r2d_json_parse(line.data,err,sizeof err);
        if(!response || response->type!=R2D_JSON_OBJ){sdk_diag(&rep,SDK_ERROR,"SDK_AGENT_RESPONSE",gamepath,NULL,NULL,"Ответ %d не JSON-объект",i);r2d_json_free(response);break;}
        if(completed++)r2d_sb_putc(&replies,',');sdk_json_put_compact(&replies,response);
        if(!r2d_json_bool(r2d_json_get(response,"ok"),false))failed++;
        r2d_json_free(response);
    }
    // End the same live session; never leave a child process waiting on stdin.
    if(!requests->count || strcmp(r2d_json_str(r2d_json_get(requests->items[requests->count-1],"cmd"),""),"quit")) {
        if(line_write(in,"{\"cmd\":\"quit\",\"id\":-1}\n",(Uint64)timeout))line_read(io,&line,(Uint64)timeout);
    }
finish:
    if(p){int exit_code; if(!SDL_WaitProcess(p,false,&exit_code))SDL_KillProcess(p,true);SDL_WaitProcess(p,true,&exit_code);SDL_DestroyProcess(p);}
    bool ok=!rep.errors&&!failed; report_json(&out,ready,&replies,&rep,completed,failed);
    const char *dest=sdk_arg_value(a,"--output");if(dest&&!sdk_write_file(dest,out.data,out.len)) {
        sdk_diag(&rep,SDK_ERROR,"SDK_WRITE_FAILED",dest,NULL,NULL,"Не удалось записать agent report");
        report_json(&out,ready,&replies,&rep,completed,failed);ok=false;
    }
    fputs(out.data,stdout);r2d_json_free(ready);r2d_json_free(root);r2d_sb_free(&replies);r2d_sb_free(&line);r2d_sb_free(&out);sdk_report_free(&rep);return ok?0:(!path?2:1);
}

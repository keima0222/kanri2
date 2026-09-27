const APP_PATH=new URL('.',location.href).pathname;
const CONFIG_KEY=`hoan-note:${APP_PATH}:connection`;
const SESSION_PREFIX=`hoan-note:${APP_PATH}:session:`;
const json=async r=>{try{return await r.json();}catch{return null;}};
export function readConfig(){try{return JSON.parse(localStorage.getItem(CONFIG_KEY))||null;}catch{return null;}}
export function saveConfig(config){localStorage.setItem(CONFIG_KEY,JSON.stringify(validateConfig(config)));}
export function validateConfig({url,key}){
 url=String(url||'').trim().replace(/\/+$/,'');key=String(key||'').trim();
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url))throw new Error('プロジェクトURLは https://…supabase.co の形式で入力してください。');
 if(!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key))throw new Error('Publishable key（sb_publishable_ で始まるキー）を入力してください。Secret keyは使えません。');
 return {url,key};
}
export function readSession(config=readConfig()){if(!config)return null;try{return JSON.parse(localStorage.getItem(SESSION_PREFIX+config.url))||null;}catch{return null;}}
export const workspaceScope=(config,session)=>APP_PATH+':'+(config&&session?.user?.id?config.url+':'+session.user.id:'local');
function readableError(status,body){
 const message=body?.msg||body?.error_description||body?.message||body?.error||'';
 if(/Invalid login credentials/i.test(message))return 'メールアドレスまたはパスワードが違います。';
 if(/Email not confirmed/i.test(message))return 'メールアドレスの確認が完了していません。導入手順の利用者登録を確認してください。';
 if(/not allowed|owner_required|permission denied|row.level security/i.test(message))return 'このアカウントは共有先にアクセスできません。利用者登録とSQLの設定を確認してください。';
 if(status===401)return '再ログインが必要です。端末内の記録は保持しています。';
 if(status===404||/schema cache|does not exist|PGRST202/i.test(message))return '共有先の初期設定が完了していません。導入手順のSQL設定を確認してください。';
 if(status===413)return '共有先のファイル容量上限を超えています。';
 if(status===429)return '共有先が混み合っています。少し待ってから再試行してください。';
 if(status>=500)return '共有先に接続できません。サービスの状態を確認し、後でもう一度同期してください。';
 return '共有先で処理できませんでした。接続設定・容量を確認してください。';
}
export class Cloud {
 constructor(config,session=readSession(config)){this.config=validateConfig(config);this.session=session;}
 remember(session){this.session={...session,expires_at:session.expires_at||Math.floor(Date.now()/1000)+session.expires_in};localStorage.setItem(SESSION_PREFIX+this.config.url,JSON.stringify(this.session));}
 async raw(path,options={}){
  let r;try{r=await fetch(this.config.url+path,{...options,headers:{apikey:this.config.key,...options.headers},signal:AbortSignal.timeout(30000)});}catch{throw new Error('通信できませんでした。入力内容は端末に残ります。電波が戻ってから同期します。');}
  if(!r.ok){const b=await json(r);const e=new Error(readableError(r.status,b));e.status=r.status;throw e;}return r;
 }
 async login(email,password){const r=await this.raw('/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});const s=await r.json();if(!s.user?.id||!s.access_token||!s.refresh_token)throw new Error('ログイン情報を確認できませんでした。');this.session=s;
  const allowed=await this.rpc('hoan_is_owner',{});if(allowed!==true){this.session=null;throw new Error('利用者登録が未完了です。導入手順の「本人の登録」を実施してください。');}
  this.remember(s);return this.session;
 }
 async ensureToken(){
  const refresh=async()=>{
   const saved=readSession(this.config);if(saved?.user?.id===this.session?.user?.id&&saved.expires_at>this.session.expires_at)this.session=saved;
   if(!this.session?.access_token)throw new Error('先にログインしてください。');
   if(!this.session.expires_at || this.session.expires_at>Date.now()/1000+60)return this.session.access_token;
   try{const r=await this.raw('/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:this.session.refresh_token})});this.remember(await r.json());}catch(e){if(e.status===400||e.status===401)throw new Error('ログインの期限が切れました。設定から再ログインしてください。端末内の記録は残っています。');throw e;}return this.session.access_token;
  };
  return navigator.locks?navigator.locks.request('hoan-auth:'+this.config.url,refresh):refresh();
 }
 async request(path,options={}){const token=await this.ensureToken();return this.raw(path,{...options,headers:{Authorization:`Bearer ${token}`,...options.headers}});}
 async rpc(name,body){const r=await this.request('/rest/v1/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return r.json();}
 async list(after=0){const result=[];let cursor=after;for(;;){const page=await this.rpc('hoan_changes',{p_after:cursor});if(!Array.isArray(page.rows)||!Number.isSafeInteger(page.cursor)||page.cursor<cursor)throw new Error('共有先の応答が正しくありません。');result.push(...page.rows);if(page.rows.length===500&&page.cursor===cursor)throw new Error('同期の続きが取得できませんでした。');cursor=page.cursor;if(page.rows.length<500)break;}return {rows:result,cursor};}
 async push(record){return this.rpc('hoan_put_record',{p_id:record.id,p_doc:record.doc,p_base_version:record.version,p_mutation_id:record.mutationId});}
 filePath(id){return encodeURIComponent(this.session.user.id)+'/'+encodeURIComponent(id);}
 async upload(id,blob){await this.request('/storage/v1/object/hoan-assets/'+this.filePath(id),{method:'POST',headers:{'Content-Type':blob.type,'x-upsert':'true'},body:blob});}
 async download(id){const r=await this.request('/storage/v1/object/authenticated/hoan-assets/'+this.filePath(id));return r.blob();}
 async logout(){try{await this.request('/auth/v1/logout?scope=local',{method:'POST'});}catch{/* Local sign-out must remain available offline. */}localStorage.removeItem(SESSION_PREFIX+this.config.url);this.session=null;}
}
export async function sha256(blob){const buffer=await blob.arrayBuffer();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export class SyncEngine {
 constructor(store,cloud,onstate){this.store=store;this.cloud=cloud;this.onstate=onstate;this.state={busy:false,error:'',lastSync:null};this.stopped=false;this.timer=null;this.running=null;}
 setState(patch){this.state={...this.state,...patch};this.onstate?.(this.state);}
 start(){this.timer=setInterval(()=>{if(document.visibilityState==='visible')void this.sync();},15000);void this.sync();}
 async stop(){this.stopped=true;clearInterval(this.timer);await this.running;}
 async sync(){
  if(this.running||this.stopped||this.paused||!this.cloud||!navigator.onLine)return this.running;
  const run=async()=>{if(this.stopped)return;this.setState({busy:true,error:''});try{
   const records=await this.store.all();
   for(const r of records){if(this.stopped)return;if(!r.dirty||r.conflict)continue;
    if(r.doc.kind==='attachment'){const blob=await this.store.file(r.id);if(!blob)throw new Error('添付ファイルが端末にありません。元の端末で同期を完了するか、バックアップから復元してください。');await this.cloud.upload(r.id,blob);}
    const response=await this.cloud.push(r);
    if(response.status==='ok')await this.store.ack(r.id,r.mutationId,response.version);
    else if(response.status==='conflict')await this.store.conflict(r.id,response.record);
    else throw new Error('共有先の応答を確認できませんでした。');
   }
   if(this.stopped)return;
   const changes=await this.cloud.list((await this.store.meta('cursor'))||0);
   for(const r of changes.rows){if(this.stopped)return;await this.store.accept(r);}
   await this.store.setMeta('cursor',changes.cursor);
   for(const r of await this.store.all()){
    if(this.stopped)return;
    if(r.doc.kind!=='attachment'||r.dirty||await this.store.file(r.id))continue;
    const b=await this.cloud.download(r.id);if(b.size!==r.doc.values.size||r.doc.values.hash&&await sha256(b)!==r.doc.values.hash)throw new Error('添付ファイルの内容を確認できませんでした。同期を再試行してください。');
    await this.store.putFile(r.id,new Blob([b],{type:r.doc.values.mime}));
   }
   const lastSync=new Date().toISOString();await this.store.setMeta('lastSync',lastSync);this.setState({lastSync});
  }catch(e){this.setState({error:e.message});}finally{this.setState({busy:false});this.store.changed();}};
  this.running=(navigator.locks?navigator.locks.request('hoan-sync:'+this.store.scope,{ifAvailable:true},lock=>lock?run():undefined):run()).finally(()=>{this.running=null;});
  return this.running;
 }
}

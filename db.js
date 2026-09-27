import {clone,uuid,mergeEdited,validateDoc,same} from './model.js';
const req=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
const finish=tx=>new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('保存を中止しました。'));});
export class Store {
 static async open(scope){
  const request=indexedDB.open(`hoan-note-v1:${scope}`,1);
  request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('records',{keyPath:'id'});db.createObjectStore('files',{keyPath:'id'});db.createObjectStore('meta',{keyPath:'id'});};
  return new Store(await req(request),scope);
 }
 constructor(db,scope){this.db=db;this.scope=scope;this.channel=typeof BroadcastChannel==='function'?new BroadcastChannel(`hoan-note:${scope}`):null;this.channel?.addEventListener('message',()=>this.onchange?.());}
 close(){this.channel?.close();this.db.close();}
 changed(){this.channel?.postMessage('changed');this.onchange?.();}
 async all(){return req(this.db.transaction('records').objectStore('records').getAll());}
 async get(id){return req(this.db.transaction('records').objectStore('records').get(id));}
 async file(id){return (await req(this.db.transaction('files').objectStore('files').get(id)))?.blob;}
 async files(){return req(this.db.transaction('files').objectStore('files').getAll());}
 async meta(id){return (await req(this.db.transaction('meta').objectStore('meta').get(id)))?.value;}
 async setMeta(id,value){const tx=this.db.transaction('meta','readwrite');const done=finish(tx);tx.objectStore('meta').put({id,value});await done;}
 async update(id,fn,notify=true){const tx=this.db.transaction('records','readwrite');const done=finish(tx);const s=tx.objectStore('records');const r=s.get(id);let value;let failure;r.onsuccess=()=>{try{value=fn(r.result);if(value)s.put(value);}catch(e){failure=e;tx.abort();}};try{await done;}catch(e){throw failure||e;}if(notify)this.changed();return value;}
 async save(doc,baseline=null){validateDoc(doc);return this.update(doc.id,old=>{
  if(old?.doc.deleted&&!baseline?.deleted&&!doc.deleted)throw new Error('この記録は別の画面で削除されています。ごみ箱から戻してから編集してください。');
  const merged=old?mergeEdited(old.doc,doc,baseline):clone(doc);validateDoc(merged);
  return {...old,id:doc.id,doc:merged,version:old?.version||0,dirty:true,mutationId:uuid(),conflict:old?.conflict||null};
 });}
 async addAttachment(doc,blob){validateDoc(doc);const tx=this.db.transaction(['records','files'],'readwrite');const done=finish(tx);tx.objectStore('files').put({id:doc.id,blob});tx.objectStore('records').put({id:doc.id,doc,version:0,dirty:true,mutationId:uuid(),conflict:null});await done;this.changed();}
 async putFile(id,blob){const tx=this.db.transaction('files','readwrite');const done=finish(tx);tx.objectStore('files').put({id,blob});await done;}
 async ack(id,mutationId,version){return this.update(id,old=>{if(!old||version<old.version)return old;return {...old,version,dirty:old.mutationId!==mutationId,conflict:null};},false);}
 async accept(row){validateDoc(row.doc);return this.update(row.id,old=>{
  if(old&&row.version<=old.version)return old;
  if(old?.dirty&&!same(old.doc,row.doc)&&old.mutationId!==row.mutation_id)return {...old,conflict:row};
  return {id:row.id,doc:clone(row.doc),version:row.version,dirty:false,mutationId:row.mutation_id,conflict:null};
 },false);}
 async conflict(id,remote){return this.update(id,old=>old&&({...old,conflict:remote}),false);}
 async resolve(id,useLocal,expectedVersion,expectedMutation){return this.update(id,old=>{if(!old?.conflict)return old;const r=old.conflict;if(expectedVersion!==undefined&&(r.version!==expectedVersion||old.mutationId!==expectedMutation))throw new Error('比較中に記録が更新されました。いったん閉じて、もう一度内容を比較してください。');return useLocal?{...old,version:r.version,dirty:true,mutationId:uuid(),conflict:null}:{id:r.id,doc:r.doc,version:r.version,dirty:false,mutationId:r.mutation_id,conflict:null};});}
 async restore(docs,files){
  const tx=this.db.transaction(['records','files'],'readwrite');const done=finish(tx);const s=tx.objectStore('records');
  for(const doc of docs){const r=s.get(doc.id);r.onsuccess=()=>{const old=r.result;s.put({id:doc.id,doc,version:old?.version||0,dirty:true,mutationId:uuid(),conflict:null});};}
  for(const f of files)tx.objectStore('files').put(f);await done;this.changed();
 }
}

import {validateCollection,MIME_TYPES,MAX_FILE_SIZE,VERSION} from './model.js';
import {sha256} from './cloud.js';
export async function exportBackup(store,onprogress=()=>{}){
 const rows=await store.all();if(rows.some(r=>r.conflict))throw new Error('先に同期の競合を確認してください。');
 const zip=new window.JSZip();const records=rows.map(r=>r.doc);
 zip.file('records.json',JSON.stringify({format:'hoan-note',formatVersion:1,appVersion:VERSION,createdAt:new Date().toISOString(),records},null,2));
 const attachments=records.filter(d=>d.kind==='attachment');let i=0;
 for(const d of attachments){const blob=await store.file(d.id);if(!blob)throw new Error('まだ取得できていない添付ファイルがあります。オンラインで同期してからバックアップしてください。');zip.file('files/'+d.id,await blob.arrayBuffer());onprogress(`添付ファイルを準備中 ${++i}/${attachments.length}`);}
 const result=await zip.generateAsync({type:'blob',compression:'STORE',streamFiles:true},m=>onprogress(`バックアップ作成中 ${Math.round(m.percent)}%`));
 await store.setMeta('lastBackup',new Date().toISOString());return result;
}
export async function inspectBackup(file,onprogress=()=>{}){
 if(file.size>1024*1024*1024)throw new Error('1GBを超えるバックアップです。パソコンでの復元をご相談ください。');
 const zip=await window.JSZip.loadAsync(await file.arrayBuffer());const entry=zip.file('records.json');if(!entry)throw new Error('事業場ノートのバックアップを選択してください。');
 if(entry._data?.uncompressedSize>20*1024*1024)throw new Error('バックアップの管理データが大きすぎます。');
 const data=JSON.parse(await entry.async('string'));
 if(data.format!=='hoan-note'||data.formatVersion!==1||!Array.isArray(data.records)||data.records.length>50000)throw new Error('対応していないバックアップ形式です。');
 validateCollection(data.records);const files=[];let size=0;
 for(const d of data.records.filter(d=>d.kind==='attachment')){
  if(!/^[a-zA-Z0-9-]+$/.test(d.id))throw new Error('添付ファイルのIDが正しくありません。');
  const f=zip.file('files/'+d.id);if(!f)throw new Error('バックアップ内の添付ファイルが不足しています。');
  if((f._data?.uncompressedSize??0)>MAX_FILE_SIZE)throw new Error('添付ファイルが大きすぎます。');
  size+=f._data?.uncompressedSize||0;if(size>1024*1024*1024)throw new Error('展開後の容量が1GBを超えます。');
  const blob=new Blob([await f.async('arraybuffer')],{type:d.values.mime});
  if(blob.size!==d.values.size||!d.values.hash||await sha256(blob)!==d.values.hash)throw new Error('バックアップ内の添付ファイルが破損または変更されています。');
  files.push({id:d.id,blob});onprogress(`添付ファイルを確認中 ${files.length}`);
 }
 const permitted=new Set(['records.json',...files.map(f=>'files/'+f.id)]);for(const [name,f]of Object.entries(zip.files)){if(!f.dir&&!permitted.has(name))throw new Error('想定していないファイルが含まれています。');}
 return {...data,files};
}
export function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}

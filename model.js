export const VERSION = '1.0.0';
export const KINDS = ['region','site','equipment','task','field','attachment'];
export const MIME_TYPES = ['image/jpeg','image/png','image/webp','image/gif','application/pdf'];
export const MAX_FILE_SIZE = 20 * 1024 * 1024;
export const SCOPES = {site:'事業場詳細',equipment:'機器台帳',task:'タスク管理'};
export const TYPE_NAMES = {text:'1行テキスト',textarea:'複数行テキスト',number:'数値',date:'日付',datetime:'日時',select:'選択肢'};
const f=(scope,key,label,type,order,extra={})=>({id:`field-${scope}-${key}`,kind:'field',parentId:null,deleted:false,values:{scope,key,label,type,order,options:[],archived:false,...extra}});
export const DEFAULT_FIELDS = [
 f('site','name','事業場名','text',10,{core:true,required:true}),f('site','address','住所','text',20),f('site','contact','担当者','text',30),f('site','phone','電話番号','text',40),f('site','email','メールアドレス','text',50),f('site','notes','備考','textarea',60),
 f('equipment','name','機器名','text',10,{core:true,required:true}),f('equipment','type','機器の種類','text',20),f('equipment','maker','メーカー','text',30),f('equipment','model','型式','text',40),f('equipment','year','製造年','number',50),f('equipment','notes','備考','textarea',60),
 f('task','name','タスク名','text',10,{core:true,required:true}),f('task','occurred','発生日時','datetime',20),f('task','content','内容','textarea',30),f('task','status','進捗状況','select',40,{options:['未着手','対応中','先方待ち','完了']}),f('task','notes','対応メモ','textarea',50)
];
export const uuid=()=>crypto.randomUUID();
export const clone=v=>structuredClone(v);
export const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function makeDoc(kind,parentId=null,values={}){return {id:uuid(),kind,parentId,values,deleted:false};}
export function getFields(rows,scope,includeArchived=false){
 const all=new Map(DEFAULT_FIELDS.map(d=>[d.id,clone(d)]));
 for(const r of rows) if(r.doc.kind==='field') all.set(r.id,r.doc);
 return [...all.values()].filter(d=>!d.deleted && d.values.scope===scope && (includeArchived||!d.values.archived)).sort((a,b)=>a.values.order-b.values.order||a.id.localeCompare(b.id));
}
export function isVisible(doc,map){
 const visited=new Set(); let current=doc;
 while(current){if(current.deleted || visited.has(current.id))return false;visited.add(current.id);if(!current.parentId)return true;current=map.get(current.parentId)?.doc;if(!current)return false;}return true;
}
export function mergeEdited(current,edited,baseline){
 if(!baseline)return clone(edited);
 const out=clone(current);
 for(const key of ['parentId','deleted']){if(!same(edited[key],baseline[key])){if(!same(current[key],baseline[key])&&!same(current[key],edited[key]))throw new Error('編集中に別の画面で記録が変更されました。入力内容を控え、画面を開き直してください。');out[key]=edited[key];}}
 for(const key of new Set([...Object.keys(edited.values),...Object.keys(baseline.values)])){
  if(same(edited.values[key],baseline.values[key]))continue;
  if(!same(current.values[key],baseline.values[key])&&!same(current.values[key],edited.values[key]))throw new Error('同じ項目が別の画面で変更されました。入力内容を控え、画面を開き直してください。');
  if(edited.values[key]===undefined)delete out.values[key];else out.values[key]=edited.values[key];
 }
 return out;
}
export function validateDoc(d){
 if(!d||typeof d!=='object'||typeof d.id!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(d.id)||!KINDS.includes(d.kind)||typeof d.deleted!=='boolean'||(d.parentId!==null&&(typeof d.parentId!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(d.parentId)))||!d.values||typeof d.values!=='object'||Array.isArray(d.values))throw new Error('記録の形式が正しくありません。');
 if(JSON.stringify(d).length>250000)throw new Error('1件の記録が大きすぎます。');
 for(const [k,v] of Object.entries(d.values))if(['__proto__','constructor','prototype'].includes(k)||k.length>120||!(typeof v==='string'||typeof v==='number'||typeof v==='boolean'||v===null||Array.isArray(v)&&v.every(x=>typeof x==='string')))throw new Error('項目の形式が正しくありません。');
 if(['region','site','equipment','task'].includes(d.kind)&&(!String(d.values.name||'').trim()||String(d.values.name).length>300))throw new Error('名前は1～300文字で入力してください。');
 if(d.kind==='field'&&(!SCOPES[d.values.scope]||!TYPE_NAMES[d.values.type]||typeof d.values.key!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(d.values.key)||['__proto__','constructor','prototype'].includes(d.values.key)||!d.values.label||!Number.isFinite(d.values.order)||!Array.isArray(d.values.options)))throw new Error('入力項目の設定が正しくありません。');
 if(d.kind==='field'){const base=DEFAULT_FIELDS.find(f=>f.id===d.id);if(base&&(d.values.scope!==base.values.scope||d.values.key!==base.values.key||base.values.core&&(!d.values.core||!d.values.required||d.values.archived||d.deleted)))throw new Error('基本項目の設定が正しくありません。');}
 if(d.kind==='attachment'&&(!MIME_TYPES.includes(d.values.mime)||!Number.isFinite(d.values.size)||d.values.size<0||d.values.size>MAX_FILE_SIZE||typeof d.values.name!=='string'))throw new Error('添付ファイルの形式が正しくありません。');
 return d;
}
export function validateCollection(docs){
 const map=new Map();for(const d of docs){validateDoc(d);if(map.has(d.id))throw new Error('記録のIDが重複しています。');map.set(d.id,d);}
 for(const d of docs){const p=map.get(d.parentId);const allowed={site:['region'],equipment:['site'],task:['site'],attachment:['site','equipment']}[d.kind];if(allowed&&(!p||!allowed.includes(p.kind)))throw new Error('記録と事業場の対応が正しくありません。');if(!allowed&&d.parentId!==null)throw new Error('記録の階層が正しくありません。');}
 return docs;
}
export function localDateTime(){const d=new Date();return new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const deps=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
const {chromium}=deps?require(path.join(deps,'playwright')):require('playwright');
const JSZip=deps?require(path.join(deps,'jszip')):require('jszip');
const root=path.resolve(import.meta.dirname,'..');
const reportDir=path.join(root,'test-results');await fs.mkdir(reportDir,{recursive:true});
const publicDir=await fs.access(path.join(root,'dist')).then(()=>path.join(root,'dist')).catch(()=>path.join(root,'app'));
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json','.md':'text/plain','.sql':'text/plain'};
// A short-lived test fixture, not an application development or hosting server.
const server=http.createServer(async(req,res)=>{try{let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/testrepo\//,'');if(!name||name.endsWith('/'))name+='index.html';const target=path.resolve(publicDir,name);if(!target.startsWith(publicDir+path.sep))throw new Error('outside');const content=await fs.readFile(target);res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'});res.end(content);}catch{res.writeHead(404);res.end('Not found');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}/testrepo/`;
const browser=await chromium.launch({headless:true,executablePath:process.env.HOAN_TEST_CHROME||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
const errors=[];const checks=[];const contexts=[];let lastPage;
const pass=text=>{checks.push(text);console.log('PASS '+text);};
const capture=p=>{lastPage=p;p.on('pageerror',error=>errors.push(error.message));p.on('dialog',d=>d.accept());};
try{
 const ctx=await browser.newContext({viewport:{width:393,height:851},deviceScaleFactor:1,isMobile:true,hasTouch:true,acceptDownloads:true});contexts.push(ctx);const page=await ctx.newPage();capture(page);
 await page.goto(base);await page.getByRole('heading',{name:'今日の保安業務'}).waitFor();
 await page.locator('.home-card.main').click();await page.getByRole('button',{name:'最初の地域を追加'}).click();await page.locator('#region-name').fill('横浜市都筑区');await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('heading',{name:'横浜市都筑区',exact:true}).waitFor();
 await page.getByRole('link').filter({has:page.getByRole('heading',{name:'横浜市都筑区',exact:true})}).click();await page.getByRole('button',{name:'事業場を追加',exact:true}).click();await page.locator('[name="value-name"]').fill('都筑テスト事業場');await page.locator('[name="value-address"]').fill('横浜市都筑区（動作確認用）');await page.locator('[name="value-contact"]').fill('試験担当');await page.locator('[name="value-phone"]').fill('045-000-0000');await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('heading',{name:'都筑テスト事業場',exact:true}).waitFor();const siteHash=new URL(page.url()).hash;const siteId=siteHash.split('/')[2];
 pass('地域・事業場を登録し、詳細情報を保存');
 await page.goto(base+'#/settings/fields/site');await page.getByRole('button',{name:'＋ 項目追加'}).click();await page.locator('#field-label').fill('契約番号');assert.equal(await page.locator('#options-field').isVisible(),false);await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByText('契約番号',{exact:true}).waitFor();
 await page.goto(base+siteHash);await page.getByRole('button',{name:'編集',exact:true}).click();await page.getByLabel('契約番号',{exact:true}).fill('TEST-001');await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByText('TEST-001',{exact:true}).waitFor();await page.reload();await page.getByText('TEST-001',{exact:true}).waitFor();
 pass('共通項目の追加・入力・再読み込み後の保持');
 await page.getByRole('link',{name:'設備・図面'}).click();await page.getByRole('button',{name:'＋ 機器追加'}).click();await page.locator('[name="value-name"]').fill('LBS-1');await page.locator('[name="value-type"]').fill('高圧交流負荷開閉器');await page.locator('[name="value-maker"]').fill('試験メーカー');await page.locator('[name="value-year"]').fill('1982');await page.getByRole('button',{name:'保存',exact:true}).click();await page.locator('#dialog-title').filter({hasText:'LBS-1'}).waitFor();
 const png=await fs.readFile(path.join(publicDir,'icons/icon-192.png'));await page.locator('#dialog input[type=file]').setInputFiles({name:'銘板テスト.png',mimeType:'image/png',buffer:png});await page.locator('#dialog .attachment .file-name').filter({hasText:'銘板テスト.png'}).waitFor();await page.getByRole('button',{name:'閉じる',exact:true}).click();
 const pdf=Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
 await page.locator('main input[type=file]').setInputFiles({name:'平面図テスト.pdf',mimeType:'application/pdf',buffer:pdf});await page.locator('.attachment .file-name').filter({hasText:'平面図テスト.pdf'}).waitFor();
 pass('機器台帳と画像・PDFの端末保存');
 await page.getByRole('link',{name:'タスク',exact:true}).click();await page.getByRole('button',{name:'＋ タスク追加'}).click();await page.locator('[name="value-name"]').fill('接地工事の見積確認');await page.locator('[name="value-content"]').fill('工事会社へ見積書の提出予定日を確認する。');await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('heading',{name:'接地工事の見積確認'}).waitFor();await page.locator('select[data-status]').selectOption('先方待ち');await page.waitForTimeout(250);
 await page.screenshot({path:path.join(reportDir,'mobile-tasks.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
 await ctx.setOffline(true);await page.reload();await page.getByRole('heading',{name:'接地工事の見積確認'}).waitFor();await page.getByRole('button',{name:'＋ タスク追加'}).click();await page.locator('[name="value-name"]').fill('オフラインで登録した記録');await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('heading',{name:'オフラインで登録した記録'}).waitFor();await page.reload();await page.getByRole('heading',{name:'オフラインで登録した記録'}).waitFor();
 pass('通信遮断中の再起動・タスク追加・再保存');
 await ctx.setOffline(false);await page.goto(base+'#/settings');const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'バックアップを保存'}).click();const dl=await downloadEvent;const backupPath=path.join(reportDir,'fixture-backup.zip');await dl.saveAs(backupPath);const zip=await JSZip.loadAsync(await fs.readFile(backupPath));const data=JSON.parse(await zip.file('records.json').async('string'));assert.equal(data.records.filter(d=>d.kind==='attachment').length,2);assert.equal(Object.values(zip.files).filter(f=>!f.dir&&f.name.startsWith('files/')).length,2);assert.ok(!JSON.stringify(data).includes('access_token'));
 pass('記録・共通項目・写真・PDFを含むバックアップ（認証情報は含まない）');
 const restoreCtx=await browser.newContext({viewport:{width:1440,height:1000}});contexts.push(restoreCtx);const rp=await restoreCtx.newPage();capture(rp);await rp.goto(base+'#/settings');await rp.locator('#restore-file').setInputFiles(backupPath);await rp.locator('#dialog').getByRole('button',{name:'復元する',exact:true}).click();await rp.waitForFunction(()=>!document.querySelector('#dialog').open);await rp.goto(base+siteHash);await rp.getByText('TEST-001',{exact:true}).waitFor();await rp.screenshot({path:path.join(reportDir,'desktop-details.png'),fullPage:true});
 pass('別のブラウザ環境への完全復元とパソコン表示');
 await rp.goto(base+'#/settings');const bad=await JSZip.loadAsync(await fs.readFile(backupPath));const attachId=data.records.find(d=>d.kind==='attachment').id;bad.remove('files/'+attachId);const badPath=path.join(reportDir,'invalid-backup.zip');await fs.writeFile(badPath,await bad.generateAsync({type:'nodebuffer'}));await rp.locator('#restore-file').setInputFiles(badPath);await rp.locator('#toast').filter({hasText:'不足'}).waitFor();assert.equal(await rp.locator('#dialog').evaluate(el=>el.open),false);
 pass('添付欠落のバックアップは復元前に拒否');
 await rp.goto(base+siteHash);await rp.getByRole('button',{name:'⋯',exact:true}).click();await rp.getByRole('button',{name:'事業場をごみ箱へ移動'}).click();await rp.goto(base+'#/settings');await rp.getByRole('button',{name:'ごみ箱を開く'}).click();await rp.locator('#dialog').getByRole('button',{name:'戻す',exact:true}).click();await rp.getByRole('button',{name:'閉じる',exact:true}).click();await rp.goto(base+'#/site/'+siteId+'/tasks');await rp.getByRole('heading',{name:'オフラインで登録した記録'}).waitFor();
 pass('事業場の削除と復元で配下の記録を保持');

 const syncChecks=await rp.evaluate(async()=>{
  const {Store}=await import('./db.js');const {SyncEngine,sha256}=await import('./cloud.js');const {makeDoc,clone}=await import('./model.js');
  const shared=new Map(),receipts=new Map(),files=new Map();let loseNext=false,delayNext=null;
  const backend={async push(r){const previous=receipts.get(r.mutationId);if(previous)return previous;const current=shared.get(r.id);if((current?.version||0)!==r.version)return {status:'conflict',record:clone(current)};const version=(current?.version||0)+1;const row={id:r.id,doc:clone(r.doc),version,mutation_id:r.mutationId};shared.set(r.id,row);const result={status:'ok',version};receipts.set(r.mutationId,result);if(delayNext){const wait=delayNext;delayNext=null;await wait;}if(loseNext){loseNext=false;throw new Error('simulated lost response');}return result;},async list(){return {rows:clone([...shared.values()]),cursor:0};},async upload(id,blob){files.set(id,blob);},async download(id){return files.get(id);}};
  const a=await Store.open('sync-a-'+Date.now()),b=await Store.open('sync-b-'+Date.now());const ea=new SyncEngine(a,backend),eb=new SyncEngine(b,backend);const assert=(condition,text)=>{if(!condition)throw new Error(text);};const results=[];
  const region=makeDoc('region',null,{name:'同期テスト地域'});await a.save(region);await ea.sync();await eb.sync();assert((await b.get(region.id)).doc.values.name===region.values.name,'initial sync');results.push('独立した2端末の保存領域への同期');
  const ra=(await a.get(region.id)).doc,rb=(await b.get(region.id)).doc;const aa=clone(ra),bb=clone(rb);aa.values.name='端末Aの変更';bb.values.name='端末Bの変更';await a.save(aa,ra);await b.save(bb,rb);await ea.sync();await eb.sync();assert((await b.get(region.id)).conflict?.doc.values.name==='端末Aの変更','conflict must preserve remote');assert((await b.get(region.id)).doc.values.name==='端末Bの変更','conflict must preserve local');await b.resolve(region.id,true);await eb.sync();await ea.sync();assert((await a.get(region.id)).doc.values.name==='端末Bの変更','conflict resolved');results.push('競合した両方の内容の保全と選択後の共有');
  const extra=makeDoc('site',region.id,{name:'再送テスト'});await a.save(extra);loseNext=true;await ea.sync();assert((await a.get(extra.id)).dirty,'lost reply remains pending');await ea.sync();assert(!(await a.get(extra.id)).dirty,'retry receipt clears pending');assert(shared.get(extra.id).version===1,'retry must not create extra version');results.push('応答が失われた送信の安全な再試行');
  const before=(await a.get(extra.id)).doc;const first=clone(before);first.values.name='送信中の編集1';await a.save(first,before);let release;delayNext=new Promise(resolve=>release=resolve);const inFlight=ea.sync();await new Promise(resolve=>setTimeout(resolve,30));const second=clone(first);second.values.name='送信中の編集2';await a.save(second,first);release();await inFlight;assert((await a.get(extra.id)).dirty,'new edit remains pending after earlier acknowledgement');await ea.sync();await eb.sync();assert((await b.get(extra.id)).doc.values.name==='送信中の編集2','latest edit preserved');results.push('送信中に追加された編集を失わない');
  const blob=new Blob(['file-content'],{type:'application/pdf'});const file=makeDoc('attachment',extra.id,{name:'photo.pdf',mime:blob.type,size:blob.size,hash:await sha256(blob)});await a.addAttachment(file,blob);await ea.sync();await eb.sync();assert(await(await b.file(file.id)).text()==='file-content','binary file roundtrip');results.push('写真・PDFのアップロードと別端末への取得');
  const bas=(await a.get(extra.id)).doc;const deleted=clone(bas);deleted.deleted=true;await a.save(deleted,bas);await ea.sync();await eb.sync();assert((await b.get(extra.id)).doc.deleted,'delete propagation');results.push('削除情報の共有と記録の意図しない復活防止');
  await ea.stop();await eb.stop();a.close();b.close();return results;
 });syncChecks.forEach(pass);
 // Test the real REST adapter against an isolated API fixture. No external account is used.
 await restoreCtx.route('https://contract-test.supabase.co/**',async route=>{
  const request=route.request(),url=new URL(request.url()),headers=request.headers();assert.equal(headers.apikey,'sb_publishable_contracttest');let payload=true;
  if(url.pathname==='/auth/v1/token'){const body=request.postDataJSON();assert.ok(body.email==='test@example.invalid'||body.refresh_token);payload={access_token:'fixture-token',refresh_token:'fixture-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'00000000-0000-0000-0000-000000000001',email:'test@example.invalid'}};}
  else {assert.equal(headers.authorization,'Bearer fixture-token');if(url.pathname==='/rest/v1/rpc/hoan_changes')payload={rows:[],cursor:0};}
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)});
 });
 const result=await rp.evaluate(async()=>{const {Cloud}=await import('./cloud.js');const c=new Cloud({url:'https://contract-test.supabase.co',key:'sb_publishable_contracttest'},null);await c.login('test@example.invalid','fixture-password');const changes=await c.list();return {user:c.session.user.id,rows:changes.rows};});assert.equal(result.rows.length,0);
 pass('認証・公開キー・RESTリクエストの組み立て（API模擬環境）');
 await rp.goto(base+'#/');await rp.screenshot({path:path.join(reportDir,'desktop-home.png'),fullPage:true});
 for(const width of [360,393,768,1440]){await rp.setViewportSize({width,height:900});await rp.goto(base+'#/settings');assert.equal(await rp.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'horizontal overflow '+width);}
 pass('360 / 393 / 768 / 1440pxの各画面幅で横はみ出しなし');
 assert.deepEqual(errors,[]);pass('検証中の未処理JavaScript例外なし');
 await fs.writeFile(path.join(reportDir,'results.json'),JSON.stringify({date:new Date().toISOString(),checks,errors,liveCloudTested:false},null,2));
 console.log(`ALL ${checks.length} CHECKS PASSED`);
}catch(error){await fs.writeFile(path.join(reportDir,'failure.txt'),String(error.stack));if(lastPage){console.error((await lastPage.locator('body').innerText()).slice(-3000));await lastPage.screenshot({path:path.join(reportDir,'failure.png'),fullPage:true});}throw error;}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

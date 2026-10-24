'use strict';
const LINES = ['7011','7021','7022','7023','7025','7041','7042','7051','7053','7054','7060','SERIGRAFIA','PRE'];
const HISTORICAL_LINES = [...LINES,'7052','TODAS'];
const TOPICS = [
  {key:'requisicoes',label:'Requisições',short:'Requisições',color:'#93bfe1'},
  {key:'absenteismo',label:'Absenteísmo',short:'Absenteísmo',color:'#dda29c'},
  {key:'produtividade',label:'Produtividade',short:'Produtividade',color:'#d8ca8b'},
  {key:'qualidade',label:'Qualidade',short:'Qualidade',color:'#a6d9a4'},
  {key:'tpm',label:'TPM',short:'TPM',color:'#b7abd9'}
];
const $ = id => document.getElementById(id);
const icon = id => `<svg aria-hidden="true"><use href="#i-${id}"/></svg>`;
const escapeText = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let productionStartDate = '', productionEndDate = '';
function productionDateVisible(day) { return (!productionStartDate||day>=productionStartDate)&&(!productionEndDate||day<=productionEndDate); }
function productionHasRange() { return !!(productionStartDate||productionEndDate); }
function productionRangeLabel() { return productionHasRange()?fmtPeriod(productionStartDate||productionLoaded+'-01')+' a '+fmtPeriod(productionEndDate||$('productionEndDate').max):fmtPeriod(productionLoaded); }
function productionRangeFilename() { return productionHasRange()?(productionStartDate||productionLoaded+'-01')+'_a_'+(productionEndDate||$('productionEndDate').max):productionLoaded; }
let productionReadOnly = false;
let selectedProductionLines = null;
let productionDirty = new Map(), productionLoaded = '', productionSaving = false;
let view = 'home', adminMode = false, currentLine = null, viewToken = 0, readToken = 0;
let pendingImages = {}, dirtyKeys = new Set(), busy = false, editable = false, loadedPeriod = '', activeUpload = null;
let toastTimer, confirmResolve = null, monthEntries = [], lineEntries = [], busyDepth = 0, lastMonth = '', lastDashPeriod = ''; 
function todayISO(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const value = type => parts.find(p => p.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
function yesterdayISO(today = todayISO()) { const d = new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10); }
function validDate(value) { if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T12:00:00Z');return !isNaN(d)&&d.toISOString().slice(0,10)===value; }
function isMonthly(line=currentLine) { return !!line?.startsWith('MENSAL:'); }
function validPeriod(line,value) { return isMonthly(line)?typeof value==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(value):validDate(value); }
function initialPeriod(line) { return isMonthly(line)?todayISO().slice(0,7):todayISO(); }
function lineName(line) { return isMonthly(line)?line.slice(7):line; }
function fmtPeriod(value) { return value.length===7?new Date(value+'-01T12:00:00Z').toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo',month:'long',year:'numeric'}):value.split('-').reverse().join('/'); }
function countImages(entry) { return TOPICS.filter(t=>entry?.images?.[t.key]).length; }
function lineStatus(entries,line,today=todayISO()) {
  const entry = entries.find(e=>e.line===line&&e.date===today) || entries.find(e=>e.line===line&&e.date===yesterdayISO(today));
  return {entry,status:entry?(entry.date===today?'today':'yesterday'):null};
}
function notify(message,error=false,duration=5500) { $('toast').textContent=message;$('toast').className='toast'+(error?' error':'');$('toast').hidden=false;clearTimeout(toastTimer);if(duration)toastTimer=setTimeout(()=>$('toast').hidden=true,duration); }
function failure(error) { console.error(error);notify(error?.message||'Não foi possível concluir. Tente novamente.',true); }
function connection(ready) { $('connection').className='connection '+(ready?'ready':'error');$('connection').innerHTML=`<i></i><span>${ready?'Nuvem conectada':'Sem conexão'}</span>`; }
async function cloudRequest(path,options={}) {
  let response;
  try { response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,headers:{'Content-Type':'application/json',...options.headers}}); }
  catch { connection(false);throw new Error('Sem conexão com o painel. Verifique a internet e tente novamente.'); }
  if(!response.ok) {
    const body=await response.json().catch(()=>({}));
    if(response.status===401||response.status===403)throw new Error(body.error||'Sua sessão expirou. Atualize a página para entrar novamente.');
    throw new Error(body.error||'Não foi possível acessar os dados na nuvem. Tente novamente.');
  }
  if(response.status===204){connection(true);return null;}
  const data=await response.json().catch(()=>{throw new Error('Sua sessão pode ter expirado. Atualize a página para entrar novamente.');});
  connection(true);return data;
}
const allEntries=()=>cloudRequest('/api/entries');
const lineHistory=line=>cloudRequest('/api/entries?line='+encodeURIComponent(line));
const getEntry=(line,date)=>cloudRequest('/api/entries?line='+encodeURIComponent(line)+'&date='+encodeURIComponent(date));
function setBusy(value) {
  busyDepth=Math.max(0,busyDepth+(value?1:-1));busy=busyDepth>0;document.body.classList.toggle('busy-screen',busy);
  document.querySelectorAll('[data-block],#entryPeriod,#saveEntryBtn,#exportBtn,#importBtn').forEach(n=>n.disabled=busy);
  syncEditState();
  for(const n of document.querySelectorAll('#productionTable input,#productionMonth,#productionSave,#productionRefresh,#productionStartDate,#productionEndDate'))n.disabled=busy;
}
function confirmAction(title,message,accept='Confirmar',destructive=false) {
  if(confirmResolve)return Promise.resolve(false);
  $('confirmTitle').textContent=title;$('confirmText').textContent=message;$('confirmAccept').textContent=accept;$('confirmAccept').className='button '+(destructive?'danger':'primary');
  $('confirmDialog').showModal();$('confirmCancel').focus();
  return new Promise(resolve=>confirmResolve=resolve);
}
function resolveConfirm(accepted) { const resolve=confirmResolve;confirmResolve=null;$('confirmDialog').close();resolve?.(accepted); }
$('confirmAccept').onclick=()=>resolveConfirm(true);$('confirmCancel').onclick=()=>resolveConfirm(false);
$('confirmDialog').addEventListener('cancel',e=>{e.preventDefault();resolveConfirm(false);});
async function canLeave() { if(busy){notify('Aguarde o processamento terminar.');return false;}return !(dirtyKeys.size||productionDirty.size)||await confirmAction('Descartar alterações?','Existem alterações ainda não salvas. Deseja sair e descartar essas alterações?','Descartar',true); }
function closeSidebar() { $('sidebar').classList.remove('open');$('sidebarShade').hidden=true;$('menuToggle').setAttribute('aria-expanded','false'); }
$('menuToggle').onclick=()=>{const open=!$('sidebar').classList.contains('open');$('sidebar').classList.toggle('open',open);$('sidebarShade').hidden=!open;$('menuToggle').setAttribute('aria-expanded',String(open));};
$('sidebarShade').onclick=closeSidebar;
async function changeView(next,nav,breadcrumb) {
  if(!await canLeave())return false;
  productionDirty.clear();view=next;viewToken++;readToken++;dirtyKeys.clear();editable=false;closeSidebar();
  document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('active',s.id==='screen-'+next));
  document.querySelectorAll('[data-nav]').forEach(b=>{b.classList.toggle('active',b.dataset.nav===nav);if(b.dataset.nav===nav)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  $('breadcrumb').textContent=breadcrumb;window.scrollTo({top:0});
  const title=$('screen-'+next).querySelector('h1');if(title){title.tabIndex=-1;title.focus({preventScroll:true});}
  return true;
}
function loading(container) { container.innerHTML='<div class="loading" role="status">Carregando indicadores…</div>'; }
function renderError(container,error,retry) {
  container.replaceChildren();const box=document.createElement('div');box.className='empty-state error-state';
  const title=document.createElement('h3');title.textContent='Não foi possível carregar';const p=document.createElement('p');p.textContent=error.message;
  const button=document.createElement('button');button.className='button secondary';button.textContent='Tentar novamente';button.onclick=()=>retry().catch(failure);box.append(title,p,button);container.append(box);
}
function stat(label,value,detail,symbol,positive=false) { return `<div class="stat"><div class="stat-top"><span>${label}</span>${icon(symbol)}</div><b>${value}</b><small class="${positive?'positive':''}">${detail}</small></div>`; }
async function openHome() { if(!await changeView('home','home','Visão geral'))return;await updateHome(); }
async function updateHome() {
  const token=viewToken;
  try {
    const entries=await allEntries();if(token!==viewToken||view!=='home')return;
    const today=todayISO(),month=today.slice(0,7);
    const daily=entries.filter(e=>LINES.includes(e.line));
    const updated=new Set(daily.filter(e=>e.date===today).map(e=>e.line)).size;
    const recent=LINES.filter(line=>lineStatus(daily,line,today).status).length;
    const monthly=entries.filter(e=>isMonthly(e.line)&&LINES.includes(lineName(e.line))&&e.date===month).length;
    $('summary').innerHTML=stat('Linhas e setores',LINES.length,'Em acompanhamento','grid')+stat('Atualizadas hoje',updated,`${recent} com lançamento hoje ou ontem`,'check',true)+stat('Relatórios mensais',monthly,`Linhas com imagens neste mês`,'month')+stat('Lançamentos salvos',entries.length,'Histórico disponível na nuvem','file');
    $('homeLines').replaceChildren();
    for(const line of LINES) {
      const {status}=lineStatus(entries,line,today),b=document.createElement('button');b.className='home-line'+(status?' supplied':'');
      b.innerHTML=`<i class="dot"></i><strong>${line}</strong><span>${status==='today'?'Hoje':status==='yesterday'?'Ontem':'Pendente'}</span>`;
      b.onclick=()=>openDash(line).catch(failure);$('homeLines').append(b);
    }
  }catch(e){if(token===viewToken&&view==='home'){renderError($('summary'),e,updateHome);$('homeLines').replaceChildren();}throw e;}
}
async function openMenu(admin) {
  if(!await changeView('menu',admin?'admin':'coord',admin?'Lançamentos':'Coordenador'))return;
  adminMode=admin;$('menuTitle').textContent=admin?'Lançamentos':'Coordenador';$('menuDesc').textContent=admin?'Organize as imagens da operação por data ou mês.':'Consulte os indicadores diários e relatórios mensais.';
}
async function openLines(admin=adminMode) {
  if(!await changeView('lines',admin?'admin':'coord','Indicadores diários'))return;
  adminMode=admin;$('linesBackLabel').textContent=admin?'Lançamentos':'Coordenador';$('linesTitle').textContent=admin?'Selecione a linha para lançar':'Escolha sua linha';$('lineSearch').value='';$('lineFilter').value='all';await refreshLines();
}
async function refreshLines() {
  const token=viewToken;loading($('linesGrid'));$('lineNoResults').hidden=true;
  try { const entries=await allEntries();if(token!==viewToken||view!=='lines')return;lineEntries=entries;renderLines(); }
  catch(e){if(token===viewToken)renderError($('linesGrid'),e,refreshLines);throw e;}
}
function renderLines() {
  const q=$('lineSearch').value.trim().toLocaleLowerCase('pt-BR'),filter=$('lineFilter').value;
  $('linesGrid').replaceChildren();let count=0;
  for(const line of LINES) {
    const {status,entry}=lineStatus(lineEntries,line);
    if(!line.toLocaleLowerCase('pt-BR').includes(q)||(filter==='supplied'&&!status)||(filter==='pending'&&status))continue;
    const b=document.createElement('button');b.className='line-tile'+(status?' supplied':'')+(line.length>5?' small-label':'');
    b.innerHTML=`<span class="tile-kicker">${line.length>5?'SETOR':'LINHA DE PRODUÇÃO'}<i></i></span><h3>${line}</h3><span class="line-status">${status==='today'?'Abastecida hoje':status==='yesterday'?'Abastecida ontem':'Sem lançamento hoje ou ontem'}</span><span class="tile-bottom"><span>${status?countImages(entry)+' de 5 indicadores':'Adicionar ou consultar histórico'}</span>${icon('arrow')}</span>`;
    b.onclick=()=> (adminMode?openEntry(line):openDash(line)).catch(failure);$('linesGrid').append(b);count++;
  }
  $('lineNoResults').hidden=!!count;
}
async function openMonthly(admin=false,period) {
  if(!await changeView('month','monthly','Geral mensal'))return;
  adminMode=admin;$('monthBackLabel').textContent=admin?'Lançamentos':'Coordenador';$('monthPeriod').value=period||todayISO().slice(0,7);lastMonth=$('monthPeriod').value;$('monthSearch').value='';$('monthFilter').value='all';await refreshMonthly();
}
async function refreshMonthly() {
  const period=$('monthPeriod').value,token=viewToken;
  if(!validPeriod('MENSAL:7011',period)){notify('Selecione um mês válido.',true);$('monthPeriod').value=lastMonth;return;}
  lastMonth=period;loading($('monthRows'));$('monthNoResults').hidden=true;
  try {const entries=await allEntries();if(token!==viewToken||view!=='month')return;monthEntries=entries;renderMonthly();}
  catch(e){if(token===viewToken){renderError($('monthRows'),e,refreshMonthly);$('monthSummary').replaceChildren();}throw e;}
}
function renderMonthly() {
  const period=$('monthPeriod').value;if(!validPeriod('MENSAL:7011',period))return;
  const entries=monthEntries.filter(e=>isMonthly(e.line)&&e.date===period&&LINES.includes(lineName(e.line)));
  const complete=entries.filter(e=>countImages(e)===5).length,total=entries.reduce((sum,e)=>sum+countImages(e),0);
  $('monthSummary').innerHTML=stat('Linhas completas',complete,`De ${LINES.length} linhas e setores`,'check',true)+stat('Imagens no mês',total,`De ${LINES.length*5} relatórios possíveis`,'file')+stat('Linhas com pendências',LINES.length-complete,fmtPeriod(period),'month');
  $('monthRows').replaceChildren();let count=0;
  const query=$('monthSearch').value.trim().toLocaleLowerCase('pt-BR'),filter=$('monthFilter').value;
  for(const line of LINES) {
    const id='MENSAL:'+line,entry=entries.find(e=>e.line===id),images=entry?.images||{},covered=countImages(entry);
    if(!line.toLocaleLowerCase('pt-BR').includes(query)||(filter==='complete'&&covered!==5)||(filter==='pending'&&covered===5))continue;
    const row=document.createElement('div');row.className='month-row';
    const name=document.createElement('button');name.className='month-line-btn';name.innerHTML=`${line}<small>${line.length>5?'SETOR':'LINHA DE PRODUÇÃO'}</small>`;name.onclick=()=>openDash(id,period).catch(failure);row.append(name);
    for(const topic of TOPICS) {
      const src=images[topic.key],cell=document.createElement(src?'button':'div');cell.className='month-image-cell'+(src?'':' missing');
      if(src){const img=document.createElement('img');img.src=src;img.alt=topic.label+' — '+line+' — '+fmtPeriod(period);img.loading='lazy';cell.append(img);cell.insertAdjacentHTML('beforeend',icon('check'));cell.title='Ampliar '+topic.label;cell.setAttribute('aria-label','Ampliar '+img.alt);cell.onclick=()=>openImage(src,img.alt);}
      else {cell.innerHTML='<span>—</span>';cell.title=topic.label+': sem relatório';cell.setAttribute('aria-label',topic.label+': sem relatório');}
      const label=document.createElement('span');label.className='cell-label';label.textContent=topic.short;cell.append(label);row.append(cell);
    }
    const coverage=document.createElement('div');coverage.className='month-coverage';coverage.innerHTML=`<strong>${covered} / 5 imagens</strong><div class="progress"><i style="width:${covered*20}%"></i></div>`;
    const action=document.createElement('button');action.textContent=adminMode?'Lançar imagens →':'Ver relatórios →';action.onclick=()=> (adminMode?openEntry(id,period):openDash(id,period)).catch(failure);coverage.append(action);row.append(coverage);$('monthRows').append(row);count++;
  }
  $('monthNoResults').hidden=!!count;
}
async function openDash(line,period) {
  if(!await changeView('dash',isMonthly(line)?'monthly':'coord',isMonthly(line)?'Relatórios mensais':'Painel da linha'))return;
  currentLine=line;$('dashTitle').textContent=(line.length>5&&!isMonthly(line)?'Setor ':'Linha ')+lineName(line);$('dashEyebrow').textContent=isMonthly(line)?'RELATÓRIOS MENSAIS':'INDICADORES DIÁRIOS';$('dashSubtitle').textContent=isMonthly(line)?'Requisições, absenteísmo, produtividade, qualidade e TPM do mês.':'Requisições, absenteísmo, produtividade, qualidade e TPM por data.';
  $('dashBackLabel').textContent=isMonthly(line)?'Geral da linha no mês':'Todas as linhas';$('dashPeriod').type=isMonthly(line)?'month':'date';$('dashPeriod').value=period||initialPeriod(line);lastDashPeriod=$('dashPeriod').value;$('dashHistory').replaceChildren(new Option('Períodos salvos',''));loading($('dashContent'));
  const token=viewToken;
  try {const history=await lineHistory(line);if(token!==viewToken)return;history.forEach(e=>$('dashHistory').add(new Option(fmtPeriod(e.date),e.date)));if(!period&&history.length)$('dashPeriod').value=history[0].date;await renderDash();}
  catch(e){if(token===viewToken)renderError($('dashContent'),e,()=>openDash(line,period));throw e;}
}
async function renderDash() {
  const period=$('dashPeriod').value,line=currentLine,token=++readToken;
  if(!validPeriod(line,period)){notify('Selecione um período válido.',true);$('dashPeriod').value=lastDashPeriod;return;}
  lastDashPeriod=period;loading($('dashContent'));
  try {const entry=await getEntry(line,period);if(token!==readToken||view!=='dash')return;const images=entry?.images||{};
    $('dashStatus').textContent=countImages(entry)+' de 5 indicadores disponíveis';$('dashHistory').value=Array.from($('dashHistory').options).some(o=>o.value===period)?period:'';
    $('dashContent').replaceChildren();
    for(const topic of TOPICS){
      const card=document.createElement('article');card.className='topic-card';card.style.setProperty('--topic',topic.color);card.innerHTML=`<div class="topic-label"><span><i></i>${topic.label}</span><small>${images[topic.key]?'SALVO':'PENDENTE'}</small></div>`;
      const box=document.createElement(images[topic.key]?'button':'div');box.className='image-box'+(images[topic.key]?'':' empty');
      if(images[topic.key]){const img=document.createElement('img');img.src=images[topic.key];img.alt=topic.label+' — '+lineName(line)+' — '+fmtPeriod(period);box.append(img);box.setAttribute('aria-label','Ampliar '+img.alt);box.onclick=()=>openImage(img.src,img.alt);}
      else box.innerHTML=icon('file')+'<span>Nenhuma imagem neste período</span>';
      const foot=document.createElement('div');foot.className='topic-foot';foot.textContent=images[topic.key]?'Clique na imagem para ampliar':'Use Atualizar indicadores para adicionar';card.append(box,foot);$('dashContent').append(card);
    }
  }catch(e){if(token===readToken)renderError($('dashContent'),e,renderDash);throw e;}
}
function openImage(src,caption) { $('fullImage').src=src;$('fullImage').alt=caption;$('imageCaption').textContent=caption;$('imageDialog').showModal();$('closeImage').focus(); }
$('closeImage').onclick=()=>$('imageDialog').close();$('imageDialog').addEventListener('close',()=>$('fullImage').removeAttribute('src'));
for(const id of ['imageDialog','uploadDialog'])$(id).onclick=e=>{if(e.target===$(id)){const rect=$(id).getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)$(id).close();}};
function syncEditState() {
  if(view!=='entry')return;
  const count=TOPICS.filter(t=>pendingImages[t.key]).length;
  $('entryCount').textContent=count+' de 5 imagens';$('editState').textContent=busy?'Processando…':dirtyKeys.size?dirtyKeys.size+' indicador(es) com alteração pendente':'Nenhuma alteração pendente';$('editState').className='edit-state'+(dirtyKeys.size?' pending':'');
  $('saveEntryBtn').disabled=busy||!editable||!dirtyKeys.size;
  document.querySelectorAll('.topic-save').forEach(b=>b.disabled=busy||!editable||!dirtyKeys.has(b.dataset.topic));
}
function renderUploadTile(key) {
  const topic=TOPICS.find(t=>t.key===key),card=$('upload-'+key);if(!card)return;
  card.classList.toggle('dirty',dirtyKeys.has(key));const zone=card.querySelector('.upload-zone');zone.replaceChildren();
  const src=pendingImages[key];
  if(src){const img=document.createElement('img');img.src=src;img.alt='Prévia de '+topic.label;zone.append(img);}
  else zone.innerHTML=icon('upload')+'<span>Adicionar imagem</span><small>Arquivo, colagem ou arraste aqui</small>';
  card.querySelector('.remove').hidden=!src;card.querySelector('.topic-label small').textContent=dirtyKeys.has(key)?'ALTERADO':src?'SALVO':'PENDENTE';syncEditState();
}
function buildUploadGrid() {
  $('uploadGrid').replaceChildren();
  for(const topic of TOPICS){
    const card=document.createElement('article');card.className='upload-card';card.id='upload-'+topic.key;card.style.setProperty('--topic',topic.color);
    card.innerHTML=`<div class="topic-label"><span><i></i>${topic.label}</span><small>PENDENTE</small></div><button class="upload-zone" data-block aria-label="Adicionar ou substituir imagem de ${topic.label}"></button><div class="upload-actions"><button class="button secondary topic-save" data-block data-topic="${topic.key}">${icon('check')}Atualizar indicador</button><button class="remove" data-block aria-label="Remover imagem de ${topic.label}">${icon('trash')}</button></div><input hidden type="file" id="file-${topic.key}" accept="image/png,image/jpeg,image/webp">`;
    card.querySelector('.upload-zone').onclick=()=>openUpload(topic.key);
    card.querySelector('.remove').onclick=()=>{if(busy||!editable)return;delete pendingImages[topic.key];dirtyKeys.add(topic.key);renderUploadTile(topic.key);};
    card.querySelector('.topic-save').onclick=()=>saveKeys([topic.key]).catch(failure);
    card.querySelector('input').onchange=e=>{const file=e.target.files[0];e.target.value='';if(file)processImage(file,topic.key).catch(failure);};
    card.ondragover=e=>{e.preventDefault();if(!busy&&editable)card.classList.add('dragging');};card.ondragleave=()=>card.classList.remove('dragging');
    card.ondrop=e=>{e.preventDefault();card.classList.remove('dragging');const file=e.dataTransfer?.files[0];if(file)processImage(file,topic.key).catch(failure);};$('uploadGrid').append(card);renderUploadTile(topic.key);
  }
}
async function openEntry(line,period) {
  if(!await changeView('entry',isMonthly(line)?'monthly':'admin',isMonthly(line)?'Lançamento mensal':'Lançamento diário'))return;
  adminMode=true;currentLine=line;pendingImages={};dirtyKeys.clear();loadedPeriod=period||initialPeriod(line);
  $('entryTitle').textContent=(lineName(line).length>5?'Setor ':'Linha ')+lineName(line);$('entryEyebrow').textContent=isMonthly(line)?'LANÇAMENTO MENSAL':'LANÇAMENTO DIÁRIO';$('entryBackLabel').textContent=isMonthly(line)?'Geral da linha no mês':'Todas as linhas';$('entryPeriod').type=isMonthly(line)?'month':'date';$('entryPeriod').value=loadedPeriod;$('entryPeriodLabel').textContent=isMonthly(line)?'Mês de referência':'Data do lançamento';buildUploadGrid();loading($('entryHistory'));
  try {await loadEntry(loadedPeriod);await refreshHistory();}
  catch(e){if(view==='entry'&&!editable)renderError($('uploadGrid'),e,()=>openEntry(line,loadedPeriod));throw e;}
}
async function loadEntry(period) {
  if(!validPeriod(currentLine,period))throw new Error('Selecione uma data ou um mês válido.');
  const line=currentLine,token=viewToken;setBusy(true);
  try {const entry=await getEntry(line,period);if(token!==viewToken)return;pendingImages={...(entry?.images||{})};dirtyKeys.clear();loadedPeriod=period;$('entryPeriod').value=period;editable=true;TOPICS.forEach(t=>renderUploadTile(t.key));}
  finally {setBusy(false);}
}
$('entryPeriod').onchange=async()=>{
  const requested=$('entryPeriod').value,previous=loadedPeriod;
  if(!validPeriod(currentLine,requested)){notify('Selecione um período válido.',true);$('entryPeriod').value=previous;return;}
  if(!await canLeave()){$('entryPeriod').value=previous;return;}
  try{await loadEntry(requested);}catch(e){$('entryPeriod').value=previous;failure(e);}
};
async function refreshHistory() {
  const line=currentLine,token=viewToken;
  try {
    const entries=await lineHistory(line);if(token!==viewToken||view!=='entry')return;$('entryHistory').replaceChildren();
    if(!entries.length){$('entryHistory').innerHTML='<div class="empty-state"><h3>Seu histórico começa aqui</h3><p>Adicione uma imagem e salve o primeiro lançamento.</p></div>';return;}
    for(const entry of entries){
      const row=document.createElement('div');row.className='history-row';
      const date=document.createElement('div');date.className='history-date';date.textContent=fmtPeriod(entry.date);const detail=document.createElement('small');detail.textContent=countImages(entry)+' de 5 indicadores';date.append(detail);
      const thumbs=document.createElement('div');thumbs.className='history-thumbs';
      for(const topic of TOPICS){const src=entry.images[topic.key];if(src){const img=document.createElement('img');img.src=src;img.alt=topic.label;img.title=topic.label;img.loading='lazy';thumbs.append(img);}else{const miss=document.createElement('div');miss.className='miss';miss.title=topic.label+': sem imagem';thumbs.append(miss);}}
      const actions=document.createElement('div');actions.className='history-actions';
      const edit=document.createElement('button');edit.className='button secondary';edit.textContent='Editar';edit.setAttribute('data-block','');edit.onclick=async()=>{if(!await canLeave())return;try{await loadEntry(entry.date);window.scrollTo({top:0,behavior:'smooth'});}catch(e){failure(e);}};
      const del=document.createElement('button');del.className='button secondary delete';del.innerHTML=icon('trash')+'Excluir';del.setAttribute('data-block','');del.setAttribute('aria-label','Excluir lançamento de '+fmtPeriod(entry.date));
      del.onclick=async()=>{if(!await canLeave())return;if(!await confirmAction('Excluir lançamento?','As imagens de '+fmtPeriod(entry.date)+' desta linha serão removidas.','Excluir',true))return;setBusy(true);try{await cloudRequest('/api/entries',{method:'DELETE',body:JSON.stringify({line,date:entry.date})});await loadEntry(loadedPeriod);await refreshHistory();notify('Lançamento excluído.');}catch(e){failure(e);}finally{setBusy(false);}};
      actions.append(edit,del);row.append(date,thumbs,actions);$('entryHistory').append(row);
    }
  }catch(e){if(token===viewToken)renderError($('entryHistory'),e,refreshHistory);throw e;}
}
async function compressImage(file) {
  if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Escolha uma imagem JPG, PNG ou WebP.');
  if(file.size>20*1024*1024)throw new Error('O arquivo deve ter até 20 MB.');
  const url=URL.createObjectURL(file);
  try {
    const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Não foi possível abrir esta imagem. Escolha outro arquivo.'));img.src=url;});
    if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>80_000_000)throw new Error('A resolução desta imagem é muito grande. Reduza a imagem e envie novamente.');
    if(file.size<=2*1024*1024&&Math.max(image.naturalWidth,image.naturalHeight)<=2400) {
      return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Não foi possível ler o arquivo.'));reader.readAsDataURL(file);});
    }
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');if(!ctx)throw new Error('Não foi possível preparar a imagem neste navegador.');
    for(const max of [2400,2000,1600,1200]){
      const scale=Math.min(1,max/Math.max(image.naturalWidth,image.naturalHeight));canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
      for(const quality of [.92,.85,.75]){const src=canvas.toDataURL('image/jpeg',quality);if(src.length<=Math.ceil(2*1024*1024/3)*4+30)return src;}
    }
    throw new Error('A imagem continua muito grande. Reduza o arquivo antes de enviar.');
  }finally{URL.revokeObjectURL(url);}
}
async function processImage(file,key) {
  if(busy||!editable)return;
  const line=currentLine,period=loadedPeriod;setBusy(true);
  try {const src=await compressImage(file);if(line!==currentLine||period!==loadedPeriod)return;pendingImages[key]=src;dirtyKeys.add(key);renderUploadTile(key);$('uploadDialog').close();notify('Imagem adicionada. Salve as alterações para confirmar.');}
  finally{setBusy(false);}
}
function openUpload(key) { if(busy||!editable)return;activeUpload=key;$('uploadTitle').textContent='Adicionar '+TOPICS.find(t=>t.key===key).label;$('pasteCatcher').value='';$('uploadDialog').showModal();$('pasteCatcher').focus(); }
$('closeUpload').onclick=()=>$('uploadDialog').close();$('uploadDialog').addEventListener('close',()=>activeUpload=null);
$('chooseUpload').onclick=()=>{if(activeUpload&&!busy)$('file-'+activeUpload).click();};
$('pasteCatcher').onpaste=e=>{e.preventDefault();const item=Array.from(e.clipboardData?.items||[]).find(i=>i.type.startsWith('image/'));if(item&&activeUpload)processImage(item.getAsFile(),activeUpload).catch(failure);else notify('Copie uma imagem ou selecione um arquivo.',true);};
async function saveKeys(keys) {
  if(busy||!editable)return;
  keys=keys.filter(k=>dirtyKeys.has(k));if(!keys.length){notify('Adicione ou altere uma imagem antes de salvar.');return;}
  const line=currentLine,period=loadedPeriod;
  if(!validPeriod(line,period)||$('entryPeriod').value!==period)throw new Error('Selecione um período válido antes de salvar.');
  const removed=keys.filter(k=>!pendingImages[k]);
  if(removed.length&&!await confirmAction('Remover imagens?','As imagens de '+removed.map(k=>TOPICS.find(t=>t.key===k).label).join(', ')+' serão removidas deste período.','Salvar e remover',true))return;
  const changes=Object.fromEntries(keys.filter(k=>pendingImages[k]).map(k=>[k,pendingImages[k]]));
  setBusy(true);
  try {
    const result=await cloudRequest('/api/entries',{method:'PUT',body:JSON.stringify({line,date:period,images:changes,topics:keys})});
    keys.forEach(k=>dirtyKeys.delete(k));
    // Refresh saved URLs, while keeping any other unsaved indicator intact.
    for(const topic of TOPICS){if(dirtyKeys.has(topic.key))continue;const src=result.entry?.images?.[topic.key];if(src)pendingImages[topic.key]=src;else delete pendingImages[topic.key];renderUploadTile(topic.key);}
    try{await refreshHistory();}catch{notify('Imagens salvas. Atualize o histórico para consultá-las.',false);return;}
    notify(keys.length===1?TOPICS.find(t=>t.key===keys[0]).label+' atualizado com sucesso.':'Alterações salvas na nuvem.');
  }finally{setBusy(false);}
}
$('saveEntryBtn').onclick=()=>saveKeys([...dirtyKeys]).catch(failure);
async function blobDataURL(blob) { return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Não foi possível ler a imagem.'));reader.readAsDataURL(blob);}); }
async function exportBackup() {
  if(busy)return;setBusy(true);
  try {
    const entries=await allEntries();let images=0;
    notify('Preparando o backup com dados e imagens…',false,0);
    for(const entry of entries)for(const key of Object.keys(entry.images)){
      const response=await fetch(entry.images[key],{credentials:'same-origin'});if(!response.ok)throw new Error('Não foi possível baixar uma imagem do backup. Tente novamente.');const blob=await response.blob();if(!['image/jpeg','image/png','image/webp'].includes(blob.type))throw new Error('Sua sessão expirou. Atualize a página para exportar.');entry.images[key]=await blobDataURL(blob);images++;
    }
    const blob=new Blob([JSON.stringify({version:2,exportedAt:new Date().toISOString(),entries})],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='producao-backup-'+todayISO()+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);notify('Backup exportado: '+entries.length+' lançamento(s) e '+images+' imagem(ns).');
  }finally{setBusy(false);}
}
function validateBackup(data) {
  if(!data||data.version!==2||!Array.isArray(data.entries)||data.entries.length>10000)throw new Error('Formato de backup inválido.');
  const seen=new Set();
  for(const entry of data.entries){
    if(!entry||typeof entry.line!=='string'||!HISTORICAL_LINES.includes(lineName(entry.line))||!validPeriod(entry.line,entry.date)||entry.id!==entry.line+':'+entry.date||seen.has(entry.id)||!entry.images||typeof entry.images!=='object'||Array.isArray(entry.images))throw new Error('O backup contém um lançamento inválido.');
    seen.add(entry.id);const keys=Object.keys(entry.images);
    if(!keys.length||keys.some(k=>!TOPICS.some(t=>t.key===k)||typeof entry.images[k]!=='string'||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(entry.images[k])))throw new Error('O backup contém uma imagem inválida.');
  }
  return data.entries;
}
async function importBackup(file) {
  if(busy)return;if(file.size>100*1024*1024)throw new Error('O backup deve ter até 100 MB.');
  let data;try{data=JSON.parse(await file.text());}catch{throw new Error('O arquivo não contém um backup JSON válido.');}
  const entries=validateBackup(data);if(!entries.length){notify('O backup está vazio.');return;}
  if(!await confirmAction('Importar backup?',`${entries.length} lançamento(s) serão importados. Os registros da mesma linha e período serão substituídos. Os demais serão preservados.`,'Importar'))return;
  setBusy(true);let imported=0;
  try {
    for(const entry of entries){
      notify(`Importando lançamento ${imported+1} de ${entries.length}…`,false,0);
      const normalized={...entry,images:{}};
      for(const [key,src] of Object.entries(entry.images)){const blob=await (await fetch(src)).blob();normalized.images[key]=await compressImage(blob);}
      await cloudRequest('/api/import',{method:'POST',body:JSON.stringify({version:2,entries:[normalized]})});imported++;
    }
    await updateHome();notify('Backup importado: '+imported+' lançamento(s).');
  }catch(error){throw new Error(`Importação interrompida após ${imported} de ${entries.length} lançamento(s). Você pode importar novamente. ${error.message}`);}
  finally{setBusy(false);}
}
$('exportBtn').onclick=()=>exportBackup().catch(failure);$('importBtn').onclick=()=>{if(!busy)$('importFile').click();};
$('importFile').onchange=e=>{const file=e.target.files[0];e.target.value='';if(file)importBackup(file).catch(failure);};
$('goCoord').onclick=() =>openMenu(false).catch(failure);$('goAdmin').onclick=()=>openMenu(true).catch(failure);$('newEntryBtn').onclick=()=>openMenu(true).catch(failure);$('heroCoord').onclick=()=>openLines(false).catch(failure);$('homeAllLines').onclick=()=>openLines(false).catch(failure);
$('backFromMenu').onclick=()=>openHome().catch(failure);$('dailyMode').onclick=()=>openLines(adminMode).catch(failure);$('monthlyMode').onclick=()=>openMonthly(adminMode).catch(failure);
$('backFromLines').onclick=()=>openMenu(adminMode).catch(failure);$('backFromMonth').onclick=()=>openMenu(adminMode).catch(failure);
$('backFromDash').onclick=()=> (isMonthly()?openMonthly(false,$('dashPeriod').value):openLines(false)).catch(failure);
$('backFromEntry').onclick=()=> (isMonthly()?openMonthly(true,loadedPeriod):openLines(true)).catch(failure);
$('lineSearch').oninput=renderLines;$('lineFilter').onchange=renderLines;$('refreshLines').onclick=()=>refreshLines().catch(failure);
$('monthSearch').oninput=renderMonthly;$('monthFilter').onchange=renderMonthly;$('monthPeriod').onchange=()=>refreshMonthly().catch(failure);$('refreshMonth').onclick=()=>refreshMonthly().catch(failure);
$('dashPeriod').onchange=()=>renderDash().catch(failure);$('dashHistory').onchange=()=>{if($('dashHistory').value){$('dashPeriod').value=$('dashHistory').value;renderDash().catch(failure);}};
$('updateLineBtn').onclick=()=>openEntry(currentLine,$('dashPeriod').value).catch(failure);
for(const b of document.querySelectorAll('[data-nav]'))b.onclick=()=>({home:openHome,coord:()=>openMenu(false),admin:()=>openMenu(true),monthly:()=>openMonthly(false),production:openProduction}[b.dataset.nav])().catch(failure);
document.querySelector('.brand').onclick=e=>{e.preventDefault();openHome().catch(failure);};
window.addEventListener('beforeunload',e=>{if(dirtyKeys.size||productionDirty.size||busy){e.preventDefault();e.returnValue='';}});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSidebar();});
$('todayLabel').textContent=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',weekday:'long',day:'2-digit',month:'long'}).format(new Date()).toLocaleUpperCase('pt-BR')+' · OPERAÇÃO';
updateHome().catch(failure);

function productionCellKey(line,day,metric) { return [line,day,metric].join('|'); }
function productionTotals(rows) {
  const totals={days:{},lines:{},month:0};
  for(const row of rows){
    if(!LINES.includes(row.line)||['SERIGRAFIA','PRE'].includes(row.line))continue;
    const raw=String(row.production??'').trim().replace(',','.');
    if(!/^\d+$/.test(raw))continue;
    const value=Number(raw);if(!Number.isSafeInteger(value)||value<0)continue;
    totals.days[row.day]=(totals.days[row.day]||0)+value;
    totals.lines[row.line]=(totals.lines[row.line]||0)+value;totals.month+=value;
  }
  return totals;
}
function updateProductionTotals() {
  const table=$('productionTable');
  const rows=[...table.querySelectorAll('input[data-metric="production"]')].filter(input=>(!selectedProductionLines||selectedProductionLines.has(input.dataset.line))&&productionDateVisible(input.dataset.day)).map(input=>({line:input.dataset.line,day:input.dataset.day,production:input.value}));
  const totals=productionTotals(rows), format=value=>(value||0).toLocaleString('pt-BR');
  table.querySelectorAll('[data-total-day]').forEach(cell=>cell.textContent=format(totals.days[cell.dataset.totalDay]));
  table.querySelectorAll('[data-total-line]').forEach(cell=>cell.textContent=format(totals.lines[cell.dataset.totalLine]));
  $('productionGrandTotal').textContent=format(totals.month);$('productionMonthTotal').textContent=format(totals.month);
}
function renderProduction(rows,month) {
  const [year,m]=month.split('-').map(Number), days=new Date(Date.UTC(year,m,0)).getUTCDate();
  const values=new Map(rows.map(r=>[r.line+'|'+r.day,r]));
  const totals=productionTotals(rows.filter(r=>r.day.startsWith(month+'-')));
  const number=value=>value.toLocaleString('pt-BR');
  $('productionMonthTitle').textContent=fmtPeriod(month);
  let html='<caption class="sr-only">Produção e eficiência de '+escapeText(fmtPeriod(month))+'</caption><thead><tr><th scope="col" class="line-column">Linha</th><th scope="col" class="metric-column">Indicador</th>';
  for(let d=1;d<=days;d++)html+='<th scope="col" data-production-day="'+month+'-'+String(d).padStart(2,'0')+'"><span class="day-number">'+String(d).padStart(2,'0')+'</span><small>'+new Intl.DateTimeFormat('pt-BR',{weekday:'short',timeZone:'UTC'}).format(new Date(Date.UTC(year,m-1,d)))+'</small></th>';
  html+='<th scope="col" class="month-total">Total<small>DO MÊS</small></th></tr></thead><tbody>';
  for(const line of LINES.filter(line=>!['SERIGRAFIA','PRE'].includes(line)))for(const metric of ['production','efficiency']) {
    const label=metric==='production'?'Produção':'Eficiência (%)';
    html+='<tr data-production-line="'+line+'" class="'+metric+'">'+(metric==='production'?'<th class="line-column" scope="rowgroup" rowspan="2"><strong>'+line+'</strong></th>':'')+'<th class="metric-column" scope="row">'+label+'</th>';
    for(let d=1;d<=days;d++) {
      const day=month+'-'+String(d).padStart(2,'0'), value=values.get(line+'|'+day)?.[metric]??'';
      html+='<td data-production-day="'+day+'"><input '+(productionReadOnly?'readonly aria-readonly="true" ':'')+'type="text" inputmode="decimal" autocomplete="off" data-line="'+line+'" data-day="'+day+'" data-metric="'+metric+'" value="'+escapeText(value)+'" aria-label="'+line+' · '+label+' · '+d+'/'+m+'" placeholder="—"></td>';
    }
    html+='<td class="month-total" '+(metric==='production'?'data-total-line="'+line+'"':'')+'>'+(metric==='production'?number(totals.lines[line]||0):'—')+'</td></tr>';
  }
  html+='</tbody><tfoot><tr><th class="line-column" scope="row">TOTAL</th><th class="metric-column">Produção</th>';
  for(let d=1;d<=days;d++){const day=month+'-'+String(d).padStart(2,'0');html+='<td data-production-day="'+day+'" data-total-day="'+day+'">'+number(totals.days[day]||0)+'</td>';}
  $('productionTable').innerHTML=html+'<td class="month-total grand-total" id="productionGrandTotal">'+number(totals.month)+'</td></tr></tfoot>';
  $('productionMonthTotal').textContent=number(totals.month);
  if(typeof document!=='undefined')applyProductionFilter();
}
async function loadProduction(month) {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('Escolha um mês válido.');
  setBusy(true);$('productionStatus').textContent='Carregando…';
  try {
    const rows=await cloudRequest('/api/production?month='+month);
    productionLoaded=month;
    if(productionStartDate&&!productionStartDate.startsWith(month+'-'))productionStartDate='';
    if(productionEndDate&&!productionEndDate.startsWith(month+'-'))productionEndDate='';
    const lastDay=month+'-'+String(new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate()).padStart(2,'0');
    for(const id of ['productionStartDate','productionEndDate']){$(id).min=month+'-01';$(id).max=lastDay;}
    $('productionStartDate').value=productionStartDate;$('productionEndDate').value=productionEndDate;
    productionDirty.clear();renderProduction(rows,month);
    $('productionStatus').textContent='Dados carregados da nuvem';
  }catch(e){$('productionStatus').textContent='Falha ao carregar. Clique em atualizar para tentar novamente.';throw e;}
  finally{setBusy(false);}
}
async function openProduction(readOnly=false) {
  if(!await changeView('production','production','Produção diária'))return;
  productionReadOnly=readOnly;
  $('screen-production').classList.toggle('production-readonly',readOnly);
  $('productionSave').hidden=readOnly;
  for(const id of ['productionCopy','productionCopyAll','productionCopyHint'])$(id).hidden=!readOnly;
  $('productionViewBadge').hidden=!readOnly;
  $('productionDescription').textContent=readOnly?'Consulte a produção e a eficiência. Escolha o mês e as linhas que deseja visualizar.':'Preencha a produção e, logo abaixo, a eficiência de cada linha. Ambos os valores são informados manualmente.';
  $('productionMonth').value=productionLoaded||todayISO().slice(0,7);
  await loadProduction($('productionMonth').value);
}
$('productionTable').addEventListener('input',e=>{
  const input=e.target;if(productionReadOnly||!input.dataset.metric)return;
  if(input.dataset.metric==='production')updateProductionTotals();
  productionDirty.set(productionCellKey(input.dataset.line,input.dataset.day,input.dataset.metric),input);
  $('productionStatus').textContent=productionDirty.size+' campo(s) com alterações não salvas';
});
$('productionSave').onclick=async()=>{
  if(productionReadOnly||busy||productionSaving)return;
  if(!productionDirty.size){notify('Nenhuma alteração para salvar.');return;}
  try {
    const changes=[...productionDirty.values()].map(input=>{
      const raw=input.value.trim().replace(',','.');const value=raw===''?null:Number(raw);
      if(value!==null&&(!/^\d+(?:\.\d+)?$/.test(raw)||!Number.isFinite(value)||value<0||(input.dataset.metric==='production'&&!Number.isInteger(value)))){input.focus();throw new Error('Informe uma produção inteira e uma eficiência numérica, ambas a partir de zero.');}
      return {line:input.dataset.line,day:input.dataset.day,metric:input.dataset.metric,value};
    });
    productionSaving=true;setBusy(true);
    await cloudRequest('/api/production',{method:'PATCH',body:JSON.stringify({month:productionLoaded,changes})});
    productionDirty.clear();$('productionStatus').textContent='Alterações salvas na nuvem';notify('Produção e eficiência salvas.');
  }catch(e){failure(e);}finally{if(productionSaving){productionSaving=false;setBusy(false);}}
};
$('productionMonth').onchange=async()=>{
  const month=$('productionMonth').value;
  if(!await canLeave()){$('productionMonth').value=productionLoaded;return;}
  try{await loadProduction(month);}catch(e){$('productionMonth').value=productionLoaded;failure(e);}
};
$('productionRefresh').onclick=async()=>{if(await canLeave())loadProduction($('productionMonth').value).catch(failure);};
$('productionBack').onclick=()=>openHome().catch(failure);

function setSidebarCollapsed(collapsed) {
  document.body.classList.toggle('sidebar-collapsed',collapsed);
  $('sidebarCollapse').setAttribute('aria-expanded',String(!collapsed));
  const label=collapsed?'Expandir barra lateral':'Recolher barra lateral';
  $('sidebarCollapse').setAttribute('aria-label',label);$('sidebarCollapse').title=label;
  try{localStorage.setItem('production-sidebar-collapsed',String(collapsed));}catch{}
}
$('sidebarCollapse').onclick=()=>setSidebarCollapsed(!document.body.classList.contains('sidebar-collapsed'));
try{setSidebarCollapsed(localStorage.getItem('production-sidebar-collapsed')==='true');}catch{}

function applyProductionFilter() {
  clearProductionSelection();
  const lines=LINES.filter(line=>!['SERIGRAFIA','PRE'].includes(line));
  document.querySelectorAll('[data-production-line]').forEach(row=>row.hidden=!!selectedProductionLines&&!selectedProductionLines.has(row.dataset.productionLine));
  $('productionFilterLabel').textContent=selectedProductionLines?selectedProductionLines.size+' linha(s) selecionada(s)':'Todas as linhas';
  const all=$('productionFilterOptions').querySelector('input[value="all"]');
  if(all){all.checked=!selectedProductionLines;all.indeterminate=!!selectedProductionLines&&selectedProductionLines.size>0;}
  $('productionFilterOptions').querySelectorAll('input[data-filter-line]').forEach(input=>input.checked=!selectedProductionLines||selectedProductionLines.has(input.value));
  $('productionTable').querySelectorAll('[data-production-day]').forEach(cell=>cell.hidden=!productionDateVisible(cell.dataset.productionDay));
  const totalHead=$('productionTable').querySelector('thead .month-total');
  if(totalHead)totalHead.innerHTML=productionHasRange()?'Total<small>DO PERÍODO</small>':'Total<small>DO MÊS</small>';
  $('productionTotalLabel').textContent=productionHasRange()?'PRODUÇÃO TOTAL DO PERÍODO':'PRODUÇÃO TOTAL DO MÊS';
  updateProductionTotals();
  rebuildProductionFixedHeader();
}
$('productionFilterOptions').innerHTML='<label class="filter-all"><input type="checkbox" value="all" checked> Todas</label>'+LINES.filter(line=>!['SERIGRAFIA','PRE'].includes(line)).map(line=>'<label><input type="checkbox" data-filter-line value="'+line+'" checked> '+line+'</label>').join('');
$('productionFilterOptions').onchange=e=>{
  const input=e.target;if(input.type!=='checkbox')return;
  const lines=LINES.filter(line=>!['SERIGRAFIA','PRE'].includes(line));
  if(input.value==='all')selectedProductionLines=input.checked?null:new Set();
  else {
    if(!selectedProductionLines)selectedProductionLines=new Set(lines);
    if(input.checked)selectedProductionLines.add(input.value);else selectedProductionLines.delete(input.value);
    if(selectedProductionLines.size===lines.length)selectedProductionLines=null;
  }
  applyProductionFilter();
};
document.addEventListener('click',e=>{if(!$('productionLineFilter').contains(e.target))$('productionLineFilter').open=false;});

$('homeProduction').onclick=()=>openProduction(true).catch(failure);

// Anonymous browser identifier is shared by tabs so one browser is counted once.
let onlineVisitorId;
try {
  onlineVisitorId=localStorage.getItem('production-online-id');
  if(!/^[a-f0-9-]{36}$/.test(onlineVisitorId||'')){
    onlineVisitorId=crypto.randomUUID();localStorage.setItem('production-online-id',onlineVisitorId);
  }
}catch{onlineVisitorId=crypto.randomUUID();}
let presenceInFlight=false;
async function refreshOnlineCount() {
  if(document.hidden||presenceInFlight)return;
  presenceInFlight=true;
  try {
    const response=await fetch('/api/presence',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:onlineVisitorId}),signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('Contagem indisponível');
    const data=await response.json();
    if(!Number.isInteger(data.online)||data.online<0)throw new Error('Contagem inválida');
    $('onlineCount').textContent=data.online+' online';
    $('onlineCounter').classList.remove('unavailable');
    $('onlineCounter').title='Sessões ativas nos últimos 15 segundos. O mesmo navegador conta uma vez.';
  }catch{
    $('onlineCount').textContent='Online: —';$('onlineCounter').classList.add('unavailable');
    $('onlineCounter').title='Contagem temporariamente indisponível';
  }finally{presenceInFlight=false;}
}
refreshOnlineCount();setInterval(refreshOnlineCount,5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshOnlineCount();});

let productionSelection=null, productionDragging=false;
function productionGrid() {
  const grid=[];
  const rows=[...$('productionTable').querySelectorAll('tr')].filter(row=>!row.hidden);
  rows.forEach((row,r)=>{
    grid[r]||=[];let c=0;
    for(const cell of row.cells){
      if(cell.hidden)continue;
      while(grid[r][c])c++;
      for(let dr=0;dr<(cell.rowSpan||1);dr++)for(let dc=0;dc<(cell.colSpan||1);dc++){
        grid[r+dr]||=[];grid[r+dr][c+dc]=cell;
      }
      c+=cell.colSpan||1;
    }
  });
  return grid;
}
function tsvBlock(rows) {
  return rows.map(row=>row.map(value=>String(value??'').replace(/[\t\r\n]/g,' ')).join('\t')).join('\r\n');
}
function productionCellText(cell) {
  const input=cell.querySelector('input');if(input)return input.value;
  if(cell.tagName==='TH'&&cell.classList.contains('month-total'))return productionHasRange()?'Total do período':'Total do mês';
  const day=cell.querySelector('.day-number');
  if(day){const month=$('productionMonth').value;return day.textContent+'/'+month.slice(5,7)+'/'+month.slice(0,4);}
  return cell.textContent.trim().replace(/\s+/g,' ');
}
function clearProductionSelection() {
  productionSelection=null;productionDragging=false;
  $('productionTable').querySelectorAll('.copy-selected').forEach(cell=>cell.classList.remove('copy-selected'));
  syncProductionHeaderSelection();
}
function selectProductionCell(cell,extend=false,focus=true) {
  const grid=productionGrid(),r=grid.findIndex(row=>row.includes(cell));if(r<0)return;
  const c=grid[r].indexOf(cell);
  if(!extend||!productionSelection)productionSelection={start:[r,c],end:[r,c]};else productionSelection.end=[r,c];
  const [r1,c1]=productionSelection.start,[r2,c2]=productionSelection.end;
  $('productionTable').querySelectorAll('.copy-selected').forEach(cell=>cell.classList.remove('copy-selected'));
  const selected=new Set();
  grid.forEach((row,ri)=>row.forEach((el,ci)=>{if(ri>=Math.min(r1,r2)&&ri<=Math.max(r1,r2)&&ci>=Math.min(c1,c2)&&ci<=Math.max(c1,c2))selected.add(el);}));
  selected.forEach(cell=>cell.classList.add('copy-selected'));
  syncProductionHeaderSelection();
  if(focus){const target=cell.querySelector('input')||cell;if(!target.matches('input'))target.tabIndex=-1;target.focus({preventScroll:true});}
}
function productionSelectionText(all=false) {
  const grid=productionGrid();if(!grid.length)return '';
  if(all)return tsvBlock(grid.map(row=>row.map(productionCellText)));
  if(!productionSelection)return '';
  const [r1,c1]=productionSelection.start,[r2,c2]=productionSelection.end;
  return tsvBlock(grid.slice(Math.min(r1,r2),Math.max(r1,r2)+1).map(row=>row.slice(Math.min(c1,c2),Math.max(c1,c2)+1).map(productionCellText)));
}
$('productionTable').addEventListener('pointerdown',e=>{
  if(!productionReadOnly||busy||e.button!==0)return;
  const cell=e.target.closest('td,th');if(!cell)return;
  if(e.pointerType==='mouse'){e.preventDefault();productionDragging=true;}
  selectProductionCell(cell,e.shiftKey);
});
$('productionTable').addEventListener('pointerover',e=>{
  if(!productionReadOnly||!productionDragging||!(e.buttons&1))return;
  const cell=e.target.closest('td,th');if(cell)selectProductionCell(cell,true,false);
});
document.addEventListener('pointerup',()=>productionDragging=false);
$('productionTable').addEventListener('copy',e=>{
  if(!productionReadOnly||!productionSelection)return;
  const text=productionSelectionText();if(!e.clipboardData)return;
  e.preventDefault();e.clipboardData.setData('text/plain',text);showProductionCopied(false);
});
$('productionTable').addEventListener('keydown',e=>{
  if(!productionReadOnly)return;
  const grid=productionGrid();if(!grid.length)return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){
    e.preventDefault();selectProductionCell(grid[0][0]);selectProductionCell(grid.at(-1).at(-1),true);return;
  }
  if(e.key==='Escape'){clearProductionSelection();return;}
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
  e.preventDefault();if(!productionSelection){selectProductionCell(e.target.closest('td,th')||grid[0][0]);}
  const [r,c]=productionSelection.end;
  const nr=Math.max(0,Math.min(grid.length-1,r+(e.key==='ArrowDown'?1:e.key==='ArrowUp'?-1:0)));
  const nc=Math.max(0,Math.min(grid[nr].length-1,c+(e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0)));
  selectProductionCell(grid[nr][nc],e.shiftKey);grid[nr][nc].scrollIntoView({block:'nearest',inline:'nearest'});
});
async function copyProduction(all) {
  if(!productionReadOnly||busy)return;
  const text=productionSelectionText(all);
  if(!text){notify('Selecione as células que deseja copiar.');return;}
  try{await navigator.clipboard.writeText(text);showProductionCopied(all);}
  catch{notify('Não foi possível acessar a área de transferência. Selecione as células e use Ctrl+C.',true);}
}
$('productionCopy').onclick=()=>copyProduction(false);
$('productionCopyAll').onclick=()=>copyProduction(true);

let productionCopyFeedbackTimer;
function showProductionCopied(all) {
  const message=all?'✓ Tabela copiada! Cole no Excel.':'✓ Seleção copiada! Cole no Excel.';
  $('productionCopyFeedback').textContent=message;$('productionCopyFeedback').hidden=false;
  $('productionCopy').textContent=all?'Copiar seleção':'✓ Copiado!';
  $('productionCopyAll').textContent=all?'✓ Copiado!':'Copiar tabela';
  $('productionTable').classList.add('copy-confirmed');
  notify(message);
  clearTimeout(productionCopyFeedbackTimer);
  productionCopyFeedbackTimer=setTimeout(()=>{
    $('productionCopyFeedback').hidden=true;$('productionCopy').textContent='Copiar seleção';$('productionCopyAll').textContent='Copiar tabela';$('productionTable').classList.remove('copy-confirmed');
  },5000);
}

function productionExcelData() {
  const grid=productionGrid();if(!grid.length)throw new Error('Carregue a tabela antes de exportar.');
  if(grid.length<=2)throw new Error('Selecione pelo menos uma linha para exportar.');
  const seen=new Set(),merges=[];
  const rows=grid.map((row,r)=>row.map((cell,c)=>{
    if(seen.has(cell))return null;seen.add(cell);
    if(cell.rowSpan>1)merges.push({r1:r,c1:c,r2:r+cell.rowSpan-1,c2:c});
    const input=cell.querySelector('input');
    if(input){const raw=input.value.trim().replace(',','.');if(raw==='')return null;const value=Number(raw);if(!Number.isFinite(value)||value<0)throw new Error('Corrija os valores inválidos antes de exportar.');return value;}
    if(r>0&&c>=2){const text=cell.textContent.trim();if(text==='—')return null;const value=Number(text.replace(/\./g,'').replace(',','.'));if(Number.isFinite(value))return value;}
    return productionCellText(cell);
  }));
  return {title:'Produção diária · '+productionRangeLabel(),rows,merges};
}
$('productionExportExcel').onclick=()=>{
  if(busy)return;
  try{
    const data=productionExcelData(),bytes=ProductionExcel.workbook(data);
    const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    const link=document.createElement('a');link.href=url;link.download='producao-diaria-'+productionRangeFilename()+'.xlsx';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
    notify('Excel exportado com as linhas exibidas na tabela.');
  }catch(e){failure(e);}
};

// A separate synchronized header stays fixed to the viewport while the full-height
// table scrolls with the page. The original header remains the source for copying.
const productionFixedHeader=document.createElement('div');
productionFixedHeader.className='production-fixed-header';productionFixedHeader.hidden=true;
productionFixedHeader.setAttribute('aria-hidden','true');document.body.append(productionFixedHeader);
const productionScroll=$('productionTable').closest('.production-scroll');
let productionHeaderFrame=0;
function syncProductionHeaderSelection() {
  const source=$('productionTable').tHead?.rows[0];
  if(!source)return;
  productionFixedHeader.querySelectorAll('th').forEach((cell,i)=>cell.classList.toggle('copy-selected',source.cells[i]?.classList.contains('copy-selected')));
}
function rebuildProductionFixedHeader() {
  const table=$('productionTable'),head=table.tHead;
  if(!head){productionFixedHeader.hidden=true;return;}
  const clone=document.createElement('table');clone.className='production-table';clone.style.tableLayout='fixed';clone.style.width=table.getBoundingClientRect().width+'px';clone.style.minWidth='0';
  clone.append(head.cloneNode(true));
  [...clone.tHead.rows[0].cells].forEach((cell,i)=>{
    const width=head.rows[0].cells[i].getBoundingClientRect().width+'px';
    cell.style.width=width;cell.style.minWidth=width;cell.style.maxWidth=width;
  });
  productionFixedHeader.replaceChildren(clone);syncProductionHeaderSelection();updateProductionFixedHeader();
}
function updateProductionFixedHeader() {
  const table=$('productionTable'),head=table.tHead;
  const visible=$('screen-production').classList.contains('active')&&!!head;
  if(!visible){productionFixedHeader.hidden=true;return;}
  const bounds=productionScroll.getBoundingClientRect(),height=head.getBoundingClientRect().height;
  if(bounds.top>=0||bounds.bottom<=height){productionFixedHeader.hidden=true;return;}
  productionFixedHeader.hidden=false;
  productionFixedHeader.style.left=(bounds.left+productionScroll.clientLeft)+'px';
  productionFixedHeader.style.width=productionScroll.clientWidth+'px';
  productionFixedHeader.style.height=height+'px';
  productionFixedHeader.scrollLeft=productionScroll.scrollLeft;
  productionFixedHeader.classList.toggle('production-readonly',productionReadOnly);
}
function scheduleProductionHeader() {
  if(productionHeaderFrame)return;
  productionHeaderFrame=requestAnimationFrame(()=>{productionHeaderFrame=0;updateProductionFixedHeader();});
}
window.addEventListener('scroll',scheduleProductionHeader,{passive:true});
productionScroll.addEventListener('scroll',scheduleProductionHeader,{passive:true});
window.addEventListener('resize',rebuildProductionFixedHeader);
new ResizeObserver(()=>rebuildProductionFixedHeader()).observe(productionScroll);
new MutationObserver(scheduleProductionHeader).observe($('screen-production'),{attributes:true,attributeFilter:['class']});
productionFixedHeader.addEventListener('pointerdown',e=>{
  if(!productionReadOnly||busy||e.button!==0)return;
  const cell=e.target.closest('th');if(!cell)return;
  const original=$('productionTable').tHead.rows[0].cells[cell.cellIndex];
  if(e.pointerType==='mouse'){e.preventDefault();productionDragging=true;}
  selectProductionCell(original,e.shiftKey);
});
productionFixedHeader.addEventListener('pointerover',e=>{
  if(!productionReadOnly||!productionDragging||!(e.buttons&1))return;
  const cell=e.target.closest('th');if(cell)selectProductionCell($('productionTable').tHead.rows[0].cells[cell.cellIndex],true,false);
});

function changeProductionRange() {
  const start=$('productionStartDate').value,end=$('productionEndDate').value;
  if([start,end].some(day=>day&&(!validDate(day)||!day.startsWith(productionLoaded+'-')))||(start&&end&&start>end)){
    $('productionStartDate').value=productionStartDate;$('productionEndDate').value=productionEndDate;
    notify('Selecione um intervalo válido dentro do mês, com início anterior ou igual ao final.',true);return;
  }
  productionStartDate=start;productionEndDate=end;applyProductionFilter();
}
$('productionStartDate').onchange=changeProductionRange;$('productionEndDate').onchange=changeProductionRange;
$('productionAllDays').onclick=()=>{productionStartDate='';productionEndDate='';$('productionStartDate').value='';$('productionEndDate').value='';applyProductionFilter();};
function drawProductionImage(data) {
  const widths=data.rows[0].map((_,c)=>c===0?115:c===1?155:c===data.rows[0].length-1?135:110);
  const pad=24,rowHeight=42,titleHeight=76,footerHeight=52,width=widths.reduce((a,b)=>a+b,0)+pad*2,height=titleHeight+data.rows.length*rowHeight+footerHeight;
  const canvas=document.createElement('canvas');canvas.width=width*2;canvas.height=height*2;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Exportação de imagem indisponível neste navegador.');ctx.scale(2,2);
  ctx.fillStyle='#101415';ctx.fillRect(0,0,width,height);ctx.textBaseline='middle';ctx.fillStyle='#b9e991';ctx.font='600 20px system-ui, sans-serif';ctx.fillText(data.title,pad,34);
  const merged=new Map(data.merges.map(m=>[m.r1+':'+m.c1,m]));
  data.rows.forEach((row,r)=>{
    let x=pad;
    row.forEach((value,c)=>{
      if(data.merges.some(m=>r>m.r1&&r<=m.r2&&c>=m.c1&&c<=m.c2)){x+=widths[c];return;}
      const merge=merged.get(r+':'+c),h=merge?(merge.r2-merge.r1+1)*rowHeight:rowHeight,y=titleHeight+r*rowHeight;
      const emphasis=r===0||r===data.rows.length-1||c===0||c===row.length-1;
      ctx.fillStyle=r===0||r===data.rows.length-1?'#26352b':emphasis?'#202b24':r%2===0?'#171e1b':'#1a211e';ctx.fillRect(x,y,widths[c],h);
      ctx.strokeStyle='#344338';ctx.lineWidth=1;ctx.strokeRect(x,y,widths[c],h);
      ctx.fillStyle=emphasis?'#d5f4be':'#edf1ef';ctx.font=(emphasis?'600 ':'400 ')+(r===0?'11':'13')+'px system-ui, sans-serif';ctx.textAlign='center';
      const text=typeof value==='number'?value.toLocaleString('pt-BR'):(value??'');ctx.fillText(text,x+widths[c]/2,y+h/2,widths[c]-10);x+=widths[c];
    });
  });
  ctx.textAlign='left';ctx.font='11px system-ui, sans-serif';ctx.fillStyle='#9aa6a5';ctx.fillText('PAINEL DE PRODUÇÃO · Linhas e período conforme a seleção exibida',pad,height-22);
  return canvas;
}
$('productionExportImage').onclick=()=>{
  if(busy)return;
  try{
    const canvas=drawProductionImage(productionExcelData());
    canvas.toBlob(blob=>{
      if(!blob){failure(new Error('Não foi possível gerar a imagem.'));return;}
      const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='producao-diaria-'+productionRangeFilename()+'.png';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);notify('Imagem exportada com as linhas e a data exibidas.');
    },'image/png');
  }catch(e){failure(e);}
};

function setPanelTheme(theme) {
  const light=theme==='light';document.documentElement.dataset.theme=light?'light':'dark';
  const button=$('themeToggle'),label=light?'Ativar tema escuro':'Ativar tema claro';
  button.title=label;button.setAttribute('aria-label',label);button.setAttribute('aria-pressed',String(light));
  button.querySelector('.theme-label').textContent=light?'Tema escuro':'Tema claro';
  button.querySelector('svg').innerHTML=light?'<path d="M20.5 13a8.5 8.5 0 0 1-9.5-9.5A8.5 8.5 0 1 0 20.5 13Z"/>':'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>';
  try{localStorage.setItem('production-theme',light?'light':'dark');}catch{}
}
$('themeToggle').onclick=()=>setPanelTheme(document.documentElement.dataset.theme==='light'?'dark':'light');
setPanelTheme(document.documentElement.dataset.theme);
window.addEventListener('storage',e=>{if(e.key==='production-theme')setPanelTheme(e.newValue);});

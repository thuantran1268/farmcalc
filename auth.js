const login=document.getElementById('login');
const app=document.getElementById('app');
const account=document.getElementById('account');
const emailInput=document.getElementById('login-email');
const message=document.getElementById('auth-message');
const status=document.getElementById('save-status');
const config=window.FARMCALC_CONFIG||{};
const validEmail=value=>/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value);
const configured=()=>/^https:\/\/[^/]+\.supabase\.co\/?$/.test(config.supabaseUrl||'')&&config.supabaseAnonKey&&!config.supabaseAnonKey.startsWith('THAY_BANG_');
let email='',history=[],savePromise=null,pending=false;const localMode=!configured();const localPrefix='farmcalc-preview-v1:';const localKey=part=>localPrefix+email+':'+part;window.farmUserEmail=()=>email;const rememberedEmailSlot='farmcalc-remembered-email-v1';
function rememberEmail(value){try{localStorage.setItem(rememberedEmailSlot,value)}catch{}}
function headers(prefer){return {'apikey':config.supabaseAnonKey,'Content-Type':'application/json',...(prefer?{'Prefer':prefer}:{})}}
async function request(path,options={}){const response=await fetch(config.supabaseUrl.replace(/\/$/,'')+'/rest/v1/farmcalc_accounts'+path,{...options,headers:headers(options.prefer)});const body=await response.text();if(!response.ok)throw new Error('Không kết nối được dữ liệu: '+response.status+' '+body.slice(0,180));return body.trim()?JSON.parse(body):null}
function errorText(error){message.textContent=error?.message||String(error)}
function drawHistory(){const list=document.getElementById('history-list');list.replaceChildren();if(!history.length){list.textContent='Chưa có lần tính nào được lưu cho email này.';return}const labels={chicken:'Gà thịt',pig:'Heo thịt',sow:'Heo con cai sữa'};for(const item of history.slice(0,30)){const row=document.createElement('div');row.className='history-row';const label=document.createElement('span');label.textContent=`${labels[item.animal]||item.animal} · ${new Date(item.savedAt).toLocaleString('vi-VN')}`;const button=document.createElement('button');button.type='button';button.textContent='Mở lại';button.onclick=()=>{window.farmState[item.animal]=structuredClone(item.payload);window.farmSelect(item.animal)};row.append(label,button);list.append(row)}}
async function enter(value){if(localMode){email=value;let draft={};try{draft=JSON.parse(localStorage.getItem(localKey('draft'))||'{}');history=JSON.parse(localStorage.getItem(localKey('history'))||'[]')}catch{history=[]}for(const key of Object.keys(window.farmState))delete window.farmState[key];Object.assign(window.farmState,draft);window.cloudContext={saveDraft};window.farmRender();drawHistory();document.getElementById('account-email').textContent=email+' · Chạy thử trên máy';login.hidden=true;app.hidden=false;account.hidden=false;message.textContent='';status.textContent='Chạy thử: số liệu chỉ lưu trên máy này';rememberEmail(value);return}const records=await request('?select=email,draft,history&email=eq.'+encodeURIComponent(value));if(!records.length){await request('',{method:'POST',prefer:'return=minimal',body:JSON.stringify({email:value,draft:{},history:[]})})}const record=records[0]||{draft:{},history:[]};email=value;history=Array.isArray(record.history)?record.history:[];for(const key of Object.keys(window.farmState))delete window.farmState[key];Object.assign(window.farmState,record.draft||{});window.cloudContext={saveDraft};window.farmRender();drawHistory();document.getElementById('account-email').textContent=email;login.hidden=true;app.hidden=false;account.hidden=false;message.textContent='';status.textContent='Đã tải dữ liệu của email này';rememberEmail(value)}
function flush(){if(savePromise)return savePromise;savePromise=(async()=>{do{pending=false;const active=email;const snapshot=structuredClone(window.farmState);try{await request('?email=eq.'+encodeURIComponent(active),{method:'PATCH',prefer:'return=minimal',body:JSON.stringify({draft:snapshot,updated_at:new Date().toISOString()})});if(email===active)status.textContent='Đã lưu trực tuyến'}catch(error){if(email===active)status.textContent=error.message;pending=false}}while(pending&&email)})().finally(()=>{savePromise=null});return savePromise}
function saveDraft(){if(!email)return;if(localMode){try{localStorage.setItem(localKey('draft'),JSON.stringify(window.farmState));status.textContent='Đã lưu trên máy này'}catch{status.textContent='Trình duyệt không cho lưu khi mở file trực tiếp; số liệu chỉ còn trong phiên này'}return}pending=true;status.textContent='Đang lưu trực tuyến…';return flush()}
async function saveHistory(){if(!email)return;const animal=window.farmCurrent();if(animal==='catalog')return;history.unshift({animal,payload:structuredClone(window.farmState[animal]||{}),savedAt:new Date().toISOString()});history=history.slice(0,30);if(localMode){try{localStorage.setItem(localKey('history'),JSON.stringify(history));status.textContent='Đã lưu lần tính trên máy này';drawHistory();saveDraft()}catch{status.textContent='Trình duyệt không cho lưu khi mở file trực tiếp'}return}try{await request('?email=eq.'+encodeURIComponent(email),{method:'PATCH',prefer:'return=minimal',body:JSON.stringify({history,updated_at:new Date().toISOString()})});status.textContent='Đã lưu lần tính trực tuyến';drawHistory();saveDraft()}catch(error){status.textContent=error.message}}
if(localMode)message.textContent='Chế độ chạy thử: số liệu chỉ lưu trên máy này. Muốn đồng bộ giữa các máy, cần cấu hình nơi lưu trực tuyến.';
document.getElementById('email-form').onsubmit=async event=>{event.preventDefault();const value=emailInput.value.trim().toLowerCase();if(!validEmail(value)){message.textContent='Email không đúng định dạng.';return}const button=document.getElementById('send-code');button.disabled=true;message.textContent='Đang mở dữ liệu…';try{await enter(value)}catch(error){errorText(error)}finally{button.disabled=false}};
function leaveApp(){email='';window.cloudContext=null;for(const key of Object.keys(window.farmState))delete window.farmState[key];window.farmRender();app.hidden=true;account.hidden=true;login.hidden=false}
const gate=window.farmPriceGate&&window.farmPriceGate.configured?window.farmPriceGate:null;
document.getElementById('signout').onclick=async()=>{await saveDraft();try{localStorage.removeItem(rememberedEmailSlot)}catch{}if(gate){leaveApp();gate.logout();return}email='';window.cloudContext=null;for(const key of Object.keys(window.farmState))delete window.farmState[key];window.farmRender();app.hidden=true;account.hidden=true;login.hidden=false;emailInput.value='';message.textContent='Đã thoát.'};
document.getElementById('save-history').onclick=saveHistory;
if(gate){/* 2 cách vào: (1) email công ty, không mật khẩu; (2) tài khoản đăng ký (tên + SĐT + Gmail + mật khẩu).
   Vào web không cần duyệt; riêng bảng giá Jfeed cần admin duyệt (do price-gate.js kiểm soát). */
  let quick='',entering='';const quickSlot='farmcalc-quick-email-v1';
  const card=login.querySelector('.auth-card');
  const qh=document.createElement('h3');qh.textContent='Vào nhanh bằng email công ty';
  const qp=document.createElement('p');qp.className='pg-note';qp.textContent='Nhập email công ty để vào ngay, không cần mật khẩu.';
  const qf=document.createElement('form');qf.className='pg-form quick-form';
  const qi=document.createElement('input');qi.type='email';qi.placeholder='ten.ho@congty…';qi.autocomplete='email';qi.inputMode='email';qi.setAttribute('aria-label','Email công ty');qi.required=true;
  const qb=document.createElement('button');qb.type='submit';qb.className='pg-btn';qb.textContent='Vào ngay';
  qf.append(qi,qb);
  const or=document.createElement('div');or.className='auth-or';or.textContent='hoặc dùng tài khoản';
  card.replaceChildren(qh,qp,qf,message,or,gate.panel());message.textContent='';
  const goQuick=async(value,silent)=>{value=String(value||'').trim().toLowerCase();if(!validEmail(value)){message.textContent='Email không đúng định dạng.';return}
    qb.disabled=true;if(!silent)message.textContent='Đang kiểm tra…';
    let ok=false;try{ok=await gate.quickEmailOk(value)===true}catch(e){if(silent)ok=true;else{message.textContent='Không kết nối được máy chủ. Vui lòng thử lại.';qb.disabled=false;return}}
    if(!ok){qb.disabled=false;try{localStorage.removeItem(quickSlot)}catch{}if(silent){message.textContent='';return}message.textContent='Email này không vào nhanh được. Hãy dùng "Đăng ký mới" bên dưới.';return}
    quick=value;try{await enter(value);try{localStorage.setItem(quickSlot,value)}catch{}message.textContent=''}catch(error){quick='';errorText(error)}finally{qb.disabled=false}};
  qf.onsubmit=e=>{e.preventDefault();goQuick(qi.value)};
  const sync=()=>{const st=gate.state(),u=gate.user();
    if((st==='ready'||st==='pending')&&u.email){if(!quick&&email!==u.email&&entering!==u.email){entering=u.email;enter(u.email).then(()=>{document.getElementById('account-email').textContent=(u.name?u.name+' · ':'')+u.email}).catch(errorText).finally(()=>{entering=''})}}
    else if(st!=='loading'&&email&&!quick){leaveApp()}};
  window.addEventListener('farm-gate',sync);sync();
  document.getElementById('signout').addEventListener('click',()=>{quick='';qi.value='';try{localStorage.removeItem(quickSlot)}catch{}},true);
  try{const saved=localStorage.getItem(quickSlot);if(saved&&validEmail(saved)){qi.value=saved;goQuick(saved,true)}}catch{}
}
if(!gate)try{const savedEmail=localStorage.getItem(rememberedEmailSlot);if(savedEmail&&validEmail(savedEmail)){emailInput.value=savedEmail;message.textContent='Đang mở tài khoản đã lưu…';enter(savedEmail).catch(error=>{errorText(error)})}}catch{}

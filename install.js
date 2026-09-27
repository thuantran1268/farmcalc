// Browser installation prompt is available on supported Android browsers.
let pendingInstallEvent;
const installButton=document.getElementById('install-app');
const installGuide=document.getElementById('install-guide');
const alreadyInstalled=()=>window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
if(alreadyInstalled())installGuide.hidden=true;
window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();
  pendingInstallEvent=event;
  if(!alreadyInstalled())installButton.hidden=false;
});
installButton.addEventListener('click',async()=>{
  if(!pendingInstallEvent)return;
  const event=pendingInstallEvent;pendingInstallEvent=null;installButton.hidden=true;
  await event.prompt();
  await event.userChoice;
});
window.addEventListener('appinstalled',()=>{installGuide.hidden=true;pendingInstallEvent=null});

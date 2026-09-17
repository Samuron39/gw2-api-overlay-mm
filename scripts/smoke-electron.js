'use strict';
// Eksplisitt isolert test. Starter aldri produksjonsprofil, hjelper, UDP, tray eller updater.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {logBuffer}=require('../test/helpers/evtc-fixture');
const root=path.join(__dirname,'..'),packaged=process.argv.includes('--packaged');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gw2-electron-smoke-'));
const file=path.join(dir,'synthetic.evtc');fs.writeFileSync(file,logBuffer(2000));
const output=path.join(root,'dist',packaged?'smoke-packaged':'smoke-source');fs.mkdirSync(output,{recursive:true});
const env={...process.env,GW2_DEMO:'1',GW2_SHOT:path.join(output,'settings.png'),GW2_SHOT_MODULE:'settings',GW2_SHOT_WAIT:'500'};
delete env.ELECTRON_RUN_AS_NODE;
env.GW2_SHOT_EVAL=`(async()=>{
  const checks={},errors=[];window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
  await window.api.invoke('config:set',{language:'nb',dpsLogDir:${JSON.stringify(dir)},wheel:{size:280}});
  checks.config=(await window.api.invoke('config:get')).language;
  checks.logs=(await window.api.invoke('dps:list')).logs.length;
  checks.damage=(await window.api.invoke('dps:parse',${JSON.stringify(file)})).players[0].dmgTarget;
  checks.update=(await window.api.invoke('update:get')).status;
  checks.blocked=false;try{await window.api.invoke('game:paste','test');}catch{checks.blocked=true;}
  checks.modules=[];
  for(const id of ['timers','daily','live','setup','settings']){
    await window.api.invoke('panel:open',id);
    await new Promise(r=>setTimeout(r,250));
    checks.modules.push({id,visible:!!document.querySelector('.module-'+id),height:document.querySelector('.module-'+id)?.getBoundingClientRect().height});
  }
  checks.errors=errors;
  return checks;
})()`;
const executable=packaged?path.join(root,'dist/win-unpacked/GW2 Overlay.exe'):require('electron');
const child=spawn(executable,packaged?[]:[root],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
const timer=setTimeout(()=>{child.kill();console.error('Isolert Electron-test tok over 60 sekunder');process.exitCode=1;},60000);
child.on('error',e=>{clearTimeout(timer);console.error(e);process.exitCode=1;});
child.on('close',code=>{
  clearTimeout(timer);fs.writeFileSync(path.join(output,'stdout.txt'),stdout);fs.writeFileSync(path.join(output,'stderr.txt'),stderr);
  try{
    const line=stdout.split(/\r?\n/).find(l=>l.startsWith('[eval] '));if(!line)throw Error('Mangler testresultat. Exit '+code);
    const result=JSON.parse(line.slice(7));
    if(code!==0||result.config!=='nb'||result.logs!==1||result.damage!==200000||result.update!=='dev'||!result.blocked||result.errors.length||result.modules.some(m=>!m.visible||!m.height))throw Error(JSON.stringify(result));
    if(/ERROR \[(?:renderer|main)\]/.test(stdout))throw Error('Feil fra hovedprosess/renderer; se stdout.txt');
    console.log(JSON.stringify({packaged,...result,output},null,2));
  }catch(e){console.error(e.message+'; logger: '+output);process.exitCode=1;}
});

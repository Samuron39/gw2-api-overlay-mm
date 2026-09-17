'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):/\.test\.js$/.test(e.name)?[path.join(dir,e.name)]:[]);}
const tests=files(path.join(root,'test')).sort();
if(!tests.length)throw Error('Fant ingen tester');
console.log('Kjører '+tests.length+' testfiler i isolert demomodus.');
const run=spawnSync(process.execPath,['--test',...tests],{cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,GW2_DEMO:'1'}});
if(run.error)throw run.error;
process.exitCode=run.status??1;

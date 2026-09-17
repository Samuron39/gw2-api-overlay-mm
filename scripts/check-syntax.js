'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..');
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):/\.js$/.test(e.name)?[path.join(dir,e.name)]:[]);}
const files=['src','scripts','test'].flatMap(d=>walk(path.join(root,d)));
for(const file of files){const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit',windowsHide:true});if(result.status!==0)process.exit(result.status||1);}
console.log('Syntaks kontrollert: '+files.length+' JavaScript-filer.');

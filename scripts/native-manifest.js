'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const TARGETS=[{dir:'helper',file:'gw2overlay_helper.exe'},{dir:'bridge',file:'gw2overlay_bridge.dll'}];
function hash(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function fingerprint(root,dir){
  const files=['Cargo.toml','Cargo.lock'];
  function walk(rel){for(const e of fs.readdirSync(path.join(root,dir,rel),{withFileTypes:true})){const p=path.posix.join(rel,e.name);if(e.isDirectory())walk(p);else files.push(p);}}
  walk('src');if(fs.existsSync(path.join(root,dir,'build.rs')))files.push('build.rs');
  return crypto.createHash('sha256').update(files.sort().map(f=>f+':'+hash(path.join(root,dir,f))).join('\n')).digest('hex');
}
function paths(root,target){const dir=path.join(root,target.dir,'target','release');return {binary:path.join(dir,target.file),manifest:path.join(dir,'gw2-build.json')};}
function stamp(root,target){const p=paths(root,target);fs.writeFileSync(p.manifest,JSON.stringify({source:fingerprint(root,target.dir),binary:hash(p.binary),builtAt:new Date().toISOString()},null,2)+'\n');}
function check(root,target){const p=paths(root,target);const m=JSON.parse(fs.readFileSync(p.manifest));if(m.source!==fingerprint(root,target.dir)||m.binary!==hash(p.binary))throw Error(target.dir+': native-bygg samsvarer ikke med kilden');}
module.exports={TARGETS,fingerprint,stamp,check};

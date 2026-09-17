'use strict';
const path=require('node:path');
const {TARGETS,check}=require('./native-manifest');
try {
  for(const target of TARGETS)check(path.join(__dirname,'..'),target);
  console.log('Hjelper og bro samsvarer med kildekode, Cargo.lock og byggmanifest.');
} catch(e) {console.error('Native-filer må bygges på nytt: npm run build:native\n'+e.message);process.exitCode=1;}

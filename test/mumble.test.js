'use strict';
const test=require('node:test'), assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {Mumble}=require('../src/mumble');
function harness(){
  const children=[],timers=[];
  const m=new Mumble({helperPath:()=> 'fake-helper',spawn:()=>{const p=new EventEmitter();p.stdout=new EventEmitter();p.stderr=new EventEmitter();p.kill=()=>p.emit('exit',null);children.push(p);return p;},setTimeout:(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer;},clearTimeout:t=>{if(t)t.cancelled=true;}});
  return {m,children,timers};
}
test('hjelper har begrenset backoff også ved uventet normal avslutning',()=>{
  const {m,children,timers}=harness();m.start();
  for(let i=0;i<5;i++){children.at(-1).emit('exit',i?1:0);assert.equal(timers.at(-1).ms,2000*2**i);timers.at(-1).fn();}
  children.at(-1).emit('exit',1);assert.equal(timers.length,5);assert.equal(m.wanted,false);
});
test('planlagt stopp avbryter restart og sene callbacks',()=>{
  const {m,children,timers}=harness();m.start();children[0].emit('exit',1);m.stop();
  assert.equal(timers[0].cancelled,true);timers[0].fn();assert.equal(children.length,1);
  m.start();m.stop();assert.equal(timers.length,1);
});
test('manglende binær gir tydelig feil uten restartsløyfe; stabil kjøring nullstiller backoff',()=>{
  const {m,children,timers}=harness();m.start();children[0].emit('error',Object.assign(Error('missing'),{code:'ENOENT'}));
  assert.equal(timers.length,0);assert.equal(m.state.running,false);assert.match(m.state.error,/ENOENT/);
  let now=0;m.deps.now=()=>now;
  m.start();children[1].emit('exit',1);timers[0].fn();children[2].stdout.emit('data',Buffer.from('{"running":true}\n'));
  children[2].emit('exit',1);assert.equal(timers.at(-1).ms,4000);
  timers.at(-1).fn();now=30000;children[3].stdout.emit('data',Buffer.from('{"running":true}\n'));
  children[3].emit('exit',1);assert.equal(timers.at(-1).ms,2000);m.stop();
});

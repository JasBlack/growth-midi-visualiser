// Regression tests run the actual patched handlers with a minimal event harness.
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const bundle = readFileSync(require('node:path').join(__dirname, '../assets/index-BWYXfAkm.js'), 'utf8');
const listeners = {};
const visibility = {};
const window = {addEventListener: (name, fn) => (listeners[name] ??= []).push(fn)};
const document = {hidden:false, addEventListener: (name, fn) => visibility[name] = fn};
const start = bundle.indexOf('const P5=');
const end = bundle.indexOf('let Pr=null', start);
const keyboardContext = vm.createContext({window, document, C: (o,k,v) => o[k] = v});
vm.runInContext(bundle.slice(start,end) + ';globalThis.Keyboard=D5;', keyboardContext);
const events = [];
const keyboard = new keyboardContext.Keyboard({push: e => events.push(e), now: () => 1});
const event = (key, extra={}) => ({key, code:'', target:null, preventDefault(){this.defaultPrevented=true}, ...extra});
keyboard.onDown(event('a'));
keyboard.onDown(event('a', {repeat:true}));
assert.equal(events.length, 1, 'a held note must not retrigger');
keyboard.onUp(event('A'));
assert.equal(events.at(-1).kind,'off');
assert.equal(keyboard.down.size,0);
for (const extra of [{ctrlKey:true},{metaKey:true},{altKey:true},{target:{isContentEditable:true}},{target:{closest:()=>true}}]) {
  const before = events.length;
  keyboard.onDown(event('a',extra));
  assert.equal(events.length,before,'editing and browser shortcuts must not play notes');
}
keyboard.onDown(event('a'));
keyboard.onDown(event('d'));
document.hidden=true;
visibility.visibilitychange();
assert.equal(keyboard.down.size,0,'backgrounding must release every keyboard note');
assert.equal(events.at(-1).kind,'off');
keyboard.onDown(event('g'));
listeners.blur[0]();
assert.equal(keyboard.down.size,0,'losing focus must release keyboard notes');

const actions = [];
let handler;
const shortcutContext = vm.createContext({
  window:{addEventListener:(_,fn)=>handler=fn},
  document:{body:{classList:{contains:()=>false}}},
  w5:()=>actions.push(['camera']), pd:x=>actions.push(['ui',x]), S5:()=>actions.push(['performance']),
  M5:()=>actions.push(['reset']), x5:()=>actions.push(['record']), b5:x=>actions.push(['still',x]),
  rb:x=>actions.push(['preset',x]), Fm:x=>actions.push(['engine',x]),
  Bm:[], fa:'file', je:{togglePlay:()=>actions.push(['play'])},
  he:{palette:0}, Im:x=>actions.push(['palette',x]),
  zt:{zoom:1,symmetry:1},Zt:new Map()
});
const shortcutStart=bundle.indexOf('window.addEventListener("keydown",i=>{var s,n;');
const shortcutEnd=bundle.indexOf('const _J=',shortcutStart);
vm.runInContext(bundle.slice(shortcutStart,shortcutEnd),shortcutContext);
for (const key of ['r','Backspace','Enter','q','c']) {
  const before=actions.length;
  handler(event(key,{repeat:true}));
  assert.equal(actions.length,before,'holding a shortcut must not repeat its action');
}
for (const extra of [{ctrlKey:true},{metaKey:true},{altKey:true},{isComposing:true},{defaultPrevented:true},{target:{closest:()=>true}}]) {
  const before=actions.length;
  handler(event('r',extra));
  assert.equal(actions.length,before,'shortcuts must respect browser and control interactions');
}
const tab=event('Tab'); handler(tab);
assert.equal(tab.defaultPrevented,undefined,'Tab must retain native focus navigation');
handler(event('r')); assert.equal(actions.at(-1)[0],'record');
handler(event('F2')); assert.deepEqual(actions.at(-1),['ui',true]);
handler(event('Escape',{target:{closest:()=>true}})); assert.deepEqual(actions.at(-1),['ui',false]);
handler(event('!',{shiftKey:true,code:'Digit1'})); assert.deepEqual(actions.at(-1),['preset',0]);
console.log('PASS: held notes, blur/visibility release, editing guards, repeat guards, modifiers, Tab, F2, Esc and presets');

const sections=[{textContent:'Species coral roots',open:false},{textContent:'Shared decay zoom',open:true}];
const search={value:'',addEventListener(){},blur(){}};
const help={textContent:''};
const nodes={controlSearch:search,searchHelp:help,returnUi:{addEventListener(){}},engineControls:{}};
const searchContext=vm.createContext({
  document:{getElementById:id=>nodes[id],querySelectorAll:()=>sections,body:{classList:{toggle(){}}}},
  MutationObserver:class{observe(){}},URLSearchParams,location:{search:''},pd(){}
});
vm.runInContext(readFileSync(require('node:path').join(__dirname,'interface.js'),'utf8'),searchContext);
search.value='CORAL';searchContext.growthFilterControls();
assert.equal(sections[0].hidden,false);assert.equal(sections[0].open,true);
assert.equal(sections[1].hidden,true);
search.value='nothing matches';searchContext.growthFilterControls();
assert.ok(sections.every(section=>section.hidden));assert.match(help.textContent,/No matching/);
search.value='';searchContext.growthFilterControls();
assert.ok(sections.every(section=>!section.hidden));
assert.equal(sections[0].open,false);assert.equal(sections[1].open,true);
console.log('PASS: setting search matches case-insensitively, handles no results and restores section state');

const storageContext=vm.createContext({localStorage:{setItem(){throw new Error('Storage blocked')}},dL:'test'});
const saveStart=bundle.indexOf('function IK(i)');
const saveEnd=bundle.indexOf('const LK=',saveStart);
vm.runInContext(bundle.slice(saveStart,saveEnd),storageContext);
assert.equal(storageContext.IK([]),false,'failed preset saves must be reported');
console.log('PASS: unavailable preset storage is handled without throwing');

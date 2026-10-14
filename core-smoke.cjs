const fs = require('fs');
const vm = require('vm');
const elements = new Proxy({}, { get: (target, key) => target[key] || (target[key] = { textContent:'', innerHTML:'', style:{}, value:'', classList:{ add(){}, remove(){} } }) });
const context = {
  console,
  Date,
  JSON,
  Math,
  setTimeout,
  localStorage: { data:{}, getItem(k){ return this.data[k] || null }, setItem(k,v){ this.data[k]=v }, removeItem(k){ delete this.data[k] } },
  document: { getElementById(id){ return elements[id] }, querySelectorAll(){ return [] }, addEventListener(){} },
  window: {},
  confirm(){ return true }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('dist/seed-data.js','utf8'), context);
vm.runInContext(fs.readFileSync('dist/app.js','utf8'), context);
const core = context.window.tarelkaCore;
if (!core) throw new Error('core export missing');
const seeded = core.seed();
if (core.nutrition({base:1,ing:{}} , 1).k !== 0) throw new Error('empty nutrition failed');
const rows = core.shopping();
if (!rows.length) throw new Error('shopping seed empty');
if (core.balance('prod_oat_flakes') !== 300) throw new Error('demo oats balance failed');
if (core.balance('prod_buckwheat') !== 500) throw new Error('demo buckwheat balance failed');
if (core.balance('prod_egg') !== 300) throw new Error('demo egg balance failed');
console.log('core smoke passed', { products: rows.length, oats: core.balance('prod_oat_flakes'), schema: seeded.schemaVersion });

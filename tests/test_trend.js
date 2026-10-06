const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../statistics_diy/public/js/dashboard.js'), 'utf8');
let document;
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.attributes = {}; this.handlers = {}; this.classList = {add() {}}; this.clientWidth = 640; this.offsetWidth = 180; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  contains(item) { return this.children.some(child => child === item || child.contains?.(item)); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(name, callback) { (this.handlers[name] ||= []).push(callback); }
  dispatch(name, values = {}) { for (const callback of this.handlers[name] || []) callback({preventDefault() {}, ...values}); }
  getBoundingClientRect() { return {left: 40, width: 600}; }
  focus() { document.activeElement = this; this.dispatch('focus'); }
}
const ids = new Map(['traffic-chart','chart-tooltip','chart-views','chart-visitors','clear-day','selected-chart-day','chart-legend'].map(id => [id, new Element('div')]));
ids.get('chart-views').checked = ids.get('chart-visitors').checked = true;
document = {activeElement: null, getElementById: id => ids.get(id), createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag)};
const context = vm.createContext({document, statisticsT: value => value, loads: 0, selectedDay: null, load: () => {context.loads++;}});
vm.runInContext(source.slice(source.indexOf('  let activeChartIndex'), source.indexOf('  exportButton.addEventListener')), context);
const rows = [
  {day:'2026-10-04',views:0,visitors:0,available:true},
  {day:'2026-10-05',views:10,visitors:3,available:true},
  {day:'2026-10-06',views:null,visitors:null,available:false}
];
context.chart(rows);
let svg = ids.get('traffic-chart').children.find(item => item.tag === 'svg');
svg.dispatch('pointermove', {clientX:45});
assert.match(ids.get('chart-tooltip').textContent, /2026-10-04/);
svg.dispatch('pointerdown', {clientX:45,clientY:100}); svg.dispatch('pointerup', {clientX:45,clientY:100});
assert.equal(context.selectedDay, '2026-10-04'); assert.equal(context.loads, 1);
svg.dispatch('pointerdown', {clientX:45,clientY:100}); svg.dispatch('pointerup', {clientX:45,clientY:100});
assert.equal(context.selectedDay, null);
const beforeScroll = context.loads;
svg.dispatch('pointerdown', {clientX:45,clientY:100}); svg.dispatch('pointerup', {clientX:45,clientY:140});
assert.equal(context.loads, beforeScroll);
svg.dispatch('keydown', {key:'End'}); svg.dispatch('keydown', {key:'Enter'});
assert.equal(context.loads, beforeScroll, 'Unavailable dates cannot be selected');
svg.dispatch('keydown', {key:'ArrowLeft'}); svg.dispatch('keydown', {key:'Enter'});
assert.equal(context.selectedDay,'2026-10-05');
svg.dispatch('keydown', {key:'Escape'}); assert.equal(context.selectedDay,null);
ids.get('chart-visitors').checked = false; context.chart(rows);
assert.equal(ids.get('chart-views').disabled, true);
assert.equal(ids.get('chart-visitors').disabled, false);
console.log('Trend pointer/tap selection, toggle reset, touch-scroll safety, keyboard navigation and series guard passed.');

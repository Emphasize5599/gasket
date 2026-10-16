require('../../assets/web/democars.js');
const demo = globalThis.DemoCars.create();
const base = (name, drive, tires, extra) => Object.assign({ name, year: 2025, make: 'Chevrolet', model: 'Blazer', power: 'gas', info: { drive }, tires }, extra || {});
module.exports = [
  base('blazer-good', 'awd', { size: '235/65R18', type: 'All-Season', brand: 'Michelin', model: 'Primacy Tour A/S', warrantyMi: 65000, tread: { mode: 'miles', miles: 8000, rotated: 'yes', dot: '3224' }, spare: { kind: 'kit' } }),
  base('old-save-unknowns', undefined, { size: '215/55R17', type: 'All-Season', tread: { mode: 'miles', miles: 41000, rotated: 'sometimes' }, spare: {} }, { year: 2017, make: 'Honda', model: 'Accord', info: {} }),
  base('all-fine-measured', 'fwd', { size: '205/55R16', type: 'Touring All-Season', brand: 'Goodyear', model: 'Assurance', tread: { mode: 'measure', depth: 8, dot: '1025' }, spare: { kind: 'compact', dot: '0923' } }, { year: 2023, make: 'Honda', model: 'Civic' }),
].concat(demo);

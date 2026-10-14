/* NHTSA identity catalog; deliberately separate from EPA ratings and tire fitment. */
(function(root){
  'use strict';
  var TYPES=[{id:2,label:'Car',type:'car',query:'car'},{id:3,label:'Truck',type:'truck',query:'truck'},{id:7,label:'SUV / minivan',type:'suv',query:'multipurpose'}];
  function records(body){var j=typeof body==='string'?JSON.parse(body):body;if(!j||!Array.isArray(j.Results)||+j.Count!==j.Results.length)throw new Error('NHTSA returned an incomplete vehicle list');return j.Results;}
  function unique(rows,kind){var seen={};return rows.reduce(function(out,r){var id=Number(r[kind+'_ID']||r[kind+'Id']),name=String(r[kind+'_Name']||r[kind+'Name']||'').trim();if(id>0&&name&&!seen[id]){seen[id]=true;out.push({value:String(id),text:name});}return out;},[]).sort(function(a,b){return a.text.localeCompare(b.text);});}
  function years(now){var out=[];for(var y=now+1;y>=1996;y--)out.push({value:String(y),text:String(y)});return out;}
  function create(call,kv){var pending={},BASE='https://vpic.nhtsa.dot.gov/api/vehicles/';
    function typeName(id){var t=TYPES.filter(function(t){return String(t.id)===String(id);})[0];if(!t)throw new Error('Choose a vehicle type');return t.query;}
    async function get(path){var key='vpic-catalog-v1|'+path,cached=kv&&kv.get('lookups',key,30*864e5);if(cached)return cached.v;if(pending[key])return pending[key];pending[key]=(async function(){var r=await call('fetchJson',BASE+path+'?format=json');if(!r||r.error)throw new Error(r&&r.error||'No NHTSA response');var rows=records(r.body);if(kv)kv.put('lookups',key,rows);return rows;})();try{return await pending[key];}finally{delete pending[key];}}
    return {makes:async function(type){return unique(await get('GetMakesForVehicleType/'+encodeURIComponent(typeName(type))),'Make');},models:async function(make,year,type){if(!/^\d+$/.test(String(make))||+make<=0||!Number.isInteger(+year)||+year<1996)throw new Error('Choose a make and year from 1996 onward');return unique(await get('GetModelsForMakeIdYear/makeId/'+make+'/modelyear/'+year+'/vehicletype/'+encodeURIComponent(typeName(type))),'Model');}};
  }
  var api={TYPES:TYPES,records:records,unique:unique,years:years,create:create};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.VehicleCatalog=api;
})(typeof window==='object'?window:globalThis);

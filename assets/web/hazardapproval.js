/* Shared opt-in controls for settings and hourly route screening. */
(function(root){'use strict';
 function html(value,kinds,esc,prefix){var r=TimeWindows.approvalRules(value);
  function checks(attr,allow){return Object.keys(kinds).map(function(k){return '<label class="nf chk"><span>'+esc(kinds[k][0])+'</span><input type="checkbox" data-'+prefix+'-'+attr+'="'+esc(k)+'"'+(allow.includes(k)?' checked':'')+'></label>';}).join('');}
  return '<p class="lead small keep">Check only hazards you want automatically approved. Everything starts unchecked. Incomplete forecasts and tire risks still need review.</p><details class="disclosure-tile" data-hazard-section="anywhere"><summary>Anywhere along the route</summary>'+checks('hazard',r.allow)+'</details><details class="disclosure-tile" data-hazard-section="endpoints"><summary>Near starts and destinations</summary><p class="lead small keep">Driving miles from either end of each leg. The whole hazard must stay in these endpoint zones; hazards extending into the middle still need review.</p><label class="nf"><span>Miles from each endpoint</span><input type="number" min="0" step="0.1" inputmode="decimal" data-'+prefix+'-endpoint-miles value="'+esc(r.endpointMiles)+'"></label>'+checks('endpoint',r.endpointAllow)+'</details>';
 }
 function read(host,prefix){var selected=function(attr){return Array.from(host.querySelectorAll('[data-'+prefix+'-'+attr+']:checked')).map(function(e){return e.getAttribute('data-'+prefix+'-'+attr);});};return TimeWindows.approvalRules({version:2,allow:selected('hazard'),endpointAllow:selected('endpoint'),endpointMiles:host.querySelector('[data-'+prefix+'-endpoint-miles]').value});}
 root.HazardApproval={html:html,read:read};
})(window);

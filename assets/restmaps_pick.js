function(q,id){
 // 0.0.517 (owner): the manual Maps picker opens the raw coordinates, taps the page's own Nearby button and
 // searches the keywords there (as a person would); once per picker session, the user can change the search after
 var k='gasketNearby:'+id;if(window.__gasketNearby===k)return;window.__gasketNearby=k;try{if(sessionStorage.getItem(k))return;sessionStorage.setItem(k,'1');}catch(e){}
 var t0=Date.now();
 function lab(x){return ((x.getAttribute('aria-label')||'')+' '+(x.innerText||'')).trim();}
 function find(){return Array.from(document.querySelectorAll('button')).find(function(x){return /^nearby\b/i.test(lab(x))||/\bnearby$/i.test(lab(x));});}
 function box(){return document.querySelector('input#searchboxinput')||document.querySelector('input[name=q]');}
 function type(n){var i=box();if((!i||!/nearby/i.test(i.getAttribute('placeholder')||''))&&n<15){setTimeout(function(){type(n+1);},200);return;}if(!i)return;
  i.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,q);i.dispatchEvent(new Event('input',{bubbles:true}));
  setTimeout(function(){var go=document.querySelector('#searchbox-searchbutton')||document.querySelector('button[aria-label="Search"]');if(go)go.click();else i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true}));},250);}
 function step(){var b=find();if(!b){if(Date.now()-t0<12000)setTimeout(step,300);return;}b.click();setTimeout(function(){type(0);},400);}
 step();
}

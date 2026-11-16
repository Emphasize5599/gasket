/* Patch background list updates without replacing focused controls, images or
 * unchanged rows. No geometry reads: scrolling never forces a layout here. */
(function(root){'use strict';
 function key(n){return n.nodeType===1?(n.id?'id:'+n.id:n.hasAttribute('data-rest-row')?'rest:'+n.getAttribute('data-rest-row'):n.hasAttribute('data-rest-drive-night')?'night:'+n.getAttribute('data-rest-drive-night'):null):null;}
 function same(a,b){return a&&a.nodeType===b.nodeType&&(a.nodeType!==1||a.tagName===b.tagName)&&key(a)===key(b);}
 function patch(a,b){
  if(a.nodeType!==1){if(a.nodeValue!==b.nodeValue)a.nodeValue=b.nodeValue;return;}
  var source=key(b)&&b.outerHTML;if(source&&a.__patchSource===source)return;
  var focused=a===a.ownerDocument.activeElement;
  Array.from(a.attributes).forEach(function(v){if(!b.hasAttribute(v.name)&&!(a.tagName==='DETAILS'&&v.name==='open'))a.removeAttribute(v.name);});
  Array.from(b.attributes).forEach(function(v){if(a.getAttribute(v.name)!==v.value)a.setAttribute(v.name,v.value);});
  children(a,b);
  if(!focused&&a.tagName==='INPUT'){a.checked=b.checked;if(a.value!==b.value)a.value=b.value;}
  if(!focused&&a.tagName==='SELECT'&&a.value!==b.value)a.value=b.value;
  if(source)a.__patchSource=source;
 }
 function children(a,b){var known=new Map();Array.from(a.childNodes).forEach(function(n){var k=key(n);if(k)known.set(k,n);});var current=a.firstChild;
  Array.from(b.childNodes).forEach(function(fresh){var k=key(fresh),old=k?known.get(k):same(current,fresh)?current:null;
   if(!same(old,fresh)){old=fresh.cloneNode(true);a.insertBefore(old,current);}else {if(old!==current)a.insertBefore(old,current);patch(old,fresh);}current=old.nextSibling;
  });while(current){var next=current.nextSibling;a.removeChild(current);current=next;}
 }
 function html(host,text){if(host.__patchHtml===text)return false;var template=host.ownerDocument.createElement('template');template.innerHTML=text;children(host,template.content);host.__patchHtml=text;return true;}
 root.UiPatch={html:html};
})(window);

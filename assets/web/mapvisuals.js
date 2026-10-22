/* Shared map geometry sizing. Labels and invisible tap targets stay readable/tappable.
 * Coverage/accuracy circles keep their real geographic radius, not a station-dot radius. */
(function(root){
  'use strict';
  function scale(z){return Math.max(.35,Math.min(1.15,Math.pow(2,(z-13)*.14)));}
  function apply(layer,z){
    var base=layer._zoomVisual;if(!base)return;
    var renderer=layer._renderer,nativeScale=renderer&&Number.isFinite(renderer._zoom)?layer._map.getZoomScale(z,renderer._zoom):1,f=scale(z)/nativeScale;
    if(base.radius!=null){
      // Leaflet 1.9's renderer transforms its old coordinate space during fly/pinch.
      // setRadius()/CircleMarker.setStyle() reproject into the NEW space and then
      // transform it again, moving the dot. Change only size in renderer space;
      // preserve its point, and include old/new bounds in Canvas's dirty rectangle.
      if(renderer._requestRedraw)renderer._requestRedraw(layer);
      layer.options.radius=layer._radius=base.radius*f;
      layer._updateBounds();
      L.Path.prototype.setStyle.call(layer,{weight:base.weight*f});
      layer._update();
    }else layer.setStyle({weight:base.weight*f});
  }
  function style(layer,options){
    if(layer._zoomVisual&&options.weight!=null)layer._zoomVisual.weight=options.weight;
    layer.setStyle(options);if(layer._map)apply(layer,layer._map.getZoom());
  }
  L.Map.addInitHook(function(){
    var map=this,items=new Set(),frame=0;
    function update(){frame=0;var z=map.getZoom();items.forEach(function(layer){apply(layer,z);});}
    function schedule(){if(!frame)frame=requestAnimationFrame(update);}
    map.on('layeradd',function(e){
      var layer=e.layer,o=layer.options||{},dot=layer instanceof L.CircleMarker&&!(layer instanceof L.Circle)&&o.radius>0;
      var route=layer instanceof L.Polyline&&!(layer instanceof L.Polygon)&&o.weight>=4&&o.opacity>.01;
      if(o.zoomScale===false||!layer._zoomVisual&&!dot&&!route)return;
      if(!layer._zoomVisual)layer._zoomVisual={weight:o.weight,radius:dot?o.radius:null};
      items.add(layer);apply(layer,map.getZoom());
    });
    map.on('layerremove',function(e){items.delete(e.layer);});
    map.on('zoom',schedule);
    // Run after Leaflet resets its renderer space, not in the middle of its handlers.
    map.on('zoomend moveend',schedule);
    map.on('unload',function(){if(frame)cancelAnimationFrame(frame);items.clear();});
  });
  root.MapVisuals={scale:scale,style:style};
})(window);

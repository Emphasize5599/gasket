// The car's editor is a submenu over the Garage, closed with its Save button. Tests written for the Garage beneath it:
// a click outside the editor (and outside a dialog or another page) saves and closes it first; #gEdit while it's open
// is the old Done (save).
module.exports=function guard(p){
  const click=p.click.bind(p);
  p.click=async(sel,...rest)=>{
    if(await p.locator('.sub-page.car-edit').count()&&!await p.locator('#cfm.on, .qpop, .sub-page:not(.car-edit), #gSave[disabled]').count()&&!await p.locator('.sub-page.car-edit, #cfm').locator(sel).count()){
      await click('#gSave');await p.waitForTimeout(150);if(sel==='#gEdit')return;
    }
    return click(sel,...rest);
  };
  return p;
};

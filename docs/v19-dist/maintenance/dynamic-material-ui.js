const dynamicSelect=Y('dynamicMaterial');
dynamicSelect.replaceChildren();
for(const [index,material] of I_.entries()){
  const option=document.createElement('option');option.value=String(index);option.textContent=material.name;
  dynamicSelect.appendChild(option);
}
function syncDynamicMaterialUI(){
  const enabled=te?.id==='organism';dynamicSelect.disabled=!enabled;Y('dynamicNext').disabled=!enabled;
  if(enabled)dynamicSelect.value=String(referenceValue('shader'));
  for(const key of ['materialSpeed','materialScale','materialReact']){
    const input=Y(key);input.disabled=!enabled;
    if(enabled)input.value=String(referenceValue(key,1));
    Y(key+'Value').textContent=input.value;
  }
}
dynamicSelect.onchange=()=>referenceSet('shader',+dynamicSelect.value);
Y('dynamicNext').onclick=()=>{
  const current=referenceValue('shader');
  referenceSet('shader',current<dynamicMaterialStart?dynamicMaterialStart:dynamicMaterialStart+(current-dynamicMaterialStart+1)%dynamicMaterialEntries.length);
  syncDynamicMaterialUI();
};
for(const key of ['materialSpeed','materialScale','materialReact'])Y(key).oninput=event=>{referenceSet(key,+event.target.value);syncDynamicMaterialUI();};
syncDynamicMaterialUI();setInterval(syncDynamicMaterialUI,400);

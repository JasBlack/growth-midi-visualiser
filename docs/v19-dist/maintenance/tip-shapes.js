const tipShapeNames=['sphere','cube','diamond','cone','ring','disc','hexagon','star','heart','custom image','custom OBJ'];
function tipFlatGeometry(kind){
 const points=[];
 if(kind==='star')for(let i=0;i<10;i++){const a=i*Math.PI/5+Math.PI/2,r=i%2?.43:1;points.push([Math.cos(a)*r,Math.sin(a)*r]);}
 else for(let i=0;i<48;i++){const a=i*Math.PI*2/48;points.push([Math.pow(Math.sin(a),3),(.8125*Math.cos(a)-.3125*Math.cos(2*a)-.125*Math.cos(3*a)-.0625*Math.cos(4*a))]);}
 const data=[];for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];data.push(0,0,0,a[0],a[1],0,b[0],b[1],0);}
 const g=new Ct();g.setAttribute('position',new es(new Float32Array(data),3));g.computeVertexNormals();return g;
}
function parseTipOBJ(text){
 const verts=[],data=[];
 for(const line of text.split(/\r?\n/)){
  const parts=line.split('#')[0].trim().split(/\s+/);if(parts[0]==='v'){
   const v=parts.slice(1,4).map(Number);if(v.length!==3||v.some(x=>!Number.isFinite(x)))throw new Error('Invalid OBJ vertex');
   if(verts.length>=10000)throw new Error('Use a smaller OBJ: at most 10,000 vertices');verts.push(v);
  }else if(parts[0]==='f'){
   const indices=parts.slice(1).filter(x=>!x.startsWith('#')).map(x=>{const n=Number(x.split('/')[0]);return n<0?verts.length+n:n-1});
   if(indices.length<3||indices.length>64||indices.some(i=>!Number.isInteger(i)||!verts[i]))throw new Error('Invalid OBJ face');
   for(let i=1;i<indices.length-1;i++){if(data.length>=2048*9)throw new Error('Use a simpler OBJ: at most 2,048 triangles');data.push(...verts[indices[0]],...verts[indices[i]],...verts[indices[i+1]]);}
  }
 }
 if(!data.length)throw new Error('OBJ has no faces');
 const g=new Ct();g.setAttribute('position',new es(new Float32Array(data),3));g.computeBoundingBox();
 const size=new A(),center=new A();g.boundingBox.getSize(size);g.boundingBox.getCenter(center);const span=Math.max(size.x,size.y,size.z);
 if(!Number.isFinite(span)||span<1e-8){g.dispose();throw new Error('OBJ has no usable extent');}
 g.translate(-center.x,-center.y,-center.z);g.scale(2/span,2/span,2/span);g.computeVertexNormals();return g;
}
Object.assign(tw.prototype,{
 syncTipShape(){
  const index=G(this.controls,'tipShape');if(this.tipShapeMesh===this.tipMesh&&this.tipShapeCurrent===index&&this.tipShapeRevision===this.tipUploadRevision)return;
  this.tipShapeMesh=this.tipMesh;this.tipShapeCurrent=index;this.tipShapeRevision=this.tipUploadRevision;
  let g;
  switch(index){
   case 1:g=new Hc(1.5,1.5,1.5);break;case 2:g=new Dp(1,0);break;case 3:g=new l2(.8,1.8,10);break;
   case 4:g=new u2(.7,.2,6,16);break;case 5:g=new Py(1,20);break;case 6:g=new Py(1,6);break;
   case 7:g=tipFlatGeometry('star');break;case 8:g=tipFlatGeometry('heart');break;
   case 9:g=this.tipImage?new Up(2,2):new kp(1,1);break;case 10:g=this.tipOBJ?this.tipOBJ.clone():new kp(1,1);break;
   default:g=new kp(1,1);
  }
  this.tipMesh.geometry.dispose();this.tipMesh.geometry=g;
  const material=this.tipMesh.material;
  material.map=index===9?this.tipImage??null:null;material.alphaTest=index===9?.12:0;material.side=Et;material.needsUpdate=true;
 },
 orientTip(){
  const index=G(this.controls,'tipShape');
  if(index>=5&&index<=9)this.dummy.quaternion.copy(this.camera.quaternion);else this.dummy.quaternion.identity();
 },
 async loadTipFile(file){
  if(!file)return;if(file.size>8*1024*1024)throw new Error('Use an image or OBJ smaller than 8 MB');
  const request=(this.tipUploadRequest||0)+1;this.tipUploadRequest=request;
  if(/\.obj$/i.test(file.name)){
   const geometry=parseTipOBJ(await file.text());if(request!==this.tipUploadRequest||!this.ready){geometry.dispose();return;}
   this.tipOBJ?.dispose();this.tipOBJ=geometry;this.tipUploadRevision=(this.tipUploadRevision||0)+1;return 10;
  }
  if(!/\.(png|webp|jpe?g)$/i.test(file.name))throw new Error('Choose PNG, WebP, JPG, or a small OBJ');
  const bitmap=await createImageBitmap(file,{resizeWidth:256,resizeHeight:256,resizeQuality:'high'});
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
  const context=canvas.getContext('2d');context.drawImage(bitmap,0,0,256,256);bitmap.close();
  if(request!==this.tipUploadRequest||!this.ready)return;
  const texture=new IU(canvas);texture.colorSpace=us;texture.needsUpdate=true;
  this.tipImage?.dispose();this.tipImage=texture;this.tipUploadRevision=(this.tipUploadRevision||0)+1;return 9;
 },
 disposeTipUploads(){this.tipUploadRequest=(this.tipUploadRequest||0)+1;this.tipImage?.dispose();this.tipOBJ?.dispose();this.tipImage=this.tipOBJ=null;}
});
const tipUnmount=tw.prototype.unmount;
tw.prototype.unmount=function(){this.disposeTipUploads();return tipUnmount.call(this);};

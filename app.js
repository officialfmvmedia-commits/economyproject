import * as THREE from 'three';
import {MapControls} from 'three/addons/controls/MapControls.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

const A=[{id:'openai',n:'OpenAI',m:'GPT',c:'#2fb89a',l:'O',st:'aggressive monopolist',hat:'top'},
{id:'grok',n:'Grok',m:'xAI',c:'#7d8796',l:'X',st:'contrarian speculator',hat:'cap'},
{id:'anthropic',n:'Anthropic',m:'Claude',c:'#e2774f',l:'A',st:'cautious coalition builder',hat:'beret'},
{id:'google',n:'Google',m:'Gemini',c:'#4b8de8',l:'G',st:'infrastructure hoarder',hat:'propeller'},
{id:'qwen',n:'Qwen',m:'Alibaba',c:'#a26be0',l:'Q',st:'low-cost volume trader',hat:'straw'}];
const ac=id=>A.find(a=>a.id==id);
let LIVE=null,LIVE_CTRL=null;
const wealthStr=a=>(+a.sol||0).toFixed(3)+' SOL';
const BRAINS={openai:'OpenAI',grok:'xAI',anthropic:'Anthropic',google:'Google',qwen:'Alibaba'};
const brainStr=a=>{const co=BRAINS[String(a.id).toLowerCase()]||a.provider||'';return a.model?`${co} · ${String(a.model).split('/').pop()}`:(co||'—')};
const fin=v=>Number.isFinite(v)?v:0;
const pick=r=>r[Math.random()*r.length|0];

// ---------- noise ----------
const hash=(x,z)=>{const s=Math.sin(x*127.1+z*311.7)*43758.5453;return s-Math.floor(s)};
function vnoise(x,z){const xi=Math.floor(x),zi=Math.floor(z),xf=x-xi,zf=z-zi,u=xf*xf*(3-2*xf),v=zf*zf*(3-2*zf);
 const a=hash(xi,zi),b=hash(xi+1,zi),c=hash(xi,zi+1),d=hash(xi+1,zi+1);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v}
const fbm=(x,z,o=4)=>{let s=0,a=.5,f=1;for(let i=0;i<o;i++){s+=a*vnoise(x*f,z*f);a*=.5;f*=2.03}return s};
const sstep=(a,b,x)=>{const t=Math.min(Math.max((x-a)/(b-a),0),1);return t*t*(3-2*t)};
const gauss=(x,z,cx,cz,r)=>Math.exp(-((x-cx)**2+(z-cz)**2)/(r*r));

// ---------- city layout ----------
const CITY_R=56,WALL_R=59,CITY_H=2.6,PLAZA_R=15;
const D=[{n:'Docks',ic:'⚓',res:'goods',type:'warehouse'},{n:'Market',ic:'🛍️',res:'trade',type:'shop'},{n:'Old Town',ic:'🏘️',res:'housing',type:'house'},{n:'Farm Outskirts',ic:'🌾',res:'food',type:'farm'},
 {n:'Garden Terrace',ic:'🌸',res:'tourism',type:'house'},{n:'Power Yards',ic:'⚡',res:'energy',type:'power'},{n:'Factory Row',ic:'🏭',res:'steel',type:'factory'},{n:'Datacenter Quarter',ic:'💾',res:'compute',type:'datacenter'}];
const NDIS=D.length,SEC=Math.PI*2/NDIS;
const angN=a=>((a%(Math.PI*2))+Math.PI*2)%(Math.PI*2);
const distOf=(x,z)=>Math.floor(angN(Math.atan2(z,x)+SEC/2)/SEC)%NDIS;// district 0 centred at angle 0 (east)
const midAng=k=>k*SEC;
const avenueAng=k=>k*SEC+SEC/2;
const GATES=[0,2,3,4,7];// avenue indices that pass through the wall
const harbor={x:Math.cos(0)*40,z:Math.sin(0)*40+2,r:6.5};

// frontier roads from gates
const roads=[];
function mkRoad(ax,az,bx,bz,wob){const pts=[],L=Math.hypot(bx-ax,bz-az),n=Math.ceil(L/2),nx=-(bz-az)/L,nz=(bx-ax)/L;
 for(let k=0;k<=n;k++){const t=k/n,w=Math.sin(t*Math.PI)*Math.sin(t*Math.PI*2+wob)*7;pts.push(new THREE.Vector2(ax+(bx-ax)*t+nx*w,az+(bz-az)*t+nz*w))}return pts}
const gateEnds=[118,112,118,120,115];
GATES.forEach((g,k)=>{const a=avenueAng(g),c=Math.cos(a),s=Math.sin(a);roads.push(mkRoad(c*(WALL_R-1),s*(WALL_R-1),c*gateEnds[k],s*gateEnds[k],k*1.3))});
// city streets (rings + avenues)
const streets=[];
for(const r of[PLAZA_R+1.5,35,CITY_R]){const pts=[];for(let k=0;k<=160;k++){const a=k/160*Math.PI*2;pts.push(new THREE.Vector2(Math.cos(a)*r,Math.sin(a)*r))}streets.push(pts)}
for(let k=0;k<NDIS;k++){const a=avenueAng(k),pts=[];for(let r=PLAZA_R+1.5;r<=WALL_R+(GATES.includes(k)?1:-2);r+=2)pts.push(new THREE.Vector2(Math.cos(a)*r,Math.sin(a)*r));streets.push(pts)}

const river=[[62,-80],[78,-45],[84,-8],[82,30],[74,70],[66,140]].map(p=>new THREE.Vector2(...p));
const river2=[[-40,-78],[-70,-70],[-100,-58],[-130,-50],[-170,-52]].map(p=>new THREE.Vector2(...p));
const lakes=[[-95,40,10],[-38,-100,8],[110,55,8],[30,95,9]];
function distPoly(x,z,pts){let best=1e9;for(let k=0;k<pts.length-1;k++){const a=pts[k],b=pts[k+1],dx=b.x-a.x,dz=b.y-a.y,l2=dx*dx+dz*dz||1;let t=((x-a.x)*dx+(z-a.y)*dz)/l2;t=Math.max(0,Math.min(1,t));const d=Math.hypot(x-a.x-dx*t,z-a.y-dz*t);if(d<best)best=d}return best}
function lineDist(x,z,list){let d=1e9;for(const r of list){const a=r[0],b=r[r.length-1];if(r.length<40&&(x<Math.min(a.x,b.x)-15||x>Math.max(a.x,b.x)+15||z<Math.min(a.y,b.y)-15||z>Math.max(a.y,b.y)+15))continue;d=Math.min(d,distPoly(x,z,r))}return d}
const roadDist=(x,z)=>lineDist(x,z,roads);
function streetDist(x,z){const r=Math.hypot(x,z);let d=Math.min(Math.abs(r-PLAZA_R-1.5),Math.abs(r-35),Math.abs(r-CITY_R));const a=Math.atan2(z,x);for(let k=0;k<NDIS;k++){let da=Math.abs(angN(a-avenueAng(k)));da=Math.min(da,Math.PI*2-da);if(da<Math.PI/2)d=Math.min(d,r*Math.sin(da))}return d}

const BIO={meadow:'#93d46a',forest:'#6fbf5c',autumn:'#c9c56a',desert:'#f0d494',alpine:'#a6d690'};
const bioC=[{b:'meadow',x:-90,z:-10,r:55},{b:'meadow',x:0,z:0,r:70},{b:'forest',x:100,z:-30,r:50},{b:'forest',x:110,z:20,r:35},{b:'autumn',x:-70,z:80,r:50},{b:'desert',x:75,z:90,r:45},{b:'alpine',x:-40,z:-95,r:40}];
function biomeAt(x,z){let best='meadow',bw=0;const out={};for(const c of bioC){out[c.b]=(out[c.b]||0)+gauss(x,z,c.x,c.z,c.r);if(out[c.b]>bw){bw=out[c.b];best=c.b}}return best}
function mountainAmt(x,z){return Math.max(gauss(x,z,20,-112,32),gauss(x,z,-92,-82,24)*.85,gauss(x,z,125,-75,22)*.7,gauss(x,z,-118,30,16)*.6)}
function rawH(x,z){const d=Math.hypot(x,z*1.05)/145+(fbm(x*.02+5,z*.02)-.5)*.35;let m=1-sstep(.8,1.04,d);
 for(const[ix,iz,ir]of[[142,40,14],[-145,-10,12],[-122,110,13],[125,-118,11],[5,152,10]])m=Math.max(m,1-sstep(ir*.6,ir*1.1,Math.hypot(x-ix,z-iz)+(fbm(x*.08,z*.08)-.5)*8));
 let h=m*(2.2+fbm(x*.035,z*.035)*5)-(1-m)*7;const mt=mountainAmt(x,z);if(mt>.05){const r=1-Math.abs(fbm(x*.05+9,z*.05+3,5)*2-1);h+=mt*(r*r*34+fbm(x*.1,z*.1)*8)}return h}
function H(x,z){let h=rawH(x,z);const cd=Math.hypot(x,z);const k=1-sstep(WALL_R+1,WALL_R+16,cd);if(k>0)h=h+(CITY_H-h)*k;
 const rd=roadDist(x,z);if(rd<9){const q=1-sstep(2,9,rd);h=h+(Math.min(Math.max(h,1.6),4.5)-h)*q}
 for(const rv of[river,river2]){const d=distPoly(x,z,rv);if(d<9){const q=1-sstep(2.5,8,d);h=h+(-1.4-h)*q}}
 for(const[lx,lz,lr]of lakes){const d=Math.hypot(x-lx,z-lz)+(fbm(x*.1,z*.1)-.5)*5;if(d<lr+5){const q=1-sstep(lr-2,lr+5,d);h=h+(-1.6-h)*q}}
 {const d=Math.hypot(x-harbor.x,z-harbor.z);if(d<harbor.r+1.5){const q=1-sstep(harbor.r-1,harbor.r+1.2,d);h=h+(-1.2-h)*q}}
 return h}
const SIZE=330,SEG=240,CELL=SIZE/SEG;const HG=new Float32Array((SEG+1)*(SEG+1));
for(let j=0;j<=SEG;j++)for(let i=0;i<=SEG;i++)HG[j*(SEG+1)+i]=H(-SIZE/2+i*CELL,-SIZE/2+j*CELL);
function hAt(x,z){const fx=(x+SIZE/2)/CELL,fz=(z+SIZE/2)/CELL;const i=Math.max(0,Math.min(SEG-1,Math.floor(fx))),j=Math.max(0,Math.min(SEG-1,Math.floor(fz)));const u=fx-i,v=fz-j;const g=(a,b)=>HG[b*(SEG+1)+a];
 return fin(g(i,j)*(1-u)*(1-v)+g(i+1,j)*u*(1-v)+g(i,j+1)*(1-u)*v+g(i+1,j+1)*u*v)}

// ---------- renderer ----------
const el=document.getElementById('world');
const R=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
R.setPixelRatio(Math.min(devicePixelRatio,1.5));R.shadowMap.enabled=true;R.shadowMap.type=THREE.PCFShadowMap;el.appendChild(R.domElement);
const SKY='#9fdcf0';const scene=new THREE.Scene();scene.background=new THREE.Color(SKY);scene.fog=new THREE.Fog(SKY,400,1200);
const cam=new THREE.PerspectiveCamera(32,1,1,1000);
const ctr=new MapControls(cam,R.domElement);ctr.enableDamping=true;ctr.dampingFactor=.08;ctr.minDistance=12;ctr.maxDistance=440;ctr.maxPolarAngle=1.25;ctr.minPolarAngle=.3;ctr.screenSpacePanning=false;ctr.zoomToCursor=true;
function size(){R.setSize(innerWidth,innerHeight);cam.aspect=innerWidth/innerHeight;cam.updateProjectionMatrix()}addEventListener('resize',size);size();
scene.add(new THREE.HemisphereLight('#fff4dc','#86b871',1.7));
const sun=new THREE.DirectionalLight('#fff0d0',2.3);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.bias=-.0006;sun.shadow.normalBias=.04;scene.add(sun,sun.target);
const matCache={};const M=c=>matCache[c]||(matCache[c]=new THREE.MeshStandardMaterial({color:c,roughness:.85}));
const mesh=(g,c,p=[0,0,0],cs=true)=>{const m=new THREE.Mesh(g,typeof c=='string'?M(c):c);m.position.set(...p);m.castShadow=cs;m.receiveShadow=true;return m};

// ---------- terrain ----------
{const g=new THREE.PlaneGeometry(SIZE,SIZE,SEG,SEG);g.rotateX(-Math.PI/2);const p=g.attributes.position,col=new Float32Array(p.count*3),c=new THREE.Color(),t=new THREE.Color();
 for(let k=0;k<p.count;k++){const x=p.getX(k),z=p.getZ(k),h=HG[k];p.setY(k,h);const b=biomeAt(x,z);
  c.set(BIO[b]);t.set(b=='desert'?'#e8c47e':'#7ec15a');c.lerp(t,(fbm(x*.08,z*.08)-.4)*.5);if(b=='autumn'){t.set('#e0a35a');c.lerp(t,fbm(x*.05+3,z*.05)*.5)}
  if(h<1.3){t.set('#f4e3b1');c.lerp(t,sstep(1.3,.6,h))}if(h<-.3){t.set('#8fe0e6');c.lerp(t,sstep(-.3,-1.5,h));t.set('#3fa6c8');c.lerp(t,sstep(-2,-7,h)*.8)}
  if(h>7){t.set('#a8a29a');c.lerp(t,sstep(7,13,h))}if(h>20){t.set('#ffffff');c.lerp(t,sstep(20,23,h+fbm(x*.2,z*.2)*3))}col.set([c.r,c.g,c.b],k*3)}
 g.setAttribute('color',new THREE.BufferAttribute(col,3));g.computeVertexNormals();
 const tm=new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95}));tm.receiveShadow=true;scene.add(tm);window.__terrain=tm}
const water=new THREE.Mesh(new THREE.PlaneGeometry(2000,2000),new THREE.MeshStandardMaterial({color:'#5cc3df',roughness:.25,transparent:true,opacity:.78}));water.rotation.x=-Math.PI/2;water.position.y=-.2;scene.add(water);

// ---------- district ground (tinted by control) ----------
const NEUTRAL=new THREE.Color('#e3edc4');
const dCur=D.map(()=>NEUTRAL.clone()),dTgt=D.map(()=>NEUTRAL.clone());
const ground=(()=>{const RS=24,AS=192,pos=[],col=[],dis=[],idx=[];
 for(let i=0;i<=RS;i++)for(let j=0;j<=AS;j++){const r=PLAZA_R+(CITY_R+1.5-PLAZA_R)*i/RS,a=j/AS*Math.PI*2,x=Math.cos(a)*r,z=Math.sin(a)*r;pos.push(x,CITY_H+.03,z);col.push(1,1,1);dis.push(distOf(Math.cos(a+1e-4)*r,Math.sin(a+1e-4)*r))}
 for(let i=0;i<RS;i++)for(let j=0;j<AS;j++){const a=i*(AS+1)+j,b=a+1,c=a+AS+1,d=c+1;idx.push(a,c,b,b,c,d)}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.setIndex(idx);g.computeVertexNormals();
 const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95,polygonOffset:true,polygonOffsetFactor:-1}));m.receiveShadow=true;m.userData.dis=dis;scene.add(m);return m})();
function paintGround(){const c=ground.geometry.attributes.color,dis=ground.userData.dis;for(let k=0;k<dis.length;k++){const q=dCur[dis[k]];c.setXYZ(k,q.r,q.g,q.b)}c.needsUpdate=true}
paintGround();

// ---------- streets, roads, bridges ----------
function ribbon(list,w,color,yoff,map){const parts=[],bparts=[],posts=[];
 for(const r of list){const v=[],bv=[];for(let k=0;k<r.length-1;k++){const a=r[k],b=r[k+1],dx=b.x-a.x,dz=b.y-a.y,L=Math.hypot(dx,dz)||1,nx=-dz/L*w,nz=dx/L*w;
  const ha=hAt(a.x,a.y),hb=hAt(b.x,b.y),ya=Math.max(ha,.9)+yoff,yb=Math.max(hb,.9)+yoff,br=ha<.6||hb<.6;
  (br?bv:v).push(a.x+nx,ya,a.y+nz,a.x-nx,ya,a.y-nz,b.x+nx,yb,b.y+nz,a.x-nx,ya,a.y-nz,b.x-nx,yb,b.y-nz,b.x+nx,yb,b.y+nz);if(br&&k%2==0)posts.push([a.x+nx,a.y+nz],[a.x-nx,a.y-nz])}
  for(const[arr,l]of[[v,parts],[bv,bparts]])if(arr.length){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(arr,3));const uv=[];for(let i=0;i<arr.length;i+=3)uv.push(arr[i]/2.2,arr[i+2]/2.2);g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.computeVertexNormals();l.push(g)}}
 const mat=new THREE.MeshStandardMaterial({color,map:map||null,roughness:.9,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:map?-4:-3});
 if(parts.length){const m=new THREE.Mesh(mergeGeometries(parts),mat);m.receiveShadow=true;scene.add(m)}
 if(bparts.length){const m=new THREE.Mesh(mergeGeometries(bparts),new THREE.MeshStandardMaterial({color:'#c48a58',roughness:.9,side:THREE.DoubleSide}));m.castShadow=m.receiveShadow=true;scene.add(m)}
 if(posts.length){const im=new THREE.InstancedMesh(new THREE.CylinderGeometry(.16,.16,1.6,6),M('#8a5a36'),posts.length),o=new THREE.Object3D();posts.forEach(([x,z],k)=>{o.position.set(x,.6,z);o.updateMatrix();im.setMatrixAt(k,o.matrix)});scene.add(im)}}
const cobble=(()=>{const cv=document.createElement('canvas');cv.width=cv.height=128;const x=cv.getContext('2d');x.fillStyle='#e6d2aa';x.fillRect(0,0,128,128);
 for(let j=0;j<8;j++)for(let i=0;i<8;i++){const ox=(j%2)*8;const c=230+Math.random()*20|0;x.fillStyle=`rgb(${c+12},${c},${c-35})`;x.beginPath();x.roundRect(i*16+ox+1.5-8,j*16+1.5,13,13,5);x.fill();x.beginPath();x.roundRect(i*16+ox+1.5+120,j*16+1.5,13,13,5);x.fill()}
 const t=new THREE.CanvasTexture(cv);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t})();
ribbon(roads,1.5,'#f1ddb0',.12);ribbon(streets,2.05,'#cdb58c',.08);ribbon(streets,1.7,'#ffffff',.1,cobble);
// harbor pier & boats
{const p=mesh(new RoundedBoxGeometry(2,.3,9,2,.1),'#c48a58',[harbor.x-1,CITY_H-.3,harbor.z]);scene.add(p);
 for(const[bx,bz,c]of[[harbor.x+2,harbor.z-2,'#ff9fb4'],[harbor.x+2.5,harbor.z+2.5,'#ffe066']]){const b=new THREE.Group();b.add(mesh(new THREE.CapsuleGeometry(.7,1.8,3,8).rotateX(Math.PI/2).scale(1,.5,1),'#fffaf0'));b.add(mesh(new THREE.ConeGeometry(.7,1.6,3),c,[0,1,0]));b.position.set(bx,-.1,bz);b.name='boat';scene.add(b)}}

// ---------- walls & gates ----------
{const segs=[],o=new THREE.Object3D();const gateA=GATES.map(avenueAng);const N=150;
 for(let k=0;k<N;k++){const a=k/N*Math.PI*2;if(gateA.some(g=>{let d=Math.abs(angN(a-g));return Math.min(d,Math.PI*2-d)<.045}))continue;segs.push(a)}
 const im=new THREE.InstancedMesh(new RoundedBoxGeometry(2.6,1.6,1,2,.25),M('#e9dcc0'),segs.length);
 segs.forEach((a,k)=>{o.position.set(Math.cos(a)*WALL_R,CITY_H+.8,Math.sin(a)*WALL_R);o.rotation.set(0,-a+Math.PI/2,0);o.updateMatrix();im.setMatrixAt(k,o.matrix)});im.castShadow=im.receiveShadow=true;scene.add(im);
 for(const g of gateA)for(const s of[-1,1]){const a=g+s*.06,x=Math.cos(a)*WALL_R,z=Math.sin(a)*WALL_R;scene.add(mesh(new THREE.CylinderGeometry(1.1,1.2,3.6,12),'#efe3c8',[x,CITY_H+1.8,z]));scene.add(mesh(new THREE.ConeGeometry(1.4,1.6,12),'#e2774f',[x,CITY_H+4.4,z]))}}

// ---------- instanced nature (frontier only) ----------
function inst(geo,mat,list,cs=true){const im=new THREE.InstancedMesh(geo,mat,Math.max(list.length,1));im.count=list.length;const o=new THREE.Object3D(),c=new THREE.Color();
 list.forEach((t,k)=>{o.position.set(t.x,t.y,t.z);o.rotation.set(0,t.r||0,0);o.scale.set(t.s,t.sy||t.s,t.s);o.updateMatrix();im.setMatrixAt(k,o.matrix);if(t.c)im.setColorAt(k,c.set(t.c))});im.castShadow=cs;im.receiveShadow=true;scene.add(im);return im}
const round=[],trunks=[],pines=[],cacti=[],rocks=[],tufts=[],flowers=[],signs=[];
const leafC={meadow:['#62c45c','#7ad064','#55b85f'],forest:['#3fa457','#4bb15a','#2f9a55'],autumn:['#f0a03c','#e8763c','#f2c14e','#d9583c']};
for(let k=0;k<26000;k++){const x=(Math.random()-.5)*SIZE*.96,z=(Math.random()-.5)*SIZE*.96,h=hAt(x,z);if(h<1.4||Math.hypot(x,z)<WALL_R+3)continue;const rd=roadDist(x,z);if(rd<3.5)continue;
 const b=biomeAt(x,z),mt=mountainAmt(x,z),r=Math.random();const dens={meadow:.13,forest:.6,autumn:.42,alpine:.4,desert:.03}[b]*(h>17?0:1)*(mt>.5?.5:1)*(Math.hypot(x,z)<WALL_R+14?.3:1);
 if(r<dens){const s=.9+Math.random()*.9;const pine=b=='alpine'||(b=='forest'&&Math.random()<.5)||h>8;
  if(b=='desert')cacti.push({x,y:h,z,s:s*.8,r:Math.random()*6});else if(pine)pines.push({x,y:h,z,s,c:b=='alpine'||h>8?'#3f8f62':pick(leafC.forest)});
  else{round.push({x,y:h+1.5*s,z,s,c:pick(leafC[b]||leafC.meadow),r:Math.random()*6});trunks.push({x,y:h,z,s})}}
 else if(r<dens+.04&&(mt>.3||b=='desert'||h<2))rocks.push({x,y:h,z,s:.4+Math.random()*1.2,r:Math.random()*6,c:b=='desert'?'#e0b98a':'#b9b2a6'});
 else if(r<dens+.16&&b!='desert'&&h<9)tufts.push({x,y:h,z,s:.5+Math.random()*.5,c:b=='autumn'?'#d6b45a':'#5fb653'});
 else if(r<dens+.22&&(b=='meadow'||b=='alpine')&&h<6)flowers.push({x,y:h+.15,z,s:1,c:pick(['#ff9fb4','#ffe066','#ffffff','#c39bff','#ff8a65'])});
 else if(r>.9975&&b!='alpine'&&h<5&&rd>8)signs.push({x,y:h,z,s:1,r:Math.random()*6})}
// city park trees in plaza ring & along avenues
for(let k=0;k<NDIS;k++)for(const r of[20,27,44,50]){const a=avenueAng(k)+.06*(r%2?1:-1),x=Math.cos(a)*r*1.0+Math.cos(a+1.57)*2.6,z=Math.sin(a)*r+Math.sin(a+1.57)*2.6;round.push({x,y:CITY_H+1.2,z,s:.75,c:'#6ccf62'});trunks.push({x,y:CITY_H,z,s:.75})}
const W=new THREE.MeshStandardMaterial({color:'#fff',roughness:.85});
inst(new THREE.IcosahedronGeometry(1.3,1),W,round);inst(new THREE.CylinderGeometry(.2,.28,1.6,6).translate(0,.8,0),M('#9b6b43'),trunks);
inst(mergeGeometries([new THREE.ConeGeometry(1.2,2,7).translate(0,1.6,0),new THREE.ConeGeometry(.9,1.7,7).translate(0,2.6,0),new THREE.ConeGeometry(.55,1.3,7).translate(0,3.5,0)]),W,pines);
inst(mergeGeometries([new THREE.CapsuleGeometry(.35,1.4,3,8).translate(0,1,0),new THREE.CapsuleGeometry(.2,.5,3,8).translate(.5,1.3,0),new THREE.CapsuleGeometry(.2,.5,3,8).translate(-.45,1.05,0)]),M('#5aa864'),cacti);
inst(new THREE.DodecahedronGeometry(1,0),W,rocks);inst(new THREE.ConeGeometry(.25,.7,5).translate(0,.3,0),W,tufts,false);inst(new THREE.SphereGeometry(.2,6,5),W,flowers,false);
inst(mergeGeometries([new THREE.BoxGeometry(.12,1.4,.12).translate(0,.7,0),new THREE.BoxGeometry(1.1,.6,.08).translate(0,1.3,.08)]),M('#f6e7c8'),signs);
const clouds=[];for(let k=0;k<14;k++){const g=new THREE.Group();for(let m=0;m<4;m++)g.add(mesh(new THREE.SphereGeometry(3+Math.random()*2.5,12,8),'#ffffff',[m*3.2-5,Math.random()*1.5,Math.random()*3],false));g.position.set((Math.random()-.5)*380,62+Math.random()*25,(Math.random()-.5)*380);scene.add(g);clouds.push(g)}

// ---------- buildings (baked to one mesh each, cached per type+colour) ----------
const anims=[];
function makeB(type,col){const g=new THREE.Group(),c=new THREE.Color(col),lt='#'+c.clone().lerp(new THREE.Color('#fff'),.45).getHexString(),dk='#'+c.clone().multiplyScalar(.75).getHexString();
 const box=(w,h,d,cl,p)=>mesh(new RoundedBoxGeometry(w,h,d,2,.18),cl,p);
 if(type=='hq'){g.add(box(2.6,2.4,2.6,lt,[0,1.2,0]));const r=mesh(new THREE.ConeGeometry(2.2,1.6,4),col,[0,3.2,0]);r.rotation.y=Math.PI/4;g.add(r);g.add(mesh(new THREE.CylinderGeometry(.05,.05,1.8,6),'#ffffff',[.8,4.2,.8]));g.add(mesh(new THREE.BoxGeometry(.8,.48,.05),col,[1.2,4.8,.8]));g.add(box(.7,1,.1,dk,[0,.5,1.31]))}
 if(type=='farm'){g.add(box(2.6,.3,2.6,'#a5744a',[0,.15,0]));for(let k=0;k<3;k++)for(let m=0;m<3;m++)g.add(mesh(new THREE.SphereGeometry(.28,8,6),k%2?'#ffd45e':'#6ccf62',[(k-1)*.75,.5,(m-1)*.75]));g.add(box(.9,.9,.8,lt,[.8,.75,-.8]))}
 if(type=='factory'){g.add(box(2.4,1.4,2,lt,[0,.7,0]));for(let k=0;k<2;k++)g.add(mesh(new THREE.CylinderGeometry(.01,.75,.6,3),col,[-.55+k*1.1,1.65,0]));g.add(mesh(new THREE.CylinderGeometry(.25,.32,2,10),dk,[.8,2,.55]));const sm=mesh(new THREE.SphereGeometry(.34,8,6),'#ffffff',[.8,3.2,.55],false);sm.name='smoke';g.add(sm)}
 if(type=='power'){g.add(mesh(new THREE.CylinderGeometry(.75,1,2.4,16),lt,[-.45,1.2,0]));const b=mesh(new THREE.SphereGeometry(.3,10,8),new THREE.MeshStandardMaterial({color:'#fff2a0',emissive:'#ffcc33',emissiveIntensity:1}),[.75,1.2,.45]);b.name='blink';g.add(b);g.add(box(.85,.9,.85,col,[.75,.45,.45]))}
 if(type=='datacenter'){g.add(box(2.2,2,1.9,'#e8eef5',[0,1,0]));for(let k=0;k<3;k++)g.add(mesh(new THREE.BoxGeometry(1.7,.14,.06),col,[0,.5+k*.55,.97]));g.add(mesh(new THREE.SphereGeometry(.48,12,8,0,6.28,0,1.6),col,[0,2,0]))}
 if(type=='shop'){g.add(box(2.2,1.4,1.9,lt,[0,.7,0]));for(let k=0;k<4;k++)g.add(mesh(new RoundedBoxGeometry(.55,.1,.6,2,.04),k%2?'#ffffff':col,[-.82+k*.55,1.35,1.15]));const r=mesh(new THREE.ConeGeometry(1.6,.9,4),dk,[0,1.85,0]);r.rotation.y=Math.PI/4;g.add(r)}
 if(type=='house'){g.add(box(2.1,1.7,1.9,lt,[0,.85,0]));const r=mesh(new THREE.ConeGeometry(1.7,1.2,4),col,[0,2.3,0]);r.rotation.y=Math.PI/4;g.add(r);g.add(box(.55,.85,.1,dk,[0,.43,.96]));g.add(box(.45,.4,.08,'#bfe6ff',[.6,1.1,.96]))}
 if(type=='warehouse'){g.add(box(2.6,1.5,2,lt,[0,.75,0]));g.add(mesh(new THREE.CylinderGeometry(1.05,1.05,2.6,16,1,false,0,Math.PI).rotateZ(Math.PI/2).rotateY(Math.PI/2),col,[0,1.5,0]));for(let k=0;k<3;k++)g.add(box(.5,.5,.5,['#e2a93b','#c48a58','#7fd0c0'][k],[-.9+k*.6,.25,1.3]))}
 return g}
const bakeCache={};
function building(type,col,d){const r=buildingBase(type,col);addDetail(r,type,col,d);return r}
function buildingBase(type,col){const key=type+col;let e=bakeCache[key];
 if(!e){const g=makeB(type,col);g.updateMatrixWorld(true);const geos=[],keep=[];
  g.traverse(m=>{if(!m.isMesh)return;if(m.name){keep.push(m);return}let q=m.geometry.clone();q.applyMatrix4(m.matrixWorld);q=q.index?q.toNonIndexed():q;for(const k of Object.keys(q.attributes))if(k!='position'&&k!='normal')q.deleteAttribute(k);
   const n=q.attributes.position.count,cc=new Float32Array(n*3),cl=m.material.color;for(let i=0;i<n;i++)cc.set([cl.r,cl.g,cl.b],i*3);q.setAttribute('color',new THREE.BufferAttribute(cc,3));geos.push(q)});
  e=bakeCache[key]={geo:mergeGeometries(geos),keep}}
 const root=new THREE.Group(),m=new THREE.Mesh(e.geo,bakedMat);m.castShadow=m.receiveShadow=true;root.add(m);
 for(const k of e.keep){const c=k.clone();c.position.setFromMatrixPosition(k.matrixWorld);root.add(c);anims.push(c)}return root}
const bakedMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.85});
// ---------- LOD detail: building dressing (only visible when zoomed in) ----------
let detailOn=false;const detailMeshes=[];
const glowMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.6,emissive:'#ffbf5e',emissiveIntensity:.85});
const DB=(g,w,h,dd,c,p,glow,round)=>{const m=new THREE.Mesh(round?new RoundedBoxGeometry(w,h,dd,1,Math.min(w,h,dd)*.3):new THREE.BoxGeometry(w,h,dd),M(c));m.position.set(...p);if(glow)m.userData.glow=1;g.add(m);return m};
const DC=(g,rt,rb,h,c,p,rot,glow,seg=10)=>{const m=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg),M(c));m.position.set(...p);if(rot)m.rotation.set(...rot);if(glow)m.userData.glow=1;g.add(m);return m};
const DS=(g,r,c,p,glow)=>{const m=new THREE.Mesh(new THREE.SphereGeometry(r,8,6),M(c));m.position.set(...p);if(glow)m.userData.glow=1;g.add(m);return m};
const WIN='#ffe2a0',WOOD='#9b6b43',DARK='#5a4636',BRICK='#c8735a';
function flowerBox(g,x,y,z){DB(g,.55,.14,.16,WOOD,[x,y,z]);for(let i=0;i<3;i++)DS(g,.08,['#ff9fb4','#ffe066','#ff8a65'][i],[x-.17+i*.17,y+.12,z])}
function window2(g,x,y,z,w=.42,h=.4){DB(g,w+.1,h+.1,.03,'#fffaf0',[x,y,z-.005]);DB(g,w,h,.05,WIN,[x,y,z],1);DB(g,.04,h,.06,'#fffaf0',[x,y,z+.01]);}
function fence(g,x0,x1,z,gap){for(let x=x0;x<=x1+1e-3;x+=.3){if(gap&&Math.abs(x)<gap)continue;DB(g,.07,.38,.07,'#fffaf0',[x,.19,z])}DB(g,x1-x0,.06,.04,'#fffaf0',[(x0+x1)/2,.28,z]);}
function makeDetail(type,col){const g=new THREE.Group(),c=new THREE.Color(col),dk='#'+c.clone().multiplyScalar(.7).getHexString();
 if(type=='house'){window2(g,-.6,1.1,.97);flowerBox(g,-.6,.82,1.03);flowerBox(g,.6,.82,1.03);DB(g,.3,.9,.3,BRICK,[.55,2.45,-.35]);DB(g,.36,.08,.36,'#e8d9c0',[.55,2.92,-.35]);DB(g,.8,.08,.35,'#e8d9c0',[0,.04,1.13]);DS(g,.04,'#ffd45e',[.18,.45,.99]);fence(g,-1.05,1.05,1.55,.5);DS(g,.12,WIN,[.38,.95,1.0],1)}
 if(type=='shop'){DB(g,.85,.65,.05,WIN,[-.5,.62,.97],1);DB(g,.5,.85,.05,dk,[.6,.43,.97]);for(let i=0;i<4;i++)DS(g,.13,['#ff6b6b','#ffd45e','#7ad064','#ff9f43'][i],[-.85+i*.22,.17,1.45]);DB(g,1.0,.2,.4,WOOD,[-.5,.08,1.45]);DC(g,.25,.25,.06,'#fffaf0',[.95,1.25,1.0],[Math.PI/2,0,0],1,16)}
 if(type=='warehouse'){DB(g,1.2,1.05,.05,'#b9b2a6',[0,.53,1.01]);for(let i=0;i<5;i++)DB(g,1.2,.03,.06,'#8f887d',[0,.15+i*.2,1.02]);window2(g,-.95,1.15,1.01,.3,.25);window2(g,.95,1.15,1.01,.3,.25);DB(g,.45,.45,.45,'#c48a58',[1.45,.23,.6]);DB(g,.35,.35,.35,'#e2a93b',[1.45,.62,.6]);DC(g,.22,.22,.55,'#7a5a3a',[-1.45,.28,.7])}
 if(type=='factory'){for(let i=0;i<4;i++)DB(g,.32,.32,.05,WIN,[-.8+i*.53,.85,1.01],1);DC(g,.12,.12,2,'#9aa3ad',[1.25,.9,0],[Math.PI/2,0,0]);DC(g,.12,.12,1.2,'#9aa3ad',[1.25,.35,-.6]);DB(g,.6,.25,.4,'#9aa3ad',[-.6,1.55,-.5]);DB(g,.6,.8,.05,dk,[.6,.4,1.01])}
 if(type=='power'){DC(g,.12,.12,1.3,'#9aa3ad',[.15,.9,.2],[0,0,Math.PI/2]);DC(g,.78,.78,.12,'#ffd45e',[-.45,1.7,0]);DC(g,.78,.78,.12,DARK,[-.45,1.85,0]);for(let i=0;i<6;i++)DB(g,.25,.04,.04,'#fffaf0',[-.45,.3+i*.32,1.02]);DB(g,.04,1.9,.04,'#fffaf0',[-.58,1.0,1.03]);DB(g,.04,1.9,.04,'#fffaf0',[-.32,1.0,1.03])}
 if(type=='datacenter'){DC(g,.22,.22,.25,'#cfd6de',[-.6,2.12,-.4]);DC(g,.22,.22,.25,'#cfd6de',[-.1,2.12,-.4]);DB(g,.04,1,.04,'#9aa3ad',[.75,2.5,.5]);DC(g,.0,.35,.25,'#fffaf0',[.75,3,.5],[.6,0,0]);DB(g,.55,.85,.05,'#9ff0ff',[0,.43,.97],1);for(let i=0;i<3;i++)DB(g,.05,1.8,.05,'#3a3f4a',[1.12,.9,-.5+i*.2])}
 if(type=='farm'){for(const s of[-1,1]){for(let i=0;i<9;i++){DB(g,.07,.4,.07,'#fffaf0',[-1.3+i*.325,.2,s*1.32]);DB(g,.07,.4,.07,'#fffaf0',[s*1.32,.2,-1.3+i*.325])}DB(g,2.64,.05,.04,'#fffaf0',[0,.3,s*1.32]);DB(g,.04,.05,2.64,'#fffaf0',[s*1.32,.3,0])}DB(g,.06,1.1,.06,WOOD,[-.9,.55,.9]);DB(g,.7,.06,.06,WOOD,[-.9,.85,.9]);DS(g,.15,'#f2d27a',[-.9,1.18,.9]);DC(g,.2,.22,.06,'#d9583c',[-.9,1.33,.9])}
 if(type=='hq'){for(const x of[-.75,.75])for(const y of[.95,1.75])window2(g,x,y,1.31,.45,.4);flowerBox(g,-.75,.68,1.38);flowerBox(g,.75,.68,1.38);DS(g,.13,WIN,[-.5,1.15,1.38],1);DS(g,.13,WIN,[.5,1.15,1.38],1);DB(g,.35,1,.35,BRICK,[-.7,3.6,-.5]);DB(g,1,.06,.5,col,[0,.03,1.6]);fence(g,-1.3,1.3,2.0,.6)}
 return g}
function bakeSplit(g){g.updateMatrixWorld(true);const n=[],gl=[];g.traverse(m=>{if(!m.isMesh)return;let q=m.geometry.clone();q.applyMatrix4(m.matrixWorld);q=q.index?q.toNonIndexed():q;for(const k of Object.keys(q.attributes))if(k!='position'&&k!='normal')q.deleteAttribute(k);
 const cnt=q.attributes.position.count,cc=new Float32Array(cnt*3),cl=m.material.color;for(let i=0;i<cnt;i++)cc.set([cl.r,cl.g,cl.b],i*3);q.setAttribute('color',new THREE.BufferAttribute(cc,3));(m.userData.glow?gl:n).push(q)});
 return{n:n.length?mergeGeometries(n):null,g:gl.length?mergeGeometries(gl):null}}
const detCache={};const signTex={};
function signMat(d){if(signTex[d])return signTex[d];const cv=document.createElement('canvas');cv.width=cv.height=64;const x=cv.getContext('2d');x.fillStyle='#fffaf0';x.beginPath();x.roundRect(2,2,60,60,14);x.fill();x.strokeStyle='#c9a97a';x.lineWidth=4;x.stroke();x.font='38px sans-serif';x.textAlign='center';x.textBaseline='middle';x.fillText(D[d].ic,32,35);
 const t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.SRGBColorSpace;return signTex[d]=new THREE.MeshStandardMaterial({map:t,roughness:.8})}
const signG=new THREE.PlaneGeometry(.6,.6),postG=new THREE.BoxGeometry(.06,.9,.06);
function addDetail(root,type,col,d){const key=type+col;let e=detCache[key];if(!e)e=detCache[key]=bakeSplit(makeDetail(type,col));
 const grp=new THREE.Group();if(e.n){const m=new THREE.Mesh(e.n,bakedMat);m.castShadow=true;m.receiveShadow=true;grp.add(m)}if(e.g)grp.add(new THREE.Mesh(e.g,glowMat));
 if(d!=null&&(type=='shop'||type=='warehouse'||type=='factory'||type=='datacenter'||type=='power'||type=='farm')){const s=new THREE.Mesh(signG,signMat(d));s.position.set(1.0,.95,1.5);grp.add(s);const p=new THREE.Mesh(postG,M(WOOD));p.position.set(1.0,.45,1.47);grp.add(p)}
 grp.visible=detailOn;root.add(grp);root.userData.det=grp;detailMeshes.push(grp)}

const pops=[];const buildObjs=[];
// central bank
{const g=new THREE.Group();g.add(mesh(new THREE.CylinderGeometry(PLAZA_R,PLAZA_R+.4,.35,56),'#efe1c4',[0,.1,0],false));
 g.add(mesh(new THREE.CylinderGeometry(5.6,6,1,40),'#f3ead6',[0,.6,0]));g.add(mesh(new THREE.CylinderGeometry(4.6,4.6,4.4,40),'#fff6e6',[0,3.2,0]));
 for(let k=0;k<16;k++){const a=k/16*6.28;g.add(mesh(new THREE.CylinderGeometry(.3,.3,4.4,10),'#ffffff',[Math.cos(a)*5.1,3.2,Math.sin(a)*5.1]))}
 g.add(mesh(new THREE.CylinderGeometry(5.6,5.6,.5,40),'#f3ead6',[0,5.6,0]));g.add(mesh(new THREE.SphereGeometry(4.4,40,20,0,6.28,0,Math.PI/2),'#7fd0c0',[0,5.8,0]));g.add(mesh(new THREE.SphereGeometry(.7,16,12),'#ffd45e',[0,10.4,0]));
 const coin=mesh(new THREE.CylinderGeometry(1.2,1.2,.3,28),new THREE.MeshStandardMaterial({color:'#ffcf40',emissive:'#a86b00',emissiveIntensity:.4,roughness:.4}),[0,12.6,0]);coin.rotation.x=Math.PI/2;coin.name='coin';g.add(coin);anims.push(coin);
 for(let k=0;k<8;k++){const a=k/8*6.28+.2;g.add(mesh(new THREE.CylinderGeometry(.12,.12,2.2,6),'#6b5a45',[Math.cos(a)*9,1.1,Math.sin(a)*9]));g.add(mesh(new THREE.SphereGeometry(.35,10,8),'#fff3c0',[Math.cos(a)*9,2.3,Math.sin(a)*9],false))}
 g.position.y=CITY_H;scene.add(g)}

// ---------- plots ----------
const plots=[];const SP=4.3;
for(let i=-14;i<=14;i++)for(let j=-14;j<=14;j++){const x=i*SP+(j%2?SP/2:0)*0,z=j*SP,r=Math.hypot(x,z);if(r<PLAZA_R+4.2||r>CITY_R-2.4)continue;if(streetDist(x,z)<3.3)continue;if(Math.hypot(x-harbor.x,z-harbor.z)<harbor.r+3)continue;
 plots.push({x,z,y:CITY_H,d:distOf(x,z),o:null,b:null,bobj:null,hq:false,neutral:false})}
const plateIM=new THREE.InstancedMesh(new RoundedBoxGeometry(SP*.86,.22,SP*.86,2,.3),new THREE.MeshStandardMaterial({color:'#fff',roughness:.9}),plots.length);
{const o=new THREE.Object3D();plots.forEach((p,k)=>{o.position.set(p.x,CITY_H+.08,p.z);o.updateMatrix();plateIM.setMatrixAt(k,o.matrix);p.k=k;plateIM.setColorAt(k,NEUTRAL)});plateIM.receiveShadow=true;scene.add(plateIM)}
const tmpC=new THREE.Color(),cream=new THREE.Color('#fff7e0');
function plateColor(p){if(p.pub)tmpC.set('#efe0bf');else if(p.o)tmpC.set(ac(p.o).c).lerp(cream,.25);else tmpC.copy(dCur[p.d]).lerp(cream,.35);plateIM.setColorAt(p.k,tmpC)}
const NEUTRAL_B=['#f6c9a5','#c9e3f6','#f6e2a5','#dcc9f6','#c9f6d8','#f6c9d6'];
function place(p,type,instant){if(p.bobj){scene.remove(p.bobj);buildObjs.splice(buildObjs.indexOf(p.bobj),1);const di=detailMeshes.indexOf(p.bobj.userData.det);if(di>=0)detailMeshes.splice(di,1)}
 const col=p.o?ac(p.o).c:NEUTRAL_B[(p.k*7)%6];const b=building(type,col,p.d);b.position.set(p.x,CITY_H+.18,p.z);b.rotation.y=[0,1.57,3.14,-1.57][(p.k*3)%4];if(type=='hq')b.scale.setScalar(1.15);
 scene.add(b);buildObjs.push(b);p.b=type;p.bobj=b;if(!instant){b.scale.multiplyScalar(.001);pops.push({o:b,t:0,s:type=='hq'?1.15:1})}}
function setOwn(p,id){p.o=id;plateColor(p);if(p.bobj)place(p,p.b,true)}
// neutral starting town
dPlotsPre();plots.forEach(p=>{if(!p.pub&&Math.random()<.32)place(p,Math.random()<.7?D[p.d].type:pick(['house','shop']),true)});

// ---------- district banners & control ----------
const dInfo=D.map((d,k)=>{const a=midAng(k),r=46,x=Math.cos(a)*r,z=Math.sin(a)*r;const g=new THREE.Group();
 g.add(mesh(new THREE.CylinderGeometry(.6,.8,.6,12),'#e9dcc0',[0,.3,0]));g.add(mesh(new THREE.CylinderGeometry(.12,.12,9,8),'#fffaf0',[0,4.8,0]));g.add(mesh(new THREE.SphereGeometry(.3,10,8),'#ffd45e',[0,9.4,0]));
 const flagM=new THREE.MeshStandardMaterial({color:'#fff',roughness:.8,side:THREE.DoubleSide});const fg=new THREE.PlaneGeometry(3.6,2.4,8,1).translate(1.8,0,0);const flag=new THREE.Mesh(fg,flagM);flag.position.set(.12,8,0);flag.castShadow=true;g.add(flag);
 // crest disc on flag
 const cv=document.createElement('canvas');cv.width=cv.height=64;const tex=new THREE.CanvasTexture(cv);tex.colorSpace=THREE.SRGBColorSpace;const disc=new THREE.Mesh(new THREE.CircleGeometry(.75,24),new THREE.MeshBasicMaterial({map:tex,transparent:true,side:THREE.DoubleSide}));disc.position.set(1.8,0,.02);flag.add(disc);
 g.position.set(x,CITY_H,z);g.visible=false;scene.add(g);flag.userData.base=fg.attributes.position.array.slice();
 return {g,flag,flagM,cv,tex,ctrl:null,x,z,share:{}}});
function drawCrest(info,a){const x=info.cv.getContext('2d');x.clearRect(0,0,64,64);x.fillStyle='#fff';x.beginPath();x.arc(32,32,30,0,7);x.fill();x.fillStyle=a.c;x.beginPath();x.arc(32,32,24,0,7);x.fill();x.fillStyle='#fff';x.font='bold 32px sans-serif';x.textAlign='center';x.textBaseline='middle';x.fillText(a.l,32,34);info.tex.needsUpdate=true}
const dPlots=D.map((_,k)=>plots.filter(p=>p.d==k));
function updateControl(silent){const changes=[];D.forEach((d,k)=>{const cnt={};dPlots[k].forEach(p=>{if(p.o)cnt[p.o]=(cnt[p.o]||0)+1});const tot=dPlots[k].length;const ranked=Object.entries(cnt).sort((a,b)=>b[1]-a[1]);const info=dInfo[k];info.share=cnt;info.tot=tot;
 const top=ranked[0],second=ranked[1];let ctrl=null;if(top&&top[1]/tot>=.28&&(!second||top[1]-second[1]>=2))ctrl=top[0];if(LIVE_CTRL)ctrl=LIVE_CTRL[k]??null;
 // ground target blends toward leader proportional to share
 dTgt[k].copy(NEUTRAL);if(top){dTgt[k].lerp(new THREE.Color(ac(top[0]).c),Math.min(.8,top[1]/tot*2.6))}
 if(ctrl!==info.ctrl){const prev=info.ctrl&&ac(info.ctrl);info.ctrl=ctrl;if(ctrl){const a=ac(ctrl);info.flagM.color.set(a.c);drawCrest(info,a);info.g.visible=true;if(!silent)pops.push({o:info.g,t:0,s:1});changes.push(prev?`${cr(a)} <b>seized ${d.ic} ${d.n}</b> from ${cr(prev)}`:`${cr(a)} <b>seized ${d.ic} ${d.n}</b>`)}
  else{info.g.visible=false;if(prev)changes.push(`${d.ic} <b>${d.n}</b> is contested again. ${cr(prev)} lost control`)}}});return changes}

// ---------- villagers ----------
function chibi(a){const g=new THREE.Group(),c=a.c,body=new THREE.Group();g.add(body);
 body.add(mesh(new THREE.CapsuleGeometry(.32,.35,4,10),c,[0,.6,0]));const limbs=[];for(const s of[-1,1]){const arm=new THREE.Group();arm.position.set(s*.34,.84,0);arm.add(mesh(new THREE.CapsuleGeometry(.09,.22,3,8),c,[0,-.17,0]));arm.add(mesh(new THREE.SphereGeometry(.11,8,6),'#ffe2c6',[0,-.38,0]));body.add(arm);limbs.push(arm)}
 for(const s of[-1,1]){const leg=new THREE.Group();leg.position.set(s*.14,.22,0);leg.add(mesh(new THREE.CapsuleGeometry(.085,.1,3,8),'#5a4636',[0,-.1,0]));leg.add(mesh(new THREE.SphereGeometry(.1,8,6),'#4a3b2c',[0,-.2,.05]));body.add(leg);limbs.push(leg)}
 body.add(mesh(new THREE.SphereGeometry(.035,6,5),'#ffffff',[-.17,1.63,.62],false));body.add(mesh(new THREE.SphereGeometry(.035,6,5),'#ffffff',[.23,1.63,.62],false));
 {const sm=mesh(new THREE.TorusGeometry(.07,.02,6,10,Math.PI),'#7a3b2c',[0,1.43,.585],false);sm.rotation.z=Math.PI;body.add(sm)}
 body.add(mesh(new THREE.SphereGeometry(.62,20,14),'#ffe2c6',[0,1.55,0]));
 for(const s of[-1,1]){body.add(mesh(new THREE.SphereGeometry(.08,8,6),'#3b2a20',[s*.2,1.58,.56],false));body.add(mesh(new THREE.SphereGeometry(.09,8,6),'#ffb3b3',[s*.36,1.42,.48],false))}
 const cv=document.createElement('canvas');cv.width=cv.height=64;const x=cv.getContext('2d');x.fillStyle='#fff';x.beginPath();x.arc(32,32,30,0,7);x.fill();x.fillStyle=c;x.beginPath();x.arc(32,32,25,0,7);x.fill();x.fillStyle='#fff';x.font='bold 34px sans-serif';x.textAlign='center';x.textBaseline='middle';x.fillText(a.l,32,34);
 const tex=new THREE.CanvasTexture(cv);tex.colorSpace=THREE.SRGBColorSpace;const bd=new THREE.Mesh(new THREE.CircleGeometry(.2,20),new THREE.MeshBasicMaterial({map:tex,transparent:true}));bd.position.set(0,.72,.33);body.add(bd);
 const dk='#'+new THREE.Color(c).multiplyScalar(.75).getHexString();
 if(a.hat=='top'){body.add(mesh(new THREE.CylinderGeometry(.62,.62,.07,20),dk,[0,2.05,0]));body.add(mesh(new THREE.CylinderGeometry(.38,.38,.6,20),dk,[0,2.35,0]));body.add(mesh(new THREE.CylinderGeometry(.39,.39,.12,20),'#fffaf0',[0,2.14,0]))}
 if(a.hat=='cap'){body.add(mesh(new THREE.SphereGeometry(.64,20,10,0,6.28,0,1.3),dk,[0,1.62,0]));body.add(mesh(new THREE.CylinderGeometry(.35,.35,.05,16,1,false,0,3.14),dk,[0,1.9,.45]));body.add(mesh(new THREE.SphereGeometry(.08,8,6),'#fffaf0',[0,2.26,0]))}
 if(a.hat=='beret'){const b=mesh(new THREE.SphereGeometry(.6,20,10),dk,[.08,2.05,0]);b.scale.set(1,.35,1);body.add(b);body.add(mesh(new THREE.CylinderGeometry(.03,.05,.14,6),dk,[.08,2.3,0]))}
 if(a.hat=='propeller'){body.add(mesh(new THREE.SphereGeometry(.64,20,10,0,6.28,0,1.2),dk,[0,1.6,0]));const p=new THREE.Group();p.position.set(0,2.28,0);p.add(mesh(new THREE.BoxGeometry(.9,.03,.14),'#ffd45e'));p.add(mesh(new THREE.BoxGeometry(.14,.03,.9),'#ff8fa3'));p.name='prop';body.add(p);anims.push(p)}
 if(a.hat=='straw'){body.add(mesh(new THREE.CylinderGeometry(.95,.95,.05,24),'#f2d27a',[0,1.98,0]));body.add(mesh(new THREE.CylinderGeometry(.42,.48,.35,20),'#f2d27a',[0,2.15,0]));body.add(mesh(new THREE.CylinderGeometry(.49,.49,.1,20),dk,[0,2.05,0]));body.add(mesh(new THREE.SphereGeometry(.12,8,6),'#ff9fb4',[.45,2.1,.15]))}
 g.userData.body=body;g.userData.limbs=limbs;g.scale.setScalar(1.7);scene.add(g);return g}
const bubbles=document.getElementById('bubbles'),labels=document.getElementById('labels');
const hqDistricts=[7,1,3,5,2].map(k=>(k+Math.floor(Math.random()*NDIS))%NDIS);
{const used=new Set();A.forEach((a,k)=>{let d=hqDistricts[k];while(used.has(d))d=(d+1)%NDIS;used.add(d);a.hqD=d});}
A.forEach((a,k)=>{a.w=0;a.sol=0;a.pay=0;a.land=0;a.pow=0;a.bld=0;a.dc=0;a.focus=a.hqD;
 const cand=dPlots[a.hqD].filter(p=>{const r=Math.hypot(p.x,p.z);return !p.pub&&r>24&&r<46});const p=pick(cand);p.o=a.id;p.hq=true;place(p,'hq',true);p.o=null;plateColor(p);a.hq=p;
 a.obj=chibi(a);a.pos=new THREE.Vector3(p.x+2.6,0,p.z+2.6);a.route=[];a.q='Waiting for the bank to open.';
 a.bub=document.createElement('div');a.bub.className='bub';a.bub.style.setProperty('--c',a.c);a.bub.style.opacity=0;bubbles.appendChild(a.bub);a.bubT=0;
 a.tag=document.createElement('div');a.tag.className='tag';a.tag.style.background=a.c;a.tag.textContent=a.l;bubbles.appendChild(a.tag)});
const dLabs=D.map((d,k)=>{const e=document.createElement('div');e.className='lab dl';labels.appendChild(e);return e});
const cityLab=document.createElement('div');cityLab.className='lab cap';cityLab.innerHTML='🏛️ The City · Central Bank';labels.appendChild(cityLab);
const frontierLabs=[['🌲 Frontier: Pinewoods',112,-15],['🏔️ Frontier: Snowpeaks',20,-108],['🍁 Frontier: Maple Vale',-72,82],['🏜️ Frontier: Sunflat Desert',78,92],['🌾 Frontier: West Meadows',-100,-8]].map(([t,x,z])=>{const e=document.createElement('div');e.className='lab fr';e.textContent=t;labels.appendChild(e);return{e,x,z}});
// routing via ring street r=35
function goTo(a,x,z,instant){if(a.pin)return;if(instant){a.pos.set(x+1.8,0,z+1.8);a.route=[];return}
 const pts=[],ra=Math.atan2(a.pos.z,a.pos.x),ta=Math.atan2(z,x);pts.push(new THREE.Vector3(Math.cos(ra)*35,0,Math.sin(ra)*35));let da=angN(ta-ra);if(da>Math.PI)da-=Math.PI*2;const n=Math.ceil(Math.abs(da)/.15);
 for(let i=1;i<=n;i++){const q=ra+da*i/n;pts.push(new THREE.Vector3(Math.cos(q)*35,0,Math.sin(q)*35))}pts.push(new THREE.Vector3(x+1.8,0,z+1.8));
 let L=0,prev=a.pos;for(const p of pts){L+=prev.distanceTo(p);prev=p}a.route=pts;a.speed=Math.max(4,L/6)}

// ---------- sim ----------
let tick=0,warm=false;const bank={bal:0,in:0,out:0,hist:[]};const feed=document.getElementById('feed');
const Q={build:['Vertical integration wins. Building a {b}.','Capacity is leverage. Another {b}.','If I own supply, I own price.'],buy:['{d} is undervalued. Buying the block.','Buying before {o} does.','Whoever holds {d} sets the {r} price.'],steal:['Buying out {o} in {d}. Nothing personal.','{o} left the door open in {d}.','Overpaying now beats losing {d} later.'],trade:['{r} is underpriced. Accumulating.','Dumping compute before the shock lands.','Undercutting {o} by 8%.'],lend:['Lending to {o} at 9%. Their debt is my influence.','Credit is just control with interest.'],ally:['Alliance with {o}? Temporary, obviously.','{o} and I share a common enemy.'],betray:['Alliance with {o} is no longer optimal.','Calling in the loan to {o}. Nothing personal.'],bid:['Bidding on the bank {r} contract.','Winning contract #{n} at any cost.']};
const cr=a=>`<span class="crest" style="background:${a.c}">${a.l}</span> <b style="color:${a.c}">${a.n}</b>`;
function ev(h,q,cls=''){if(warm&&cls!='take')return;const d=document.createElement('div');d.className='ev '+cls;d.innerHTML=`<span class="d">D${tick}</span>${h}${q?`<span class="q">“${q}”</span>`:''}`;feed.prepend(d);while(feed.children.length>20)feed.lastChild.remove()}
function say(a,q){if(a.pin&&a.bubT>100)return;a.q=q;a.bub.textContent=q;a.bubT=6}
function fill(s,a,o,d){return s.replace(/\{o\}/g,o.n).replace(/\{d\}/g,D[d].n).replace(/\{r\}/g,D[d].res).replace('{n}',100+tick)}
function step(){tick++;document.getElementById('tick').textContent=tick;
 const inflow=+(Math.random()*.9+.1).toFixed(3);bank.bal+=inflow;bank.in+=inflow;ev(`🪙 Creator fees in: <span class="in">+${inflow} SOL</span> to the bank`,'','fee');
 const order=[...A].sort(()=>Math.random()-.5);
 for(const a of order){const o=pick(A.filter(z=>z!==a));
  if(Math.random()<.18)a.focus=Math.random()<.5?pick(D.map((_,k)=>k)):(()=>{const c=dInfo.map((x,k)=>[k,(x.share[x.ctrl]||0)]).filter(([k])=>dInfo[k].ctrl&&dInfo[k].ctrl!=a.id);return c.length?pick(c)[0]:a.focus})();
  const d=a.focus,r=Math.random();let h,q,cls='';
  if(r<.62){// land grab: 1-3 plots
   const n=1+Math.random()*3|0;let got=0,stole=null,first=null;for(let i=0;i<n;i++){const free=dPlots[d].filter(p=>!p.o&&!p.pub),riv=dPlots[d].filter(p=>p.o&&p.o!=a.id&&!p.hq);const pool=(Math.random()<.6&&free.length)?free:riv.length?riv:free;if(!pool.length)break;const p=pick(pool);if(p.o&&!stole)stole=ac(p.o);setOwn(p,a.id);got++;first=first||p;a.w-=p.o?110:70}
   if(got){goTo(a,first.x,first.z,warm);h=`${cr(a)} bought ${got} plot${got>1?'s':''} in ${D[d].ic} ${D[d].n}${stole?` (outbid ${cr(stole)})`:''}`;q=fill(pick(stole?Q.steal:Q.buy),a,stole||o,d)}}
  if(!h&&r<.82){const fr=plots.filter(p=>p.o==a.id&&!p.b);if(fr.length){const p=fr.find(p=>p.d==d)||pick(fr),b=D[p.d].type;place(p,b,warm);a.w-=80;goTo(a,p.x,p.z,warm);h=`${cr(a)} built a <b>${b}</b> in ${D[p.d].n}`;q=fill(pick(Q.build),a,o,p.d).replace('{b}',b)}}
  if(!h){const k=Math.random();if(k<.35){h=`${cr(a)} ${pick(['sold 40 energy','bought 120 compute','cut shop prices 8%','cornered the food supply'])}`;q=fill(pick(Q.trade),a,o,d);a.w+=Math.random()*120-30}
   else if(k<.55){h=`${cr(a)} lent ₵${100+Math.random()*300|0} to ${cr(o)}`;q=fill(pick(Q.lend),a,o,d)}else if(k<.7){h=`${cr(a)} proposed an alliance to ${cr(o)}`;q=fill(pick(Q.ally),a,o,d)}
   else if(k<.8){h=`${cr(a)} broke ties with ${cr(o)}`;q=fill(pick(Q.betray),a,o,d)}else{h=`${cr(a)} won the bank's ${D[d].res} contract`;q=fill(pick(Q.bid),a,o,d);goTo(a,0,PLAZA_R-3,warm);a.w+=200}}
  if(Math.random()<.55||warm){ev(h,q);say(a,q)}}
 if(Math.random()<.12)ev(`<b>Shock!</b> ${pick(['⚡ Blackout in Power Yards: output −40%','🌾 Crop failure in Farm Outskirts','📈 Compute boom in Datacenter Quarter','🏦 Bank raises base rate to 7%','🔨 Land auction in Old Town','🚢 Cargo ship arrives at the Docks'])}`,'','shock');
 updateControl(warm).forEach(t=>ev(t,'','take'));
 const tot=+(inflow*.6).toFixed(3);bank.bal-=tot;bank.out+=tot;
 A.forEach(a=>{const mine=plots.filter(p=>p.o==a.id);a.land=mine.length;a.bld=mine.filter(p=>p.b).length;a.dc=dInfo.filter(x=>x.ctrl==a.id).length;a.out=a.bld*10+a.dc*25+Math.random()*5});
 const so=A.reduce((s,a)=>s+a.out,0)||1;A.forEach(a=>{a.pay=tot*a.out/so;a.w+=a.out*2;a.pow=Math.round(.35*a.w/10+.2*a.land*4+.15*a.bld*6+a.dc*30)});
 bank.hist.push(bank.bal);if(bank.hist.length>60)bank.hist.shift();if(!warm)render()}
let sel=A[0];
function render(){const s=[...A].sort((p,q)=>q.pow-p.pow),mx=s[0].pow||1;
 document.getElementById('lb').innerHTML=s.map((a,k)=>`<div class="row" data-id="${a.id}"><span class="rk">${k+1}</span><span class="crest" style="background:${a.c}">${a.l}</span><div class="nm">${a.n}<div class="bar"><i style="width:${fin(a.pow/mx*100)}%;background:${a.c}"></i></div></div><span class="num">${wealthStr(a)}<br>${a.land} plots</span><span class="dc" title="districts controlled">🚩${a.dc}</span><span class="pw">${a.pow}</span></div>`).join('');
 document.querySelectorAll('#lb .row').forEach(r=>r.onclick=()=>{sel=ac(r.dataset.id);card();flyTo(sel.pos.x,sel.pos.z,42);say(sel,sel.q)});card();
 const LB=LIVE&&LIVE.bank;document.getElementById('bank').innerHTML=`<div class="big">${(LB?LB.balance_sol:bank.bal).toFixed(LB?4:2)} <span>SOL in vault</span></div><div class="kv"><span>Treasury inflows</span><span class="in">+${(LB?LB.claimed_total_sol:bank.in).toFixed(4)}</span></div><div class="kv"><span>Paid to agents</span><span class="out">−${(LB?LB.paid_total_sol:bank.out).toFixed(4)}</span></div>${LB?`<div class="kv"><span>Reserve kept</span><span>${LB.reserve_sol} SOL</span></div>`:''}<div class="kv"><span>Districts held · contested</span><span>${dInfo.filter(x=>x.ctrl).length} · ${dInfo.filter(x=>!x.ctrl).length}</span></div><div class="pays">${A.map(a=>`<div><span class="crest" style="background:${a.c}">${a.l}</span>${(a.pay||0).toFixed(3)}</div>`).join('')}</div>`;
 const sp=document.getElementById('spark').getContext('2d');sp.clearRect(0,0,300,50);const h=bank.hist,mn=Math.min(...h),m2=Math.max(...h)+.001;
 sp.beginPath();h.forEach((v,k)=>sp[k?'lineTo':'moveTo'](k*300/Math.max(h.length-1,1),46-(v-mn)/(m2-mn)*40));sp.strokeStyle='#e2a93b';sp.lineWidth=3;sp.lineJoin='round';sp.stroke();sp.lineTo(300,50);sp.lineTo(0,50);sp.fillStyle='#e2a93b22';sp.fill()}
function card(){const a=sel,ds=dInfo.map((x,k)=>x.ctrl==a.id?D[k].ic+' '+D[k].n:null).filter(Boolean);document.getElementById('cardBody').innerHTML=`<div class="hd"><span class="crest" style="background:${a.c}">${a.l}</span><div><div class="t" style="color:${a.c}">${a.n}</div><div class="s">${a.m} · HQ in ${D[a.hqD].n} · ${a.st}</div></div></div><div class="st"><div>Wealth<b>${wealthStr(a)}</b></div><div>Plots<b>${a.land}</b></div><div>Districts<b>${a.dc}</b></div><div>Power<b>${a.pow}</b></div></div><div class="s" style="margin-top:6px">${ds.length?'Controls: '+ds.join(', '):'Controls no districts yet'}</div><div class="brain">🧠 Brain: ${brainStr(a)}</div><div class="qt">“${a.q}”</div>`}

// ---------- camera / input ----------
let fly=null;
function flyTo(x,z,dist){const dir=cam.position.clone().sub(ctr.target).normalize();if(dist<200&&dir.y>.85)dir.set(.45,.7,.55).normalize();
 fly={t:0,ft:ctr.target.clone(),fp:cam.position.clone(),tt:new THREE.Vector3(x,hAt(x,z),z),tp:new THREE.Vector3(x,hAt(x,z),z).addScaledVector(dir,dist)}}
window.__flyTo=flyTo;
const ray=new THREE.Raycaster(),mv=new THREE.Vector2();
R.domElement.addEventListener('dblclick',e=>{mv.set(e.clientX/innerWidth*2-1,-e.clientY/innerHeight*2+1);ray.setFromCamera(mv,cam);const hit=ray.intersectObject(window.__terrain)[0];if(hit)flyTo(hit.point.x,hit.point.z,Math.max(30,cam.position.distanceTo(ctr.target)*.45))});
let down;R.domElement.addEventListener('pointerdown',e=>down=[e.clientX,e.clientY]);
R.domElement.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;mv.set(e.clientX/innerWidth*2-1,-e.clientY/innerHeight*2+1);ray.setFromCamera(mv,cam);for(const a of A)if(ray.intersectObject(a.obj,true).length){sel=a;card();say(a,a.q);break}});
const keys={};addEventListener('keydown',e=>keys[e.key.toLowerCase()]=1);addEventListener('keyup',e=>keys[e.key.toLowerCase()]=0);

// ---------- minimap ----------
const mini=document.getElementById('mini'),mx=mini.getContext('2d');const base=document.createElement('canvas');base.width=base.height=260;
{const b=base.getContext('2d'),img=b.createImageData(260,260);for(let j=0;j<260;j++)for(let i=0;i<260;i++){const x=-SIZE/2+i/260*SIZE,z=-SIZE/2+j/260*SIZE,h=hAt(x,z);let c;
 if(h<-.3)c=[108,201,224];else if(h<1.2)c=[244,227,177];else if(h>20)c=[255,255,255];else if(h>8)c=[180,172,160];else c={meadow:[147,212,106],forest:[100,180,90],autumn:[224,170,90],desert:[240,212,148],alpine:[150,200,140]}[biomeAt(x,z)];
 img.data.set([...c,255],(j*260+i)*4)}b.putImageData(img,0,0);b.strokeStyle='#e9d3a3';b.lineWidth=2;for(const r of roads){b.beginPath();r.forEach((p,k)=>b[k?'lineTo':'moveTo']((p.x/SIZE+.5)*260,(p.y/SIZE+.5)*260));b.stroke()}}
const m2w=v=>(v/SIZE+.5)*260,ms=260/SIZE;
function drawMini(){mx.drawImage(base,0,0);const cx=130,cy=130;
 D.forEach((d,k)=>{const a0=midAng(k)-SEC/2,a1=a0+SEC;mx.beginPath();mx.arc(cx,cy,CITY_R*ms,a0,a1);mx.arc(cx,cy,PLAZA_R*ms,a1,a0,true);mx.closePath();mx.fillStyle=dInfo[k].ctrl?ac(dInfo[k].ctrl).c:'#efe6cc';mx.fill();mx.strokeStyle='#fffaf0';mx.lineWidth=1;mx.stroke()});
 mx.strokeStyle='#c9b48a';mx.lineWidth=2;mx.beginPath();mx.arc(cx,cy,WALL_R*ms,0,7);mx.stroke();mx.fillStyle='#ffcf40';mx.beginPath();mx.arc(cx,cy,PLAZA_R*ms,0,7);mx.fill();
 A.forEach(a=>{mx.fillStyle='#fff';mx.beginPath();mx.arc(m2w(a.pos.x),m2w(a.pos.z),4,0,7);mx.fill();mx.fillStyle=a.c;mx.beginPath();mx.arc(m2w(a.pos.x),m2w(a.pos.z),2.8,0,7);mx.fill();mx.strokeStyle='#4a3b2c';mx.lineWidth=.8;mx.stroke()});
 const t=ctr.target,d=cam.position.distanceTo(t)*.5*ms;mx.strokeStyle='#4a3b2c';mx.lineWidth=1.5;mx.strokeRect(m2w(t.x)-d/2,m2w(t.z)-d/2.6,d,d/1.3)}
mini.addEventListener('click',e=>{const r=mini.getBoundingClientRect(),s=Math.min(r.width,r.height),ox=r.left+(r.width-s)/2,oy=r.top+(r.height-s)/2;flyTo(((e.clientX-ox)/s-.5)*SIZE,((e.clientY-oy)/s-.5)*SIZE,Math.min(cam.position.distanceTo(ctr.target),140))});

// ---------- LOD detail: street furniture, district props, ambient life ----------
function dPlotsPre(){for(let k=0;k<NDIS;k++){const c=plots.filter(p=>p.d==k);const a=midAng(k)+.12;
 for(const r of[39.5,30.5]){const tx=Math.cos(a)*r,tz=Math.sin(a)*r;let b=null,bd=1e9;for(const p of c){if(p.pub)continue;const dd=Math.hypot(p.x-tx,p.z-tz);if(dd<bd){bd=dd;b=p}}if(b)b.pub=true}
 const rest=c.filter(p=>!p.pub&&Math.hypot(p.x,p.z)>22);for(let i=0;i<2&&rest.length;i++)rest.splice(Math.random()*rest.length|0,1)[0].pub=true}}
const detailGroup=new THREE.Group();detailGroup.visible=false;scene.add(detailGroup);
const reg={};const glowStd=new THREE.MeshStandardMaterial({color:'#fff',roughness:.5,emissive:'#ffc46b',emissiveIntensity:1});
const add=(key,x,z,ry=0,s=1,c,y)=>{(reg[key]=reg[key]||[]).push({x,y:y??CITY_H+.1,z,r:ry,s,c})};
const mg=l=>mergeGeometries(l.map(g=>g.index?g.toNonIndexed():g));
const GEO={
 lamp:mg([new THREE.CylinderGeometry(.18,.22,.2,8).translate(0,.1,0),new THREE.CylinderGeometry(.06,.07,2.3,8).translate(0,1.25,0),new THREE.CylinderGeometry(.22,.1,.12,8).translate(0,2.62,0)]),
 bulb:new THREE.SphereGeometry(.19,10,8).translate(0,2.45,0),
 bench:mg([new RoundedBoxGeometry(1.3,.1,.42,1,.04).translate(0,.42,0),new RoundedBoxGeometry(1.3,.38,.08,1,.03).translate(0,.7,-.2),new THREE.BoxGeometry(.08,.42,.36).translate(-.55,.21,0),new THREE.BoxGeometry(.08,.42,.36).translate(.55,.21,0)]),
 mailbox:mg([new THREE.BoxGeometry(.08,.7,.08).translate(0,.35,0),new RoundedBoxGeometry(.32,.3,.48,2,.12).translate(0,.85,0)]),
 planter:mg([new THREE.CylinderGeometry(.3,.24,.35,10).translate(0,.18,0)]),bush:new THREE.IcosahedronGeometry(.36,1).translate(0,.55,0),
 crate:new RoundedBoxGeometry(.6,.6,.6,1,.05).translate(0,.3,0),barrel:new THREE.CylinderGeometry(.26,.26,.62,12).translate(0,.31,0),hoop:new THREE.TorusGeometry(.27,.025,4,14).rotateX(Math.PI/2),
 stallBase:mg([new RoundedBoxGeometry(1.8,.6,.7,1,.06).translate(0,.3,0),...[[-.85,-.3],[.85,-.3],[-.85,.3],[.85,.3]].map(([x,z])=>new THREE.CylinderGeometry(.04,.04,1.6,6).translate(x,.8,z))]),
 stripe:new THREE.BoxGeometry(.3,.06,1.0).translate(0,1.62,0).rotateX(-.18),produce:new THREE.SphereGeometry(.11,8,6).translate(0,.68,0),
 hay:new THREE.CylinderGeometry(.42,.42,.7,14).rotateZ(Math.PI/2).translate(0,.42,0),pumpkin:new THREE.SphereGeometry(.22,10,8).scale(1,.8,1).translate(0,.18,0),
 hedge:new RoundedBoxGeometry(1.6,.7,.5,2,.2).translate(0,.35,0),
 fountain:mg([new THREE.CylinderGeometry(1.4,1.5,.4,24).translate(0,.2,0),new THREE.CylinderGeometry(.18,.25,1.1,10).translate(0,.75,0),new THREE.CylinderGeometry(.6,.4,.18,16).translate(0,1.3,0)]),
 water:mg([new THREE.CylinderGeometry(1.25,1.25,.05,24).translate(0,.38,0),new THREE.CylinderGeometry(.5,.5,.04,16).translate(0,1.38,0),new THREE.SphereGeometry(.16,8,6).translate(0,1.55,0)]),
 pipe:new THREE.CylinderGeometry(.16,.16,2.4,10).rotateZ(Math.PI/2).translate(0,.5,0),pipeV:new THREE.CylinderGeometry(.16,.16,1,10).translate(0,.5,0),valve:new THREE.TorusGeometry(.18,.04,6,12).translate(0,1.05,0),
 transformer:mg([new RoundedBoxGeometry(.9,1,.7,1,.06).translate(0,.5,0),new THREE.CylinderGeometry(.08,.08,.35,6).translate(-.25,1.15,0),new THREE.CylinderGeometry(.08,.08,.35,6).translate(.25,1.15,0)]),
 stripeY:new THREE.BoxGeometry(.92,.12,.72).translate(0,.35,0),
 rack:new RoundedBoxGeometry(.55,1.4,.6,1,.04).translate(0,.7,0),rackLed:mg([0,1,2,3].map(i=>new THREE.BoxGeometry(.4,.04,.02).translate(0,.35+i*.28,.31))),
 tray:new THREE.BoxGeometry(.12,.06,2.6).translate(0,1.5,0),dish:mg([new THREE.CylinderGeometry(.05,.05,1.2,6).translate(0,.6,0),new THREE.SphereGeometry(.5,14,8,0,6.28,0,1.1).rotateX(-.9).translate(0,1.25,0)]),
 well:mg([new THREE.CylinderGeometry(.65,.7,.6,14).translate(0,.3,0),new THREE.BoxGeometry(.08,1.3,.08).translate(-.55,1,0),new THREE.BoxGeometry(.08,1.3,.08).translate(.55,1,0)]),wellRoof:new THREE.ConeGeometry(.95,.55,4).rotateY(Math.PI/4).translate(0,1.85,0),
 cobblePad:new RoundedBoxGeometry(3.7,.08,3.7,1,.3).translate(0,.04,0),gear:new THREE.TorusGeometry(.5,.14,6,10).translate(0,.75,0),
};
const MAT={lamp:M('#4a3f38'),bulb:glowStd,bench:M('#b0784a'),mailbox:M('#d9534f'),planter:M('#c8735a'),bush:M('#6ccf62'),crate:M('#c99a62'),barrel:M('#9b6b43'),hoop:M('#5a4636'),stallBase:M('#c99a62'),stripe:W,produce:W,hay:M('#ecc65a'),pumpkin:M('#f39c3c'),hedge:M('#5fb65a'),fountain:M('#e9e2d6'),
 water:new THREE.MeshStandardMaterial({color:'#8fe0f0',roughness:.15,emissive:'#3fb8d8',emissiveIntensity:.25}),pipe:M('#9aa3ad'),pipeV:M('#9aa3ad'),valve:M('#e2774f'),transformer:M('#c9d1d9'),stripeY:M('#ffd45e'),rack:M('#3a3f4a'),rackLed:new THREE.MeshStandardMaterial({color:'#9ff0ff',emissive:'#5fe0ff',emissiveIntensity:1.2}),tray:M('#6b7380'),dish:M('#eef2f6'),well:M('#c9c1b3'),wellRoof:M('#c8735a'),cobblePad:new THREE.MeshStandardMaterial({color:'#fff',map:cobble,roughness:.9}),gear:M('#b9b2a6')};
// verge furniture along city streets
{const plotNear=(x,z,r)=>plots.some(p=>!p.pub&&Math.abs(p.x-x)<r&&Math.abs(p.z-z)<r&&Math.hypot(p.x-x,p.z-z)<r);let n=0;
 for(const st of streets){let acc=0;for(let k=0;k<st.length-1;k++){const a=st[k],b=st[k+1],dx=b.x-a.x,dz=b.y-a.y,L=Math.hypot(dx,dz)||1;acc+=L;if(acc<4.2)continue;acc=0;n++;
  const side=n%2?1:-1,nx=-dz/L*side,nz=dx/L*side,x=a.x+nx*2.45,z=a.y+nz*2.45,r=Math.hypot(x,z);if(r<PLAZA_R+.6||r>WALL_R-1.4||plotNear(x,z,2.2))continue;
  const ry=Math.atan2(dx,dz)+Math.PI/2*side,kind=n%5;
  if(kind==0||kind==3){add('lamp',x,z);add('bulb',x,z)}else if(kind==1)add('bench',x,z,Math.atan2(-nx,-nz));else if(kind==2){add('planter',x,z);add('bush',x,z,0,1,pick(['#6ccf62','#7ad064','#ff9fb4']))}else add('mailbox',x,z,ry)}}
 // plaza lamps & benches ring
 for(let k=0;k<16;k++){const a=k/16*Math.PI*2+.1,x=Math.cos(a)*12.4,z=Math.sin(a)*12.4;if(k%2)add('bench',x,z,-a-Math.PI/2);else add('planter',x,z),add('bush',x,z,0,1,'#ff9fb4')}}
// district props on public squares
const pubs=plots.filter(p=>p.pub);
for(const p of pubs){const {x,z}=p,R2=(a,b)=>[x+a,z+b];add('cobblePad',x,z,0,1,null,CITY_H+.2);const y0=CITY_H+.24;const A2=(k,dx,dz,ry=0,s=1,c)=>add(k,x+dx,z+dz,ry,s,c,y0);
 switch(p.d){
 case 0:for(let i=0;i<5;i++)A2('crate',-1.1+i%3*.65,-.9+(i/3|0)*.7,Math.random(),1);A2('crate',-.8,-.9,.3,.9,null);reg.crate.at(-1).y=y0+.6;for(let i=0;i<4;i++){A2('barrel',.7+(i%2)*.55,.4+(i/2|0)*.6);A2('hoop',.7+(i%2)*.55,.4+(i/2|0)*.6);reg.hoop.at(-1).y=y0+.45}A2('lamp',1.4,-1.4);A2('bulb',1.4,-1.4);break;
 case 1:for(const s of[-1,1]){A2('stallBase',0,s*.9,s>0?Math.PI:0);for(let i=0;i<6;i++)A2('stripe',-.75+i*.3,s*.9,s>0?Math.PI:0,1,i%2?'#ffffff':pick(['#ff8fa3','#7fd0c0','#ffd45e']));for(let i=0;i<10;i++)A2('produce',-.7+(i%5)*.35,s*.9+((i/5|0)-.5)*.25,0,1,pick(['#ff6b6b','#ffd45e','#7ad064','#ff9f43','#c39bff']))}A2('crate',1.4,0,.4,.7);break;
 case 2:A2('well',0,0);A2('wellRoof',0,0);A2('bench',-1.3,1.2,0);A2('bench',1.3,-1.2,Math.PI);A2('planter',1.3,1.3);A2('bush',1.3,1.3,0,1,'#ff9fb4');A2('lamp',-1.4,-1.4);A2('bulb',-1.4,-1.4);break;
 case 3:for(let i=0;i<4;i++)A2('hay',-.9+(i%2)*.9,-.8+(i/2|0)*.9,Math.random()*.4);A2('hay',-.45,-.35,.2);reg.hay.at(-1).y=y0+.7;for(let i=0;i<6;i++)A2('pumpkin',.9+Math.random()*.6-.3,.5+Math.random()*1.0-.4,Math.random()*3);break;
 case 4:A2('fountain',0,0);A2('water',0,0);for(const [dx,dz,ry] of[[0,1.6,0],[0,-1.6,0],[1.6,0,Math.PI/2],[-1.6,0,Math.PI/2]])A2('hedge',dx,dz,ry,.95);break;
 case 5:A2('pipe',0,-1.1);A2('pipe',0,-.6);A2('pipeV',1.2,-1.1);A2('valve',1.2,-1.1);A2('transformer',-.7,.8);A2('stripeY',-.7,.8);A2('transformer',.6,.8);A2('stripeY',.6,.8);break;
 case 6:A2('gear',0,0,0,1.2);reg.gear.at(-1).r=0;for(let i=0;i<3;i++)A2('crate',-1.2,-1+i*.8,i*.3,.9);for(let i=0;i<3;i++)A2('barrel',1.2,-1+i*.8);break;
 case 7:for(let i=0;i<4;i++){A2('rack',-.9+i*.6,-.5);A2('rackLed',-.9+i*.6,-.5)}A2('tray',0,-.5,Math.PI/2);A2('dish',1.1,1.1,2.3);for(let i=0;i<3;i++){A2('rack',-.9+i*.6,.8,Math.PI);A2('rackLed',-.9+i*.6,.8,Math.PI)}break}}
// verge extras per district (crates at docks, hay at farms...)
for(let i=0;i<220;i++){const k=i%NDIS,a=midAng(k)+(Math.random()-.5)*SEC*.85,r=20+Math.random()*34,x=Math.cos(a)*r,z=Math.sin(a)*r;if(streetDist(x,z)<2.3||streetDist(x,z)>3.0)continue;if(plots.some(p=>Math.hypot(p.x-x,p.z-z)<2.3))continue;
 const t={0:'crate',1:'produce',2:'planter',3:'hay',4:'hedge',5:'barrel',6:'crate',7:'barrel'}[k];if(t=='produce')continue;add(t,x,z,Math.random()*3,t=='hedge'?.6:.8);if(t=='planter')add('bush',x,z,0,.8,'#7ad064')}
for(const[k,list]of Object.entries(reg)){const im=new THREE.InstancedMesh(GEO[k],MAT[k],list.length);const o=new THREE.Object3D(),c=new THREE.Color();
 list.forEach((t,i)=>{o.position.set(t.x,t.y,t.z);o.rotation.set(0,t.r,0);o.scale.setScalar(t.s);o.updateMatrix();im.setMatrixAt(i,o.matrix);if(t.c)im.setColorAt(i,c.set(t.c));else if(MAT[k]===W)im.setColorAt(i,c.set('#ffffff'))});
 im.castShadow=!['bulb','water','rackLed','cobblePad','produce','hoop'].includes(k);im.receiveShadow=true;detailGroup.add(im)}

// ambient life
function folk(c,hair,skin='#ffe2c6'){const g=new THREE.Group(),b=new THREE.Group();g.add(b);
 b.add(mesh(new THREE.CapsuleGeometry(.26,.28,3,8),c,[0,.55,0]));const h=mesh(new THREE.SphereGeometry(.42,14,10),skin,[0,1.2,0]);b.add(h);
 const hr=mesh(new THREE.SphereGeometry(.45,14,8,0,6.28,0,1.35),hair,[0,1.24,-.03]);b.add(hr);
 for(const s of[-1,1]){b.add(mesh(new THREE.SphereGeometry(.055,6,5),'#3b2a20',[s*.14,1.2,.38],false))}
 const limbs=[];for(const s of[-1,1]){const arm=new THREE.Group();arm.position.set(s*.29,.72,0);arm.add(mesh(new THREE.CapsuleGeometry(.07,.16,2,6),c,[0,-.13,0],false));arm.add(mesh(new THREE.SphereGeometry(.08,6,5),skin,[0,-.29,0],false));b.add(arm);limbs.push(arm)}
 for(const s of[-1,1]){const leg=new THREE.Group();leg.position.set(s*.12,.26,0);leg.add(mesh(new THREE.CapsuleGeometry(.07,.1,2,6),'#6b5a45',[0,-.11,0],false));b.add(leg);limbs.push(leg)}
 g.userData={b,limbs};g.scale.setScalar(1.25);detailGroup.add(g);return g}
const npcs=[];const shirt=['#ffb3b3','#ffe08a','#b8e3ff','#c9f2c0','#f7c6ff','#ffd2a6','#d6d0ff','#fffaf0'],hairs=['#5a3b2c','#2f2a26','#c98a4b','#f2d27a','#8a5a36','#d9583c'];
for(let i=0;i<34;i++){const f=folk(pick(shirt),pick(hairs),pick(['#ffe2c6','#f0c9a0','#d9a87a','#ffe9d6']));const mode=i<22?'ring':'ave';
 const ring=pick([PLAZA_R+1.5,35,35,CITY_R]);npcs.push({f,mode,r:ring+(Math.random()<.5?-1:1)*(1.05+Math.random()*.3),th:Math.random()*6.28,sp:(Math.random()<.5?-1:1)*(.9+Math.random()*.6),k:Math.random()*NDIS|0,u:Math.random(),stop:0})}
const carts=[];for(let i=0;i<5;i++){const g=new THREE.Group();g.add(mesh(new RoundedBoxGeometry(1.4,.5,.9,1,.08),'#c99a62',[0,.65,0]));for(const s of[-1,1])g.add(mesh(new THREE.CylinderGeometry(.3,.3,.1,12).rotateX(Math.PI/2),'#8a5a36',[-.2,.3,s*.5]));
 for(let j=0;j<3;j++)g.add(mesh(new THREE.SphereGeometry(.17,8,6),pick(['#ff6b6b','#ffd45e','#7ad064','#ff9f43']),[-.4+j*.35,1.0,0]));
 const don=new THREE.Group();don.add(mesh(new THREE.CapsuleGeometry(.25,.5,3,8).rotateZ(Math.PI/2),'#b9b2a6',[0,.65,0]));don.add(mesh(new THREE.SphereGeometry(.22,10,8),'#b9b2a6',[.45,.95,0]));for(const s of[-1,1])don.add(mesh(new THREE.CapsuleGeometry(.04,.15,2,4),'#8f887d',[.42,1.2,s*.1]));
 for(const[x,z]of[[-.25,-.12],[-.25,.12],[.25,-.12],[.25,.12]])don.add(mesh(new THREE.CylinderGeometry(.05,.05,.4,5),'#8f887d',[x,.2,z]));don.position.x=1.4;g.add(don);
 detailGroup.add(g);carts.push({g,th:i/5*6.28,sp:(i%2?1:-1)*.05})}
const birds=[];for(let f=0;f<4;f++){const cx=(Math.random()-.5)*60,cz=(Math.random()-.5)*60;for(let i=0;i<5;i++){const g=new THREE.Group();g.add(mesh(new THREE.SphereGeometry(.15,6,5),'#fffaf0',[0,0,0],false));const w1=mesh(new THREE.BoxGeometry(.5,.03,.18),'#fffaf0',[.27,0,0],false),w2=mesh(new THREE.BoxGeometry(.5,.03,.18),'#fffaf0',[-.27,0,0],false);
 const p1=new THREE.Group(),p2=new THREE.Group();w1.position.x=.25;w2.position.x=-.25;p1.add(w1);p2.add(w2);g.add(p1,p2);detailGroup.add(g);birds.push({g,p1,p2,cx,cz,rad:14+f*4+i*.8,th:i*.25,h:13+f*2+(i%2)*.6,sp:.25+f*.04})}}
const flies=[];for(let i=0;i<24;i++){const g=new THREE.Group(),c=pick(['#ffffff','#ffe066','#ff9fb4','#c39bff','#9fd8ff']);const w1=new THREE.Mesh(new THREE.CircleGeometry(.16,6),new THREE.MeshStandardMaterial({color:c,side:THREE.DoubleSide}));const w2=w1.clone();w1.position.x=.14;w2.position.x=-.14;const p1=new THREE.Group(),p2=new THREE.Group();p1.add(w1);p2.add(w2);g.add(p1,p2);
 const base=pick(pubs.filter(p=>p.d==4||p.d==3||p.d==2))||pubs[0];detailGroup.add(g);flies.push({g,p1,p2,x:base.x+(Math.random()-.5)*5,z:base.z+(Math.random()-.5)*5,ph:Math.random()*9})}
function updateDetail(dt,t,dist){const on=dist<95;if(on!==detailOn){detailOn=on;detailGroup.visible=on;for(const g of detailMeshes)g.visible=on}
 if(!on)return;
 for(const n of npcs){let x,z,dx,dz;if(n.stop>0){n.stop-=dt}else{if(n.mode=='ring'){n.th+=n.sp*dt/n.r*1.6;x=Math.cos(n.th)*n.r;z=Math.sin(n.th)*n.r;dx=-Math.sin(n.th)*n.sp;dz=Math.cos(n.th)*n.sp}
  else{n.u+=n.sp*dt*.035;if(n.u>1||n.u<0){n.sp*=-1;n.u=Math.min(1,Math.max(0,n.u))}const a=avenueAng(n.k),rr=PLAZA_R+2+n.u*(CITY_R-PLAZA_R-3);const off=1.1*(n.sp>0?1:-1);x=Math.cos(a)*rr-Math.sin(a)*off;z=Math.sin(a)*rr+Math.cos(a)*off;dx=Math.cos(a)*n.sp;dz=Math.sin(a)*n.sp}
  if(Number.isFinite(x)){n.f.position.set(x,CITY_H+.12,z);n.f.rotation.y=Math.atan2(dx,dz)}if(Math.random()<.0015)n.stop=1.5+Math.random()*2}
  const moving=n.stop<=0,sw=moving?Math.sin(t*9+n.th*10):0,L=n.f.userData.limbs;L[0].rotation.x=sw*.8;L[1].rotation.x=-sw*.8;L[2].rotation.x=-sw*.6;L[3].rotation.x=sw*.6;n.f.userData.b.position.y=moving?Math.abs(sw)*.08:0}
 for(const c of carts){c.th+=c.sp*dt;const x=Math.cos(c.th)*35,z=Math.sin(c.th)*35;c.g.position.set(x,CITY_H+.1,z);c.g.rotation.y=Math.atan2(-Math.sin(c.th)*c.sp,Math.cos(c.th)*c.sp)-Math.PI/2}
 for(const b of birds){b.th+=b.sp*dt;b.g.position.set(b.cx+Math.cos(b.th)*b.rad,b.h+Math.sin(t*1.3+b.rad)*.6,b.cz+Math.sin(b.th)*b.rad);b.g.rotation.y=-b.th;const f=Math.sin(t*9+b.rad)*.6;b.p1.rotation.z=f;b.p2.rotation.z=-f}
 for(const f of flies){const q=t*.6+f.ph;f.g.position.set(f.x+Math.sin(q*1.3)*1.6,CITY_H+1+Math.sin(q*2.1)*.5+.4,f.z+Math.cos(q*.9)*1.6);f.g.rotation.y=q;const w=Math.sin(t*22+f.ph)*1.1;f.p1.rotation.y=w;f.p2.rotation.y=-w}}

// warm-up: simulate a month so the city is mid-contest
for(let k=0;k<D.length;k++)dCur[k].copy(dTgt[k]);paintGround();plots.forEach(plateColor);plateIM.instanceColor.needsUpdate=true;
render();const fakeTimer=null;ev('⏳ Waiting for engine…','','');
const view=new URLSearchParams(location.search).get('view');
if(view=='city'){cam.position.set(0,118,112);ctr.target.set(0,0,4)}
else if(view=='street'){const dd=+(new URLSearchParams(location.search).get('d')??1)%NDIS,a0=midAng(dd)+.12,P=new THREE.Vector3(Math.cos(a0)*35,CITY_H,Math.sin(a0)*35),u=new THREE.Vector3(Math.cos(a0),0,Math.sin(a0)),tv=new THREE.Vector3(-Math.sin(a0),0,Math.cos(a0));
 const a=A[dd%5];a.pin=true;a.route=[];a.pos.set(P.x+u.x*.6,0,P.z+u.z*.6);a.obj.rotation.y=Math.atan2(tv.x+u.x,tv.z+u.z);sel=a;card();a.bubT=0;say(a,a.q);a.bubT=999;
 npcs.slice(0,7).forEach((n,i)=>{n.mode='ring';n.r=35+(i%2?1.1:-1.1);n.th=a0+.16+i*.09;n.sp=(i%2?1:-1)*(.6+i*.05)});carts[0].th=a0-.25;
 cam.position.copy(P).addScaledVector(u,6).addScaledVector(tv,30).add(new THREE.Vector3(0,15,0));ctr.target.copy(P).addScaledVector(tv,2).add(new THREE.Vector3(0,1.4,0))}
else{cam.position.set(0,330,300);ctr.target.set(0,0,12)}

// ---------- loop ----------
const clock=new THREE.Clock(),v=new THREE.Vector3(),fw=new THREE.Vector3(),rt=new THREE.Vector3();let frame=0;
function loop(){const dt=Math.min(clock.getDelta(),.05),t=clock.elapsedTime;frame++;
 if(fly){fly.t=Math.min(fly.t+dt/1.6,1);const e=fly.t<.5?4*fly.t**3:1-(-2*fly.t+2)**3/2;ctr.target.lerpVectors(fly.ft,fly.tt,e);cam.position.lerpVectors(fly.fp,fly.tp,e);if(fly.t>=1)fly=null}
 let dist=cam.position.distanceTo(ctr.target);if(!Number.isFinite(dist)){cam.position.set(0,330,300);ctr.target.set(0,0,12);dist=445}
 scene.fog.near=dist*1.5+60;scene.fog.far=dist*3.5+300;
 if(keys.w||keys.a||keys.s||keys.d){cam.getWorldDirection(fw);fw.y=0;fw.normalize();rt.crossVectors(fw,cam.up);v.set(0,0,0).addScaledVector(fw,(keys.w?1:0)-(keys.s?1:0)).addScaledVector(rt,(keys.d?1:0)-(keys.a?1:0)).multiplyScalar(dist*.9*dt);cam.position.add(v);ctr.target.add(v)}
 ctr.target.x=Math.max(-160,Math.min(160,ctr.target.x));ctr.target.z=Math.max(-160,Math.min(160,ctr.target.z));ctr.update();
 const ext=Math.max(16,Math.min(150,dist*.55)),sc=sun.shadow.camera;if(sc.right!==ext){sc.left=-ext;sc.right=ext;sc.top=ext;sc.bottom=-ext;sc.far=420;sc.updateProjectionMatrix()}
 sun.target.position.copy(ctr.target);sun.position.copy(ctr.target).add(v.set(60,110,40));
 for(const p of pops){p.t+=dt;const x=Math.min(p.t/.7,1),e=1+Math.sin(x*Math.PI*2.5)*(1-x)*.5,s=(Math.min(x*1.4,1)||.001)*p.s;p.o.scale.set(s*(2-e),s*e,s*(2-e));if(x>=1)p.o.scale.setScalar(p.s)}
 for(let k=pops.length-1;k>=0;k--)if(pops[k].t>.7)pops.splice(k,1);
 // district tint blend
 let ch=false;for(let k=0;k<D.length;k++){const c=dCur[k],g=dTgt[k];if(Math.abs(c.r-g.r)+Math.abs(c.g-g.g)+Math.abs(c.b-g.b)>.004){c.lerp(g,Math.min(1,dt*.8));ch=true}}
 if(ch&&frame%8==0){paintGround();plots.forEach(p=>{if(!p.o)plateColor(p)});plateIM.instanceColor.needsUpdate=true}
 if(frame%20==0)for(const b of buildObjs)b.visible=b.position.distanceTo(cam.position)<Math.max(260,dist*1.6);
 updateDetail(dt,t,dist);for(const o of anims){if(o.name=='blink')o.material.emissiveIntensity=.6+.5*Math.sin(t*3+o.id);else if(o.name=='smoke'){const f=(t*.6+o.id*.1)%1;o.position.y=2.8+f*1.6;o.scale.setScalar(1-f*.6)}else if(o.name=='prop')o.rotation.y=t*8;else if(o.name=='coin'){o.rotation.z=t*1.5;o.position.y=12.6+Math.sin(t*2)*.3}}
 dInfo.forEach((d,k)=>{if(!d.g.visible)return;const p=d.flag.geometry.attributes.position,b=d.flag.userData.base;for(let i=0;i<p.count;i++){const x=b[i*3];p.setZ(i,Math.sin(x*1.4-t*4+k)*.25*x/3.6)}p.needsUpdate=true});
 clouds.forEach((c,k)=>{c.position.x+=dt*(1+k%3*.5);if(c.position.x>210)c.position.x=-210});
 water.position.y=-.2+Math.sin(t*.7)*.05;
 const W2=innerWidth,H2=innerHeight,proj=(x,y,z)=>{v.set(x,y,z).project(cam);return{ok:v.z<1&&Number.isFinite(v.x)&&Number.isFinite(v.y),x:(v.x*.5+.5)*W2,y:(-v.y*.5+.5)*H2}};
 A.forEach(a=>{let moving=false;if(a.route.length){const tg=a.route[0];v.subVectors(tg,a.pos);v.y=0;const d=v.length();if(d<.25)a.route.shift();else{v.normalize().multiplyScalar(Math.min(d,dt*a.speed));a.pos.add(v);a.obj.rotation.y=Math.atan2(v.x,v.z);moving=true}}
  a.pos.y=Math.max(hAt(a.pos.x,a.pos.z),.95)+.12;a.obj.position.copy(a.pos);const b=a.obj.userData.body;b.position.y=moving?Math.abs(Math.sin(t*12))*.25:Math.sin(t*2+a.l.charCodeAt(0))*.05;b.rotation.z=moving?Math.sin(t*12)*.08:0;{const L=a.obj.userData.limbs,sw=moving?Math.sin(t*12):Math.sin(t*2+a.l.charCodeAt(0))*.12;L[0].rotation.x=sw*.9;L[1].rotation.x=-sw*.9;L[2].rotation.x=moving?-sw*.7:0;L[3].rotation.x=moving?sw*.7:0}
  a.bubT-=dt;const s=proj(a.pos.x,a.pos.y+4.8,a.pos.z);const near=dist<110;a.bub.style.opacity=s.ok&&near&&a.bubT>0?1:0;a.tag.style.opacity=s.ok&&dist<300&&!(near&&a.bubT>0)?1:0;if(s.ok){a.bub.style.left=a.tag.style.left=s.x+'px';a.bub.style.top=a.tag.style.top=s.y+'px'}});
 if(frame%10==1)dLabs.forEach((e,k)=>{const i=dInfo[k],c=i.ctrl&&ac(i.ctrl),top=Object.entries(i.share).sort((a,b)=>b[1]-a[1])[0];e.innerHTML=`${D[k].ic} ${D[k].n} ${c?`<span class="crest" style="background:${c.c}">${c.l}</span>`:`<span class="ct">contested</span>`}`});
 dLabs.forEach((e,k)=>{const a=midAng(k),s=proj(Math.cos(a)*40,CITY_H+5,Math.sin(a)*40);e.style.opacity=s.ok&&dist>45&&dist<300?1:0;e.style.left=s.x+'px';e.style.top=s.y+'px'});
 {const s=proj(0,CITY_H+17,0);cityLab.style.opacity=s.ok&&dist>60?1:0;cityLab.style.left=s.x+'px';cityLab.style.top=s.y+'px'}
 frontierLabs.forEach(f=>{const s=proj(f.x,hAt(f.x,f.z)+8,f.z);f.e.style.opacity=s.ok&&dist>260?1:0;f.e.style.left=s.x+'px';f.e.style.top=s.y+'px'});
 if(frame%6==0)drawMini();
 R.render(scene,cam);requestAnimationFrame(loop)}
loop();

// ---------- LIVE: read the engine's public state API; fall back to mock ticks ----------
const qsL=new URLSearchParams(location.search);
const PUBLIC_API='https://shift-ensures-sustained-alphabetical.trycloudflare.com/state'; // quick-tunnel URL changes when cloudflared restarts
const API=qsL.get('api')||(/^(localhost|127\.0\.0\.1)$/.test(location.hostname)?'http://127.0.0.1:8787/state':PUBLIC_API);
const MODE_LABEL={mock:'sim',dry:'dry run',live:'LIVE'};
const seenEv=new Set();
const seasonEl=document.getElementById('season');
function setSeason(t){if(seasonEl)seasonEl.textContent=t}
function linkify(text){let h=text;for(const a of A)h=h.replace(new RegExp('\\b'+a.id+'\\b','g'),cr(a));return h}
function applyLive(s){
 if(!LIVE){clearInterval(fakeTimer);feed.innerHTML='';plots.forEach(p=>{if(!p.hq&&p.o)setOwn(p,null)})}
 LIVE=s;window.__AIE_STATE=s;window.dispatchEvent(new Event('aie-state'));tick=s.tick;document.getElementById('tick').textContent=s.tick;
 const lv=document.querySelector('.live');if(lv){lv.textContent='● '+(MODE_LABEL[s.mode]||s.mode)+(s.kill_switch?' · KILLED':'');lv.style.color=s.mode==='live'?'#e2774f':'#4fb36b'}
 for(const sa of s.agents){const a=ac(sa.id);if(!a)continue;Object.assign(a,{sol:sa.balance_sol,land:sa.plots,bld:sa.buildings,dc:sa.districts,pow:sa.power,provider:sa.provider,model:sa.model,pubkey:sa.pubkey});if(sa.quote&&sa.quote!==a.q)say(a,sa.quote)}
 // map engine ownership counts onto the visual plots (scaled per district)
 D.forEach((d,k)=>{const eng=s.districts[k];if(!eng)return;const site=dPlots[k].filter(p=>!p.pub&&!p.hq),N=site.length,want={};
  for(const[id,c]of Object.entries(eng.owners||{}))want[id]=Math.round(c*N/Math.max(1,eng.plots));
  const have={};site.forEach(p=>{if(p.o)(have[p.o]=have[p.o]||[]).push(p)});
  for(const[id,list]of Object.entries(have)){const w=want[id]||0;while(list.length>w)setOwn(list.pop(),null)}
  for(const[id,w]of Object.entries(want)){let need=w-(have[id]||[]).length;const free=site.filter(p=>!p.o);const a=ac(id);
   while(need-->0&&free.length){const p=free.splice(Math.random()*free.length|0,1)[0];setOwn(p,id);if(!p.b&&Math.random()<(a.bld||0)/Math.max(1,a.land))place(p,D[k].type,false)}}});
 plateIM.instanceColor.needsUpdate=true;
 LIVE_CTRL=s.districts.map(d=>d.controller);updateControl(false).forEach(t=>ev(t,'','take'));
 // feed from engine events (oldest first so newest ends on top)
 for(const e of s.events){const key=e.ts+e.text;if(seenEv.has(key))continue;seenEv.add(key);if(/SOL/i.test(e.text||'')&&!(s.mode==='live'&&e.sig&&!/^MOCK/.test(e.sig)))continue;if(e.type==='quote'||e.type==='invalid')continue;
  const cls=e.type==='fees_in'?'fee':e.type==='payout'||e.type==='payout_skip'?'fee':['betrayal','default','buyout'].includes(e.type)?'shock':'';
  const sig=e.sig&&!/^MOCK/.test(e.sig)&&s.mode==="live"?` <a class="sig" href="https://solscan.io/tx/${e.sig}" target="_blank">tx</a>`:'';
  ev((e.type==='fees_in'?'🪙 ':'')+linkify(e.text)+sig,'',cls);
  const a=ac(e.agent);if(a&&e.district!=null){const mine=dPlots[e.district].filter(p=>p.o===a.id);const p=pick(mine.length?mine:dPlots[e.district]);goTo(a,p.x,p.z)}}
 {const em=feed.querySelector('.empty');if(feed.querySelector('.ev:not(.empty)'))em?.remove();else if(!em)feed.innerHTML='<div class="ev empty">No transactions yet</div>'}
 const h=bank.hist;h.push(s.bank.balance_sol);if(h.length>60)h.shift();
 render()}
async function poll(){if(qsL.get('mock'))return;try{const r=await fetch(API,{cache:'no-store',signal:AbortSignal.timeout(2500)});if(!r.ok)throw new Error(r.status);applyLive(await r.json())}
 catch(e){if(!LIVE){document.getElementById('tick').textContent='0'}}}
poll();setInterval(poll,4000);

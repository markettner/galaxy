/* Procedural lens-dirt texture generator.
 * Builds the 256x192 RGBA map the lens-flare / dirty-glass effect samples.
 * The generator body below is minified; the seed is fixed at 0xa57ad175 so the
 * dirt field is deterministic across runs. Only the export wrapper at the
 * bottom is hand-written.
 */
(function (global) {
"use strict";
const THREE = global.THREE;

function m(e,t,r){let i=new Float32Array(e*t);for(let e=0;e<i.length;e+=1)i[e]=r();return{columns:e,rows:t,values:i}}
function v(e,t,r){let i=h(t,0,1)*(e.columns-1),o=h(r,0,1)*(e.rows-1),a=Math.floor(i),n=Math.floor(o),s=Math.min(a+1,e.columns-1),l=Math.min(n+1,e.rows-1),u=d(0,1,i-a),c=d(0,1,o-n);return(e.values[n*e.columns+a]*(1-u)+e.values[n*e.columns+s]*u)*(1-c)+(e.values[l*e.columns+a]*(1-u)+e.values[l*e.columns+s]*u)*c}
function d(e,t,r){let i=h((r-e)/(t-e),0,1);return i*i*(3-2*i)}
function g(e){return(e()+e()+e()+e()+e()+e()-3)/3}
function x(e,t,r,i,o,a,n,s){let l=Math.max(a,.5),u=Math.max(0,Math.floor(i-l-1)),c=Math.min(t-1,Math.ceil(i+l+1)),f=Math.max(0,Math.floor(o-l-1)),h=Math.min(r-1,Math.ceil(o+l+1));for(let r=f;r<=h;r+=1)for(let a=u;a<=c;a+=1){let u=Math.hypot(a-i,r-o)/l;if(u>=1)continue;let c=function(e,t,r){let i=Math.imul(e+31*r,0x466f45d);return i^=Math.imul(t+17*r,0x127409f),(((i=Math.imul(i^i>>>13,0x4bf19f61))^i>>>16)>>>0)/0x100000000}(a,r,s);if(u>.42&&c<.3+.24*u)continue;let f=.52+.48*c,h=n*(1-d(.48,1,u))*f,p=r*t+a;e[p]=Math.max(e[p],h)}}
function h(e,t,r){return Math.min(r,Math.max(t,e))}
function p(e,t){return void 0!==e&&Number.isFinite(e)?h(Math.floor(e),16,1024):t}
function M(e,t,r){let i=function(e,t,r){let i,o=(i=r>>>0,()=>{let e=i+=0x6d2b79f5;return e=Math.imul(e^e>>>15,1|e),(((e^=e+Math.imul(e^e>>>7,61|e))^e>>>14)>>>0)/0x100000000}),a=m(13,10,o),n=m(47,35,o),s=Array.from({length:7},()=>{let e=o()*Math.PI;return{centerX:.08+.84*o(),centerY:.08+.84*o(),cosine:Math.cos(e),frequency:8+18*o(),phase:o()*Math.PI*2,radiusX:.08+.18*o(),radiusY:.035+.09*o(),sine:Math.sin(e),strength:.035+.075*o()}}),l=new Float32Array(e*t);for(let r=0;r<t;r+=1){let i=r/Math.max(t-1,1);for(let t=0;t<e;t+=1){let u=t/Math.max(e-1,1),c=v(a,u,i),f=v(n,u,i),h=o(),p=d(.43,.74,.68*c+.32*f),m=.018+.032*c+.022*f+.012*h+p*(.038+.032*h);for(let e of s){let t=u-e.centerX,r=i-e.centerY,o=(t*e.cosine+r*e.sine)/e.radiusX,a=(-t*e.sine+r*e.cosine)/e.radiusY,n=o*o+a*a;if(n>=1)continue;let s=1-d(.18,1,Math.sqrt(n)),l=Math.pow(.5+.5*Math.sin((.72*o+a)*e.frequency+e.phase),8);m+=e.strength*s*(.18+.82*l)*(.5+.5*h)}let g=o();g>.965&&(m+=.5*Math.pow((g-.965)/.035,1.8)),l[r*e+t]=m}}let u=Array.from({length:18},()=>({x:o()*e,y:o()*t,spreadX:e*(.022+.095*o()),spreadY:t*(.018+.075*o())})),c=Math.max(32,Math.round(e*t/58));for(let i=0;i<c;i+=1){let a=o()*e,n=o()*t;if(.58>o()){let e=u[Math.floor(o()*u.length)];a=e.x+g(o)*e.spreadX,n=e.y+g(o)*e.spreadY}x(l,e,t,a,n,.52+1.15*Math.pow(o(),3),.24+.7*Math.pow(o(),1.8),r+i)}let f=Math.max(6,Math.round(e*t/4e3));for(let i=0;i<f;i+=1){let a=o()*e,n=o()*t,s=2+Math.floor(4*o()),u=.28+.5*o();for(let c=0;c<s;c+=1)x(l,e,t,a+3.5*g(o),n+3.5*g(o),1.2+3.8*o(),u*(.55+.45*o()),r+7*i+c)}let h=Math.max(3,Math.round(e*t/2e4));for(let i=0;i<h;i+=1){let a=o()*e,n=o()*t,s=o()*Math.PI*2,u=e*(.08+.22*o()),c=Math.max(1,Math.ceil(u/.7)),f=.07+.15*o();for(let h=0;h<=c;h+=1){if(.28>o())continue;let d=h/c,p=.9*g(o);x(l,e,t,a+Math.cos(s)*u*d-Math.sin(s)*p,n+Math.sin(s)*u*d+Math.cos(s)*p,.45+.45*o(),f*(.55+.45*o()),r+131*i+h)}}return l}(e,t,r),o=new Uint8Array(e*t*4);for(let e=0;e<i.length;e+=1){let t=Math.round(255*Math.pow(h(i[e],0,1),.94)),r=4*e;o[r]=t,o[r+1]=t,o[r+2]=t,o[r+3]=255}return o}

global.GalaxyDirt = {
  createTexture(width = 256, height = 192, seed = 0xa57ad175) {
    const data = M(width, height, seed);
    const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    tex.name = "Galaxy procedural lens dirt";
    tex.colorSpace = THREE.NoColorSpace;
    tex.flipY = false;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  },
};
})(window);

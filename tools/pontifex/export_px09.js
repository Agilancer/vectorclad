// Exports the PX-09 Pontifex's code-built armor to tools/pontifex/px09_source.glb, for detailing in Blender
// (tools/pontifex/detail_px09.py). Rest pose; every joint named; materials named by their pontifexMaterials key.
// Usage: node tools/pontifex/export_px09.js   (server on BASE_URL, default http://127.0.0.1:8251)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8251';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e));
  // A blank page with the import map, on the same origin as the modules
  await page.goto(BASE + '/tools/pontifex/export.html');
  const b64 = await page.evaluate(async (base) => {
    const THREE = await import(base + '/js/three.js');
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const { makeMaterials, glowTexture } = await import(base + '/js/atlas.js');
    const { PontifexMech } = await import(base + '/assets/pontifex-frame/pontifex-mech.js');
    const tex = new THREE.Texture();
    const mats = makeMaterials({ body: tex, weapons: tex });
    // The source is the code-built armor at full size (the game shrinks the frame at its root)
    const m = new PontifexMech(mats, glowTexture ? glowTexture() : tex);
    m.root.scale.setScalar(1);
    for (const [k, v] of Object.entries(m.pontifexMaterials)) v.name = k;
    m.pontifexResources.decalMat.name = 'decal';
    // Name the joints so the Blender file reads
    const N = (o, n) => { if (o) o.name = n; };
    N(m.root, 'PX09'); N(m.body, 'body'); N(m.pelvis, 'pelvis'); N(m.waist, 'waist'); N(m.chest, 'chest'); N(m.head, 'head'); N(m.backpack, 'backpack');
    N(m.codpiece, 'codpiece'); N(m.rearPlate, 'rearPlate');
    m.legs.forEach((L) => { const s = L.s > 0 ? 'L' : 'R'; N(L.hip, 'hip_' + s); N(L.knee, 'knee_' + s); N(L.ankle, 'ankle_' + s); });
    m.arms.forEach((A) => { const s = A.s > 0 ? 'L' : 'R'; N(A.sh, 'shoulder_' + s); N(A.elbow, 'elbow_' + s); N(A.hand, 'hand_' + s); });
    m.pauldrons.forEach((P) => N(P.g, 'pauldronPivot_' + (P.s > 0 ? 'L' : 'R')));
    // Only the armor: drop outlines, sprites and the stock thrusters/pistons from the copy we export
    const skins = new Set();
    m.root.traverse((o) => { if (/^PX09 /.test(o.name)) skins.add(o); });
    const inSkin = (o) => { for (; o; o = o.parent) if (skins.has(o)) return true; return false; };
    const drop = [];
    m.root.traverse((o) => { if ((o.isMesh || o.isSprite) && (o.userData.isOutline || o.isSprite || !inSkin(o))) drop.push(o); });
    for (const o of drop) o.removeFromParent();
    m.root.updateMatrixWorld(true);
    const data = await new GLTFExporter().parseAsync(m.root, { binary: true, onlyVisible: false });
    let s = ''; const u = new Uint8Array(data);
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }, BASE);
  const out = path.join(__dirname, 'px09_source.glb');
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log('wrote', out, fs.statSync(out).size);
  await browser.close();
})();

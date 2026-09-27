import sharp from 'sharp';
import { mkdir, readFile } from 'node:fs/promises';
await mkdir('public/icons',{recursive:true});
const svg=await readFile('public/icon.svg');
await sharp(svg).resize(192).png().toFile('public/icons/icon-192.png');
await sharp(svg).resize(512).png().toFile('public/icons/icon-512.png');
const inner=await sharp(svg).resize(340).png().toBuffer();
await sharp({create:{width:512,height:512,channels:4,background:'#136b58'}}).composite([{input:inner,left:86,top:86}]).png().toFile('public/icons/maskable-512.png');

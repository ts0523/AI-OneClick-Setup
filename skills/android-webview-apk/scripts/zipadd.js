/*
 * zipadd.js —— 往已有 zip/apk 末尾追加条目，不改动任何既有条目的偏移量。
 *
 * 为什么需要它：aapt2 link 只能产出"资源包"，classes.dex 必须自己塞进去。
 * Android 11+ 要求 resources.arsc 必须是「未压缩 + 4 字节对齐」，所以流程是
 *   aapt2 link -> zipalign -> 这里追加 dex（追加不动旧偏移，对齐不被破坏）-> apksigner
 * 如果先追加再 zipalign，zipalign 会重排整个包；先对齐再追加才是稳的。
 *
 * 用法:
 *   node zipadd.js add <apk> <zip内路径> <本地文件> [更多 路径/文件...]
 *   node zipadd.js list <apk>
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* ---------- CRC32 ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ---------- EOCD ---------- */
function findEOCD(buf) {
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error('EOCD not found — 目标不是合法 zip');
}

function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/* ---------- add ---------- */
function add(apkPath, pairs) {
  const buf = fs.readFileSync(apkPath);
  const eocd = findEOCD(buf);
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  const head = buf.subarray(0, cdOffset);
  const oldCd = buf.subarray(cdOffset, cdOffset + cdSize);

  const { time, date } = dosTime(new Date());
  const locals = [];
  const newCd = [];
  let cursor = cdOffset; // 新条目的本地头从原中央目录起始处开始

  for (const [name, file] of pairs) {
    const data = fs.readFileSync(file);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const size = data.length;

    // method 0 = STORE。dex 不压缩也完全合法（Android 推荐如此，可 mmap）。
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);          // version needed
    lh.writeUInt16LE(0, 6);           // flags
    lh.writeUInt16LE(0, 8);           // method STORE
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(size, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, data);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);          // version made by
    ch.writeUInt16LE(20, 6);          // version needed
    ch.writeUInt16LE(0, 8);           // flags
    ch.writeUInt16LE(0, 10);          // method
    ch.writeUInt16LE(time, 12);
    ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(size, 20);
    ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);          // extra len
    ch.writeUInt16LE(0, 32);          // comment len
    ch.writeUInt16LE(0, 34);          // disk start
    ch.writeUInt16LE(0, 36);          // internal attrs
    ch.writeUInt32LE(0, 38);          // external attrs
    ch.writeUInt32LE(cursor, 42);     // local header offset
    newCd.push(ch, nameBuf);

    cursor += 30 + nameBuf.length + size;
  }

  const localsBuf = Buffer.concat(locals);
  const newCdBuf = Buffer.concat([oldCd, ...newCd]);
  const newCdOffset = cdOffset + localsBuf.length;

  const eo = Buffer.alloc(22);
  eo.writeUInt32LE(0x06054b50, 0);
  eo.writeUInt16LE(0, 4);
  eo.writeUInt16LE(0, 6);
  eo.writeUInt16LE(total + pairs.length, 8);
  eo.writeUInt16LE(total + pairs.length, 10);
  eo.writeUInt32LE(newCdBuf.length, 12);
  eo.writeUInt32LE(newCdOffset, 16);
  eo.writeUInt16LE(0, 20);

  const out = Buffer.concat([head, localsBuf, newCdBuf, eo]);
  fs.writeFileSync(apkPath, out);
  console.log(`zipadd: +${pairs.length} entry  ${total} -> ${total + pairs.length}  ` +
    `${buf.length} -> ${out.length} bytes`);
}

/* ---------- list ---------- */
function list(apkPath) {
  const buf = fs.readFileSync(apkPath);
  const eocd = findEOCD(buf);
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  let p = cdOffset;
  const end = cdOffset + cdSize;
  let n = 0;
  while (p < end && n < total) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('CD header 损坏 @' + p);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    console.log(`  ${method === 0 ? 'STORE' : 'DEFL '}  ${String(usize).padStart(9)}  ` +
      `@${String(off).padStart(9)}  ${name}${elen ? '  [extra ' + elen + ']' : ''}`);
    p += 46 + nlen + elen + clen;
    n++;
  }
  console.log(`entries: ${n}`);
  // 顺带校验 zip 结构自洽
  let sum = 0;
  for (let i = cdOffset; i < cdOffset + cdSize; i++) sum = (sum + buf[i]) >>> 0;
  console.log(`cd ok, size=${cdSize}, offset=${cdOffset}`);
}

/* ---------- slash ----------
 * Windows 上的 aapt2 用 -A 打包 assets 时，嵌套目录会写进反斜杠分隔符
 * （assets\fonts\x.woff2）。Android 的 AssetManager 只认正斜杠，这条路径
 * 会直接 404。反斜杠和正斜杠都是 1 字节，所以可以原地改写：
 * 所有偏移、长度、CRC 全都不变，不需要重建 zip。
 */
function slash(apkPath) {
  const buf = fs.readFileSync(apkPath);
  const eocd = findEOCD(buf);
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  let p = cdOffset;
  const end = cdOffset + cdSize;
  let n = 0, fixed = 0;
  const locOffsets = [];

  while (p < end && n < total) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('CD header 损坏 @' + p);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const nameAt = p + 46;
    for (let i = 0; i < nlen; i++) {
      if (buf[nameAt + i] === 0x5c) { buf[nameAt + i] = 0x2f; fixed++; }
    }
    locOffsets.push([off, nlen]);
    p += 46 + nlen + elen + clen;
    n++;
  }

  for (const [off, nlen] of locOffsets) {
    if (buf.readUInt32LE(off) !== 0x04034b50) throw new Error('local header 损坏 @' + off);
    const llen = buf.readUInt16LE(off + 26);
    if (llen !== nlen) throw new Error(`local/CD 名称长度不一致 @${off}: ${llen} vs ${nlen}`);
    const lnameAt = off + 30;
    for (let i = 0; i < llen; i++) {
      if (buf[lnameAt + i] === 0x5c) buf[lnameAt + i] = 0x2f;
    }
  }

  fs.writeFileSync(apkPath, buf);
  console.log(`zipadd: slash 修正 ${fixed} 处分隔符 / ${n} 个条目（原地改写，偏移不变）`);
}

/* ---------- main ---------- */
const [cmd, target, ...rest] = process.argv.slice(2);
if (cmd === 'list') {
  list(path.resolve(target));
} else if (cmd === 'slash') {
  slash(path.resolve(target));
} else if (cmd === 'add') {
  if (rest.length < 2 || rest.length % 2 !== 0) {
    throw new Error('用法: zipadd.js add <apk> <zip内路径> <本地文件> [...]');
  }
  const pairs = [];
  for (let i = 0; i < rest.length; i += 2) pairs.push([rest[i], path.resolve(rest[i + 1])]);
  add(path.resolve(target), pairs);
} else {
  console.log('用法: node zipadd.js add <apk> <name> <file> ...  |  slash <apk>  |  list <apk>');
  process.exit(1);
}

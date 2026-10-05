#!/usr/bin/env node
/**
 * read-gguf-header.js — 只读 GGUF 头部，打印算 KV 内存账需要的结构字段。
 * 用法: node read-gguf-header.js <model.gguf>
 *
 * 只读前 32MB，不会把整个模型读进内存。
 */
const fs = require('fs');

const file = process.argv[2];
if (!file) { console.error('用法: node read-gguf-header.js <model.gguf>'); process.exit(2); }

const HEADER_BYTES = 32 * 1024 * 1024;
const fd = fs.openSync(file, 'r');
const head = Buffer.alloc(HEADER_BYTES);
const got = fs.readSync(fd, head, 0, HEADER_BYTES, 0);
fs.closeSync(fd);

let o = 0;
const need = n => { if (o + n > got) throw new Error('头部缓冲不够，需要更大 HEADER_BYTES'); };
const u8 = () => { need(1); return head.readUInt8(o++); };
const u16 = () => { need(2); const v = head.readUInt16LE(o); o += 2; return v; };
const i16 = () => { need(2); const v = head.readInt16LE(o); o += 2; return v; };
const u32 = () => { need(4); const v = head.readUInt32LE(o); o += 4; return v; };
const i32 = () => { need(4); const v = head.readInt32LE(o); o += 4; return v; };
const u64 = () => { need(8); const v = Number(head.readBigUInt64LE(o)); o += 8; return v; };
const i64 = () => { need(8); const v = Number(head.readBigInt64LE(o)); o += 8; return v; };
const f32 = () => { need(4); const v = head.readFloatLE(o); o += 4; return v; };
const f64 = () => { need(8); const v = head.readDoubleLE(o); o += 8; return v; };
const str = () => { const len = u64(); need(len); const s = head.toString('utf8', o, o + len); o += len; return s; };

const GGUF_TYPES = {
  0: 'uint8', 1: 'int8', 2: 'uint16', 3: 'int16', 4: 'uint32', 5: 'int32',
  6: 'float32', 7: 'bool', 8: 'string', 9: 'array', 10: 'uint64', 11: 'int64', 12: 'float64',
};

function readValue(type) {
  switch (type) {
    case 0: return u8();
    case 1: { need(1); const v = head.readInt8(o); o += 1; return v; }
    case 2: return u16();
    case 3: return i16();
    case 4: return u32();
    case 5: return i32();
    case 6: return f32();
    case 7: return !!u8();
    case 8: return str();
    case 10: return u64();
    case 11: return i64();
    case 12: return f64();
    case 9: {
      const elemType = u32();
      const len = u64();
      const take = Math.min(len, 8);
      const out = [];
      for (let k = 0; k < len; k++) {
        const v = readValue(elemType);   // 必须把全部元素都读掉，否则偏移错位
        if (k < take) out.push(v);
      }
      return { __array: true, elemType: GGUF_TYPES[elemType] || elemType, len, sample: out };
    }
    default:
      throw new Error('未知字段类型 ' + type + ' @' + o);
  }
}

const magic = head.toString('utf8', 0, 4); o = 4;
const version = u32();
const nTensors = u64();
const nKV = u64();

console.log('magic=' + magic + '  version=' + version + '  tensors=' + nTensors + '  kvCount=' + nKV);
console.log(''.padEnd(70, '-'));

const WANT = /architecture|name$|block_count|layer_count|context_length|embedding_length|head_count|key_length|value_length|full_attention_interval|sliding_window|rope\.|expert|vocab_size|file_type|vision|clip|mmproj/i;
const interesting = [];

for (let i = 0; i < nKV; i++) {
  let key;
  try { key = str(); } catch (e) { console.log('(头部解析中断于 kv#' + i + ': ' + e.message + ')'); break; }
  const type = u32();
  let value;
  try { value = readValue(type); } catch (e) { console.log('(解析 ' + key + ' 失败: ' + e.message + ')'); break; }
  if (WANT.test(key)) {
    const shown = (value && value.__array) ? 'array[' + value.elemType + '] x' + value.len + ' ' + JSON.stringify(value.sample) : value;
    console.log(key + ' = ' + (typeof shown === 'string' ? shown : JSON.stringify(shown)));
    interesting.push([key, value]);
  }
}

// ---- KV 内存账 ----
console.log(''.padEnd(70, '-'));
const find = re => { const h = interesting.find(([k]) => re.test(k)); return h ? h[1] : null; };
const layers = find(/block_count|layer_count/);
const interval = find(/full_attention_interval/);
const kvHeads = find(/head_count_kv/);
const keyLen = find(/key_length/);
const valLen = find(/value_length/);
const ctxMax = find(/context_length/);

if (layers && kvHeads && keyLen && valLen) {
  const kvLayers = interval ? Math.round(layers / interval) : layers;
  const bytesPerToken = kvLayers * (keyLen + valLen) * kvHeads * 2; // F16
  console.log('KV 缓存估算 (F16):');
  console.log('  带 KV 的层数 = ' + kvLayers + (interval ? '  (总 ' + layers + ' 层 / full_attention_interval ' + interval + ')' : ''));
  console.log('  每 token  = ' + bytesPerToken + ' B  (' + (bytesPerToken / 1024).toFixed(1) + ' KB)');
  for (const c of [8192, 16384, 32768, 65536, 131072, ctxMax || 0].filter(Boolean)) {
    console.log('  ctx ' + String(c).padStart(7) + ' -> ' + (bytesPerToken * c / 1073741824).toFixed(2) + ' GB');
  }
} else {
  console.log('(结构字段不全，跳过 KV 估算。注意混合注意力模型的 head_count_kv 未必存在。)');
}

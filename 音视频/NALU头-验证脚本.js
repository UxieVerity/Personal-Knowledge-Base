#!/usr/bin/env node
/**
 * NALU 头字段位级解析（H264 1B 头 / H265 2B 头）
 *
 * 用法: node NALU头-验证脚本.js <raw.h264|raw.h265> [数量]
 * 生成测试流:
 *   ffmpeg -f lavfi -i testsrc=duration=1:size=128x96:rate=10 -c:v libx264 -pix_fmt yuv420p -g 5 -x264-params repeat-headers=1 -f h264 test.h264
 *   ffmpeg -f lavfi -i testsrc=duration=1:size=128x96:rate=10 -c:v libx265 -pix_fmt yuv420p -g 5 -x265-params repeat-headers=1 -f hevc test.h265
 *
 * 解析规则（ITU-T H.264 §7.3.1 / H.265 §7.3.1.2）：
 *   H264 头 1 字节: [forbidden_zero_bit(1) | nal_ref_idc(2) | nal_unit_type(5)]
 *   H265 头 2 字节: [forbidden_zero_bit(1) | nal_unit_type(6) | nuh_layer_id(6) | nuh_temporal_id_plus1(3)]
 */
'use strict';
const fs = require('fs');

const H264_TYPE = {
  1: 'slice(非IDR)', 2: 'slice分区A', 3: 'slice分区B', 4: 'slice分区C', 5: 'IDR',
  6: 'SEI', 7: 'SPS', 8: 'PPS', 9: 'AUD(访问单元分隔)', 12: '填充数据',
};

const H265_TYPE = {
  0: 'TRAIL_N(slice)', 1: 'TRAIL_R(slice)', 19: 'IDR_W_RADL', 20: 'IDR_N_LP',
  21: 'CRA(开放GOP关键帧)', 32: 'VPS', 33: 'SPS', 34: 'PPS', 35: 'AUD', 39: 'SEI_PREFIX', 40: 'SEI_SUFFIX',
};

// 找 annexb startcode 分隔的 NALU（兼容 3B/4B startcode）
function splitNalus(buf, max = 50) {
  const out = [];
  let i = 0;
  const starts = [];
  while (i < buf.length - 3) {
    if (buf[i] === 0 && buf[i + 1] === 0) {
      if (buf[i + 2] === 1) { starts.push({ off: i, hdr: 3 }); i += 3; continue; }
      if (buf[i + 2] === 0 && i + 3 < buf.length && buf[i + 3] === 1) { starts.push({ off: i, hdr: 4 }); i += 4; continue; }
    }
    i++;
  }
  for (let s = 0; s < starts.length && out.length < max; s++) {
    const dataStart = starts[s].off + starts[s].hdr;
    const dataEnd = s + 1 < starts.length ? starts[s + 1].off : buf.length;
    out.push({ startcode: starts[s].hdr, bytes: buf.subarray(dataStart, dataEnd) });
  }
  return out;
}

const bits = (byte, hi, lo) => (byte >> lo) & ((1 << (hi - lo + 1)) - 1);
const bin = (byte, n) => byte.toString(2).padStart(n, '0').replace(/(.{4})(?=.)/g, '$1 ');

function parseH264(nalu) {
  const h = nalu[0];
  const fz = bits(h, 7, 7), refIdc = bits(h, 6, 5), type = bits(h, 4, 0);
  return {
    header: `0x${h.toString(16).padStart(2, '0')} (${bin(h, 8)})`,
    fields: {
      forbidden_zero_bit: `${fz} ${fz === 0 ? '✅必须为0(传输层出错置1,解码器应丢弃)' : '❌异常'}`,
      nal_ref_idc: `${refIdc} ${refIdc > 0 ? '→ 参考帧(内容会被后续帧引用,丢不得)' : '→ 非参考(可丢)'}`,
      nal_unit_type: `${type} = ${H264_TYPE[type] || '类型' + type}`,
    },
    payload: nalu.length,
  };
}

function parseH265(nalu) {
  const h0 = nalu[0], h1 = nalu[1];
  // H265 头不按字节对齐: forbidden=bit15, type=bit14..9, layer_id=bit8..3, tid=bit2..0
  const fz = (h0 >> 7) & 1;
  const type = (h0 >> 1) & 0x3f;
  const layerId = ((h0 & 1) << 5) | (h1 >> 3);
  const tid = h1 & 7;
  return {
    header: `0x${h0.toString(16).padStart(2, '0')} 0x${h1.toString(16).padStart(2, '0')} (${bin(h0, 8)}|${bin(h1, 8)})`,
    fields: {
      forbidden_zero_bit: `${fz} ${fz === 0 ? '✅' : '❌'}`,
      nal_unit_type: `${type} = ${H265_TYPE[type] || '类型' + type}${type <= 9 ? ' → 可随机访问丢弃段' : ''}`,
      nuh_layer_id: `${layerId} ${layerId === 0 ? '(基础层)' : '(增强层,可伸缩)'}`,
      nuh_temporal_id_plus1: `${tid} → temporal_id=${tid - 1} ${tid - 1 === 0 ? '(最底层,必须解)' : `(高层子集,可整层丢弃省带宽)`}`,
    },
    payload: nalu.length,
  };
}

const file = process.argv[2];
const limit = +(process.argv[3] || 12);
const buf = fs.readFileSync(file);
const isH265 = /\.h265|\.hevc$/i.test(file);
console.log(`===== ${file} (${isH265 ? 'H265 2B头' : 'H264 1B头'}) =====`);
const nalus = splitNalus(buf, limit);
for (const n of nalus) {
  const r = isH265 ? parseH265(n.bytes) : parseH264(n.bytes);
  console.log(`[${n.startcode}B startcode] 头=${r.header} 后续${r.payload - (isH265 ? 2 : 1)}B payload`);
  for (const [k, v] of Object.entries(r.fields)) console.log(`    ${k.padEnd(22)} ${v}`);
}

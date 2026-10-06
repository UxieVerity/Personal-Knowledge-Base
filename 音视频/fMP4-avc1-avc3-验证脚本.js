// 验证：avc1 vs avc3 的 SPS/PPS 到底放在哪（moov 的 avcC / moof / mdat sample 内）
// 用法: node fMP4-avc1-avc3-验证脚本.js <file.mp4> [file2.mp4 ...]
// 生成测试文件:
//   ffmpeg -f lavfi -i testsrc=duration=2:size=128x96:rate=10 -c:v libx264 -pix_fmt yuv420p \
//     -g 10 -x264-params repeat-headers=1 -f h264 raw.h264
//   ffmpeg -i raw.h264 -c copy -movflags frag_keyframe+empty_moov+default_base_moof -tag:v avc1 avc1.mp4
//   ffmpeg -i raw.h264 -c copy -movflags frag_keyframe+empty_moov+default_base_moof -tag:v avc3 avc3.mp4
const fs = require('fs');

function analyze(file) {
  const buf = fs.readFileSync(file);
  console.log('===== ' + file + ' =====');

  function walk(start, end, depth, path) {
    let off = start;
    while (off + 8 <= end) {
      const size = buf.readUInt32BE(off);
      const type = buf.toString('latin1', off + 4, off + 8);
      const p = path + '/' + type;
      console.log('  '.repeat(depth) + type + ' @' + off + ' size=' + size);
      if (size < 8 || off + size > end) { console.log('  '.repeat(depth) + 'BAD stop'); break; }
      if (type === 'stsd') walk(off + 16, off + size, depth + 1, p);        // stsd body 有 8B 头(ver/flags+entry_count)
      else if (['moov','trak','mdia','minf','stbl','moof','traf','mvex'].includes(type)) walk(off + 8, off + size, depth + 1, p);
      else if (type === 'avc1' || type === 'avc3') walk(off + 86, off + size, depth + 1, p); // 8B box头 + 78B 固定字段
      else if (type === 'avcC') {
        const d = buf.subarray(off + 8, off + size);
        console.log('  '.repeat(depth + 1) + `[avcC] SPS x${d[5] & 0x1f} (${d[7]}B) PPS x${d[6]} (${d[8]}B) profile=${d[1]} lengthSizeMinusOne=${d[4] & 3}`);
        const slice = buf.subarray(off, off + size);
        let idx = 0, count = 0;
        while ((idx = buf.indexOf(slice, idx)) !== -1) { count++; idx++; }
        console.log('  '.repeat(depth + 1) + 'avcC 内容全文件出现次数: ' + count);
      }
      if (type === 'moof') {
        const seg = buf.subarray(off, off + size);
        let hasSPS = false;
        for (let i = 0; i < seg.length - 5; i++) {
          if (seg[i] === 0 && seg[i+1] === 0 && seg[i+2] === 0 && seg[i+3] === 1 && (seg[i+4] & 0x1f) === 7) { hasSPS = true; break; }
        }
        console.log('  '.repeat(depth + 1) + '[moof] 含裸SPS(startcode): ' + hasSPS + '  ← moof 只装元数据, 永远为 false');
      }
      if (type === 'mdat') {
        const seg = buf.subarray(off + 8, off + size);
        const nals = [];
        let p2 = 0;
        while (p2 + 4 <= seg.length && nals.length < 40) {
          const len = seg.readUInt32BE(p2);
          if (len < 1 || p2 + 4 + len > seg.length) break;
          const nt = seg[p2 + 4] & 0x1f;
          nals.push(nt === 7 ? 'SPS' : nt === 8 ? 'PPS' : nt === 5 ? 'IDR' : nt === 1 ? 'slice' : 'nal' + nt);
          p2 += 4 + len;
        }
        console.log('  '.repeat(depth + 1) + '[mdat] NAL 序列: ' + nals.join(','));
      }
      off += size;
    }
  }
  walk(0, buf.length, 0, '');

  // 全文件 annexb startcode 计数(参考)
  let sps = 0, pps = 0;
  for (let i = 0; i < buf.length - 5; i++) {
    if (buf[i] === 0 && buf[i+1] === 0 && buf[i+2] === 0 && buf[i+3] === 1) {
      const nt = buf[i+4] & 0x1f;
      if (nt === 7) sps++; if (nt === 8) pps++;
    }
  }
  console.log(`全文件 annexb startcode SPS=${sps} PPS=${pps} (avcC 内为 length-prefixed 格式, 此计数只反映裸流残留)\n`);
}

process.argv.slice(2).forEach(analyze);

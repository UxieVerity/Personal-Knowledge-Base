// 共享源码：一个 ES module，含 3 个导出（其中 unused 不被使用）
export function used() {
  return 'used-fn';
}

export function unused() {
  return 'unused-fn (should be tree-shaken)';
}

export default function main() {
  return used();
}

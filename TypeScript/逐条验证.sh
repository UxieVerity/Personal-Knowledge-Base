#!/usr/bin/env bash
# TS 类型检查实测：逐条启用错误代码，抓 tsc 真实报错
# 用法：bash 逐条验证.sh

set -u
TSC="$LOCALAPPDATA/Temp/ts-lab/node_modules/.bin/tsc"
SRC="C:/Users/13511/Desktop/前端知识/Personal-Knowledge-Base/TypeScript"
TMP="$LOCALAPPDATA/Temp/ts-check"

mkdir -p "$TMP"

run_case() {
  local name="$1"; local code="$2"
  printf '%s\n' "$code" > "$TMP/case.ts"
  local out
  out=$("$TSC" --noEmit --strict "$TMP/case.ts" 2>&1)
  local code_exit=$?
  if [ $code_exit -ne 0 ]; then
    echo "✅ [$name] 报错（预期）→ $(echo "$out" | grep -oE 'error TS[0-9]+: .*' | head -1)"
  else
    echo "⚠️  [$name] 没报错"
  fi
}

echo "========== TS 类型检查逐条实测 =========="

run_case "1. number 赋 string" '
let e1: number = 42;
e1 = "str";
'

run_case "2. const 字面量类型" '
const e2 = "foo";
e2 = "bar";
'

run_case "3. unknown 直接访问属性" '
let e3: unknown = 42;
e3.foo;
'

run_case "4. unknown 直接调用" '
let e4: unknown = () => 1;
e4();
'

run_case "5. unknown 赋给 number" '
let e5: unknown = 42;
const e5num: number = e5;
'

run_case "6. never 被赋值" '
declare const e6: never;
const e6num: never = 42;
'

run_case "7. 穷尽检查漏分支" '
type Shape7 = "circle" | "square" | "triangle";
function area7(s: Shape7): number {
  switch (s) {
    case "circle": return 1;
    case "square": return 2;
    default:
      const exhaustive: never = s;
      return exhaustive;
  }
}
'

run_case "8. 属性不存在" '
const e8 = { name: "x" };
e8.age;
'

echo ""
echo "========== 对照组：应「不报错」 =========="

run_case_expect_ok() {
  local name="$1"; local code="$2"
  printf '%s\n' "$code" > "$TMP/ok.ts"
  local out
  out=$("$TSC" --noEmit --strict "$TMP/ok.ts" 2>&1)
  local code_exit=$?
  if [ $code_exit -eq 0 ]; then
    echo "✅ [$name] 不报错（符合预期）"
  else
    echo "⚠️  [$name] 意外报错 → $out"
  fi
}

run_case_expect_ok "any 可赋给 number（危险但合法）" '
let a: any = "str";
const n: number = a;
'

run_case_expect_ok "any 可调用任意方法" '
let a: any = 42;
a.foo.bar();
'

run_case_expect_ok "unknown 收窄后可用" '
let u: unknown = "hello";
if (typeof u === "string") {
  const s: string = u.toUpperCase();
}
'

run_case_expect_ok "never 可赋给任何类型" '
declare const nv: never;
const n1: number = nv;
const n2: string = nv;
'

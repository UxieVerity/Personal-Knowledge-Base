#!/usr/bin/env bash
# 泛型：逐条启用错误代码，抓 tsc 真实报错
# 用法：bash 泛型逐条验证.sh

set -u
TSC="$LOCALAPPDATA/Temp/ts-lab/node_modules/.bin/tsc"
TMP="$LOCALAPPDATA/Temp/ts-generic"
mkdir -p "$TMP"

run_case() {
  local name="$1"; local code="$2"
  printf '%s\n' "$code" > "$TMP/case.ts"
  local out
  out=$("$TSC" --noEmit --strict "$TMP/case.ts" 2>&1)
  if [ $? -ne 0 ]; then
    echo "✅ [$name] → $(echo "$out" | grep -oE 'error TS[0-9]+: .*' | head -1)"
  else
    echo "⚠️  [$name] 没报错"
  fi
}

run_ok() {
  local name="$1"; local code="$2"
  printf '%s\n' "$code" > "$TMP/ok.ts"
  local out
  out=$("$TSC" --noEmit --strict "$TMP/ok.ts" 2>&1)
  if [ $? -eq 0 ]; then echo "✅ [$name] 不报错（符合预期）"
  else echo "⚠️  [$name] 意外报错 → $out"; fi
}

echo "════════ 泛型约束报错实测 ════════"

run_case "1. 违反 extends 约束（number 没有 length）" '
function getLength<T extends { length: number }>(x: T): number { return x.length; }
getLength(42);
'

run_case "2. keyof 约束：不存在的键" '
function getProp<T, K extends keyof T>(obj: T, key: K): T[K] { return obj[key]; }
const user = { name: "张三" };
getProp(user, "email");
'

run_case "3. 泛型类型不匹配" '
function identity<T>(arg: T): T { return arg; }
const x: number = identity("str");
'

run_case "4. 映射类型：Pick 不存在的键" '
type MyPick<T, K extends keyof T> = { [P in K]: T[P] };
interface User { id: number; name: string; }
type Bad = MyPick<User, "email">;
'

run_case "5. 条件类型 infer 提取失败" '
type ElementOf<T> = T extends (infer E)[] ? E : never;
type Bad = ElementOf<number>;
const x: Bad = 42;
'

run_case "6. readonly 不能改" '
type MyReadonly<T> = { readonly [P in keyof T]: T[P] };
interface User { id: number; }
const u: MyReadonly<User> = { id: 1 };
u.id = 2;
'

run_case "7. Required 后缺字段" '
type MyRequired<T> = { [P in keyof T]-?: T[P] };
interface User { id?: number; }
const u: MyRequired<User> = {};
'

echo ""
echo "════════ 对照组：应不报错 ════════"

run_ok "1. 满足约束" '
function getLength<T extends { length: number }>(x: T): number { return x.length; }
getLength("abc"); getLength([1,2,3]);
'

run_ok "2. keyof 合法键" '
function getProp<T, K extends keyof T>(obj: T, key: K): T[K] { return obj[key]; }
const user = { name: "张三" };
getProp(user, "name");
'

run_ok "3. 手写工具类型与内置等价" '
type MyPick<T, K extends keyof T> = { [P in K]: T[P] };
interface User { id: number; name: string; }
const a: MyPick<User, "id"> = { id: 1 };
const b: Pick<User, "id"> = { id: 1 };
'

run_ok "4. infer 提取成功" '
type ElementOf<T> = T extends (infer E)[] ? E : never;
const x: ElementOf<string[]> = "str";
'

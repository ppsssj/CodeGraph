// sample.ts — CodeGraph Dataflow Stress Test
// 목적: calls/constructs/dataflow가 다양한 TS 구문에서 안정적으로 생성/표시되는지 검증

export type User = {
  id: number;
  name: string;
};

export function greet(user: User): string {
  return `Hello, ${user.name}!`;
}

// 1) 기본 다중 인자 + 타입
export function add(a: number, b: number): number {
  return a + b;
}

// 2) 오버로드(ResolvedSignature가 올바른 params를 내는지)
export function fmt(v: number): string;
export function fmt(v: string, pad?: number): string;
export function fmt(v: number | string, pad = 0): string {
  const s = String(v);
  return pad > 0 ? s.padStart(pad, "0") : s;
}

// 3) 제네릭 + 타입추론
export function first<T>(arr: T[]): T {
  return arr[0];
}

// 4) rest/spread
export function sum(...xs: number[]) {
  return xs.reduce((a, b) => a + b, 0);
}

export class Counter {
  private value = 0;

  // 5) default param + 생략 인자
  inc(step = 1) {
    this.value += step;
    return this.value;
  }

  // 6) optional param + nullish 처리
  dec(step?: number) {
    this.value -= step ?? 1;
    return this.value;
  }

  get() {
    return this.value;
  }
}

// 7) 콜백 파라미터 + 화살표 함수
export function withLog<T>(tag: string, fn: () => T): T {
  console.log("[withLog]", tag);
  return fn();
}

// 8) 구조분해 파라미터 (paramName이 패턴이면 라벨이 어떻게 나오는지)
export function pick({ id, name }: User, keys: Array<"id" | "name">) {
  return keys.map((k) => (k === "id" ? id : name));
}

// 9) 체이닝 호출 + 중첩 호출
export function chain(x: number) {
  return fmt(add(x, 3), 4).toUpperCase();
}

// 10) 외부(external) 호출이 섞여도 깨지지 않는지
export function parseJson(s: string) {
  return JSON.parse(s) as unknown;
}

// -------------------- 실행 파트 (Top-level 호출: owner=file 노드) --------------------

const u: User = { id: 1, name: "CodeGraph" };

// A. 기본 호출: dataflow 1개(user ← u)
console.log(greet(u));

// B. 다중 인자: dataflow 2개(a ← 2, b ← 3)
console.log("add:", add(2, 3));

// C. 오버로드 1: fmt(v ← 7)
console.log("fmt1:", fmt(7));

// D. 오버로드 2: fmt(v ← "9", pad ← 3) => dataflow 2개
console.log("fmt2:", fmt("9", 3));

// E. 제네릭: first(arr ← [..]) => dataflow 1개
console.log("first:", first([10, 20, 30]));

// F. rest/spread: sum(xs ← ...nums) 케이스
const nums = [1, 2, 3, 4];
console.log("sum:", sum(...nums));

// G. class/new/constructor 흐름: constructs + dataflow(인자 있으면)
const c = new Counter();
console.log("counter:", c.inc(), c.inc(2), c.dec(), c.dec(5), c.get());

// H. 콜백: withLog(tag ← "run", fn ← () => ...)
console.log(
  "withLog:",
  withLog("run", () => chain(5)),
);

// I. 구조분해 param: pick({id,name} ← u, keys ← ["id","name"])
console.log("pick:", pick(u, ["id", "name"]));

// J. 외부 호출: parseJson(s ← "{...}") + JSON.parse(s ← ...)
console.log("parseJson:", parseJson('{"ok": true}'));

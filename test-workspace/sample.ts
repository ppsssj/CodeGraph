// sample.ts — CodeGraph 테스트용

export type User = {
  id: number;
  name: string;
};

export function greet(user: User): string {
  return `Hello, ${user.name}!`;
}

export function add(a: number, b: number): number {
  return a + b;
}

export class Counter {
  private value = 0;

  inc(step = 1) {
    this.value += step;
    return this.value;
  }

  dec(step = 1) {
    this.value -= step;
    return this.value;
  }

  get() {
    return this.value;
  }
}

// 간단 실행
const u: User = { id: 1, name: "CodeGraph" };
console.log(greet(u));
console.log("add:", add(2, 3));

const c = new Counter();
console.log("counter:", c.inc(), c.inc(2), c.dec());

// example.ts

// 1. 기본 타입 지정
let username: string = "Alice";
let age: number = 25;
let isAdmin: boolean = false;

// 2. 배열과 튜플
let scores: number[] = [90, 85, 88];
let userInfo: [string, number] = ["Bob", 30]; // 튜플: [이름, 나이]

// 3. 인터페이스
interface User {
  name: string;
  age: number;
  isAdmin?: boolean; // 선택적 속성
}

// 4. 함수 타입 지정
function greet(user: User): string {
  return `Hello, ${user.name}! You are ${user.age} years old.`;
}

// 5. 클래스
class Person implements User {
  constructor(
    public name: string,
    public age: number,
    public isAdmin: boolean = false,
  ) {}

  introduce(): void {
    console.log(`Hi, I'm ${this.name}, ${this.age} years old.`);
  }
}

// 6. 제네릭 함수
function getFirstElement<T>(arr: T[]): T | undefined {
  return arr.length > 0 ? arr[0] : undefined;
}

// 7. 에러 처리
function safeDivide(a: number, b: number): number {
  if (b === 0) {
    throw new Error("Division by zero is not allowed.");
  }
  return a / b;
}

// 실행 예시
const user1: User = { name: "Charlie", age: 28 };
console.log(greet(user1));

const person1 = new Person("David", 35, true);
person1.introduce();

console.log("First score:", getFirstElement(scores));

try {
  console.log("10 / 2 =", safeDivide(10, 2));
  console.log("10 / 0 =", safeDivide(10, 0)); // 에러 발생
} catch (error) {
  if (error instanceof Error) {
    console.error("Error:", error.message);
  }
}

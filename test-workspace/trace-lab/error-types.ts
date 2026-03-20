export interface Person {
  id: string;
  name: string;
  age: number;
}

export type ApiResponse = {
  ok: boolean;
  message: string;
  data: Person[];
};

export function loadPeople(): ApiResponse {
  return {
    ok: true,
    message: "loaded",
    data: [
      { id: "p-1", name: "Ada", age: 31 },
      { id: "p-2", name: "Linus", age: 28 },
    ],
  };
}

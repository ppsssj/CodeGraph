import { loadPeople, type Person } from "./error-types";

function normalizePerson(person: Person) {
  return {
    ...person,
    ageGroup: person.age > 29 ? "senior" : "junior",
  };
}

export function runBrokenTypeDemo() {
  const response = loadPeople();

  const first = response.data[0];
  const invalidAge: number = first.name;
  const normalized = normalizePerson({
    id: 42,
    name: "Grace",
    age: "unknown",
  });

  return {
    invalidAge,
    normalized,
    state: response.missingField,
  };
}

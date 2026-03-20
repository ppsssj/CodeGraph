import type { MissingUser, Person } from "./error-types";
import { createMissingService } from "./missing-module";

const fallbackUser: Person = {
  id: "broken-1",
  name: "Fallback",
  age: 0,
};

export function runBrokenImportDemo(input: MissingUser) {
  const service = createMissingService();
  return service.process({
    input,
    fallbackUser,
  });
}

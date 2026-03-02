interface IFoo { a: number }
type TBar = { x: string; y: number }
enum EBaz { A, B }

const foo = () => { bar(); };
const baz = function () { qux(); };

class C { m = () => { foo(); }; }

function bar() {}
function qux() {}
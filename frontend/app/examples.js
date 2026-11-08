// Draco Code examples: small, complete programs that show off the terminal and each language.
// Every example is executed by the test suite and must print exactly `expected` when given `stdin`.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DracoExamples = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var LIST = [
  {
    "id": "python-greeting",
    "language": "python",
    "topic": "greeting",
    "title": "Ask for input",
    "description": "Reads a name and an age from the terminal, then replies.",
    "code": "name = input(\"Your name: \")\nage = int(input(\"Your age: \"))\nprint(f\"Hello, {name}! Next year you will be {age + 1}.\")\n",
    "stdin": "Ada\n36\n",
    "expected": "Your name: Your age: Hello, Ada! Next year you will be 37.\n"
  },
  {
    "id": "python-fibonacci",
    "language": "python",
    "topic": "fibonacci",
    "title": "Fibonacci numbers",
    "description": "Prints the first 15 numbers of the sequence.",
    "code": "def fibonacci(count):\n    a, b = 0, 1\n    for _ in range(count):\n        yield a\n        a, b = b, a + b\n\n\nprint(\" \".join(str(n) for n in fibonacci(15)))\n",
    "stdin": "",
    "expected": "0 1 1 2 3 5 8 13 21 34 55 89 144 233 377\n"
  },
  {
    "id": "python-primes",
    "language": "python",
    "topic": "primes",
    "title": "Prime sieve",
    "description": "Sieve of Eratosthenes: every prime up to 50.",
    "code": "limit = 50\nis_prime = [True] * (limit + 1)\nis_prime[0] = is_prime[1] = False\nfor i in range(2, int(limit ** 0.5) + 1):\n    if is_prime[i]:\n        for j in range(i * i, limit + 1, i):\n            is_prime[j] = False\n\nprint(\" \".join(str(n) for n, prime in enumerate(is_prime) if prime))\n",
    "stdin": "",
    "expected": "2 3 5 7 11 13 17 19 23 29 31 37 41 43 47\n"
  },
  {
    "id": "python-shapes",
    "language": "python",
    "topic": "shapes",
    "title": "Shapes and classes",
    "description": "Polymorphism: different shapes, one way to ask for their area.",
    "code": "import math\n\n\nclass Shape:\n    def area(self):\n        raise NotImplementedError\n\n\nclass Circle(Shape):\n    def __init__(self, radius):\n        self.radius = radius\n\n    def area(self):\n        return math.pi * self.radius ** 2\n\n\nclass Rectangle(Shape):\n    def __init__(self, width, height):\n        self.width, self.height = width, height\n\n    def area(self):\n        return self.width * self.height\n\n\nfor shape in (Circle(2), Rectangle(3, 4)):\n    print(f\"{type(shape).__name__}: {shape.area():.2f}\")\n",
    "stdin": "",
    "expected": "Circle: 12.57\nRectangle: 12.00\n"
  },
  {
    "id": "javascript-greeting",
    "language": "javascript",
    "topic": "greeting",
    "title": "Ask for input",
    "description": "Reads a name and an age from the terminal, then replies.",
    "code": "const readline = require(\"readline\");\nconst rl = readline.createInterface({ input: process.stdin, output: process.stdout });\n\nrl.question(\"Your name: \", (name) => {\n  rl.question(\"Your age: \", (age) => {\n    console.log(`Hello, ${name}! Next year you will be ${Number(age) + 1}.`);\n    rl.close();\n  });\n});\n",
    "stdin": "Ada\n36\n",
    "expected": "Your name: Your age: Hello, Ada! Next year you will be 37.\n"
  },
  {
    "id": "javascript-fibonacci",
    "language": "javascript",
    "topic": "fibonacci",
    "title": "Fibonacci numbers",
    "description": "Prints the first 15 numbers of the sequence.",
    "code": "function* fibonacci(count) {\n  let [a, b] = [0, 1];\n  for (let i = 0; i < count; i++) {\n    yield a;\n    [a, b] = [b, a + b];\n  }\n}\n\nconsole.log([...fibonacci(15)].join(\" \"));\n",
    "stdin": "",
    "expected": "0 1 1 2 3 5 8 13 21 34 55 89 144 233 377\n"
  },
  {
    "id": "javascript-primes",
    "language": "javascript",
    "topic": "primes",
    "title": "Prime sieve",
    "description": "Sieve of Eratosthenes: every prime up to 50.",
    "code": "const limit = 50;\nconst isPrime = new Array(limit + 1).fill(true);\nisPrime[0] = isPrime[1] = false;\nfor (let i = 2; i * i <= limit; i++) {\n  if (isPrime[i]) {\n    for (let j = i * i; j <= limit; j += i) isPrime[j] = false;\n  }\n}\n\nconst primes = [];\nisPrime.forEach((prime, n) => { if (prime) primes.push(n); });\nconsole.log(primes.join(\" \"));\n",
    "stdin": "",
    "expected": "2 3 5 7 11 13 17 19 23 29 31 37 41 43 47\n"
  },
  {
    "id": "javascript-shapes",
    "language": "javascript",
    "topic": "shapes",
    "title": "Shapes and classes",
    "description": "Polymorphism: different shapes, one way to ask for their area.",
    "code": "class Shape {\n  area() {\n    throw new Error(\"not implemented\");\n  }\n}\n\nclass Circle extends Shape {\n  constructor(radius) { super(); this.radius = radius; }\n  area() { return Math.PI * this.radius ** 2; }\n}\n\nclass Rectangle extends Shape {\n  constructor(width, height) { super(); this.width = width; this.height = height; }\n  area() { return this.width * this.height; }\n}\n\nfor (const shape of [new Circle(2), new Rectangle(3, 4)]) {\n  console.log(`${shape.constructor.name}: ${shape.area().toFixed(2)}`);\n}\n",
    "stdin": "",
    "expected": "Circle: 12.57\nRectangle: 12.00\n"
  },
  {
    "id": "java-greeting",
    "language": "java",
    "topic": "greeting",
    "title": "Ask for input",
    "description": "Reads a name and an age from the terminal, then replies.",
    "code": "import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        System.out.print(\"Your name: \");\n        String name = in.nextLine();\n        System.out.print(\"Your age: \");\n        int age = Integer.parseInt(in.nextLine().trim());\n        System.out.println(\"Hello, \" + name + \"! Next year you will be \" + (age + 1) + \".\");\n    }\n}\n",
    "stdin": "Ada\n36\n",
    "expected": "Your name: Your age: Hello, Ada! Next year you will be 37.\n"
  },
  {
    "id": "java-fibonacci",
    "language": "java",
    "topic": "fibonacci",
    "title": "Fibonacci numbers",
    "description": "Prints the first 15 numbers of the sequence.",
    "code": "public class Main {\n    public static void main(String[] args) {\n        long a = 0, b = 1;\n        StringBuilder out = new StringBuilder();\n        for (int i = 0; i < 15; i++) {\n            if (i > 0) out.append(' ');\n            out.append(a);\n            long next = a + b;\n            a = b;\n            b = next;\n        }\n        System.out.println(out);\n    }\n}\n",
    "stdin": "",
    "expected": "0 1 1 2 3 5 8 13 21 34 55 89 144 233 377\n"
  },
  {
    "id": "java-primes",
    "language": "java",
    "topic": "primes",
    "title": "Prime sieve",
    "description": "Sieve of Eratosthenes: every prime up to 50.",
    "code": "public class Main {\n    public static void main(String[] args) {\n        int limit = 50;\n        boolean[] composite = new boolean[limit + 1];\n        StringBuilder out = new StringBuilder();\n        for (int i = 2; i <= limit; i++) {\n            if (composite[i]) continue;\n            if (out.length() > 0) out.append(' ');\n            out.append(i);\n            for (int j = i * i; j <= limit; j += i) composite[j] = true;\n        }\n        System.out.println(out);\n    }\n}\n",
    "stdin": "",
    "expected": "2 3 5 7 11 13 17 19 23 29 31 37 41 43 47\n"
  },
  {
    "id": "java-shapes",
    "language": "java",
    "topic": "shapes",
    "title": "Shapes and classes",
    "description": "Polymorphism: different shapes, one way to ask for their area.",
    "code": "import java.util.Locale;\n\nabstract class Shape {\n    abstract double area();\n}\n\nclass Circle extends Shape {\n    private final double radius;\n    Circle(double radius) { this.radius = radius; }\n    double area() { return Math.PI * radius * radius; }\n}\n\nclass Rectangle extends Shape {\n    private final double width, height;\n    Rectangle(double width, double height) { this.width = width; this.height = height; }\n    double area() { return width * height; }\n}\n\npublic class Main {\n    public static void main(String[] args) {\n        Shape[] shapes = { new Circle(2), new Rectangle(3, 4) };\n        for (Shape shape : shapes) {\n            System.out.println(String.format(Locale.US, \"%s: %.2f\", shape.getClass().getSimpleName(), shape.area()));\n        }\n    }\n}\n",
    "stdin": "",
    "expected": "Circle: 12.57\nRectangle: 12.00\n"
  },
  {
    "id": "c-greeting",
    "language": "c",
    "topic": "greeting",
    "title": "Ask for input",
    "description": "Reads a name and an age from the terminal, then replies.",
    "code": "#include <stdio.h>\n\nint main(void) {\n    char name[64];\n    int age;\n\n    printf(\"Your name: \");\n    if (scanf(\" %63[^\\n]\", name) != 1) return 1;\n    printf(\"Your age: \");\n    if (scanf(\"%d\", &age) != 1) return 1;\n\n    printf(\"Hello, %s! Next year you will be %d.\\n\", name, age + 1);\n    return 0;\n}\n",
    "stdin": "Ada\n36\n",
    "expected": "Your name: Your age: Hello, Ada! Next year you will be 37.\n"
  },
  {
    "id": "c-fibonacci",
    "language": "c",
    "topic": "fibonacci",
    "title": "Fibonacci numbers",
    "description": "Prints the first 15 numbers of the sequence.",
    "code": "#include <stdio.h>\n\nint main(void) {\n    unsigned long long a = 0, b = 1;\n    for (int i = 0; i < 15; i++) {\n        if (i > 0) printf(\" \");\n        printf(\"%llu\", a);\n        unsigned long long next = a + b;\n        a = b;\n        b = next;\n    }\n    printf(\"\\n\");\n    return 0;\n}\n",
    "stdin": "",
    "expected": "0 1 1 2 3 5 8 13 21 34 55 89 144 233 377\n"
  },
  {
    "id": "c-primes",
    "language": "c",
    "topic": "primes",
    "title": "Prime sieve",
    "description": "Sieve of Eratosthenes: every prime up to 50.",
    "code": "#include <stdbool.h>\n#include <stdio.h>\n\n#define LIMIT 50\n\nint main(void) {\n    bool composite[LIMIT + 1] = { false };\n    bool first = true;\n    for (int i = 2; i <= LIMIT; i++) {\n        if (composite[i]) continue;\n        if (!first) printf(\" \");\n        printf(\"%d\", i);\n        first = false;\n        for (int j = i * i; j <= LIMIT; j += i) composite[j] = true;\n    }\n    printf(\"\\n\");\n    return 0;\n}\n",
    "stdin": "",
    "expected": "2 3 5 7 11 13 17 19 23 29 31 37 41 43 47\n"
  },
  {
    "id": "c-shapes",
    "language": "c",
    "topic": "shapes",
    "title": "Shapes and classes",
    "description": "Polymorphism: different shapes, one way to ask for their area.",
    "code": "#include <math.h>\n#include <stdio.h>\n\ntypedef enum { CIRCLE, RECTANGLE } Kind;\ntypedef struct { Kind kind; double a, b; } Shape;\n\nstatic double area(const Shape *shape) {\n    return shape->kind == CIRCLE ? M_PI * shape->a * shape->a : shape->a * shape->b;\n}\n\nint main(void) {\n    const char *names[] = { \"Circle\", \"Rectangle\" };\n    Shape shapes[] = { { CIRCLE, 2, 0 }, { RECTANGLE, 3, 4 } };\n    for (int i = 0; i < 2; i++) {\n        printf(\"%s: %.2f\\n\", names[shapes[i].kind], area(&shapes[i]));\n    }\n    return 0;\n}\n",
    "stdin": "",
    "expected": "Circle: 12.57\nRectangle: 12.00\n"
  },
  {
    "id": "cpp-greeting",
    "language": "cpp",
    "topic": "greeting",
    "title": "Ask for input",
    "description": "Reads a name and an age from the terminal, then replies.",
    "code": "#include <iostream>\n#include <string>\n\nint main() {\n    std::string name;\n    int age = 0;\n\n    std::cout << \"Your name: \" << std::flush;\n    std::getline(std::cin, name);\n    std::cout << \"Your age: \" << std::flush;\n    std::cin >> age;\n\n    std::cout << \"Hello, \" << name << \"! Next year you will be \" << age + 1 << \".\\n\";\n    return 0;\n}\n",
    "stdin": "Ada\n36\n",
    "expected": "Your name: Your age: Hello, Ada! Next year you will be 37.\n"
  },
  {
    "id": "cpp-fibonacci",
    "language": "cpp",
    "topic": "fibonacci",
    "title": "Fibonacci numbers",
    "description": "Prints the first 15 numbers of the sequence.",
    "code": "#include <iostream>\n\nint main() {\n    unsigned long long a = 0, b = 1;\n    for (int i = 0; i < 15; i++) {\n        if (i > 0) std::cout << ' ';\n        std::cout << a;\n        unsigned long long next = a + b;\n        a = b;\n        b = next;\n    }\n    std::cout << '\\n';\n    return 0;\n}\n",
    "stdin": "",
    "expected": "0 1 1 2 3 5 8 13 21 34 55 89 144 233 377\n"
  },
  {
    "id": "cpp-primes",
    "language": "cpp",
    "topic": "primes",
    "title": "Prime sieve",
    "description": "Sieve of Eratosthenes: every prime up to 50.",
    "code": "#include <iostream>\n#include <vector>\n\nint main() {\n    const int limit = 50;\n    std::vector<bool> composite(limit + 1, false);\n    bool first = true;\n    for (int i = 2; i <= limit; i++) {\n        if (composite[i]) continue;\n        if (!first) std::cout << ' ';\n        std::cout << i;\n        first = false;\n        for (int j = i * i; j <= limit; j += i) composite[j] = true;\n    }\n    std::cout << '\\n';\n    return 0;\n}\n",
    "stdin": "",
    "expected": "2 3 5 7 11 13 17 19 23 29 31 37 41 43 47\n"
  },
  {
    "id": "cpp-shapes",
    "language": "cpp",
    "topic": "shapes",
    "title": "Shapes and classes",
    "description": "Polymorphism: different shapes, one way to ask for their area.",
    "code": "#include <cmath>\n#include <iomanip>\n#include <iostream>\n#include <memory>\n#include <vector>\n\nstruct Shape {\n    virtual ~Shape() = default;\n    virtual double area() const = 0;\n    virtual const char *name() const = 0;\n};\n\nstruct Circle : Shape {\n    double radius;\n    explicit Circle(double radius) : radius(radius) {}\n    double area() const override { return M_PI * radius * radius; }\n    const char *name() const override { return \"Circle\"; }\n};\n\nstruct Rectangle : Shape {\n    double width, height;\n    Rectangle(double width, double height) : width(width), height(height) {}\n    double area() const override { return width * height; }\n    const char *name() const override { return \"Rectangle\"; }\n};\n\nint main() {\n    std::vector<std::unique_ptr<Shape>> shapes;\n    shapes.push_back(std::make_unique<Circle>(2));\n    shapes.push_back(std::make_unique<Rectangle>(3, 4));\n\n    std::cout << std::fixed << std::setprecision(2);\n    for (const auto &shape : shapes) {\n        std::cout << shape->name() << \": \" << shape->area() << \"\\n\";\n    }\n    return 0;\n}\n",
    "stdin": "",
    "expected": "Circle: 12.57\nRectangle: 12.00\n"
  }
];
  var TOPICS = {
  "greeting": {
    "title": "Ask for input",
    "description": "Reads a name and an age from the terminal, then replies."
  },
  "fibonacci": {
    "title": "Fibonacci numbers",
    "description": "Prints the first 15 numbers of the sequence."
  },
  "primes": {
    "title": "Prime sieve",
    "description": "Sieve of Eratosthenes: every prime up to 50."
  },
  "shapes": {
    "title": "Shapes and classes",
    "description": "Polymorphism: different shapes, one way to ask for their area."
  }
};
  function forLanguage(language) { return LIST.filter(function (e) { return e.language === language; }); }
  function byId(id) { return LIST.filter(function (e) { return e.id === id; })[0] || null; }
  return { LIST: LIST, TOPICS: TOPICS, forLanguage: forLanguage, byId: byId };
});

import fs from "@tscc/env/fs";
// ./lib.ts
// import "./index";
// ./sub/file.ts
export const FILE_TOKEN = "$$$$$";
export const add = <T extends number>(a: T, b: T) => a + b;

console.log(add(10, 20));

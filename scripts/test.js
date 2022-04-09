#!/usr/bin/env node
//@ts-check

import child_process from "child_process";

(function main() {
    child_process.execSync("NODE_OPTIONS=--es-module-specifier-resolution=node istanbul cover --root ./spec/build/src --include-all-sources --report cobertura --report lcov jasmine", { stdio: "inherit" });

    child_process.execSync("istanbul-cobertura-badger -b coverage -e 90 coverage/cobertura.xml -d coverage/", { stdio: "inherit" });
})();
#!/usr/bin/env node

"use strict";

const child_process = require("child_process");

(function main() {
    child_process.execSync("istanbul cover --root ./spec/build/src --include-all-sources --report cobertura --report lcov jasmine", { stdio: "inherit" });

    child_process.execSync("istanbul-cobertura-badger -b coverage -e 90 coverage/cobertura.xml -d coverage/", { stdio: "inherit" });
})();
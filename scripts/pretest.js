#!/usr/bin/env node

"use strict";

const fs = require("fs-extra");
const child_process = require("child_process");

const BUILD_DIR = "./spec/build";

(function main() {
    fs.removeSync(BUILD_DIR);

    child_process.execSync("ngc --p ./spec", { stdio: "inherit" });
})();
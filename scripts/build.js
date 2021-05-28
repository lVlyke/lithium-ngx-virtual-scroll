#!/usr/bin/env node
//@ts-check
"use strict";

const fs = require("fs-extra");
const child_process = require("child_process");
const path = require("path");

const INJECTED_FILES = {
    "README.md": "./README.md",
    "LICENSE": "./LICENSE"
};

const BUILD_DIR = "./dist";

(function main() {
    fs.removeSync(BUILD_DIR);

    child_process.execSync("ng-packagr -p package.json");

    for (let injectedFileName in INJECTED_FILES) {
        fs.copy(INJECTED_FILES[injectedFileName], path.join(BUILD_DIR, injectedFileName));
    }
})();

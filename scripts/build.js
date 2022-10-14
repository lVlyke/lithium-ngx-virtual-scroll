#!/usr/bin/env node
//@ts-check

import fs from "fs-extra";
import child_process from "child_process";
import path from "path";

const INJECTED_FILES = {
    "README.md": "./README.md",
    "LICENSE": "./LICENSE"
};

const BUILD_DIR = "./dist";

(function main() {
    fs.removeSync(BUILD_DIR);

    child_process.execSync("ng-packagr -p ng-package.json --config tsconfig.lib.json");

    for (let injectedFileName in INJECTED_FILES) {
        fs.copy(INJECTED_FILES[injectedFileName], path.join(BUILD_DIR, injectedFileName));
    }
})();
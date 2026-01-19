import { TestBed } from "@angular/core/testing";
import {
    BrowserTestingModule,
    platformBrowserTesting
} from "@angular/platform-browser/testing";

const platform = platformBrowserTesting();

beforeEach(() => {
    TestBed.resetTestEnvironment();
    TestBed.initTestEnvironment(BrowserTestingModule, platform);
});

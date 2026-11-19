#!/usr/bin/env node
/** 生成 build/dict.json（发布前运行，CI 也会跑）。 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeDict } from '../src/dictionary.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const counts = writeDict(ROOT);
console.log('dictionary built:', counts);

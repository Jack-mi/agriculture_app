// 知识库汇总出口：逻辑代码只从这里取数据
const DOCS = require('./docs.js');
const PESTICIDES = require('./pesticides.js');
const BLOCKED = require('./blocked.js');
const { CROP_GDD, STAGES, VARIETY_FACTOR } = require('./stages.js');

module.exports = { DOCS, PESTICIDES, BLOCKED, CROP_GDD, STAGES, VARIETY_FACTOR };

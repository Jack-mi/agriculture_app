// 农事参谋 · 技术依据知识库（薄适配层）
// 数据在 miniprogram/kb/docs.js（可插拔，见 kb/README.md）；这里只保留取用接口。
const { DOCS } = require('../kb');

function get(key) { return DOCS[key] || null; }
module.exports = { DOCS, get };

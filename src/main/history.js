'use strict';

/**
 * 📜 다운로드 기록.
 *
 * 받은 파일이 어디 있는지 나중에 다시 찾기 어렵다는 불편을 없앤다.
 *  · 완료된 항목을 최근 순으로 보관
 *  · 파일이 아직 있는지 확인해서 '폴더 열기'를 제공
 *  · 같은 주소를 다시 받을 때 재입력할 필요 없게 URL 보관
 *
 * 저장 위치: userData/history.json (사용자 PC 안에만 있으며 어디로도 전송하지 않는다)
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const MAX = 300; // 너무 커지면 앱 시작이 느려진다

function file() {
  return path.join(app.getPath('userData'), 'history.json');
}

function load() {
  try {
    const v = JSON.parse(fs.readFileSync(file(), 'utf-8'));
    return Array.isArray(v) ? v : [];
  } catch (_) {
    return [];
  }
}

function save(list) {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(list.slice(0, MAX), null, 2));
  } catch (e) {
    console.error('[history] 저장 실패', e.message);
  }
}

/** 완료된 다운로드 한 건 기록. 같은 파일이 다시 들어오면 최신으로 끌어올린다. */
function add(entry) {
  const list = load();
  const key = entry.file || entry.url;
  const rest = list.filter((r) => (r.file || r.url) !== key);
  rest.unshift({
    url: entry.url || '',
    title: entry.title || '',
    file: entry.file || '',
    mode: entry.mode || 'video',
    thumbnail: entry.thumbnail || '',
    size: entry.size || 0,
    at: new Date().toISOString(),
  });
  save(rest);
  return rest;
}

/** 목록 조회 — 파일이 아직 존재하는지(exists)를 함께 돌려준다. */
function list() {
  return load().map((r) => ({ ...r, exists: !!r.file && fs.existsSync(r.file) }));
}

function clear() {
  save([]);
  return [];
}

/** 한 건 삭제(기록만 지운다. 실제 파일은 건드리지 않는다) */
function remove(key) {
  const rest = load().filter((r) => (r.file || r.url) !== key);
  save(rest);
  return rest;
}

module.exports = { add, list, clear, remove };

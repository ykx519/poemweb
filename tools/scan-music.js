#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════
   诗镜 · 音乐库扫描工具
   扫描 Music/ 文件夹，按「歌名+歌手名」解析文件名，生成：
     - Music/index.json   （清单，供网站 fetch 读取）
     - data-music.js      （兜底清单，兼容 file:// 直接打开）
   用法：在 poemweb 目录下运行   node tools/scan-music.js
   新增歌曲后重新运行一次即可；在支持目录列表的静态服务器上
   网站也能自动识别新增歌曲，无需运行本工具。
   ══════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const musicDir = path.join(__dirname, '..', 'Music');
const dataMusic = path.join(__dirname, '..', 'data-music.js');

// 与网站端一致的文件名解析：「歌名+歌手名」，兼容 - – — _ 分隔
function parseSongName(name) {
  let title = name, artist = '';
  const i = name.indexOf('+');
  if (i > 0) { title = name.slice(0, i).trim(); artist = name.slice(i + 1).trim(); }
  else {
    const m = name.split(/[-–—_]/);
    if (m.length >= 2) { title = m[0].trim(); artist = m.slice(1).join(' ').trim(); }
  }
  return { title: title || name, artist };
}

const files = fs.readdirSync(musicDir).filter(f => /\.(mp3|m4a|ogg|wav)$/i.test(f)).sort();
const songs = files.map(f => {
  const base = path.basename(f, path.extname(f));
  const { title, artist } = parseSongName(base);
  return { title, artist, src: 'Music/' + f, file: f };
});

fs.writeFileSync(path.join(musicDir, 'index.json'), JSON.stringify(songs, null, 2) + '\n');

const header = '/* 本文件由 tools/scan-music.js 自动生成，请勿手动编辑。新增歌曲后运行：node tools/scan-music.js */\n';
fs.writeFileSync(dataMusic, header + 'const MUSIC = ' + JSON.stringify(songs.map(s => ({ title: s.title, artist: s.artist, src: s.src, tag: '' })), null, 2) + ';\n');

console.log('已扫描 Music/：' + songs.length + ' 首');
songs.forEach(s => console.log('  ' + s.title + (s.artist ? ' · ' + s.artist : '') + '   (' + s.file + ')'));
console.log('\n已生成 Music/index.json 与 data-music.js');

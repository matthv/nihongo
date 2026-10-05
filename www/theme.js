'use strict';

// Loaded in <head> so the skin is in place before the first paint; app.js calls applyTheme() on change.
const SKINS = [
  { id: 'neutre', name: 'Neutre', swatch: ['#f5f6f8', '#2c4f7c', '#c8402f'] },
  { id: 'papier', name: 'Papier', swatch: ['#faf7f2', '#2c4f7c', '#c8402f'] },
  { id: 'sakura', name: 'Sakura', swatch: ['#fbf5f7', '#a33e6c', '#e0607e'] },
  { id: 'matcha', name: 'Matcha', swatch: ['#f4f7f2', '#3d6b35', '#7a9a2e'] },
  { id: 'indigo', name: 'Indigo', swatch: ['#f3f5fb', '#3a4fa0', '#c8402f'] },
];
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

function applyTheme(skin, mode) {
  const root = document.documentElement;
  root.dataset.skin = SKINS.some(s => s.id === skin) ? skin : 'neutre';
  root.dataset.modePref = mode || 'auto';
  root.dataset.mode = mode === 'light' || mode === 'dark' ? mode : darkQuery.matches ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue('--bg').trim();
}

darkQuery.addEventListener('change', () => applyTheme(document.documentElement.dataset.skin, document.documentElement.dataset.modePref));

(() => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('nihongo:v1')) || {}; } catch { /* first visit or no storage */ }
  applyTheme(saved.skin, saved.mode);
})();
